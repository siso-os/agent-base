import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import type http from "node:http";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { codexLanes, type CodexLanes, type CodexPair } from "./codex-lanes.ts";
import { tokensBudget } from "./tokens.ts";
import type { QueueRow } from "./ship.ts";

export type Block<T> = { at: number; data: T | null; error: string | null };
export type StackLine = { level: "red" | "amber" | "green"; check: string; msg: string };
export type Renewal = { name: string; kind?: string; status: string; renews?: string | null; renews_local?: string; days_left?: number; why?: string };
export type Need = { id: string; title: string; created: string; note?: string; link?: string; project?: string };
export type PairItem = { id: string; title: string; state: "open" | "done" | "blocked"; sha: string | null };
export type NowLanes = Omit<CodexLanes, "pairs"> & { pairs: (CodexPair & { items: PairItem[] })[] };
export type ShipNow = { liveSha: string | null; queued: QueueRow[]; rows: QueueRow[] };
export type NowEvent = { id: string; at: number; state: "landed" | "live" | "done" | "blocked"; text: string; observed?: boolean };
export type Budget = { at?: number; scanning?: boolean; claude: { name: string; usedPct: number; resetsAt: number | null; limitsAt?: number | null; limitsStale?: boolean }[]; codex: { balance: number | null; balanceAt?: number | null; balanceSource?: string | null; hasCredits?: boolean | null; unlimited?: boolean | null; stale?: boolean } };
export type A0Now = { at: number; lanes: Block<NowLanes>; stack: Block<StackLine[]>; renewals: Block<Renewal[]>; needs: Block<{ total: number; items: Need[] }>; ship: Block<ShipNow>; budget: Block<Budget>; today: Block<NowEvent[]> };
const run = promisify(execFile);
const home = process.env.AB_HOME ?? os.homedir();
const repo = path.resolve(import.meta.dirname, "../../..");
const cache = new Map<string, { block?: Block<unknown>; pending?: Promise<Block<unknown>> }>();

async function source<T>(key: string, ttl: number, read: () => Promise<T>, timeout = 10_000): Promise<Block<T>> {
  let r = cache.get(key);
  if (!r) cache.set(key, (r = {}));
  if (r.block && Date.now() - r.block.at < ttl) return r.block as Block<T>;
  const reading = r;
  reading.pending ??= (async () => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const data = await Promise.race([read(), new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("timeout")), timeout); })]);
      return { at: Date.now(), data, error: null };
    } catch {
      return { at: Date.now(), data: null, error: `${key} unavailable` };
    } finally { clearTimeout(timer); }
  })().then((block) => { reading.block = block; return block; }).finally(() => { reading.pending = undefined; });
  return await reading.pending as Block<T>;
}
async function command(key: string, fallback: string) {
  const configured = process.env[`AB_A0NOW_${key}_CMD`] ?? fallback;
  const [program, ...args] = configured.trim().split(/\s+/);
  let stdout: string;
  try {
    ({ stdout } = await run(program, args, { timeout: 10_000, maxBuffer: 4 << 20, env: { ...process.env, PATH: `${process.env.PATH ?? ""}:${os.homedir()}/.local/bin` } }));
  } catch (error) {
    const failure = error as { code?: unknown; killed?: boolean; signal?: unknown; stdout?: string };
    // These health CLIs exit nonzero for red/past-due results while still emitting valid JSON.
    if (typeof failure.code !== "number" || failure.killed || failure.signal || typeof failure.stdout !== "string") throw error;
    stdout = failure.stdout;
  }
  return JSON.parse(stdout);
}

