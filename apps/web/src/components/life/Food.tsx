// uihub: siso:stat-tile — the calorie tracker (Shaan, 7 Oct: "the calorie trackers ... needs to be brought in"): what is
// left today first, macros under it, one-tap repeats of recent meals, the meal log, and LifeLock's CalorieTracker week
// (bars against the target line) as plain CSS.
import { useMemo, useState } from "react";
import { FlameIcon, PlusIcon, RotateCcwIcon, UtensilsIcon, XIcon } from "lucide-react";
import { cn } from "@siso/shell";
import { A, Panel, SectionHeader, TextField } from "./ui";
import { addDays, dateOf, localDay, longDate, mealsOf, newId, num, setNum, setText, useDay, useRange, type Config, type Meal } from "./store";

const kcalFmt = (n: number) => Math.round(n).toLocaleString("en-GB");
const timeOf = (at: number) => at > 86_400_000 ? new Date(at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }) : "";

export function FoodPage({ day, dep, cfg }: { day: string; dep: number; cfg: Config }) {
  const d = useDay(day, dep), meals = mealsOf(d.state);
  // The six days before this one do not change while he logs today, so they are read once.
  const week = useRange(addDays(day, -6), addDays(day, -1), 0);
  const [name, setName] = useState("");
  const [values, setValues] = useState({ kcal: "", protein: "", carbs: "", fat: "" });
  const [error, setError] = useState("");
  const totals = meals.reduce((s, m) => ({ kcal: s.kcal + m.kcal, protein: s.protein + m.protein, carbs: s.carbs + m.carbs, fat: s.fat + m.fat }), { kcal: 0, protein: 0, carbs: 0, fat: 0 });
  const kcalTarget = num(d.state.sets.kcal_target) ?? cfg.food?.kcalTarget ?? 2000;
  const proteinTarget = num(d.state.sets.protein_target) ?? cfg.food?.proteinTarget ?? 150;
  const left = kcalTarget - totals.kcal, over = left < 0;
  const canLog = !!cfg.food;
  function save(m: Omit<Meal, "id" | "at">) { setText(day, `meal.${newId()}`, JSON.stringify({ ...m, at: Date.now() })); }
  // Recent meals: the latest version of each name from the last week, newest first, not already eaten today.
  const recent = useMemo(() => {
    const seen = new Set(meals.map(m => m.name.toLowerCase())), out: Meal[] = [];
    const past = [...week.map.values()].sort((a, b) => b.day.localeCompare(a.day)).flatMap(x => mealsOf(x.state).reverse());
    for (const m of past) { const k = m.name.toLowerCase(); if (!seen.has(k)) { seen.add(k); out.push(m); } }
    return out.slice(0, 6);
  }, [week.data, d.state]); // eslint-disable-line react-hooks/exhaustive-deps
  const bars = Array.from({ length: 7 }, (_, i) => {
    const key = addDays(day, i - 6), x = key === day ? undefined : week.map.get(key);
    const kcal = key === day ? totals.kcal : x ? mealsOf(x.state).reduce((n, m) => n + m.kcal, 0) : 0;
    const target = key === day ? kcalTarget : (x && num(x.state.sets.kcal_target)) ?? cfg.food?.kcalTarget ?? 2000;
    return { key, kcal, target, today: key === day };
  });
  const scale = Math.max(...bars.map(b => Math.max(b.kcal, b.target))) * 1.08 || 1;
  const logged = bars.filter(b => b.kcal > 0);
  const avg = logged.length ? logged.reduce((n, b) => n + b.kcal, 0) / logged.length : 0;
  const macros: [string, number, number | undefined, string][] = [["Protein", totals.protein, proteinTarget, "bg-amber-300"], ["Carbs", totals.carbs, undefined, "bg-amber-200/60"], ["Fat", totals.fat, undefined, "bg-amber-200/40"]];

  return <div className="space-y-3" data-testid="life-food">
    <SectionHeader icon={UtensilsIcon} title="Food & fuel" subtitle={longDate(day)} accent="amber" xp={d.items.filter(i => i.id === "food" || i.id === "protein").reduce((n, i) => n + i.xp, 0) || undefined} />
    <section className="rounded-2xl border border-white/10 bg-white/[0.035] p-4" aria-label="Calories today" data-testid="life-food-left">
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
        <div className="min-w-0">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-white/40">{over ? "Over target" : "Left today"}</div>
          <div className={cn("text-4xl font-black tabular-nums leading-none", over ? "text-rose-300" : "text-amber-50")}>{kcalFmt(Math.abs(left))}<span className="ml-1 text-sm font-medium text-white/45">kcal</span></div>
        </div>
        <div className="text-right text-xs tabular-nums text-white/50"><span className="text-base font-semibold text-white/85">{kcalFmt(totals.kcal)}</span> eaten of {kcalFmt(kcalTarget)} · {meals.length} {meals.length === 1 ? "meal" : "meals"}</div>
      </div>
      <div className="mt-3 h-2 overflow-hidden rounded-full bg-black/30" role="progressbar" aria-label="Calories eaten" aria-valuenow={Math.round(totals.kcal)} aria-valuemin={0} aria-valuemax={kcalTarget}>
        <div className={cn("life-fill h-full w-full rounded-full", over ? "bg-rose-400/80" : A.amber.fill)} style={{ transform: `scaleX(${Math.min(1, kcalTarget > 0 ? totals.kcal / kcalTarget : 0)})` }} />
      </div>
      <div className="mt-4 grid grid-cols-3 gap-3">{macros.map(([label, g, target, tone]) => <div key={label} className="min-w-0" data-testid={`life-macro-${label.toLowerCase()}`}>
        <div className="flex items-baseline justify-between gap-1 text-xs"><span className="text-white/55">{label}</span><span className="truncate tabular-nums text-white/85">{Math.round(g)}{target ? <span className="text-white/40"> / {target}</span> : ""} g</span></div>
        <div className="mt-1 h-1 overflow-hidden rounded-full bg-white/10"><div className={cn("life-fill h-full w-full rounded-full", tone)} style={{ transform: `scaleX(${target ? Math.min(1, g / target) : totals.kcal ? Math.min(1, (g * (label === "Fat" ? 9 : 4)) / Math.max(1, totals.kcal)) : 0})` }} /></div>
      </div>)}</div>
    </section>

    {!canLog ? <p role="status" className="text-sm text-amber-200">Food logging needs Life API v2. Existing entries remain visible.</p> : <Panel title="Log a meal" icon={PlusIcon} accent="amber">
      {recent.length > 0 && <div className="mb-3" data-testid="life-food-recent">
        <div className="mb-1.5 text-xs text-white/45">Again from this week</div>
        <div className="flex flex-wrap gap-1.5">{recent.map(m => <button key={m.id} type="button" onClick={() => save(m)} title={`${m.name} · ${m.kcal} kcal`} aria-label={`Log ${m.name} again, ${m.kcal} kcal`}
          className="inline-flex max-w-full min-h-9 items-center gap-1.5 rounded-lg border border-amber-400/20 bg-amber-500/[0.06] px-2.5 text-xs text-amber-100 hover:bg-amber-500/[0.14] active:scale-[.97]">
          <RotateCcwIcon className="h-3 w-3 shrink-0 text-amber-300" aria-hidden="true" /><span className="max-w-[200px] truncate">{m.name}</span><span className="shrink-0 tabular-nums text-amber-200/55">{m.kcal}</span>
        </button>)}</div>
      </div>}
      <form className="space-y-3" onSubmit={e => { e.preventDefault(); if (!name.trim() || !values.kcal.trim() || Object.values(values).some(v => !Number.isFinite(Number(v)) || Number(v) < 0)) { setError("Add a meal name and valid nutrition values."); return; } save({ name: name.trim(), kcal: Number(values.kcal), protein: Number(values.protein), carbs: Number(values.carbs), fat: Number(values.fat) }); setName(""); setValues({ kcal: "", protein: "", carbs: "", fat: "" }); setError(""); }}>
        <label className="block text-xs text-white/55">Meal name<input aria-label="Meal name" required maxLength={120} value={name} onChange={e => setName(e.target.value)} placeholder="What did you eat?" className="mt-1 block w-full rounded-lg border border-white/10 bg-black/20 p-3 text-sm text-white placeholder:text-white/25" /></label>
        <div className="grid grid-cols-4 gap-2">{([['kcal', 'Calories (kcal)', 'kcal'], ['protein', 'Protein (g)', 'protein'], ['carbs', 'Carbs (g)', 'carbs'], ['fat', 'Fat (g)', 'fat']] as const).map(([key, label, short]) => <label key={key} className="min-w-0 text-xs text-white/55"><span className="sm:hidden">{short}</span><span className="hidden sm:inline">{label}</span><input aria-label={label} type="number" inputMode="decimal" min="0" max="100000" step="any" required={key === "kcal"} value={values[key]} onChange={e => setValues(v => ({ ...v, [key]: e.target.value }))} placeholder="0" className="mt-1 block w-full min-w-0 rounded-lg border border-white/10 bg-black/20 p-2.5 text-sm tabular-nums text-white placeholder:text-white/25" /></label>)}</div>
        {error && <p role="alert" className="text-sm text-amber-200">{error}</p>}
        <button type="submit" className={`min-h-11 w-full rounded-lg border text-sm font-semibold ${A.amber.btn}`}>Add meal</button>
      </form>
    </Panel>}

    <Panel title={day === localDay() ? "Meals today" : "Meals"} accent="amber" right={meals.length ? <span className="text-xs tabular-nums text-white/45">{kcalFmt(totals.kcal)} kcal</span> : undefined} testid="life-food-meals">
      {meals.length === 0 ? <p className="py-3 text-sm text-white/45" data-testid="life-food-empty">{day === localDay() ? "Nothing logged yet. Add your first meal above" + (recent.length ? ", or tap one from this week." : ".") : "No meals were logged this day."}</p> : <ul className="divide-y divide-white/5">{meals.map(m => <li key={m.id} className="flex items-center gap-3 py-2.5">
        <div className="min-w-0 flex-1">
          <div className="line-clamp-2 break-words text-sm text-white/85" title={m.name}>{m.name}</div>
          <p className="text-xs tabular-nums text-white/40">{[timeOf(m.at), `${m.protein} g protein`, `${m.carbs} g carbs`, `${m.fat} g fat`].filter(Boolean).join(" · ")}</p>
        </div>
        <span className="shrink-0 text-sm font-semibold tabular-nums text-amber-100">{kcalFmt(m.kcal)}</span>
        {canLog && <><button type="button" aria-label={`Repeat ${m.name}`} onClick={() => save(m)} className="h-11 shrink-0 px-2 text-xs text-amber-200">Again</button><button type="button" aria-label={`Remove ${m.name}`} onClick={() => setText(day, `meal.${m.id}`, "")} className="grid h-11 w-11 shrink-0 place-items-center rounded-lg text-white/40 hover:bg-white/5"><XIcon className="h-4 w-4" /></button></>}
      </li>)}</ul>}
    </Panel>

    <Panel title="This week" icon={FlameIcon} accent="amber" right={<span className="text-xs tabular-nums text-white/45">{logged.length ? `avg ${kcalFmt(avg)} kcal · ${logged.filter(b => b.kcal <= b.target).length}/${logged.length} on target` : "No meals this week"}</span>} testid="life-food-week">
      <div className="life-kcal" role="img" aria-label={`Calories for the last seven days: ${bars.map(b => `${b.key} ${Math.round(b.kcal)}`).join(", ")}`}>
        <span className="life-kcal__target" style={{ bottom: `calc(18px + (100% - 18px) * ${kcalTarget / scale})` }} aria-hidden="true" />
        {bars.map(b => <div key={b.key} className={cn("life-kcal__bar", b.today && "is-today", b.kcal > b.target && "is-over", !b.kcal && "is-empty")} title={`${b.key} · ${Math.round(b.kcal)} kcal`}>
          <span className="life-kcal__track"><i style={{ transform: `scaleY(${b.kcal ? Math.max(0.03, b.kcal / scale) : 0.03})` }} /></span>
          <span className={cn("h-3.5 text-[10px] leading-[14px]", b.today ? "font-semibold text-amber-200" : "text-white/40")}>{dateOf(b.key).toLocaleDateString("en-GB", { weekday: "narrow" })}</span>
        </div>)}
      </div>
    </Panel>

    {canLog && <Panel title="Targets for this day" accent="amber"><div className="grid grid-cols-2 gap-3">{[["kcal_target", "Calorie target", kcalTarget], ["protein_target", "Protein target", proteinTarget]].map(([key, label, value]) => <div key={key}><label className="mb-1 block text-xs text-white/50">{label}</label><TextField label={String(label)} accent="amber" value={String(value)} onCommit={v => { const n = num(v); if (n !== undefined && n > 0 && n <= 100000) setNum(day, String(key), n); }} /></div>)}</div></Panel>}
  </div>;
}
