import { useEffect, useState } from "react";
import type { TaskIndex, TaskSummary } from "../components/widgets/TasksWidget";
import { changedReader } from "./fetch-changed";

/** Every viewer of Agent Zero's tasks shares one live copy: the node's SSE stream sends the whole index on each change. */
let current: TaskIndex | null = null;
let failed = false;
const listeners = new Set<() => void>();
let source: EventSource | null = null;
let poll: number | null = null;
let request = 0;
let controller: AbortController | null = null;
let readTimer: number | null = null;
const readTasks = changedReader();

/** Validate the shared transport before every viewer uses it. Unknown stages remain open. */
export function validTaskIndex(value: unknown): value is TaskIndex {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  if (typeof v.updated !== "string" || !Array.isArray(v.tasks) || !v.counts || typeof v.counts !== "object" || Array.isArray(v.counts)) return false;
  const counts = v.counts as Record<string, unknown>;
  if (!["by_stage", "by_project", "by_priority"].every(key => {
    const bucket = counts[key];
    return bucket === undefined || (bucket !== null && typeof bucket === "object" && !Array.isArray(bucket) &&
      Object.values(bucket).every(count => typeof count === "number" && Number.isSafeInteger(count) && count >= 0));
  })) return false;
  const ids = new Set<string>();
  return v.tasks.every((task: unknown) => {
    if (!task || typeof task !== "object") return false;
    const t = task as Record<string, unknown>;
    if (typeof t.id !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(t.id) || ids.has(t.id)) return false;
    ids.add(t.id);
    return ["title", "stage", "updated", "project", "priority"].every(key => typeof t[key] === "string") &&
      ["owner", "model", "next", "parent", "workspace", "agent", "his", "short", "live_at"].every(key => t[key] == null || typeof t[key] === "string") &&
      (t.needs == null || typeof t.needs === "boolean") &&
      (t.source == null || t.source === "available" || t.source === "unavailable");
  });
}

const publish = (value: TaskIndex | null, error = false) => {
  current = value ?? current;
  failed = error;
  for (const fn of listeners) fn();
};
const cancelRead = () => {
  ++request;
  controller?.abort();
  controller = null;
  if (readTimer !== null) window.clearTimeout(readTimer);
  readTimer = null;
};
const fetchOnce = async () => {
  if (!listeners.size) return;
  cancelRead();
  const owned = request;
  const pending = new AbortController();
  controller = pending;
  readTimer = window.setTimeout(() => {
    if (controller !== pending) return;
    cancelRead();
    publish(null, true);
  }, 15_000);
  try {
    const response = await readTasks("/api/a0/tasks", { signal: pending.signal });
    // t-0586: unchanged since the last read (423 KB, every 5 s in WebKit, which redrew the whole side nav).
    if (response === null) return;
    if (!response.ok) throw new Error(String(response.status));
    const value: unknown = await response.json().catch(e => { readTasks.reset(); throw e; });
    if (!validTaskIndex(value)) throw new Error("Invalid task index");
    if (owned === request && listeners.size) publish(value);
  } catch {
    readTasks.reset();
    if (owned === request && listeners.size) publish(null, true);
  } finally {
    if (controller === pending) {
      controller = null;
      if (readTimer !== null) window.clearTimeout(readTimer);
      readTimer = null;
    }
  }
};

