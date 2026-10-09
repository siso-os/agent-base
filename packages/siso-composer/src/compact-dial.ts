/** Pointer movement snaps to five; keyboard arrows retain one-percent precision. */
export function compactDialValue(value: number, step = 1): number {
  return Math.max(10, Math.min(90, Math.round((Number.isFinite(value) ? value : 35) / step) * step));
}
