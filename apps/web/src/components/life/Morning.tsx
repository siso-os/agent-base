import { cn } from "@siso/shell";
import { BrainIcon, CalendarDaysIcon, ClockIcon, DropletsIcon, DumbbellIcon, HeartIcon, MoonIcon, PauseIcon, PlayIcon, RotateCcwIcon, SunIcon, SunriseIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { A, Box, CheckRow, Presets, SectionHeader, StepCard, Stepper, TextField, ThinBar, Tick } from "./ui";
import { add, addDays, check, dayName, longDate, minutesOf, nowHHMM, num, setNum, setText, str, useDay, useRange, wakeTier, xpOf, type DayState, type XpItem } from "./store";

/**
 * The morning routine: LifeLock's six step cards (wake up, get the blood flowing, freshen up, power up the brain,
 * meditate, plan the day), each writing the siso-life keys (wake/wake_time, pushups/pushup_reps, teeth, shower,
 * cold_shower, supplements, water, meditation/meditation_min, plan/priorities). The first unfinished card is the current
 * one and opens by itself; a finished card collapses with a tick and its XP.
 */
type Step = { id: string; title: string; icon: typeof SunIcon; keys: string[]; xpIds: string[]; xpMax: number; done: (s: DayState) => boolean; parts: (s: DayState) => [number, number] };

const STEPS: Step[] = [
  { id: "wake", title: "Wake up", icon: SunIcon, keys: ["wake"], xpIds: ["wake"], xpMax: 200, done: (s) => !!s.checks.wake, parts: (s) => [s.checks.wake ? 1 : 0, 1] },
  { id: "blood", title: "Get the blood flowing", icon: DumbbellIcon, keys: ["pushups"], xpIds: ["pushups"], xpMax: 70, done: (s) => !!s.checks.pushups, parts: (s) => [s.checks.pushups ? 1 : 0, 1] },
  { id: "freshen", title: "Freshen up", icon: DropletsIcon, keys: ["teeth", "shower"], xpIds: ["teeth", "shower", "cold_shower"], xpMax: 40, done: (s) => !!(s.checks.teeth && s.checks.shower), parts: (s) => [Number(!!s.checks.teeth) + Number(!!s.checks.shower), 2] },
  { id: "brain", title: "Power up the brain", icon: BrainIcon, keys: ["supplements"], xpIds: ["supplements"], xpMax: 15, done: (s) => !!s.checks.supplements, parts: (s) => [Number(!!s.checks.supplements) + Number((s.counters.water ?? 0) >= 500), 2] },
  { id: "meditate", title: "Meditate", icon: HeartIcon, keys: ["meditation"], xpIds: ["meditation"], xpMax: 200, done: (s) => !!s.checks.meditation, parts: (s) => [s.checks.meditation ? 1 : 0, 1] },
  { id: "plan", title: "Plan the day", icon: CalendarDaysIcon, keys: ["plan"], xpIds: ["plan"], xpMax: 20, done: (s) => !!s.checks.plan, parts: (s) => [Math.min(3, priorities(s).filter(Boolean).length) + (s.checks.plan ? 1 : 0), 4] },
];

const priorities = (s: DayState) => { const p = str(s.sets.priorities).split("\n"); return [p[0] ?? "", p[1] ?? "", p[2] ?? ""]; };

export function morningProgress(s: DayState) {
  const done = STEPS.filter((st) => st.done(s)).length;
  return { done, of: STEPS.length, next: STEPS.find((st) => !st.done(s))?.title };
}

export function MorningPage({ day, dep }: { day: string; dep: number }) {
  const d = useDay(day, dep);
  const s = d.state;
  const current = STEPS.find((st) => !st.done(s))?.id;
  const [open, setOpen] = useState<string | undefined>(undefined);
  const [touched, setTouched] = useState(false);
  // Until he opens or closes a card himself, the current step is the open one.
  const openId = touched ? open : current;
  const toggle = (id: string) => { setTouched(true); setOpen(openId === id ? undefined : id); };
  const prog = morningProgress(s);
  const morningXp = xpOf(d.items, ["wake", "pushups", "teeth", "shower", "cold_shower", "supplements", "meditation", "plan", "morning_complete"]);
  const pb = usePushupBest(day);
  const complete = prog.done === prog.of;
  return (
    <div className="space-y-2.5" data-testid="life-morning">
      <SectionHeader icon={SunriseIcon} title="Morning routine" subtitle={longDate(day)} accent="orange" xp={morningXp} progress={prog} />
      <ThinBar pct={(prog.done / prog.of) * 100} accent="orange" />
      {STEPS.map((st) => {
        const [n, of] = st.parts(s);
        const done = st.done(s);
        return (
          <StepCard key={st.id} icon={st.icon} title={st.title} accent="orange" done={done} current={st.id === current} open={openId === st.id} onToggle={() => toggle(st.id)}
            progress={of ? n / of : 0} label={done ? "Complete" : n ? `${n}/${of} complete` : "Not started"} xp={xpOf(d.items, st.xpIds)} xpMax={st.xpMax} testid={`life-step-${st.id}`}>
            <StepBody id={st.id} day={day} s={s} items={d.items} pb={pb} />
          </StepCard>
        );
      })}
      {complete && (
        <section className="flex items-center gap-3 rounded-lg border border-orange-400/20 bg-white/[0.035] p-3" data-testid="life-morning-done">
          <span className="grid h-9 w-9 place-items-center rounded-lg border border-orange-400/30 bg-orange-500/[0.08]"><SunIcon className="h-4 w-4 text-orange-300" aria-hidden="true" /></span>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold text-white/90">Morning complete</div>
            <div className="text-xs text-white/50">{dayName(day)} · woke {str(s.sets.wake_time) || "—"} · whole-routine bonus +100</div>
          </div>
          <span className="rounded-lg border border-orange-400/20 bg-orange-500/[0.08] px-2 py-1 text-xs font-semibold text-orange-200">{morningXp} XP</span>
        </section>
      )}
    </div>
  );
}

/** Personal best push-ups over the last 90 days (the old card's "PB n reps"). */
function usePushupBest(day: string) {
  // Earlier days do not change while he logs this one: read once, then today's own reps count on top.
  const r = useRange(addDays(day, -90), addDays(day, -1), 0);
  return useMemo(() => r.data ? Math.max(0, ...[...r.map.values()].map((d) => num(d.state.sets.pushup_reps) ?? 0)) : undefined, [r.data]); // eslint-disable-line react-hooks/exhaustive-deps
}

function StepBody({ id, day, s, items, pb }: { id: string; day: string; s: DayState; items: XpItem[]; pb: number | undefined }) {
  const desc = (t: string) => <p className="text-xs leading-relaxed text-orange-100/50 sm:text-sm">{t}</p>;
  switch (id) {
    case "wake": return <>{desc("Earlier pays more: 2x XP by 7:00, 1.5x by 8:00.")}<WakeControl day={day} s={s} items={items} /></>;
    case "blood": {
      const reps = num(s.sets.pushup_reps) ?? 0;
      return (
        <>
          {desc("Push-ups to wake the body up. 20 XP plus 1 per 2 reps.")}
          <Box accent="orange" done={!!s.checks.pushups} className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
              <Tick done={!!s.checks.pushups} onToggle={() => check(day, "pushups", !s.checks.pushups)} accent="orange" label="Push-ups done" />
              <div className="min-w-0">
                <div className="text-sm font-semibold text-orange-50/90">Push-ups</div>
                <div className="text-xs text-orange-200/45">{pb === undefined ? "History unavailable" : pb ? `PB ${pb} reps` : "No PB yet"}</div>
              </div>
            </div>
            <Stepper value={reps} unit="reps" step={5} accent="orange" testid="life-pushups" onChange={(n) => { setNum(day, "pushup_reps", n); if (n > 0 && !s.checks.pushups) check(day, "pushups", true); }} />
          </Box>
        </>
      );
    }
    case "freshen": return (
      <>
        {desc("Teeth and a shower. A cold one pays 15 more.")}
        <div className="space-y-2">
          <CheckRow label="Brush teeth" done={!!s.checks.teeth} onToggle={() => check(day, "teeth", !s.checks.teeth)} accent="orange" xp={xpOf(items, ["teeth"])} testid="life-row-teeth" />
          <CheckRow label="Shower" done={!!s.checks.shower} onToggle={() => check(day, "shower", !s.checks.shower)} accent="orange" xp={xpOf(items, ["shower"])} testid="life-row-shower" />
          <CheckRow label="Make it cold" hint="+15 on top of the shower" done={!!s.checks.cold_shower} onToggle={() => { const on = !s.checks.cold_shower; check(day, "cold_shower", on); if (on && !s.checks.shower) check(day, "shower", true); }} accent="orange" xp={xpOf(items, ["cold_shower"])} testid="life-row-cold" />
        </div>
      </>
    );
    case "brain": {
      const water = s.counters.water ?? 0;
      const preset = water >= 1000 ? 1000 : water >= 500 ? 500 : water === 0 ? 0 : undefined;
      return (
        <>
          {desc("Supplements and the first water of the day: 500 ml minimum, a litre is the full target.")}
          <CheckRow label="Supplements" done={!!s.checks.supplements} onToggle={() => check(day, "supplements", !s.checks.supplements)} accent="orange" xp={xpOf(items, ["supplements"])} testid="life-row-supplements" />
          <Box accent="orange" done={water >= 500}>
            <div className="mb-2.5 flex items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <DropletsIcon className="h-4 w-4 text-orange-300" aria-hidden="true" />
                <div>
                  <div className="text-sm font-semibold text-orange-50/90">Water</div>
                  <div className="text-xs text-orange-200/45">{water >= 1000 ? "Full target" : water >= 500 ? "Minimum done" : "500 ml minimum"}</div>
                </div>
              </div>
              <span className="text-sm font-bold tabular-nums text-orange-50" data-testid="life-morning-water">{water.toLocaleString("en-GB")} ml</span>
            </div>
            <Presets label="Water so far" accent="orange" value={preset} options={[{ v: 0, label: "0" }, { v: 500, label: "500 ml" }, { v: 1000, label: "1 L" }]} onPick={(v) => v !== water && add(day, "water", v - water)} />
          </Box>
        </>
      );
    }
    case "meditate": return <>{desc("Sit for a few minutes. 5 XP a minute, up to 200.")}<MeditationControl day={day} s={s} items={items} /></>;
    case "plan": {
      const p = priorities(s);
      const write = (i: number, v: string) => { const next = [...p]; next[i] = v; setText(day, "priorities", next.join("\n").replace(/\n+$/, "")); };
      return (
        <>
          {desc("Three things that make today a win, then mark the plan done.")}
          <div className="space-y-2">
            {p.map((v, i) => (
              <div key={i} className="flex items-center gap-2">
                <span className="w-5 shrink-0 text-center text-xs font-bold text-orange-300/70">{i + 1}</span>
                <TextField maxLength={300} value={v} onCommit={(t) => write(i, t)} placeholder={["The one that matters most", "Second", "Third"][i]} accent="orange" label={`Priority ${i + 1}`} testid={`life-priority-${i + 1}`} />
              </div>
            ))}
          </div>
          <CheckRow label="Plan done" done={!!s.checks.plan} onToggle={() => check(day, "plan", !s.checks.plan)} accent="orange" xp={xpOf(items, ["plan"])} testid="life-row-plan" />
        </>
      );
    }
  }
  return null;
}

/** WakeUpTimeTracker: two big buttons until he logs; then the time, its tier and multiplier, and a reset. */
function WakeControl({ day, s, items }: { day: string; s: DayState; items: XpItem[] }) {
  const t = str(s.sets.wake_time);
  const min = minutesOf(t);
  const logged = !!s.checks.wake && min !== undefined;
  const log = (time: string) => { setText(day, "wake_time", time); check(day, "wake", true); };
  if (!logged) {
    const big = "flex items-center gap-3 rounded-lg border border-white/10 bg-black/15 px-3 py-3 text-left transition-colors hover:border-orange-400/35 hover:bg-white/[0.04]";
    return (
      <div className="grid gap-2 sm:grid-cols-2">
        <button type="button" className={big} onClick={() => log(nowHHMM())} data-testid="life-wake-now">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg border border-orange-400/30 bg-white/[0.055]"><ClockIcon className="h-4 w-4 text-orange-300" aria-hidden="true" /></span>
          <span><span className="block text-sm font-semibold text-orange-100">Log wake-up now</span><span className="block text-xs text-white/45">Sets the time to the moment you tap.</span></span>
        </button>
        <button type="button" className={big} onClick={() => log("00:00")}>
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg border border-orange-400/30 bg-white/[0.055]"><MoonIcon className="h-4 w-4 text-orange-300" aria-hidden="true" /></span>
          <span><span className="block text-sm font-semibold text-orange-100">Pulling an all-nighter</span><span className="block text-xs text-white/45">Marks wake-up as midnight.</span></span>
        </button>
      </div>
    );
  }
  const tier = wakeTier(min);
  return (
    <div className="flex min-h-[64px] items-center gap-3 rounded-lg border border-orange-400/30 bg-black/15 px-3 py-3" data-testid="life-wake-logged">
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg border border-orange-400/30 bg-white/[0.055]"><SunIcon className={cn("h-4 w-4", tier.tone)} aria-hidden="true" /></span>
      <div className="min-w-0 flex-1">
        <div className={cn("text-xs font-semibold uppercase tracking-wide", tier.tone)}>{tier.label}</div>
        <input type="time" value={t} aria-label="Wake time" onChange={(e) => e.target.value && setText(day, "wake_time", e.target.value)}
          className="-ml-0.5 bg-transparent text-xl font-bold tabular-nums text-orange-50 outline-none [color-scheme:dark]" />
      </div>
      <div className="text-right">
        <div className="text-sm font-black tabular-nums text-orange-200">{tier.mult}x</div>
        <div className="text-[11px] text-white/40">{xpOf(items, ["wake"]) || Math.round(100 * tier.mult)} XP</div>
      </div>
      <button type="button" aria-label="Reset wake-up" onClick={() => { check(day, "wake", false); setText(day, "wake_time", ""); }} className="grid h-11 w-11 place-items-center rounded-lg text-white/40 hover:bg-white/[0.06] hover:text-white/80">
        <RotateCcwIcon className="h-4 w-4" aria-hidden="true" />
      </button>
    </div>
  );
}

/** MeditationTracker: a stopwatch with a breathing ring; stopping writes whole minutes (rounded up). */
function MeditationControl({ day, s, items }: { day: string; s: DayState; items: XpItem[] }) {
  const logged = num(s.sets.meditation_min) ?? 0;
  const key = `life-medit-${day}`;
  const [startedAt, setStartedAt] = useState<number | null>(() => Number(sessionStorage.getItem(key)) || null);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!startedAt) return;
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [startedAt]);
  const running = startedAt !== null;
  const secs = running ? Math.max(0, Math.floor((now - startedAt) / 1000)) + logged * 60 : logged * 60;
  const start = () => { const t = Date.now(); sessionStorage.setItem(key, String(t)); setStartedAt(t); setNow(t); };
  const stop = () => {
    sessionStorage.removeItem(key);
    setStartedAt(null);
    const total = Math.ceil(secs / 60);
    setNum(day, "meditation_min", total);
    if (total >= 1) check(day, "meditation", true);
  };
  const setMin = (n: number) => { setNum(day, "meditation_min", n); check(day, "meditation", n >= 1); };
  const xp = xpOf(items, ["meditation"]);
  return (
    <Box accent="orange" done={!!s.checks.meditation} className={cn("space-y-3", running && "border-orange-400/50")}>
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Tick done={!!s.checks.meditation} onToggle={() => (s.checks.meditation ? check(day, "meditation", false) : setMin(Math.max(1, logged)))} accent="orange" label="Meditation done" />
          <div>
            <div className="text-sm font-semibold text-orange-50/90">Meditation</div>
            <div className="relative inline-block">
              {running && <span className="absolute -inset-x-1 -inset-y-0.5 animate-[life-breathe_3.2s_ease-in-out_infinite] rounded border border-orange-300/25" aria-hidden="true" />}
              <span className="font-mono text-2xl font-bold tabular-nums text-orange-50" data-testid="life-medit-clock">{Math.floor(secs / 60)}:{String(secs % 60).padStart(2, "0")}</span>
            </div>
          </div>
        </div>
        <div className="text-right">
          <div className="text-base font-black text-orange-300">{xp || Math.min(200, Math.max(10, Math.ceil(secs / 60) * 5))} XP</div>
          <div className="text-xs text-orange-100/50">{Math.ceil(secs / 60)} min</div>
        </div>
      </div>
      <div className="grid grid-cols-[1fr_auto_auto] gap-2">
        <button type="button" onClick={running ? stop : start} className={cn("flex h-10 items-center justify-center gap-2 rounded-lg border text-sm font-semibold", A.orange.btn)} data-testid="life-medit-toggle">
          {running ? <PauseIcon className="h-4 w-4" aria-hidden="true" /> : <PlayIcon className="h-4 w-4" aria-hidden="true" />}
          {running ? "Stop" : logged ? "Resume timer" : "Start timer"}
        </button>
        <button type="button" aria-label="Add 5 minutes" onClick={() => setMin(logged + 5)} className="h-10 rounded-lg border border-white/10 bg-black/15 px-3 text-xs font-semibold text-orange-300 hover:bg-white/[0.06]">+5 min</button>
        <button type="button" aria-label="Reset meditation" onClick={() => { sessionStorage.removeItem(key); setStartedAt(null); setNum(day, "meditation_min", undefined); check(day, "meditation", false); }} className="grid h-10 w-10 place-items-center rounded-lg border border-white/10 bg-black/15 text-orange-300 hover:bg-white/[0.06]">
          <RotateCcwIcon className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
    </Box>
  );
}
