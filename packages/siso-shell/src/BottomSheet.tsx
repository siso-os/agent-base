// uihub: arc:bottom-sheet
import { useLayoutEffect, useRef, useState, type ComponentPropsWithoutRef, type Ref } from "react";
import "./bottom-sheet.css";

/** Adapted from Arc's official registry/components/bottom-sheet/bottom-sheet.tsx,
 * https://uiarc.dev/r/bottom-sheet.json (SHA-256 3bec01c6f348635cab9bd33510fb3bb1f6c9d97cce1861c5ebb0a8956746a719).
 * Keep its sampled release velocity, projection/flick rules, grabber keys and click suppression.
 * Replace Radix's modal/portal and Motion's translated extended surface with a bounded region
 * and direct height updates: native sign-in stays visible and the composer remains usable.
 * No rubber-band overflow beyond the upper bound: that space belongs to the chat/native header. */
type Sample = { t: number; y: number };
const PROJECTION = .2;
const FLICK = 320;
const CLOSED_GAP = 40;

// Arc's velocityOf: a pause before release drops momentum instead of retaining an old flick.
function velocityOf(samples: Sample[], now: number) {
  const recent = samples.filter(sample => now - sample.t <= 80);
  const first = recent[0], last = recent[recent.length - 1];
  if (!first || !last || last === first || now - last.t > 60) return 0;
  return (last.y - first.y) / ((last.t - first.t) / 1000);
}

export function BottomSheet({ children, onClose, maxHeight, panelRef, expand, style, className = "", ...props }:
  ComponentPropsWithoutRef<"section"> & { onClose: () => void; maxHeight?: number; panelRef?: Ref<HTMLElement>; expand?: boolean }) {
  const panel = useRef<HTMLElement | null>(null);
  const [available, setAvailable] = useState(0);
  const [detent, setDetent] = useState(0);
  const drag = useRef<{ id: number; y: number; height: number; current: number; from: number; samples: Sample[]; moved: boolean } | null>(null);
  const suppressClick = useRef(false);
  const height = (index: number) => available * (index === 0 ? 0.45 : 1);
  const settle = (index: number) => {
    setDetent(index);
    if (index === 0) panel.current?.querySelectorAll<HTMLElement>('[data-sheet-content]').forEach(body => { body.scrollTop = 0; });
    if (panel.current) panel.current.style.height = `${height(index)}px`;
  };
  useLayoutEffect(() => {
    const measure = () => {
      const vv = window.visualViewport;
      const viewport = vv?.height ?? window.innerHeight;
      const parent = panel.current?.parentElement;
      const parentHeight = parent?.getBoundingClientRect().height ?? viewport;
      setAvailable(Math.max(0, maxHeight ?? Math.min(viewport - 64, parentHeight)));
      drag.current = null;
      panel.current?.removeAttribute("data-dragging");
    };
    measure();
    const ro = new ResizeObserver(measure);
    if (maxHeight === undefined && panel.current?.parentElement) ro.observe(panel.current.parentElement);
    window.addEventListener("resize", measure);
    window.visualViewport?.addEventListener("resize", measure);
    return () => { ro.disconnect(); window.removeEventListener("resize", measure); window.visualViewport?.removeEventListener("resize", measure); };
  }, [maxHeight]);
  // New content (for example an account mismatch) can request room without remounting its native page.
  useLayoutEffect(() => { if (expand) setDetent(1); }, [expand]);
  const finish = (cancelled: boolean, time: number) => {
    const d = drag.current;
    if (!d) return;
    drag.current = null;
    panel.current?.removeAttribute("data-dragging");
    suppressClick.current = d.moved;
    if (cancelled) { settle(detent); return; }
    if (!d.moved) { settle(detent); return; }
    const velocity = velocityOf(d.samples, time);
    const projected = d.current - velocity * PROJECTION;
    // Arc includes the closed stop in the nearest-detent candidates.
    let target = [0, 1, -1].reduce((best, stop) => {
      const stopHeight = stop === -1 ? -CLOSED_GAP : height(stop);
      const bestHeight = best === -1 ? -CLOSED_GAP : height(best);
      return Math.abs(stopHeight - projected) < Math.abs(bestHeight - projected) ? stop : best;
    });
    if (Math.abs(velocity) > FLICK && target === d.from) target = velocity < 0 ? 1 : d.from === 0 ? -1 : 0;
    if (target === -1) { onClose(); return; }
    settle(target);
  };
  return <section {...props} ref={(el) => {
    panel.current = el;
    if (typeof panelRef === "function") panelRef(el);
    else if (panelRef) panelRef.current = el;
  }} className={`siso-bottom-sheet ${className}`} role="region" data-detent={detent === 0 ? "peek" : "expanded"}
    style={{ ...style, height: height(detent), visibility: available ? style?.visibility : "hidden" }}
    onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); onClose(); } }}
    onWheel={(e) => { if (detent === 0 && e.deltaY > 4 && !drag.current && (e.target as HTMLElement).closest('[data-sheet-content]')) settle(1); }}
    onFocusCapture={(e) => { if (detent === 0 && (e.target as HTMLElement).closest('[data-sheet-content]')) settle(1); }}>
    <button type="button" className="siso-bottom-sheet__grab" aria-label={detent === 0 ? "Expand sheet" : "Collapse sheet"} aria-expanded={detent === 1}
      onClick={() => { if (suppressClick.current) { suppressClick.current = false; return; } settle(detent === 0 ? 1 : 0); }}
      onKeyDown={(e) => {
        if (!["ArrowUp", "ArrowDown", "Home", "End"].includes(e.key)) return;
        e.preventDefault(); settle(e.key === "ArrowUp" || e.key === "Home" ? 1 : 0);
      }}
      onPointerDown={(e) => {
        if (!e.isPrimary || e.button !== 0) return;
        suppressClick.current = false;
        drag.current = { id: e.pointerId, y: e.clientY, height: height(detent), current: height(detent), from: detent, samples: [{ t: e.timeStamp, y: e.clientY }], moved: false };
        e.currentTarget.setPointerCapture(e.pointerId);
        panel.current?.setAttribute("data-dragging", "true");
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (!d || d.id !== e.pointerId) return;
        d.samples.push({ t: e.timeStamp, y: e.clientY });
        if (d.samples.length > 12) d.samples.shift();
        d.moved ||= Math.abs(e.clientY - d.y) >= 3;
        d.current = Math.max(0, Math.min(available, d.height + d.y - e.clientY));
        if (panel.current) panel.current.style.height = `${d.current}px`;
      }}
      onPointerUp={(e) => finish(false, e.timeStamp)} onPointerCancel={(e) => finish(true, e.timeStamp)} onLostPointerCapture={(e) => finish(true, e.timeStamp)}>
      <span aria-hidden="true" />
    </button>
    {children}
    <span className="siso-bottom-sheet__announcement" role="status">{detent === 0 ? "Sheet at peek height" : "Sheet expanded"}</span>
  </section>;
}
