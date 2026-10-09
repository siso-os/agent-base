/**
 * One item in a status sidebar.
 *
 * Lifted from T3 Code's SidebarThreadRow (apps/web/src/components/Sidebar.tsx @5cc99e1c, MIT): two variants (a
 * three-line card for live items, a slim 36 px row for shelves), one surface model where colour is only the status
 * word, background work receding to 70% opacity, a self-ticking timer so only that span re-renders, and a status slot
 * that gives way to the row's actions on hover or keyboard focus. Dropped: T3's stores, drag and drop, PR and diff
 * badges, rename and file drop. The four tones and their words are SISO's (◐).
 */
import { CircleAlertIcon, CircleCheckIcon, CircleDashedIcon, MessageCircleQuestionIcon, type LucideIcon } from "lucide-react";
import { cn } from "@siso/shell";
import { memo, useEffect, useState, type KeyboardEvent, type MouseEvent, type ReactNode } from "react";
import { formatDuration } from "./format";

export type Tone = "working" | "needs" | "failed" | "done";
export type RowStatus = { label: string; tone: Tone; since?: number };

const TONE: Record<Tone, { Icon: LucideIcon; cls: string; spin?: boolean }> = {
  working: { Icon: CircleDashedIcon, cls: "text-working", spin: true },
  needs: { Icon: MessageCircleQuestionIcon, cls: "text-needs" },
  failed: { Icon: CircleAlertIcon, cls: "text-failed" },
  done: { Icon: CircleCheckIcon, cls: "text-done" },
};

/** Self-ticking so only this span re-renders each second, not the whole row (T3's WorkingDuration). */
export function Duration({ since }: { since: number }) {
  const [, setTick] = useState(0);
  useEffect(() => {
    // Hidden or idle (<html data-still>, apps/web lib/poll.ts; HEALTH 3 Oct), a row's clock re-renders every 15 s, not every second.
    let n = 0;
    const id = window.setInterval(() => (n++ % 15 === 0 || !document.documentElement.hasAttribute("data-still")) && !document.hidden && setTick((t) => t + 1), 1000);
    return () => window.clearInterval(id);
  }, []);
  return <span className="tabular-nums">{formatDuration(Date.now() - since)}</span>;
}

export function StatusWord({ status }: { status: RowStatus }) {
  const t = TONE[status.tone];
  return (
    <span className={cn("inline-flex items-center gap-1 font-medium", t.cls)} data-testid="row-status">
      <t.Icon aria-hidden className={cn("size-3.5 shrink-0", t.spin && "animate-spin-slow")} />
      {/* The label alone is the live region; a ticking timer inside it would be announced every second. */}
      <span role="status">{status.label}</span>
      {status.since !== undefined && (
        <span aria-hidden>
          <Duration since={status.since} />
        </span>
      )}
    </span>
  );
}

/** A small text button for a row's hover actions ("Settle"). */
export function RowAction({ label, Icon, text, onClick }: { label: string; Icon: LucideIcon; text?: string; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={(e: MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        onClick();
      }}
      className="inline-flex cursor-pointer items-center gap-1 rounded-md px-1.5 text-xs text-muted-foreground hover:text-foreground"
    >
      <Icon className="size-3.5" />
      {text}
    </button>
  );
}

type Common = {
  id: string;
  title: string;
  isActive: boolean;
  onOpen: () => void;
  /** Screen-reader name; defaults to the title and status. */
  ariaLabel?: string;
};

