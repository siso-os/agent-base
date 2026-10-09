import { TaskActions, TaskActionReceipts } from "../TaskActions";
import { TaskFold } from "../TaskFold";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { formatAge } from "@siso/side-nav";
import { XIcon } from "lucide-react";
import { useHoverCard } from "@siso/shell";
import { canonName, isDone, isNow, nameKey, ownerNames, priorityRank } from "../../lib/a0-tasks";
import type { Agent } from "../../lib/agents";
import { AgentFace, faceFor } from "../../lib/face";
import { clock } from "../../lib/poll";
import { TaskTree, taskLeaves, taskProgress, cardText } from "./TaskTree";
import type { TaskSummary } from "../widgets/TasksWidget";
import "./TaskTree.css";

export type CardTask = TaskSummary & { stage_at?: string | null; shots?: { before: string; after: string } | null };

/** Spec-length titles carry a surface name before a colon, or a whole-word first 48 characters. */
export function taskName(title: string): { name: string; detail: string } {
  const clean = cardText(title), colon = clean.indexOf(": ");
  const end = colon >= 8 && colon <= 48 ? colon : clean.length <= 48 ? clean.length : Math.max(0, clean.slice(0, 49).lastIndexOf(" ")) || clean.length;
  return { name: clean.slice(0, end), detail: clean.slice(end).replace(/^[:\s]+/, "") };
}
export const doer = (t: CardTask) => t.agent || ownerNames(t.owner)[0] || "Unassigned";
const entry = (t: CardTask) => t.stage_at || "";
export const cardOrder = (tasks: CardTask[]) => [...tasks].sort((a, b) => Number(isNow(b)) - Number(isNow(a)) || priorityRank(a.priority) - priorityRank(b.priority) || entry(b).localeCompare(entry(a)) || b.id.localeCompare(a.id));

export function CardRow({ t, all, agents, now, mode, expanded, onExpand, onOpen, onImage, openOnly = false }: {
  t: CardTask; all: TaskSummary[]; agents: Agent[]; now: number; mode: "moving" | "preview" | "shipping" | "next";
  expanded?: boolean; openOnly?: boolean; onExpand: () => void; onOpen: () => void; onImage: (t: CardTask, side: number) => void;
}) {
  const hover = useHoverCard<HTMLButtonElement>(550, { dialog: false, label: "Task details" });
  const { name } = taskName(t.title), who = doer(t), progress = taskProgress(t, all), leaves = taskLeaves(t, all);
  const live = agents.find(a => nameKey(canonName(a.name)) === nameKey(canonName(who)));
  const age = entry(t) ? formatAge(Date.parse(entry(t)), now) : "—";
  // A task with steps opens like a tree in every section (5 Oct: "not like a nice drop down tree"); one without opens the Tasks page.
  const kids = leaves.length > 0, shots = mode === "preview" && !!t.shots;
  const twisty = mode !== "moving" && <span className={`ab-taskcard__twisty${kids ? "" : " is-leaf"}`} aria-hidden>{kids ? "›" : "•"}</span>;
  const summary = <button type="button" {...hover.triggerProps} className={`ab-taskcard__row is-${mode}${shots ? " has-shots" : ""}`} aria-expanded={kids || mode === "moving" ? !!expanded : undefined} onClick={kids || mode === "moving" ? onExpand : onOpen}>
    {mode === "moving" ? <>
      <span className="ab-taskcard__face"><AgentFace {...faceFor(live ?? { name: who, project: t.project, status: "idle" })} size={22} /></span>
      <strong className="ab-taskcard__name">{t.title}</strong><span className="ab-taskcard__progress">{progress}</span>
      <span className="ab-taskcard__detail">{t.next?.replace(/^\s*NOW:\s*/i, "") || `${t.stage} · ${who}`}</span><time className="ab-taskcard__age" dateTime={entry(t) || undefined}>{age}</time>
      {!!leaves.length && <span className="ab-taskcard__segments" aria-label={`${progress?.replace("/", " of ")} steps done`}>{leaves.map(s => <i key={s.id} className={isDone(s) ? "is-done" : undefined} />)}</span>}
    </> : <>
      {twisty}
      <span className="ab-taskcard__copy"><strong className="ab-taskcard__name">{t.title}</strong>{t.next && <span className="ab-taskcard__next">Next · {t.next.replace(/^\s*NOW:\s*/i, "")}</span>}<small>{t.stage} · {who}</small></span>
      {kids && <span className="ab-taskcard__progress">{progress}</span>}
      <span className="ab-taskcard__face"><AgentFace {...faceFor(live ?? {name:who,project:t.project,status:"idle"})} size={22}/></span>
    </>}
  </button>;
  return <li data-task-card={t.id} className={shots ? "ab-taskcard__preview" : undefined}>
    {/* Only real before/after pictures take room; no empty placeholder boxes. */}
    {shots && <span className="ab-taskcard__pair">
      {(["before", "after"] as const).map((side, i) => <button type="button" key={side} aria-label={`${i ? "After" : "Before"}: ${name}`} onClick={e => { e.currentTarget.focus(); onImage(t, i); }}><img src={t.shots![side]} alt="" onError={e => { e.currentTarget.hidden = true; }} /><span>{i ? "After" : "Before"}</span></button>)}
    </span>}
    {summary}
    <TaskActions task={t} />
    {(kids || mode === "moving") && <TaskFold open={!!expanded}><div className="ab-taskcard__tree"><TaskTree task={t} all={all} compact openOnly={openOnly} /></div></TaskFold>}
    {hover.open && createPortal(<div className="siso-hovercard ab-taskcard__hover" style={hover.style} {...hover.cardProps} data-testid="task-card-hover">
      <strong>{t.title}</strong>{t.his && <p>{t.his}</p>}{t.next && <p>{t.next}</p>}
      <small>{who} · {t.stage}<br />Entered: {entry(t) ? new Date(entry(t)).toLocaleString() : "Unknown"}<br />Updated: {new Date(t.updated).toLocaleString()}</small>
    </div>, document.body)}
  </li>;
}

