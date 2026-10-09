import { WidgetCard, type WidgetFile, type WidgetSize } from "./WidgetCard";

export type ProgressItem = { title: string; status: string; owner?: string };
export type ProgressWidgetData = { checked: number; total: number; counts: Record<string, number>; items: ProgressItem[] };
export type ProgressWidgetFile = WidgetFile<"progress", ProgressWidgetData>;

const states = ["asked", "specced", "allocated", "building", "built", "checked"];

function Ring({ checked, total }: { checked: number; total: number }) {
  const radius = 20;
  const circumference = 2 * Math.PI * radius;
  const fraction = total > 0 ? Math.min(1, Math.max(0, checked / total)) : 0;
  return <svg className="widget-progress__ring" viewBox="0 0 54 54" aria-hidden="true">
    <circle className="widget-progress__ring-track" cx="27" cy="27" r={radius} />
    <circle className="widget-progress__ring-value" cx="27" cy="27" r={radius} style={{ strokeDasharray: circumference, strokeDashoffset: circumference * (1 - fraction) }} />
  </svg>;
}

export function ProgressWidget({ widget, size }: { widget: ProgressWidgetFile; size: WidgetSize }) {
  const { counts, items } = widget.data;
  // "N of M checked" counts what it lists (R1.14: it read "0 of 0 checked" above a list of open items).
  const checked = Math.max(widget.data.checked, counts.checked ?? 0);
  const total = Math.max(widget.data.total, Object.values(counts).reduce((sum, n) => sum + (n || 0), 0), checked + items.length);
  const ratio = total > 0 ? Math.min(100, Math.max(0, checked / total * 100)) : 0;
  return <WidgetCard
    size={size}
    title="How far A0's plan is"
    description="Every ask A0 took on, and where each one is."
    icon="clipboard-check"
    count={`${checked}/${total}`}
    metric={<>{checked}<small>/{total}</small></>}
    label="of A0's plan checked"
    tileExtra={<Ring checked={checked} total={total} />}
    className="widget-progress"
  >
    <div className="widget-progress__summary"><b>{checked} of {total}</b><span>checked</span>
      <div className="widget-progress__stack" aria-label={`${Math.round(ratio)} percent checked`}>
        {states.map((state) => counts[state] > 0 && <i key={state} className={`is-${state}`} style={{ flexGrow: counts[state] }} title={`${counts[state]} ${state}`} />)}
      </div>
    </div>
    <ul className="widget-list widget-progress__list">{(size === "L" ? items : items.slice(0, 4)).map((item, index) => <li key={`${item.status}-${item.title}-${index}`}>
      <span className={`widget-progress__state is-${item.status.toLowerCase().replace(/[^a-z-]/g, "")}`}>{item.status}</span>
      <b>{item.title.slice(0, 90)}</b><span className="widget-list__meta">{item.owner || "no owner yet"}</span>
    </li>)}</ul>
    {!items.length && <p className="siso-widget__empty">No open plan items.</p>}
  </WidgetCard>;
}
