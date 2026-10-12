// uihub: siso:stat-tile — the nightly checkout rebuilt on the morning routine's primitives (Shaan, 7 Oct: "bring those
// primitives over to redo the nightly"): LifeLock's NightlyCheckoutStepCard pattern (step cards, the current one open,
// a thin bar and XP when collapsed), yesterday's plan as an accountability chip, and the close-the-day card last.
import { CalendarDaysIcon, CheckCircle2Icon, MoonIcon, NotebookPenIcon, SparklesIcon, TrendingUpIcon } from "lucide-react";
import { useState } from "react";
import { A, CheckRow, Presets, SectionHeader, StepCard, Stepper, TextField, ThinBar } from "./ui";
import { addDays, check, dayName, longDate, nowHHMM, num, setNum, setText, str, useDay, xpOf, type DayState } from "./store";

const lines3 = (v: unknown) => { const p = str(v).split("\n"); return [p[0] ?? "", p[1] ?? "", p[2] ?? ""]; };
const filled = (v: unknown) => str(v).trim() !== "";
const firstLine = (v: unknown) => str(v).trim().split("\n")[0] ?? "";

type Step = { id: string; title: string; icon: typeof MoonIcon; xpIds: string[]; parts: (s: DayState) => [number, number]; summary: (s: DayState) => string };
const STEPS: Step[] = [
  { id: "reflect", title: "Reflect, then let it go", icon: NotebookPenIcon, xpIds: ["went_well", "even_better"], parts: s => [Number(filled(s.sets.went_well)) + Number(filled(s.sets.even_better)), 2],
    summary: s => firstLine(s.sets.went_well) || firstLine(s.sets.even_better) },
  { id: "stock", title: "Take stock", icon: SparklesIcon, xpIds: ["deep_hours", "workout"], parts: s => [Number(num(s.sets.deep_hours) !== undefined), 1],
    summary: s => `${num(s.sets.deep_hours) ?? 0} h deep work${s.checks.workout ? " · worked out" : ""}` },
  { id: "tomorrow", title: "Plan tomorrow", icon: CalendarDaysIcon, xpIds: ["tomorrow"], parts: s => [Math.min(1, lines3(s.sets.tomorrow).filter(l => l.trim()).length), 1],
    summary: s => lines3(s.sets.tomorrow).filter(l => l.trim()).join(" · ") },
  { id: "rest", title: "Rate the day & rest", icon: MoonIcon, xpIds: ["rating", "bed_time"], parts: s => [Number(num(s.sets.rating) !== undefined) + Number(filled(s.sets.bed_time)), 2],
    summary: s => [num(s.sets.rating) !== undefined ? `${num(s.sets.rating)}/10` : "", filled(s.sets.bed_time) ? `bed ${str(s.sets.bed_time)}` : ""].filter(Boolean).join(" · ") },
];
const stepDone = (st: Step, s: DayState) => { const [n, of] = st.parts(s); return n >= of; };
export function nightlyProgress(s: DayState) { return { done: STEPS.filter(st => stepDone(st, s)).length, of: STEPS.length, next: STEPS.find(st => !stepDone(st, s))?.title }; }

