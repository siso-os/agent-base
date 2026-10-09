import { ArrowLeft, ArrowUpRight, type LucideIcon } from "lucide-react";
import type { KeyboardEvent, ReactNode } from "react";
import "./hub-page.css";
import { Boundary } from "../Boundary";

/**
 * The one page template (t-0176, Shaan 2 Oct: "start taking principles from the streaming app and the halo CRM ... the
 * widget system"). A port of the HALO CRM's page and widget engine (crm repo: src/kit/page/HubPage.tsx,
 * src/widgets/engine/WidgetShell.tsx, WidgetGrid.css), cut to what this app uses:
 *
 *   HubPage     the hero: a bare icon, a kicker, the title, one line, up to two of the page's numbers; a way back on a
 *               details page. Under it, the page's widgets.
 *   WidgetGrid  one 12-column grid. A widget's size is its span, as HALO's: S 3, S-wide 4, M 6, L 8, XL 12. A narrow
 *               page stacks them (S tiles two to a row).
 *   Widget      every card: one head (bare icon · title · one grey line · figures · the ↗ door), a body, an optional
 *               floor. Loading, failed and empty are the widget's own states, so a slow source never blanks the page.
 *
 * A figure with no real value is the dash, never a blank or a made-up 0.
 */
export const DASH = "—";
export type WidgetSize = "S" | "S-wide" | "M" | "L" | "XL";
export const SPAN: Record<WidgetSize, number> = { S: 3, "S-wide": 4, M: 6, L: 8, XL: 12 };
export type Tone = "ok" | "warn" | "bad" | "none";
export type HeroChip = { label: string; value: ReactNode; tone?: Tone };
export type WidgetStat = { value: ReactNode; unit?: ReactNode; label?: ReactNode };

const blank = (v: ReactNode) => v === null || v === undefined || v === "" || (typeof v === "number" && !Number.isFinite(v));

export function HubPage({ id, icon: Icon, kicker, title, blurb, chips = [], back, action, children }: {
  /** The page's id: `data-hub` on the page, for tests and the help. */
  id: string;
  icon?: LucideIcon;
  kicker?: ReactNode;
  title: ReactNode;
  /** One line: what the page is for, or the record's own line. */
  blurb?: ReactNode;
  /** Up to two of the page's own numbers. */
  chips?: readonly HeroChip[];
  /** A details page's way back to its list. */
  back?: { label: string; onClick: () => void };
  /** The page's one action, in the hero's corner. */
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="hub-page" data-hub={id} data-testid="hub-page">
      {back && (
        <button type="button" className="hub-page__back" onClick={back.onClick} data-testid="hub-back">
          <ArrowLeft size={14} aria-hidden /> {back.label}
        </button>
      )}
      <header className="hub-hero" data-testid="hub-hero">
        {Icon && (
          <span className="hub-hero__icon">
            <Icon size={20} strokeWidth={1.8} aria-hidden />
          </span>
        )}
        <div className="hub-hero__text">
          {kicker && <span className="hub-hero__kicker">{kicker}</span>}
          <h2 className="hub-hero__title">{title}</h2>
          {blurb && <p className="hub-hero__blurb">{blurb}</p>}
        </div>
        {(chips.length > 0 || action) && (
          <div className="hub-hero__aside">
            {chips.slice(0, 2).map((c) => (
              <span key={c.label} className="hub-chip" data-tone={c.tone ?? "none"} data-testid="hub-chip">
                <b>{blank(c.value) ? DASH : c.value}</b>
                <small>{c.label}</small>
              </span>
            ))}
            {action}
          </div>
        )}
      </header>
      {children}
    </div>
  );
}

export function WidgetGrid({ children, label }: { children: ReactNode; label?: string }) {
  return (
    <div className="hub-grid" aria-label={label}>
      {children}
    </div>
  );
}

function HeadStat({ stat }: { stat: WidgetStat }) {
  const none = blank(stat.value);
  return (
    <span className="hub-stat">
      {stat.label && <small>{stat.label}</small>}
      <b>
        {none ? DASH : stat.value}
        {!none && stat.unit && <i>{stat.unit}</i>}
      </b>
    </span>
  );
}

