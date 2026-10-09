import "./Flight.css";
import "../../../../packages/halo-face";

/**
 * Spawn and return flights (SPEC-DELIGHT §3; Shaan 2 Oct 20:45: "it could be sent off like we have agent emojis ... So
 * it's not just like a box"): a twin of a sub-agent's face flies on an arc between its fan-out line and the HUD's faces
 * pill. One fixed overlay, two WAAPI transforms (X on the outer box, Y and scale on the inner, so the path arcs), then the
 * twin is gone. The faces stay still (the engine's rule for faces under 64 px). Reduced motion: no flight; the promise
 * resolves at once and the caller changes state in place.
 */
type Ctl = { status(s: string): Ctl; destroy(): void };
type HaloFaceGlobal = { agent(host: HTMLElement, o: object): Ctl };

export const reducedMotion = () => document.documentElement.classList.contains("rm") || matchMedia("(prefers-reduced-motion: reduce)").matches;

export function onScreen(el: Element | null): boolean {
  if (!el || !el.isConnected || document.visibilityState === "hidden") return false;
  const style = getComputedStyle(el), r = el.getBoundingClientRect();
  if (style.visibility === 'hidden' || style.display === 'none' || !r.width || !r.height || r.bottom <= 0 || r.right <= 0 || r.top >= innerHeight || r.left >= innerWidth) return false;
  for (let parent = el.parentElement; parent; parent = parent.parentElement) {
    const css = getComputedStyle(parent);
    if (css.visibility === 'hidden' || css.display === 'none') return false;
    if (/(auto|scroll|hidden|clip)/.test(css.overflow + css.overflowY + css.overflowX)) {
      const box = parent.getBoundingClientRect();
      if (r.bottom <= box.top || r.top >= box.bottom || r.right <= box.left || r.left >= box.right) return false;
    }
  }
  return true;
}
const centre = (r: DOMRect) => [r.left + r.width / 2, r.top + r.height / 2, r.width] as const;

export function fly(from: Element | DOMRect, to: Element | DOMRect, o: { name: string; status: string; size?: number; arc?: number; glow?: string; ms?: number; signal?: AbortSignal; outcome?: "Done" | "Blocked" }): Promise<void> {
  if (reducedMotion() || document.visibilityState === "hidden" || o.signal?.aborted || (from instanceof Element && !onScreen(from)) || (to instanceof Element && !onScreen(to))) return Promise.resolve();
  const a = from instanceof Element ? from.getBoundingClientRect() : from, b = to instanceof Element ? to.getBoundingClientRect() : to;
  const [x0, y0] = centre(a), [x1, y1, w1] = centre(b), size = o.size ?? 22, h = size / 2;
  const outer = document.createElement("div"), inner = document.createElement("div"), host = document.createElement("span");
  outer.className = "ab-flight";
  outer.dataset.testid = "flight";
  outer.style.transform = `translate(${x0 - h}px,${y0 - h}px)`;
  if (o.glow) inner.style.setProperty("--glow", o.glow);
  inner.appendChild(host);
  if (o.outcome) { const chip = document.createElement('span'); chip.className = 'ab-flight__outcome'; chip.textContent = o.outcome; inner.appendChild(chip); }
  outer.appendChild(inner);
  document.body.appendChild(outer);
  const face = (window as unknown as { HaloFace: HaloFaceGlobal }).HaloFace.agent(host, { name: o.name, project: o.name, status: o.status, size });
  const ms = o.ms ?? 720, arc = o.arc ?? -70, end = Math.max(0.5, Math.min(1.2, (w1 || size) / size));
  const travel = outer.animate([{ transform: `translate(${x0 - h}px,${y0 - h}px)` }, { transform: `translate(${x1 - h}px,${y0 - h}px)` }], { duration: ms, easing: "cubic-bezier(.45,0,.35,1)", fill: "forwards" });
  const lift = inner.animate(
    [{ transform: "translateY(0) scale(1)" }, { transform: `translateY(${arc + Math.min(0, y1 - y0) * 0.5}px) scale(1.3)`, offset: 0.45 }, { transform: `translateY(${y1 - y0}px) scale(${end})` }],
    { duration: ms, easing: "ease-in-out", fill: "forwards" },
  );
  let cleaned = false;
  const cancel = () => { travel.cancel(); lift.cancel(); };
  const scrolled = () => { if ((from instanceof Element && !onScreen(from)) || (to instanceof Element && !onScreen(to))) cancel(); };
  document.addEventListener('scroll', scrolled, true);
  const hidden = () => { if (document.visibilityState === 'hidden') cancel(); };
  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  const stopMotion = () => { if (motion.matches) cancel(); };
  o.signal?.addEventListener('abort', cancel, {once:true});
  document.addEventListener('visibilitychange', hidden);
  motion.addEventListener('change', stopMotion);
  const done = () => { if (cleaned) return; cleaned = true; face.destroy(); outer.remove(); o.signal?.removeEventListener('abort', cancel); document.removeEventListener('visibilitychange', hidden); document.removeEventListener('scroll', scrolled, true); motion.removeEventListener('change', stopMotion); };
  return lift.finished.then(done, done);
}

/** A one-shot pop (scale spring) or shake on an element; nothing under reduced motion. */
export const pop = (el: Element | null | undefined, k = 1.4) => void (!reducedMotion() && onScreen(el ?? null) && el?.animate([{ transform: "scale(1)" }, { transform: `scale(${k})` }, { transform: "scale(1)" }], { duration: 380, easing: "cubic-bezier(.2,.9,.3,1.3)" }));
export const shake = (el: Element | null | undefined) => void (!reducedMotion() && onScreen(el ?? null) && el?.animate([0, -4, 4, -3, 3, 0].map((x) => ({ transform: `translateX(${x}px)` })), { duration: 420 }));

/**
 * What a fan-out line tells its chat's faces pill (an event on the pill's own element, so another chat's pill never
 * hears it): a sub-agent left (`out`, it is on its way), arrived (`in`), finished (`ok` / `bad`), or flew home (`home`).
 */
export type FlightNote = { id: string; name: string; at: "out" | "in" | "ok" | "bad" | "home" };
export const FLIGHT_EVENT = "siso-flight";
export const tellPill = (pill: Element, note: FlightNote) => pill.dispatchEvent(new CustomEvent<FlightNote>(FLIGHT_EVENT, { detail: note }));
/** The faces pill of the chat this element sits in. */
export const pillOf = (el: Element | null) => el?.closest("[data-testid=chat-view]")?.querySelector<HTMLElement>("[data-testid=faces-pill]") ?? null;
