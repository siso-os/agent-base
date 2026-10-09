/** Thin local adapter for STACK-OPT spend attribution. Never calculates spend values here. */
import { execFile } from "node:child_process";
import type http from "node:http";
import { promisify } from "node:util";

const run = promisify(execFile);
const DEFAULT_COMMAND = "spend-report --json";
const CACHE_MS = 60_000;
/** t-0586 (A0, 9 Oct 23:45): one report is ~7 s of a full core on the laptop; run every minute it was most of the node's
 * idle CPU. The per-project split now refreshes every 5 min at low priority; today's figure still refreshes each minute. */
const REPORT_MS = 5 * 60_000;
/** `today` (A0, 3 Oct: three different "today $" figures at once): the one figure every surface shows, from the Tokens scan. */
type Report = { day: string; [key: string]: unknown };
type Failure = "unavailable" | "timeout" | "malformed" | "schema";
type SpendResponse = ({ source: "pending" } | { source: "stack-opt"; data: Report }) & {
  attribution: { state: "fresh" | "stale" | "unavailable"; source: "stack-opt"; scope: "report-day"; observedAt: number | null; attemptedAt: number; day: string | null; reason: Failure | "day-mismatch" | null };
  today?: { usd: number; from: "tokens"; day: string; observedAt: number };
};
/** server.ts registers the Tokens scan's today (null until it has seen usage today); STACK-OPT's report stays the per-project split. */
let todayCost: () => Promise<number | null> = async () => null;
export const setTodayCost = (fn: () => Promise<number | null>) => { todayCost = fn; };

const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const credits = (v: unknown): v is [number, number] => Array.isArray(v) && v.length === 2 && v.every(finite);
const plain = (v: unknown): v is Record<string, unknown> => Boolean(v && typeof v === "object" && !Array.isArray(v));
/** Only accept the shape dereferenced by SpendPanel; malformed command output never replaces the last valid report. */
function validReport(v: unknown): v is Report {
  if (!v || typeof v !== "object") return false;
  const d = v as Record<string, unknown>;
  if (typeof d.day !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(d.day) || !Number.isFinite(Date.parse(`${d.day}T12:00:00Z`)) || new Date(`${d.day}T12:00:00Z`).toISOString().slice(0, 10) !== d.day || !finite(d.claude_usd_equiv) || !credits(d.codex_credits) || !finite(d.attributed_to_plan_items)) return false;
  if (!Array.isArray(d.projects) || !Array.isArray(d.plan_items)) return false;
  if (!d.plan_items.every((item) => plain(item) && typeof item.id === "string" && typeof item.title === "string" && (item.plan === null || typeof item.plan === "string") && finite(item.claude_usd_equiv))) return false;
  return d.projects.every((p) => {
    if (!plain(p)) return false;
    const project = p as Record<string, unknown>;
    return typeof project.project === "string" && finite(project.claude_usd_equiv) && credits(project.codex_credits)
      && Array.isArray(project.owners) && project.owners.every((o) => {
        if (!plain(o)) return false;
        const owner = o as Record<string, unknown>;
        return typeof owner.owner === "string" && finite(owner.claude_usd_equiv) && credits(owner.codex_credits)
          && Array.isArray(owner.agents) && owner.agents.every((a) => {
            if (!plain(a)) return false;
            const agent = a as Record<string, unknown>;
            return typeof agent.agent === "string" && finite(agent.claude_usd_equiv) && credits(agent.codex_credits) && plain(agent.items) && Object.values(agent.items).every(finite);
          });
      });
  });
}

async function readSpend(): Promise<string> {
  const configured = process.env.AB_SPEND_CMD ?? DEFAULT_COMMAND;
  const [command, ...args] = configured.trim().split(/\s+/).filter(Boolean);
  if (!command) throw new Error("unavailable");
  const commandArgs = args.includes("--json") || args.length ? args : [...args, "--json"];
  const { stdout } = await run("nice", ["-n", "15", command, ...commandArgs], {
    // The answer no longer waits for this, so a slow report under load may finish instead of timing out every time.
    timeout: 30_000,
    maxBuffer: 4 << 20,
    env: { ...process.env, PATH: `${process.env.PATH ?? ""}:${process.env.HOME ?? ""}/.local/bin` },
  });
  return stdout;
}

