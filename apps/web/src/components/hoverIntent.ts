import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type HTMLAttributes, type PointerEvent as ReactPointerEvent, type RefCallback } from "react";
import { placeCard } from "@siso/shell";

/**
 * The agent card's hover engine (lane popups, 9 Oct; Shaan 7 Oct 07:55: "it'd be nice if it was more reactive, just feels
 * too sluggish"). @siso/shell's useHoverCard opens each card on its own clock, so moving from one agent to the next showed
 * the old card for its 300 ms grace, then nothing, then the new one 350 ms later: two cards, then a blink. Here every agent
 * card shares one group:
 * - cold: the card opens after a 120 ms rest on its row (intent), with a short rise in;
 * - warm (a card is open, or closed under 400 ms ago): the next agent's card replaces it in the same frame, no animation;
 * - aiming: a pointer crossing other rows on its way to the open card (inside the triangle from where it left the row to
 *   the card's near edge) does not steal it; a row only takes over once the pointer rests on it for the intent delay;
 * - leaving for empty space closes the card after a 300 ms grace; Esc closes it; there is never more than one.
 * Native child webviews sit above CSS, so a cold open still waits for the browser view to hide (siso:overlay-open);
 * a warm swap skips that wait because the view is already hidden under the card it replaces.
 */

export const INTENT_MS = 120;
export const GRACE_MS = 300;
const WARM_MS = 400;

type Point = { x: number; y: number };
type Member = { id: string; hide: () => void; card: () => HTMLElement | null; exit: Point | null; shown: boolean };
let current: Member | null = null;
let closedAt = -Infinity;
const pointer: Point = { x: -1, y: -1 };
let tracking = false;
const track = () => {
  if (tracking || typeof window === "undefined") return;
  tracking = true;
  window.addEventListener("pointermove", (e) => { pointer.x = e.clientX; pointer.y = e.clientY; }, { passive: true, capture: true });
};

const side = (a: Point, b: Point, c: Point) => (a.x - c.x) * (b.y - c.y) - (b.x - c.x) * (a.y - c.y);
/** Is `p` inside the triangle from `from` to the card's edge nearest it (the path a pointer takes to reach the card)? */
export function aiming(p: Point, from: Point | null, card: DOMRect | null) {
  if (!from || !card) return false;
  const x = from.x <= card.left ? card.left : from.x >= card.right ? card.right : null;
  if (x === null) return false;
  const a = { x, y: card.top - 8 }, b = { x, y: card.bottom + 8 };
  const d1 = side(p, from, a), d2 = side(p, a, b), d3 = side(p, b, from);
  return !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0));
}

export type IntentHover<T extends HTMLElement> = {
  triggerProps: HTMLAttributes<T> & { ref: RefCallback<T>; "data-hovercard": "" };
  cardProps: HTMLAttributes<HTMLDivElement> & { ref: RefCallback<HTMLDivElement>; "data-native-overlay": "true"; "data-esc-own": ""; "data-enter": "cold" | "warm" };
  /** Hidden until placed and the native view has hidden; position is written straight to the node (no re-render on scroll). */
  style: CSSProperties;
  bridge: HTMLAttributes<HTMLDivElement> & { ref: RefCallback<HTMLDivElement> };
  open: boolean;
  close: () => void;
};

