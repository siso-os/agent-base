export type ContextSegment = { label: string; value: number; color: string };
/** Source proportions are estimates inside the observed used ring; unused capacity stays unfilled. */
export function contextGradient(used: number | null, segments?: ContextSegment[]): string | undefined {
  if (used === null || !Number.isFinite(used)) return undefined;
  const valid = segments?.filter(s => Number.isFinite(s.value) && s.value > 0) ?? [];
  const total = valid.reduce((sum,s) => sum+s.value, 0);
  if (!total) return undefined;
  let at = 0;
  const stops = valid.map(s => { const start=at; at += s.value / total * Math.min(100,Math.max(0,used)); return `${s.color} ${start}% ${at}%`; });
  return `conic-gradient(${stops.join(',')},rgb(255 255 255 / .1) ${at}% 100%)`;
}