function connect() {
  if (typeof EventSource === "undefined") {
    // No SSE here (never in WebKit): read every 5 s while the window is visible. Node's test imports this file, so no lib/poll.
    void fetchOnce();
    poll = window.setInterval(() => { if (!document.hidden && !controller) void fetchOnce(); }, 5_000);
    return;
  }
  void fetchOnce();
  const connected = source = new EventSource("/api/a0/tasks/events");
  connected.addEventListener("index", (e) => {
    if (source !== connected) return;
    // A stream snapshot supersedes any older HTTP read, including reconnect reads.
    cancelRead();
    try {
      const value: unknown = JSON.parse((e as MessageEvent<string>).data);
      if (!validTaskIndex(value)) throw new Error("Invalid task index");
      publish(value);
    } catch {
      publish(null, true);
    }
  });
  connected.addEventListener("error", () => {
    if (source !== connected) return;
    cancelRead();
    publish(null, true);
  });
  // EventSource reconnects by itself; a re-read on reconnect covers changes made while it was down.
  connected.addEventListener("open", () => { if (source === connected) void fetchOnce(); });
}
function disconnect() {
  source?.close();
  source = null;
  cancelRead();
  if (poll !== null) window.clearInterval(poll);
  poll = null;
  // A later viewer may use the cached rows, but they need a fresh read before editing.
  if (current) failed = true;
}

/** Agent Zero's task index, live (a0-task add/move shows within about a second). null before the first success; failed also marks retained rows as stale. */
export function useA0Tasks(): { index: TaskIndex | null; failed: boolean } {
  const [, bump] = useState(0);
  useEffect(() => {
    const fn = () => bump((n) => n + 1);
    listeners.add(fn);
    if (listeners.size === 1) connect();
    return () => {
      listeners.delete(fn);
      if (!listeners.size) disconnect();
    };
  }, []);
  return { index: current, failed };
}

/** Put his words on Agent Zero's task list. */
export async function tellA0(text: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const r = await fetch("/api/a0/tell", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text }) });
    const body = (await r.json().catch(() => ({}))) as { ok?: boolean; error?: string };
    return r.ok && body.ok ? { ok: true } : { ok: false, error: body.error ?? `The node said ${r.status}` };
  } catch {
    return { ok: false, error: "No answer from the node" };
  }
}

const PRIORITY_RANK: Record<string, number> = { P0: 0, P1: 1, P2: 2, P3: 3 };
export const priorityRank = (p: string) => PRIORITY_RANK[p] ?? 9;

/** The spec's numbered "**Label:** body" items (A0's Opus spec format), by lower-case label. */
export function specParts(md: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /^\s*\d+\.\s+\*\*([^*]+?):?\*\*:?\s*([\s\S]*?)(?=^\s*\d+\.\s+\*\*|(?![\s\S]))/gm;
  for (const m of md.matchAll(re)) out[m[1].trim().toLowerCase()] = m[2].trim();
  return out;
}

// ---------------------------------------------------------------- an owner's list (R1.17)

