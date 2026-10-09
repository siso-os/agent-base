/**
 * The Codex summary card and the side panel it opens (Shaan, 2 Oct: "a drop down summary card … and then you click on
 * it and it opens up a [side panel] with a bar up top and then you can exit it").
 *
 * SummaryCard floats at the top right of the work area and drops open from a top-bar button; its rows open the
 * SidePanel, a right-hand column with a title bar and a close button.
 */
import { ChevronDownIcon, ChevronRightIcon, XIcon, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { usePersisted } from "./persist";
import { ResizeHandle, useResizable } from "./Resizable";
import { cn } from "./cn";

export function SummaryCard({ children, label }: { children: ReactNode; label: string }) {
  return (
    <section className="siso-card" aria-label={label} data-testid="summary-card">
      {children}
    </section>
  );
}

/**
 * A heading inside the card ("Stats", "Sub-agents"). With `fold` (a storage key) it is a drop-down that remembers
 * whether it is open; `note` sits on the heading's right (a count or a total).
 */
export function CardSection({ title, children, fold, note }: { title: ReactNode; children: ReactNode; fold?: string; note?: ReactNode }) {
  const [open, setOpen] = usePersisted(fold ? `card-open:${fold}` : "card-open:-", true);
  if (!fold)
    return (
      <div className="siso-card__section">
        <h3 className="siso-card__title">{title}</h3>
        {children}
      </div>
    );
  return (
    <div className="siso-card__section">
      <button type="button" className="siso-card__title siso-card__fold" aria-expanded={open} onClick={() => setOpen(!open)}>
        {open ? <ChevronDownIcon aria-hidden="true" /> : <ChevronRightIcon aria-hidden="true" />}
        <span>{title}</span>
        {note !== undefined && <span className="siso-card__note">{note}</span>}
      </button>
      {open && children}
    </div>
  );
}

/** A row inside the card. With onClick it opens something (the side panel); `later` marks a row not built yet. */
export function CardRow({ Icon, label, detail, onClick, later }: { Icon: LucideIcon; label: ReactNode; detail?: ReactNode; onClick?: () => void; later?: boolean }) {
  const inner = (
    <>
      <Icon aria-hidden="true" />
      <span className="siso-card__label">{label}</span>
      {detail !== undefined && <span className="siso-card__detail">{detail}</span>}
    </>
  );
  return onClick && !later ? (
    <button type="button" className="siso-card__row" onClick={onClick}>
      {inner}
    </button>
  ) : (
    <div className={cn("siso-card__row is-static", later && "is-later")}>{inner}</div>
  );
}

export function SidePanel({ title, onClose, children, full, storeKey = "side-panel-width" }: { title: ReactNode; onClose: () => void; children: ReactNode; full?: boolean; storeKey?: string }) {
  const { width, handleProps } = useResizable({ key: storeKey, min: 320, max: 900, initial: 420, edge: "left" });
  return (
    <aside className={cn("siso-side", full && "is-full")} style={full ? undefined : { width }} aria-label="Side panel" data-testid="side-panel">
      {!full && <ResizeHandle edge="left" label="Resize side panel" {...handleProps} />}
      <header className="siso-side__bar">
        <span className="siso-side__title">{title}</span>
        <button type="button" className="siso-side__close" aria-label="Close" title="Close · Esc" onClick={onClose}>
          <XIcon aria-hidden="true" />
        </button>
      </header>
      <div className="siso-side__body">{children}</div>
    </aside>
  );
}
