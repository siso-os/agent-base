// uihub: arc:timeline — adapted row disclosure; provenance in ui-hub/activity/ARC-SOURCE.md
import { ArrowLeft, ArrowUpRight, GitBranch, MessageSquare, FileText, Sparkles, ListChecks, ChevronRight, ChevronDown } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useHoverCard } from "@siso/shell";
import type { Agent, Page } from "../lib/agents";
import { every } from "../lib/poll";
import { Fold } from "./PanelFold";
import { fmtTokens } from "./SubagentRow";
import { TasksPage as TaskBoard } from "./TasksPage";
import { TimelineDisclosure } from "./timeline/TimelineDisclosure";
import "./Timeline.css";
export type TlFilter = "all" | "you" | "subagents" | "tasks" | "pages";
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
  note?: { title: string; why?: string; what?: string[]; see?: string };
  short?: string;
  outcome?: string;
};
type DayData = {
  day: string;
  moments: Moment[];
  unavailable: string[];
};
type Line = {
  id: string;
  at: string;
  source: string;
  text: string;
  intent: string | null;
};
type Day = {
  day: string | null;
  rows: Line[];
  intents: {
    name: string;
    when: string | null;
    title: string;
  }[];
};
const validTime = (at: string) => Number.isFinite(Date.parse(at));
const hhmm = (at: string) => validTime(at) ? new Date(at).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", hour12: false }) : "Time unavailable";
const dayKey = (date = new Date()) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
const previousDay = (day: string) => { const date = new Date(`${day}T12:00:00`); date.setDate(date.getDate() - 1); return dayKey(date); };
const dayLabel = (day: string) => day === dayKey() ? "Today" : day === previousDay(dayKey()) ? "Yesterday" : new Date(`${day}T12:00:00`).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
const matches = (m: Moment, filter: TlFilter) => filter === "all" || m.k === ({ you: "you", subagents: "soul", tasks: "task", pages: "page" } as const)[filter];
const icons = { shipped: GitBranch, soul: Sparkles, task: ListChecks, you: MessageSquare, page: FileText };
const kinds = { shipped: "Release", soul: "Run", task: "Task", you: "Ask", page: "Page" };
const kindLabel = (m: Moment) => kinds[m.k];
/**
 * Each entry in human words (Shaan, 6 Oct 22:35: "it should kind of say like a human legible what's been shipped"): what
 * happened first ("Built", "Shipped live", "Couldn't merge"), then the task's short name; the owner's release note wins.
 */
const VERB: Record<string, string> = { thought: "Noted", specced: "Specced", allocated: "Assigned", building: "Started", rework: "Reworking", built: "Built", tested: "Tested", preview: "Ready to look at", feedback: "Waiting on your feedback", live: "Shipped live", integrated: "Merged", happy: "You approved", done: "Finished", dropped: "Dropped" };
const SHIP: Record<string, string> = { live: "Shipped", conflict: "Couldn't merge", failed: "Release failed", queued: "Queued to ship", held: "Held back" };
const bare = (m: Moment) => m.short || m.title.replace(/^\d+ steps of /, "").replace(/ → [\w-]+$/, "");
export const headline = (m: Moment) => m.note?.title || (m.k === "task" ? `${VERB[m.state] ?? m.state}: ${bare(m)}` : m.k === "shipped" ? `${SHIP[m.state] ?? "Release"}: ${m.title}` : m.k === "soul" && m.state === "done" ? `Finished: ${m.title}` : m.k === "soul" && m.state.startsWith("Branch ·") ? `On a branch, not merged: ${m.title}` : m.title);
/** What came of it, in its owner's words: the release note's why, else the last real line it wrote on the move. */
export const outcomeOf = (m: Moment) => m.note?.why || m.outcome || (m.k === "task" ? m.text.split("\n").reverse().map(l => l.split(" · ").slice(2).join(" · ").trim()).find(n => n && !/^set [\w.]+(?:, [\w.]+)*$/i.test(n)) : undefined);
// A queue flag, completed turn or task stage records activity, not target behavior.
// Images and galleries are inspectable preview evidence, never automatic acceptance.
export function momentEvidence(m: Moment): string {
  const preview = m.pair || m.gallery ? "Preview evidence attached" : "No preview evidence";
  if (m.k === "shipped" && m.state === "live") return `Deployment recorded · ${preview.toLowerCase()} · live behavior unverified`;
  if (m.k === "shipped") return `${preview} · live behavior unverified`;
  if (m.k === "soul" || m.k === "task") return `${preview} · delivery unverified`;
  return m.k === "page" ? "Link posted · behavior unverified" : "Instruction recorded";
}
const stateLabel = (m: Moment) => m.k === "soul" && m.state === "done" ? "Turn completed" : m.k === "task" ? `Stage: ${m.state}` : m.k === "shipped" ? `Queue: ${m.state}` : m.state;
const meta = (m: Moment) => [m.who, m.task, m.duration !== undefined ? `${Math.round(m.duration / 60000)} min` : null, m.tokens ? fmtTokens(m.tokens) + " tokens" : null].filter(Boolean).join(" · ");
async function read<T>(url: string): Promise<T> { const r = await fetch(url, { cache: "no-store" }); if (!r.ok)
  throw Error(`Timeline unavailable (${r.status})`); return r.json(); }
