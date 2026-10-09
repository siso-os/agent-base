import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import { useHoverCard } from "@siso/shell";
import { canonName, isDone, needsYou, ownerNames } from "../../lib/a0-tasks";
import type { Agent } from "../../lib/agents";
import { workspaceTaskGroups, type TaskWorkspaceRegistry } from "../../lib/task-workspaces";
import type { TaskSummary } from "../widgets/TasksWidget";
import { OwnerFace } from "../OwnerTasksPanel";
import { ProjectMark } from "../ProjectMark";
import "./TaskProjects.css";

/**
 * Agent Zero's Tasks in a phone-width panel (Shaan, 6 Oct 22:35: "considering we only have like mobile space allocated
 * it's not the cleanest ... when you click on a drop down maybe you just go to that page and you can click back ... all
 * stages pills ugly ... it'd be nice if you could actually just see the owners ... when you hover ... show more
 * information"). A stage control of four plain buckets, an owner strip, and one row per project that opens its own view
 * with Back. Hovering a project or an owner shows its counts and what is moving.
 */
export const BUCKETS = [
  { id: "moving", label: "Moving", stages: ["building", "rework"] },
  { id: "review", label: "Review", stages: ["built", "tested", "preview", "feedback"] },
  { id: "next", label: "Up next", stages: ["specced", "allocated"] },
  { id: "ideas", label: "Ideas", stages: ["thought"] },
] as const;
export type Bucket = "" | (typeof BUCKETS)[number]["id"];
export const bucketOf = (stage?: string): Bucket => (BUCKETS.find(b => (b.stages as readonly string[]).includes(stage ?? ""))?.id ?? "");
export const inBucket = (t: { stage: string }, b: Bucket) => !b || (BUCKETS.find(x => x.id === b)?.stages as readonly string[] | undefined)?.includes(t.stage) === true;

/** The stage control: All and four buckets with their counts, over one bar that shows how the open work splits. */
export function StageControl({ tasks, value, onChange }: { tasks: TaskSummary[]; value: Bucket; onChange: (b: Bucket) => void }) {
  const n = (b: Bucket) => tasks.filter(t => inBucket(t, b)).length, total = tasks.length || 1;
  return <div className="tp-stages" data-testid="task-stage-control">
    <div className="tp-stages__seg" role="radiogroup" aria-label="Which tasks">
      <button type="button" role="radio" aria-checked={!value} onClick={() => onChange("")}><span>All</span><b>{tasks.length}</b></button>
      {BUCKETS.map(b => <button key={b.id} type="button" role="radio" aria-checked={value === b.id} data-bucket={b.id} title={`${b.label}: ${b.stages.join(", ")}`} disabled={!n(b.id) && value !== b.id} onClick={() => onChange(value === b.id ? "" : b.id)}><span>{b.label}</span><b>{n(b.id)}</b></button>)}
    </div>
    <div className="tp-stages__bar" aria-hidden>{BUCKETS.map(b => <i key={b.id} data-bucket={b.id} className={value && value !== b.id ? "is-dim" : ""} style={{ flexGrow: n(b.id) / total }} />)}</div>
  </div>;
}

function Hover({ hover, children }: { hover: ReturnType<typeof useHoverCard>; children: ReactNode }) {
  return hover.open ? createPortal(<><div {...hover.bridge} /><div className="siso-hovercard tp-hover" style={hover.style} {...hover.cardProps}>{children}</div></>, document.body) : null;
}
const counts = (tasks: TaskSummary[]) => BUCKETS.map(b => [b.label, tasks.filter(t => inBucket(t, b.id)).length] as const).filter(([, c]) => c);
const title = (t: TaskSummary) => t.short ?? t.title;

/** One owner in the strip: its face and open count; hover for what it has moving and waiting. */
function OwnerChip({ name, tasks, agents, on, onPick }: { name: string; tasks: TaskSummary[]; agents: Agent[]; on: boolean; onPick: () => void }) {
  const hover = useHoverCard<HTMLButtonElement>(300, { dialog: false, label: `${name}'s tasks` });
  const a = agents.find(x => canonName(x.name) === name);
  const moving = tasks.filter(t => inBucket(t, "moving"));
  return <>
    <button type="button" {...hover.triggerProps} className="tp-owner" data-owner={name} aria-pressed={on} onClick={onPick} aria-label={`${name}: ${tasks.length} open${on ? " (showing only theirs)" : ""}`}>
      <OwnerFace name={name} agents={agents} size={20} /><span>{name}</span><b>{tasks.length}</b>
    </button>
    <Hover hover={hover}>
      <strong>{name}</strong>
      <p className="tp-hover__line">{a ? (a.status === "working" ? "Working now" : a.status === "needs" ? "Waiting on you" : "Idle") : "No live session"} · {tasks.length} open</p>
      <p className="tp-hover__counts">{counts(tasks).map(([l, c]) => <span key={l}>{c} {l.toLowerCase()}</span>)}</p>
      {moving.slice(0, 3).map(t => <p key={t.id} className="tp-hover__task">● {title(t)}</p>)}
      <small>{on ? "Click to show everyone's" : "Click to show only theirs"}</small>
    </Hover>
  </>;
}

