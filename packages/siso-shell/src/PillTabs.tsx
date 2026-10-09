import { XIcon } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "./cn";

export type PillTab = { id: string; label: string; meta?: string; dotClass?: string };

/**
 * Tabs as pills in the title bar, as in Codex (no extra row), in a glass capsule like the SISO rail's utility row (shell.css). The active pill is raised; a close button shows
 * on the active pill and on hover; middle-click closes. While ⌘ is held (`showJump`) each pill shows its ⌘1-9 key.
 * Arriving at a tab (`pulse`, bumped by the caller) gives it a short ring so the eye lands on it.
 */
export function PillTabs(props: {
  tabs: PillTab[];
  activeId: string | null;
  pulse?: { id: string; n: number } | null;
  showJump?: boolean;
  onActivate: (id: string) => void;
  onClose?: (id: string) => void;
  trailing?: ReactNode;
  label?: string;
}) {
  const { tabs, activeId, pulse, showJump, onActivate, onClose } = props;
  return (
    <div role="tablist" aria-label={props.label ?? "Tabs"} className="siso-tabs">
      {tabs.map((t, i) => {
        const active = t.id === activeId;
        return (
          <div
            key={t.id}
            role="tab"
            aria-selected={active}
            tabIndex={0}
            data-testid="tab"
            data-tab={t.id}
            onClick={() => onActivate(t.id)}
            onKeyDown={(e) => e.key === "Enter" && onActivate(t.id)}
            onAuxClick={(e) => e.button === 1 && onClose?.(t.id)}
            className={cn("siso-tab", active && "is-active")}
          >
            {pulse?.id === t.id && <span key={pulse.n} aria-hidden className="pointer-events-none absolute inset-0 animate-pulse-once rounded-[inherit]" />}
            {t.dotClass && <span className={cn("size-1.5 shrink-0 rounded-full", t.dotClass)} />}
            <span className="truncate">{t.label}</span>
            {t.meta && <span className="siso-tab__meta">{t.meta}</span>}
            {showJump && i < 9 ? (
              <kbd className="siso-tab__key">⌘{i + 1}</kbd>
            ) : onClose ? (
              <button
                type="button"
                aria-label={`Close ${t.label}`}
                title="Close tab · ⌘W"
                onClick={(e) => {
                  e.stopPropagation();
                  onClose(t.id);
                }}
                className="siso-tab__close"
              >
                <XIcon className="size-3" />
              </button>
            ) : null}
          </div>
        );
      })}
      {props.trailing}
    </div>
  );
}