export const StatusRow = memo(function StatusRow(
  props: Common &
    (
      | {
          variant: "card";
          status: RowStatus | null;
          /** Shown in the status slot when there is no status, e.g. an age. */
          quiet?: ReactNode;
          line2?: ReactNode;
          line3?: ReactNode;
          /** Background work: dimmed and lighter until hovered or active. */
          recede?: boolean;
          /** Replace the status on hover or keyboard focus. */
          actions?: ReactNode;
          /** True while an action's menu is open, so the actions stay up after the pointer leaves. */
          holdActions?: boolean;
        }
      | {
          variant: "slim";
          mark?: ReactNode;
          right: ReactNode;
          action?: { label: string; Icon: LucideIcon; onClick: () => void };
        }
    ),
) {
  const { title, isActive, onOpen } = props;
  const onKey = (e: KeyboardEvent) => {
    if (e.target !== e.currentTarget || (e.key !== "Enter" && e.key !== " ")) return;
    e.preventDefault();
    onOpen();
  };
  const recede = props.variant === "card" && !!props.recede && !isActive;
  const surface = cn(
    "group/sidebar-row relative w-full cursor-pointer overflow-hidden rounded-md text-left outline-none select-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-action",
    isActive ? "bg-sidebar-row-active text-foreground" : "bg-transparent text-foreground hover:bg-sidebar-row-hover",
    recede && props.variant === "card" && props.status?.tone === "working" && "opacity-70 transition-opacity hover:opacity-100 focus-within:opacity-100 motion-reduce:transition-none",
  );

  if (props.variant === "slim") {
    const { mark, right, action } = props;
    return (
      <li className="list-none [content-visibility:auto] [contain-intrinsic-size:auto_36px]" data-item={props.id}>
        <div role="button" tabIndex={0} aria-label={props.ariaLabel ?? title} aria-current={isActive ? "page" : undefined} data-testid="row-slim" className={cn(surface, "flex h-9 items-center gap-2.5 px-2.5")} onClick={onOpen} onKeyDown={onKey}>
          {/* Shelved history recedes: dimmed mark at rest, restored on hover so the tail stays scannable. */}
          {mark && <span className={cn("shrink-0 transition-opacity", !isActive && "opacity-40 grayscale group-hover/sidebar-row:opacity-100 group-hover/sidebar-row:grayscale-0")}>{mark}</span>}
          <span className={cn("min-w-0 flex-1 truncate text-sm group-hover/sidebar-row:text-foreground", isActive ? "text-foreground" : "text-secondary-label/70")}>{title}</span>
          <span className="relative ml-auto flex h-6 min-w-8 shrink-0 items-center justify-end">
            <span className={cn("inline-flex justify-end text-xs tabular-nums text-secondary-label transition-opacity", action && "group-hover/sidebar-row:opacity-0")}>{right}</span>
            {action && (
              <button
                type="button"
                aria-label={action.label}
                title={action.label}
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  action.onClick();
                }}
                className="pointer-events-none absolute inset-y-0 right-0 -mr-1 inline-flex cursor-pointer items-center rounded-md px-1.5 text-xs text-muted-foreground opacity-0 transition-opacity hover:text-foreground focus-visible:pointer-events-auto focus-visible:opacity-100 group-hover/sidebar-row:pointer-events-auto group-hover/sidebar-row:opacity-100"
              >
                <action.Icon className="size-3.5" />
              </button>
            )}
          </span>
        </div>
      </li>
    );
  }

  const { status, quiet, line2, line3, actions, holdActions } = props;
  return (
    <li className="list-none py-0.5 [content-visibility:auto] [contain-intrinsic-size:auto_78px]" data-item={props.id}>
      <div role="button" tabIndex={0} aria-label={props.ariaLabel ?? (status ? `${title}, ${status.label}` : title)} aria-current={isActive ? "page" : undefined} data-testid="row-card" className={surface} onClick={onOpen} onKeyDown={onKey}>
        <div className="relative z-10 h-[4.875rem] px-2.5 py-2">
          <div className="flex h-5 min-w-0 items-center gap-1.5">
            <span className={cn("min-w-0 flex-1 truncate text-[13px] uppercase tracking-wide", recede ? "font-normal text-secondary-label" : "font-semibold text-foreground")}>{title}</span>
            {/* The visible state owns this slot's width: status at rest, actions on hover or keyboard focus. */}
            <span className="group/status-slot relative ml-auto flex h-5 min-w-8 shrink-0 items-stretch justify-end text-xs">
              <span
                className={cn(
                  "pointer-events-none flex items-center self-center tabular-nums text-secondary-label transition-opacity",
                  actions && "group-hover/sidebar-row:absolute group-hover/sidebar-row:right-0 group-hover/sidebar-row:opacity-0 group-has-[:focus-visible]/status-slot:absolute group-has-[:focus-visible]/status-slot:right-0 group-has-[:focus-visible]/status-slot:opacity-0",
                  holdActions && "absolute right-0 opacity-0",
                )}
              >
                {status ? <StatusWord status={status} /> : quiet}
              </span>
              {actions && (
                <span
                  className={cn(
                    "pointer-events-none absolute inset-y-0 right-0 -mr-1 flex items-stretch opacity-0 transition-opacity has-[:focus-visible]:pointer-events-auto has-[:focus-visible]:static has-[:focus-visible]:opacity-100 group-hover/sidebar-row:pointer-events-auto group-hover/sidebar-row:static group-hover/sidebar-row:opacity-100",
                    holdActions && "pointer-events-auto static opacity-100",
                  )}
                >
                  {actions}
                </span>
              )}
            </span>
          </div>
          <div className="mt-1 flex min-w-0 text-[13px]">{line2}</div>
          <div className="mt-0.5 flex min-w-0 items-center gap-1.5 text-xs text-secondary-label">{line3}</div>
        </div>
      </div>
    </li>
  );
});