export function OwnerStrip({ tasks, agents, who, setWho }: { tasks: TaskSummary[]; agents: Agent[]; who: string; setWho: (w: string) => void }) {
  const by = new Map<string, TaskSummary[]>();
  for (const t of tasks) for (const o of new Set(ownerNames(t.owner))) by.set(o, [...(by.get(o) ?? []), t]);
  const owners = [...by].sort((x, y) => y[1].length - x[1].length);
  if (!owners.length) return null;
  return <div className="tp-owners" role="group" aria-label="Whose tasks" data-testid="task-owner-strip">
    {owners.map(([o, list]) => <OwnerChip key={o} name={o} tasks={list} agents={agents} on={who === o} onPick={() => setWho(who === o ? "all" : o)} />)}
  </div>;
}

type Group = ReturnType<typeof workspaceTaskGroups>[number];

/** A project's row: its mark and name, its owners' faces, its counts; hover for who has what and what is moving. */
function ProjectRow({ g, agents, onOpen }: { g: Group; agents: Agent[]; onOpen: () => void }) {
  const hover = useHoverCard<HTMLButtonElement>(350, { dialog: false, label: `${g.name} tasks`, side: "left" });
  const open = g.tasks.filter(t => !isDone(t)), moving = open.filter(t => inBucket(t, "moving")), review = open.filter(needsYou);
  return <li>
    <button type="button" {...hover.triggerProps} className="tp-project" data-testid="task-project" data-project={g.id} onClick={onOpen}>
      {g.id === "unsorted" ? <span className="tp-project__blank" aria-hidden /> : <ProjectMark project={g.id} />}
      <span className="tp-project__copy">
        <b>{g.name}</b>
        <small>{open.length} open{moving.length ? ` · ${moving.length} moving` : ""}{review.length ? <em> · {review.length} yours</em> : null}</small>
      </span>
      <span className="tp-project__faces" aria-label={`${g.owners.length} owners`}>{g.owners.slice(0, 3).map(o => <OwnerFace key={o.owner} name={o.owner} agents={agents} size={18} />)}{g.owners.length > 3 && <i>+{g.owners.length - 3}</i>}</span>
      <ChevronRightIcon size={14} aria-hidden className="tp-project__chev" />
    </button>
    <Hover hover={hover}>
      <strong>{g.name}</strong>
      <p className="tp-hover__counts">{counts(open).map(([l, c]) => <span key={l}>{c} {l.toLowerCase()}</span>)}</p>
      <dl>{g.owners.map(o => <div key={o.owner}><dt>{o.owner}</dt><dd>{o.tasks.length} task{o.tasks.length === 1 ? "" : "s"}</dd></div>)}</dl>
      {moving.slice(0, 3).map(t => <p key={t.id} className="tp-hover__task">● {title(t)}</p>)}
      <small>Click to open its tasks</small>
    </Hover>
  </li>;
}

/** Projects as rows; a click opens that project's tasks by owner, with Back. A search shows every match in place. */
export function TaskProjects({ tasks, all, registry, loaded, agents, reveal, renderTask }: { tasks: TaskSummary[]; all: TaskSummary[]; registry: TaskWorkspaceRegistry; loaded: boolean; agents: Agent[]; reveal: boolean; renderTask: (t: TaskSummary) => ReactNode }) {
  const [openId, setOpenId] = useState<string | null>(null);
  // Esc in a project goes back to the projects; the panel leaves Esc alone while a [data-esc-own] view is up.
  useEffect(() => {
    if (!openId) return;
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape" && !e.defaultPrevented) { e.preventDefault(); setOpenId(null); } };
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [openId]);
  if (!loaded && !registry.workspaces.some(w => w.nav === true)) return <p role="status" className="owner-panel__empty">Reading workspaces…</p>;
  const groups = workspaceTaskGroups(tasks, registry, all).filter(g => g.tasks.length);
  const current = groups.find(g => g.id === openId) ?? null;
  const body = (g: Group) => g.owners.map(o => <section key={o.owner} className="tp-owner-group" data-owner={o.owner}>
    <h5><OwnerFace name={o.owner} agents={agents} size={18} /><span>{o.owner}</span><small>{o.tasks.length}</small></h5>
    <ul className="tp-rows">{o.tasks.map(t => <li key={t.id}>{renderTask(t)}</li>)}</ul>
  </section>);
  if (reveal) return <div className="tp-projects is-reveal" data-testid="task-projects">{groups.map(g => <section key={g.id} className="tp-reveal" data-workspace={g.id}><h4>{g.id !== "unsorted" && <ProjectMark project={g.id} />}{g.name}<small>{g.tasks.length}</small></h4>{body(g)}</section>)}</div>;
  if (current) return <div className="tp-projects is-open" data-testid="task-project-view" data-esc-own data-project={current.id} data-workspace={current.id}>
    <button type="button" className="tp-back" data-testid="task-project-back" onClick={() => setOpenId(null)}><ChevronLeftIcon size={14} aria-hidden />Projects<span>/</span>{current.id !== "unsorted" && <ProjectMark project={current.id} />}<b>{current.name}</b><small>{current.tasks.length}</small></button>
    {body(current)}
  </div>;
  return <ul className="tp-projects" data-testid="task-projects">{groups.map(g => <ProjectRow key={g.id} g={g} agents={agents} onOpen={() => setOpenId(g.id)} />)}</ul>;
}
