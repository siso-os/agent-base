import { cloneElement, useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type FocusEvent as ReactFocusEvent, type HTMLAttributes, type PointerEvent as ReactPointerEvent, type ReactElement, type ReactNode, type Ref, type RefCallback } from "react";
import { createPortal } from "react-dom";

/**
 * One hover card for the whole app (hover-all, Shaan 3 Oct 05:15): the agent card and every rail and side-nav icon's card
 * share this engine. It opens after a short hover (hover intent), stays while the pointer crosses to it, closes on Esc,
 * and is drawn in document.body: above the side nav and outside every clipping parent, placed by `placeCard`.
 */

export const CARD_MARGIN = 8;

/**
 * Where a card goes: beside its anchor, right first, the left when the right has no room, inside the window with an 8 px
 * margin either way; level with the anchor's top, or with its bottom when that leaves no room below. A card taller than
 * the window scrolls inside it.
 */
export function placeCard(anchor: { left: number; right: number; top: number; bottom: number }, width: number, height: number, vw: number, vh: number, side?: "left") {
  const m = CARD_MARGIN, gap = 10;
  const fitsRight = anchor.right + gap + width <= vw - m;
  const fitsLeft = anchor.left - gap - width >= m;
  const ideal = side === "left" && fitsLeft ? anchor.left - gap - width : fitsRight || !fitsLeft && vw - anchor.right >= anchor.left ? anchor.right + gap : anchor.left - gap - width;
  const left = Math.max(m, Math.min(ideal, vw - m - width));
  // On a narrow window, leave the trigger usable: put the card below/above it instead of clamping over it.
  if (!fitsRight && !fitsLeft) {
    const below = Math.max(0, vh - m - anchor.bottom - gap);
    const above = Math.max(0, anchor.top - gap - m);
    const useBelow = height <= below || below >= above;
    const maxHeight = useBelow ? below : above;
    return { left, top: useBelow ? Math.min(vh - m, anchor.bottom + gap) : Math.max(m, anchor.top - gap - Math.min(height, maxHeight)), maxHeight };
  }
  const maxHeight = Math.max(0, vh - 2 * m);
  const h = Math.min(height, maxHeight);
  const below = anchor.top + h <= vh - m;
  const top = Math.max(m, Math.min(below ? anchor.top : anchor.bottom - h, vh - m - h));
  return { left, top, maxHeight };
}

export type HoverCardBindings<T extends HTMLElement = HTMLElement> = {
  triggerProps: HTMLAttributes<T> & { ref: RefCallback<T>; "data-hovercard": "" };
  cardProps: HTMLAttributes<HTMLDivElement> & { ref: RefCallback<HTMLDivElement>; "data-native-overlay": "true" };
  style: CSSProperties;
  /** The invisible strip between the trigger and the card: the pointer crossing it keeps the card open (his 15:33). */
  bridge: HTMLAttributes<HTMLDivElement> & { style: CSSProperties };
  open: boolean;
  close: () => void;
};

/**
 * Delayed pointer hover, focus support, Escape dismissal and viewport-aware placement for a trigger and its card.
 * `dialog`: the card holds controls (the agent card's fields and buttons); otherwise it is a label (role tooltip).
 */
