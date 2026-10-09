/**
 * The Tokens page's money band (spec 2026-10-03 servers-tokens §3.1, §5.2): what is left and who is spending it.
 *
 *   GET /api/tokens/money   the $250 cloud grant (real money), Codex credits (balance of the weekly budget, spent today and
 *                           by day), DeepSeek / OpenCode Go's share left
 *   GET /api/tokens/split   ?day=YYYY-MM-DD: the Luna/Sol split of Codex credits against the 80/20 target, and how much of
 *                           the account's spend that day this machine's ledger saw
 *   GET /api/tokens/fleet   the VPS rollup (siso-tokens on siso-vps): each device, its tokens today, when it last reported
 *
 * Every answer comes at once from the last reading and refreshes behind it; nothing here waits on a command. Sources:
 *   - grants and the Codex balance: `burn-rate --json` (usage.ts's cached run; it calls claude-credits itself, so this node
 *     never touches the Keychain); the newest Codex event's `rate_limits.credits` (tokens.ts) every 60 s
 *   - the weekly budget: siso-harness-lab/config/codex-rates.json (AB_CODEX_RATES)
 *   - the split: `spend-ledger split --day D --json` (AB_LEDGER_CMD), 5 min
 *   - DeepSeek: `quota-axi` (AB_QUOTA_CMD, TOON), the opencode-go row, 10 min
 *   - the rollup: `curl 127.0.0.1:3106/tokens-api/{devices,sync-status}` on AB_TOKENS_HOST (default siso-vps) over ssh
 *     (servers-probe.ts's runner, so AB_SSH fakes it in checks), 5 min
 */
import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import type http from "node:http";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { PROBE_ON, onMachine } from "./servers-probe.ts";
import { codexCredits, creditBalance } from "./tokens.ts";
import { burnNow, burnReading } from "./usage.ts";

const run = promisify(execFile);
const HOME = process.env.AB_HOME ?? os.homedir();
const RATES_FILE = process.env.AB_CODEX_RATES ?? path.join(HOME, "SISO_Workspace/SISO_Agents/siso-harness-lab/config/codex-rates.json");
const LEDGER = (process.env.AB_LEDGER_CMD ?? "spend-ledger").split(" ").filter(Boolean);
const QUOTA = (process.env.AB_QUOTA_CMD ?? "quota-axi").split(" ").filter(Boolean);
const TOKENS_HOST = process.env.AB_TOKENS_HOST ?? "siso-vps";
/** quota-axi, spend-ledger and the ssh read run only on a node launched with AB_SERVERS_PROBE=1 (servers-probe.ts). */
const allowed = () => PROBE_ON;
const PATH_ENV = { ...process.env, PATH: `${process.env.PATH ?? ""}:${HOME}/.local/bin` };

