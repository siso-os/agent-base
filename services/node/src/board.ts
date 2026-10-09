import { execFile } from "node:child_process";
import { appendFile, mkdir, readFile, readdir, realpath, rename, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { DEFAULT_ROOT, liveAt } from "./a0-tasks.ts";
import { readReleases, type Release } from "./releases.ts";

/**
 * t-0567, the Agent Base task board (Shaan, 9 Oct ~00:55: "however wherever I can see the tasks of what's being landed, what's
 * on the to-do list and what's in the pipeline ... what's being specced out ... some ideas on and when I have ideas what I could
 * tell it to do"). One store, so the numbers cannot disagree: the asks (tasks/t-NNNN.json, the same rules as
 * `bin/ask queue AGENT-BASE`), the idea farm (research/ideas.jsonl) and the releases. To do + Specced + Building is the queue.
 * To do is the queue's P0/P1 asks; the order he drags them into is Agent Base's own (a0-task has no rank field), and the
 * sprint takes the top ten.
 */
export const OWNER = "AGENT-BASE";
export const PROJECT = "agent-base";
export const SPRINT = 10;
/** bin/ask's OPEN stages: what `ask queue` counts. */
export const OPEN = new Set(["specced", "allocated", "building", "built", "tested", "rework", "feedback"]);
const LANDED = new Set(["live", "happy", "integrated"]);
const REPO_URL = "https://github.com/sisodias/siso-internal-labs-agent-base";
// Farm ids are i-NNN, or a reader's own prefix (ab-NNN); t- is a task.
const TASK_ID = /^t-\d{1,6}$/, IDEA_ID = /^(?!t-)[a-z]{1,4}-\d{1,6}$/;

export type BoardCard = {
  id: string; kind: "task" | "idea"; title: string; his: string; at: string | null; stage: string; priority?: string;
  by?: string; spec?: boolean; folds?: string[]; link?: { label: string; url: string } | null; live_at?: string | null;
};
export type LandedGroup = { version: number | null; at: string | null; sha: string | null; cards: BoardCard[] };
export type Sprint = { status: string; summary: string; next: string; updated: string } | null;
export type Board = {
  updated: string; queue: number; sprint: Sprint; size: number; days: number;
  lanes: { ideas: BoardCard[]; specced: BoardCard[]; todo: BoardCard[]; building: BoardCard[]; landed: LandedGroup[] };
};
type Task = Record<string, any>;
type Idea = Record<string, any>;

const text = (v: unknown) => typeof v === "string" ? v : "";
const isOwner = (t: Task) => text(t.owner).toUpperCase() === OWNER;
const created = (t: Task) => text(t.created) || null;
const shaIn = (t: Task) => [...(Array.isArray(t.evidence) ? t.evidence : []), ...(Array.isArray(t.history) ? t.history.map((h: any) => h?.evidence) : [])]
  .filter((s): s is string => typeof s === "string").join(" ").match(/\b[0-9a-f]{7,40}\b/g) ?? [];

function taskCard(t: Task, extra: Partial<BoardCard> = {}): BoardCard {
  const pr = text(t.links?.pr);
  return { id: t.id, kind: "task", title: text(t.title), his: text(t.his), at: created(t), stage: text(t.stage), priority: text(t.priority) || "P2",
    spec: Boolean(t.links?.spec), link: /^https:\/\//.test(pr) ? { label: `PR ${pr.match(/\/pull\/(\d+)/)?.[1] ?? ""}`.trim(), url: pr } : null, ...extra };
}

/** The five lanes from the store; pure, so the node test can hold it to bin/ask's own rules. */
export function boardLanes(tasks: Task[], ideas: Idea[], order: string[], releases: Release[], now = Date.now(), days = 7): Omit<Board, "updated" | "sprint" | "size" | "days"> {
  const supersededBy = new Map<string, string>();
  for (const t of tasks) for (const old of Array.isArray(t.supersedes) ? t.supersedes : []) supersededBy.set(String(old), t.id);
  const folds = new Map<string, string[]>();
  for (const [old, by] of supersededBy) folds.set(by, [...(folds.get(by) ?? []), old]);
  const mine = tasks.filter(isOwner);
  const queue = mine.filter(t => OPEN.has(t.stage) && !supersededBy.has(t.id)).sort((a, b) => (created(a) ?? "").localeCompare(created(b) ?? ""));
  const card = (t: Task) => taskCard(t, folds.has(t.id) ? { folds: folds.get(t.id) } : {});
  const rank = new Map(order.map((id, i) => [id, i]));
  const pri = (t: Task) => t.priority === "P0" ? 0 : 1;
  const todo = queue.filter(t => t.stage === "specced" && (t.priority === "P0" || t.priority === "P1"))
    .sort((a, b) => (rank.get(a.id) ?? Infinity) - (rank.get(b.id) ?? Infinity) || pri(a) - pri(b) || (created(a) ?? "").localeCompare(created(b) ?? ""));
  const inTodo = new Set(todo.map(t => t.id));
  const specced = queue.filter(t => t.stage === "specced" && !inTodo.has(t.id));
  const building = queue.filter(t => t.stage !== "specced");

  const thoughts = mine.filter(t => t.stage === "thought" && !supersededBy.has(t.id)).map(t => taskCard(t));
  const farmed: BoardCard[] = ideas.filter(i => IDEA_ID.test(String(i.id)) && (i.status ?? "new") === "new")
    .map(i => ({ id: String(i.id), kind: "idea", title: text(i.text), his: text(i.his), at: text(i.at) || null, stage: "idea", by: text(i.by) || "an agent" }));
  const when = (c: BoardCard) => Date.parse(c.at ?? "") || 0;
  const ideaCards = [...thoughts, ...farmed].sort((a, b) => when(b) - when(a));

  // Landed: what went live in the last `days`, under the release that carried it (a sha in its evidence, else the newest
  // release at or before the time it went live).
  const since = now - days * 86_400_000;
  const byVersion = [...releases].sort((a, b) => b.version - a.version);
  const groups = new Map<number | null, LandedGroup>();
  const landed = mine.map(t => ({ t, at: liveAt(t.history) })).filter(({ t, at }) => LANDED.has(t.stage) && at && Date.parse(at) >= since)
    .sort((a, b) => Date.parse(b.at!) - Date.parse(a.at!));
  for (const { t, at } of landed) {
    const shas = shaIn(t);
    const release = byVersion.find(r => shas.some(s => r.sha.startsWith(s))) ?? byVersion.find(r => Date.parse(r.at) <= Date.parse(at!)) ?? null;
    const key = release?.version ?? null;
    const group = groups.get(key) ?? { version: key, at: release?.at ?? null, sha: release?.sha ?? null, cards: [] };
    group.cards.push(taskCard(t, { live_at: at, link: release ? { label: `v${release.version}`, url: `${REPO_URL}/commit/${release.sha}` } : null }));
    groups.set(key, group);
  }
  return {
    queue: queue.length,
    lanes: { ideas: ideaCards, specced: specced.map(card), todo: todo.map(card), building: building.map(card),
      landed: [...groups.values()].sort((a, b) => (b.version ?? -1) - (a.version ?? -1)) },
  };
}

// ---------------------------------------------------------------- the store

const workspace = () => process.env.AB_WORKSPACE ?? path.join(homedir(), "SISO_Workspace");
export const paths = () => {
  const tasks = process.env.AB_A0_TASKS ?? DEFAULT_ROOT;
  const cli = process.env.AB_A0_TASK_CMD ?? path.join(tasks, "..", "bin", "a0-task");
  return {
    tasks, cli,
    ask: process.env.AB_ASK_CMD ?? path.join(path.dirname(cli), "ask"),
    ideas: process.env.AB_IDEAS ?? path.join(workspace(), "SISO_Agency/apps/siso-internal-labs/siso-internal-labs-agents/research/ideas.jsonl"),
    order: process.env.AB_BOARD_ORDER ?? path.join(homedir(), ".local/state/agent-base/board-order.json"),
    card: path.join(process.env.AB_OWNER_CARDS ?? path.join(homedir(), ".local/state/a0/owners"), `${OWNER}.json`),
  };
};

/** Every task file, parsed again only when its stat changes (576 files; a poll stats them, it does not reread them). */
const taskCache = new Map<string, { stamp: string; value: Task | null }>();
async function readTasks(dir: string): Promise<Task[]> {
  const names = (await readdir(dir).catch(() => [] as string[])).filter(n => /^t-\d+\.json$/.test(n));
  const rows = await Promise.all(names.map(async n => {
    const file = path.join(dir, n);
    const s = await stat(file).catch(() => null);
    if (!s) return null;
    const stamp = `${s.ino}:${s.mtimeMs}:${s.size}`, hit = taskCache.get(file);
    if (hit?.stamp === stamp) return hit.value;
    let value: Task | null = null;
    try { const v = JSON.parse(await readFile(file, "utf8")); if (v && typeof v.id === "string" && typeof v.stage === "string") value = v; } catch { /* half-written: next poll */ }
    taskCache.set(file, { stamp, value });
    return value;
  }));
  return rows.filter((t): t is Task => Boolean(t));
}

async function readIdeas(file: string): Promise<Idea[]> {
  const raw = await readFile(file, "utf8").catch(() => "");
  return raw.split("\n").flatMap(l => { try { return l.trim() ? [JSON.parse(l)] : []; } catch { return []; } });
}

async function readOrder(file: string): Promise<string[]> {
  try { const v = JSON.parse(await readFile(file, "utf8")); return Array.isArray(v?.ids) ? v.ids.filter((id: unknown) => typeof id === "string" && TASK_ID.test(id)) : []; } catch { return []; }
}

async function readSprint(file: string): Promise<Sprint> {
  try {
    const c = JSON.parse(await readFile(file, "utf8"));
    return { status: text(c.status), summary: text(c.summary), next: text(c.next), updated: text(c.updated) };
  } catch { return null; }
}

export async function readBoard(repo: string, days = 7, now = Date.now()): Promise<Board> {
  const p = paths();
  const [tasks, ideas, order, sprint] = await Promise.all([readTasks(p.tasks), readIdeas(p.ideas), readOrder(p.order), readSprint(p.card)]);
  let releases: Release[] = [];
  try { releases = readReleases(repo).releases; } catch { /* no release log: landed cards go ungrouped */ }
  return { updated: new Date(now).toISOString(), sprint, size: SPRINT, days, ...boardLanes(tasks, ideas, order, releases, now, days) };
}

/** A card's spec (its links.spec file, else specs/<id>.md), confined to the workspace and to Markdown. */
export async function readSpec(id: string): Promise<string | null> {
  if (!TASK_ID.test(id)) return null;
  const p = paths();
  let task: Task | null = null;
  try { task = JSON.parse(await readFile(path.join(p.tasks, `${id}.json`), "utf8")); } catch { return null; }
  const roots = await Promise.all([workspace(), path.join(p.tasks, "..")].map(r => realpath(r).catch(() => null)));
  for (const candidate of [text(task?.links?.spec), path.join(p.tasks, "..", "specs", `${id}.md`)].filter(Boolean)) {
    const file = await realpath(candidate).catch(() => null);
    if (!file || !file.endsWith(".md") || !roots.some(r => r && file.startsWith(r + path.sep))) continue;
    const s = await stat(file).catch(() => null);
    if (s && s.size < 256_000) return readFile(file, "utf8");
  }
  return null;
}

// ---------------------------------------------------------------- his writes

const run = (cmd: string, args: string[]) => new Promise<{ ok: true; out: string } | { ok: false; error: string }>(done =>
  execFile(cmd, args, { timeout: 20_000, shell: false }, (e, out, err) => done(e ? { ok: false, error: (String(err).trim().split("\n").pop() || e.message).slice(0, 300) } : { ok: true, out: String(out) })));

/** A one-line title from his words: the first line, cut back to a whole word. */
export function titleOf(words: string) {
  const first = words.split("\n").find(l => l.trim())?.replace(/\s+/g, " ").trim() ?? "";
  if (first.length <= 100) return first;
  const cut = first.slice(0, 100), space = cut.lastIndexOf(" ");
  return `${(space > 50 ? cut.slice(0, space) : cut).replace(/[\s,;:.-]+$/, "")}…`;
}

async function writeOrder(file: string, ids: string[]) {
  await mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  await writeFile(tmp, JSON.stringify({ ids: [...new Set(ids)].slice(0, 500), updated: new Date().toISOString() }, null, 2) + "\n");
  await rename(tmp, file);
}

/** One ask through `bin/ask new` (stage specced, his words verbatim in the task and its spec); its id. */
async function newAsk(his: string, title: string, supersedes?: string) {
  const args = ["new", `--project=${PROJECT}`, `--owner=${OWNER}`, `--his=${his}`, ...(supersedes ? [`--supersedes=${supersedes}`] : []), "--", title];
  const r = await run(paths().ask, args);
  if (!r.ok) return r;
  const id = r.out.match(/\bt-\d+\b/)?.[0];
  return id ? { ok: true as const, id } : { ok: false as const, error: "bin/ask returned no task id." };
}

/** Marks a farm idea taken by its task, as `idea` does (whole file, then rename), retrying if a reader appended meanwhile. */
async function takeIdea(file: string, id: string, task: string) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const before = await stat(file);
    const rows = (await readFile(file, "utf8")).split("\n").filter(l => l.trim());
    const at = new Date().toISOString();
    const next = rows.map(l => { try { const r = JSON.parse(l); return r.id === id ? JSON.stringify({ ...r, status: "taken", task, updated: at }) : l; } catch { return l; } });
    const tmp = `${file}.${process.pid}.tmp`;
    await writeFile(tmp, next.join("\n") + "\n");
    const now = await stat(file);
    if (now.size === before.size && now.mtimeMs === before.mtimeMs) { await rename(tmp, file); return; }
  }
  throw new Error("The idea farm kept changing; try again.");
}