const dayUrl = (agent: string, day: string) => `/api/timeline?agent=${encodeURIComponent(agent)}&day=${day}&offset=${-new Date(`${day}T12:00:00`).getTimezoneOffset()}`;
function useTimeline(a: Agent) {
  const [days, setDays] = useState<DayData[]>([]), [pending, setPending] = useState<Moment[]>([]), [error, setError] = useState<string | null>(null), [busy, setBusy] = useState(false);
  const generation = useRef(0), moreBusy = useRef(false);
  const [currentDay, setCurrentDay] = useState(dayKey);
  useEffect(() => {
    const version = ++generation.current;
    setDays([]);
    setPending([]);
    setError(null);
    moreBusy.current = false;
    setBusy(false);
    let requested = 0, settled = 0;
    const load = async () => {
      const request = ++requested, requestedDay = dayKey();
      setCurrentDay(requestedDay);
      try {
      const [today, pipeline] = await Promise.all([read<DayData>(dayUrl(a.id, requestedDay)), read<{
          pending: Moment[];
        }>(`/api/pipeline?agent=${encodeURIComponent(a.id)}`)]);
      if (generation.current !== version || request < settled)
        return;
      if (today.day !== requestedDay || !Array.isArray(today.moments) || !Array.isArray(today.unavailable) || !Array.isArray(pipeline.pending))
        throw Error("Timeline answer could not be read");
      settled = request;
      setDays(old => [today, ...old.filter(d => d.day !== today.day)].sort((a, b) => b.day.localeCompare(a.day)));
      setPending(pipeline.pending);
      setError(null);
    }
    catch (e) {
      if (generation.current === version && request >= settled) {
        settled = request;
        setError((e as Error).message);
      }
    } };
    const stop = every(() => void load(), 10000);
    return () => { generation.current++; stop(); };
  }, [a.id]);
  const more = useCallback(async () => { if (!days.length || moreBusy.current || days.length >= 30)
    return; moreBusy.current = true; setBusy(true); const version = generation.current; try {
    const next = await read<DayData>(dayUrl(a.id, previousDay(days.at(-1)!.day)));
    if (version === generation.current)
      setDays(old => old.some(d => d.day === next.day) ? old : [...old, next]);
  }
  catch (e) {
    if (version === generation.current)
      setError((e as Error).message);
  }
  finally {
    if (version === generation.current) {
      moreBusy.current = false;
      setBusy(false);
    }
  } }, [a.id, days]);
  return { days, today: days.find(d => d.day === currentDay), pending, error, busy, more };
}
function Strip({ events, onHour }: {
  events: Moment[];
  onHour?: (hour: number) => void;
}) {
  const counts = Array.from({ length: 24 }, () => 0);
  for (const m of events)
    if (validTime(m.t)) counts[new Date(m.t).getHours()]++;
  const max = Math.max(1, ...counts), hot = new Set([...counts.keys()].filter(h => counts[h]).sort((a, b) => counts[b] - counts[a]).slice(0, 3));
  return <div className="ab-hours" data-testid="timeline-strip"><div className="ab-hours__bars">{counts.map((count, h) => <button key={h} type="button" aria-label={`${String(h).padStart(2, "0")}:00 · ${count} moments`} className={hot.has(h) ? "is-hot" : ""} style={{ height: `${Math.max(count ? 12 : 4, count / max * 100)}%` }} disabled={!count || !onHour} onClick={() => onHour?.(h)}/>)}</div><div className="ab-hours__axis"><span>00</span><span>06</span><span>12</span><span>18</span><span>24</span></div></div>;
}
export function Pair({ m, small = false, onImage }: {
  m: Moment;
  small?: boolean;
  onImage?: (url: string) => void;
}) { return m.pair ? <div className={`tl-pair${small ? " is-small" : ""}`}>{(["before", "after"] as const).map(side => <figure key={side}><img onClick={onImage ? () => onImage(m.pair![side]) : undefined} onKeyDown={onImage ? e => { if (e.key === "Enter" || e.key === " ") {
  e.preventDefault();
  onImage(m.pair![side]);
} } : undefined} tabIndex={onImage ? 0 : undefined} role={onImage ? "button" : undefined} src={m.pair![side]} alt={`${side === "before" ? "Before" : "After"}: ${m.title}`} loading={small ? "lazy" : "eager"}/><figcaption>{side === "before" ? "Before" : "After"}</figcaption></figure>)}</div> : null; }
function Facts({ m }: {
  m: Moment;
}) { return <><div className="tl-facts">{kindLabel(m)} · {stateLabel(m)}<br />{meta(m)}<br /><time dateTime={validTime(m.t) ? m.t : undefined}>{validTime(m.t) ? new Date(m.t).toLocaleString() : "Time unavailable"}</time>{m.branch && <><br /><span>{m.branch}</span></>}{m.revision && <><br />Recorded revision: <code>{m.revision}</code></>}</div><p className="tl-evidence">{momentEvidence(m)}</p>{m.reason && <p className="tl-fulltext">{m.reason}</p>}{m.text && <p className="tl-fulltext">{m.text}</p>}{!!m.files?.length && <p className="tl-files">{m.files.join("\n")}</p>}{!!m.commits?.length && <ul className="tl-commits">{m.commits.map(c => <li key={c.sha}><code>{c.sha.slice(0, 7)}</code><span>{c.subject}</span></li>)}</ul>}</>; }
function Row({ m, onPage, compact = false }: {
  m: Moment;
  onPage: (p: Page) => void;
  compact?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const hover = useHoverCard<HTMLButtonElement>(350, { dialog: false, label: "Timeline details" }), Icon = icons[m.k];
  return <TimelineDisclosure expanded={expanded} onExpandedChange={setExpanded} marker={<Icon size={15} aria-hidden="true"/>}
    triggerProps={{ ...hover.triggerProps, "data-testid": "timeline-moment", "data-kind": m.k, "data-state": m.state, "data-moment-id": m.id }}
    summary={<><span className="tl-row__body"><strong>{headline(m)}</strong>{!compact && outcomeOf(m) && <span className="tl-row__why">{outcomeOf(m)}</span>}<small><span className="tl-state">{m.who || kindLabel(m)}</span>{m.task && ` · ${m.task}`}</small></span><time dateTime={validTime(m.t) ? m.t : undefined}>{hhmm(m.t)}</time></>}
    detail={<Detail m={m} onBack={() => setExpanded(false)} onPage={onPage}/>}
    hint={!expanded && hover.open ? createPortal(<div className="siso-hovercard tl-hover" style={hover.style} {...hover.cardProps} data-testid="timeline-hover"><strong>{headline(m)}</strong><Facts m={m}/><Pair m={m} small/><small>Click to inspect the evidence</small></div>, document.body) : undefined}
  />;
}
function Detail({ m, onBack, onPage }: {
  m: Moment;
  onBack: () => void;
  onPage: (p: Page) => void;
}) {
  const [task, setTask] = useState(false);
  const back = useRef<HTMLButtonElement>(null);
  useEffect(() => { back.current?.focus({ preventScroll: true }); }, [m.id, task]);
  const close = () => {
    onBack();
    requestAnimationFrame(() => document.querySelector<HTMLButtonElement>(`[data-moment-id="${CSS.escape(m.id)}"]`)?.focus({ preventScroll: true }));
  };
  if (task && m.task)
    return <><button type="button" className="tl-back" ref={back} onClick={() => setTask(false)}><ArrowLeft size={14}/>Back to change</button><TaskBoard host="pop" focus={{ id: m.task }}/></>;
  return <article className="tl-detail" data-testid="timeline-detail"><button type="button" className="tl-back" ref={back} onClick={close}>Close details</button><h3>{headline(m)}</h3><p className="tl-evidence">{momentEvidence(m)}</p><div className="tl-facts">{kindLabel(m)} · {stateLabel(m)} · {meta(m)}</div>{m.note && <div className="tl-note" data-testid="timeline-note">{m.note.why && <p className="tl-note__why">{m.note.why}</p>}{!!m.note.what?.length && <ul>{m.note.what.map(w => <li key={w}>{w}</li>)}</ul>}{m.note.see && <p className="tl-note__see">See it: {m.note.see}</p>}</div>}<Pair m={m} onImage={url => onPage({ url: new URL(url, location.origin).href, title: m.title })}/><div className="tl-links">{m.gallery && <button type="button" onClick={() => onPage({ url: new URL(m.gallery!, location.origin).href, title: m.title })}>Open gallery<ArrowUpRight size={13}/></button>}{m.task && <button type="button" onClick={() => setTask(true)}>Open task {m.task}<ArrowUpRight size={13}/></button>}{m.url && <button type="button" onClick={() => onPage({ url: m.url!, title: m.title })}>Open page<ArrowUpRight size={13}/></button>}</div><details className="tl-record"><summary>Recorded details · instructions, files and commits</summary><Facts m={m}/></details></article>;
}
export const deliveryPhase = (m: Pick<Moment, "k" | "state">): "branches" | "built" | "review" | "queue" => {
  if (m.state.startsWith("Branch ·")) return "branches";
  if (["preview", "feedback"].includes(m.state)) return "review";
  if (["built", "tested"].includes(m.state)) return "built";
  return "queue";
};
type DeliveryPhase = ReturnType<typeof deliveryPhase> | "all";
function Pipeline({ rows: allRows, onPage, compact = false, onAll, phase, setPhase }: {
  rows: Moment[]; onPage: (p: Page) => void; compact?: boolean; onAll?: () => void;
  phase: DeliveryPhase; setPhase: (phase: DeliveryPhase) => void;
}) {
  const [all, setAll] = useState(false);
  // Releases the queue could not merge or that failed are not moving work; they fold to one line (6 Oct 22:35: the
  // pipeline's "31" was mostly these, each saying "outcome not recorded").
  const stuckRows = allRows.filter(m => m.k === "shipped" && ["conflict", "failed"].includes(m.state));
  const rows = allRows.filter(m => !stuckRows.includes(m));
  if (!allRows.length) return null;
  const phases = [
    { id: "branches" as const, label: "Branches", hint: "Changes awaiting integration" },
    { id: "built" as const, label: "Built", hint: "Recorded as built or tested" },
    { id: "review" as const, label: "Review", hint: "Preview or feedback recorded" },
    { id: "queue" as const, label: "Queue", hint: "Other pending delivery records" },
  ];
  const selected = phase === "all" ? rows : rows.filter(m => deliveryPhase(m) === phase);
  const cap = compact ? 2 : all ? selected.length : 4;
  return <section className="ac-delivery" aria-label="Delivery pipeline" data-testid="delivery-pipeline">
    <header><h4>Delivery pipeline</h4><button type="button" className="ac-text-action" aria-pressed={phase === "all"} onClick={() => { setPhase("all"); setAll(false); }}>{rows.length} moving</button></header>
    <p>Recorded work awaiting delivery. Open a row for its outcome, next step and evidence.</p>
    <div className="ac-delivery-stages">{phases.map(p => { const count = rows.filter(m => deliveryPhase(m) === p.id).length; return <button key={p.id} type="button" aria-label={`${p.label}: ${count} pending`} title={p.hint} aria-pressed={phase === p.id} disabled={!count} onClick={() => { setPhase(phase === p.id ? "all" : p.id); setAll(false); }}><b>{count}</b><span>{p.label}</span></button>; })}</div>
    {selected.slice(0, cap).map(m => <Row key={m.id} m={m} onPage={onPage} compact />)}
    {!selected.length && <p className="ac-note">Nothing remains in this stage.</p>}
    {selected.length > (compact ? 2 : 4) && <button type="button" className="tl-more" onClick={() => compact ? onAll?.() : setAll(!all)}>{all ? "Show fewer" : `See all ${selected.length}`}</button>}
    {!compact && stuckRows.length > 0 && <details className="ac-history tl-stuck" data-testid="pipeline-stuck"><summary>{stuckRows.length} stuck in the release queue · {[["conflict", "couldn't merge"], ["failed", "failed"]].map(([k, w]) => { const n = stuckRows.filter(m => m.state === k).length; return n ? `${n} ${w}` : null; }).filter(Boolean).join(", ")}</summary>{stuckRows.map(m => <Row key={m.id} m={m} onPage={onPage} compact />)}</details>}
  </section>;
}

type Props = {
  a: Agent;
  onIntent: (name: string, title: string) => void;
  onSubagent: (key: string, title: string) => void;
  onPage: (p: Page) => void;
};
export function Timeline({ a, onPage, onOpen }: Props & {
  onOpen: (opts?: {
    hour?: number;
    filter?: TlFilter;
  }) => void;
}) {
  const { today, pending, error } = useTimeline(a), [phase, setPhase] = useState<DeliveryPhase>("all");
  useEffect(() => { setPhase("all"); }, [a.id]);
  const moments = today?.moments ?? [];
  const widget = <><Pipeline rows={pending} onPage={onPage} phase={phase} setPhase={setPhase} compact onAll={() => onOpen()}/>{error && <p className="ab-empty" role="status">{error} · Previously loaded records may be stale.</p>}{!!today?.unavailable.length && <p className="tl-unavailable" role="status">Not available: {today.unavailable.join(" · ")}</p>}<Strip events={moments} onHour={hour => onOpen({ hour })}/><div className="tl-recent"><h4>Today <span>{moments.length} moments</span></h4>{moments.slice(0, 4).map(m => <Row key={m.id} m={m} onPage={onPage}/>)}{!moments.length && <p className="ab-empty">{error ? "Today could not be refreshed." : today ? "Nothing recorded today." : "Reading today…"}</p>}</div><button type="button" className="tl-more" onClick={() => onOpen()}>Explore the day</button></>;
  return <Fold id="timeline" title="Timeline" open testid="fold-timeline" note={today ? moments.length : "…"} widget={widget} onOpen={() => onOpen()}>{widget}</Fold>;
}
function summary(rows: Moment[]) { return (["shipped", "soul", "task", "you", "page"] as const).map(k => { const n = rows.filter(m => m.k === k).length; return n ? `${n} ${{ shipped: "release", soul: "run", task: "task", you: "ask", page: "page" }[k]}${n > 1 ? "s" : ""}` : null; }).filter(Boolean).join(" · "); }
function Hours({ day, filter, opened, onOpen, onPage }: {
  day: DayData;
  filter: TlFilter;
  opened: Set<string>;
  onOpen: (key: string) => void;
  onPage: (p: Page) => void;
}) {
  const hours = useMemo(() => { const groups = new Map<number, Moment[]>(); for (const m of day.moments.filter(m => matches(m, filter))) {
    const h = new Date(m.t).getHours();
    groups.set(h, [...(groups.get(h) ?? []), m]);
  } return [...groups]; }, [day, filter]);
  return <section className="tl-day" data-day={day.day}>{!!day.unavailable.length && <p className="tl-unavailable" role="status">Not available: {day.unavailable.join(" · ")}</p>}<h3>{dayLabel(day.day)}<span>{day.moments.filter(m => matches(m, filter)).length} moments</span></h3>{!hours.length && <p className="ab-empty">No moments recorded.</p>}{hours.map(([h, rows], index) => { const key = `${day.day}:${h}`, open = opened.has(key) || (!opened.has(`closed:${key}`) && (index < 2 || day.day === dayKey() && h === new Date().getHours())); return <section key={key} data-hour={h} data-testid="timeline-hour" aria-expanded={open}><button type="button" className="tl-hour" aria-expanded={open} onClick={() => onOpen(key)}>{open ? <ChevronDown size={13}/> : <ChevronRight size={13}/>}<time>{String(h).padStart(2, "0")}:00</time><span>{summary(rows)}</span></button>{open && rows.map(m => <Row key={m.id} m={m} onPage={onPage}/>)}</section>; })}</section>;
}
export function TimelinePage({ a, hour, filter: initial = "all", onPage, onIntent }: Props & {
  hour?: number;
  filter?: TlFilter;
}) {
  const { days, today, pending, error, busy, more } = useTimeline(a), [filter, setFilter] = useState<TlFilter>(initial), [phase, setPhase] = useState<DeliveryPhase>("all"), [opened, setOpened] = useState(new Set<string>()), root = useRef<HTMLDivElement>(null), sentinel = useRef<HTMLButtonElement>(null);
  useEffect(() => { setPhase("all"); setOpened(new Set()); }, [a.id]);
  const jump = useCallback((h: number) => { const key = `${dayKey()}:${h}`; setFilter("all"); setOpened(old => new Set([...old, key].filter(k => k !== `closed:${key}`))); window.setTimeout(() => root.current?.querySelector(`[data-day="${dayKey()}"] [data-hour="${h}"]`)?.scrollIntoView({ block: "start", behavior: "smooth" }), 60); }, []);
  useEffect(() => { if (hour !== undefined && days.length)
    jump(hour); }, [hour, !!days.length, jump]);
  useEffect(() => { const el = sentinel.current; if (!el || busy || error || days.length >= 30)
    return; const observer = new IntersectionObserver(entries => { if (entries[0].isIntersecting)
    void more(); }, { threshold: 1 }); observer.observe(el); return () => observer.disconnect(); }, [more, busy, error, days.length]);
  const toggle = (key: string) => setOpened(old => { const next = new Set(old), el = root.current?.querySelector(`[data-day="${key.split(":")[0]}"] [data-hour="${key.split(":")[1]}"]`), open = el?.getAttribute("aria-expanded") === "true"; next.delete(key); next.delete(`closed:${key}`); next.add(open ? `closed:${key}` : key); return next; });
  return <div className="ab-tlpage tl-page" ref={root} data-testid="timeline-page-view"><><Pipeline rows={pending} onPage={onPage} phase={phase} setPhase={setPhase}/><Strip events={today?.moments ?? []} onHour={jump}/><div className="ab-chips ab-tl__chips" role="group" aria-label="Show">{(["all", "you", "subagents", "tasks", "pages"] as const).map(f => <button key={f} type="button" aria-pressed={filter === f} onClick={() => setFilter(f)}>{{ all: "All", you: "Your asks", subagents: "Runs", tasks: "Tasks", pages: "Pages" }[f]}</button>)}</div>{error && <p className="ab-empty" role="status">{error}{days.length > 0 && " · Previously loaded records may be stale."}</p>}{!days.length && !error && <p className="ab-empty">Reading today…</p>}{days.map(day => <Hours key={day.day} day={day} filter={filter} opened={opened} onOpen={toggle} onPage={onPage}/>)}{days.length > 0 && days.length < 30 && <button ref={sentinel} type="button" className="tl-more" disabled={busy} onClick={() => void more()}>{busy ? "Reading earlier…" : "Earlier days"}</button>}{a.zero && filter === "you" && <details><summary className="tl-more">Full ask archive</summary><Transcript onIntent={onIntent}/></details>}</></div>;
}
/** His words to Agent Zero (t-0259): raw lines or the intent files they became, newest day first, a day at a time. */
function Transcript({ onIntent }: {
  onIntent: (name: string, title: string) => void;
}) {
  const [days, setDays] = useState<Day[]>([]);
  const [end, setEnd] = useState(false);
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<"raw" | "distilled">("raw");
  const [opened, setOpened] = useState<string | null>(null);
  const more = useCallback(async (before: string | null) => {
    setBusy(true);
    try {
      const r = await fetch(`/api/a0/transcript${before ? `?before=${before}` : ""}`, { cache: "no-store" });
      const d = (await r.json()) as Day;
      if (!d.day)
        setEnd(true);
      else
        setDays((ds) => (before ? [...ds, d] : [d, ...ds.slice(1)]));
    }
    catch {
      setEnd(true);
    }
    finally {
      setBusy(false);
    }
  }, []);
  useEffect(() => void more(null), [more]);
  const last = days[days.length - 1]?.day ?? null;
  return (<div className="ab-tr" data-testid="transcript">
   <div className="ab-seg" role="group" aria-label="Raw or distilled">
    <button type="button" aria-pressed={mode === "raw"} onClick={() => setMode("raw")}>
     Raw
    </button>
    <button type="button" aria-pressed={mode === "distilled"} onClick={() => setMode("distilled")}>
     Distilled
    </button>
   </div>
   <div className="ab-tr__scroll">
    {!days.length && <p className="ab-empty">{busy ? "Reading his words…" : "Nothing in the archive yet."}</p>}
    {days.map((d) => (<div key={d.day} className="ab-tr__day" data-testid="transcript-day" data-day={d.day}>
      <h4>
       {dayLabel(d.day!)} <span>{mode === "raw" ? `${d.rows.length} said` : `${d.intents.length} distilled`}</span>
      </h4>
      {mode === "raw"
        ? [...d.rows].reverse().map((l) => (<div key={l.id} className={`ab-tr__line${opened === l.id ? " is-open" : ""}`} data-testid="transcript-line">
          <button type="button" className="ab-tr__text" onClick={() => setOpened(opened === l.id ? null : l.id)}>
           <time>{hhmm(l.at)}</time>
           <span>{l.text}</span>
          </button>
          {l.intent && (<button type="button" className="ab-tr__intent" data-testid="transcript-intent" title="The intent file this became" onClick={() => onIntent(l.intent!, l.intent!.replace(/^\d{8}-\d{4}-/, "").replace(/-/g, " "))}>
            intent ›
           </button>)}
         </div>))
        : d.intents.map((x) => (<button key={x.name} type="button" className="ab-tr__distilled" data-testid="transcript-distilled" onClick={() => onIntent(x.name, x.title)}>
          <time>{x.name.slice(9, 11)}:{x.name.slice(11, 13)}</time>
          <span>{x.title}</span>
         </button>))}
      {mode === "distilled" && !d.intents.length && <p className="ab-empty">No intent files for this day.</p>}
     </div>))}
    {last && !end && (<button type="button" className="ab-more" data-testid="transcript-earlier" disabled={busy} onClick={() => void more(last)}>
      {busy ? "Reading…" : "Earlier days ›"}
     </button>)}
    {end && days.length > 0 && <p className="ab-empty">That is the start of the archive.</p>}
   </div>
  </div>);
}
