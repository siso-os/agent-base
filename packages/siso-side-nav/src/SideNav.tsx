import { ChevronDownIcon, ChevronRightIcon } from "lucide-react";
import { ResizeHandle, cn, load, save, useResizable } from "@siso/shell";
import { useState, type HTMLAttributes, type ReactNode } from "react";

/**
 * The sidebar inside an AppFrame (the Codex app's layout): an optional header (Agent Base has none since 2 Oct: its
 * toggle lives in the top bar), then sections, with a
 * resizable right edge (Codex's clamp: 240-520 px, 275 to start, double-click to reset). Its rows are RailRows, in
 * the SISO rail's materials (rail-extras.css).
 */
export function SideNav(props: { header?: ReactNode; children: ReactNode; footer?: ReactNode; label?: string; storeKey?: string; min?: number; max?: number; initial?: number; rootProps?: HTMLAttributes<HTMLElement> & Record<`data-${string}`, string> }) {
  const { width, handleProps } = useResizable({ key: props.storeKey ?? "sidenav-width", min: props.min ?? 240, max: props.max ?? 520, initial: props.initial ?? 275, edge: "right" });
  return (
    <aside {...props.rootProps} aria-label={props.label ?? "Sidebar"} className={cn("siso-sidenav", !props.header && "is-headless")} style={{ width }}>
      {props.header && <div className="siso-sidenav__header">{props.header}</div>}
      <div className="siso-sidenav__body">{props.children}</div>
      {props.footer}
      <ResizeHandle edge="right" label="Resize sidebar" {...handleProps} />
    </aside>
  );
}

/** A section: a quiet sentence-case heading ("Agents", "Settled") with an optional note on its right, then rows. */
export function SideSection({ title, note, children, className }: { title: ReactNode; note?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cn("siso-sidenav__section", className)}>
      <h2 className="siso-sidenav__heading">
        <span>{title}</span>
        {note !== undefined && <span className="siso-sidenav__note">{note}</span>}
      </h2>
      {children}
    </section>
  );
}

/** A section that folds (T3's Settled and Snoozed shelves): hidden when empty, closed by default, remembered. */
/** `note` replaces the bare count in the heading ("3 agents"). */
export function Shelf({ title, count, note, storeKey, children }: { title: string; count: number; note?: ReactNode; storeKey: string; children: ReactNode }) {
  const [open, setOpen] = useState(() => load(storeKey, false));
  if (count === 0) return null;
  return (
    <SideSection
      title={
        <button
          type="button"
          aria-expanded={open}
          onClick={() => {
            setOpen(!open);
            save(storeKey, !open);
          }}
        >
          {open ? <ChevronDownIcon size={12} /> : <ChevronRightIcon size={12} />}
          {title}
        </button>
      }
      note={note ?? count}
    >
      {open && children}
    </SideSection>
  );
}

/** Kept for apps on the older API: a small heading with a note. */
export function NavHeading({ children, note }: { children: ReactNode; note?: ReactNode }) {
  return <SideSection title={children} note={note}>{null}</SideSection>;
}