export function NightlyPage({ day, dep }: { day: string; dep: number }) {
  const d = useDay(day, dep), s = d.state;
  // Yesterday's plan does not change while he works on today, so it is read once.
  const prev = useDay(addDays(day, -1), 0).state;
  const closed = !!s.checks.checkout;
  const current = STEPS.find(st => !stepDone(st, s))?.id;
  const [open, setOpen] = useState<string | undefined>(undefined);
  const [touched, setTouched] = useState(false);
  // Until he opens or closes a card himself, the first unfinished step is the open one (reflection leads: it is the
  // part worth doing while the day is fresh; the numbers take seconds).
  const openId = touched ? open : current;
  const toggle = (id: string) => { setTouched(true); setOpen(openId === id ? undefined : id); };
  const prog = nightlyProgress(s);
  const planned = lines3(prev.sets.tomorrow).filter(l => l.trim());
  return <div className="space-y-2.5" data-testid="life-nightly">
    <SectionHeader icon={MoonIcon} title="Nightly checkout" subtitle={longDate(day)} accent="purple" xp={d.total} progress={prog} />
    <ThinBar pct={(prog.done / prog.of) * 100} accent="purple" />
    {planned.length > 0 && <div className="flex min-w-0 items-center gap-2 rounded-xl border border-white/10 bg-white/[0.035] px-3 py-2" data-testid="life-nightly-yesterday">
      <TrendingUpIcon className="h-4 w-4 shrink-0 text-purple-300" aria-hidden="true" />
      <span className="shrink-0 text-xs text-white/45">{dayName(addDays(day, -1))} you planned</span>
      <span className="min-w-0 flex-1 truncate text-xs font-medium text-white/80">{planned.join(" · ")}</span>
    </div>}
    {STEPS.map(st => {
      const [n, of] = st.parts(s), done = n >= of, summary = st.summary(s);
      return <StepCard key={st.id} icon={st.icon} title={st.title} accent="purple" done={done} current={st.id === current} open={openId === st.id} onToggle={() => toggle(st.id)}
        progress={of ? n / of : 0} label={summary || (n ? `${n}/${of} complete` : "Not started")} xp={xpOf(d.items, st.xpIds)} testid={`life-night-${st.id}`}>
        <StepBody id={st.id} day={day} s={s} />
      </StepCard>;
    })}
    <section className={`rounded-xl border p-3 ${closed ? "border-purple-400/30 bg-purple-500/[.09]" : "border-white/10 bg-white/[0.035]"}`} data-testid="life-close-card">
      <div className="mb-2.5 flex items-center gap-3">
        <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg border ${A.purple.tile}`}><CheckCircle2Icon className={`h-4 w-4 ${closed ? "life-pop" : ""} text-purple-300`} aria-hidden="true" /></span>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold text-white/90">{closed ? "Day closed" : "Close the day"}</div>
          <div className="text-xs text-white/50">{closed ? `${dayName(day)} is recorded. You can still correct anything above.` : prog.done < prog.of ? `${prog.of - prog.done} of ${prog.of} steps still open. You can close it anyway.` : "Every step is done. Smoke-free and dry-day XP land at checkout."}</div>
        </div>
      </div>
      <button type="button" aria-pressed={closed} className={`flex min-h-11 w-full items-center justify-center gap-2 rounded-lg border px-4 text-sm font-semibold ${closed ? "border-white/10 bg-black/15 text-white/60 hover:bg-white/[0.05]" : A.purple.btn}`} onClick={() => check(day, "checkout", !closed)} data-testid="life-close-day">
        {closed ? "Day closed · reopen" : "Close the day"}
      </button>
    </section>
  </div>;
}

function StepBody({ id, day, s }: { id: string; day: string; s: DayState }) {
  const desc = (t: string) => <p className="text-xs leading-relaxed text-purple-100/50 sm:text-sm">{t}</p>;
  const field = (key: string, label: string, placeholder: string) => <div key={key}>
    <label className="mb-1.5 block text-xs text-purple-100/65">{label}</label>
    <TextField value={str(s.sets[key])} onCommit={t => setText(day, key, t)} lines={2} label={label} placeholder={placeholder} accent="purple" testid={`life-note-${key}`} />
  </div>;
  switch (id) {
    case "stock": return <>
      {desc("The hours that moved the needle, and whether you trained.")}
      <div className="flex items-center justify-between gap-3 rounded-lg border border-white/10 bg-black/15 p-3">
        <div className="min-w-0"><div className="text-sm font-semibold text-purple-50/90">Deep work</div><div className="text-xs text-purple-200/45">Focused hours, half-hour steps</div></div>
        <Stepper value={num(s.sets.deep_hours) ?? 0} step={0.5} unit="hours" accent="purple" testid="life-deep-hours" onChange={n => setNum(day, "deep_hours", n)} />
      </div>
      <CheckRow label="Worked out" done={!!s.checks.workout} accent="purple" onToggle={() => check(day, "workout", !s.checks.workout)} testid="life-row-workout" />
    </>;
    case "reflect": return <>
      {desc("One win worth keeping, one thing to change. Write as much as you like.")}
      {field("went_well", "What went well", "A win worth remembering")}
      {field("even_better", "Even better if", "One thing to change next time")}
    </>;
    case "tomorrow": {
      const p = lines3(s.sets.tomorrow);
      const write = (i: number, v: string) => { const next = [...p]; next[i] = v.replace(/\n/g, " "); setText(day, "tomorrow", next.join("\n").replace(/\n+$/, "")); };
      return <>
        {desc("Give tomorrow a clear starting point: the three things that make it a win.")}
        <div className="space-y-2">{p.map((v, i) => <div key={i} className="flex items-center gap-2">
          <span className="w-5 shrink-0 text-center text-xs font-bold text-purple-300/70">{i + 1}</span>
          <TextField maxLength={300} value={v} onCommit={t => write(i, t)} placeholder={["The one that matters most", "Second", "Third"][i]} accent="purple" label={`Tomorrow ${i + 1}`} testid={`life-tomorrow-${i + 1}`} />
        </div>)}</div>
      </>;
    }
    case "rest": return <>
      {desc("Rate the day honestly, then log when you went to bed.")}
      <div className="grid gap-2 sm:grid-cols-2" aria-label="Day rating">
        {[0, 5].map(start => <Presets key={start} label={`Rating ${start + 1} to ${start + 5}`} value={num(s.sets.rating)} accent="purple" options={Array.from({ length: 5 }, (_, i) => ({ v: start + i + 1, label: String(start + i + 1) }))} onPick={n => setNum(day, "rating", n)} />)}
      </div>
      <div className="flex items-center justify-between gap-3 rounded-lg border border-white/10 bg-black/15 p-3">
        <label htmlFor="life-bed-time" className="text-sm font-semibold text-purple-50/90">Bed time</label>
        <div className="flex items-center gap-2">
          <input id="life-bed-time" type="time" value={str(s.sets.bed_time)} onChange={e => setText(day, "bed_time", e.target.value)} className="rounded-lg border border-white/10 bg-black/20 p-2 text-sm tabular-nums [color-scheme:dark]" />
          <button type="button" onClick={() => setText(day, "bed_time", nowHHMM())} className={`h-10 rounded-lg border px-3 text-xs font-semibold ${A.purple.btn}`}>Now</button>
        </div>
      </div>
    </>;
  }
  return null;
}
