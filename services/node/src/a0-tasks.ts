import { execFile } from "node:child_process";
import { watch, type FSWatcher } from "node:fs";
import { readFile, stat, readdir, realpath } from "node:fs/promises";
import type http from "node:http";
import path from "node:path";
import { homedir } from "node:os";

export const A0_TASK_STAGES = ["thought", "specced", "allocated", "building", "built", "tested", "integrated", "feedback", "happy", "rework"] as const;
export type A0TaskStage = typeof A0_TASK_STAGES[number];

export type A0TaskSummary = {
  id: string; title: string; project: string; priority: string; stage: A0TaskStage;
  owner: string | null; model: string | null; updated: string;
  /** Added by the node: the task waits on Shaan (feedback stage, his name as owner, or "needs him" in its next step). */
  needs?: boolean;
  /** Whether the backing task record can be read; index metadata is not a complete task. */
  source?: "available" | "unavailable";
  /** Explicit Product map affinity from the backing record; never inferred from title or evidence. */
  links?: { surface: string };
  /** Added by the node: a clean card title (the owner's short, then the spec heading, then a title cut at a word). */
  short?: string;
  /** Added by the node: the task file's next step ("NOW: …" puts it first in an owner's list). */
  next?: string | null;
  /** Added by the node: the task this one is a step of (a0-task `set <id> parent=<id>`), so the panel draws it as a subtask. */
  parent?: string | null;
  /** Explicit task affinity, resolved against the navigation registry by Tasks readers. */
  workspace?: string | null;
  /** Added by the node: who is doing it (a0-task `set <id> agent=NAME`), when that is not the owner: a seat or a soul. */
  agent?: string | null;
  /** Added by the node: his own words from the task file, whitespace folded ("" when the file has none). */
  his?: string;
  /** Added by the node: when it last went live (the newest history entry at live, happy or integrated), else null. */
  live_at?: string | null;
  stage_at?: string | null;
  shots?: { before: string; after: string } | null;
};
export type A0TaskIndex = { updated: string; counts: Record<string, unknown>; tasks: A0TaskSummary[] };

export const DEFAULT_ROOT = path.join(homedir(), "SISO_Workspace/SISO_Agents/agent-zero/siso-agent-zero/tasks");
const ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const safeRead = async (file: string) => {
  try { return JSON.parse(await readFile(file, "utf8")); } catch { return null; }
};
const safeText = async (file: string) => {
  try { return await readFile(file, "utf8"); } catch { return null; }
};
const fileStamp = async (file: string) => {
  try { const s = await stat(file); return `${s.dev}:${s.ino}:${s.mtimeMs}:${s.size}`; } catch { return "missing"; }
};

/** A same-stage edit is not a new stage entry. Unknown history stays unknown. */
export function stageAt(history: unknown, stage: string): string | null {
  if (!Array.isArray(history)) return null;
  let current = "", entered: string | null = null;
  for (const h of history) if (h && typeof h.stage === "string" && typeof h.at === "string") {
    if (h.stage !== current) entered = Number.isFinite(Date.parse(h.at)) ? h.at : null;
    current = h.stage;
  }
  return current === stage ? entered : null;
}

type Shots = NonNullable<A0TaskSummary["shots"]>;
/** Folder enumeration is async and shared; requests only stat an unchanged gallery. */
function shotsReader() {
  const cache = new Map<string, { stamp: string; value: Promise<Shots | null> }>();
  return async (task: any): Promise<Shots | null> => {
    const history = (Array.isArray(task?.history) ? task.history : []).flatMap((h: any) => [h?.evidence, h?.note]).filter((s: unknown) => typeof s === "string");
    const evidence = [...history, ...(Array.isArray(task?.evidence) ? task.evidence : [task?.evidence])];
    const relative = evidence.reverse().flatMap((s: unknown) => typeof s === "string" ? [...s.matchAll(/ui-hub\/([\w-]+\/rounds\/[\w-]+)(?=[/\s.,;:)\]]|$)/g)].map(m => m[1]) : [])[0];
    if (!relative) return null;
    try {
      // Same root as timeline.galleryFile; that existing route checks confinement again on image requests.
      const hub = process.env.AB_TIMELINE_GALLERIES ?? path.join(process.env.AB_TIMELINE_REPO ?? path.resolve(import.meta.dirname, "../../.."), "ui-hub");
      const base = await realpath(hub), folder = await realpath(path.join(base, relative));
      if (!folder.startsWith(base + path.sep)) return null;
      const stamp = await fileStamp(folder), old = cache.get(folder);
      if (old?.stamp === stamp) return old.value;
      const value = (async () => {
        const names = (await readdir(folder)).filter(n => /\.png$/i.test(n)).sort();
        const key = (n: string) => n.replace(/^\d+[-_]/, "").replace(/(^|[-_])(before|after)(-pass\d+)?(?=[-_.])/i, "$1~").replace(/\.\w+$/, "");
        for (const before of names.filter(n => /-before-/i.test(n))) {
          const after = names.find(n => /-after-/i.test(n) && !/after-pass\d/i.test(n) && key(n) === key(before));
          if (!after) continue;
          const files = await Promise.all([before, after].map(n => realpath(path.join(folder, n))));
          if (!files.every(f => f.startsWith(base + path.sep))) continue;
          const url = (name: string) => `/api/timeline/gallery/${relative.split("/").map(encodeURIComponent).join("/")}/${encodeURIComponent(name)}`;
          return { before: url(before), after: url(after) };
        }
        return null;
      })().catch(() => null);
      cache.set(folder, { stamp, value });
      return value;
    } catch { return null; }
  };
}