/** The widget's body while it has nothing to draw: a few quiet bars, the failure in words, or what "nothing" means here. */
function Placeholder({ loading, failed, empty }: { loading?: boolean; failed?: string | null; empty?: ReactNode }) {
  if (failed) return <p className="hub-widget__note is-failed">{failed}</p>;
  if (loading)
    return (
      <div className="hub-skel" aria-label="Loading" data-testid="widget-loading">
        <span />
        <span />
        <span />
      </div>
    );
  return <p className="hub-widget__note">{empty}</p>;
}

export function Widget({ id, size, icon: Icon, title, sub, stat, door, onOpen, footer, loading, failed, empty, tone, children }: {
  id: string;
  size: WidgetSize;
  icon?: LucideIcon;
  title: ReactNode;
  /** One grey line under the title: what the card shows. */
  sub?: ReactNode;
  /** Figures on the right of the head. */
  stat?: WidgetStat | readonly WidgetStat[];
  /** The ↗ in the head: where this card's detail lives. */
  door?: { label: string; onOpen: () => void };
  /** The whole card opens its detail (the door's target unless given). */
  onOpen?: () => void;
  /** The floor: one note under a hairline. */
  footer?: ReactNode;
  loading?: boolean;
  failed?: string | null;
  /** What the body says when there is nothing in it (shown when this is set and the body is not). */
  empty?: ReactNode;
  /** A needs-room card gets an amber edge, a down one red. */
  tone?: Tone;
  children?: ReactNode;
}) {
  const stats = stat === undefined ? [] : Array.isArray(stat) ? stat : [stat as WidgetStat];
  const go = onOpen ?? door?.onOpen;
  const key = (e: KeyboardEvent) => {
    if (go && e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) (e.preventDefault(), go());
  };
  const body = failed || loading || (empty && (children === undefined || children === null || children === false));
  return (
    <section
      className={`hub-widget${go ? " is-open" : ""}`}
      data-size={size}
      data-span={SPAN[size]}
      data-tone={tone ?? "none"}
      data-widget={id}
      data-testid="widget"
      aria-label={typeof title === "string" ? title : id}
      role={go ? "link" : undefined}
      tabIndex={go ? 0 : undefined}
      // A button or link inside the card (a pipeline stage, a row) does its own thing; the card opens only on its own
      // surface (t-0390: stage clicks bubbled into "Open all tasks" and lost the stage filter).
      onClick={go && ((e) => { if (!(e.target as Element).closest("button, a, input, select, textarea, summary")) go(); })}
      onKeyDown={key}
    >
      <header className="hub-widget__head">
        {Icon && (
          <span className="hub-widget__icon">
            <Icon size={16} strokeWidth={1.8} aria-hidden />
          </span>
        )}
        <div className="hub-widget__heading">
          <h3>{title}</h3>
          {sub && <p>{sub}</p>}
        </div>
        {(stats.length > 0 || door) && (
          <div className="hub-widget__aside">
            {stats.map((s, i) => (
              <HeadStat key={i} stat={s} />
            ))}
            {door && (
              <button
                type="button"
                className="hub-widget__door"
                aria-label={door.label}
                title={door.label}
                data-testid="widget-door"
                onClick={(e) => (e.stopPropagation(), door.onOpen())}
              >
                <ArrowUpRight size={15} strokeWidth={2.2} aria-hidden />
              </button>
            )}
          </div>
        )}
      </header>
      {/* QA #13 (A0, 3 Oct): one card that cannot draw says so; the page and the other cards stay. */}
      <div className="hub-widget__body">{body ? <Placeholder loading={loading} failed={failed} empty={empty} /> : <Boundary name={typeof title === "string" ? title : "This card"} kind="card">{children}</Boundary>}</div>
      {footer && <footer className="hub-widget__floor">{footer}</footer>}
    </section>
  );
}
