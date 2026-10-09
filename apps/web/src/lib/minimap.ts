/**
 * The chat's minimap scrollbar: one bar per turn down the right edge, bigger near where you are; click one to go there
 * (Shaan, 2 Oct 13:16: "Codex has a really nice scroll bar … bars and they scale based on where you are … you click
 * the other bars and go to it … fluid").
 *
 * The geometry is T3 Code's (MIT, Copyright (c) 2025 T3 Tools Inc.):
 * `_reference/t3code/apps/web/src/components/chat/MessagesTimeline.logic.ts`, resolveTimelineMinimap{HeightStyle,
 * TopPercent,IndexFromPointer,CurrentIndex}; the scaling by distance is ours.
 */
const SPACING = 14; // px between bars before the rail hits its cap
const MAX_HEIGHT = "62%";

export function minimapHeight(count: number): string {
  return `min(${Math.max(1, (count - 1) * SPACING)}px, ${MAX_HEIGHT})`;
}

export function minimapTop(index: number, count: number): number {
  if (count <= 1) return 0;
  return (Math.max(0, Math.min(index, count - 1)) / (count - 1)) * 100;
}

export function minimapIndexFromPointer(count: number, railTop: number, railHeight: number, pointerY: number): number | null {
  if (count <= 0 || railHeight <= 0) return null;
  if (count === 1) return 0;
  const progress = Math.max(0, Math.min(1, (pointerY - railTop) / railHeight));
  return Math.round(progress * (count - 1));
}

/** The turn at the reader's position: the first one in view, else the last one above. */
export function minimapCurrent(scrollTop: number, scrollBottom: number, bounds: Iterable<{ top: number; height: number }>): number | null {
  let before: number | null = null;
  let i = 0;
  for (const b of bounds) {
    if (b.top < scrollBottom && b.top + Math.max(1, b.height) > scrollTop) return i;
    if (b.top <= scrollTop) before = i;
    i++;
  }
  return before;
}

/** A bar's width by its distance from the current turn (and from the pointer while hovering). */
export function minimapWidth(distance: number): number {
  return distance === 0 ? 18 : distance === 1 ? 12 : distance === 2 ? 9 : 6;
}

/**
 * The bars on screen for a long chat (2 Oct 14:13: "on super long chats, that bar on the side is really weird"): at
 * most 31, the 15 marks before and after the one he is on, which keeps the middle slot (the history slides past it).
 * Returns each shown mark's slot (0..30) and how faded it is toward the ends.
 */
export const WINDOW = 15;
export function minimapWindow(marks: number, current: number): { mark: number; slot: number; fade: number }[] {
  const out: { mark: number; slot: number; fade: number }[] = [];
  for (let m = Math.max(0, current - WINDOW); m <= Math.min(marks - 1, current + WINDOW); m++) {
    const d = Math.abs(m - current) / (WINDOW + 1);
    out.push({ mark: m, slot: m - current + WINDOW, fade: Math.max(0.15, 1 - d ** 1.6) });
  }
  return out;
}
