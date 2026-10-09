/**
 * Icon tooltips (Shaan 3 Oct 03:2x: the rail's and the Rolodex's hover labels were cut off by the side nav). A button's
 * aria-label (its title when it has one) shows as a tooltip after 320 ms of hover. It was a CSS ::after under the
 * button, which any clipping parent or the side nav above it could cut. Now it is one element on <body>: under the
 * button, or above it when there is no room below, always 8 px inside the window. One delegated listener for the page.
 */
const DELAY = 320, MARGIN = 8, GAP = 6;
const SELECTOR = "button[aria-label], button[title]";

/** Start the page's tooltips; returns the stop function. Idempotent per document. */
export function installTooltips(doc: Document = document) {
  const w = doc.defaultView;
  if (!w || (doc as Document & { __sisoTips?: boolean }).__sisoTips) return () => {};
  (doc as Document & { __sisoTips?: boolean }).__sisoTips = true;
  const tip = doc.createElement("div");
  tip.className = "siso-tip";
  tip.setAttribute("role", "tooltip");
  tip.dataset.testid = "tooltip";
  tip.hidden = true;
  doc.body.appendChild(tip);
  let target: HTMLElement | null = null, timer = 0;
  const hide = () => {
    w.clearTimeout(timer);
    target = null;
    tip.hidden = true;
  };
  const place = (el: HTMLElement) => {
    const text = el.getAttribute("title") || el.getAttribute("aria-label");
    if (!text || !el.isConnected) return hide();
    tip.textContent = text;
    tip.hidden = false;
    const a = el.getBoundingClientRect(), t = tip.getBoundingClientRect(), vw = w.innerWidth, vh = w.innerHeight;
    const below = a.bottom + GAP + t.height <= vh - MARGIN || a.top - GAP - t.height < MARGIN;
    const top = below ? Math.min(a.bottom + GAP, vh - MARGIN - t.height) : a.top - GAP - t.height;
    const left = Math.min(Math.max(MARGIN, a.left + a.width / 2 - t.width / 2), vw - MARGIN - t.width);
    tip.style.transform = `translate(${Math.round(left)}px, ${Math.round(Math.max(MARGIN, top))}px)`;
    tip.dataset.side = below ? "below" : "above";
  };
  const over = (e: PointerEvent) => {
    const el = (e.target as Element | null)?.closest?.(SELECTOR) as HTMLElement | null;
    if (el === target) return;
    hide();
    // A trigger with its own HoverCard never gets a second label.
    if (!el || el.matches(":disabled") || el.closest("[data-no-tip], [data-hovercard]")) return;
    target = el;
    timer = w.setTimeout(() => target === el && place(el), DELAY);
  };
  const out = (e: PointerEvent) => {
    if (target && !target.contains(e.relatedTarget as Node | null)) hide();
  };
  doc.addEventListener("pointerover", over, true);
  doc.addEventListener("pointerout", out, true);
  for (const t of ["pointerdown", "keydown", "wheel"] as const) doc.addEventListener(t, hide, true);
  w.addEventListener("blur", hide);
  return () => {
    hide();
    doc.removeEventListener("pointerover", over, true);
    doc.removeEventListener("pointerout", out, true);
    for (const t of ["pointerdown", "keydown", "wheel"] as const) doc.removeEventListener(t, hide, true);
    w.removeEventListener("blur", hide);
    tip.remove();
    (doc as Document & { __sisoTips?: boolean }).__sisoTips = false;
  };
}
