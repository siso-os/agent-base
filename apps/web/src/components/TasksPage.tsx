import { TaskActions, TaskActionReceipts } from "./TaskActions";
import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ArrowLeft, PanelLeftOpen, Search, Send } from "lucide-react";
import { AgentFace } from "../lib/face";
import { type TaskSummary } from "./widgets/TasksWidget";
import { FLYWHEEL, canonName, dayGroup, liveTime, needWhat, needsYou, ownerNames, saveTask, specParts, taskMatches, taskRoots, taskSplit, tellA0, useA0Tasks } from "../lib/a0-tasks";
import { TaskWorkspaceGroups } from "./TaskWorkspaceGroups";
import { taskAncestorContext, useTaskWorkspaces } from "../lib/task-workspaces";
import "./TasksPage.css";

type TaskDetail = TaskSummary & {
  intent?: unknown[]; agent?: string | null;
  links?: Record<string, string | null>; evidence?: unknown[];
  history?: { at?: string; stage?: string; by?: string; note?: string; evidence?: string; his?: string }[];
  spec_md?: string;
};
type Tab = "now" | "needs" | "done";
export type TaskFocus = { id?: string; stages?: string[]; needs?: boolean };
/** Who a face belongs to: the agent's own hub project, so it matches the side nav. */
type Who = { name: string; project?: string | null };

const label = (stage: string) => stage[0].toUpperCase() + stage.slice(1);
const ago = (value: string) => {
  const ms = Date.now() - new Date(value).valueOf();
  if (Number.isNaN(ms)) return "";
  const m = Math.max(0, Math.floor(ms / 60_000));
  return m < 1 ? "now" : m < 60 ? `${m} min` : m < 1440 ? `${Math.floor(m / 60)} h` : `${Math.floor(m / 1440)} d`;
};
const clock = (value?: string) => {
  const d = value ? new Date(value) : null;
  return d && !Number.isNaN(d.valueOf()) ? d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }) : "";
};
const when = (value?: string) => {
  const d = value ? new Date(value) : null;
  return d && !Number.isNaN(d.valueOf()) ? d.toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : value || "—";
};
const ownerName = (owner: string | null) => ownerNames(owner)[0] || "Unassigned";
/** His words without the quote marks they were filed with (the row draws its own). */
/** A task's owner as a face: building works, waiting on him needs him, built or tested is done, the rest waits. */
const faceStatus = (t: TaskSummary) => needsYou(t) ? "needs-shaan" as const : t.stage === "building" ? "working" as const : t.stage === "built" || t.stage === "tested" ? "done" as const : "waiting" as const;
const BUILT = new Set(["built", "tested", "preview"]);
/** The open row's track: the flywheel's six steps a task moves through (tested and preview sit at built). */
const TRACK = ["thought", "specced", "allocated", "building", "built", "live"] as const;
const trackAt = (stage: string) => TRACK.indexOf((BUILT.has(stage) ? "built" : ["integrated", "happy", "feedback"].includes(stage) ? "live" : stage === "rework" ? "building" : stage) as (typeof TRACK)[number]);
const SHOWN = 5;

/** The spec's parts he cares about first; the rest stays one click away. Acceptance usually sits inside "Spec". */
function SpecSections({ md }: { md: string }) {
  const parts = specParts(md);
  const wants = Object.entries(parts).find(([k]) => /what he .*wants/.test(k))?.[1];
  const decision = parts.decision;
  const spec = parts.spec ?? "";
  const cut = spec.search(/\bAcceptance:\s*/i);
  const acceptance = parts.acceptance ?? (cut >= 0 ? spec.slice(cut).replace(/^Acceptance:\s*/i, "") : "");
  const md2 = (text: string) => <ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown>;
  return <>
    {wants && <section><h3>What he wants</h3><div className="a0-task-md">{md2(wants)}</div></section>}
    {decision && <section><h3>Decision</h3><div className="a0-task-md">{md2(decision)}</div></section>}
    {acceptance && <section><h3>Acceptance</h3><div className="a0-task-md">{md2(acceptance)}</div></section>}
    <details className="a0-task-spec"><summary>The full spec</summary><div className="a0-task-md">{md2(md)}</div></details>
  </>;
}

