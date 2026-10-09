// uihub: siso:stat-tile — existing SISO side nav and LifeLock daily primitives.
import { cn } from "@siso/shell";
import { SideNav, SideSection } from "@siso/side-nav";
import { CalendarDaysIcon, ChevronLeftIcon, ChevronRightIcon, HeartPulseIcon, MoonIcon, SparklesIcon, SunriseIcon, UtensilsIcon, type LucideIcon } from "lucide-react";
import { useState } from "react";
import { MorningPage, morningProgress } from "./life/Morning";
import { NightlyPage, nightlyProgress } from "./life/Nightly";
import { Health } from "./life/Health";
import { FoodPage } from "./life/Food";
import { ReviewPage, XpPage, type Period } from "./life/Review";
import { A, Panel, Quiet, Stat, type Accent } from "./life/ui";
import { addDays, dayName, flush, isDay, localDay, longDate, mealsOf, needsSignIn, num, queue, str, syncError, useConfig, useDay, useLifeVersion, useXp, type Config, type DayState, type Xp } from "./life/store";
import "./life/life.css";
export { localDay, applyEvents, record, flush } from "./life/store";
export type LifeSelection = string;
const PAGES: { id: string; label: string; Icon: LucideIcon }[] = [
  { id: "today", label: "Today", Icon: HeartPulseIcon }, { id: "morning", label: "Morning", Icon: SunriseIcon },
  { id: "nightly", label: "Nightly", Icon: MoonIcon }, { id: "food", label: "Food", Icon: UtensilsIcon },
  { id: "week", label: "Week", Icon: CalendarDaysIcon }, { id: "month", label: "Month", Icon: CalendarDaysIcon },
  { id: "year", label: "Year", Icon: CalendarDaysIcon }, { id: "xp", label: "XP", Icon: SparklesIcon },
];
export function parseSelection(selected: string) {
  if (isDay(selected)) return { page: "today", day: selected }; // Existing saved day tabs still open.
  const [page, date] = selected.split("@");
  return { page: PAGES.some(p => p.id === page) ? page : "today", day: date && isDay(date) ? date : localDay() };
}
const isEmptyDay = (s: DayState) => !Object.values(s.checks).some(Boolean) && Object.keys(s.sets).length === 0 && !Object.values(s.counters).some(v => v > 0);

export function LifeSidebar({ selected, onSelect }: { selected: LifeSelection; onSelect: (s: LifeSelection) => void }) {
  // The same XP read as the page (one request answers both).
  const v = useLifeVersion(), xp = useXp(v), selection = parseSelection(selected);
  return <SideNav label="Life" storeKey="life-sidebar-width" footer={queue().length ? <div className="p-3 text-xs text-amber-200" role="status">{queue().length} entries waiting to sync</div> : undefined}>
    {[["Day", PAGES.slice(0, 4)], ["Review", PAGES.slice(4)]] .map(([title, pages]) => <SideSection key={String(title)} title={String(title)}><nav aria-label={`Life ${title} pages`} className="flex flex-col gap-0.5 px-1">{(pages as typeof PAGES).map(({ id, label, Icon }) => <button key={id} type="button" aria-current={selection.page === id ? "page" : undefined} onClick={() => onSelect(selection.day === localDay() ? id : `${id}@${selection.day}`)} className={cn("siso-sidebar__nav-link w-full text-left", selection.page === id && "is-active")}><Icon aria-hidden="true" /><span>{label}</span></button>)}</nav></SideSection>)}
    <SideSection title="Days" note={xp.data ? `${xp.data.daysLogged} logged` : undefined}><nav aria-label="Life days" className="flex flex-col gap-0.5 px-1">{(xp.data?.days ?? []).filter(d => d.xp > 0 && d.day !== localDay()).slice(-13).reverse().map(d => <button key={d.day} type="button" onClick={() => onSelect(`today@${d.day}`)} className={cn("siso-sidebar__nav-link w-full text-left", selection.day === d.day && "is-active")}><CalendarDaysIcon aria-hidden="true" /><span className="flex-1">{dayName(d.day)}</span><span className="text-xs text-white/45">{d.xp}</span></button>)}</nav></SideSection>
  </SideNav>;
}

