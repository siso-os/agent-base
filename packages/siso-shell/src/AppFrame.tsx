/**
 * AppFrame: the SISO desktop shell, laid out like the Codex app (Shaan, 2 Oct: "they've got a top bar spare up there,
 * and then it's like Everything's wrapped in a smaller bar And you've got space along the side And the top").
 *
 *   ┌ top bar: window controls, tabs, layout ────────────────────┐
 *   │ icons │ ╭ frame: the app's sidebar and its work ─────────╮ │
 *   │  ⌂    │ │                                                 │ │
 *   │  ◇    │ │                                                 │ │
 *   │  SS   │ ╰─────────────────────────────────────────────────╯ │
 *
 * The top bar and the icon column sit on the window's darker canvas; the main work sits in one rounded frame.
 * An optional side slot spans both rows on desktop, reserving its own width beside the top controls and the frame.
 * Materials come from the SISO tokens (shell.css).
 */
import type { LucideIcon } from "lucide-react";
import { useEffect, useState, type HTMLAttributes, type ReactNode } from "react";
import { cn } from "./cn";
import { HoverCard, Peek, type PeekContent } from "./HoverCard";
import { installTooltips } from "./tooltips";

export function AppFrame({ top, rail, railFooter, side, children, topProps }: { top: ReactNode; rail: ReactNode; railFooter?: ReactNode; side?: ReactNode; children: ReactNode; topProps?: HTMLAttributes<HTMLElement> & Record<`data-${string}`, string> }) {
  useEffect(() => installTooltips(), []);
  return (
    <div className="siso-app">
      <header {...topProps} className="siso-app__top" data-tauri-drag-region>
        {top}
      </header>
      <nav className="siso-app__rail" aria-label="Spaces">
        {rail}
        <div className="siso-app__rail-gap" />
        {railFooter}
      </nav>
      <div className="siso-app__frame">{children}</div>
      {side && <div className="siso-app__side">{side}</div>}
    </div>
  );
}

/**
 * One space in the icon column: a dot when something there needs you, dimmed when not built yet. On hover, its card
 * (HoverCard): `label` as the title, `line` on what it is, `meta` a shortcut or a count. The button's accessible name
 * stays "label: line". A space not built yet still shows its card, so it is aria-disabled rather than disabled (a
 * disabled button gets no pointer events).
 */
/** `dot` marks the button; `dot="alert"` marks it red (something behind it is down). */
/** `peek` adds an interactive door: click pins it; content actions choose the destination. */
/** `onWarm` runs when the pointer or focus reaches the button, before the click: the page behind it can start loading. */
export function RailButton({ label, line, meta, Icon, renderIcon, active, later, dot, onClick, onWarm, peek }: { label: string; line?: string; meta?: ReactNode; Icon: LucideIcon; renderIcon?: (engaged: boolean) => ReactNode; active?: boolean; later?: boolean; dot?: boolean | "alert"; onClick?: () => void; onWarm?: () => void; peek?: PeekContent }) {
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const button = (
      <button
        type="button"
        className={cn("siso-app__rail-btn", active && "is-active", later && "is-later")}
        aria-label={line ? `${label}: ${line}` : label}
        aria-current={active ? "page" : undefined}
        aria-disabled={later || undefined}
        onClick={later || peek ? undefined : onClick}
        onPointerEnter={() => { setHovered(true); if (!later) onWarm?.(); }}
        onPointerLeave={() => setHovered(false)}
        onFocus={() => { setFocused(true); if (!later) onWarm?.(); }}
        onBlur={() => setFocused(false)}
      >
        {renderIcon ? <span aria-hidden="true" className="siso-app__rail-art">{renderIcon(!later && (hovered || focused))}</span> : <Icon aria-hidden="true" />}
        {dot && <span className={cn("siso-app__rail-dot", dot === "alert" && "is-alert")} />}
      </button>
  );
  return peek && !later ? <Peek title={label} content={peek} testId="rail-peek">{button}</Peek> : (
    <HoverCard title={label} line={later ? line ?? "Not built yet" : line} meta={later ? "later" : meta} delay={60} closeDelay={0}>{button}</HoverCard>
  );
}

export function RailDivider() {
  return <span className="siso-app__rail-divider" aria-hidden="true" />;
}

/** A small icon button for the top bar (sidebar toggle and the like). */
export function TopButton({ label, Icon, onClick, pressed }: { label: string; Icon: LucideIcon; onClick: () => void; pressed?: boolean }) {
  return (
    <button type="button" className="siso-app__top-btn" aria-label={label} title={label} aria-pressed={pressed} onClick={onClick}>
      <Icon aria-hidden="true" />
    </button>
  );
}