function TellBox() {
  const [text, setText] = useState("");
  const [state, setState] = useState<{ kind: "idle" | "sending" | "sent" | "error"; note?: string }>({ kind: "idle" });
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const line = text.trim();
    if (!line || state.kind === "sending") return;
    setState({ kind: "sending" });
    const r = await tellA0(line);
    if (r.ok) {
      setText("");
      setState({ kind: "sent", note: "On Agent Zero's task list." });
    } else setState({ kind: "error", note: r.error });
  };
  return <form className="a0-tell" onSubmit={submit}>
    <input value={text} onChange={(e) => { setText(e.target.value); if (state.kind !== "sending") setState({ kind: "idle" }); }} placeholder="Tell Agent Zero a task…" aria-label="Tell Agent Zero a task" />
    <button type="submit" aria-label={state.kind === "sending" ? "Sending" : "Send"} title="Send" disabled={!text.trim() || state.kind === "sending"}><Send size={14} /></button>
    {state.note && <span className={`a0-tell__note is-${state.kind}`} role="status">{state.note}</span>}
  </form>;
}

/** A project's (or a day's) stages as one 120 px segmented bar (rule 6). */
function StageBar({ tasks }: { tasks: TaskSummary[] }) {
  const counts = [...tasks.reduce((m, t) => m.set(needsYou(t) ? "needs" : t.stage, (m.get(needsYou(t) ? "needs" : t.stage) ?? 0) + 1), new Map<string, number>())]
    .sort((a, b) => FLYWHEEL.indexOf(a[0] as never) - FLYWHEEL.indexOf(b[0] as never));
  return <span className="ab-tgroup__bar" aria-hidden="true">{counts.map(([s, n]) => <i key={s} className={`is-${s}`} style={{ flexGrow: n }} title={`${n} ${s === "needs" ? "need you" : s}`} />)}</span>;
}

/** The one line under his words: our short title, then what it waits on, how long built has waited, or what is next. */
function Clause({ t }: { t: TaskSummary }) {
  const title = "";
  const extra = needsYou(t) ? <em className="is-needs">Needs you: {t.next?.trim() ? needWhat(t.next) : `Next action not recorded — ${ownerName(t.owner)} needs to specify it.`}</em>
    : BUILT.has(t.stage) ? <em>{t.stage} {ago(t.updated)} ago, not live yet</em>
    : t.live_at ? <em>live {clock(t.live_at)}</em>
    : t.next?.trim() ? <em>{/^\s*NOW:/i.test(t.next) ? "Now" : "Next"}: {t.next.replace(/^\s*(NOW|NEXT):\s*/i, "")}</em> : null;
  if (!title && !extra) return null;
  return <small className="ab-trow__sub">{title}{title && extra ? " · " : ""}{extra}</small>;
}

