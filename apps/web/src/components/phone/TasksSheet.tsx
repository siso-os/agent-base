// uihub: arc:bottom-sheet
import { BottomSheet } from "@siso/shell";
import { XIcon } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Agent } from "../../lib/agents";
import { TaskList } from "../OwnerTasksPanel";

/** The visible one of a selector (a phone keeps every open chat mounted, only one shown). */
const shown = (sel: string) => [...document.querySelectorAll<HTMLElement>(sel)].find((e) => e.offsetParent);

/**
 * A chat's tasks on a phone (phone spec §3 A; Shaan 2 Oct 18:00: "so I could still talk to my agent and see what's
 * allocated there"). The sheet peeks above the composer and expands up to the chat header, so the composer stays live under
 * it: he talks while he looks. The list is the panel's Tasks card (Now · Needs · All · Done, the owners' faces on Agent
 * Zero, a row opens in place to change its stage, priority and next step). Drag or use the grabber to expand/collapse; drag below the peek, tap the title or × to close.
 */
export function TasksSheet({ a, agents, onClose }: { a: Agent; agents: Agent[]; onClose: () => void }) {
  const [box, setBox] = useState<{ top: number; bottom: number } | null>(null);
  const panel = useRef<HTMLElement>(null);
  // Header bottom to composer top, kept true as the composer grows (a long draft, a queued message) or the keyboard opens.
  useLayoutEffect(() => {
    const measure = () => {
      const head = shown("[data-testid=chat-head]");
      const comp = shown(".siso-chat__composer");
      const vv = window.visualViewport;
      const visualTop = vv?.offsetTop ?? 0;
      const visualBottom = visualTop + (vv?.height ?? window.innerHeight);
      const top = Math.max(visualTop, head ? head.getBoundingClientRect().bottom : 52);
      const bottom = Math.max(0, window.innerHeight - Math.min(visualBottom, comp ? comp.getBoundingClientRect().top : visualBottom));
      setBox((b) => (b && b.top === top && b.bottom === bottom ? b : { top, bottom }));
    };
    measure();
    const ro = new ResizeObserver(measure);
    for (const sel of ["[data-testid=chat-head]", ".siso-chat__composer"]) {
      const el = shown(sel);
      if (el) ro.observe(el);
    }
    window.addEventListener("resize", measure);
    window.visualViewport?.addEventListener("resize", measure);
    window.visualViewport?.addEventListener("scroll", measure);
    return () => (ro.disconnect(), window.removeEventListener("resize", measure), window.visualViewport?.removeEventListener("resize", measure), window.visualViewport?.removeEventListener("scroll", measure));
  }, [a.id]);
  // An opened task's stage row scrolls sideways: bring its current stage into view (phone spec §3 A, "current filled").
  useEffect(() => {
    const body = panel.current?.querySelector(".ab-tsheet__body");
    if (!body) return;
    const centre = () => {
      for (const row of body.querySelectorAll<HTMLElement>('[role=group][aria-label="Stage"]')) {
        const on = row.querySelector<HTMLElement>("[aria-pressed=true]");
        if (!on || row.dataset.centred === on.textContent) continue;
        const r = row.getBoundingClientRect(), b = on.getBoundingClientRect();
        row.scrollLeft += b.left - r.left - (r.width - b.width) / 2;
        row.dataset.centred = on.textContent ?? "";
      }
    };
    const mo = new MutationObserver(centre);
    mo.observe(body, { childList: true, subtree: true, attributes: true, attributeFilter: ["aria-pressed"] });
    return () => mo.disconnect();
  }, []);
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [onClose]);
  const name = a.zero ? "Agent Zero" : a.name;
  return (
    <BottomSheet panelRef={panel} className="ab-tsheet" aria-label={`${name}'s tasks`} data-testid="tasks-sheet" onClose={onClose}
      maxHeight={box ? Math.max(0, window.innerHeight - box.top - box.bottom) : 0}
      style={box ? { bottom: box.bottom } : { visibility: "hidden" }}>
      <header className="ab-tsheet__head">
        <button type="button" className="ab-tsheet__title" onClick={onClose} aria-label={`Close ${name}'s tasks`}>
          {name}'s tasks
        </button>
        <button type="button" className="ab-phone-icon" aria-label="Close" data-testid="tasks-sheet-close" onClick={onClose}>
          <XIcon size={18} aria-hidden />
        </button>
      </header>
      <div className="ab-tsheet__body" data-sheet-content>
        <TaskList owner={a.name} everyone={!!a.zero} plain={!a.zero && (a.kind === "worker" || !!a.lead)} agents={agents} />
      </div>
    </BottomSheet>
  );
}
