import { closeSync, openSync, readFileSync, readSync, readdirSync, statSync, realpathSync } from "node:fs";
import { open } from "node:fs/promises";
import { setImmediate as yieldIO } from "node:timers/promises";
import path from "node:path";
import { homedir } from "node:os";
import { execFile } from "node:child_process";
import { StringDecoder } from "node:string_decoder";
import { noteSoon, notesFile, readNotes, type Note } from "./releases.ts";

/**
 * t-0106 / R1.10 as the right panel's Timeline (rightpanel SPEC §2.6; Shaan 16:06: "a timeline in the right hand side and
 * I can scroll through it and see what sub-agents were spawned, what came back, what did they do"). Ported from the hub
 * design's collect.py a0_timeline(): read from the agent's own Claude session file, his messages, its replies, sub-agents
 * spawned and returned, tool steps grouped, background events folded into ticks. His lines that look like they hold a
 * secret are dropped whole (he has typed passwords to A0). Read incrementally: only the bytes added since the last read.
 */
export type TimelineEv =
  | { k: "you" | "reply" | "back"; t: string; text: string }
  | { k: "spawn"; t: string; text: string; model: string; id: string }
  | { k: "tools"; t: string; n: number; what: string[] }
  | { k: "ticks"; t: string; n: number }
  | { k: "task"; t: string; id: string; stage: string; text: string };

/** collect.py's SECRETISH: anything password-, key- or token-shaped, an email, or a long opaque string. */
export const SECRETISH = /pass(word)?|secret|api[_ -]?key|token[:=]|sk-|bearer|@\w+\.\w+|[A-Za-z0-9_-]{28,}/i;

type Cursor = { file: string; dev: number; ino: number; mtimeMs: number; size: number; offset: number; carry: Buffer; ev: TimelineEv[] };
const cursors = new Map<string, Cursor>();

function push(ev: TimelineEv[], x: TimelineEv) {
  const last = ev[ev.length - 1];
  if (x.k === "ticks" && last?.k === "ticks") last.n += 1;
  else if (x.k === "tools" && last?.k === "tools") {
    last.n += x.n;
    for (const w of x.what) if (last.what.length < 4) last.what.push(w);
  } else ev.push(x);
}

/** One session-file line's events (exported for the unit test). */
export function lineEvents(rec: any): TimelineEv[] {
  const out: TimelineEv[] = [];
  const t = rec?.timestamp;
  if (typeof t !== "string") return out;
  const c = rec.message?.content;
  if (rec.type === "user") {
    const txt = typeof c === "string" ? c.trim() : Array.isArray(c) ? c.filter((b: any) => b?.type === "text").map((b: any) => String(b.text ?? "")).join("\n").trim() : "";
    if (!txt) return out;
    const summary = /<summary>([\s\S]*?)<\/summary>/.exec(txt);
    if (txt.includes("<task-notification>") && summary && !summary[1].startsWith("Monitor")) out.push({ k: "back", t, text: summary[1].slice(0, 140) });
    else if (txt.startsWith("<") || txt.slice(0, 200).includes("Monitor event") || txt.startsWith("Stop hook feedback")) out.push({ k: "ticks", t, n: 1 });
    else if (txt.startsWith("[Image")) out.push({ k: "you", t, text: "(a screenshot)" });
    else if (!rec.isSidechain && !SECRETISH.test(txt)) out.push({ k: "you", t, text: txt.slice(0, 12000) });
    return out;
  }
  if (rec.type !== "assistant" || !Array.isArray(c) || rec.isSidechain) return out;
  for (const b of c) {
    if (b?.type === "text" && String(b.text ?? "").trim()) out.push({ k: "reply", t, text: String(b.text).trim().split(/\r?\n/, 1)[0].slice(0, 160) });
    else if (b?.type === "tool_use") {
      const inp = b.input ?? {};
      if (b.name === "Agent" || b.name === "Task") out.push({ k: "spawn", t, text: String(inp.description ?? "sub-agent").slice(0, 140), model: String(inp.model ?? inp.subagent_type ?? ""), id: String(b.id ?? "") });
      else out.push({ k: "tools", t, n: 1, what: inp.description ? [String(inp.description).slice(0, 70)] : [] });
    }
  }
  return out;
}

