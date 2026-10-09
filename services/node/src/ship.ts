/**
 * GET /api/ship: what went live today, read from the ship queue's own log (SPEC-STATS-TASKS §3.5.1). Read-only: it folds
 * $AB_QUEUE_STATE/queue.jsonl (default ~/.local/state/agent-base/ship-queue) into one row per lane exactly as
 * `tools/ab-queue rows()` does (latest state wins, each `<state>_at` kept), adds deploy.jsonl, and never runs ab-queue.
 * "Today" is this Mac's local day, as the tokens route's `ranges` (Asia/Saigon on his Mac). Cached 15 s.
 */
import { readFileSync } from "node:fs";
import type http from "node:http";
import { homedir } from "node:os";
import path from "node:path";

export type QueueRow = { id: string; state?: string; branch?: string; by?: string; built_at?: string; queued_at?: string; live_at?: string; why?: string; [k: string]: unknown };
export type ShipLane = { id: string; branch: string; by: string; sha: string; state: string; built_at: string | null; live_at: string | null; why: string };
export type Ship = {
  at: string;
  today: {
    live: number;
    deploys: number;
    leadMin: { median: number; min: number; max: number } | null;
    waiting: number;
    conflict: number;
    failed: number;
    dropped: number;
    gaps: { from: string; to: string; held: string | null }[];
  };
  lanes: ShipLane[];
};

const stateDir = () => process.env.AB_QUEUE_STATE || path.join(homedir(), ".local/state/agent-base/ship-queue");
/** Built and not live yet: what the queue still owes (ab-queue's alarm counts these). */
const WAITING = new Set(["queued", "merged", "landed"]);
/** Two deploys further apart than this while something waited is a gap worth a sentence. */
const GAP_MIN = 45;

/** ab-queue rows(): fold the event log into one row per lane (latest state wins), sorted by when it was queued. */
export function foldQueue(text: string): QueueRow[] {
  const out = new Map<string, QueueRow>();
  for (const line of text.split("\n")) {
    let e: Record<string, unknown>;
    try {
      e = JSON.parse(line);
    } catch {
      continue;
    }
    if (!e || typeof e !== "object" || typeof e.id !== "string") continue;
    let r = out.get(e.id);
    if (!r) out.set(e.id, (r = { id: e.id }));
    for (const [k, v] of Object.entries(e)) if (k !== "at") r[k] = v;
    r[`${e.state}_at`] = e.at;
  }
  return [...out.values()].sort((a, b) => String(a.queued_at ?? "").localeCompare(String(b.queued_at ?? "")));
}

const localDay = (ms: number) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const ms = (iso: unknown) => (typeof iso === "string" ? Date.parse(iso) : NaN);
const isToday = (iso: unknown, today: string) => Number.isFinite(ms(iso)) && localDay(ms(iso)) === today;

/** Today's summary from the folded rows and deploy.jsonl's lines; `now` is injectable for the check. */
export function shipSummary(rows: QueueRow[], deployText: string, now = Date.now()): Ship {
  const today = localDay(now);
  const deploys = deployText
    .split("\n")
    .map((l) => {
      try {
        return JSON.parse(l) as { at?: string; sha?: string };
      } catch {
        return null;
      }
    })
    .filter((d): d is { at: string } => !!d && isToday(d.at, today))
    .sort((a, b) => ms(a.at) - ms(b.at));
  // A lane belongs to today when anything happened to it today, or it is still waiting to go live.
  const touched = rows.filter((r) => Object.keys(r).some((k) => k.endsWith("_at") && k !== "built_at" && isToday(r[k], today)) || WAITING.has(String(r.state)));
  const lanes: ShipLane[] = touched
    .map((r) => ({
      id: r.id,
      branch: String(r.branch ?? ""),
      by: String(r.by ?? ""),
      sha: String(r.sha ?? ""),
      state: String(r.state ?? ""),
      built_at: typeof r.built_at === "string" ? r.built_at : typeof r.queued_at === "string" ? r.queued_at : null,
      live_at: r.state === "live" && typeof r.live_at === "string" ? r.live_at : null,
      why: String(r.why ?? ""),
    }))
    .sort((a, b) => ms(a.built_at) - ms(b.built_at));
  const live = lanes.filter((l) => l.live_at && isToday(l.live_at, today));
  const leads = live.map((l) => Math.max(0, Math.round((ms(l.live_at) - ms(l.built_at)) / 60_000))).filter(Number.isFinite).sort((a, b) => a - b);
  const median = leads.length ? (leads.length % 2 ? leads[(leads.length - 1) / 2] : Math.round((leads[leads.length / 2 - 1] + leads[leads.length / 2]) / 2)) : 0;
  const endedToday = (state: string) => rows.filter((r) => r.state === state && isToday(r[`${state}_at`], today)).length;
  const gaps: Ship["today"]["gaps"] = [];
  for (let i = 1; i < deploys.length; i++) {
    const from = ms(deploys[i - 1].at), to = ms(deploys[i].at);
    if ((to - from) / 60_000 <= GAP_MIN) continue;
    // Something built before the later deploy that was not live by the earlier one waited through the gap.
    const waited = rows.filter((r) => ms(r.built_at ?? r.queued_at) < to && !(r.state === "live" && ms(r.live_at) <= from) && (r.state === "live" || WAITING.has(String(r.state))));
    if (!waited.length) continue;
    // Why it was held: the queue's own words on a lane landed in the gap ("deploy held: ...").
    const held = rows.map((r) => String(r.why ?? "")).find((w, j) => /^deploy (held|failed)/.test(w) && ms(rows[j].landed_at) >= from && ms(rows[j].landed_at) <= to) ?? null;
    gaps.push({ from: deploys[i - 1].at, to: deploys[i].at, held: held ? held.replace(/^deploy (held|failed):\s*/, "").slice(0, 160) : null });
  }
  return {
    at: new Date(now).toISOString(),
    today: {
      live: live.length,
      deploys: deploys.length,
      leadMin: leads.length ? { median, min: leads[0], max: leads[leads.length - 1] } : null,
      waiting: rows.filter((r) => WAITING.has(String(r.state))).length,
      conflict: endedToday("conflict"),
      failed: endedToday("failed"),
      dropped: endedToday("dropped"),
      gaps,
    },
    lanes,
  };
}

const read = (file: string) => {
  try {
    return readFileSync(file, "utf8");
  } catch {
    return "";
  }
};

let cached: { at: number; dir: string; body: Ship } | null = null;
export function ship(now = Date.now()): Ship {
  const dir = stateDir();
  if (cached && cached.dir === dir && now - cached.at < 15_000) return cached.body;
  const body = shipSummary(foldQueue(read(path.join(dir, "queue.jsonl"))), read(path.join(dir, "deploy.jsonl")), now);
  cached = { at: now, dir, body };
  return body;
}

export async function handleShip(req: http.IncomingMessage, res: http.ServerResponse, url: URL): Promise<boolean> {
  if (url.pathname !== "/api/ship") return false;
  if (req.method !== "GET") {
    res.writeHead(405, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "GET only" }));
    return true;
  }
  res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
  res.end(JSON.stringify(ship()));
  return true;
}
