import { useEffect, useRef, useState, type ReactNode } from "react";
import { Maximize2Icon, XIcon } from "lucide-react";
import type { Agent } from "../lib/agents";
import { AgentFace, accentRgb, faceFor } from "../lib/face";
import { ChatView } from "./ChatView";
import "./ZeroDock.css";

const KEY = "agent-base.dock.width";
const readWidth = () => {
  try {
    const v = Number(localStorage.getItem(KEY));
    return v >= 320 ? Math.min(v, 400) : null;
  } catch {
    return null;
  }
};

/**
 * Agent Zero docked over whatever page he is on (t-0216; his 14:47 words: "I press that and then ... I can still click
 * around"; 21:5x: "where is my chat dock"). His face bottom-right opens it: a phone-sized popup with A0's chat in the
 * halo rim (the same ChatView and HUD as the main chat), resizable from its left edge, and no backdrop, so the page
 * beside it keeps taking clicks. Esc (outside the message box, where Esc stops the agent) or the face closes it.
 */
export function ZeroDock({ zero, people, hud, onClose, onOpenFull }: { zero: Agent; people?: Parameters<typeof ChatView>[0]["people"]; hud: ReactNode; onClose: () => void; onOpenFull: () => void }) {
  const [width, setWidth] = useState<number | null>(readWidth);
  const drag = useRef<{ x: number; w: number } | null>(null);
  const self = useRef<HTMLElement>(null);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      if ((e.target as HTMLElement | null)?.closest?.("textarea, input, [role=menu], [role=dialog]")) return;
      onClose();
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [onClose]);
  const move = (e: PointerEvent) => {
    if (!drag.current) return;
    const w = Math.min(window.innerWidth - 24, Math.max(320, Math.min(400, drag.current.w + drag.current.x - e.clientX)));
    setWidth(w);
  };
  const up = () => {
    drag.current = null;
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
    try {
      const w = self.current?.getBoundingClientRect().width;
      if (w) localStorage.setItem(KEY, String(Math.round(w)));
    } catch {
      /* the width just isn't kept */
    }
  };
  return (
    <aside ref={self} className="ab-zdock" aria-label="Agent Zero, docked" data-testid="zero-dock" style={width ? { width } : undefined}>
      <div
        className="ab-zdock__grip"
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize the dock"
        onPointerDown={(e) => {
          drag.current = { x: e.clientX, w: self.current?.getBoundingClientRect().width ?? 380 };
          window.addEventListener("pointermove", move);
          window.addEventListener("pointerup", up);
        }}
      />
      <header className="ab-zdock__head">
        <AgentFace {...faceFor(zero)} size={22} />
        <b>Agent Zero</b>
        <span className="ab-zdock__k">docked · the page beside stays live</span>
        <button type="button" aria-label="Open his full chat" title="Open his full chat" onClick={onOpenFull}>
          <Maximize2Icon size={14} />
        </button>
        <button type="button" aria-label="Close the dock" title="Close · Esc" data-testid="dock-close" onClick={onClose}>
          <XIcon size={15} />
        </button>
      </header>
      <div className="ab-zdock__chat">
        <ChatView agentId={zero.id} active people={people} accent={accentRgb(zero.project)} hud={hud} />
      </div>
    </aside>
  );
}
