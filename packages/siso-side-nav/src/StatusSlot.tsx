/**
 * One trailing status slot per row, the Codex way: it shows exactly one thing (a spinner and the time since the last
 * event, a "needs you" pill, a tick and an age, an age, "quiet 14m", "failed", "off"), and on hover or keyboard focus
 * it becomes the row's actions. No dot beside a time beside a count. Styled in rail-extras.css (`.siso-slot`).
 */
import { CheckIcon } from "lucide-react";
import { cn } from "@siso/shell";
import type { ReactNode } from "react";

export type SlotState = "working" | "needs" | "done" | "idle" | "quiet" | "failed" | "offline";

export function StatusSlot({ state, text, actions, small }: { state: SlotState; text: string; actions?: ReactNode; small?: boolean }) {
  return (
    <span className={cn("siso-slot", `is-${state}`, small && "is-small")} data-state={state} data-testid="status-slot">
      <span className="siso-slot__state">
        {state === "working" && <i className="siso-slot__spin" aria-hidden="true" />}
        {state === "done" && <CheckIcon aria-hidden="true" />}
        <span className="siso-slot__text">{text}</span>
      </span>
      {actions && (
        <span className="siso-slot__acts" onClick={(e) => e.stopPropagation()} onPointerDown={(e) => e.stopPropagation()}>
          {actions}
        </span>
      )}
    </span>
  );
}