/** The hub's image/arrow/Escape interaction, with native modal focus and return to the thumbnail. */
export function EvidenceLightbox({ task, side, onClose }: { task: Pick<CardTask, "title" | "shots">; side: number; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null), [index, setIndex] = useState(side), [failed, setFailed] = useState<Record<number, boolean>>({});
  useEffect(() => { const el = dialog.current!; el.showModal(); return () => el.close(); }, []);
  const label = index ? "After" : "Before";
  const review = task as Partial<CardTask>;
  return createPortal(<dialog ref={dialog} className="ab-taskcard__lightbox" data-esc-own aria-label="Task evidence" onCancel={e => { e.preventDefault(); onClose(); }} onClick={e => { if (e.target === e.currentTarget) onClose(); }} onKeyDown={e => {
    if (["ArrowRight", "ArrowLeft"].includes(e.key)) { e.preventDefault(); setIndex(i => 1 - i); }
    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); onClose(); }
  }}><button type="button" className="ab-taskcard__lbclose" onClick={onClose} aria-label="Close evidence"><XIcon size={18} /></button>
    {failed[index] ? <p role="status">{label} image unavailable.</p> : <img src={task.shots![index ? "after" : "before"]} alt={`${label}: ${taskName(task.title).name}`} onError={() => setFailed(v => ({ ...v, [index]: true }))} />}
    {review.id && review.stage && <div className="ab-taskcard__review"><TaskActions task={review as CardTask}/><TaskActionReceipts /></div>}
    <div className="ab-taskcard__lbnav"><button type="button" onClick={() => setIndex(i => 1 - i)} aria-label="Previous image">←</button><span>{label} · {index + 1} / 2 · Esc to close</span><button type="button" onClick={() => setIndex(i => 1 - i)} aria-label="Next image">→</button></div>
  </dialog>, document.body);
}

/** The same preview rows and evidence modal as the Tasks card, with the caller's project filter. */
export function LandedRows({ tasks, all, agents, onOpen }: { tasks: CardTask[]; all: TaskSummary[]; agents: Agent[]; onOpen: (id: string) => void }) {
  const [more, setMore] = useState(false), [image, setImage] = useState<{ task: CardTask; side: number } | null>(null);
  const [now, setNow] = useState(Date.now());
  useEffect(() => clock(() => setNow(Date.now())), []);
  const ordered = cardOrder(tasks);
  return <div className="ab-taskcard"><TaskActionReceipts />
    <ul className="ab-taskcard__rows">{(more ? ordered : ordered.slice(0, 3)).map(t => <CardRow key={t.id} t={t} all={all} agents={agents} now={now} mode="preview" onExpand={() => {}} onOpen={() => onOpen(t.id)} onImage={(task, side) => setImage({ task, side })} />)}</ul>
    {ordered.length > 3 && <button type="button" className="ab-taskcard__more" onClick={() => setMore(!more)}>{more ? "Show fewer" : `+${ordered.length - 3} more`}</button>}
    {image && <EvidenceLightbox task={image.task} side={image.side} onClose={() => setImage(null)} />}
  </div>;
}