function validIndex(value: any): value is A0TaskIndex {
  return Boolean(value && typeof value.updated === "string" && Array.isArray(value.tasks) &&
    new Set(value.tasks.map((t: any) => t?.id)).size === value.tasks.length &&
    value.tasks.every((t: any) => t && typeof t.id === "string" && ID.test(t.id) &&
      typeof t.title === "string" && typeof t.stage === "string" && typeof t.updated === "string" &&
      typeof t.project === "string" && typeof t.priority === "string" && (t.owner == null || typeof t.owner === "string")));
}

function validTask(value: any, id: string): value is Record<string, unknown> {
  return Boolean(value && value.id === id && typeof value.title === "string" && typeof value.stage === "string");
}

/** Whether a task waits on Shaan; the index has no field for it, so the task file's owner and next step decide. */
export function needsHim(task: { stage?: unknown; owner?: unknown; next?: unknown }) {
  return task.stage === "feedback" || /\bshaan\b/i.test(String(task.owner ?? "")) || /\bneeds (him|shaan)\b|^shaan\b/i.test(String(task.next ?? ""));
}

/**
 * Prefer the owner's explicit short (a0-task set short=...). Otherwise derive
 * a card's title (HUB-DESIGN 17:33: cards showed his raw words cut mid-word): the spec's own heading ("# t-0023 · Queued
 * messages appear instantly"), else the index title, cut back to a whole word with "…" when it is a cut-off quote.
 */