function json(res: http.ServerResponse, code: number, body: unknown) {
  res.writeHead(code, { "content-type": "application/json", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
}

const n = (v: unknown): number | null => (v !== null && v !== undefined && v !== "" && Number.isFinite(Number(v)) ? Number(v) : null);
const pick = (o: any, ...keys: string[]) => {
  for (const k of keys) if (o && o[k] !== undefined && o[k] !== null) return o[k];
  return undefined;
};
/** A time as ms from seconds, ms or text. */
const when = (v: unknown): number | null => {
  if (typeof v === "number") return v < 1e12 ? v * 1000 : v;
  if (typeof v === "string" && v) {
    const t = Date.parse(v);
    return Number.isFinite(t) ? t : null;
  }
  return null;
};
const localDay = (t = Date.now()) => {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

/** A reading kept per key, refreshed behind the request when older than `ms`. */
const kept = new Map<string, { at: number; value: unknown; run: Promise<void> | null }>();
function keep<T>(key: string, ms: number, read: () => Promise<T>): { value: T | null; at: number | null } {
  let k = kept.get(key);
  if (!k) kept.set(key, (k = { at: 0, value: null, run: null }));
  const kk = k;
  if (!kk.run && Date.now() - kk.at > ms) {
    kk.run = read()
      .then((v) => void (kk.value = v))
      .catch((e: Error) => void (kk.value = { error: String(e?.message ?? e).split("\n")[0].slice(0, 200) }))
      .finally(() => ((kk.at = Date.now()), (kk.run = null)));
  }
  return { value: kk.value as T | null, at: kk.at || null };
}

// ---------------------------------------------------------------- money

function grantsFrom(burn: any) {
  const raw = burn?.grants;
  const list: any[] = Array.isArray(raw) ? raw : raw && typeof raw === "object" ? Object.entries(raw).map(([k, v]) => ({ login: k, ...(v as object) })) : [];
  return list.map((g) => ({
    login: String(pick(g, "login", "account", "email", "profile") ?? "grant"),
    profile: pick(g, "profile") ?? null,
    limit: n(pick(g, "limit", "total", "granted", "amount")),
    used: n(pick(g, "used", "spent")),
    left: n(pick(g, "left", "remaining", "balance")),
    ends: when(pick(g, "ends", "ends_at", "expires_at", "expires")),
    perHour: n(pick(g, "usd_per_hour", "per_hour", "last_hour")),
    perDayToSpend: n(pick(g, "usd_per_day_to_spend", "per_day_to_spend", "per_day")),
  }));
}

function budgetFile(): { budget: number | null; reset: string | null } {
  try {
    const d = JSON.parse(readFileSync(RATES_FILE, "utf8"));
    return { budget: creditBalance(pick(d, "weekly_budget", "budget", "credits_per_week")), reset: pick(d, "weekly_reset", "reset") ?? null };
  } catch {
    return { budget: null, reset: null };
  }
}

function codexMoney(burn: any) {
  const ev = codexCredits();
  const b = burn?.codex?.balance;
  const bal = b && typeof b === "object" ? b : { balance: b };
  const byDay: Record<string, number> = {};
  for (const [k, v] of Object.entries(bal.by_day ?? burn?.codex?.by_day ?? {})) if (n(v) !== null) byDay[k] = Number(v);
  const file = budgetFile();
  const budget = creditBalance(pick(bal, "budget")) ?? creditBalance(burn?.codex?.budget) ?? file.budget;
  const today = localDay();
  const yesterday = localDay(Date.now() - 86_400_000);
  const burnReset = when(pick(bal, "reset", "resets_at") ?? burn?.codex?.reset);
  const eventReset = ev?.weeklyResetsAt ?? null;
  return {
    balance: ev?.balance ?? creditBalance(pick(bal, "balance", "left")),
    // These flags belong to this event, even if the numeric balance falls back to burn-rate.
    eventCredits: ev ? { at: ev.at, hasCredits: ev.hasCredits, unlimited: ev.unlimited } : null,
    balanceAt: ev?.balance != null ? ev.at : burn?.at ? when(burn.at) : null,
    balanceSource: ev?.balance != null ? "newest Codex event" : "burn-rate",
    budget,
    plan: ev?.plan ?? null,
    todaySpent: byDay[today] ?? null,
    yesterdaySpent: byDay[yesterday] ?? null,
    byDay,
    reset: eventReset ?? burnReset,
    // Spec §7: the event and burn-rate disagree on the weekly reset; show the event's, note the other until one owner reconciles them.
    resetNote: eventReset && burnReset && Math.abs(eventReset - burnReset) > 3_600_000 ? `burn-rate says ${new Date(burnReset).toISOString()}` : null,
  };
}

/** quota-axi's TOON: a header `name[N]{field,...}:` then comma rows; the opencode-go row's share left and reset. */
export function parseQuota(text: string) {
  const lines = text.split("\n");
  let fields: string[] = [];
  for (const l of lines) {
    const h = l.match(/\{([^}]+)\}:\s*$/);
    if (h) fields = h[1].split(",").map((x) => x.trim());
    if (!/opencode-go/.test(l)) continue;
    const cells = l.trim().split(",").map((x) => x.trim());
    const at = (re: RegExp) => {
      const i = fields.findIndex((f) => re.test(f));
      return i >= 0 ? cells[i] : undefined;
    };
    const leftPct = n(at(/left|remain/i)?.replace("%", "")) ?? (n(at(/used/i)?.replace("%", "")) !== null ? 100 - Number(at(/used/i)!.replace("%", "")) : n(l.match(/(\d+(?:\.\d+)?)%/)?.[1]));
    const resets = at(/reset/i) ?? l.match(/\d{4}-\d\d-\d\d/)?.[0] ?? null;
    return { name: "DeepSeek (OpenCode Go)", row: "opencode-go", leftPct, resets: resets ? when(resets) ?? resets : null };
  }
  return null;
}

async function readQuota() {
  if (!allowed()) return null;
  const { stdout } = await run(QUOTA[0], QUOTA.slice(1), { timeout: 20_000, maxBuffer: 1 << 20, env: PATH_ENV });
  return parseQuota(stdout);
}

function money() {
  const reading = burnReading();
  const burn: any = reading.data ?? null;
  const quota = keep("quota", 600_000, readQuota);
  const other = quota.value && !(quota.value as any).error ? [quota.value] : [];
  return {
    at: Date.now(),
    burnAt: burn?.at ? when(burn.at) : null,
    burnState: { readAt: reading.at, stale: reading.stale, refreshing: reading.refreshing, attemptedAt: reading.attemptedAt, reason: reading.reason ?? null },
    pending: !burn,
    grants: burn ? grantsFrom(burn) : null,
    codex: codexMoney(burn),
    other,
    otherError: (quota.value as any)?.error ?? null,
    notes: ["The grant is real money (Anthropic cloud credits). Every other dollar on this page is API-equiv: what the tokens would cost at API list prices, not a bill."],
  };
}

// ---------------------------------------------------------------- the Luna / Sol split

export function splitFrom(d: any, accountTotal: number | null) {
  const flat: Record<string, number> = {};
  const walk = (o: any, depth = 0) => {
    if (!o || typeof o !== "object" || depth > 3) return;
    for (const [k, v] of Object.entries(o)) {
      if (/luna|sol/i.test(k) && n(Array.isArray(v) ? v[0] : (v as any)?.credits ?? v) !== null) {
        const key = /luna/i.test(k) ? "luna" : "sol";
        flat[key] ??= Number(Array.isArray(v) ? v[0] : (v as any)?.credits ?? v);
      } else if (typeof v === "object") walk(v, depth + 1);
    }
  };
  walk(d);
  const luna = flat.luna ?? 0;
  const sol = flat.sol ?? 0;
  const seen = n(pick(d, "credits", "total", "seen")) ?? luna + sol;
  const both = luna + sol;
  return {
    luna,
    sol,
    lunaPct: both ? Math.round((100 * luna) / both) : null,
    solPct: both ? Math.round((100 * sol) / both) : null,
    target: { luna: 80, sol: 20 },
    seen,
    total: accountTotal,
    seenPct: accountTotal ? Math.round((100 * seen) / accountTotal) : null,
  };
}

function split(day: string) {
  if (!allowed()) return { day, error: "not read on this node (AB_SERVERS_PROBE is not 1)" };
  const r = keep(`split:${day}`, 300_000, async () => {
    const { stdout } = await run(LEDGER[0], [...LEDGER.slice(1), "split", "--day", day, "--json"], { timeout: 20_000, maxBuffer: 1 << 20, env: PATH_ENV });
    return JSON.parse(stdout);
  });
  const total = codexMoney(burnNow()).byDay[day] ?? null;
  const v = r.value as any;
  if (!v) return { day, pending: true };
  if (v.error) return { day, error: v.error };
  return { day, at: r.at, ...splitFrom(v, total) };
}

// ---------------------------------------------------------------- the VPS rollup

export type Device = { device: string; today: number | null; total: number | null; lastSeen: number | null; stale: boolean };

export function parseFleet(text: string) {
  const [devText, syncText = ""] = text.split(/\n@@ sync\n/);
  const d = JSON.parse(devText.trim() || "null");
  const list: any[] = Array.isArray(d) ? d : (d?.devices ?? []);
  const devices: Device[] = list.map((x) => {
    const lastSeen = when(pick(x, "last_seen", "lastSeen", "last_bucket", "updated_at", "last"));
    return {
      device: String(pick(x, "device", "name", "id", "device_id") ?? "?"),
      today: n(pick(x, "today", "tokens_today", "today_tokens")),
      total: n(pick(x, "total", "tokens", "total_tokens")),
      lastSeen,
      stale: !lastSeen || Date.now() - lastSeen > 24 * 3_600_000,
    };
  });
  let sync: any = null;
  try {
    const s = JSON.parse(syncText.trim() || "null");
    if (s && typeof s === "object") sync = { at: when(pick(s, "at", "last_run", "updated_at")), status: pick(s, "status", "message") ?? null };
  } catch {
    /* not JSON: no sync line */
  }
  return { devices, sync };
}

/** The rollup's devices, kept 5 min (the Servers page reads tokens today per machine from it too). */
export function fleet() {
  if (!allowed()) return { host: TOKENS_HOST, at: null, pending: false, error: "not read on this node (AB_SERVERS_PROBE is not 1)", devices: [] as Device[], sync: null };
  const r = keep("fleet", 300_000, async () => parseFleet(await onMachine(TOKENS_HOST, "curl -s -m 8 127.0.0.1:3106/tokens-api/devices; echo; echo '@@ sync'; curl -s -m 8 127.0.0.1:3106/tokens-api/sync-status; echo\n", 25_000, 1 << 20)));
  const v = r.value as any;
  return { host: TOKENS_HOST, at: r.at, pending: !v, error: v?.error ?? null, devices: (v?.devices ?? []) as Device[], sync: v?.sync ?? null };
}

export async function handleTokensMoney(req: http.IncomingMessage, res: http.ServerResponse, url: URL): Promise<boolean> {
  const p = url.pathname;
  if (p !== "/api/tokens/money" && p !== "/api/tokens/split" && p !== "/api/tokens/fleet") return false;
  if (req.method !== "GET") return json(res, 405, { error: "GET only" }), true;
  if (p === "/api/tokens/money") json(res, 200, money());
  else if (p === "/api/tokens/fleet") json(res, 200, fleet());
  else {
    const day = url.searchParams.get("day") ?? localDay();
    if (!/^\d{4}-\d\d-\d\d$/.test(day)) return json(res, 400, { error: "day is YYYY-MM-DD" }), true;
    json(res, 200, split(day));
  }
  return true;
}