/** The agent's timeline since `since` (ISO), newest first, at most `keep` rows. */
const reads = new Map<string, Promise<void>>();
export async function timelineOf(file: string | null, since: string, keep = 200): Promise<TimelineEv[]> {
  if (!file) return [];
  let pending = reads.get(file);
  if (!pending) { pending = readTimeline(file).finally(() => reads.delete(file)); reads.set(file, pending); }
  await pending;
  const from = Date.parse(since);
  return (cursors.get(file)?.ev ?? []).filter((e) => !(Date.parse(e.t) < from)).slice(-keep).reverse();
}
async function readTimeline(file: string): Promise<void> {
  let st: ReturnType<typeof statSync>;
  try {
    st = statSync(file);
  } catch {
    return;
  }
  const size = st.size;
  let cur = cursors.get(file);
  const replaced = !!cur && (Number(st.dev) !== cur.dev || Number(st.ino) !== cur.ino || size < cur.offset || (size === cur.offset && st.mtimeMs !== cur.mtimeMs));
  if (!cur || replaced) cur = { file, dev: Number(st.dev), ino: Number(st.ino), mtimeMs: st.mtimeMs, size: 0, offset: 0, carry: Buffer.alloc(0), ev: [] };
  if (size > cur.offset) {
    cur = { ...cur, ev: cur.ev.map(e => e.k === "tools" ? { ...e, what: [...e.what] } : { ...e }) };
    const fd = await open(file, "r");
    try {
      const chunk = 256 << 10;
      const buf = Buffer.alloc(chunk);
      let carry = cur.carry;
      for (let at = cur.offset; at < size; ) {
        const { bytesRead: n } = await fd.read(buf, 0, Math.min(chunk, size - at), at);
        if (!n) throw new Error("Session changed during timeline read");
        at += n;
        const bytes = Buffer.concat([carry, buf.subarray(0, n)]), end = bytes.lastIndexOf(10);
        carry = Buffer.from(bytes.subarray(end + 1));
        const lines = end < 0 ? [] : bytes.subarray(0, end).toString("utf8").split("\n");
        for (const line of lines) {
          if (!line.trim()) continue;
          let rec: any;
          try {
            rec = JSON.parse(line);
          } catch {
            continue;
          }
          for (const x of lineEvents(rec)) push(cur.ev, x);
        }
        await yieldIO();
      }
      const current = statSync(file);
      if (current.dev !== st.dev || current.ino !== st.ino || current.size < size ||
          (current.size === size && current.mtimeMs !== st.mtimeMs)) return;
      cur.carry = carry;
      cur.offset = size;
    } finally {
      await fd.close();
    }
  }
  cur.dev = Number(st.dev);
  cur.ino = Number(st.ino);
  cur.mtimeMs = st.mtimeMs;
  cur.size = size;
  cursors.set(file, cur);
}

const taskFiles = new Map<string, { mtime: number; id: string; title: string; history: { at?: string; stage?: string; by?: string }[] }>();

/**
 * Tasks this agent moved since `since` (a0-task history lines whose `by` is one of `who`), newest first. Each task file is
 * parsed again only when it changes.
 */
export function taskMoves(root: string, who: string[], since: string, keep = 100): TimelineEv[] {
  let names: string[] = [];
  try {
    names = readdirSync(root).filter((n) => /^[A-Za-z0-9][\w-]*\.json$/.test(n) && n !== "INDEX.json");
  } catch {
    return [];
  }
  const by = new Set(who.map((w) => w.toUpperCase()));
  const from = Date.parse(since);
  const out: TimelineEv[] = [];
  for (const name of names) {
    const file = path.join(root, name);
    let mtime = 0;
    try {
      mtime = statSync(file).mtimeMs;
    } catch {
      continue;
    }
    // A file not touched since `since` holds no move after it.
    if (mtime < from) continue;
    let hit = taskFiles.get(file);
    if (!hit || hit.mtime !== mtime) {
      try {
        const t = JSON.parse(readFileSync(file, "utf8"));
        hit = { mtime, id: String(t.id ?? name.slice(0, -5)), title: String(t.title ?? ""), history: Array.isArray(t.history) ? t.history : [] };
      } catch {
        continue;
      }
      taskFiles.set(file, hit);
    }
    // A move is a line that changes its stage (a "set next" keeps the stage and is not one).
    let was: string | undefined;
    for (const h of hit.history) {
      const moved = !!h.stage && h.stage !== was;
      if (h.stage) was = h.stage;
      if (moved && h.at && Number.isFinite(Date.parse(h.at)) && by.has(String(h.by ?? "").toUpperCase()) && !(Date.parse(h.at) < from))
        out.push({ k: "task", t: new Date(h.at).toISOString(), id: hit.id, stage: h.stage!, text: hit.title.slice(0, 120) });
    }
  }
  return out.sort((a, b) => Date.parse(b.t) - Date.parse(a.t)).slice(0, keep);
}

