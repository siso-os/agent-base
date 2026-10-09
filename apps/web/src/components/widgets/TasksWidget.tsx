import { useMemo } from "react";
import { priorityRank, useA0Tasks } from "../../lib/a0-tasks";
import { WidgetCard, type WidgetFile, type WidgetSize } from "./WidgetCard";
import "../TasksPage.css";

/** The board's open columns, in flywheel order. Done (live, its old name integrated, happy) and dropped sit in the Done tab
 *  (A0, 3 Oct: the board hid 132 live tasks while its count said "279 of 279"). */
export const TASK_STAGES = ["thought", "specced", "allocated", "building", "built", "tested", "preview", "feedback", "rework"] as const;
export const DONE_STAGES = ["done", "live", "integrated", "happy"] as const;
/** Open is every task not done and not dropped (built and tested are open: not live yet); the widget's "N open" counts these. */
export const OPEN_STAGES: readonly string[] = TASK_STAGES;
export const isOpenTask = (t: { stage: string }) => !(DONE_STAGES as readonly string[]).includes(t.stage) && t.stage !== "dropped";
export type TaskStage = typeof TASK_STAGES[number] | typeof DONE_STAGES[number] | "dropped";
export type TaskSummary = { source?: "available" | "unavailable"; workspace?: string | null; id: string; title: string; project: string; priority: string; stage: TaskStage; owner: string | null; model: string | null; updated: string; needs?: boolean; short?: string; next?: string | null; /** The task this one is a step of. */ parent?: string | null; /** Who is doing it, when not the owner (a seat or a soul). */ agent?: string | null; /** His words (the node folds whitespace; "" when the file has none). */ his?: string; /** When it went live, else null. */ live_at?: string | null };
export type TaskIndex = { updated: string; counts: { by_stage?: Record<string, number>; by_project?: Record<string, number>; by_priority?: Record<string, number> }; tasks: TaskSummary[] };
export type TasksWidgetFile = WidgetFile<"tasks", TaskIndex>;

const stageOrder: string[] = [...TASK_STAGES, ...DONE_STAGES, "dropped"];
const stageLabel = (value: string) => value === "thought" ? "thought" : value;
const age = (value: string) => {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return "age unknown";
  const mins = Math.max(0, Math.floor((Date.now() - date.valueOf()) / 60_000));
  return mins < 60 ? `${mins}m ago` : mins < 1440 ? `${Math.floor(mins / 60)}h ago` : `${Math.floor(mins / 1440)}d ago`;
};

/** P0 then P1 and on; inside a priority, what needs him first, then furthest along, then newest. */
export function sortTasks(tasks: TaskSummary[]) {
  return [...tasks].sort((a, b) =>
    priorityRank(a.priority) - priorityRank(b.priority) || Number(!!b.needs) - Number(!!a.needs) || stageOrder.indexOf(b.stage) - stageOrder.indexOf(a.stage) || b.updated.localeCompare(a.updated));
}

function StageBar({ tasks }: { tasks: TaskSummary[] }) {
  const counts = useMemo(() => Object.fromEntries(TASK_STAGES.map((stage) => [stage, tasks.filter((task) => task.stage === stage).length])), [tasks]);
  const total = tasks.length || 1;
  return <div className="a0-task-stagebar" aria-label={`${tasks.length} tasks by stage`}>
    <div className="a0-task-stagebar__track">{TASK_STAGES.map((stage) => counts[stage] > 0 && <i key={stage} className={`is-${stage}`} style={{ flexGrow: counts[stage] / total }} title={`${counts[stage]} ${stage}`} />)}</div>
    <div className="a0-task-stagebar__legend">{TASK_STAGES.map((stage) => <span key={stage}><i className={`is-${stage}`} />{stage}<b>{counts[stage]}</b></span>)}</div>
  </div>;
}

function MiniStageBar({ tasks }: { tasks: TaskSummary[] }) {
  return <span className="tasks-widget__mini-stack" aria-label="Task stages">{TASK_STAGES.map((stage) => {
    const count = tasks.filter((task) => task.stage === stage).length;
    return count > 0 ? <i key={stage} className={`is-${stage}`} style={{ flexGrow: count }} /> : null;
  })}</span>;
}

export function TasksWidget({ size, onTasksPage }: { size: WidgetSize; onTasksPage?: () => void }) {
  const { index } = useA0Tasks();
  const all = index?.tasks ?? [];
  const tasks = sortTasks(all.filter(isOpenTask));
  const high = tasks.filter((task) => /^P[01]$/.test(task.priority)).length;
  const needs = tasks.filter((task) => task.needs).length;
  return <WidgetCard size={size} title="Your tasks" description="A0's task index · live" icon="clipboard-check" count={index ? `${tasks.length} open` : "loading"} metric={<>{tasks.length}<small> · {high} P0/P1{needs ? ` · ${needs} need you` : ""}</small></>} label="tasks in A0's board" tileExtra={<MiniStageBar tasks={tasks} />} className="tasks-widget">
    {!index ? <p className="siso-widget__empty">Task index unavailable.</p> : <>
      <StageBar tasks={tasks} />
      <div className="tasks-widget__projects">{Object.entries(index.counts?.by_project ?? {}).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([project, count]) => <span key={project}>{project}<b>{count}</b></span>)}</div>
      <ol className="tasks-widget__rows">{tasks.slice(0, size === "S" ? 3 : 10).map((task) => <li key={task.id}>
        <span className={`a0-task-stage is-${task.stage}`}>{stageLabel(task.stage)}</span>
        <div><b>{task.title}</b><small>{task.priority} · {task.project} · {task.owner || "unassigned"} · {age(task.updated)}</small></div>
      </li>)}</ol>
      <a className="tasks-widget__all" href="#tasks" onClick={onTasksPage ? (event) => { event.preventDefault(); onTasksPage(); } : undefined}>All {all.length} on the Tasks page <span aria-hidden="true">›</span></a>
    </>}
  </WidgetCard>;
}
