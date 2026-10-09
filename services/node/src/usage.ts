/** Thin local adapter for STACK-OPT's burn-rate and spend-ledger commands. Never calculates burn values here. */
import { execFile } from "node:child_process";
import type http from "node:http";
const DEFAULT_COMMAND = "burn-rate --json";
const CACHE_MS = process.env.NODE_ENV === "test" ? Number(process.env.AB_USAGE_CACHE_MS ?? 5 * 60_000) : 5 * 60_000;
const COMMAND_MS = process.env.NODE_ENV === "test" ? Number(process.env.AB_USAGE_COMMAND_MS ?? 30_000) : 30_000;
type Burn = { source: string; data?: unknown };
type Reading = Burn & { status: "ready" | "pending" | "unavailable"; at: number | null; stale: boolean; refreshing: boolean; attemptedAt: number | null; reason?: string };

// The desktop app starts the node with launchd's short PATH; burn-rate and spend-ledger live in ~/.local/bin.
const runJson = (command: string, args: string[]): Promise<unknown> => new Promise((resolve, reject) => {
  const child = execFile(command, args, { maxBuffer: 1 << 20, env: { ...process.env, PATH: `${process.env.PATH ?? ""}:${process.env.HOME ?? ""}/.local/bin` } }, (error, stdout) => {
    clearTimeout(timer);
    if (error) return reject(new Error("Usage source unavailable"));
    try { resolve(JSON.parse(stdout)); } catch { reject(new Error("Invalid usage reading")); }
  });
  // A child or an inherited output pipe must not leave a refresh pending forever.
  const timer = setTimeout(() => {
    child.kill("SIGKILL"); child.stdout?.destroy(); child.stderr?.destroy();
    reject(new Error("Usage source timed out"));
  }, COMMAND_MS);
});

/** Yesterday on this Mac's clock (YYYY-MM-DD), the day spend-ledger's --day takes. */
const yesterday = () => {
  const d = new Date(Date.now() - 86_400_000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

/**
 * Codex's Sol/Luna split (SPEC-STATS-TASKS §3.5.2): STACK-OPT's `spend-ledger split --json` for today and `--day
 * <yesterday>`, attached as-is beside the burn values. Either side is null when the command fails. AB_SPLIT_CMD=none skips it.
 */
async function readSplit(): Promise<{ today: unknown; yesterday: unknown } | null> {
  const configured = process.env.AB_SPLIT_CMD ?? "spend-ledger split --json";
  const [command, ...args] = configured.trim().split(/\s+/).filter(Boolean);
  if (!command || command === "none") return null;
  const one = (extra: string[]) => runJson(command, [...args.filter((a) => a !== "--json"), ...extra, "--json"]).catch(() => null);
  const [today, before] = await Promise.all([one([]), one(["--day", yesterday()])]);
  return { today, yesterday: before };
}

const finiteOrNull = (v: unknown) => v == null || (typeof v === "number" && Number.isFinite(v));
const timeOrNull = (v: unknown) => v == null || typeof v === "string" || (typeof v === "number" && Number.isFinite(v));
function validBurn(data: unknown): boolean {
  if (!data || typeof data !== "object") return false;
  const d = data as Record<string, unknown>;
  if ((d.window_min != null && !Number.isFinite(d.window_min)) || !Array.isArray(d.claude) || !d.codex || typeof d.codex !== "object") return false;
  const window = (v: unknown) => v && typeof v === "object" && timeOrNull((v as any).resets_at) && finiteOrNull((v as any).pct_per_hour) && finiteOrNull((v as any).hours_to_full) && ((v as any).stale == null || typeof (v as any).stale === "boolean");
  if (!d.claude.every((a: any) => a && typeof a.login === "string" && window(a.five_hour) && window(a.seven_day))) return false;
  const c = d.codex as any;
  const range = (v: unknown) => v == null || (Array.isArray(v) && v.length === 2 && v.every(Number.isFinite));
  return range(c.credits_per_hour) && range(c.left) && finiteOrNull(c.hours_left_at_rate);
}

async function readBurn(): Promise<Burn> {
  const configured = process.env.AB_BURN_CMD ?? DEFAULT_COMMAND;
  const [command, ...args] = configured.trim().split(/\s+/).filter(Boolean);
  if (!command) return { source: "pending" };
  try {
    const [data, split] = await Promise.all([runJson(command, args.length ? args : ["--json"]), readSplit()]);
    return validBurn(data) ? { source: "stack-opt", data: split ? { ...(data as Record<string, unknown>), split } : data } : { source: "pending" };
  } catch {
    return { source: "pending" };
  }
}

/** One refresh at a time. Every HTTP read returns immediately, including the first cold read. */
export function createUsageReader(read: () => Promise<Burn> = readBurn, now = Date.now, cacheMs = CACHE_MS) {
  let cached: { at: number; body: Burn } | null = null;
  let pending = false, failed = false, triedAt: number | null = null;
  return (): Reading => {
    const at = now(), old = !cached || at - cached.at >= cacheMs;
    if (old && !pending && (triedAt === null || at - triedAt >= cacheMs)) {
      triedAt = at; pending = true;
      void Promise.resolve().then(read).then(body => {
        failed = body.source !== "stack-opt";
        if (!failed) cached = { at: now(), body };
      }, () => { failed = true; }).finally(() => { pending = false; });
    }
    if (cached) return { ...cached.body, status: "ready", at: cached.at, stale: old || failed, refreshing: pending, attemptedAt: triedAt, ...(failed ? { reason: "Latest burn reading unavailable; showing the previous reading" } : {}) };
    return { source: "pending", status: pending ? "pending" : "unavailable", at: null, stale: true, refreshing: pending, attemptedAt: triedAt, reason: pending ? "Waiting for the burn source" : "Burn source unavailable" };
  };
}
const usage = createUsageReader();

/** Cached source state, including a failed refresh; its read time is not the sample time. */
export function burnReading(): Reading {
  return usage();
}

/** The last burn-rate reading without waiting (tokens-money.ts reads its grants and Codex balance); starts one when due. */
export function burnNow(): any {
  return usage().data ?? null;
}

export async function handleUsage(req: http.IncomingMessage, res: http.ServerResponse, url: URL): Promise<boolean> {
  if (url.pathname !== "/api/usage") return false;
  if (req.method !== "GET") {
    res.writeHead(405, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "GET only" }));
    return true;
  }
  res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
  res.end(JSON.stringify(usage()));
  return true;
}