export type Moment = {
  id: string;
  k: "shipped" | "soul" | "task" | "you" | "page";
  t: string;
  title: string;
  text: string;
  who: string;
  state: string;
  task?: string;
  gallery?: string;
  pair?: {
    before: string;
    after: string;
  };
  commits?: {
    sha: string;
    subject: string;
  }[];
  files?: string[];
  tokens?: number;
  duration?: number;
  url?: string;
  branch?: string;
  revision?: string;
  reason?: string;
  /** The owner's release note for a ship (services/node/releases/notes.jsonl): his words, what changed, how to see it. */
  note?: Note;
  /** A task's short name, and the last real outcome its owner wrote on the move (a0-task move --evidence), for Activity. */
  short?: string;
  outcome?: string;
};
/** Bookkeeping lines a0-task writes ("set next", "set next, links.pr") say nothing about what happened. */
const realOutcome = (steps: { note?: unknown }[]) => [...steps].reverse().map(h => typeof h.note === "string" ? h.note.trim() : "").find(n => n && !/^set [\w.]+(?:, [\w.]+)*$/i.test(n))?.slice(0, 400);
const readText = (file: string) => { try {
  return readFileSync(file, "utf8");
}
catch {
  return "";
} };
const readJson = (file: string) => { try {
  return JSON.parse(readText(file));
}
catch {
  return null;
} };
const namesIn = (dir: string) => { try {
  return readdirSync(dir);
}
catch {
  return [];
} };
const iso = (at: unknown) => { const n = typeof at === "number" ? (at < 1e12 ? at * 1000 : at) : Date.parse(String(at)); const date = new Date(n); return Number.isFinite(date.getTime()) ? date.toISOString() : ""; };
const rootRepo = path.resolve(process.env.AB_TIMELINE_REPO ?? path.join(import.meta.dirname, "../../.."));
export const galleryRoot = () => path.resolve(process.env.AB_TIMELINE_GALLERIES ?? path.join(rootRepo, "ui-hub"));
/** Only evidence in the configured hub, including after realpath resolution. Never expose arbitrary run paths. */
export function galleryFile(relative: string) {
  try {
    const root = realpathSync(galleryRoot()), file = realpathSync(path.resolve(root, relative));
    return file.startsWith(root + path.sep) && statSync(file).isFile() ? file : null;
  }
  catch {
    return null;
  }
}
function evidence(relative: unknown): Pick<Moment, "gallery" | "pair"> {
  if (typeof relative !== "string" || relative.includes("..") || path.isAbsolute(relative))
    return {};
  const dir = path.join(galleryRoot(), relative);
  const images = namesIn(dir).filter(n => /\.(png|webp|jpg)$/i.test(n)).sort();
  const before = images.find(n => n.includes("-before-") && images.some(a => a === n.replace("-before-", "-after-")));
  const url = (name: string) => `/api/timeline/gallery/${relative.split("/").map(encodeURIComponent).join("/")}/${encodeURIComponent(name)}`;
  const gallery = galleryFile(`${relative}/index.html`) ? url("index.html") : undefined;
  if (!before)
    return gallery ? { gallery } : {};
  const after = before.replace("-before-", "-after-");
  return galleryFile(`${relative}/${before}`) && galleryFile(`${relative}/${after}`) ? { gallery, pair: { before: url(before), after: url(after) } } : {};
}
function findGallery(meta: any): Pick<Moment, "gallery" | "pair"> {
  if (typeof meta.gallery === "string") {
    const direct = evidence(meta.gallery);
    if (direct.pair || direct.gallery)
      return direct;
  }
  const slug = String(meta.branch ?? "").split("/").pop();
  for (const component of namesIn(galleryRoot()))
    for (const round of namesIn(path.join(galleryRoot(), component, "rounds"))) {
      const relative = `${component}/rounds/${round}`;
      const task = String(meta.task ?? meta.tickets?.[0] ?? "");
      if ((slug && round === slug) || (task && readText(path.join(galleryRoot(), relative, "REASONING.md")).includes(task)))
        return evidence(relative);
    }
  return {};
}
/**
 * git for the Timeline never blocks the node (5 Oct: a synchronous git call per run, branch and ship froze every route for
 * 8-27 s and the app said "Reconnecting to herdr"). A read returns the last answer and refreshes it in the background when
 * older than 10 s (a commit's subject is kept for good); the first read of a question returns null and fills in later.
 */
