import { TaskFold } from "../TaskFold";
import { usePersisted } from "@siso/shell";
import { isDone, isNow } from "../../lib/a0-tasks";
import type { TaskSummary } from "../widgets/TasksWidget";
import "./TaskTree.css";

const childrenOf = (id: string, all: TaskSummary[]) => all.filter((t) => t.parent === id).sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));

/** The complete plan, before owner/stage/search filters, with protection against broken parent cycles. */
export function taskFamily(task: TaskSummary, all: TaskSummary[]): TaskSummary[] {
  const family: TaskSummary[] = [], seen = new Set<string>();
  const visit = (t: TaskSummary) => {
    if (seen.has(t.id)) return;
    seen.add(t.id);
    family.push(t);
    childrenOf(t.id, all).forEach(visit);
  };
  visit(task);
  return family;
}

/** Count terminal steps, never their containing phases. Dropped work stays readable but is not completion. */
export function taskProgress(task: TaskSummary, all: TaskSummary[]): string | undefined {
  const leaves = taskLeaves(task, all);
  return leaves.length ? `${leaves.filter(isDone).length}/${leaves.length}` : undefined;
}
export const taskLeaves = (task: TaskSummary, all: TaskSummary[]) => taskFamily(task, all).filter((t) => t.id !== task.id && t.stage !== "dropped" && !childrenOf(t.id, all).length);
/** Card text drops administrative parentheses; full task text stays in inspection views. */
export const cardText = (value: string) => value.replace(/\([^)]*\)/g, "").replace(/\s+/g, " ").trim();
const letter = (index: number): string => index < 26 ? String.fromCharCode(97 + index) : letter(Math.floor(index / 26) - 1) + String.fromCharCode(97 + index % 26);
const active = (t: TaskSummary) => !isDone(t) && (isNow(t) || t.stage === "building");

/** Shared dashboard/tab plan: numbered phases, lettered steps, remembered folds and a revealed search path. */
export function TaskTree({ task, all, matches = new Set<string>(), compact = false, openOnly = false }: { task: TaskSummary; all: TaskSummary[]; matches?: Set<string>; compact?: boolean; openOnly?: boolean }) {
  const [folded, setFolded] = usePersisted<Record<string, boolean>>(`panel.tasks.phases.${task.id}`, {});
  // Open-only hides finished work, except what a search just found (it was found but stayed hidden, 6 Oct).
  const visible = (t: TaskSummary) => !openOnly || taskFamily(t, all).some(t => !isDone(t) || matches.has(t.id));
  const phases = childrenOf(task.id, all).filter(visible);
  const current = phases.find((p) => !isDone(p) && childrenOf(p.id, all).some(isNow))
    ?? phases.find((p) => !isDone(p) && childrenOf(p.id, all).some(active))
    ?? phases.find(active) ?? phases.find((p) => !isDone(p));
  const progress = taskProgress(task, all);
  const searching = matches.size > 0;
  const stepLine = (step: TaskSummary, i: number, currentStep?: TaskSummary) => {
    const mark = step.stage === "dropped" ? "Dropped" : isDone(step) ? "Done" : step.id === currentStep?.id ? "Current" : "To do";
    return <span key={step.id} data-task-step={step.id} data-match={matches.has(step.id)} title={step.title} className={`ab-tcard__step ab-tcard__phase-step${mark === "Done" || mark === "Dropped" ? " is-done" : mark === "Current" ? " is-current" : ""}`}>
      <span aria-label={mark}>{mark === "Dropped" ? "−" : mark === "Done" ? "☑" : mark === "Current" ? "●" : "○"}</span>
      <span className="ab-tcard__letter">{letter(i)}.</span><span>{step.title}{mark === "Dropped" ? " · dropped" : ""}</span>
    </span>;
  };
  if (!phases.length) return !compact && task.next ? <span className="ab-tcard__step">○ {task.next.replace(/^\s*NOW:\s*/i, "")}</span> : null;
  const hasPhases = phases.some((p) => childrenOf(p.id, all).length);
  return <div className="ab-task-tree" data-testid="task-tree">
    {progress && !compact && <div className="ab-tcard__progress" aria-label={`${progress.replace("/", " of ")} steps done`}>
      <span><i style={{ width: `${Number(progress.split("/")[0]) / Number(progress.split("/")[1]) * 100}%` }} /></span><small>{progress}</small>
    </div>}
    {phases.map((phase, index) => {
      const steps = childrenOf(phase.id, all).filter(visible);
      if (!hasPhases || !steps.length) return stepLine(phase, index, current);
      const reveal = searching && taskFamily(phase, all).some((t) => matches.has(t.id));
      const expanded = reveal || (folded[phase.id] === undefined ? phase.id === current?.id : !folded[phase.id]);
      const currentStep = phase.id === current?.id ? steps.find(isNow) ?? steps.find(active) ?? steps.find((s) => !isDone(s)) : undefined;
      return <div key={phase.id} className="ab-tcard__phase" data-current={phase.id === current?.id} data-match={matches.has(phase.id)}>
        <button type="button" className="ab-tcard__phead" aria-expanded={expanded} onClick={() => setFolded({ ...folded, [phase.id]: expanded })}>
          <span className="ab-tcard__number">{index + 1}</span>
          <span className="ab-tcard__pname" title={phase.title}>{phase.title}</span>
          {isDone(phase) && <span aria-label={phase.stage === "dropped" ? "Dropped" : "Done"}>{phase.stage === "dropped" ? "−" : "☑"}</span>}
          <small>{taskProgress(phase, all)}</small>
        </button>
        <TaskFold open={expanded}>{steps.map((step, i) => stepLine(step, i, currentStep))}</TaskFold>
      </div>;
    })}
  </div>;
}
