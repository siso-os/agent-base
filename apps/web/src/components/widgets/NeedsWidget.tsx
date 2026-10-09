import { WidgetCard, type WidgetFile, type WidgetSize } from "./WidgetCard";

export type NeedItem = { id: string; title: string; detail?: string; minutes?: number; link?: string };
export type NeedsWidgetData = { items: NeedItem[] };
export type NeedsWidgetFile = WidgetFile<"needs", NeedsWidgetData>;

function shortTitle(title: string, limit = 90) {
  const colon = title.split(":")[0];
  const head = colon.split(/\s+/).length >= 3 ? colon : title.split(" (")[0];
  return head.trim().slice(0, limit);
}

function detailFor(item: NeedItem) {
  if (item.detail) return item.detail;
  const short = shortTitle(item.title, 999);
  return item.title.slice(short.length).replace(/^\s*:?\s*/, "").replace(/\s*\((?:about |under )?\d+ ?min\).*$/i, "").trim();
}

function minutesFor(item: NeedItem) {
  if (item.minutes !== undefined) return item.minutes;
  const match = /\((?:about |under )?(\d+) ?min\)/i.exec(item.title);
  return match ? Number(match[1]) : null;
}

export function NeedsWidget({ widget, size }: { widget: NeedsWidgetFile; size: WidgetSize }) {
  const items = widget.data.items;
  return <WidgetCard
    size={size}
    title="Waiting on you"
    description="Only you can do these; each says how long."
    icon="bell"
    count={items.length}
    metric={items.length}
    label="waiting on you"
    summary={items[0] ? shortTitle(items[0].title, 60) : "Nothing"}
    className="widget-needs"
  >
    <ul className="widget-list widget-needs__list">{(size === "L" ? items : items.slice(0, 4)).map((item) => {
      const minutes = minutesFor(item);
      return <li key={item.id}>
        <span className="widget-needs__tick" aria-hidden="true" />
        <div className="widget-needs__copy"><b>{shortTitle(item.title)}</b>{detailFor(item) && <span>{detailFor(item)}</span>}</div>
        {minutes !== null && <em className="widget-needs__minutes">{minutes} min</em>}
        {item.link && <a className="widget-needs__open" href={item.link}>Open</a>}
      </li>;
    })}</ul>
  </WidgetCard>;
}