export type BoardWrite =
  | { op: "tell"; words: unknown; kind?: unknown }
  | { op: "make-task"; id: unknown }
  | { op: "todo"; id: unknown; on: unknown }
  | { op: "order"; ids: unknown };

/** POST /api/board/agent-base: his writes, one at a time, through bin/ask and a0-task (never a hand-edited task file). */
export function createBoardWriter() {
  let queue: Promise<unknown> = Promise.resolve();
  const one = async (w: BoardWrite): Promise<{ status: number; body: Record<string, unknown> }> => {
    const p = paths(), bad = (error: string) => ({ status: 400, body: { ok: false, error } });
    const fail = (error: string) => ({ status: 422, body: { ok: false, error } });
    if (w?.op === "tell") {
      const words = typeof w.words === "string" ? w.words.trim() : "";
      if (!words) return bad("Say what it is.");
      if (words.length > 4000) return bad("Keep it under 4000 characters.");
      if (w.kind === "idea") {
        const ideas = await readIdeas(p.ideas);
        const id = `i-${String(Math.max(0, ...ideas.map(i => Number(/^i-(\d+)$/.exec(String(i.id))?.[1] ?? 0))) + 1).padStart(3, "0")}`;
        const at = new Date().toISOString();
        await appendFile(p.ideas, JSON.stringify({ id, text: titleOf(words), by: "Shaan", his: words, why: null, score: null, status: "new", at, task: null, updated: at, source: "Agent Base board" }) + "\n");
        return { status: 200, body: { ok: true, id, lane: "ideas" } };
      }
      const made = await newAsk(words, titleOf(words));
      if (!made.ok) return fail(made.error);
      const set = await run(p.cli, ["set", made.id, "priority=P1", "--by=shaan"]);
      if (!set.ok) return fail(`${made.id} was made but not put in To do: ${set.error}`);
      await writeOrder(p.order, [made.id, ...await readOrder(p.order)]);
      return { status: 200, body: { ok: true, id: made.id, lane: "todo" } };
    }
    if (w?.op === "make-task") {
      const id = String(w.id ?? "");
      if (TASK_ID.test(id)) {
        const t = (await readTasks(p.tasks)).find(x => x.id === id);
        if (!t || !isOwner(t) || t.stage !== "thought") return bad("That idea is not waiting on Agent Base.");
        const made = await newAsk(text(t.his) || text(t.title), text(t.title), id);
        return made.ok ? { status: 200, body: { ok: true, id: made.id, lane: "specced" } } : fail(made.error);
      }
      if (!IDEA_ID.test(id)) return bad("Not an idea id.");
      const idea = (await readIdeas(p.ideas)).find(i => i.id === id);
      if (!idea || (idea.status ?? "new") !== "new") return bad("That idea is no longer open.");
      const made = await newAsk(text(idea.his) || `${text(idea.by) || "An agent"}'s idea (${id}): ${text(idea.text)}`, titleOf(text(idea.text)));
      if (!made.ok) return fail(made.error);
      await takeIdea(p.ideas, id, made.id);
      return { status: 200, body: { ok: true, id: made.id, lane: "specced" } };
    }
    if (w?.op === "todo") {
      const id = String(w.id ?? "");
      if (!TASK_ID.test(id)) return bad("Not a task id.");
      const set = await run(p.cli, ["set", id, `priority=${w.on ? "P1" : "P2"}`, "--by=shaan"]);
      if (!set.ok) return fail(set.error);
      const order = (await readOrder(p.order)).filter(x => x !== id);
      await writeOrder(p.order, w.on ? [...order, id] : order);
      return { status: 200, body: { ok: true, id, lane: w.on ? "todo" : "specced" } };
    }
    if (w?.op === "order") {
      const ids = Array.isArray(w.ids) ? w.ids.filter((x): x is string => typeof x === "string" && TASK_ID.test(x)) : [];
      if (!ids.length || ids.length !== (w.ids as unknown[]).length) return bad("Order is a list of task ids.");
      await writeOrder(p.order, [...ids, ...(await readOrder(p.order)).filter(x => !ids.includes(x))]);
      return { status: 200, body: { ok: true } };
    }
    return bad("Unknown board write.");
  };
  return (w: BoardWrite) => {
    const next = queue.then(() => one(w)).catch(e => ({ status: 500, body: { ok: false, error: String((e as Error)?.message ?? e).slice(0, 300) } }));
    queue = next;
    return next;
  };
}
