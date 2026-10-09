import { useState } from "react";
import { ArrowRightLeft, Check, ChevronDown, CircleAlert, LoaderCircle, Sparkles } from "lucide-react";
import type { MoveStatus, MoveTarget } from "../../../../services/node/src/move";
import "./MoveMenu.css";

export type MoveOption = { id: MoveTarget; label: string; detail: string; icon: typeof Sparkles };
export const MOVE_OPTIONS: MoveOption[] = [
  { id: "opus", label: "Claude Opus", detail: "Claude · Opus", icon: Sparkles },
  { id: "fable", label: "Claude Fable", detail: "Claude · Fable", icon: Sparkles },
  { id: "sonnet", label: "Claude Sonnet", detail: "Claude · Sonnet", icon: Sparkles },
  { id: "luna", label: "Codex Luna", detail: "Codex · Luna", icon: ArrowRightLeft },
  { id: "sol", label: "Codex Sol", detail: "Codex · Sol", icon: ArrowRightLeft },
  { id: "deepseek", label: "DeepSeek", detail: "OpenCode · DeepSeek", icon: ArrowRightLeft },
];

type Props = {
  current: MoveTarget;
  status?: MoveStatus | null;
  onMove: (to: MoveTarget) => void;
  disabled?: boolean;
  defaultOpen?: boolean;
};

export function MoveMenu({ current, status, onMove, disabled = false, defaultOpen = false }: Props) {
  const [open, setOpen] = useState(defaultOpen);
  const active = status?.state === "moving" || status?.state === "queued";
  const copy = status?.state === "waiting-idle" ? "Waiting for idle" : status?.state === "moving" ? "Moving agent…" : status?.state === "queued" ? "Move queued" : status?.state === "done" ? `On ${MOVE_OPTIONS.find((item) => item.id === status.to)?.label ?? "new model"} now` : status?.state === "failed" ? status.message : "";
  return (
    <div className="move-menu">
      <button className="move-menu__trigger" type="button" aria-haspopup="menu" aria-expanded={open} disabled={disabled || active} onClick={() => setOpen((value) => !value)}>
        <ArrowRightLeft size={14} aria-hidden /> <span>Move to…</span><ChevronDown size={13} aria-hidden />
      </button>
      {open && <>
        <button className="move-menu__dismiss" type="button" aria-label="Close move menu" onClick={() => setOpen(false)} />
        <div className="move-menu__panel" role="menu" aria-label="Move agent to model">
          <div className="move-menu__heading">Choose a destination</div>
          {MOVE_OPTIONS.map(({ id, label, detail, icon: Icon }) => (
            <button key={id} className="move-menu__option" role="menuitem" type="button" disabled={id === current || active} onClick={() => { setOpen(false); onMove(id); }}>
              <Icon size={15} aria-hidden /> <span className="move-menu__labels"><b>{label}</b><small>{detail}</small></span>
              {id === current && <Check size={14} aria-label="Current model" />}
            </button>
          ))}
        </div>
      </>}
      {copy && <div className={`move-menu__status is-${status?.state}`} role="status">
        {active ? <LoaderCircle className="move-menu__spin" size={13} aria-hidden /> : status?.state === "failed" ? <CircleAlert size={13} aria-hidden /> : null}
        <span>{copy}</span>
      </div>}
    </div>
  );
}