export function useHoverCard<T extends HTMLElement = HTMLElement>(delay = 250, { dialog = true, label = "Details", side, closeDelay = 300, pinned = false, onDismiss }: { dialog?: boolean; label?: string; side?: "left"; closeDelay?: number; pinned?: boolean; onDismiss?: () => void } = {}): HoverCardBindings<T> {
  const id = useId();
  const triggerRef = useRef<HTMLElement | null>(null);
  const cardRef = useRef<HTMLDivElement | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const dismissed = useRef(false);
  const [hovered, setOpen] = useState(false);
  const open = hovered || pinned;
  const dismissRef = useRef(onDismiss);
  dismissRef.current = onDismiss;
  const [nativeReady, setNativeReady] = useState(false);
  const [position, setPosition] = useState<CSSProperties>({ visibility: "hidden" });
  const [gapBox, setGapBox] = useState<CSSProperties>({ display: "none" });
  const clear = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    if (closeTimer.current) clearTimeout(closeTimer.current);
  }, []);
  const scheduleHide = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    if (closeTimer.current) clearTimeout(closeTimer.current);
    if (pinned) return;
    // A field being edited in the card (t-0269) keeps it open; it closes on the next beat after the edit ends.
    const close = () => {
      if (cardRef.current?.contains(document.activeElement)) closeTimer.current = setTimeout(close, 300);
      else { dismissed.current = false; setOpen(false); }
    };
    if (closeDelay <= 0) close(); else closeTimer.current = setTimeout(close, closeDelay);
  }, [closeDelay, pinned]);
  const show = useCallback(() => {
    clear();
    if (dismissed.current) return;
    timer.current = setTimeout(() => setOpen(true), delay);
  }, [clear, delay]);
  const hide = useCallback(() => { clear(); setOpen(false); }, [clear]);
  const close = useCallback(() => { dismissed.current = true; hide(); dismissRef.current?.(); triggerRef.current?.focus(); }, [hide]);
  const previousPin = useRef(pinned);
  useLayoutEffect(() => {
    // A caller closing a controlled panel also ends the hover that first opened it.
    if (previousPin.current && !pinned) { dismissed.current = true; hide(); }
    previousPin.current = pinned;
  }, [pinned, hide]);

  // Native child webviews sit above CSS. Let mounted native slots acknowledge hiding before painting a card.
  useLayoutEffect(() => {
    if (!open) { setNativeReady(false); return; }
    let active = true;
    const pending: Promise<unknown>[] = [];
    window.dispatchEvent(new CustomEvent("siso:overlay-open", { detail: { waitUntil: (promise: Promise<unknown>) => pending.push(promise) } }));
    if (!pending.length) setNativeReady(true);
    else void Promise.all(pending).then(() => { if (active) setNativeReady(true); }, () => { if (active) close(); });
    return () => { active = false; };
  }, [open, close]);

  useLayoutEffect(() => {
    if (!open || !triggerRef.current || !cardRef.current) return;
    const place = () => {
      const anchor = triggerRef.current!.getBoundingClientRect();
      const card = cardRef.current!.getBoundingClientRect();
      const place = placeCard(anchor, card.width, card.height, window.innerWidth, window.innerHeight, side);
      setPosition({ left: place.left, top: place.top, maxHeight: place.maxHeight, visibility: nativeReady ? "visible" : "hidden" });
      const { left, top } = place;
      const right = left > anchor.left;
      const y0 = Math.min(anchor.top, top), y1 = Math.max(anchor.bottom, top + Math.min(card.height, place.maxHeight));
      const bottom = top + Math.min(card.height, place.maxHeight);
      if (top >= anchor.bottom || bottom <= anchor.top) {
        const x0 = Math.min(anchor.left, left), x1 = Math.max(anchor.right, left + card.width);
        setGapBox({ position: "fixed", zIndex: 2147482999, left: x0, width: x1 - x0, top: top >= anchor.bottom ? anchor.bottom - 4 : bottom - 4, height: (top >= anchor.bottom ? top - anchor.bottom : anchor.top - bottom) + 8 });
      } else {
      setGapBox({ position: "fixed", zIndex: 2147482999, left: right ? anchor.right - 4 : left + card.width, width: Math.max(0, right ? left - anchor.right + 8 : anchor.left - left - card.width + 4), top: y0, height: y1 - y0 });
      }
    };
    place();
    const observer = new ResizeObserver(place);
    observer.observe(cardRef.current);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => { observer.disconnect(); window.removeEventListener("resize", place); window.removeEventListener("scroll", place, true); };
  }, [open, side, nativeReady]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); close(); }
    };
    // A click on the trigger (it opens its page) puts the label away.
    const onDown = (event: PointerEvent) => {
      if (pinned && event.target instanceof Node && !triggerRef.current?.contains(event.target) && !cardRef.current?.contains(event.target)) { hide(); dismissRef.current?.(); }
      if (!dialog && triggerRef.current?.contains(event.target as Node)) { dismissed.current = true; hide(); } };
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onDown, true);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onDown, true);
    };
  }, [clear, close, hide, open, dialog, pinned]);
  useEffect(() => () => clear(), [clear]);

  const triggerProps: HoverCardBindings<T>["triggerProps"] = {
    ref: (node: T | null) => { triggerRef.current = node; },
    onPointerEnter: (event) => { if (event.pointerType !== "touch") { dismissed.current = false; show(); } },
    onPointerLeave: (event) => { if (!(event.relatedTarget instanceof Node && cardRef.current?.contains(event.relatedTarget))) scheduleHide(); },
    onFocus: show,
    onBlur: (event) => { if (!(event.relatedTarget instanceof Node && cardRef.current?.contains(event.relatedTarget))) { dismissed.current = false; if (!pinned) hide(); } },
    ...(dialog ? { "aria-haspopup": "dialog" as const, "aria-expanded": open, "aria-controls": open ? id : undefined } : { "aria-describedby": open ? id : undefined }),
    "data-hovercard": "",
  };
  const cardProps: HoverCardBindings["cardProps"] = {
    ref: (node: HTMLDivElement | null) => { cardRef.current = node; },
    "data-native-overlay": "true",
    onPointerEnter: clear,
    onPointerLeave: scheduleHide,
    // Escape returns focus to the trigger; keep its dismissal through that internal focus move.
    onBlur: (event) => { if (!(event.relatedTarget instanceof Node && (event.currentTarget.contains(event.relatedTarget) || triggerRef.current?.contains(event.relatedTarget)))) { dismissed.current = false; if (!pinned) hide(); } },
    ...(dialog ? { role: "dialog", "aria-label": label, id } : { role: "tooltip", id }),
  };
  const bridge = { style: gapBox, onPointerEnter: clear, onPointerLeave: (event: ReactPointerEvent) => { if (!(event.relatedTarget instanceof Node && cardRef.current?.contains(event.relatedTarget)) && !(event.relatedTarget instanceof Node && triggerRef.current?.contains(event.relatedTarget))) scheduleHide(); }, "aria-hidden": true as const };
  return { triggerProps, cardProps, style: position, bridge, open, close };
}

