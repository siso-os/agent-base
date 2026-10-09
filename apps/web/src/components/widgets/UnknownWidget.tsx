import { WidgetCard, type WidgetFile, type WidgetSize } from "./WidgetCard";

export type UnknownWidgetFile = WidgetFile<string, unknown>;

function updatedAt(value: string) {
  if (!value) return "updated time unavailable";
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? `updated ${value}` : `updated ${new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" }).format(date)}`;
}

function preview(value: unknown) {
  if (typeof value === "string") return value;
  try { return JSON.stringify(value) ?? "No details"; } catch { return "Details unavailable"; }
}

export function UnknownWidget({ widget, size }: { widget: UnknownWidgetFile; size: WidgetSize }) {
  const title = widget.title || "Untitled widget";
  const updated = updatedAt(widget.updated);
  return <WidgetCard
    size={size}
    title={title}
    description={updated}
    icon="badge-alert"
    metric="…"
    label={title}
    summary={updated}
    className="widget-unknown"
  >
    <p className="widget-unknown__body">{preview(widget.data)}</p>
  </WidgetCard>;
}
