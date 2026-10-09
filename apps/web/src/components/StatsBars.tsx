/** Horizontal bars for a count table (tools, skills), biggest first. */
export function Bars({ rows, max = 10 }: { rows: [string, number][]; max?: number }) {
  const top = rows.sort((a, b) => b[1] - a[1]).slice(0, max);
  const peak = top[0]?.[1] ?? 1;
  return (
    <div className="flex flex-col gap-1.5">
      {top.map(([k, v]) => (
        <div key={k} className="grid grid-cols-[120px_1fr_44px] items-center gap-2 text-[12px]">
          <span className="truncate text-muted-foreground" title={k}>{k}</span>
          <span className="h-[7px] rounded-full bg-white/5">
            <span className="block h-full rounded-full bg-[rgb(255_167_38/0.7)]" style={{ width: `${Math.max(3, (100 * v) / peak)}%` }} />
          </span>
          <span className="text-right tabular-nums text-foreground">{v}</span>
        </div>
      ))}
    </div>
  );
}
