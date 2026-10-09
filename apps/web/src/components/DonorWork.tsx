import { useState } from "react";
import type { DonorWorkData, DonorWorkProject } from "../../../../services/node/src/donor-work";
import { TaskFold } from "./TaskFold";
import "./DonorWork.css";

type Props = {
  data: DonorWorkData | null; error?: string | null;
  onOpenProject?: (projectId: string) => void; onOpenTask?: (taskId: string) => void;
};
const mapping = { mapped: "Linked", unmapped: "Not linked yet", missing: "Linked destination missing", unavailable: "Destination unavailable" };

function WorkProject({ project, onOpenProject, onOpenTask }: { project: DonorWorkProject } & Pick<Props, "onOpenProject" | "onOpenTask">) {
  const [open, setOpen] = useState(true);
  const d = project.destination;
  return <section className="ab-donor-work__project" data-donor-project={project.ref.projectId}>
    <header>
      <button className="ab-donor-work__heading" type="button" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span aria-hidden>{open ? "▾" : "▸"}</span><span><strong>{project.name}</strong><small>{project.stage} · {project.tasks.length} tasks · {mapping[d.state]}</small></span>
      </button>
      <button type="button" disabled={d.state !== "mapped" || !onOpenProject} onClick={() => d.state === "mapped" && d.projectId && onOpenProject?.(d.projectId)}>Open project</button>
    </header>
    <TaskFold open={open}><div className="ab-donor-work__body">
      {project.oneliner && <p>{project.oneliner}</p>}
      {project.goal && <p>{project.goal}</p>}
      <ul>{project.tasks.map(task => <li key={task.key} data-donor-task={task.ref.taskId}>
        <div><strong>{task.title}</strong><small>Original workspace: {task.state} · Owner: {task.owner || "Unreported"}</small>
          <small>{mapping[task.destination.state]}{task.destination.canonicalStage ? ` · Agent Base: ${task.destination.canonicalStage}` : ""}</small></div>
        <button type="button" disabled={task.destination.state !== "mapped" || !onOpenTask} onClick={() => task.destination.state === "mapped" && task.destination.taskId && onOpenTask?.(task.destination.taskId)}>Open task</button>
      </li>)}</ul>
      {!project.tasks.length && <p>No tasks in this project.</p>}
      <details><summary>Source and links</summary><p>Original project: {project.ref.projectId}{d.projectId ? ` → ${d.projectId}` : ""}</p>
        {project.tasks.map(task => <p key={task.key}>{task.ref.taskId}{task.destination.taskId ? ` → ${task.destination.taskId}` : " · not linked"}</p>)}</details>
    </div></TaskFold>
  </section>;
}

/** Parent supplies its shared read and existing Project/Tasks navigation; no new transport or task writer. */
export function DonorWork({ data, error, onOpenProject, onOpenTask }: Props) {
  return <section className="ab-donor-work" aria-label="VPS Work">
    <header><h2>VPS Work</h2><p>Projects and tasks from the original workspace.</p></header>
    {error ? <p role="status">Work could not be refreshed. Destination links are paused.</p> : !data ? <p role="status">Reading Work…</p> :
      data.state === "unconfigured" ? <p role="status">VPS Work is not connected yet.</p> :
      data.state === "unavailable" ? <p role="status">{data.error ?? "Work is unavailable."}</p> : <>
        <p role="status">{data.state === "stale" ? "Older snapshot" : "Snapshot"} · {data.source?.capturedAt}. Status and owner are from the original workspace.</p>
        {data.projects.map(project => <WorkProject key={project.key} project={project} onOpenProject={onOpenProject} onOpenTask={onOpenTask} />)}
        {!data.projects.length && <p>No projects in this reviewed snapshot.</p>}
        <details><summary>Snapshot provenance</summary><p>Source: {data.source?.id}</p><p>Source revision: {data.source?.revision}</p><p>Snapshot revision: {data.source?.snapshotRevision}</p></details>
      </>}
  </section>;
}
