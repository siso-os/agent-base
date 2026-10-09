import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "./cn";

export type RailSpace = { id: string; name: string; Icon: LucideIcon; live?: boolean; badge?: number };

/**
 * The rail, like Codex: one icon per space, its name on hover, a count when something there needs you. Spaces not
 * built yet are drawn dimmed and say "later", so the shape is visible without a dead click. The top 40 px is left
 * for the window's traffic lights and dragging.
 */
export function Rail(props: { spaces: RailSpace[]; lower?: RailSpace[]; current: string; onPick?: (id: string) => void; footer?: ReactNode }) {
  const item = (s: RailSpace) => {
    const current = s.id === props.current;
    return (
      <button
        key={s.id}
        type="button"
        title={s.live ? s.name : `${s.name} · later`}
        aria-label={s.name}
        aria-current={current ? "page" : undefined}
        disabled={!s.live}
        onClick={() => props.onPick?.(s.id)}
        className={cn(
          "relative flex size-9 items-center justify-center rounded-lg",
          current ? "bg-sidebar-row-active text-foreground" : s.live ? "text-secondary-label hover:bg-sidebar-row-hover hover:text-foreground" : "cursor-default text-muted-foreground/45",
        )}
      >
        <s.Icon className="size-[18px]" strokeWidth={1.75} />
        {!!s.badge && <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-needs px-1 text-3xs font-semibold text-black">{s.badge}</span>}
      </button>
    );
  };
  return (
    <nav aria-label="Spaces" className="flex w-[52px] shrink-0 flex-col items-center gap-1 border-r border-border bg-sidebar pb-3">
      <div data-tauri-drag-region className="h-10 w-full shrink-0" />
      {props.spaces.map(item)}
      {props.lower && props.lower.length > 0 && <div className="my-1 h-px w-6 bg-border" />}
      {props.lower?.map(item)}
      <div className="flex-1" />
      {props.footer}
    </nav>
  );
}
