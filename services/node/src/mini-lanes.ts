/**
 * Mac mini lanes (mini-lanes, Shaan via A0 3 Oct 14:20): the Codex lanes running on the Mac mini, for the "Mac mini"
 * group under SISO Labs in the side nav and a page per lane.
 *
 *   GET /api/mini/lanes         every lane: name, model (Sol/Luna), its one-line goal, last commit time, running or stopped
 *   GET /api/mini/lanes/:name   one lane: the same, its recent commits and the last ~40 lines of its tmux pane
 *
 * Where it comes from: ssh to the mini (`mac-mini-ts`), and only these read commands, ever (READS below):
 *   tmux ls                                         which lane sessions are running
 *   tmux capture-pane -p -t <session> -S -40        a running lane's last lines (its page only)
 *   cat <AB_MINI_DIR>/lanes.tsv, …/qa-lanes.tsv     the lanes: their columns are read from the header row
 * Nothing is ever sent to a pane and nothing else runs there. A session name reaches the remote shell only when it is in
 * the last `tmux ls` and is plain ([A-Za-z0-9_.-]).
 *
 * SAFETY: every ssh call is gated on AB_MINI_LANES=1, which the desktop app's node launch sets (apps/desktop/src/lib.rs)
 * and no test does with the real ssh. Without it both endpoints answer `enabled: false, note: "not enabled"` with no
 * lanes and no ssh call. AB_MINI_SSH replaces the ssh command (tests: a fake that prints fixtures and logs each call).
 * Answers are kept 30 s (AB_MINI_CACHE_MS); one read runs at a time. When ssh fails the answer says "mini unreachable"
 * and keeps the last lanes it read, marked by `reachable: false`.
 */
import { execFile } from "node:child_process";
import type http from "node:http";

