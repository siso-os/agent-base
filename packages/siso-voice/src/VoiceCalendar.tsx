/**
 * A month of dictation days for a side nav: Monday-first grid, each day tinted by how many dictations it has
 * (four steps of the `working` sky, scaled to the busiest day of the month), today ringed, the selected day filled.
 * ‹ › move between the months that have dictations. Days with none are quiet and cannot be picked.
 */
import { cn } from "@siso/shell";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useMemo, useState } from "react";
import { dayKey, formatGrouped, parseDay } from "./format";

const WEEKDAYS = ["M", "T", "W", "T", "F", "S", "S"];
const STEP = [0, 16, 30, 50, 78];
const tint = (pct: number) => `color-mix(in srgb, var(--color-working) ${pct}%, transparent)`;

const monthKey = (d: Date) => d.getFullYear() * 12 + d.getMonth();
const fromMonthKey = (k: number) => new Date(Math.floor(k / 12), k % 12, 1);

export function VoiceCalendar({ days, selected, onSelect, className }: { days: Record<string, number>; selected?: string; onSelect: (day: string) => void; className?: string }) {
  const keys = useMemo(() => Object.keys(days).filter((k) => days[k] > 0).sort(), [days]);
  const today = dayKey(new Date());
  const first = keys.length ? monthKey(parseDay(keys[0])) : monthKey(new Date());
  const last = Math.max(keys.length ? monthKey(parseDay(keys[keys.length - 1])) : first, monthKey(new Date()));
  const [shown, setShown] = useState(() => (selected && /^\d{4}-\d{2}-\d{2}$/.test(selected) ? monthKey(parseDay(selected)) : last));

  // Follow the selection when it moves to another month from outside (a link, the keyboard).
  const selMonth = selected && /^\d{4}-\d{2}-\d{2}$/.test(selected) ? monthKey(parseDay(selected)) : null;
  const [lastSel, setLastSel] = useState(selMonth);
  if (selMonth !== lastSel) {
    setLastSel(selMonth);
    if (selMonth !== null) setShown(selMonth);
  }

  const month = fromMonthKey(shown);
  const { cells, max, total, active } = useMemo(() => {
    const start = new Date(month);
    start.setDate(1 - ((start.getDay() + 6) % 7));
    const out: Array<{ key: string; day: number; inMonth: boolean; n: number }> = [];
    let mx = 0;
    let sum = 0;
    let act = 0;
    for (let i = 0; i < 42; i += 1) {
      const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
      const key = dayKey(d);
      const inMonth = d.getMonth() === month.getMonth();
      const n = days[key] ?? 0;
      if (inMonth) {
        mx = Math.max(mx, n);
        sum += n;
        if (n > 0) act += 1;
      }
      out.push({ key, day: d.getDate(), inMonth, n });
    }
    // Drop a trailing week that is wholly next month.
    const rows = out.slice(35).every((c) => !c.inMonth) ? out.slice(0, 35) : out;
    return { cells: rows, max: mx, total: sum, active: act };
  }, [month, days]);

  const step = (n: number) => (n <= 0 || max <= 0 ? 0 : Math.min(4, Math.ceil((n / max) * 4)));
  const label = month.toLocaleDateString("en-GB", { month: "long", year: "numeric" });

  return (
    <div className={cn("px-1.5 pb-1", className)} data-voice="calendar">
      <div className="mb-1.5 flex items-center gap-1">
        <span className="min-w-0 flex-1 truncate pl-1 text-[12.5px] font-medium text-foreground">{label}</span>
        <button type="button" aria-label="Previous month" disabled={shown <= first} onClick={() => setShown(shown - 1)} className="grid h-6 w-6 place-items-center rounded-[7px] text-muted-foreground transition-colors hover:bg-sidebar-row-hover hover:text-foreground disabled:opacity-25">
          <ChevronLeft className="h-3.5 w-3.5" aria-hidden />
        </button>
        <button type="button" aria-label="Next month" disabled={shown >= last} onClick={() => setShown(shown + 1)} className="grid h-6 w-6 place-items-center rounded-[7px] text-muted-foreground transition-colors hover:bg-sidebar-row-hover hover:text-foreground disabled:opacity-25">
          <ChevronRight className="h-3.5 w-3.5" aria-hidden />
        </button>
      </div>
      <div className="grid grid-cols-7 gap-[3px]" role="grid" aria-label={`${label}: dictations per day`}>
        {WEEKDAYS.map((w, i) => (
          <span key={i} className="pb-0.5 text-center text-[9.5px] font-medium uppercase tracking-[0.08em] text-muted-foreground/70" aria-hidden>
            {w}
          </span>
        ))}
        {cells.map((c) => {
          const s = step(c.n);
          const isSel = c.key === selected;
          const isToday = c.key === today;
          const can = c.inMonth && c.n > 0;
          return (
            <button
              key={c.key}
              type="button"
              role="gridcell"
              disabled={!can}
              aria-selected={isSel}
              aria-label={can ? `${parseDay(c.key).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" })}, ${c.n} dictations` : undefined}
              title={can ? `${parseDay(c.key).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })} · ${formatGrouped(c.n)} dictations` : undefined}
              onClick={() => onSelect(c.key)}
              className={cn(
                "relative grid aspect-square min-h-[26px] place-items-center rounded-[7px] text-[11.5px] tabular-nums outline-none transition-[box-shadow,color]",
                !c.inMonth && "invisible",
                can ? "cursor-pointer text-foreground hover:shadow-[inset_0_0_0_1px_var(--crm-color-line-strong)]" : "text-muted-foreground/45",
                isSel && "!text-page font-semibold",
                isToday && !isSel && "shadow-[inset_0_0_0_1.5px_var(--color-working)]",
                "focus-visible:shadow-[inset_0_0_0_2px_var(--color-working)]",
              )}
              style={{ background: isSel ? "var(--color-working)" : s > 0 ? tint(STEP[s]) : undefined }}
            >
              {c.day}
            </button>
          );
        })}
      </div>
      <div className="mt-2 flex items-center justify-between pl-1 text-[11px] text-muted-foreground">
        <span className="tabular-nums">
          {formatGrouped(total)} dictations · {active} {active === 1 ? "day" : "days"}
        </span>
        <span className="flex items-center gap-[3px]" aria-hidden>
          {[1, 2, 3, 4].map((s) => (
            <span key={s} className="h-2 w-2 rounded-[2px]" style={{ background: tint(STEP[s]) }} />
          ))}
        </span>
      </div>
    </div>
  );
}
