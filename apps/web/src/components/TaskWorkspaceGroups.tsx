import { useEffect, useState, type ReactNode } from "react";
import { TaskWorkspaceDeck, type WorkspaceDeckGroup } from "./TaskWorkspaceDeck";
import type { TaskSummary } from "./widgets/TasksWidget";
import { isDone, needsYou } from "../lib/a0-tasks";
import { workspaceTaskGroups, type TaskWorkspaceRegistry } from "../lib/task-workspaces";
import "./TaskWorkspaceGroups.css";

/** Both Tasks surfaces share the registry overview and retain their existing row/edit widgets. */
export function TaskWorkspaceGroups({ tasks, all, registry, renderTask, reveal = false, loaded = false, failed = false }: {
  tasks: TaskSummary[]; all: TaskSummary[]; registry: TaskWorkspaceRegistry;
  renderTask: (task: TaskSummary) => ReactNode; reveal?: boolean; loaded?: boolean; failed?: boolean;
}) {
  const [folded, setFolded] = useState<Record<string, boolean>>(() => {
    try { const value = JSON.parse(localStorage.getItem("ab-task-workspace-folds") ?? "{}");
      return value && typeof value === "object" && !Array.isArray(value)
        ? Object.fromEntries(Object.entries(value).filter((entry): entry is [string, boolean] => typeof entry[1] === "boolean")) : {};
    } catch { return {}; }
  });
  useEffect(() => { try { localStorage.setItem("ab-task-workspace-folds", JSON.stringify(folded)); } catch { /* Storage may be disabled. */ } }, [folded]);
  if (!loaded && !failed && !registry.workspaces.some(w => w.nav === true)) return <p role="status" className="owner-panel__empty">Reading workspaces…</p>;
  const groups: WorkspaceDeckGroup<TaskSummary>[] = workspaceTaskGroups(tasks, registry, all).map(w => ({
    id: w.id, name: w.name, color: w.color,
    brand: w.id === "halo" || w.id === "agent-base" || w.id === "siso-agency" ? w.id : undefined,
    owners: w.owners.map(owner => ({ id: owner.owner, name: owner.owner, tasks: owner.tasks })),
    totals: { open: w.tasks.filter(t => !isDone(t)).length, active: w.tasks.filter(t => t.stage === "building").length, review: w.tasks.filter(needsYou).length },
  }));
  const expandedIds = groups.filter(w => reveal || folded[w.id] === false || (failed && w.id === "unsorted")).map(w => w.id);
  return <div className="ab-task-workspaces" data-testid="task-workspaces">
    {failed && <p role="status" className="owner-panel__empty">Workspace registry unavailable. Keeping available tasks and workspace data.</p>}
    <TaskWorkspaceDeck groups={groups} expandedIds={expandedIds} preserveEmptyGroups
      onExpandedChange={ids => setFolded(previous => {
        const next = { ...previous };
        // A search/review reveal is temporary: only the clicked fold changes its saved preference.
        for (const group of groups) if (ids.includes(group.id) !== expandedIds.includes(group.id)) next[group.id] = !ids.includes(group.id);
        return next;
      })}
      renderTask={task => <li className="twd-task-root">{renderTask(task)}</li>} />
  </div>;
}