const gitCache = new Map<string, {
  at: number;
  result: string | null;
}>();
const gitAsking: [string, string[], string][] = [];
const gitQueued = new Set<string>();
let gitRunning = 0;
function gitPump() {
  while (gitRunning < 3 && gitAsking.length) {
    const [key, args, cwd] = gitAsking.shift()!;
    gitRunning++;
    execFile("git", args, { cwd, encoding: "utf8", timeout: 5000, maxBuffer: 256000 }, (err, out) => {
      gitCache.set(key, { at: Date.now(), result: err ? null : String(out).trim() });
      gitQueued.delete(key);
      gitRunning--;
      gitPump();
    });
  }
}
function git(args: string[], cwd = rootRepo): string | null {
  const key = `${cwd}:${args.join(" ")}`, hit = gitCache.get(key);
  // Starting git costs the main thread too (627 runs, ~40 worktrees): branch questions refresh once a minute.
  const fresh = hit && (args[0] === "show" && hit.result !== null || Date.now() - hit.at < 60000);
  if (!fresh && !gitQueued.has(key)) {
    gitQueued.add(key);
    gitAsking.push([key, args, cwd]);
    gitPump();
  }
  return hit?.result ?? null;
}
/** A checkout's branch from its HEAD file (a worktree's .git file names its gitdir): no process per run. */
const branchCache = new Map<string, { at: number; branch: string | null }>();
function currentBranch(dir: string): string | null {
  const hit = branchCache.get(dir);
  if (hit && Date.now() - hit.at < 10000) return hit.branch;
  let branch: string | null = null;
  try {
    for (let d = dir, i = 0; i < 8 && d !== path.dirname(d); d = path.dirname(d), i++) {
      let dotgit: ReturnType<typeof statSync>;
      try { dotgit = statSync(path.join(d, ".git")); } catch { continue; }
      const gitdir = dotgit.isDirectory() ? path.join(d, ".git") : path.resolve(d, /gitdir:\s*(.+)/.exec(readFileSync(path.join(d, ".git"), "utf8"))?.[1].trim() ?? "");
      branch = /^ref: refs\/heads\/(.+)$/m.exec(readFileSync(path.join(gitdir, "HEAD"), "utf8"))?.[1].trim() ?? null;
      break;
    }
  } catch { /* unreadable checkout: no branch */ }
  branchCache.set(dir, { at: Date.now(), branch });
  return branch;
}
function commitsOf(meta: any): Moment["commits"] {
  if (Array.isArray(meta.commits))
    return meta.commits.filter((c: any) => typeof c?.sha === "string" && typeof c?.subject === "string").slice(0, 30);
  if (!/^[a-f\d]{7,40}$/i.test(String(meta.sha ?? meta.live_sha ?? "")))
    return [];
  const sha = String(meta.sha ?? meta.live_sha);
  const subject = git(["show", "-s", "--format=%s", sha]);
  return subject ? [{ sha, subject }] : [];
}
export type TimelineScope = {
  all: boolean;
  who: string[];
  session?: string | null;
  pane?: string | null;
};
/** Every run's meta, read at most every 15 s (627 files on 5 Oct, read on every Timeline poll). Callers get copies. */
let metaCache: { dir: string; at: number; rows: { name: string; meta: any }[] } | null = null;
function metasOf(runsDir: string): { name: string; meta: any }[] {
  if (!metaCache || metaCache.dir !== runsDir || Date.now() - metaCache.at > 15000)
    metaCache = { dir: runsDir, at: Date.now(), rows: namesIn(runsDir).filter(n => /^[\w-]+\.meta\.json$/.test(n)).map(name => ({ name, meta: readJson(path.join(runsDir, name)) })).filter(r => r.meta) };
  return metaCache.rows.map(r => ({ name: r.name, meta: { ...r.meta } }));
}
export function pipelineMoments(scope: TimelineScope) {
  const who = new Set(scope.who.map(w => w.toUpperCase()));
  const belongs = (m: any) => scope.all || [m.by, m.owner, m.agent, m.worker, m.name].some(w => who.has(String(w ?? "").toUpperCase())) || !!scope.session && m.parent_session === scope.session || !!scope.pane && m.parent_pane === scope.pane;
  const taskRoot = process.env.AB_A0_TASKS ?? path.join(homedir(), "SISO_Workspace/SISO_Agents/agent-zero/siso-agent-zero/tasks");
  const index = readJson(path.join(taskRoot, "INDEX.json"));
  const ownedTasks = new Set<string>((index?.tasks ?? []).filter(belongs).map((t: any) => String(t.id)));
  const runsDir = process.env.AB_TIMELINE_RUNS ?? process.env.AB_CODEX_RUNS ?? path.join(homedir(), ".local/state/codex-run/runs");
  const runMetas = metasOf(runsDir);
  // A release written by an owner's soul belongs to that owner through the run/task relationship.
  for (const { meta } of runMetas) if (belongs(meta) || ownedTasks.has(meta.task) || (Array.isArray(meta.tickets) && meta.tickets.some((id: string) => ownedTasks.has(id)))) {
    for (const name of [meta.worker, meta.name]) if (typeof name === "string") who.add(name.toUpperCase());
  }
  const landed: Moment[] = [], pending: Moment[] = [], unavailable: string[] = [];
  const queueDir = process.env.AB_QUEUE_STATE ?? path.join(homedir(), ".local/state/agent-base/ship-queue");
  const queueFile = path.join(queueDir, "queue.jsonl"), rows = new Map<string, any>();
  const journal = readText(queueFile);
  if (!journal)
    unavailable.push("Ship queue");
  for (const line of journal.split("\n")) {
    if (!line.trim())
      continue;
    try {
      const e = JSON.parse(line);
      if (typeof e.id === "string" && e.id !== "runner")
        rows.set(e.id, { ...rows.get(e.id), ...e });
    }
    catch {
      if (!unavailable.includes("Ship queue has an incomplete record"))
        unavailable.push("Ship queue has an incomplete record");
    }
  }
  // Each ship takes the note for the commits it brought: those after the ship queued before it (5 Oct: "doesn't show pushes").
  const notes = readNotes(notesFile(rootRepo));
  let prevSha: string | null = null;
  for (const row of rows.values()) {
    const before = prevSha;
    if (typeof row.sha === "string" && /^[0-9a-f]{7,40}$/.test(row.sha) && ["live", "queued", "merged", "landed"].includes(row.state))
      prevSha = row.sha;
    if (!(belongs(row) || ownedTasks.has(row.task)) || !["live", "queued", "merged", "landed", "failed", "conflict", "blocked", "rolled-back"].includes(row.state))
      continue;
    const note = notes.length && typeof row.sha === "string" ? noteSoon(rootRepo, notes, before, row.sha) : undefined;
    const commits = commitsOf(row), t = iso(row.at);
    if (!t)
      continue;
    const m: Moment = { id: `ship:${row.id}`, k: "shipped", t, ...(note ? { note } : {}), title: note?.title ?? row.title ?? (commits?.map(c => c.subject).join(" · ") || `Work on ${row.branch ?? row.id}`), text: row.tests ?? "", who: row.by ?? "", state: row.state, branch: row.branch, task: row.task, commits, ...findGallery(row) };
    // Deployment history is not behavioral acceptance. Preserve the actual deployed
    // revision and failure/hold reason beside the existing release note and artifacts.
    const revision = row.state === "live" ? row.live_sha : row.landed_sha ?? row.sha;
    if (typeof revision === "string" && /^[a-f\d]{7,40}$/i.test(revision)) m.revision = revision;
    if (typeof row.why === "string" && row.why.trim()) m.reason = row.why;
    (row.state === "live" ? landed : pending).push(m);
  }
  const runs: Moment[] = [];
  try {
    statSync(runsDir);
  }
  catch {
    unavailable.push("Soul runs");
  }
  for (const { name, meta } of runMetas) {
    if (!meta || !belongs(meta))
      continue;
    if (!meta.branch && typeof meta.dir === "string" && (meta.dir === rootRepo || meta.dir.includes("/_data/worktrees/siso-internal-labs-agent-base/")))
      meta.branch = currentBranch(meta.dir);
    const id = name.replace(/\.meta\.json$/, ""), resultFile = path.join(runsDir, `${id}.last.md`);
    const result = readText(resultFile) || readText(path.join(runsDir, `${id}.return`));
    const status = /(?:STATUS:\s*|^)(done|blocked|failed)\b/im.exec(result)?.[1]?.toLowerCase();
    let ended = iso(meta.ended);
    if (!ended && result) {
      try {
        ended = iso(statSync(resultFile).mtimeMs);
      }
      catch { /* fixture return uses explicit end */ }
    }
    let tokens = 0;
    const files = new Set<string>(Array.isArray(meta.files) ? meta.files : []);
    const logFile = path.join(runsDir, `${id}.jsonl`);
    let log = "";
    try {
      const st = statSync(logFile);
      if (st.size <= 8 * 1024 * 1024)
        log = readText(logFile);
      else
        unavailable.push(`Usage and files unavailable for ${meta.name ?? id}: large run log`);
    }
    catch { /* not yet written */ }
    for (const line of log.split("\n"))
      try {
        const e = JSON.parse(line);
        const usage = e.usage ?? e.token_usage;
        if (usage)
          tokens += Number(usage.input_tokens ?? 0) + Number(usage.output_tokens ?? usage.completion_tokens ?? 0);
        for (const c of e.item?.changes ?? [])
          if (typeof c.path === "string")
            files.add(c.path);
      }
      catch { /* partial log */ }
    const task = meta.task ?? (Array.isArray(meta.tickets) ? meta.tickets[0] : undefined);
    const taskData = task && /^[\w-]+$/.test(task) ? readJson(path.join(process.env.AB_A0_TASKS ?? path.join(homedir(), "SISO_Workspace/SISO_Agents/agent-zero/siso-agent-zero/tasks"), `${task}.json`)) : null;
    const started = iso(meta.started), t = ended || started;
    if (!t)
      continue;
    const m: Moment = { id: `soul:${id}`, k: "soul", t, title: meta.title ?? taskData?.title ?? meta.about ?? meta.batch ?? meta.name ?? id, text: result.slice(0, 12000), who: meta.worker ?? meta.name ?? id, state: status ?? (result ? "Return recorded" : "No return yet"), task, branch: meta.branch, tokens: Number.isFinite(tokens) ? tokens : 0, duration: ended && started ? Math.max(0, Date.parse(ended) - Date.parse(started)) : undefined, files: [...files].slice(0, 40), ...findGallery(meta) };
    runs.push(m);
  }
  const moves: Moment[] = [];
  if (!index)
    unavailable.push("Task board");
  for (const summary of index?.tasks ?? []) {
    if (!/^[\w-]+$/.test(String(summary.id)))
      continue;
    const task = readJson(path.join(taskRoot, `${summary.id}.json`));
    if (!task || !belongs(task))
      continue;
    const groups = new Map<string, any[]>();
    let previous = "";
    for (const h of task.history ?? []) {
      const at = iso(h.at);
      if (h.stage && h.stage !== previous && at) {
        const key = at.slice(0, 13);
        groups.set(key, [...(groups.get(key) ?? []), h]);
      }
      previous = h.stage ?? previous;
    }
    for (const [hour, steps] of groups) {
      const last = steps.at(-1);
      moves.push({ id: `task:${task.id}:${hour}`, k: "task", t: iso(last.at), title: `${steps.length > 1 ? `${steps.length} steps of ` : ""}${task.title} → ${last.stage}`, text: steps.map(h => `${h.stage} · ${h.by ?? ""}${h.note ? ` · ${h.note}` : ""}`).join("\n"), who: last.by ?? task.agent ?? task.owner ?? "", state: last.stage, task: task.id, ...(typeof task.short === "string" && task.short.trim() ? { short: task.short.trim() } : {}), ...(realOutcome(steps) ? { outcome: realOutcome(steps) } : {}) });
    }
    // Built/tested are recorded stages; neither proves preview acceptance or live behavior.
    if (["built", "tested"].includes(task.stage))
      pending.push({ id: `built:${task.id}`, k: "task", t: iso(task.updated) || iso(task.history?.at(-1)?.at), title: task.title, text: task.next ?? "", state: task.stage, who: task.agent ?? task.owner ?? "", task: task.id, ...(typeof task.short === "string" && task.short.trim() ? { short: task.short.trim() } : {}), ...(realOutcome(task.history ?? []) ? { outcome: realOutcome(task.history ?? []) } : {}), ...findGallery({ task: task.id }) });
  }
  // Branches retired on purpose (services/node/retired-branches.txt, as "not landed" reads it) are not pipeline.
  let retiredText = "";
  try { retiredText = readFileSync(path.join(rootRepo, "services/node/retired-branches.txt"), "utf8"); } catch { /* none retired */ }
  const retired = new Set(retiredText.split("\n").map(l => l.trim().split(/\s+/)[0]).filter(n => n && !n.startsWith("#")));
  // Only observed unpublished commits make a branch row. Missing origin/dev remains an explicit limitation.
  const worktrees = git(["worktree", "list", "--porcelain"]);
  for (const block of (worktrees ?? "").split("\n\n")) {
    const cwd = /^worktree (.+)$/m.exec(block)?.[1], branch = /^branch refs\/heads\/(ui\/[\w/-]+)$/m.exec(block)?.[1];
    if (!cwd || !branch || retired.has(branch) || (!scope.all && !runs.some(r => r.branch === branch)))
      continue;
    if (pending.some(m => m.branch === branch))
      continue;
    const cherry = git(["cherry", "origin/dev", branch], cwd);
    if (cherry === null) {
      if (!unavailable.includes("Branch comparison unavailable"))
        unavailable.push("Branch comparison unavailable");
      continue;
    }
    const hashes = cherry.split("\n").filter(l => l.startsWith("+ ")).map(l => l.slice(2));
    if (!hashes.length)
      continue;
    const run = runs.find(r => r.branch === branch);
    pending.push({ id: `branch:${branch}`, k: "soul", t: run?.t ?? new Date().toISOString(), title: run?.title ?? branch.replace(/^ui\//, "").replace(/-/g, " "), text: "Commits not yet present on origin/dev", who: run?.who ?? "", state: `Branch · ${hashes.length} commits`, branch, task: run?.task, commits: hashes.slice(0, 20).map(sha => ({ sha, subject: git(["show", "-s", "--format=%s", sha], cwd) ?? sha.slice(0, 7) })), ...findGallery({ branch }) });
  }
  const order = (a: Moment, b: Moment) => Date.parse(b.t) - Date.parse(a.t);
  return { landed: landed.sort(order), pending: pending.sort(order), moments: [...landed, ...runs, ...moves].sort(order), unavailable };
}
export function dayMoments(day: string, offset: number, scope: TimelineScope, sessionEvents: TimelineEv[], pages: {
  at?: number;
  title: string;
  url: string;
}[]) {
  const data = pipelineMoments(scope);
  const start = Date.parse(`${day}T00:00:00Z`) - offset * 60000, end = start + 86400000;
  const inside = (t: string) => Date.parse(t) >= start && Date.parse(t) < end;
  const raw = process.env.AB_TIMELINE_PROMPTS && scope.all ? readText(process.env.AB_TIMELINE_PROMPTS).split("\n").flatMap(l => { try {
    return [JSON.parse(l)];
  }
  catch {
    return [];
  } }) : sessionEvents;
  const asks: Moment[] = raw.filter((e: TimelineEv) => e.k === "you" && !SECRETISH.test(e.text)).map((e: any, i: number) => ({ id: `ask:${e.t}:${i}`, k: "you", t: e.t, title: e.text.replace(/^(?:go on[, .]*|okay[, .]*|please\s+)/i, "").split(/\n|(?<=[.!?])\s/)[0].slice(0, 70), text: e.text, who: "You", state: "Ask" }));
  const posted: Moment[] = pages.flatMap((p, i) => {
    const date = typeof p.at === "number" ? new Date(p.at) : null;
    if (!date || !Number.isFinite(date.getTime())) {
      if (!data.unavailable.includes("Page timestamps")) data.unavailable.push("Page timestamps");
      return [];
    }
    return [{ id: `page:${i}:${p.at}`, k: "page", t: date.toISOString(), title: p.title, text: p.url, who: scope.who[0], state: "Posted", url: /^https?:\/\//.test(p.url) ? p.url : undefined }];
  });
  return { day, moments: [...data.moments, ...asks, ...posted].filter(m => inside(m.t)).sort((a, b) => Date.parse(b.t) - Date.parse(a.t)), unavailable: data.unavailable };
}