export function useIntentHover<T extends HTMLElement = HTMLElement>({ label = "Details", side: prefer, enabled = true }: { label?: string; side?: "left"; enabled?: boolean } = {}): IntentHover<T> {
  const id = useId();
  const trigger = useRef<T | null>(null);
  const card = useRef<HTMLDivElement | null>(null);
  const gap = useRef<HTMLDivElement | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const dismissed = useRef(false);
  const [open, setOpen] = useState<false | "cold" | "warm">(false);
  const [ready, setReady] = useState(false);
  const self = useRef<Member>({ id, hide: () => {}, card: () => card.current, exit: null, shown: false });

  const clear = () => { if (timer.current) clearTimeout(timer.current); timer.current = undefined; };
  const hide = useCallback(() => {
    clear();
    if (current === self.current) { current = null; closedAt = performance.now(); }
    self.current.shown = false;
    setOpen(false);
  }, []);
  self.current.hide = hide;
  const show = useCallback((mode: "cold" | "warm") => {
    clear();
    if (current && current !== self.current) current.hide();
    current = self.current;
    self.current.exit = null;
    setOpen((was) => was || mode);
  }, []);
  const graceHide = useCallback(() => {
    clear();
    const close = () => {
      // A field being edited in the card (t-0269) keeps it open until the edit ends.
      if (card.current?.contains(document.activeElement)) timer.current = setTimeout(close, GRACE_MS);
      else hide();
    };
    timer.current = setTimeout(close, GRACE_MS);
  }, [hide]);
  const close = useCallback(() => {
    dismissed.current = true;
    const hadFocus = card.current?.contains(document.activeElement);
    hide();
    closedAt = -Infinity; // Esc means gone: the next row waits for intent again
    if (hadFocus) trigger.current?.focus();
  }, [hide]);

  /** The pointer arrived on this row: swap at once when warm, unless it is on its way to the card that is open. */
  const enter = useCallback(() => {
    if (!enabled || dismissed.current) return;
    if (current === self.current) { clear(); return; }
    const other = current;
    const warm = !!other?.shown || performance.now() - closedAt < WARM_MS;
    const busy = other && aiming(pointer, other.exit, other.card()?.getBoundingClientRect() ?? null);
    clear();
    if (warm && !busy) show("warm");
    else timer.current = setTimeout(() => show(other?.shown || performance.now() - closedAt < WARM_MS ? "warm" : "cold"), INTENT_MS);
  }, [enabled, show]);

  // A cold open waits for any native browser view to hide (it would sit above the card); a warm swap is already covered.
  useLayoutEffect(() => {
    if (!open) { setReady(false); return; }
    if (open === "warm") { setReady(true); return; }
    let live = true;
    const pending: Promise<unknown>[] = [];
    window.dispatchEvent(new CustomEvent("siso:overlay-open", { detail: { waitUntil: (p: Promise<unknown>) => pending.push(p) } }));
    if (!pending.length) setReady(true);
    else void Promise.all(pending).then(() => { if (live) setReady(true); }, () => { if (live) hide(); });
    return () => { live = false; };
  }, [open, hide]);

  useLayoutEffect(() => {
    const el = card.current, anchorEl = trigger.current;
    if (!open || !el || !anchorEl) return;
    const place = () => {
      const anchor = anchorEl.getBoundingClientRect();
      // Layout size, not the painted box: the rise-in animation scales the card for its first frames.
      const box = { width: el.offsetWidth, height: el.offsetHeight };
      const p = placeCard(anchor, box.width, box.height, window.innerWidth, window.innerHeight, prefer);
      el.style.left = `${p.left}px`; el.style.top = `${p.top}px`; el.style.maxHeight = `${p.maxHeight}px`;
      // The bridge fills only the gap between row and card: it never lies over the next row's trigger.
      const g = gap.current;
      if (g) {
        const h = Math.min(box.height, p.maxHeight), right = p.left >= anchor.right;
        const beside = p.top < anchor.bottom && p.top + h > anchor.top;
        const r = beside ? { left: right ? anchor.right : p.left + box.width, width: Math.max(0, right ? p.left - anchor.right : anchor.left - p.left - box.width), top: Math.min(anchor.top, p.top), height: Math.max(anchor.bottom, p.top + h) - Math.min(anchor.top, p.top) }
          : { left: Math.max(anchor.left, p.left), width: Math.max(0, Math.min(anchor.right, p.left + box.width) - Math.max(anchor.left, p.left)), top: p.top >= anchor.bottom ? anchor.bottom : p.top + h, height: Math.max(0, p.top >= anchor.bottom ? p.top - anchor.bottom : anchor.top - p.top - h) };
        Object.assign(g.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` });
      }
    };
    place();
    const observer = new ResizeObserver(place);
    observer.observe(el);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => { observer.disconnect(); window.removeEventListener("resize", place); window.removeEventListener("scroll", place, true); };
  }, [open, prefer]);
  useLayoutEffect(() => { self.current.shown = !!open && ready; }, [open, ready]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.preventDefault(); close(); } };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, close]);
  useEffect(() => () => { clear(); if (current === self.current) { current = null; closedAt = performance.now(); } }, []);

  const leave = (e: ReactPointerEvent) => {
    const to = e.relatedTarget instanceof Node ? e.relatedTarget : null;
    if (to && (card.current?.contains(to) || gap.current?.contains(to) || trigger.current?.contains(to))) return;
    if (!open) { clear(); return; }
    self.current.exit = { x: e.clientX, y: e.clientY };
    graceHide();
  };
  const triggerProps: IntentHover<T>["triggerProps"] = {
    ref: (node: T | null) => { trigger.current = node; },
    onPointerEnter: (e) => { if (e.pointerType === "touch") return; track(); pointer.x = e.clientX; pointer.y = e.clientY; dismissed.current = false; enter(); },
    // While another card is being aimed at, a row the pointer stops on (or leaves the path over) takes over.
    onPointerMove: (e) => {
      if (!timer.current || current === self.current || !current?.shown) return;
      pointer.x = e.clientX; pointer.y = e.clientY;
      if (!aiming(pointer, current.exit, current.card()?.getBoundingClientRect() ?? null)) show("warm");
    },
    onPointerLeave: leave,
    onFocus: () => { if (!dismissed.current && enabled && current !== self.current) { clear(); timer.current = setTimeout(() => show(current?.shown ? "warm" : "cold"), INTENT_MS); } },
    onBlur: (e) => { if (!(e.relatedTarget instanceof Node && card.current?.contains(e.relatedTarget))) { dismissed.current = false; if (open) hide(); else clear(); } },
    "aria-haspopup": "dialog",
    "aria-expanded": !!open,
    "aria-controls": open ? id : undefined,
    "data-hovercard": "",
  };
  const cardProps: IntentHover<T>["cardProps"] = {
    ref: (node: HTMLDivElement | null) => { card.current = node; },
    "data-native-overlay": "true",
    "data-esc-own": "",
    "data-enter": open === "warm" ? "warm" : "cold",
    onPointerEnter: () => { clear(); self.current.exit = null; },
    onPointerLeave: leave,
    onBlur: (e) => { if (!(e.relatedTarget instanceof Node && (e.currentTarget.contains(e.relatedTarget) || trigger.current?.contains(e.relatedTarget)))) { dismissed.current = false; hide(); } },
    role: "dialog",
    "aria-label": label,
    id,
  };
  const bridge: IntentHover<T>["bridge"] = {
    ref: (node: HTMLDivElement | null) => { gap.current = node; },
    onPointerEnter: () => clear(),
    onPointerLeave: leave,
    "aria-hidden": true,
  };
  return { triggerProps, cardProps, style: { visibility: ready ? "visible" : "hidden" }, bridge, open: !!open, close };
}