async function readLanes(): Promise<NowLanes> {
  const result = await codexLanes(process.env.AB_A0NOW_LANES_CMD);
  if ("error" in result) throw new Error(result.error);
  let registry: Record<string, { plan?: string }> = {};
  try { const value = JSON.parse(await readFile(path.join(process.env.AB_A0NOW_PAIR_STATE ?? process.env.PAIR_STATE ?? path.join(home, ".local/state/pair"), "pairs.json"), "utf8")); if (value && typeof value === "object" && !Array.isArray(value)) registry = value; } catch { /* no plans available */ }
  const pairs = await Promise.all(result.data.pairs.map(async (pair) => {
    const items: PairItem[] = [];
    const plan = registry[pair.pair]?.plan;
    if (typeof plan === "string") {
      try {
        for (const line of (await readFile(plan, "utf8")).split("\n")) {
          const m = /^- \[([ x!])\] (P\d+) (.+)/.exec(line);
          if (m) items.push({ id: m[2], title: m[3].split(" | ")[0], state: m[1] === "x" ? "done" : m[1] === "!" ? "blocked" : "open", sha: line.match(/\b[0-9a-f]{7,40}\b/)?.[0] ?? null });
        }
      } catch { /* summaries remain usable when the plan cannot be read */ }
    }
    return { ...pair, items };
  }));
  return { ...result.data, pairs };
}
async function needs() {
  const raw = process.env.AB_A0NOW_NEEDS_CMD ? await command("NEEDS", "") : JSON.parse(await readFile(process.env.AB_A0NOW_NEEDS_FILE ?? path.join(home, "SISO_Workspace/SISO_Agents/agent-zero/siso-agent-zero/.agents/a0/tasks.json"), "utf8"));
  if (!raw || !Array.isArray(raw.tasks)) throw new Error("Invalid needs");
  const now = Date.now();
  const items = raw.tasks.filter((t: any) => t && t.status === "needs-shaan" && typeof t.id === "string" && typeof t.title === "string" && typeof t.created === "string" && Date.parse(t.created) <= now && Date.parse(t.created) >= now - 48 * 3_600_000).sort((a: Need, b: Need) => Date.parse(b.created) - Date.parse(a.created));
  return { total: items.length, items: items.slice(0, 3).map((t: any) => ({ id: t.id, title: t.title, created: t.created, ...Object.fromEntries(["note", "link", "project"].filter((key) => typeof t[key] === "string").map((key) => [key, t[key]])) })) };
}
async function ship(): Promise<ShipNow> {
  const raw = await command("SHIP", `python3 ${path.join(repo, "tools/ab-queue")} status --json`);
  const rows = Array.isArray(raw) ? raw : raw?.rows;
  if (!Array.isArray(rows) || !rows.every((row: any) => row && typeof row.id === "string" && ["state", "branch", "by", "why", "sha", "live_sha"].every((key) => row[key] == null || typeof row[key] === "string"))) throw new Error("Invalid ship rows");
  let liveSha: string | null = typeof raw?.liveSha === "string" ? raw.liveSha : null;
  if (!liveSha) try { const live = (await readFile(process.env.AB_A0NOW_LIVE_FILE ?? path.join(repo, "LIVE"), "utf8")).trim(); if (/^[a-f0-9]{7,40}$/.test(live)) liveSha = live; } catch { /* never substitute checkout HEAD */ }
  return { liveSha, rows, queued: rows.filter((r: QueueRow) => ["queued", "merged", "landed"].includes(r.state ?? "")) };
}
const observed = new Map<string, string>();
let observedEvents: NowEvent[] = [];
function today(ship: ShipNow | null, lanes: NowLanes | null): NowEvent[] {
  const now = Date.now(), start = new Date(now).setHours(0, 0, 0, 0);
  const events: NowEvent[] = [];
  for (const row of ship?.rows ?? []) for (const state of ["landed", "live", "done", "blocked"] as const) {
    const at = Date.parse(String(row[`${state}_at`] ?? ""));
    if (at >= start && at <= now) events.push({ id: `ship:${row.id}:${state}`, at, state, text: `${row.branch ?? row.id} ${state}${row.why ? ` · ${row.why}` : ""}` });
  }
  for (const run of lanes?.runs ?? []) if (run.status === "done" || run.status === "blocked") {
    let at = Date.parse(run.at);
    const hhmm = /^(\d{2}):(\d{2})$/.exec(run.at);
    if (hhmm) { const d = new Date(now); d.setHours(Number(hhmm[1]), Number(hhmm[2]), 0, 0); if (d.getTime() > now) d.setDate(d.getDate() - 1); at = d.getTime(); }
    if (at >= start && at <= now) events.push({ id: `run:${run.at}:${run.dir}:${run.task}`, at, state: run.status, text: `${run.task || run.dir} ${run.status}` });
  }
  const track = (id: string, state: string, text: string) => {
    const prior = observed.get(id); observed.set(id, state);
    if (prior !== undefined && state !== prior && (state === "done" || state === "blocked")) observedEvents.push({ id: `${id}:${state}:${now}`, at: now, state, text, observed: true });
  };
  for (const tab of lanes?.tabs ?? []) track(`tab:${tab.pane}`, tab.status, `${tab.tab} ${tab.status}`);
  for (const pair of lanes?.pairs ?? []) for (const item of pair.items) track(`pair:${pair.pair}:${item.id}`, item.state, `${pair.pair} ${item.id} ${item.state}`);
  observedEvents = observedEvents.filter((e) => e.at >= start).slice(-12);
  return [...events, ...observedEvents].sort((a, b) => b.at - a.at).slice(0, 12);
}

export async function a0Now(): Promise<A0Now> {
  const [lanes, stack, renewals, needsBlock, shipBlock, budget] = await Promise.all([
    source("lanes", 10_000, readLanes),
    source("stack", 60_000, async () => { const rows = await command("STACK", "stack-doctor --json"); if (!Array.isArray(rows) || !rows.every((r: any) => r && ["red", "amber", "green"].includes(r.level) && typeof r.check === "string" && typeof r.msg === "string")) throw new Error("Invalid stack"); return rows as StackLine[]; }),
    source("renewals", 600_000, async () => { const rows = await command("RENEWALS", "renewals --json"); if (!Array.isArray(rows) || !rows.every((r: any) => r && typeof r.name === "string" && typeof r.status === "string" && (r.days_left == null || Number.isFinite(r.days_left)) && ["kind", "renews", "renews_local", "why"].every((key) => r[key] == null || typeof r[key] === "string"))) throw new Error("Invalid renewals"); return rows as Renewal[]; }),
    source("needs", 10_000, needs, 3000), source("ship", 10_000, ship),
    source("budget", 60_000, async () => { const data = process.env.AB_A0NOW_BUDGET_CMD ? await command("BUDGET", "") : await tokensBudget(); if (!data || !Array.isArray(data.claude) || !data.claude.every((c: any) => c && typeof c.name === "string" && Number.isFinite(c.usedPct) && (c.resetsAt == null || Number.isFinite(c.resetsAt))) || !data.codex || (data.codex.balance != null && !Number.isFinite(data.codex.balance))) throw new Error("Invalid budget"); return data as Budget; }),
  ]);
  return { at: Date.now(), lanes, stack, renewals, needs: needsBlock, ship: shipBlock, budget, today: { at: Date.now(), data: today(shipBlock.data, lanes.data), error: null } };
}
export async function handleA0Now(req: http.IncomingMessage, res: http.ServerResponse, url: URL): Promise<boolean> {
  if (url.pathname !== "/api/a0/now") return false;
  if (req.method !== "GET") { res.writeHead(405, { "content-type": "application/json", allow: "GET" }); res.end(JSON.stringify({ error: "GET only" })); return true; }
  res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
  res.end(JSON.stringify(await a0Now())); return true;
}