export function shortTitle(title: string, his?: unknown, spec?: string | null, id = "", explicit?: unknown) {
  const saved = typeof explicit === "string" ? explicit.replace(/\s+/g, " ").trim() : "";
  if (saved) return saved;
  const first = spec ? /^#\s+(.+)$/m.exec(spec)?.[1]?.trim() : undefined;
  const head = first && id && first.startsWith(id) ? first.slice(id.length).replace(/^\s*[·:\u2014-]\s*/, "").trim() : first;
  if (head) return head;
  const flat = title.replace(/\s+/g, " ").trim();
  const quote = String(his ?? "").replace(/\s+/g, " ").trim();
  const cut = (quote.length > flat.length && quote.startsWith(flat)) || (flat.length >= 90 && !/[.!?"”)]$/.test(flat));
  if (!cut) return flat;
  const space = flat.lastIndexOf(" ");
  return `${(space > 40 ? flat.slice(0, space) : flat).replace(/[\s,;:.·"“-]+$/, "")}…`;
}

const LIVE = new Set(["live", "happy", "integrated"]);
/** When a task went live: the newest history entry whose stage is live, happy or integrated (the Done tab's day). */
export function liveAt(history: unknown): string | null {
  if (!Array.isArray(history)) return null;
  let best: string | null = null;
  for (const h of history) if (h && LIVE.has(h.stage) && typeof h.at === "string" && (!best || Date.parse(h.at) > Date.parse(best))) best = h.at;
  return best;
}

/**
 * Bumped by each write from the app. `next` is not in INDEX.json, and a0-task leaves the index byte-identical when a
 * write lands in the same second as the one before, so the index's own stamp alone would miss it.
 */
let written = 0;

/** Read-only task endpoint handler; pass root to isolate tests from the live task store. */
export function createA0TasksHandler(root = process.env.AB_A0_TASKS ?? DEFAULT_ROOT) {
  const indexPath = path.join(root, "INDEX.json");
  let cached: A0TaskIndex | null = null;
  let cachedStamp = "";
  let records = new Map<string, any>();
  const shots = shotsReader();
  const childStamp = async (tasks: A0TaskSummary[]) => (await Promise.all(tasks.map(async (task) => {
    const id = String(task.id);
    if (!ID.test(id)) return `${id}:invalid`;
    const stamps = await Promise.all([fileStamp(path.join(root, `${id}.json`)), fileStamp(path.join(root, "..", "specs", `${id}.md`))]);
    return `${id}:${stamps.join(":")}`;
  }))).join("|");
  const loadIndex = async () => {
    const baseStamp = `${await fileStamp(indexPath)}:${written}`;
    if (cached && `${baseStamp}|${await childStamp(cached.tasks)}` === cachedStamp) {
      return { ...cached, tasks: await Promise.all(cached.tasks.map(async t => ({ ...t, shots: await shots(records.get(t.id)) }))) };
    }
    const cachedBase = cachedStamp.slice(0, cachedStamp.indexOf("|"));
    const next = !cached || baseStamp !== cachedBase ? await safeRead(indexPath) : { ...cached, tasks: cached.tasks.map(t => ({ ...t })) };
    if (!validIndex(next)) return null;
    const expectedChildren = await childStamp(next.tasks);
    const nextRecords = new Map<string, any>();
    await Promise.all(next.tasks.map(async (task: A0TaskSummary) => {
      const raw = await safeRead(path.join(root, `${task.id}.json`));
      const file = validTask(raw, task.id) ? raw : null;
      task.source = file ? "available" : "unavailable";
      const surface = (file?.links as Record<string, unknown> | undefined)?.surface;
      if (typeof surface === "string" && /^[a-z_][a-z0-9_-]{0,79}$/.test(surface)) task.links = { surface };
      else delete task.links;
      nextRecords.set(task.id, file);
      // An unreadable record must not erase known parent/workspace metadata. A readable
      // record with a removed field still clears it below (TASK-LANES contract).
      if (!file) { task.shots = null; return; }
      task.needs = needsHim(file ?? task);
      task.next = typeof file?.next === "string" ? file.next : null;
      task.parent = typeof file?.parent === "string" ? file.parent : null;
      task.workspace = typeof file?.workspace === "string" ? file.workspace : null;
      task.agent = typeof file?.agent === "string" ? file.agent : null;
      task.his = typeof file?.his === "string" ? file.his.replace(/\s+/g, " ").trim() : "";
      task.live_at = liveAt(file?.history);
      task.stage_at = stageAt(file?.history, task.stage);
      task.shots = await shots(file);
      task.short = shortTitle(task.title, file?.his, ID.test(String(task.id)) ? await safeText(path.join(root, "..", "specs", `${task.id}.md`)) : null, String(task.id), file?.short);
    }));
    records = nextRecords;
    cached = next;
    cachedStamp = `${baseStamp}|${expectedChildren}`;
    return cached;
  };
  let indexing: ReturnType<typeof loadIndex> | null = null;
  const index = () => indexing ??= loadIndex().finally(() => { indexing = null; });

  return async (pathname: string): Promise<{ status: number; body: unknown } | null> => {
    if (pathname === "/api/a0/tasks") {
      const value = await index();
      return value ? { status: 200, body: value } : { status: 503, body: { error: "Agent Zero task index is unavailable or invalid" } };
    }
    const match = /^\/api\/a0\/tasks\/([^/]+)$/.exec(pathname);
    if (!match) return null;
    let id: string;
    try { id = decodeURIComponent(match[1]); } catch { return { status: 400, body: { error: "Invalid task id" } }; }
    if (!ID.test(id)) return { status: 400, body: { error: "Invalid task id" } };
    const current = await index();
    if (!current) return { status: 503, body: { error: "Task index unavailable" } };
    const summary = current.tasks.find((task) => task.id === id);
    if (!summary) return { status: 404, body: { error: "Task not found" } };
    const file = path.join(root, `${id}.json`);
    const detail = await safeRead(file);
    if (!validTask(detail, id)) return { status: 503, body: { error: "Task source unavailable or invalid" } };
    // The Opus spec (what he wants, decision, acceptance) sits beside the tasks; its name comes from the checked id only.
    const spec = await safeText(path.join(root, "..", "specs", `${id}.md`));
    return { status: 200, body: { ...detail, shots: summary.shots, stage_at: summary.stage_at, needs: needsHim(detail), short: shortTitle(String(detail.title), detail.his, spec, id, detail.short), ...(spec ? { spec_md: spec } : {}) } };
  };
}

/**
 * GET /api/a0/tasks/events: Server-Sent Events, one "index" event (the whole index) whenever INDEX.json changes, so
 * `a0-task move` shows in the app within 2 s. One watcher for every viewer; a 1 s stat check covers missed fs events.
 */
type TaskReader = (pathname: string) => Promise<{ status: number; body: unknown } | null>;
export function createA0TasksEvents(read: TaskReader, root = process.env.AB_A0_TASKS ?? DEFAULT_ROOT) {
  const clients = new Set<http.ServerResponse>();
  let watcher: FSWatcher | null = null;
  let tick: ReturnType<typeof setInterval> | null = null;
  let lastBody = "";
  let checking = false;
  const check = async () => {
    if (checking) return;
    checking = true;
    const value = await read("/api/a0/tasks").finally(() => { checking = false; });
    if (value?.status !== 200) return;
    const body = JSON.stringify(value.body);
    if (body === lastBody) return;
    lastBody = body;
    const frame = `event: index\ndata: ${body}\n\n`;
    for (const res of clients) res.write(frame);
  };
  const start = () => {
    try { watcher = watch(root, (_event, name) => { if (!name || String(name).startsWith("INDEX")) setTimeout(check, 50); }); } catch { watcher = null; }
    tick = setInterval(() => {
      void check();
      for (const res of clients) res.write(": keepalive\n\n");
    }, 1000);
  };
  const stop = () => {
    watcher?.close(); watcher = null;
    if (tick) clearInterval(tick);
    tick = null;
  };
  return async (req: http.IncomingMessage, res: http.ServerResponse) => {
    res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store", connection: "keep-alive" });
    const first = await read("/api/a0/tasks");
    if (res.destroyed) return;
    if (first?.status === 200) {
      const body = JSON.stringify(first.body);
      if (clients.size === 0) lastBody = body;
      res.write(`event: index\ndata: ${body}\n\n`);
    }
    clients.add(res);
    if (clients.size === 1) start();
    req.on("close", () => {
      clients.delete(res);
      if (!clients.size) stop();
    });
  };
}

// ---------------------------------------------------------------- edits (R1.17, the owner's Tasks list)

/** The a0-task CLI's flywheel (bin/a0-task STAGES), in order. "dropped" is Drop's, with a reason. */
export const FLYWHEEL = ["thought", "specced", "allocated", "building", "built", "tested", "preview", "live", "feedback", "happy", "rework"] as const;
const EVIDENCE = new Set(["built", "tested", "preview", "live"]);
const FEEDBACK = new Set(["happy", "rework"]);
const PRIORITIES = new Set(["P0", "P1", "P2", "P3"]);
const DEFAULT_CLI = path.join(homedir(), "SISO_Workspace/SISO_Agents/agent-zero/siso-agent-zero/bin/a0-task");
/** POST /api/a0/tell: his words become a thought on Agent Zero's task list. */
export async function tellA0(text: string, project?: unknown, cli = process.env.AB_A0_TASK_CMD ?? DEFAULT_CLI): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const words = text.replace(/\s*\n+\s*/g, " / ").replace(/\s+/g, " ").trim();
  if (!words) return { ok: false, error: "Say what the task is." };
  if (words.length > 2000) return { ok: false, error: "Keep it under 2000 characters." };
  const args = ["add", `--his=${words}`, "--owner", "A0", "--stage", "thought", `--project=${typeof project === "string" && project.trim() ? project.trim() : "Agent Zero"}`, "--", words.slice(0, 120)];
  return new Promise((done) => execFile(cli, args, { timeout: 15_000, shell: false }, (error, stdout, stderr) => {
    if (error) return done({ ok: false, error: (String(stderr).trim().split("\n").pop() || error.message).slice(0, 300) });
    const id = stdout.trim();
    if (!ID.test(id)) return done({ ok: false, error: "The task CLI returned no task id." });
    written++;
    done({ ok: true, id });
  }));
}

export type TaskEdit = { stage?: unknown; priority?: unknown; next?: unknown; reason?: unknown; agent?: unknown };
const line = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : undefined);