export function LifeMain({ selected, onSelect }: { selected: LifeSelection; onSelect?: (s: LifeSelection) => void }) {
  const [nav, setNav] = useState({ source: selected, value: selected });
  const current = nav.source === selected ? nav.value : selected;
  const select = (s: string) => { if (onSelect) onSelect(s); else setNav({ source: selected, value: s }); };
  // Config changes with a deploy, not with a tap: read it once per visit.
  const { page, day } = parseSelection(current), v = useLifeVersion(), cfg = useConfig(), xp = useXp(v), pending = queue().length;
  const message = syncError(), today = localDay();
  const go = (d: string) => select(d === today ? page : `${page}@${d}`);
  return <main className="life-v2" data-testid="life-main"><div className="life-v2__inner space-y-4">
    <header className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
      <div className="life-v2__day min-w-0">
        <button type="button" aria-label="Previous day" onClick={() => go(addDays(day, -1))}><ChevronLeftIcon className="h-4 w-4" aria-hidden="true" /></button>
        <div className="min-w-0 px-1"><div className="text-[10px] font-semibold uppercase tracking-[.2em] text-white/40">Life</div><h1 className="truncate text-xl font-semibold" data-testid="life-day-title">{dayName(day)}</h1><p className="truncate text-xs text-white/45">{longDate(day)}</p></div>
        <button type="button" aria-label="Next day" disabled={day >= today} onClick={() => go(addDays(day, 1))}><ChevronRightIcon className="h-4 w-4" aria-hidden="true" /></button>
      </div>
      <div className="flex items-center gap-2">
        {day !== today && <button type="button" onClick={() => go(today)} className="h-9 rounded-lg border border-white/10 px-3 text-xs text-white/75 hover:bg-white/[0.05]" data-testid="life-back-today">Back to today</button>}
        <input type="date" aria-label="Go to day" value={day} max={today} onChange={e => isDay(e.target.value) && go(e.target.value)} className="h-9 max-w-[150px] rounded-lg border border-white/10 bg-black/20 px-2 text-xs text-white/80 [color-scheme:dark]" />
      </div>
    </header>
    <nav className="life-v2__tabs" aria-label="Life views">{PAGES.map(p => <button key={p.id} type="button" aria-current={page === p.id ? "page" : undefined} onClick={() => select(day === today ? p.id : `${p.id}@${day}`)}>{p.label}</button>)}</nav>
    {(message || pending > 0 || xp.error || needsSignIn()) && <div role="status" className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-400/20 bg-amber-500/5 p-3 text-xs text-amber-200"><span>{needsSignIn() ? "Life needs you to sign in again. Pending entries stay on this device." : message || (pending ? `${pending} entries waiting to sync. XP updates after sync.` : xp.error)}</span><button className="min-h-9 rounded border border-amber-300/20 px-3" onClick={() => void flush().then(() => window.dispatchEvent(new Event("online")))}>Retry sync</button></div>}
    {!cfg ? <Quiet>{xp.error || needsSignIn() ? "Life is unavailable. Retry when your connection or sign-in is restored." : "Loading Life…"}</Quiet> : page === "xp" ? <XpPage dep={v} /> : ["week", "month", "year"].includes(page) ? <ReviewPage day={day} period={page as Period} dep={v} onSelect={select} /> : <DailyView key={`${page}@${day}`} day={day} page={page} dep={v} cfg={cfg} xp={xp.data} onSelect={select} />}
  </div></main>;
}

function DailyView({ day, page, dep, cfg, xp, onSelect }: { day: string; page: string; dep: number; cfg: Config; xp?: Xp; onSelect: (s: string) => void }) {
  const d = useDay(day, dep);
  if (!d.data) return <Quiet>{d.error ?? "Loading this day…"}</Quiet>;
  if (day > localDay()) return <Quiet>This day has not started yet.</Quiet>;
  return <div>{d.error && <p role="status" className="mb-3 text-xs text-amber-200">{d.error}</p>}<fieldset disabled={d.loading || needsSignIn()} className="min-w-0 space-y-3 disabled:opacity-70">
    {page === "morning" ? <MorningPage day={day} dep={dep} /> : page === "nightly" ? <NightlyPage day={day} dep={dep} /> : page === "food" ? <FoodPage day={day} dep={dep} cfg={cfg} /> : <TodayPage day={day} dep={dep} cfg={cfg} xp={xp} s={d.state} total={d.total} onSelect={onSelect} />}
  </fieldset></div>;
}

/** The day at a glance: what to do next in each routine, the health counters, the plan. */
function TodayPage({ day, dep, cfg, xp, s, total, onSelect }: { day: string; dep: number; cfg: Config; xp?: Xp; s: DayState; total: number; onSelect: (s: string) => void }) {
  const today = localDay(), open = (p: string) => onSelect(day === today ? p : `${p}@${day}`);
  const empty = isEmptyDay(s), firstDay = empty && day === today && xp?.daysLogged === 0, missed = empty && day < today;
  const m = morningProgress(s), n = nightlyProgress(s), meals = mealsOf(s);
  const kcal = meals.reduce((t, x) => t + x.kcal, 0), kcalTarget = num(s.sets.kcal_target) ?? cfg.food?.kcalTarget ?? 2000;
  const dayXp = day === today ? xp?.today ?? total : xp?.days.find(x => x.day === day)?.xp ?? total;
  const plan = str(s.sets.priorities).split("\n").filter(l => l.trim());
  const tiles: { page: string; title: string; Icon: LucideIcon; accent: Accent; figure: string; sub: string; pct: number }[] = [
    { page: "morning", title: "Morning", Icon: SunriseIcon, accent: "orange", figure: `${m.done}/${m.of}`, sub: m.next ? `Next: ${m.next}` : "Routine complete", pct: m.done / m.of },
    { page: "food", title: "Food", Icon: UtensilsIcon, accent: "amber", figure: `${Math.round(kcal).toLocaleString("en-GB")}`, sub: `of ${kcalTarget.toLocaleString("en-GB")} kcal · ${meals.length} ${meals.length === 1 ? "meal" : "meals"}`, pct: kcalTarget ? Math.min(1, kcal / kcalTarget) : 0 },
    { page: "nightly", title: "Nightly", Icon: MoonIcon, accent: "purple", figure: s.checks.checkout ? "Closed" : `${n.done}/${n.of}`, sub: s.checks.checkout ? "Day checked out" : n.next ? `Next: ${n.next}` : "Ready to close", pct: s.checks.checkout ? 1 : n.done / n.of },
  ];
  return <>
    {firstDay && <section className="flex flex-wrap items-center gap-3 rounded-2xl border border-orange-400/25 bg-orange-500/[0.06] p-4" data-testid="life-first-day">
      <span className={cn("grid h-10 w-10 shrink-0 place-items-center rounded-xl border", A.orange.tile)}><SunriseIcon className="h-5 w-5 text-orange-300" aria-hidden="true" /></span>
      <div className="min-w-[200px] flex-1"><h2 className="text-base font-semibold text-white/90">Day one starts here</h2><p className="text-xs leading-relaxed text-white/55">Log your wake-up to begin. Every tick earns XP, and a day over {xp?.streakMin ?? cfg.streakMin} XP starts your streak.</p></div>
      <button type="button" onClick={() => open("morning")} className={cn("min-h-11 w-full rounded-lg border px-4 text-sm font-semibold sm:w-auto", A.orange.btn)}>Start the morning</button>
    </section>}
    {missed && <section className="rounded-2xl border border-rose-400/20 bg-rose-500/[0.05] p-4" data-testid="life-missed">
      <h2 className="text-base font-semibold text-white/90">Nothing was logged on {longDate(day)}</h2>
      <p className="mt-1 text-xs leading-relaxed text-white/55">This day is missing from your streak and your reviews. Fill in what you remember: it still counts.</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" onClick={() => open("morning")} className={cn("min-h-10 rounded-lg border px-3 text-xs font-semibold", A.orange.btn)}>Fill in the morning</button>
        <button type="button" onClick={() => open("nightly")} className={cn("min-h-10 rounded-lg border px-3 text-xs font-semibold", A.purple.btn)}>Close the day</button>
      </div>
    </section>}
    {xp && !firstDay && <div className="grid grid-cols-3 gap-2" data-testid="life-xpbar"><Stat label="Level" value={xp.level} sub={`${xp.levelSize - xp.intoLevel} XP to next`} meter={100 * xp.intoLevel / xp.levelSize} /><Stat label={day === today ? "Today’s XP" : "Day XP"} value={dayXp} meter={100 * dayXp / xp.target} /><Stat label="Streak" value={`${xp.streak} ${xp.streak === 1 ? "day" : "days"}`} accent="emerald" /></div>}
    <div className="grid gap-2 sm:grid-cols-3">{tiles.map(t => <button key={t.page} type="button" onClick={() => open(t.page)} data-testid={`life-tile-${t.page}`}
      className="group min-w-0 rounded-2xl border border-white/10 bg-white/[0.035] p-3 text-left hover:border-white/20 hover:bg-white/[0.05] active:scale-[.99]">
      <span className="flex items-center gap-2"><t.Icon className={cn("h-4 w-4", A[t.accent].text)} aria-hidden="true" /><span className="text-sm font-semibold text-white/85">{t.title}</span><ChevronRightIcon className="ml-auto h-4 w-4 text-white/30 group-hover:text-white/60" aria-hidden="true" /></span>
      <span className="mt-2 block text-2xl font-semibold tabular-nums text-white">{t.figure}</span>
      <span className="block truncate text-xs text-white/50">{t.sub}</span>
      <span className={cn("mt-2.5 block h-1 overflow-hidden rounded-full", A[t.accent].track)}><span className={cn("life-fill block h-full w-full rounded-full", A[t.accent].fill)} style={{ transform: `scaleX(${t.pct})` }} /></span>
    </button>)}</div>
    <Health day={day} dep={dep} cfg={cfg} />
    <Panel title={day === today ? "Today’s priorities" : "Priorities"} icon={CalendarDaysIcon} accent="orange">{plan.length ? <ol className="space-y-1.5">{plan.map((p, i) => <li key={i} className="flex gap-2.5 text-sm leading-relaxed text-white/75"><span className="w-4 shrink-0 text-center text-xs font-bold leading-6 text-orange-300/70">{i + 1}</span><span className="min-w-0 break-words">{p}</span></li>)}</ol> : <p className="text-sm text-white/45">Set your top three in the morning routine.</p>}</Panel>
  </>;
}
