/**
 * Voice charts, lifted from SISO Internal's VoiceCharts and ActivityHeatmap and drawn in the SISO tokens: one hue (the
 * `working` sky, --color-working), thin marks with rounded ends on the baseline, a quiet baseline, direct labels only
 * for the peak or the hovered mark, no legend (the title names the series).
 */
import { cn } from "@siso/shell";
import { useMemo, useState, type ReactNode } from "react";
import { dayKey } from "./format";

const HUE = "var(--color-working)";
const LINE = "var(--crm-color-line)";

export function ChartShell({ title, sub, children, className }: { title: string; sub?: string; children: ReactNode; className?: string }) {
  return (
    <figure className={cn("m-0 flex min-w-0 flex-1 flex-col gap-2 rounded-[var(--crm-radius-card)] border border-border bg-raised p-4", className)}>
      <figcaption className="flex items-baseline gap-2">
        <span className="text-[12.5px] font-semibold text-foreground">{title}</span>
        {sub && <span className="font-mono text-3xs uppercase tracking-[0.14em] text-muted-foreground">{sub}</span>}
      </figcaption>
      {children}
    </figure>
  );
}

/** Words per day over the last `days`, as an area line. */
export function WordsTrendChart({ words, days = 30 }: { words: Record<string, number>; days?: number }) {
  const series = useMemo(() => {
    const out: Array<{ key: string; label: string; value: number }> = [];
    const cursor = new Date();
    cursor.setDate(cursor.getDate() - (days - 1));
    for (let i = 0; i < days; i += 1) {
      const key = dayKey(cursor);
      out.push({ key, label: cursor.toLocaleDateString("en-GB", { day: "numeric", month: "short" }), value: words[key] ?? 0 });
      cursor.setDate(cursor.getDate() + 1);
    }
    return out;
  }, [words, days]);

  const [hover, setHover] = useState<number | null>(null);
  const W = 560;
  const H = 120;
  const PAD = 4;
  const max = Math.max(1, ...series.map((d) => d.value));
  const x = (i: number) => PAD + (i / (series.length - 1)) * (W - PAD * 2);
  const y = (v: number) => H - PAD - (v / max) * (H - PAD * 2 - 14);
  const line = series.map((d, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(d.value).toFixed(1)}`).join(" ");
  const area = `${line} L${x(series.length - 1).toFixed(1)},${H - PAD} L${x(0).toFixed(1)},${H - PAD} Z`;
  const maxIdx = series.reduce((best, d, i) => (d.value > series[best].value ? i : best), 0);
  const shown = hover ?? maxIdx;

  return (
    <ChartShell title="Words per day" sub={`last ${days} days`}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full"
        role="img"
        aria-label={`Words dictated per day over the last ${days} days; peak ${series[maxIdx].value.toLocaleString()} on ${series[maxIdx].label}`}
        onMouseLeave={() => setHover(null)}
      >
        <defs>
          <linearGradient id="siso-voice-words-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={HUE} stopOpacity="0.28" />
            <stop offset="100%" stopColor={HUE} stopOpacity="0.02" />
          </linearGradient>
        </defs>
        <line x1={PAD} x2={W - PAD} y1={H - PAD} y2={H - PAD} stroke={LINE} strokeWidth="1" />
        <path d={area} fill="url(#siso-voice-words-fill)" />
        <path d={line} fill="none" stroke={HUE} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        {series.map((d, i) => (
          <rect key={d.key} x={x(i) - W / series.length / 2} y={0} width={W / series.length} height={H} fill="transparent" onMouseEnter={() => setHover(i)} />
        ))}
        <g pointerEvents="none">
          <line x1={x(shown)} x2={x(shown)} y1={y(series[shown].value)} y2={H - PAD} stroke="var(--crm-color-line-strong)" strokeWidth="1" />
          <circle cx={x(shown)} cy={y(series[shown].value)} r="4" fill={HUE} stroke="var(--crm-color-surface-raised)" strokeWidth="2" />
          <text
            x={Math.min(Math.max(x(shown), 46), W - 46)}
            y={Math.max(y(series[shown].value) - 8, 10)}
            textAnchor="middle"
            style={{ font: "600 11px var(--font-mono)", fill: "var(--crm-color-text)" }}
          >
            {series[shown].value.toLocaleString()} · {series[shown].label}
          </text>
        </g>
      </svg>
    </ChartShell>
  );
}

/** Dictations by app, as horizontal bars. */
export function AppBreakdownChart({ apps }: { apps: Array<{ app: string; entries: number; words: number }> }) {
  const max = Math.max(1, ...apps.map((a) => a.entries));
  return (
    <ChartShell title="Where you dictate" sub="dictations by app">
      <div className="flex flex-col gap-1.5" role="img" aria-label={`Dictations by app; top ${apps[0]?.app ?? "none"}`}>
        {apps.length === 0 && <span className="text-[12px] text-muted-foreground">No apps yet.</span>}
        {apps.slice(0, 6).map((a) => (
          <div key={a.app} className="group flex items-center gap-2" title={`${a.app}: ${a.entries.toLocaleString()} dictations · ${a.words.toLocaleString()} words`}>
            <span className="w-[120px] flex-none truncate text-right text-[11.5px] text-secondary-label">{a.app}</span>
            <div className="relative h-[14px] flex-1">
              <div
                className="absolute inset-y-0 left-0 rounded-r-[4px] opacity-75 transition-opacity group-hover:opacity-95"
                style={{ width: `${Math.max((a.entries / max) * 100, 1.5)}%`, background: HUE }}
              />
            </div>
            <span className="w-[52px] flex-none font-mono text-[10.5px] tabular-nums text-muted-foreground">{a.entries.toLocaleString()}</span>
          </div>
        ))}
      </div>
    </ChartShell>
  );
}

/** Dictations by hour of day, all time, as columns. */
export function HourRhythmChart({ hours }: { hours: number[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1, ...hours);
  const peak = hours.indexOf(Math.max(...hours));
  const shown = hover ?? Math.max(peak, 0);
  return (
    <ChartShell title="When you speak" sub="dictations by hour, all time">
      <div className="flex h-[96px] items-end gap-[2px]" role="img" aria-label={`Dictations by hour of day; peak at ${peak}:00`} onMouseLeave={() => setHover(null)}>
        {hours.map((v, h) => (
          <div key={h} className="relative flex h-full flex-1 cursor-default items-end" onMouseEnter={() => setHover(h)}>
            <div
              className="w-full rounded-t-[4px]"
              style={{ height: `${Math.max((v / max) * 88, v > 0 ? 3 : 1)}%`, background: HUE, opacity: h === shown ? 1 : 0.5 }}
            />
          </div>
        ))}
      </div>
      {/* The hours sit under their own columns (9 Oct: one bunched "00 · 06 · 12 · 18 · 23" label read as nothing). */}
      <div className="flex gap-[2px] font-mono text-[9.5px] tabular-nums text-muted-foreground" aria-hidden="true">
        {hours.map((_, h) => <span key={h} className="flex-1 overflow-visible whitespace-nowrap text-center">{h % 6 === 0 ? String(h).padStart(2, "0") : ""}</span>)}
      </div>
      <div className="flex items-baseline justify-end">
        <span className="font-mono text-[10.5px] tabular-nums text-secondary-label">
          {String(shown).padStart(2, "0")}:00 · {(hours[shown] ?? 0).toLocaleString()} dictations
        </span>
      </div>
    </ChartShell>
  );
}

type Range = "month" | "quarter" | "year";
const RANGE: Record<Range, { label: string; days: number }> = { month: { label: "Month", days: 30 }, quarter: { label: "Quarter", days: 91 }, year: { label: "All", days: 365 } };
const FILL = [0, 0.25, 0.45, 0.7, 1];

function level(value: number, target: number) {
  if (value <= 0) return 0;
  const pct = value / target;
  return pct >= 1 ? 4 : pct >= 0.66 ? 3 : pct >= 0.33 ? 2 : 1;
}

/** A contribution wall: one 12px cell per day, weeks left to right, deeper sky for more dictations. */
export function ActivityWall({ days, target = 10, title = "Dictation activity", unit = "dictations" }: { days: Record<string, number>; target?: number; title?: string; unit?: string }) {
  const [range, setRange] = useState<Range>("quarter");
  const today = useMemo(() => new Date(), []);
  const { weeks, logged } = useMemo(() => {
    const start = new Date(today.getFullYear(), today.getMonth(), today.getDate() - (RANGE[range].days - 1));
    start.setDate(start.getDate() - start.getDay());
    const end = new Date(today.getFullYear(), today.getMonth(), today.getDate() + (6 - today.getDay()));
    const cols: Date[][] = [];
    let n = 0;
    for (const d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      if (d.getDay() === 0) cols.push([]);
      cols[cols.length - 1].push(new Date(d));
      if (d <= today && (days[dayKey(d)] ?? 0) > 0) n += 1;
    }
    return { weeks: cols, logged: n };
  }, [today, range, days]);
  const todayKey = dayKey(today);

  return (
    <section className="flex flex-col rounded-[var(--crm-radius-card)] border border-border bg-raised p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[12px] font-semibold uppercase tracking-[0.16em] text-foreground">{title}</div>
          <div className="mt-1 text-[12px] text-muted-foreground">
            {logged} days spoken · last {RANGE[range].days}d
          </div>
        </div>
        <div className="flex flex-none rounded-lg border border-border bg-page p-0.5" role="tablist" aria-label="Range">
          {(Object.keys(RANGE) as Range[]).map((r) => (
            <button
              key={r}
              type="button"
              role="tab"
              aria-selected={r === range}
              onClick={() => setRange(r)}
              className={cn("rounded-md px-2.5 py-1 text-[11px] font-semibold transition-colors", r === range ? "bg-working/20 text-working" : "text-muted-foreground hover:text-foreground")}
            >
              {RANGE[r].label}
            </button>
          ))}
        </div>
      </div>
      <div className="flex justify-center gap-[3px] overflow-x-auto pb-1">
        {weeks.map((week, wi) => (
          <div key={wi} className="flex flex-col gap-[3px]">
            {week.map((d) => {
              const key = dayKey(d);
              const future = d > today && key !== todayKey;
              const v = days[key] ?? 0;
              const l = future ? 0 : level(v, target);
              const readout = `${d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })}: ${v > 0 ? `${v} ${unit}` : "none"}`;
              return (
                <div
                  key={key}
                  className={cn("h-3 w-3 rounded-[2px]", future ? "bg-transparent" : l === 0 && "border border-border bg-foreground/[0.04]", key === todayKey && "ring-1 ring-foreground/60")}
                  style={l > 0 ? { background: HUE, opacity: FILL[l] } : undefined}
                  title={future ? undefined : readout}
                  aria-label={future ? undefined : readout}
                />
              );
            })}
          </div>
        ))}
      </div>
      <div className="mt-3 flex items-center justify-end gap-1.5 text-3xs text-muted-foreground">
        <span>Less</span>
        {[0, 1, 2, 3, 4].map((l) => (
          <span key={l} className={cn("h-3 w-3 rounded-[3px]", l === 0 && "border border-border bg-foreground/[0.04]")} style={l > 0 ? { background: HUE, opacity: FILL[l] } : undefined} aria-hidden />
        ))}
        <span>More</span>
      </div>
    </section>
  );
}
