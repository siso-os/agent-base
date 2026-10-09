/**
 * One line per item, the Codex way: a small state mark, the name, a timestamp. Nothing else competes with the name:
 * no status word, no second line, no colour except the mark. Hover or keyboard focus swaps the timestamp for the
 * row's actions. Rows drag to reorder inside a SortableRail (RailRow.tsx), as in herdr.
 *
 * A lead's crew folds under it (Shaan, 2 Oct: "sub agents working underneath them"): the lead carries a chevron
 * and, folded, a count; crew rows are indented on a guide line.
 *
 * Marks: working = a turning ring (the animation he likes), needs you = an amber dot, done (unseen) = a green dot,
 * failed = a red dot, quiet = nothing.
 */
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ChevronDownIcon, ChevronRightIcon, FolderIcon, FolderOpenIcon } from "lucide-react";
import { cn, load, save } from "@siso/shell";
import { memo, useContext, useEffect, useState, type KeyboardEvent, type ReactNode } from "react";
import { formatDuration } from "./format";
import { SortableOn } from "./RailRow";
import type { Tone } from "./StatusRow";

export type ThreadMark = Tone | "quiet";

function Ticking({ since }: { since: number }) {
  const [, setTick] = useState(0);
  useEffect(() => {
    // Hidden or idle (<html data-still>, apps/web lib/poll.ts; HEALTH 3 Oct), a row's clock re-renders every 15 s, not every second.
    let n = 0;
    const id = window.setInterval(() => (n++ % 15 === 0 || !document.documentElement.hasAttribute("data-still")) && !document.hidden && setTick((t) => t + 1), 1000);
    return () => window.clearInterval(id);
  }, []);
  return <>{formatDuration(Date.now() - since)}</>;
}

type Props = {
  id: string;
  name: string;
  mark: ThreadMark;
  /** Live timer start (working, needs you) or a fixed label (an age). */
  since?: number;
  time?: string;
  active?: boolean;
  dim?: boolean;
  actions?: ReactNode;
  holdActions?: boolean;
  onOpen: () => void;
  ariaLabel?: string;
  title?: string;
  /** A lead with crew: the fold that shows or hides them, and how many there are. */
  fold?: { open: boolean; count?: number; onToggle: () => void };
  /** Drawn in place of the state mark (an avatar that shows the state itself, e.g. Agent Base's faces). */
  lead?: ReactNode;
  /** A crew row, indented under its lead with a guide line. */
  crew?: boolean;
  /** Small clickable notes after the name ("· 3 working", "· 4 tasks"), e.g. what it has running out of sight. */
  badge?: Badge | Badge[];
  /** A small mark right after the name (a pin glyph on a pinned owner shown in its project). */
  glyph?: ReactNode;
  /** Compact context reading; the app decides when it is useful (for example on a phone). */
  context?: ReactNode;
  /** One status slot (StatusSlot) in place of the time and the hover actions: it does the swap itself. */
  slot?: ReactNode;
};

type Badge = { label: string; title?: string; live?: boolean; onClick: () => void; testId?: string };

function Body(p: Props & { setRef?: (el: HTMLElement | null) => void; style?: React.CSSProperties; handle?: Record<string, unknown>; dragging?: boolean }) {
  const onKey = (e: KeyboardEvent) => {
    if (e.target !== e.currentTarget || (e.key !== "Enter" && e.key !== " ")) return;
    e.preventDefault();
    p.onOpen();
  };
  return (
    <div
      ref={p.setRef}
      style={p.style}
      role="button"
      tabIndex={0}
      title={p.title}
      aria-label={p.ariaLabel ?? p.name}
      aria-current={p.active ? "page" : undefined}
      data-testid="rail-row"
      data-item={p.id}
      className={cn("siso-thread", p.crew && "is-crew", p.active && "is-active", p.dim && "is-dim", p.dragging && "is-dragging", p.holdActions && "is-held", `is-${p.mark}`)}
      onClick={p.onOpen}
      onKeyDown={onKey}
      {...p.handle}
    >
      {!p.crew &&
        p.fold && (
          <button
            type="button"
            className="siso-thread__fold"
            aria-expanded={p.fold.open}
            aria-label={p.fold.open ? `Hide ${p.name}'s crew` : `Show ${p.name}'s crew`}
            onClick={(e) => {
              e.stopPropagation();
              p.fold!.onToggle();
            }}
            onPointerDown={(e) => e.stopPropagation()}
          >
            {p.fold.open ? <ChevronDownIcon aria-hidden="true" /> : <ChevronRightIcon aria-hidden="true" />}
          </button>
        )}
      {p.lead ? <span className="siso-thread__lead" aria-hidden="true">{p.lead}</span> : <span className="siso-thread__mark" aria-hidden="true" />}
      <span className="siso-thread__name">{p.name}</span>
      {p.glyph}
      {p.context}
      {[p.badge ?? []].flat().map((b) => (
        <button
          key={b.label}
          type="button"
          className={cn("siso-thread__badge", b.live && "is-live")}
          title={b.title}
          data-testid={b.testId}
          onClick={(e) => {
            e.stopPropagation();
            b.onClick();
          }}
          onPointerDown={(e) => e.stopPropagation()}
        >
          · {b.label}
        </button>
      ))}
      {p.fold && !p.fold.open && p.fold.count !== undefined && <span className="siso-thread__count">{p.fold.count}</span>}
      {p.slot ?? (
        <>
          <span className="siso-thread__time">{p.since !== undefined ? <Ticking since={p.since} /> : p.time}</span>
          {p.actions && <span className="siso-thread__actions">{p.actions}</span>}
        </>
      )}
    </div>
  );
}