/** Puts a card in document.body (`on`), or leaves it where it is (a preview drawn in place). */
export const inPortal = (on: boolean, node: ReactNode) => (on ? createPortal(node, document.body) : node);

const mergeRefs = <T,>(...refs: (Ref<T> | undefined)[]): RefCallback<T> => (node) => {
  for (const r of refs) {
    if (typeof r === "function") r(node);
    else if (r) (r as { current: T | null }).current = node;
  }
};

type TriggerElement = ReactElement<HTMLAttributes<HTMLElement> & { ref?: Ref<HTMLElement> }>;

/**
 * An icon's card: its name, a line on what it is, and a shortcut or count where one exists, in the agent card's frame.
 * It wraps its trigger (one element: a button, a span) without adding a box, so a rail or a strip keeps its layout.
 * A label holds nothing to click, so it lets the pointer through (it may lie over the next icon in a row) and needs no
 * bridge to keep it open.
 */
/** `closeDelay` 0 swaps cards at once when the pointer moves on (the rail: t-0501, "more reactive"). */
export function HoverCard({ title, line, meta, children, delay = 250, closeDelay, testId = "hovercard" }: { title: ReactNode; line?: ReactNode; meta?: ReactNode; children: TriggerElement; delay?: number; closeDelay?: number; testId?: string }) {
  const hover = useHoverCard<HTMLElement>(delay, { dialog: false, closeDelay });
  const own = children.props;
  const { ref: triggerRef, onPointerEnter, onPointerLeave, onFocus, onBlur, ...rest } = hover.triggerProps;
  const trigger = cloneElement(children, {
    ...rest,
    ref: mergeRefs(own.ref, triggerRef),
    onPointerEnter: (e: ReactPointerEvent<HTMLElement>) => (own.onPointerEnter?.(e), onPointerEnter?.(e)),
    onPointerLeave: (e: ReactPointerEvent<HTMLElement>) => (own.onPointerLeave?.(e), onPointerLeave?.(e)),
    onFocus: (e: ReactFocusEvent<HTMLElement>) => (own.onFocus?.(e), onFocus?.(e)),
    onBlur: (e: ReactFocusEvent<HTMLElement>) => (own.onBlur?.(e), onBlur?.(e)),
  });
  return (
    <>
      {trigger}
      {hover.open && createPortal(
        <div className="siso-hovercard is-info" data-testid={testId} style={hover.style} {...hover.cardProps}>
          <div className="siso-hovercard__head">
            <strong>{title}</strong>
            {meta != null && meta !== false && <span className="siso-hovercard__meta">{meta}</span>}
          </div>
          {line && <p className="siso-hovercard__line">{line}</p>}
        </div>,
        document.body,
      )}
    </>
  );
}

