import hub from "../../../../ui-hub/components.json";

const names = new Map(hub.components.map(c => [c.id, c.name]));
export type FeedbackTarget = { element: HTMLElement; comp: string; part: string; label: string; rect: { left: number; top: number; width: number; height: number } };

/** Prefer a testid anywhere within this component, then an aria label, then its root. */
export function feedbackTarget(element: Element | null): FeedbackTarget | null {
  const root = element?.closest<HTMLElement>("[data-ab-comp]");
  const comp = root?.dataset.abComp;
  if (!root || !comp || !names.has(comp) || comp === "_hub") return null;
  const ancestor = (attribute: string) => {
    for (let node = element; node; node = node.parentElement) {
      if (node.hasAttribute(attribute)) return node as HTMLElement;
      if (node === root) break;
    }
    return null;
  };
  const target = ancestor("data-testid") ?? ancestor("aria-label") ?? root;
  const part = target.getAttribute("data-testid") || target.getAttribute("aria-label") || comp;
  const r = target.getBoundingClientRect();
  if (!r.width || !r.height) return null;
  return { element: target, comp, part, label: `${names.get(comp)} › ${part.replace(/-/g, " ")}`, rect: { left: r.left, top: r.top, width: r.width, height: r.height } };
}

/** Best effort: render the app without feedback chrome and crop its viewport, preserving 24px of context. */
export async function feedbackCrop(target: FeedbackTarget): Promise<string | undefined> {
  try {
    if (target.element.matches("iframe, webview") || target.element.querySelector("iframe, webview")) return undefined;
    const { domToPng } = await import("modern-screenshot");
    const png = await domToPng(document.body, { scale: 1, width: innerWidth, height: innerHeight, filter: node => !(node instanceof Element && node.hasAttribute("data-ab-feedback")) });
    const image = new Image(); image.src = png; await image.decode();
    const r = target.rect, left = Math.max(0, r.left - 24), top = Math.max(0, r.top - 24);
    const width = Math.min(innerWidth - left, r.width + 24 + Math.min(r.left, 24));
    const height = Math.min(innerHeight - top, r.height + 24 + Math.min(r.top, 24));
    if (width <= 0 || height <= 0) return undefined;
    const canvas = document.createElement("canvas"); canvas.width = Math.ceil(width); canvas.height = Math.ceil(height);
    const ctx = canvas.getContext("2d"); if (!ctx) return undefined;
    ctx.drawImage(image, left, top, width, height, 0, 0, width, height);
    const crop = canvas.toDataURL("image/png");
    return crop.length < 2 * 1024 * 1024 - 20_000 ? crop : undefined;
  } catch { return undefined; }
}