function Sortable(p: Props) {
  const s = useSortable({ id: p.id });
  return <Body {...p} setRef={s.setNodeRef} dragging={s.isDragging} style={{ transform: CSS.Translate.toString(s.transform), transition: s.transition }} handle={{ ...s.listeners }} />;
}

export const ThreadRow = memo(function ThreadRow(p: Props) {
  return useContext(SortableOn) ? <Sortable {...p} /> : <Body {...p} />;
});

/**
 * A project folder (Codex's Projects list): a folder row that opens and closes, its items indented under it. Inside a
 * SortableRail the folder drags by its row (Shaan, 2 Oct 14:40: "drag to reorder the project folders").
 */
type GroupProps = {
  id: string;
  name: string;
  count?: ReactNode;
  /** Muted words after the name ("2 agents working"), in place of a count. */
  note?: ReactNode;
  icon?: ReactNode;
  children: ReactNode;
  /** Clicking the name does this (opens its page); the row's caret still folds it. */
  onName?: () => void;
  /** Hover actions on the row (⋯). */
  actions?: ReactNode;
};
function GroupBody(p: GroupProps & { setRef?: (el: HTMLElement | null) => void; style?: React.CSSProperties; handle?: Record<string, unknown>; dragging?: boolean }) {
  const [open, setOpen] = useState(() => load(`project-open:${p.id}`, true));
  return (
    <div ref={p.setRef} style={p.style} className={cn("siso-project", p.dragging && "is-dragging")} data-project={p.id}>
      <button
        type="button"
        className="siso-project__row"
        aria-expanded={open}
        onClick={() => {
          setOpen(!open);
          save(`project-open:${p.id}`, !open);
        }}
        {...p.handle}
      >
        {p.icon ?? (open ? <FolderOpenIcon aria-hidden="true" /> : <FolderIcon aria-hidden="true" />)}
        {p.onName ? (
          <span
            role="link"
            tabIndex={0}
            className="siso-project__name is-link"
            onClick={(e) => {
              e.stopPropagation();
              p.onName!();
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.stopPropagation();
                p.onName!();
              }
            }}
          >
            {p.name}
          </span>
        ) : (
          <span className="siso-project__name">{p.name}</span>
        )}
        {p.count !== undefined && <span className="siso-project__count">{p.count}</span>}
        {p.note !== undefined && <span className="siso-project__note">{p.note}</span>}
        {p.actions && (
          <span className="siso-project__actions" onClick={(e) => e.stopPropagation()} onPointerDown={(e) => e.stopPropagation()}>
            {p.actions}
          </span>
        )}
        {open ? <ChevronDownIcon className="siso-project__chev" aria-hidden="true" /> : <ChevronRightIcon className="siso-project__chev" aria-hidden="true" />}
      </button>
      {open && <div className="siso-project__items">{p.children}</div>}
    </div>
  );
}
function SortableGroup(p: GroupProps) {
  const s = useSortable({ id: p.id });
  return <GroupBody {...p} setRef={s.setNodeRef} dragging={s.isDragging} style={{ transform: CSS.Translate.toString(s.transform), transition: s.transition }} handle={{ ...s.listeners }} />;
}
export function ProjectGroup(p: GroupProps) {
  return useContext(SortableOn) ? <SortableGroup {...p} /> : <GroupBody {...p} />;
}
