import { useEffect, useRef, type ReactNode } from "react";
import { Maximize2Icon, XIcon } from "lucide-react";
import { HaloRim, ResizeHandle, useResizable } from "@siso/shell";
import "./PagePop.css";

/** The pages that pop out (Servers and Tokens reuse this shell in their own rounds). */
export type PoppedPage = "tasks" | "stats";
/** Each page's hue: the pop's rim and its strip icon's underline (rule 8: never amber, which is needs-you's alone). */
export const PAGE_HUE: Record<PoppedPage, string> = { tasks: "rgb(167 139 250)", stats: "rgb(53 212 155)" };

const KEY = "ab.popped";
/** Which page is popped out, remembered across reloads (SPEC-STATS-TASKS §2: localStorage["ab.popped"]). */
export function loadPopped(): PoppedPage | null {
  try {
    const v = localStorage.getItem(KEY);
    return v === "tasks" || v === "stats" ? v : null;
  } catch {
    return null;
  }
}
export function savePopped(v: PoppedPage | null) {
  try {
    localStorage.setItem(KEY, v ?? "");
  } catch {
    /* private window: it just isn't remembered */
  }
}

/**
 * A page popped out beside the side nav (SPEC-STATS-TASKS §2; Shaan 3 Oct ~05:00: "service is just another side nav popped
 * out"): a 380 px column in the halo-rim card, the chat still beside it. Its header carries the page's name and one-line
 * answer, ⤢ (back to the full page) and × (close; Esc while focus is inside does the same). The right edge drags 320-560 px,
 * double-click resets. The body is the page's own component: it switches layout with a container query, never a second
 * implementation.
 */
export function PagePop({ page, title, answer, onExpand, onClose, children }: { page: PoppedPage; title: string; answer?: ReactNode; onExpand: () => void; onClose: () => void; children: ReactNode }) {
  const { width, handleProps } = useResizable({ key: "pop.w", min: 320, max: 560, initial: 380, edge: "right" });
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const esc = (e: KeyboardEvent) => {
      // A row opened inside the page closes first (it stops the event); a second Esc closes the pop.
      if (e.key === "Escape" && !e.defaultPrevented) onClose();
    };
    el.addEventListener("keydown", esc);
    return () => el.removeEventListener("keydown", esc);
  }, [onClose]);
  return (
    <aside className="ab-pop" aria-label={`${title}, popped out`} data-testid="page-pop" data-page={page} style={{ width }}>
      <HaloRim hue={PAGE_HUE[page]} className="ab-pop__rim">
        <div ref={box} className="ab-pop__box" tabIndex={-1}>
          <header className="ab-pop__head">
            <h2>
              {title}
              {answer && <span> · {answer}</span>}
            </h2>
            <button type="button" aria-label={`Open ${title} as a page`} title="Open as a page" onClick={onExpand}>
              <Maximize2Icon aria-hidden="true" />
            </button>
            <button type="button" aria-label={`Close ${title}`} title="Close · Esc" onClick={onClose}>
              <XIcon aria-hidden="true" />
            </button>
          </header>
          <div className="ab-pop__body">{children}</div>
        </div>
      </HaloRim>
      <ResizeHandle edge="right" label={`Resize ${title}`} {...handleProps} />
    </aside>
  );
}