function Row({ t, who, open, onToggle, onOpenAgent }: { t: TaskSummary; who: Who | null; open: boolean; onToggle: () => void; onOpenAgent?: (name: string) => void }) {
  const owner = ownerName(t.owner);
  return <li className={`ab-trow is-${t.stage}${needsYou(t) ? " is-needs" : ""}${t.priority === "P0" ? " is-p0" : ""}${open ? " is-open" : ""}`} data-id={t.id} data-testid="task-row">
    <button type="button" className="ab-trow__line" aria-expanded={open} onClick={onToggle}>
      <i className="ab-trow__dot" title={`${needsYou(t) ? "needs you" : t.stage} · ${t.priority}`} aria-label={`${needsYou(t) ? "needs you" : t.stage} · ${t.priority}`} />
      <span className="ab-trow__words">
        <span className="his is-title">{t.title}</span>
        <Clause t={t} />
        <small className="ab-trow__sub">{t.project || "Project not recorded"} · {t.stage} · Owner: {owner}{t.agent ? ` · Executor: ${t.agent}` : ""}</small>
        {(t as TaskSummary & { source?: string }).source === "unavailable" && <small role="status" className="ab-trow__sub">Task source unavailable; showing index metadata.</small>}
      </span>
      <span className="ab-trow__owner" title={t.owner ?? "Unassigned"}>
        <AgentFace name={owner} project={who?.project ?? t.project} status={faceStatus(t)} size={22} />
        <b>{owner}</b>
        <em>{ago(t.updated)}</em>
      </span>
    </button>
    {(open || t.stage === "preview" || t.stage === "feedback") && <TaskActions task={t} />}
    {open && <TaskOpen t={t} who={who} onOpenAgent={onOpenAgent} />}
  </li>;
}

/** Canonicalize the observed task only, including server-enriched fields not in the frontend type. */
function taskDetailScope(task: TaskSummary): string {
  const stable = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(stable);
    if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map(key => [key, stable((value as Record<string, unknown>)[key])]));
    return value;
  };
  return JSON.stringify(stable(task));
}

