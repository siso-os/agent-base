/**
 * SpacesRail: the SISO OS rail's spaces accordion (spec siso-os.md §5). It only arranges the buttons it is given:
 * the open space's head, its modules, a divider in its colour, then the other spaces collapsed.
 * When the open space changes, every space slot slides from where it was (FLIP, 220ms), the modules open by grid rows
 * 0fr→1fr (180ms) and fade in 25ms apart, and the divider draws in (300ms). Instant under reduced motion.
 */
import { Children, isValidElement, useLayoutEffect, useRef, type CSSProperties, type JSX, type ReactNode } from "react";

export type RailSpaceSlot = { id: string; colour: string; button: ReactNode };

const EASE = "cubic-bezier(0.2,0.8,0.2,1)";

/**
 * With `mods` (each space's module buttons by space id), every space is open at once: its head, its modules, a divider
 * in its colour, nothing folds (Shaan, 10 Oct: "just let me see all of them at once"). Without it, the accordion above.
 */
export function SpacesRail({ open, spaces, mods: all, children }: { open: string; spaces: RailSpaceSlot[]; mods?: Record<string, ReactNode[]>; children?: ReactNode }): JSX.Element {
  const root = useRef<HTMLDivElement>(null);
  const tops = useRef<Map<string, number>>(new Map());

  // FLIP: compare each slot's top with the one stored after the last render, slide it from there, then store the new tops.
  useLayoutEffect(() => {
    const el = root.current;
    if (!el) return;
    const slots = [...el.querySelectorAll<HTMLElement>(":scope > [data-space]")];
    const now = new Map(slots.map((s) => [s.dataset.space!, s.getBoundingClientRect().top]));
    const before = tops.current;
    tops.current = now;
    if (!before.size || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    for (const s of slots) {
      const was = before.get(s.dataset.space!);
      const dy = was === undefined ? 0 : was - now.get(s.dataset.space!)!;
      if (Math.abs(dy) > 0.5) s.animate([{ transform: `translateY(${dy}px)` }, { transform: "none" }], { duration: 220, easing: EASE });
    }
  }, [open]);

  const head = spaces.find((s) => s.id === open);
  const mods = Children.toArray(children).filter(isValidElement);
  if (all) return (
    <div ref={root} className="siso-spaces is-all" data-open={open}>
      {spaces.map((s, n) => (
        <div key={s.id} className="siso-spaces__group" data-space={s.id} data-open={s.id === open || undefined} style={{ "--space-colour": s.colour } as CSSProperties}>
          <div className="siso-spaces__head">{s.button}</div>
          {(all[s.id] ?? []).map((child, i) => <div key={isValidElement(child) && child.key != null ? child.key : i} className="siso-spaces__mod">{child}</div>)}
          {n < spaces.length - 1 && <span className="siso-spaces__divider" aria-hidden="true" />}
        </div>
      ))}
    </div>
  );

  return (
    <div ref={root} className="siso-spaces" data-open={open} style={{ "--space-colour": head?.colour ?? "currentColor" } as CSSProperties}>
      {head && <div className="siso-spaces__head" data-space={head.id}>{head.button}</div>}
      <div className="siso-spaces__body" key={`body:${open}`}>
        <div className="siso-spaces__mods">
          {mods.map((child, i) => (
            <div key={child.key ?? i} className="siso-spaces__mod" style={{ "--i": i } as CSSProperties}>{child}</div>
          ))}
        </div>
      </div>
      <span className="siso-spaces__divider" key={`divider:${open}`} aria-hidden="true" />
      {spaces.filter((s) => s.id !== open).map(({ id, button }) => (
        <div key={id} className="siso-spaces__space" data-space={id}>{button}</div>
      ))}
    </div>
  );
}