/** The a0-task CLI's flywheel, in order (bin/a0-task STAGES; "integrated" is its old name for live). */
export const FLYWHEEL = ["thought", "specced", "allocated", "building", "built", "tested", "preview", "live", "feedback", "happy", "rework"] as const;
const DONE = new Set(["done", "live", "integrated", "happy", "dropped"]);
export const isDone = (t: { stage: string }) => DONE.has(t.stage);
/** The Tasks page's two tabs: open work by stage, and Done (live, integrated, happy) with dropped kept apart under a fold. */
export function taskTabs<T extends { stage: string }>(tasks: T[]): { open: T[]; done: T[]; dropped: T[] } {
  const out = { open: [] as T[], done: [] as T[], dropped: [] as T[] };
  for (const t of tasks) (t.stage === "dropped" ? out.dropped : isDone(t) ? out.done : out.open).push(t);
  return out;
}
export const isNow = (t: { next?: string | null }) => /^\s*NOW:/i.test(t.next ?? "");
/** A0's backlog triage parks a task by starting its next with "PARKED"; a parked task never asks for him. */
export const isParked = (t: { next?: string | null }) => /^\s*PARKED\b/i.test(t.next ?? "");
/** The names a task's owner field gives, upper-cased: "AGENT-BASE + A0" → both, "STREAMING-CLAUDE (AUTO-VIEWER)" → STREAMING-CLAUDE. */
export function ownerNames(owner: string | null | undefined): string[] {
  return String(owner ?? "")
    .split(/[+,/]/)
    .map((s) => s.replace(/\([^)]*\)\s*$/, "").trim().toUpperCase())
    .filter(Boolean);
}
/** One worker, one name (HUB-DESIGN data rule): the text after the last "| ", without luna-/sol-, upper-cased. */
export const canonName = (name: string) => (name.split("| ").pop() ?? name).trim().replace(/^(luna|sol)-/i, "").toUpperCase();
const stageAt = (s: string) => FLYWHEEL.indexOf((s === "integrated" ? "live" : s) as (typeof FLYWHEEL)[number]);
/** NOW first, then P0 → P3, then the furthest stage first. */
export function orderTasks<T extends TaskSummary>(list: T[]): T[] {
  return [...list].sort((a, b) => Number(isNow(b)) - Number(isNow(a)) || priorityRank(a.priority) - priorityRank(b.priority) || stageAt(b.stage) - stageAt(a.stage) || a.id.localeCompare(b.id));
}
/** Commitments only; retain an orphan whose parent is missing from the store. */
export function taskRoots<T extends TaskSummary>(tasks: T[]): T[] {
  const ids = new Set(tasks.map((t) => t.id));
  return tasks.filter((t) => !t.parent || !ids.has(t.parent));
}
/** The tasks an agent owns (every task for Agent Zero), in list order. */
/** A name for matching only: "AGENT-BASE", "AGENT BASE" and "agent_base" are one seat. */
export const nameKey = (name: string) => name.toUpperCase().replace(/[^A-Z0-9]/g, "");
export function tasksOf<T extends TaskSummary>(tasks: T[], name: string, everyone = false): T[] {
  const me = nameKey(canonName(name));
  // An agent's board is what it owns and what it is doing for another owner (the seat AGENT BASE UI works AGENT-BASE's tasks).
  // Compared without spaces or punctuation: the chat "AGENT BASE" owns the board's "AGENT-BASE" (5 Oct: its Tasks card said 0 open).
  return orderTasks(everyone ? tasks : tasks.filter((t) => ownerNames(t.owner).some((n) => nameKey(n) === me) || (!!t.agent && nameKey(canonName(t.agent)) === me)));
}
/** Open tasks per owner name, for the side nav's counts. */
export function openCounts(tasks: TaskSummary[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const t of tasks) if (!isDone(t)) for (const n of new Set(ownerNames(t.owner))) out.set(n, (out.get(n) ?? 0) + 1);
  return out;
}
export type TaskEdit = { stage?: string; priority?: string; next?: string; reason?: string };
/** One edit through the node's a0-task route (POST /api/a0/tasks/:id). */
export async function saveTask(id: string, edit: TaskEdit): Promise<{ ok: boolean; error?: string }> {
  if (failed) return { ok: false, error: "Task refresh unavailable. Wait for a current task list before saving." };
  try {
    const r = await fetch(`/api/a0/tasks/${encodeURIComponent(id)}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(edit) });
    const body = (await r.json().catch(() => ({}))) as { ok?: boolean; error?: string };
    const accepted = r.ok && body.ok === true;
    // Refresh counts from the accepted store write; never infer a completed stage before the node accepts it.
    if (accepted) void fetchOnce();
    return accepted ? { ok: true } : { ok: false, error: body.error ?? `The node said ${r.status}` };
  } catch {
    return { ok: false, error: "No answer from the node" };
  }
}

/**
 * The agents an open task marked needs-Shaan names (canonical names): the side nav's "needs you" (sidenav spec D3). Landed
 * work waiting for his look (preview, feedback) is the Tasks page's "Your turn", not a block: Shaan 5 Oct, "it says it
 * needs me but i don't understand what needs me" (AGENT BASE showed amber while working, from "Shaan tries ..." next lines).
 */
export function needsNames(tasks: TaskSummary[]): Set<string> {
  return new Set(tasks.filter((t) => t.needs && !isDone(t) && !isParked(t) && t.stage !== "preview" && t.stage !== "feedback").flatMap((t) => ownerNames(t.owner).map(canonName)));
}

// ---------------------------------------------------------------- the one list (SPEC-STATS-TASKS §4.1, option A)

/** Needs you: an open task that waits on him (the node's needsHim). It also sits in Now, first in its project. */
export const needsYou = (t: { stage: string; needs?: boolean }) => !!t.needs && !isDone(t);
/**
 * The switch's three lists and the dropped fold. Now is every task not live, happy, integrated or dropped (built and tested
 * stay in Now: they are not live yet); Needs you is the part of Now that waits on him; Done is live, happy and integrated.
 * now + done + dropped is every task, so nothing in the index is unreachable.
 */
export function taskSplit<T extends { stage: string; needs?: boolean }>(tasks: T[]) {
  const { open, done, dropped } = taskTabs(tasks);
  return { now: open, needs: open.filter(needsYou), done, dropped };
}
/** When a task went live (the node's live_at), else when it last changed: the Done tab's day. */
export const liveTime = (t: { live_at?: string | null; updated: string }) => t.live_at || t.updated;
/** "Today", "Yesterday" or "Earlier", on this Mac's clock. */
export function dayGroup(iso: string, now = new Date()): "Today" | "Yesterday" | "Earlier" {
  const d = new Date(iso);
  if (Number.isNaN(d.valueOf())) return "Earlier";
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).valueOf();
  return d.valueOf() >= start ? "Today" : d.valueOf() >= start - 86_400_000 ? "Yesterday" : "Earlier";
}
/** A row's order: what needs him, then P0 → P3, then the furthest stage, then the newest. */
export function rowOrder<T extends TaskSummary>(list: T[]): T[] {
  return [...list].sort((a, b) => Number(needsYou(b)) - Number(needsYou(a)) || priorityRank(a.priority) - priorityRank(b.priority) || stageAt(b.stage) - stageAt(a.stage) || b.updated.localeCompare(a.updated));
}
/** One group per project: those with something that needs him first, then the most rows. */
export function byProject<T extends TaskSummary>(list: T[]): { project: string; tasks: T[]; needs: number }[] {
  const groups = new Map<string, T[]>();
  for (const t of list) groups.set(t.project || "No project", [...(groups.get(t.project || "No project") ?? []), t]);
  return [...groups].map(([project, tasks]) => ({ project, tasks: rowOrder(tasks), needs: tasks.filter(needsYou).length }))
    .sort((a, b) => Number(b.needs > 0) - Number(a.needs > 0) || b.tasks.length - a.tasks.length || a.project.localeCompare(b.project));
}
/** What a needs-you task waits on, as a sentence: "NEEDS HIM: sign in" → "Sign in"; "PARKED: …" → "Parked: …". */
export function needWhat(next: string | null | undefined): string {
  const text = String(next ?? "").replace(/\s+/g, " ").trim();
  const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);
  const parked = /^PARKED\b[\s:·—-]*/i.exec(text);
  if (parked) return `Parked: ${text.slice(parked[0].length) || "waiting on your call"}`;
  const asks = /\bneeds (him|shaan)\b[\s:·—-]*/i.exec(text);
  if (asks) return cap(text.slice(asks.index + asks[0].length).replace(/^\((.*)\)$/, "$1")) || "Your call";
  return cap(text.replace(/^(NOW|NEXT)\s*:\s*/i, "")) || "Your call";
}
/** Search: his words, the title, the owner or the id (case-insensitive, every word must match). */
export function taskMatches(t: TaskSummary, q: string): boolean {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const hay = [t.his, t.title, t.short, t.owner, t.id].filter(Boolean).join(" ").toLowerCase();
  return words.every((w) => hay.includes(w));
}
