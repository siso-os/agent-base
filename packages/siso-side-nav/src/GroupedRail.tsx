/**
 * GroupedRail: the SISO side nav.
 *
 * Lifted from the SISO CRM (apps/SISOCRM/product-app/src/components/GroupedRail.tsx @552f83b, styles
 * GroupedRail.css copied verbatim as ../grouped-rail.css): the champagne-glass rail with its bloom and noise, the
 * brand tile + name + collapse toggle header, the search field with ⌘K, labelled groups, the global-utility capsule,
 * and the operator dock. Changed: no router; the app passes its groups, utilities and dock as children, so the same
 * rail serves any SISO app. Collapsed (52 px) shows `compact` instead of the labelled body.
 */
import { PanelLeftClose, PanelLeftOpen, Search, type LucideIcon } from "lucide-react";
import { cn } from "@siso/shell";
import type { ReactNode } from "react";

export function GroupedRail(props: {
  /** Product name beside the brand tile, e.g. "Agent Base". A node, so it can carry a switcher menu. */
  name: ReactNode;
  /** The brand tile's content: an <img> or a mark. */
  brand: ReactNode;
  collapsed: boolean;
  onToggle: () => void;
  onSearch?: () => void;
  searchLabel?: string;
  /** A capsule of icon buttons under the search (spaces, views). */
  top?: ReactNode;
  /** The labelled groups. */
  children: ReactNode;
  /** What shows instead of the groups when collapsed: icons only. */
  compact?: ReactNode;
  /** The global-utility capsule at the bottom (Needs you, New chat). */
  utilities?: ReactNode;
  /** The operator dock: who is signed in, on what machine. */
  dock?: ReactNode;
  label?: string;
  className?: string;
}) {
  const { collapsed } = props;
  return (
    <nav className={cn("siso-sidebar", collapsed ? "is-collapsed" : "is-expanded", props.className)} aria-label={props.label ?? "Navigation"} data-verify-unit="GroupedRail">
      <div className="siso-sidebar__bloom" aria-hidden="true" />
      <div className="siso-sidebar__noise" aria-hidden="true" />
      <header className="siso-sidebar__header">
        <span className="siso-sidebar__brand" aria-hidden="true">
          {props.brand}
        </span>
        {!collapsed && <div className="siso-sidebar__identity">{props.name}</div>}
        <button type="button" onClick={props.onToggle} className="siso-sidebar__toggle" aria-label={collapsed ? "Expand rail" : "Collapse rail"} title={collapsed ? "Expand navigation" : "Collapse navigation"}>
          {collapsed ? <PanelLeftOpen aria-hidden="true" /> : <PanelLeftClose aria-hidden="true" />}
        </button>
      </header>
      {props.onSearch && (
        <button type="button" className="siso-sidebar__search" onClick={props.onSearch} aria-label="Open search" title="Jump to anything (⌘K)">
          <Search className="siso-sidebar__search-icon" aria-hidden="true" />
          {!collapsed && <span className="siso-sidebar__search-label">{props.searchLabel ?? "Search…"}</span>}
          {!collapsed && <kbd className="siso-sidebar__search-shortcut">⌘K</kbd>}
        </button>
      )}
      {!collapsed && props.top}
      <div className="siso-sidebar__body">{collapsed ? props.compact : <div className="siso-sidebar__navigation">{props.children}</div>}</div>
      {!collapsed && props.utilities}
      {props.dock}
    </nav>
  );
}

/** A labelled group: the small uppercase heading, an optional note or action on its right, then its items. */
export function RailGroup({ id, label, note, children }: { id: string; label: ReactNode; note?: ReactNode; children: ReactNode }) {
  return (
    <section className="siso-sidebar__nav-group" aria-labelledby={`siso-nav-group-${id}`}>
      <h2 className="siso-sidebar__group-heading siso-rail-heading" id={`siso-nav-group-${id}`}>
        <span>{label}</span>
        {note && <span className="siso-rail-heading__note">{note}</span>}
      </h2>
      <div className="siso-sidebar__nav-items">{children}</div>
    </section>
  );
}

/** One icon in a capsule row (the CRM's utility link). `badge` shows a count; `active` takes the brand glow. */
export function RailIcon({ label, Icon, onClick, active, disabled, badge, title }: { label: string; Icon: LucideIcon; onClick?: () => void; active?: boolean; disabled?: boolean; badge?: number; title?: string }) {
  return (
    <button type="button" className={cn("siso-sidebar__utility-link", active && "is-active", disabled && "is-later")} aria-label={label} title={title ?? label} onClick={onClick} disabled={disabled}>
      <Icon aria-hidden="true" />
      {!!badge && <span className="siso-rail-badge">{badge}</span>}
    </button>
  );
}

/** A capsule of RailIcons (the CRM's global row). */
export function RailCapsule({ children, label, className }: { children: ReactNode; label: string; className?: string }) {
  return (
    <div className={cn("siso-sidebar__global-row", className)} aria-label={label}>
      {children}
    </div>
  );
}

/** The operator dock: an orb, a name and a status line. */
export function RailDock({ orb, name, status, collapsed }: { orb: ReactNode; name: string; status: string; collapsed: boolean }) {
  return (
    <div className="siso-sidebar__operator">
      <div className="siso-sidebar__profile" title={`${name} · ${status}`}>
        <span className="siso-sidebar__profile-orb">{orb}</span>
        {!collapsed && (
          <div className="siso-sidebar__profile-copy">
            <span className="siso-sidebar__profile-label">{name}</span>
            <span className="siso-sidebar__profile-status">{status}</span>
          </div>
        )}
      </div>
    </div>
  );
}