/**
 * One edit as a0-task argv lists (never a shell, never a JSON edit): a stage change is `a0-task move`, priority and next
 * one `a0-task set`, all `--by shaan`. The CLI's own rules hold: built/tested/preview/live need evidence (his click in
 * the app is it), happy/rework need his words, and a drop needs a reason. Values go as `--flag=value`, so one that
 * starts with "-" stays a value.
 */
export function taskEditArgs(id: string, edit: TaskEdit): { ok: true; runs: string[][] } | { ok: false; error: string } {
  if (!ID.test(id)) return { ok: false, error: "Invalid task id" };
  if (!edit || typeof edit !== "object" || Array.isArray(edit)) return { ok: false, error: "Task edit must be an object." };
  const runs: string[][] = [];
  const reason = line(edit.reason, 300);
  if (edit.stage !== undefined) {
    const stage = String(edit.stage);
    if (stage !== "dropped" && !(FLYWHEEL as readonly string[]).includes(stage)) return { ok: false, error: `Not a stage in the flywheel: ${stage.slice(0, 40)}` };
    if (stage === "rework" && (!reason || (reason.match(/[\p{L}\p{N}]/gu)?.length ?? 0) < 3 || /^(redo|rework|marked rework in Agent Base)$/i.test(reason))) return { ok: false, error: "Say what needs redoing." };
    if (stage === "dropped" && !reason) return { ok: false, error: "Say why it is dropped." };
    const move = ["move", id, stage, "--by=shaan"];
    if (reason) move.push(`--note=${reason}`);
    if (EVIDENCE.has(stage)) move.push(`--evidence=shaan moved it to ${stage} in Agent Base`);
    if (FEEDBACK.has(stage) || stage === "dropped") move.push(`--his=${reason || `marked ${stage} in Agent Base`}`);
    runs.push(move);
  }
  const fields: string[] = [];
  if (edit.priority !== undefined) {
    if (!PRIORITIES.has(String(edit.priority))) return { ok: false, error: "Priority is P0, P1, P2 or P3." };
    fields.push(`priority=${edit.priority}`);
  }
  if (edit.next !== undefined) {
    const next = line(edit.next, 500);
    if (next === undefined) return { ok: false, error: "Next is one line of text." };
    fields.push(`next=${next}`);
  }
  if (edit.agent !== undefined) {
    if (typeof edit.agent !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/.test(edit.agent)) return { ok: false, error: "Agent must be a valid soul name." };
    fields.push(`agent=${edit.agent}`);
  }
  if (fields.length) runs.push(["set", id, ...fields, "--by=shaan"]);
  if (!runs.length) return { ok: false, error: "Nothing to change." };
  return { ok: true, runs };
}