const ENABLED = process.env.AB_MINI_LANES === "1";
const SSH = (process.env.AB_MINI_SSH || "ssh").split(" ").filter(Boolean);
const HOST = "mac-mini-ts";
const SSH_OPTS = ["-o", "RemoteCommand=none", "-o", "RequestTTY=no", "-o", "ConnectTimeout=8"];
/** The overnight lanes' folder on the mini, relative to its home (ssh starts there). */
const DIR = (process.env.AB_MINI_DIR || "SISO_Workspace/_data/overnight-2026-10-03").replace(/^~\//, "");
const CACHE_MS = Math.max(1000, Number(process.env.AB_MINI_CACHE_MS) || 30_000);
const PANE_LINES = 40;
const PLAIN = /^[A-Za-z0-9_.-]+$/;

export type MiniLane = {
  name: string;
  /** "Sol" or "Luna" when the row says either; the row's own word otherwise; null when it has none. */
  model: string | null;
  goal: string;
  /** ms; null when the row does not carry it. */
  lastCommitAt: number | null;
  running: boolean;
  /** The tmux session the lane runs in. */
  session: string;
  /** Which file listed it. */
  source: "lanes" | "qa";
  commits: MiniCommit[];
};
export type MiniCommit = { sha: string; subject: string; at: number | null };
type ListAnswer = { enabled: boolean; reachable: boolean; note: string | null; at: number; lanes: Omit<MiniLane, "commits">[] };

// ---------------------------------------------------------------- the only commands that reach the mini

const READS = {
  ls: () => ["tmux", "ls"],
  pane: (session: string) => ["tmux", "capture-pane", "-p", "-t", session, "-S", `-${PANE_LINES}`],
  lanes: () => ["cat", `${DIR}/lanes.tsv`],
  qa: () => ["cat", `${DIR}/qa-lanes.tsv`],
} as const;

type Out = { ok: true; code: number; out: string } | { ok: false };
/** One read on the mini. `ok: false` is ssh itself failing (no route, timeout, exit 255): the mini is unreachable. */
function read(remote: string[]): Promise<Out> {
  if (!ENABLED) return Promise.resolve({ ok: false });
  if (remote.some((a) => !/^[A-Za-z0-9_.\/=-]+$/.test(a))) return Promise.resolve({ ok: false });
  return new Promise((resolve) => {
    execFile(SSH[0], [...SSH.slice(1), ...SSH_OPTS, HOST, ...remote], { timeout: 15_000, maxBuffer: 1 << 20 }, (err, stdout) => {
      const code = err ? (typeof (err as any).code === "number" ? (err as any).code : -1) : 0;
      if (code === 255 || code === -1 || (err as any)?.killed) return resolve({ ok: false });
      resolve({ ok: true, code, out: String(stdout) });
    });
  });
}

// ---------------------------------------------------------------- parsing

/** `tmux ls`: "name: 1 windows (created …)" per line. */
export function parseSessions(out: string): string[] {
  return out
    .split("\n")
    .map((l) => l.match(/^([^:\s][^:]*):\s/)?.[1] ?? "")
    .filter(Boolean);
}

const COLS: Record<string, string[]> = {
  name: ["name", "lane", "id"],
  session: ["session", "tmux", "tmux_session"],
  model: ["model", "engine", "harness"],
  goal: ["goal", "task", "brief", "what", "title"],
  commitAt: ["last_commit_at", "commit_at", "committed_at", "last_commit_time", "commit_time"],
  commits: ["commits", "recent_commits"],
  lastCommit: ["last_commit", "commit", "head"],
};
const colOf = (header: string[], key: string) => header.findIndex((h) => COLS[key].includes(h));

const when = (v: string): number | null => {
  const s = v.trim();
  if (!s) return null;
  if (/^\d{9,10}$/.test(s)) return Number(s) * 1000;
  if (/^\d{12,13}$/.test(s)) return Number(s);
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : null;
};
export const modelWord = (v: string): string | null => {
  const s = v.trim();
  if (!s) return null;
  if (/sol/i.test(s)) return "Sol";
  if (/luna/i.test(s)) return "Luna";
  return s;
};
/** "sha subject" or "sha<TAB-free>@iso subject"; commits are separated by ";" or "|". */
const commitOf = (v: string): MiniCommit | null => {
  const m = v.trim().match(/^([0-9a-f]{6,40})(?:@(\S+))?\s+(.*)$/i);
  return m ? { sha: m[1].slice(0, 9), at: m[2] ? when(m[2]) : null, subject: m[3].trim() } : null;
};

/**
 * A lanes file: tab separated, one lane a line, '#' lines are notes. The first line is the header when it names a
 * column we know (name/lane, model, goal…); a header may start with "# ". With no header the columns are taken as
 * name, model, goal.
 */
export function parseLanes(text: string, source: MiniLane["source"]): Omit<MiniLane, "running">[] {
  const lines = text.split("\n").map((l) => l.replace(/\r$/, "")).filter((l) => l.trim());
  if (!lines.length) return [];
  const head = lines[0].replace(/^#\s*/, "").split("\t").map((h) => h.trim().toLowerCase().replace(/[\s-]+/g, "_"));
  const hasHeader = colOf(head, "name") >= 0 || colOf(head, "goal") >= 0 || colOf(head, "model") >= 0;
  const header = hasHeader ? head : ["name", "model", "goal"];
  const rows = (hasHeader ? lines.slice(1) : lines).filter((l) => !l.startsWith("#"));
  const at = (cells: string[], key: string) => {
    const i = colOf(header, key);
    return i >= 0 ? (cells[i] ?? "").trim() : "";
  };
  const out: Omit<MiniLane, "running">[] = [];
  for (const l of rows) {
    const cells = l.split("\t");
    const name = at(cells, "name") || at(cells, "session");
    if (!name) continue;
    const commits = at(cells, "commits")
      .split(/[;|]/)
      .map(commitOf)
      .filter((c): c is MiniCommit => !!c);
    const last = commitOf(at(cells, "lastCommit"));
    if (last && !commits.some((c) => c.sha === last.sha)) commits.unshift(last);
    const commitAt = when(at(cells, "commitAt")) ?? commits.find((c) => c.at !== null)?.at ?? null;
    if (commits[0] && commits[0].at === null && commitAt !== null) commits[0] = { ...commits[0], at: commitAt };
    out.push({
      name,
      session: at(cells, "session") || name,
      model: modelWord(at(cells, "model")),
      goal: at(cells, "goal").replace(/\s+/g, " "),
      lastCommitAt: commitAt,
      source,
      commits,
    });
  }
  return out;
}

// ---------------------------------------------------------------- the kept answers

let kept: { at: number; reachable: boolean; lanes: MiniLane[] } | null = null;
let reading: Promise<void> | null = null;

async function readList(): Promise<void> {
  const [ls, lanes, qa] = [await read(READS.ls()), await read(READS.lanes()), await read(READS.qa())];
  if (!ls.ok || !lanes.ok || !qa.ok) {
    kept = { at: Date.now(), reachable: false, lanes: (kept?.lanes ?? []).map((l) => ({ ...l, running: false })) };
    return;
  }
  // tmux ls exits 1 with no server running: no lane runs. A missing file lists nothing.
  const running = new Set(ls.code === 0 ? parseSessions(ls.out) : []);
  const seen = new Set<string>();
  const all = [...parseLanes(lanes.code === 0 ? lanes.out : "", "lanes"), ...parseLanes(qa.code === 0 ? qa.out : "", "qa")]
    .filter((l) => !seen.has(l.name) && (seen.add(l.name), true))
    .map((l) => ({ ...l, running: running.has(l.session) }));
  kept = { at: Date.now(), reachable: true, lanes: all };
}

async function fresh(): Promise<NonNullable<typeof kept>> {
  if (!kept || Date.now() - kept.at >= CACHE_MS) {
    reading ??= readList().finally(() => (reading = null));
    await reading;
  }
  return kept!;
}

const panes = new Map<string, { at: number; text: string | null; reachable: boolean }>();
async function pane(session: string): Promise<{ text: string | null; reachable: boolean }> {
  const hit = panes.get(session);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit;
  const r = await read(READS.pane(session));
  const text = r.ok && r.code === 0 ? r.out.replace(/\s+$/, "").split("\n").slice(-PANE_LINES).join("\n") : null;
  const got = { at: Date.now(), text, reachable: r.ok };
  panes.set(session, got);
  return got;
}

// ---------------------------------------------------------------- routes

function json(res: http.ServerResponse, code: number, body: unknown) {
  res.writeHead(code, { "content-type": "application/json", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
}
const UNREACHABLE = "mini unreachable";
const brief = ({ commits: _c, ...l }: MiniLane) => l;

export async function handleMiniLanes(req: http.IncomingMessage, res: http.ServerResponse, url: URL): Promise<boolean> {
  if (url.pathname !== "/api/mini/lanes" && !url.pathname.startsWith("/api/mini/lanes/")) return false;
  if (req.method !== "GET") return json(res, 405, { error: "GET only" }), true;
  const one = url.pathname.startsWith("/api/mini/lanes/") ? decodeURIComponent(url.pathname.slice("/api/mini/lanes/".length)) : null;
  if (!ENABLED) {
    const off = { enabled: false, reachable: false, note: "not enabled", at: Date.now() };
    return json(res, 200, one === null ? { ...off, lanes: [] } : { ...off, lane: null, commits: [], pane: null }), true;
  }
  const k = await fresh();
  const note = k.reachable ? null : UNREACHABLE;
  if (one === null) {
    const body: ListAnswer = { enabled: true, reachable: k.reachable, note, at: k.at, lanes: k.lanes.map(brief) };
    return json(res, 200, body), true;
  }
  const lane = k.lanes.find((l) => l.name === one);
  if (!lane) return json(res, k.reachable ? 404 : 200, { enabled: true, reachable: k.reachable, note: note ?? `no lane "${one}" on the mini`, at: k.at, lane: null, commits: [], pane: null }), true;
  const p = k.reachable && lane.running && PLAIN.test(lane.session) ? await pane(lane.session) : { text: null, reachable: k.reachable };
  json(res, 200, {
    enabled: true,
    reachable: k.reachable && p.reachable,
    note: !k.reachable || !p.reachable ? UNREACHABLE : lane.running ? null : "stopped",
    at: k.at,
    lane: brief(lane),
    commits: lane.commits,
    pane: p.text,
  });
  return true;
}