// uihub: arc:hover-card — extends the existing shell engine and materials.
export type PeekContent = ReactNode | ((controls: { close: () => void; pinned: boolean }) => ReactNode);
/** A glance on hover; a click keeps it open. Controlled `open` means pinned, so callers retain their existing API.
 * `hoverOpens={false}` makes it click/Enter only, for panels that should never appear unasked (t-0556). */
export function Peek({ title, children, content, open: controlled, onOpenChange, testId = 'peek', className = '', delay = 60, hoverOpens = true }: {
  title: ReactNode; children: TriggerElement; content: PeekContent; open?: boolean; onOpenChange?: (open: boolean) => void; testId?: string; className?: string; delay?: number; hoverOpens?: boolean;
}) {
  const [localPinned, setLocalPinned] = useState(false);
  const pinned = controlled ?? localPinned;
  const setPinned = (next: boolean) => { setLocalPinned(next); onOpenChange?.(next); };
  const hover = useHoverCard(delay, { pinned, onDismiss: () => setPinned(false), label: typeof title === 'string' ? title : 'Details' });
  const panel = useRef<HTMLDivElement | null>(null);
  const { ref, onPointerEnter, onPointerLeave, onFocus, onBlur, ...rest } = hover.triggerProps;
  const own = children.props;
  useEffect(() => { if (pinned && hover.style.visibility === "visible") panel.current?.focus(); }, [pinned, hover.style.visibility]);
  const trigger = cloneElement(children, {
    ...rest,
    ref: mergeRefs(own.ref, ref),
    onPointerEnter: (e: ReactPointerEvent<HTMLElement>) => { own.onPointerEnter?.(e); if (hoverOpens) onPointerEnter?.(e); },
    onPointerLeave: (e: ReactPointerEvent<HTMLElement>) => { own.onPointerLeave?.(e); if (hoverOpens) onPointerLeave?.(e); },
    onFocus: (e: ReactFocusEvent<HTMLElement>) => { own.onFocus?.(e); if (hoverOpens) onFocus?.(e); },
    onBlur: (e: ReactFocusEvent<HTMLElement>) => { own.onBlur?.(e); onBlur?.(e); },
    onClick: (e) => { own.onClick?.(e); if (!e.defaultPrevented) { if (pinned) hover.close(); else setPinned(true); } },
    onKeyDown: (e) => { own.onKeyDown?.(e); if (e.key === 'ArrowDown' || (e.key === 'Tab' && !e.shiftKey && hover.open)) { e.preventDefault(); setPinned(true); panel.current?.focus(); } },
  });
  return <>{trigger}{hover.open && createPortal(<>
    <div {...hover.bridge} />
    {/* data-esc-own: Escape closes this card, not the panel behind it (AgentPanel/App listen in capture). */}
    <div {...hover.cardProps} ref={mergeRefs(hover.cardProps.ref, panel)} tabIndex={-1} className={`siso-hovercard siso-peek ${className}`} style={hover.style} data-testid={testId} data-pinned={pinned} data-native-overlay="true" data-esc-own="">
      <header className="siso-peek__head"><strong>{title}</strong><span>{pinned ? 'Kept open' : 'Peek'}</span><button type="button" onClick={hover.close} aria-label={`Close ${typeof title === 'string' ? title : 'peek'}`}>×</button></header>
      {typeof content === 'function' ? content({ close: hover.close, pinned }) : content}
    </div>
  </>, document.body)}</>;
}