/** POST /api/a0/tasks/:id: runs the edit through the a0-task CLI (execFile, no shell) and returns the updated task. */
export function createA0TaskWriter(read: TaskReader, cli = process.env.AB_A0_TASK_CMD ?? DEFAULT_CLI) {
  // One write at a time: a0-task reads, changes and rewrites the task file, so two at once (priority, then next a
  // moment later) would let the second put the first's field back.
  let queue: Promise<unknown> = Promise.resolve();
  const write = (id: string, edit: TaskEdit) => {
    const run = queue.then(() => writeOne(id, edit));
    queue = run.catch(() => {});
    return run;
  };
  const writeOne = async (id: string, edit: TaskEdit): Promise<{ status: number; body: unknown }> => {
    const plan = taskEditArgs(id, edit);
    if ("error" in plan) return { status: 400, body: { ok: false, error: plan.error } };
    const before = await read(`/api/a0/tasks/${id}`);
    if (before?.status !== 200) return { status: before?.status === 404 ? 404 : 503, body: { ok: false, error: "Task source unavailable" } };
    if (!validTask(before.body, id)) return { status: 503, body: { ok: false, error: "Task source is invalid" } };
    for (const args of plan.runs) {
      const err = await new Promise<string | null>((done) =>
        execFile(cli, args, { timeout: 15_000, shell: false }, (e, _out, stderr) => done(e ? (String(stderr).trim().split("\n").pop() || e.message).slice(0, 300) : null)),
      );
      written++;
      if (err) return { status: 422, body: { ok: false, error: err } };
    }
    const task = await read(`/api/a0/tasks/${id}`);
    if (task?.status !== 200 || !validTask(task.body, id)) return { status: 503, body: { ok: false, error: "Task save could not be read back" } };
    const saved = task.body as Record<string, unknown>;
    const expected = { stage: edit.stage, priority: edit.priority, next: edit.next === undefined ? undefined : line(edit.next, 500), agent: edit.agent };
    if (Object.entries(expected).some(([key, value]) => value !== undefined && saved[key] !== value)) return { status: 503, body: { ok: false, error: "Task save did not match the requested change" } };
    if (FEEDBACK.has(String(edit.stage))) {
      const feedback = saved.feedback as Record<string, unknown> | undefined;
      const words = line(edit.reason, 300) || `marked ${edit.stage} in Agent Base`;
      if (feedback?.his !== words || feedback?.verdict !== edit.stage) return { status: 503, body: { ok: false, error: "Task feedback was not confirmed" } };
    }
    return { status: 200, body: { ok: true, task: saved } };
  };
  return write;
}