/** A row opened in place: the track, Next and Lately, the spec folded, and its actions (one orange: the owner's chat). */
function TaskOpen({ t, who, onOpenAgent }: { t: TaskSummary; who: Who | null; onOpenAgent?: (name: string) => void }) {
  // The index can change within one timestamp tick. Bind detail to the displayed
  // task scope, while leaving local controls/drafts mounted across a refresh.
  const detailScope = taskDetailScope(t);
  const [read, setRead] = useState<{ scope: string; detail: TaskDetail | null; error: string } | null>(null);
  const detail = read?.scope === detailScope ? read.detail : null;
  const error = read?.scope === detailScope ? read.error : "";
  const [spec, setSpec] = useState(false);
  const [moving, setMoving] = useState(false);
  const [dropping, setDropping] = useState<string | null>(null);
  const [saving, setSaving] = useState("");
  // Re-read when the index says the task changed (a move shows here too).
  useEffect(() => {
    let active = true;
    setRead({ scope: detailScope, detail: null, error: "" });
    void fetch(`/api/a0/tasks/${encodeURIComponent(t.id)}`, { cache: "no-store" }).then(async (r) => {
      if (!r.ok) throw new Error(r.status === 404 ? "Task not found." : "Task details are unavailable.");
      const value = await r.json();
      if (!value || value.id !== t.id || typeof value.title !== "string" || typeof value.stage !== "string") throw new Error("Task details are invalid.");
      return value as TaskDetail;
    }).then((v) => { if (active) setRead({ scope: detailScope, detail: v, error: "" }); }).catch((e: unknown) => { if (active) setRead({ scope: detailScope, detail: null, error: e instanceof Error ? e.message : "Task details unavailable." }); });
    return () => { active = false; };
  }, [t.id, detailScope]);
  const save = async (edit: Parameters<typeof saveTask>[1]) => {
    setSaving("Saving…");
    const r = await saveTask(t.id, edit);
    setSaving(r.ok ? "" : r.error ?? "Not saved.");
    if (r.ok) { setMoving(false); setDropping(null); }
  };
  const at = trackAt(t.stage);
  const next = (detail?.next ?? "").replace(/^\s*(NOW|NEXT)\s*:\s*/i, "").trim();
  return <div className="ab-topen" data-testid="task-open">
    <ol className="ab-topen__track" aria-label={`Stage: ${t.stage}`}>{TRACK.map((s, i) => <li key={s} className={i === at ? "is-here" : i < at ? "is-past" : ""}>{s}</li>)}</ol>
    {error ? <p role="alert" className="ab-topen__none">{error}</p> : !detail ? <p className="ab-topen__none">Reading the task…</p> : <>
      <p className="ab-topen__none">Owner: {ownerName(detail.owner)} · Executor: {detail.agent || "Not recorded"}{detail.parent ? ` · Parent: ${detail.parent}` : ""}</p>
      <div className="ab-topen__cols">
        <section><h3>Next</h3>{next ? <div className="a0-task-md"><ReactMarkdown remarkPlugins={[remarkGfm]}>{needsYou(t) ? needWhat(detail.next) : next[0].toUpperCase() + next.slice(1)}</ReactMarkdown></div> : <p className="ab-topen__none">Nothing written down.</p>}</section>
        <section><h3>Lately</h3>{detail.history?.length ? <ol className="ab-topen__lately">{detail.history.slice(-3).reverse().map((h, i) => <li key={`${h.at}-${i}`}><span>{when(h.at)} · {h.by || "A0"}</span><p>{h.note || (h.stage ? `Moved to ${h.stage}` : "—")}</p></li>)}</ol> : <p className="ab-topen__none">No history recorded.</p>}</section>
      </div>
      {detail.spec_md && <details className="ab-topen__spec" open={spec} onToggle={(e) => setSpec((e.target as HTMLDetailsElement).open)}><summary>The spec</summary><SpecSections md={detail.spec_md} /></details>}
      <details className="ab-topen__spec"><summary>Evidence and full history</summary>
        <div className="a0-task-md">
          {(Array.isArray(detail.evidence) ? detail.evidence : []).filter(e => typeof e === "string").map((e, i) => <ReactMarkdown key={`e${i}`} remarkPlugins={[remarkGfm]}>{String(e)}</ReactMarkdown>)}
          {(detail.history ?? []).map((h, i) => <p key={i}>{when(h.at)} · {h.by} · {h.stage} · {h.note || h.his || ""}{h.evidence ? ` · ${h.evidence}` : ""}</p>)}
          {Object.entries(detail.links ?? {}).filter(([, v]) => v).map(([k, v]) => <p key={k}>{k}: {v}</p>)}
        </div>
      </details>
    </>}
    <div className="ab-topen__acts">
      {who && onOpenAgent && <button type="button" className="ab-topen__chat" onClick={() => onOpenAgent(who.name)}>Open {ownerName(t.owner)}'s chat</button>}
      {detail?.spec_md && <button type="button" onClick={() => setSpec((v) => !v)}>The spec</button>}
      {detail && (moving ? <select aria-label="Move to stage" autoFocus defaultValue="" onChange={(e) => e.target.value && void save({ stage: e.target.value })} onBlur={() => setMoving(false)}>
        <option value="" disabled>Move to…</option>
        {FLYWHEEL.filter((s) => s !== t.stage).map((s) => <option key={s} value={s}>{label(s)}</option>)}
      </select> : <button type="button" onClick={() => setMoving(true)}>Move to…</button>)}
      {detail && (dropping === null ? <button type="button" onClick={() => setDropping("")}>Drop</button> : <form className="ab-topen__drop" onSubmit={(e) => { e.preventDefault(); if (dropping.trim()) void save({ stage: "dropped", reason: dropping.trim() }); }}>
        <input autoFocus value={dropping} onChange={(e) => setDropping(e.target.value)} placeholder="Why drop it?" aria-label="Why drop it" />
        <button type="submit" disabled={!dropping.trim()}>Drop it</button>
      </form>)}
      {saving && <span className="ab-topen__saving" role="status">{saving}</span>}
      <span className="ab-topen__meta">{ownerName(t.owner).toUpperCase()}{t.agent ? ` · executor ${t.agent}` : ""} · {t.priority} · {t.id}</span>
    </div>
  </div>;
}

/** "59 open · 1 needs you": the popped-out header's one line (the same live index). */
export function TasksAnswer() {
  const { index } = useA0Tasks();
  if (!index) return null;
  const { now, needs } = taskSplit(index.tasks);
  return <>{taskRoots(now).length} open roots · {now.length - taskRoots(now).length} child steps{needs.length ? <> · <b className="ab-tasks__needs">{needs.length} need{needs.length === 1 ? "s" : ""} you</b></> : null}</>;
}

/**
 * Agent Zero's tasks as one list (SPEC-STATS-TASKS §4.1, option A; Shaan 3 Oct 00:15: "i can't really see shit from this
 * it's kind of like cut off"): his words in full, registry workspace/owner dropdowns, a switch Now · Needs you · Done. Every task in the
 * index is reachable: Now (with Needs you inside it), Done by the day it went live, and dropped under one quiet line.
 * The same component fills the page and the popped-out column; a container query switches its layout at 470 px.
 */
export function TasksPage({ onBack, backLabel = "Agent Zero", focus = null, onClearFocus, host = "page", agents = [], onPop, onOpenAgent }: {
  onBack?: () => void; backLabel?: string;
  /** A task to open in place and scroll to (an owner's list's "Full detail ›"). */
  focus?: TaskFocus | null;
  onClearFocus?: () => void;
  host?: "page" | "pop";
  /** The live agents, so an owner's face takes its own project's hue and its chat can open. */
  agents?: Who[];
  onPop?: () => void;
  onOpenAgent?: (name: string) => void;
}) {
  const { index, failed } = useA0Tasks();
  const { registry, failed: registryFailed, loaded: registryLoaded } = useTaskWorkspaces(index?.updated);
  const [picked, setPicked] = useState<Tab>("now");
  const [query, setQuery] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [showDropped, setShowDropped] = useState(false);
  const search = useRef<HTMLInputElement>(null);
  const root = useRef<HTMLElement>(null);

  const all = index?.tasks ?? [];
  const scoped = useMemo(() => all.filter((t) => (!focus?.stages || focus.stages.includes(t.stage)) && (!focus?.needs || needsYou(t))), [index, focus]);
  const totals = useMemo(() => taskSplit(scoped), [scoped]);
  const shown = useMemo(() => taskSplit(scoped.filter(t => taskMatches(t, query))), [scoped, query]);
  const tab: Tab = picked;
  const pick = (t: Tab) => {
    setPicked(t);
  };
  const today = totals.done.filter((t) => t.stage !== "done" && dayGroup(liveTime(t)) === "Today").length;
  const openRoots = taskRoots(totals.now).length;
  const whoOf = (t: TaskSummary): Who | null => {
    const names = ownerNames(t.owner).map(canonName);
    return agents.find((a) => names.includes(canonName(a.name))) ?? null;
  };

  // `focus`: switch to where the task lives, unfold its group, open it and scroll to it.
  useEffect(() => {
    if (!index) return;
    setQuery("");
    setOpenId(null);
    if (!focus) return;
    if (!focus.id) {
      pick(focus.needs ? "needs" : totals.done.length && !totals.now.length ? "done" : "now");
      return;
    }
    const t = index.tasks.find((x) => x.id === focus.id);
    if (!t) return;
    if (t.stage === "dropped") { pick("done"); setShowDropped(true); setExpanded((s) => new Set(s).add("dropped")); }
    else if (totals.done.includes(t)) { pick("done"); setExpanded((s) => new Set(s).add(dayGroup(liveTime(t)))); }
    else { pick(needsYou(t) && tab === "needs" ? "needs" : "now"); setExpanded((s) => new Set(s).add(t.project || "No project")); }
    setOpenId(t.id);
    const timer = window.setTimeout(() => root.current?.querySelector(`[data-id="${CSS.escape(t.id)}"]`)?.scrollIntoView({ block: "center" }), 60);
    return () => window.clearTimeout(timer);
  }, [focus, !!index]);
  // Esc closes the open row (before anything around it hears it); "/" goes to search.
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape" && openId && (document.activeElement === document.body || root.current?.contains(document.activeElement))) { e.stopPropagation(); e.preventDefault(); setOpenId(null); }
      else if (e.key === "/" && !(e.target as HTMLElement)?.closest?.("input, textarea, select, [contenteditable]") && root.current?.offsetParent) { e.preventDefault(); search.current?.focus(); }
    };
    window.addEventListener("keydown", key, true);
    return () => window.removeEventListener("keydown", key, true);
  }, [openId]);

  const toggle = (key: string) => setExpanded((s) => { const n = new Set(s); if (n.has(key)) n.delete(key); else n.add(key); return n; });
  const rows = (list: TaskSummary[], key: string, more: (n: number) => string) => {
    const all = expanded.has(key) || query ? list : list.slice(0, SHOWN);
    return <>
      <ol className="ab-tgroup__rows">{all.map((t) => <Row key={t.id} t={t} who={whoOf(t)} open={openId === t.id} onToggle={() => setOpenId(openId === t.id ? null : t.id)} onOpenAgent={onOpenAgent} />)}</ol>
      {list.length > SHOWN && !query && <button type="button" className="ab-tgroup__more" aria-expanded={expanded.has(key)} onClick={() => toggle(key)}>{expanded.has(key) ? "Show fewer" : more(list.length - SHOWN)}</button>}
    </>;
  };
  const selected = tab === "needs" ? shown.needs : shown.now;
  const selectedIds = new Set(selected.map(t => t.id));
  const list = taskAncestorContext(selected, all);
  const taskRow = (t: TaskSummary, seen = new Set<string>()): ReactNode => {
    if (seen.has(t.id)) return <p role="status" className="ab-tasks__context">Hierarchy cycle at {t.id}; review parent links.</p>;
    const next = new Set(seen).add(t.id);
    const children = list.filter(child => child.parent === t.id);
    return <>
      {!selectedIds.has(t.id) && <p className="ab-tasks__context">Parent context · {t.id} · outside this filter</p>}
      {t.parent && !all.some(parent => parent.id === t.parent) && <p className="ab-tasks__context">Parent {t.parent} unavailable in the task index</p>}
      <ol className="ab-tgroup__rows"><Row t={t} who={whoOf(t)} open={openId === t.id} onToggle={() => setOpenId(openId === t.id ? null : t.id)} onOpenAgent={onOpenAgent} /></ol>
      {!!children.length && <div className="ab-task-workspace__children" aria-label={`Child steps of ${t.id}`}>{children.map(child => <div key={child.id}>{taskRow(child, next)}</div>)}</div>}
    </>;
  };
  const days = useMemo(() => {
    const out = new Map<string, TaskSummary[]>([["Today", []], ["Yesterday", []], ["Earlier", []]]);
    for (const t of [...shown.done].sort((a, b) => liveTime(b).localeCompare(liveTime(a)))) out.get(dayGroup(liveTime(t)))!.push(t);
    return [...out].filter(([, ts]) => ts.length);
  }, [shown.done]);

  return <main ref={root} className="ab-tasks" data-host={host} data-testid="a0-tasks-page">
    {host === "page" && <nav className="ab-tasks__crumb" aria-label="Breadcrumb">
      <button type="button" onClick={onBack} aria-label={`Back to ${backLabel}`}><ArrowLeft size={14} />{backLabel}</button><span aria-hidden="true">›</span><b>Tasks</b>
    </nav>}
    <header className="ab-tasks__head">
      {host === "page" && <div className="ab-tasks__title">
        <h1>Tasks</h1>
        <p data-testid="tasks-sentence">{index ? <><b>{openRoots} open roots</b> · {totals.now.length - openRoots} child steps{totals.needs.length ? <> · <b className="ab-tasks__needs">{totals.needs.length} need{totals.needs.length === 1 ? "" : "s"} you</b></> : null} · {today} went live today</> : failed ? "Agent Zero's task index is unavailable." : "Reading Agent Zero's tasks…"}</p>
      </div>}
      <div className="ab-tasks__tools">
        <span className="ab-tasks__switch" role="tablist" aria-label="Which tasks">
          <button type="button" role="tab" data-tab="now" aria-selected={tab === "now"} onClick={() => pick("now")}>Now<b>{shown.now.length}</b></button>
          <button type="button" role="tab" data-tab="needs" aria-selected={tab === "needs"} className="is-needs" onClick={() => pick("needs")}>Needs you<b>{shown.needs.length}</b></button>
          <button type="button" role="tab" data-tab="done" aria-selected={tab === "done"} onClick={() => pick("done")}>Done<b>{shown.done.filter((t) => dayGroup(liveTime(t)) === "Today").length}</b><small>today</small></button>
        </span>
        {(focus?.stages || focus?.needs) && <button type="button" className="ab-tasks__pop" onClick={() => { onClearFocus?.(); pick("now"); }} aria-label="Clear task filter">{focus.stages ? focus.stages.map(label).join(" / ") : "Needs you"} · Clear</button>}
        <label className="ab-tasks__search"><Search size={13} aria-hidden="true" /><input ref={search} type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search  /" aria-label="Search tasks: his words, title, owner or id" /></label>
        {host === "page" && onPop && <button type="button" className="ab-tasks__pop" onClick={onPop} title="Pop out beside the side nav · ⌥-click Tasks"><PanelLeftOpen size={14} aria-hidden="true" />Pop out</button>}
      </div>
    </header>
    <TaskActionReceipts />
    {index && failed && <p role="status" className="ab-tasks__empty">Task refresh unavailable; showing the last successful task list.</p>}
    {!index ? <p className="ab-tasks__empty">{failed ? "Agent Zero's task index is unavailable." : "Reading Agent Zero's tasks…"}</p> : <div className="ab-tasks__wrap">
      <div className="ab-tasks__list" aria-label={tab === "done" ? "Done tasks" : tab === "needs" ? "Tasks that need you" : "Open tasks"} data-testid={tab === "done" ? "a0-task-done" : "a0-task-list"}>
        {tab !== "done" ? <>
          {registryFailed && <p className="ab-tasks__empty">Workspace registry unavailable; placements may be stale or Unsorted.</p>}
          <TaskWorkspaceGroups tasks={list} all={all} registry={registry} loaded={registryLoaded} failed={registryFailed} reveal={!!query || !!focus?.id || tab === "needs"} renderTask={t => taskRow(t)} />
        </>
        : <>
          {days.length ? days.map(([day, ts]) => <section key={day} className="ab-tgroup is-day" data-day={day}>
            <header className="ab-tgroup__head"><h2>{day}</h2><span>{ts.length} done</span><StageBar tasks={ts} /></header>
            {rows(ts, day, (n) => `${n} more ${day === "Earlier" ? "earlier" : day.toLowerCase()} ›`)}
          </section>) : <p className="ab-tasks__empty">{query ? "Nothing done matches." : "Nothing live yet."}</p>}
          {shown.dropped.length > 0 && <button type="button" className="ab-tasks__dropped" aria-expanded={showDropped} onClick={() => setShowDropped((v) => !v)}>{shown.dropped.length} dropped · {showDropped ? "hide" : "show"}</button>}
          {showDropped && shown.dropped.length > 0 && <section className="ab-tgroup is-day" data-day="dropped"><header className="ab-tgroup__head"><h2>Dropped</h2><span>{shown.dropped.length}</span></header>
            {rows([...shown.dropped].sort((a, b) => b.updated.localeCompare(a.updated)), "dropped", (n) => `${n} more dropped ›`)}</section>}
        </>}
      </div>
    </div>}
    <div className="ab-tasks__tell"><TellBox /></div>
    {/* SPEC-STATS-TASKS §6 q4, the spec's default: a task filed without his words shows its title in their place. */}
    {index && <p className="ab-tasks__foot">{all.filter((t) => !t.his).length} of {all.length} tasks have no words of yours on file; their titles stand in, without quotes.</p>}
  </main>;
}
