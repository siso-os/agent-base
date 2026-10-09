// uihub: siso:stat-tile — LifeLock stats and compact calendar overview.
import { CalendarDaysIcon, ChevronLeftIcon, ChevronRightIcon, SparklesIcon } from "lucide-react";
import { Panel, Quiet, SectionHeader, Stat } from "./ui";
import { addDays, dateOf, dayName, hhmm, localDay, minutesOf, useRange, useXp, type Day } from "./store";
export type Period = "week" | "month" | "year";
export function periodBounds(day: string, period: Period) {
  const d = dateOf(day), y = d.getFullYear(), m = d.getMonth();
  if (period === "week") { const from = addDays(day, -((d.getDay() + 6) % 7)); return { from, to: addDays(from, 6) }; }
  return period === "month" ? { from: localDay(new Date(y, m, 1)), to: localDay(new Date(y, m + 1, 0)) } : { from: `${y}-01-01`, to: `${y}-12-31` };
}
const morningDone = (d: Day) => ["wake", "pushups", "teeth", "shower", "supplements", "meditation", "plan"].every(k => d.state.checks[k]);
function averageTime(days: Day[], key: string, bed = false) {
  const times = days.map(d => minutesOf(d.state.sets[key])).filter((t): t is number => t !== undefined).map(t => bed && t < 12 * 60 ? t + 1440 : t);
  return times.length ? hhmm(Math.round(times.reduce((a, b) => a + b, 0) / times.length) % 1440) : "—";
}
export function ReviewPage({ day, period, dep, onSelect }: { day: string; period: Period; dep: number; onSelect: (s: string) => void }) {
  const { from, to } = periodBounds(day, period), today = localDay();
  const r = useRange(from, to, dep);
  const days = [...r.map.values()].filter(d => d.day <= today);
  const calendar: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) calendar.push(d);
  const elapsed = calendar.filter(d => d <= today).length;
  const closed = days.filter(d => d.state.checks.checkout);
  const total = days.reduce((n, d) => n + d.xp.total, 0);
  const title = period === "week" ? `Week of ${dateOf(from).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}` : dateOf(from).toLocaleDateString("en-GB", period === "month" ? { month: "long", year: "numeric" } : { year: "numeric" });
  const move = (dir: number) => { const next = period === "week" ? addDays(from, dir * 7) : localDay(new Date(dateOf(from).getFullYear() + (period === "year" ? dir : 0), dateOf(from).getMonth() + (period === "month" ? dir : 0), 1)); onSelect(`${period}@${next}`); };
  return <div className="space-y-3" data-testid="life-review">
    <SectionHeader icon={CalendarDaysIcon} title={title} subtitle={`${period[0].toUpperCase() + period.slice(1)} review`} accent="sky" right={<div className="flex"><button aria-label={`Previous ${period}`} onClick={() => move(-1)} className="grid h-11 w-9 place-items-center"><ChevronLeftIcon className="h-4 w-4" /></button><button aria-label={`Next ${period}`} disabled={to >= today} onClick={() => move(1)} className="grid h-11 w-9 place-items-center disabled:opacity-25"><ChevronRightIcon className="h-4 w-4" /></button></div>} />
    {r.error && <p role="status" className="text-sm text-amber-200">{r.error} {r.data ? "Showing the last loaded history." : "History is unavailable, not empty."}</p>}
    {!r.data ? <Quiet>{r.error ? "Try again when Life is connected." : "Loading your history…"}</Quiet> : <>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4"><Stat label="XP earned" value={total.toLocaleString()} accent="sky" /><Stat label="Mornings" value={`${days.filter(morningDone).length}/${elapsed}`} /><Stat label="Checkouts" value={`${closed.length}/${elapsed}`} accent="purple" /><Stat label="Days logged" value={`${days.length}/${elapsed}`} accent="sky" /></div>
      <Panel title={period === "week" ? "A little progress, every day" : "Your days at a glance"} accent="sky">
        {period === "week" ? <div className="space-y-2">{calendar.map(key => { const d = r.map.get(key), xp = d?.xp.total ?? 0; return <button key={key} onClick={() => onSelect(`today@${key}`)} disabled={key > today} className="flex min-h-11 w-full items-center gap-3 text-left disabled:opacity-30"><span className="w-12 text-xs text-white/55">{dateOf(key).toLocaleDateString("en-GB", { weekday: "short" })}</span><span className="h-3 flex-1 overflow-hidden rounded-full bg-white/5"><span className="block h-full rounded-full bg-sky-400/70" style={{ width: `${Math.min(100, xp / (r.data?.target || 1000) * 100)}%` }} /></span><span className="flex w-7 shrink-0 justify-end gap-1" aria-hidden="true">{d && <><i className={`h-1.5 w-1.5 rounded-full ${morningDone(d) ? "bg-orange-300" : "bg-white/10"}`} title="Morning" /><i className={`h-1.5 w-1.5 rounded-full ${d.state.checks.checkout ? "bg-purple-300" : "bg-white/10"}`} title="Checkout" /></>}</span><span className={`w-20 text-right text-xs ${!d && key < today ? "text-rose-300/70" : "text-white/60"}`}>{key > today ? "Upcoming" : d ? `${xp} XP` : key === today ? "Not yet" : "Missed"}</span></button>; })}</div> : <div className={period === "year" ? "life-v2__year grid grid-cols-2 gap-5 lg:grid-cols-4" : ""}>
          {Array.from({ length: period === "year" ? 12 : 1 }, (_, index) => {
            const monthDays = period === "year" ? calendar.filter(k => dateOf(k).getMonth() === index) : calendar;
            return <div key={index}>{period === "year" && <h3 className="mb-2 text-xs text-white/60">{dateOf(monthDays[0]).toLocaleDateString("en-GB", { month: "short" })}</h3>}<div className="mb-1 grid grid-cols-7 text-center text-[10px] text-white/35">{['M','T','W','T','F','S','S'].map((label, i) => <span key={i}>{label}</span>)}</div><div className="life-v2__heatmap">{Array.from({ length: (dateOf(monthDays[0]).getDay() + 6) % 7 }, (_, i) => <span key={`pad-${i}`} />)}{monthDays.map(key => {
              const d = r.map.get(key), xp = d?.xp.total ?? 0;
              return <button key={key} disabled={key > today} aria-label={`${key}: ${key > today ? "upcoming" : d ? `${xp} XP` : "not logged"}`} title={`${key} · ${d ? `${xp} XP` : "Not logged"}`} onClick={() => onSelect(`today@${key}`)} className="disabled:opacity-20" style={{ background: d ? `rgba(56,189,248,${.13 + Math.min(1, xp / (r.data?.target || 1000)) * .65})` : "#ffffff05" }}>{dateOf(key).getDate()}</button>;
            })}</div></div>;
          })}
        </div>}
        <p className="mt-3 text-xs text-white/40">Select a day to review it. Unlogged days stay blank; upcoming days do not count.</p>
      </Panel>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4"><Stat label="Smoke-free" value={closed.length ? `${closed.filter(d => !(d.state.counters.cigarettes > 0)).length}/${closed.length}` : "—"} sub="of checked-out days" accent="emerald" /><Stat label="Dry days" value={closed.length ? `${closed.filter(d => !(d.state.counters.alcohol > 0)).length}/${closed.length}` : "—"} sub="of checked-out days" accent="emerald" /><Stat label="Average wake" value={averageTime(days, "wake_time")} sub="recorded times only" /><Stat label="Average bed" value={averageTime(days, "bed_time", true)} sub="accounts for midnight" accent="purple" /></div>
    </>}
  </div>;
}
export function XpPage({ dep }: { dep: number }) {
  const r = useXp(dep, 90), xp = r.data;
  return <div className="space-y-3" data-testid="life-xp-page"><SectionHeader icon={SparklesIcon} title="Your XP journey" subtitle="Consistency over perfection" accent="sky" />
    {r.error && <p role="status" className="text-sm text-amber-200">{r.error}</p>}
    {!xp ? <Quiet>Waiting for your XP history…</Quiet> : <><div className="grid grid-cols-2 gap-2 sm:grid-cols-4"><Stat label="Level" value={xp.level} sub={`${xp.levelSize - xp.intoLevel} XP to next level`} meter={100 * xp.intoLevel / xp.levelSize} accent="sky" /><Stat label="All-time XP" value={xp.total.toLocaleString()} /><Stat label="Streak" value={`${xp.streak} days`} accent="emerald" /><Stat label="Best day" value={`${xp.best} XP`} /></div><Panel title="Recent progress" accent="sky"><p className="mb-3 text-xs text-white/45">More than {xp.streakMin} XP keeps a day in your streak. XP follows your saved entries, including corrections.</p><div className="space-y-1">{xp.days.filter(d => d.xp > 0).slice(-14).reverse().map(d => <div key={d.day} className="flex justify-between border-b border-white/5 py-2 text-sm"><span className="text-white/65">{dayName(d.day)}</span><span className="text-sky-200">{d.xp} XP</span></div>)}{!xp.days.some(d => d.xp > 0) && <Quiet>Your first logged action starts the journey.</Quiet>}</div></Panel></>}
  </div>;
}