const dayOf = (t: number) => { const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };

/**
 * Dependencies let synthetic checks exercise refreshes without invoking a report or usage scanner.
 * t-0570 ("Today Unknown", 9 Oct 02:10): the answer used to wait for the whole `spend-report` run (6 s at a light load on
 * the laptop, its 10 s timeout under a heavy one) before reading today's Tokens figure. The app's fetch gives up after 10 s
 * and then drops `today` on purpose, and the node's 60 s cache expired between the app's 60 s polls, so every poll waited
 * again: the chip read Unknown. Now a report still running after `wait` ms leaves the answer to the last report (marked
 * by its own state), today's figure is read at once, and the finished report replaces the cache when it lands.
 */
export function createSpendReader({ read = readSpend, today = () => todayCost(), now = Date.now, wait = 2_000, reportMs = REPORT_MS } = {}) {
  let cached: { at: number; body: SpendResponse } | null = null;
  let lastGood: { data: Report; at: number } | null = null;
  let last: { started: number; reason: Failure | null } | null = null;
  let report: Promise<void> | null = null;
  let pending: Promise<SpendResponse> | null = null;
  const readReport = (started: number) => report ??= (async () => {
    let reason: Failure | null = null;
    try {
      const raw = await read();
      let data: unknown;
      try { data = JSON.parse(raw); } catch { reason = "malformed"; }
      if (!reason) {
        if (validReport(data)) lastGood = { data, at: now() };
        else reason = "schema";
      }
    } catch (error) {
      reason = plain(error) && (error.killed === true || error.code === "ETIMEDOUT") ? "timeout" : "unavailable";
    }
    last = { started, reason };
  })().finally(() => { report = null; cached = null; });
  async function refresh(): Promise<SpendResponse> {
    const started = now();
    // A report started less than reportMs ago (the same day) is reused; one already running is joined, never doubled.
    // A failed one is retried after a minute.
    const due = !last || started < last.started || started - last.started >= (last.reason ? CACHE_MS : reportMs) || dayOf(last.started) !== dayOf(started);
    const running = report ?? (due ? readReport(started) : null);
    if (running) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      await Promise.race([running, new Promise<void>((resolve) => { timer = setTimeout(resolve, wait); })]);
      clearTimeout(timer);
    }
    const todayStarted = now();
    const usd = await today().catch(() => null);
    const at = now();
    const reason = last?.reason ?? null;
    const body: SpendResponse = {
      ...(lastGood ? { source: "stack-opt" as const, data: lastGood.data } : { source: "pending" as const }),
      attribution: { source: "stack-opt", scope: "report-day", state: !lastGood ? "unavailable" : reason || lastGood.data.day !== dayOf(at) ? "stale" : "fresh", observedAt: lastGood?.at ?? null, attemptedAt: last?.started ?? started, day: lastGood?.data.day ?? null, reason: reason ?? (lastGood && lastGood.data.day !== dayOf(at) ? "day-mismatch" : null) },
    };
    // A scan spanning midnight cannot safely be assigned to either day's counter.
    if (finite(usd) && dayOf(todayStarted) === dayOf(at)) body.today = { usd, from: "tokens", day: dayOf(at), observedAt: at };
    // A report still running answers again as soon as it lands (readReport clears the cache).
    if (!report) cached = { at: started, body };
    return body;
  }
  return async (): Promise<SpendResponse> => {
    const at = now();
    if (cached && at >= cached.at && at - cached.at < CACHE_MS && dayOf(cached.at) === dayOf(at)) return cached.body;
    pending ??= refresh().finally(() => { pending = null; });
    return pending;
  };
}
const readReport = createSpendReader();
/** Legacy dashboard callers have no freshness field; never let them label retained attribution as today's spend. */
export async function spend(): Promise<SpendResponse | null> {
  const report = await readReport();
  return report.attribution.state === "fresh" ? report : null;
}

export async function handleSpend(req: http.IncomingMessage, res: http.ServerResponse, url: URL): Promise<boolean> {
  if (url.pathname !== "/api/spend") return false;
  if (req.method !== "GET") {
    res.writeHead(405, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "GET only" }));
    return true;
  }
  res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
  res.end(JSON.stringify(await readReport()));
  return true;
}
