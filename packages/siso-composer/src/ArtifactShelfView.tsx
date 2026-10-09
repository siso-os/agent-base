import { useState, type ReactNode } from "react";
import { CloseIcon } from "./icons";
import "./shelf.css";

export type ShelfItem = { id: string; label: string; title?: string; kind?: string; icon?: ReactNode };
/** The application supplies the visible items and persists dismissals. Expansion is local presentation state. */
export function ArtifactShelfView({ items, onOpen, onHide, label = "Artifacts", visibleCount = 4 }: {
  items: ShelfItem[]; onOpen: (id: string) => void; onHide: (id: string) => void; label?: string; visibleCount?: number;
}) {
  const [all, setAll] = useState(false);
  if (!items.length) return null;
  const shown = all ? items : items.slice(0, visibleCount);
  return <div className="ab-shelf" data-testid="artifact-shelf" aria-label={label}>
    {shown.map(item => <span key={item.id} className={`ab-shelf__chip${item.kind ? ` is-${item.kind}` : ""}`}>
      <button type="button" className="ab-shelf__open" title={item.title} onClick={() => onOpen(item.id)}>{item.icon}<span>{item.label}</span><i aria-hidden>↗</i></button>
      <button type="button" className="ab-shelf__x" aria-label={`Put away ${item.label}`} title="Put away" onClick={() => onHide(item.id)}><CloseIcon size={10}/></button>
    </span>)}
    {items.length > visibleCount && <button type="button" className="ab-shelf__more" onClick={() => setAll(value => !value)}>{all ? "less" : `+${items.length - visibleCount}`}</button>}
  </div>;
}
