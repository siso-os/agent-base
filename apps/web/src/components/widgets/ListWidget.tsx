import { WidgetCard, type WidgetFile, type WidgetSize } from "./WidgetCard";

export type ListRow = { meta: string; title: string; quote?: string };
export type ListWidgetFile = WidgetFile<"list", { rows: ListRow[] }>;

export function ListWidget({ widget, size }: { widget: ListWidgetFile; size: WidgetSize }) {
  const rows = widget.data.rows;
  return <WidgetCard
    size={size}
    title="What you told A0 you want"
    description="Your goals, in your own words, newest first."
    icon="rocket"
    count={rows.length}
    metric={rows.length}
    label="goals in your words"
    summary={rows[0]?.title.slice(0, 60) ?? "No goals indexed"}
    className="widget-list-shape"
  >
    <ul className="widget-list widget-list-shape__rows">{(size === "S" ? rows.slice(0, 1) : size === "L" ? rows.slice(0, 8) : rows.slice(0, 3)).map((row, index) => <li key={`${row.meta}-${row.title}-${index}`}>
      <span className="widget-list__meta">{row.meta}</span><b>{row.title}</b>{row.quote && <q>{row.quote.slice(0, size === "L" ? 240 : 160)}</q>}
    </li>)}</ul>
  </WidgetCard>;
}
