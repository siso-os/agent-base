import { useState } from "react";
import { Icon } from "../lib/Icon";
import type { PlanItem, OrgOwner } from "../lib/org-types";
import "./OwnerTasks.css";

export type FolderTask = { id: string; title: string; state: string; holder?: string; branch?: string; updated?: string };
type Props = {
  owner: OrgOwner;
  planItems?: PlanItem[];
  taskFolders?: FolderTask[];
  onOpenItem: (item: PlanItem | FolderTask) => void;
};

const LABEL: Record<string, string> = { asked: "Asked", specced: "Specced", allocated: "Allocated", building: "Building", built: "Built", checked: "Checked", parked: "Parked", dropped: "Dropped", open: "Open", claimed: "Claimed", review: "Review", done: "Done", failed: "Failed" };

export function OwnerTasks({ owner, planItems = [], taskFolders = [], onOpenItem }: Props) {
  const [expanded, setExpanded] = useState(false);
  const openPlan = planItems.filter((item) => !["checked", "parked", "dropped"].includes(item.status));
  const openFolders = taskFolders.filter((task) => !["done", "dropped"].includes(task.state));
  const total = openPlan.length + openFolders.length;
  return (
    <section className="owner-tasks">
      <button className="owner-tasks__owner" type="button" aria-expanded={expanded} onClick={() => setExpanded((value) => !value)}>
        <span className="owner-tasks__caret" aria-hidden>{expanded ? "▾" : "▸"}</span>
        <i className={`owner-tasks__dot is-${owner.state}`} aria-hidden />
        <b><Icon name={owner.icon} size={16} /> {owner.name}</b>
        <span className="owner-tasks__count">{total} open</span>
        {owner.plan && <span className="owner-tasks__progress">{owner.plan.checked} of {owner.plan.total}</span>}
      </button>
      {expanded && <div className="owner-tasks__children">
        {!total && <span className="owner-tasks__empty">No open items</span>}
        {openPlan.map((item) => <button type="button" className="owner-tasks__item" key={`plan-${item.id}`} onClick={() => onOpenItem(item)}>
          <i className={`owner-tasks__dot is-${item.status}`} aria-hidden />
          <span className="owner-tasks__title">{item.title}</span><span className="owner-tasks__state">{LABEL[item.status] ?? item.status}</span>
        </button>)}
        {openFolders.map((task) => <button type="button" className="owner-tasks__item" key={`task-${task.id}`} onClick={() => onOpenItem(task)}>
          <i className={`owner-tasks__dot is-${task.state}`} aria-hidden />
          <span className="owner-tasks__title">{task.title}</span><span className="owner-tasks__state">{LABEL[task.state] ?? task.state}</span>
        </button>)}
      </div>}
    </section>
  );
}
