import { cn } from "@siso/shell";
import { CheckCircle2Icon, ChevronDownIcon, MinusIcon, PlusIcon, type LucideIcon } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";

/**
 * Life's primitives, ported from the newest LifeLock mobile morning routine (personal/apps/siso-lifelock, June 2026:
 * MorningRoutineTaskCard, RegularSubtaskRow, PushupControl, WaterControl, DailySectionHeader, XPPill), the UI Shaan
 * called "quite nice". Same recipe: translucent white cards on the dark app, one warm accent per section (orange
 * morning, purple nightly, emerald health, amber food, sky review), 44 px+ tap rows, collapsed cards keep a thin bar.
 * Tailwind needs whole class names, so each accent is spelled out in full below.
 */
export type Accent = "orange" | "purple" | "emerald" | "amber" | "sky";

export const A = {
  orange: {
    text: "text-orange-300", soft: "text-orange-200/90", faint: "text-orange-100/50", strong: "text-orange-50",
    tile: "border-orange-400/35 bg-orange-500/[0.08]", tileDone: "border-orange-400/25 bg-orange-500/[0.06]",
    cardCur: "border-orange-400/35 bg-orange-500/[0.045]", cardOpen: "border-orange-400/30 bg-white/[0.055] shadow-sm shadow-black/20", cardDone: "border-orange-400/20 bg-white/[0.03]",
    track: "border border-orange-600/15 bg-orange-950/35", fill: "bg-gradient-to-r from-orange-300/90 to-orange-500", bar: "bg-gradient-to-r from-orange-300/80 via-amber-300/85 to-orange-500/85",
    dot: "bg-orange-500 border-orange-500", dotOpen: "border-orange-400/50 group-hover:border-orange-400", rowHover: "hover:border-orange-400/25",
    chip: "border-orange-400/20 bg-orange-500/[0.08] text-orange-200", btn: "border-orange-400/35 bg-orange-500/20 text-orange-100 hover:bg-orange-500/30",
    sel: "border-orange-400 bg-orange-500/20 text-orange-100", ring: "focus-visible:ring-orange-400/60", rail: "from-orange-500 to-amber-400",
  },
  purple: {
    text: "text-purple-300", soft: "text-purple-200/90", faint: "text-purple-100/45", strong: "text-purple-50",
    tile: "border-purple-400/35 bg-purple-500/[0.08]", tileDone: "border-purple-400/25 bg-purple-500/[0.06]",
    cardCur: "border-purple-400/35 bg-purple-500/[0.045]", cardOpen: "border-purple-400/30 bg-white/[0.055] shadow-sm shadow-black/20", cardDone: "border-purple-400/20 bg-white/[0.03]",
    track: "border border-purple-600/15 bg-purple-950/35", fill: "bg-gradient-to-r from-purple-300/90 to-violet-500", bar: "bg-gradient-to-r from-purple-300/80 via-violet-300/85 to-purple-500/85",
    dot: "bg-purple-500 border-purple-500", dotOpen: "border-purple-400/50 group-hover:border-purple-400", rowHover: "hover:border-purple-400/25",
    chip: "border-purple-400/20 bg-purple-500/[0.08] text-purple-200", btn: "border-purple-400/35 bg-purple-500/20 text-purple-100 hover:bg-purple-500/30",
    sel: "border-purple-400 bg-purple-500/20 text-purple-100", ring: "focus-visible:ring-purple-400/60", rail: "from-purple-500 to-violet-400",
  },
  emerald: {
    text: "text-emerald-300", soft: "text-emerald-200/90", faint: "text-emerald-100/45", strong: "text-emerald-50",
    tile: "border-emerald-400/35 bg-emerald-500/[0.08]", tileDone: "border-emerald-400/25 bg-emerald-500/[0.06]",
    cardCur: "border-emerald-400/35 bg-emerald-500/[0.045]", cardOpen: "border-emerald-400/30 bg-white/[0.055] shadow-sm shadow-black/20", cardDone: "border-emerald-400/20 bg-white/[0.03]",
    track: "border border-emerald-600/15 bg-emerald-950/35", fill: "bg-gradient-to-r from-emerald-300/90 to-emerald-500", bar: "bg-gradient-to-r from-emerald-300/80 via-teal-300/85 to-emerald-500/85",
    dot: "bg-emerald-500 border-emerald-500", dotOpen: "border-emerald-400/50 group-hover:border-emerald-400", rowHover: "hover:border-emerald-400/25",
    chip: "border-emerald-400/20 bg-emerald-500/[0.08] text-emerald-200", btn: "border-emerald-400/35 bg-emerald-500/20 text-emerald-100 hover:bg-emerald-500/30",
    sel: "border-emerald-400 bg-emerald-500/20 text-emerald-100", ring: "focus-visible:ring-emerald-400/60", rail: "from-emerald-500 to-green-400",
  },
  amber: {
    text: "text-amber-300", soft: "text-amber-200/90", faint: "text-amber-100/45", strong: "text-amber-50",
    tile: "border-amber-400/35 bg-amber-500/[0.08]", tileDone: "border-amber-400/25 bg-amber-500/[0.06]",
    cardCur: "border-amber-400/35 bg-amber-500/[0.045]", cardOpen: "border-amber-400/30 bg-white/[0.055] shadow-sm shadow-black/20", cardDone: "border-amber-400/20 bg-white/[0.03]",
    track: "border border-amber-600/15 bg-amber-950/35", fill: "bg-gradient-to-r from-amber-200/90 to-amber-500", bar: "bg-gradient-to-r from-amber-200/80 via-yellow-300/85 to-amber-500/85",
    dot: "bg-amber-500 border-amber-500", dotOpen: "border-amber-400/50 group-hover:border-amber-400", rowHover: "hover:border-amber-400/25",
    chip: "border-amber-400/20 bg-amber-500/[0.08] text-amber-200", btn: "border-amber-400/35 bg-amber-500/20 text-amber-100 hover:bg-amber-500/30",
    sel: "border-amber-400 bg-amber-500/20 text-amber-100", ring: "focus-visible:ring-amber-400/60", rail: "from-amber-500 to-orange-400",
  },
  sky: {
    text: "text-sky-300", soft: "text-sky-200/90", faint: "text-sky-100/45", strong: "text-sky-50",
    tile: "border-sky-400/35 bg-sky-500/[0.08]", tileDone: "border-sky-400/25 bg-sky-500/[0.06]",
    cardCur: "border-sky-400/35 bg-sky-500/[0.045]", cardOpen: "border-sky-400/30 bg-white/[0.055] shadow-sm shadow-black/20", cardDone: "border-sky-400/20 bg-white/[0.03]",
    track: "border border-sky-600/15 bg-sky-950/35", fill: "bg-gradient-to-r from-sky-300/90 to-blue-500", bar: "bg-gradient-to-r from-sky-300/80 via-cyan-300/85 to-blue-500/85",
    dot: "bg-sky-500 border-sky-500", dotOpen: "border-sky-400/50 group-hover:border-sky-400", rowHover: "hover:border-sky-400/25",
    chip: "border-sky-400/20 bg-sky-500/[0.08] text-sky-200", btn: "border-sky-400/35 bg-sky-500/20 text-sky-100 hover:bg-sky-500/30",
    sel: "border-sky-400 bg-sky-500/20 text-sky-100", ring: "focus-visible:ring-sky-400/60", rail: "from-sky-500 to-cyan-400",
  },
} as const;

/** DailySectionHeader: icon tile, title, subtitle, chips on the right. */
export function SectionHeader({ icon: Icon, title, subtitle, accent, xp, progress, right }: { icon: LucideIcon; title: string; subtitle?: string; accent: Accent; xp?: number; progress?: { done: number; of: number }; right?: ReactNode }) {
  const a = A[accent];
  const full = progress && progress.done >= progress.of;
  return (
    <header className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/[0.035] px-3 py-2.5">
      <span className={cn("grid h-9 w-9 shrink-0 place-items-center rounded-lg border", a.tile)}><Icon className={cn("h-4 w-4", a.text)} aria-hidden="true" /></span>
      <div className="min-w-0 flex-1">
        <h1 className="truncate text-base font-semibold text-white/90">{title}</h1>
        {subtitle && <p className="truncate text-xs text-white/50">{subtitle}</p>}
      </div>
      {right}
      {xp !== undefined && <span className={cn("rounded-lg border px-2 py-1 text-xs font-semibold tabular-nums", a.chip)} data-testid="life-section-xp">{xp} XP</span>}
      {progress && (
        <span className={cn("rounded-lg border px-2 py-1 text-xs font-semibold tabular-nums", full ? "border-emerald-400/25 bg-emerald-500/[0.08] text-emerald-200" : "border-white/10 bg-black/10 text-white/55")}>
          {progress.done}/{progress.of}
        </span>
      )}
    </header>
  );
}

/** The thin overall progress bar under a section header. */
export function ThinBar({ pct, accent }: { pct: number; accent: Accent }) {
  return (
    <div className="h-1 overflow-hidden rounded-full bg-black/25" role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}>
      <div className={cn("life-fill h-full w-full rounded-full", A[accent].bar)} style={{ transform: `scaleX(${Math.max(0, Math.min(100, pct)) / 100})` }} />
    </div>
  );
}

/** XPPill: "+n" once earned, "up to n" before. */
export function XpPill({ xp, earned, max }: { xp: number; earned: boolean; max?: number }) {
  const tone = !earned ? "border-white/10 bg-white/[0.04] text-white/40" : xp >= 50 ? "border-orange-500/40 bg-orange-500/20 text-orange-300" : xp >= 25 ? "border-amber-500/40 bg-amber-500/20 text-amber-300" : "border-white/15 bg-white/[0.06] text-white/70";
  return (
    <span className={cn("inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-[10px] font-bold tabular-nums", tone)}>
      {earned ? `+${xp}` : `up to ${max ?? xp}`} XP
    </span>
  );
}

/**
 * MorningRoutineTaskCard: the whole header row toggles; collapsed it keeps a progress bar and "Completed" or "n/m";
 * the current step is tinted; a finished card collapses with a tick.
 */
export function StepCard({ icon: Icon, title, accent, done, current, open, onToggle, progress, label, xp, xpMax, children, testid }: {
  icon: LucideIcon; title: string; accent: Accent; done: boolean; current?: boolean; open: boolean; onToggle: () => void;
  progress: number; label: string; xp: number; xpMax?: number; children: ReactNode; testid?: string;
}) {
  const a = A[accent];
  return (
    <section
      className={cn("relative overflow-hidden rounded-xl border", open ? a.cardOpen : done ? a.cardDone : current ? a.cardCur : "border-white/10 bg-white/[0.035] hover:border-white/20 hover:bg-white/[0.045]")}
      data-complete={done || undefined}
      data-testid={testid}
      aria-label={title}
    >
      <button type="button" onClick={onToggle} aria-expanded={open} className={cn("flex min-h-[52px] w-full touch-manipulation select-none items-center gap-2.5 p-2.5 text-left outline-none hover:bg-white/[0.035] active:bg-white/[0.055] focus-visible:ring-2", a.ring)}>
        <span className={cn("grid shrink-0 place-items-center rounded-lg border p-1.5", open || current ? a.tile : done ? a.tileDone : "border-white/10 bg-white/[0.055]")}>
          <Icon className={cn("h-4 w-4", open || current || done ? a.text : "text-white/55")} aria-hidden="true" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5">
            <span className="truncate text-sm font-semibold text-white/90">{title}</span>
            {done && <CheckCircle2Icon className={cn("life-pop h-4 w-4 shrink-0", a.text)} aria-label="done" />}
          </span>
          {!open && (
            <span className="mt-1.5 flex items-center gap-2">
              <span className={cn("h-1.5 w-20 shrink-0 overflow-hidden rounded-full sm:w-40", a.track)}>
                <span className={cn("life-fill block h-full w-full rounded-full", a.fill)} style={{ transform: `scaleX(${Math.max(0, Math.min(1, progress))})` }} />
              </span>
              <span className="min-w-0 truncate text-xs font-medium text-white/40" data-testid={testid ? `${testid}-label` : undefined}>{label}</span>
            </span>
          )}
        </span>
        {(xp > 0 || (xpMax !== undefined && (done || current || open))) && <XpPill xp={xp} earned={xp > 0} max={xpMax} />}
        <ChevronDownIcon className={cn("life-chev h-5 w-5 shrink-0", open ? cn("rotate-180", a.text) : "text-white/35")} aria-hidden="true" />
      </button>
      {open && <div className="life-in space-y-2.5 px-3 pb-3">{children}</div>}
    </section>
  );
}

/** RegularSubtaskRow: a 44 px row with a round check. */
export function CheckRow({ label, hint, done, onToggle, accent, xp, testid }: { label: string; hint?: string; done: boolean; onToggle: () => void; accent: Accent; xp?: number; testid?: string }) {
  const a = A[accent];
  return (
    <button type="button" role="checkbox" aria-checked={done} onClick={onToggle} data-testid={testid}
      className={cn("life-check group flex min-h-[44px] w-full touch-manipulation items-center gap-3 rounded-lg border border-white/10 bg-black/15 p-3 text-left hover:bg-white/[0.04] active:bg-white/[0.06]", a.rowHover)}>
      <span className={cn("life-dot grid h-5 w-5 shrink-0 place-items-center rounded-full border-2", done ? a.dot : a.dotOpen)}>
        <svg viewBox="0 0 16 16" className="h-3 w-3 stroke-white" fill="none" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3.5 8.5l3 3 6-7" /></svg>
      </span>
      <span className="min-w-0 flex-1">
        <span className={cn("life-label block break-words text-sm font-medium", done ? "text-white/40 line-through" : cn(a.soft, "group-hover:text-white"))}>{label}</span>
        {hint && <span className="block text-xs text-white/40">{hint}</span>}
      </span>
      {xp !== undefined && xp > 0 && <span className={cn("text-xs font-semibold tabular-nums", a.text)}>+{xp}</span>}
    </button>
  );
}

/** A square check used inside richer controls (push-ups, water, meditation). */
export function Tick({ done, onToggle, accent, label }: { done: boolean; onToggle: () => void; accent: Accent; label: string }) {
  const a = A[accent];
  return (
    <button type="button" role="checkbox" aria-checked={done} aria-label={label} onClick={onToggle} className="life-check grid h-11 w-11 shrink-0 touch-manipulation place-items-center -m-3">
      <span className={cn("life-dot grid h-5 w-5 place-items-center rounded-full border-2", done ? a.dot : a.dotOpen)}>
        <svg viewBox="0 0 16 16" className="h-3 w-3 stroke-white" fill="none" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3.5 8.5l3 3 6-7" /></svg>
      </span>
    </button>
  );
}

export function StepButton({ dir, onClick, disabled, label, accent }: { dir: "up" | "down"; onClick: () => void; disabled?: boolean; label: string; accent: Accent }) {
  const Icon = dir === "up" ? PlusIcon : MinusIcon;
  return (
    <button type="button" aria-label={label} disabled={disabled} onClick={onClick}
      className={cn("grid h-10 w-10 shrink-0 place-items-center rounded-lg border border-white/10 bg-black/15 hover:bg-white/[0.06] disabled:opacity-40", A[accent].text, "hover:border-white/25")}>
      <Icon className="h-4 w-4" aria-hidden="true" />
    </button>
  );
}

/** PushupControl / QuantifiableSubtask: a big number between − and +. */
export function Stepper({ value, unit, step, onChange, accent, min = 0, testid }: { value: number; unit: string; step: number; onChange: (n: number) => void; accent: Accent; min?: number; testid?: string }) {
  const a = A[accent];
  return (
    <div className="flex items-center gap-2" data-testid={testid}>
      <StepButton dir="down" label={`minus ${step}`} disabled={value <= min} onClick={() => onChange(Math.max(min, round(value - step)))} accent={accent} />
      <div className="min-w-[68px] text-center">
        <div className={cn("text-2xl font-black tabular-nums leading-none", a.strong)}>{fmt(value)}</div>
        <div className={cn("mt-0.5 text-xs", a.faint)}>{unit}</div>
      </div>
      <StepButton dir="up" label={`plus ${step}`} onClick={() => onChange(round(value + step))} accent={accent} />
    </div>
  );
}
const round = (n: number) => Math.round(n * 100) / 100;
export const fmt = (n: number) => (Number.isInteger(n) ? n.toLocaleString("en-GB") : n.toLocaleString("en-GB", { maximumFractionDigits: 1 }));

/** The control box used inside step cards (rounded, darker). */
export function Box({ children, done, accent, className }: { children: ReactNode; done?: boolean; accent: Accent; className?: string }) {
  return <div className={cn("rounded-lg border bg-black/15 p-3", done ? A[accent].tile.split(" ")[0] : "border-white/10", className)}>{children}</div>;
}

/** WaterControl's preset grid, generalised. */
export function Presets<T extends string | number>({ options, value, onPick, accent, label }: { options: { v: T; label: string }[]; value: T | undefined; onPick: (v: T) => void; accent: Accent; label: string }) {
  const a = A[accent];
  return (
    <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }} role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button key={String(o.v)} type="button" role="radio" aria-checked={value === o.v} onClick={() => onPick(o.v)}
          className={cn("h-9 rounded-lg border text-xs font-semibold", value === o.v ? a.sel : "border-white/10 bg-black/15 text-white/60 hover:border-white/25 hover:bg-white/[0.05] hover:text-white/90")}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** A text field that commits on blur (and on Enter for one line); keeps his draft while he types. */
export function TextField({ value, onCommit, placeholder, lines = 1, accent, label, testid, maxLength = 1000 }: { value: string; onCommit: (s: string) => void; placeholder?: string; lines?: number; accent: Accent; label: string; testid?: string; maxLength?: number }) {
  const [draft, setDraft] = useState(value);
  const focused = useRef(false);
  const area = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { if (!focused.current) setDraft(value); }, [value]);
  // A long note grows to show itself (measured once per change, never per frame), up to the CSS max height.
  useLayoutEffect(() => { const el = area.current; if (!el) return; el.style.height = "auto"; el.style.height = `${el.scrollHeight + 2}px`; }, [draft]);
  const cls = cn("w-full rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm text-white/90 outline-none placeholder:text-white/25 focus:border-white/25 focus-visible:ring-2", A[accent].ring);
  const common = {
    value: draft, placeholder, maxLength, "aria-label": label, "data-testid": testid,
    onFocus: () => { focused.current = true; },
    onBlur: () => { focused.current = false; if (draft !== value) onCommit(draft); },
  };
  return lines > 1
    ? <textarea {...common} ref={area} rows={lines} className={cn(cls, "max-h-[28rem] resize-none leading-relaxed")} onChange={(e) => setDraft(e.target.value)} />
    : <input {...common} className={cls} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => e.key === "Enter" && (e.currentTarget as HTMLInputElement).blur()} />;
}

/** One cell of a joined stat strip (checkout's 3-up strip, the XP bar). */
export function Stat({ label, value, sub, meter, accent = "orange", testid }: { label: string; value: ReactNode; sub?: ReactNode; meter?: number; accent?: Accent; testid?: string }) {
  return (
    <div className="min-w-0 rounded-xl bg-black/20 px-3 py-2.5" data-testid={testid}>
      <div className="text-[10px] font-semibold uppercase tracking-wide text-white/40">{label}</div>
      <div className="mt-0.5 truncate text-lg font-semibold tabular-nums text-white">{value}</div>
      {meter !== undefined && (
        <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-white/10"><div className={cn("life-fill h-full w-full rounded-full", A[accent].fill)} style={{ transform: `scaleX(${Math.max(0, Math.min(100, meter)) / 100})` }} /></div>
      )}
      {sub && <div className="mt-1 truncate text-[11px] text-white/45">{sub}</div>}
    </div>
  );
}

export function Panel({ title, icon: Icon, accent, right, children, className, testid }: { title: string; icon?: LucideIcon; accent: Accent; right?: ReactNode; children: ReactNode; className?: string; testid?: string }) {
  return (
    <section className={cn("rounded-2xl border border-white/10 bg-white/[0.035] p-3", className)} aria-label={title} data-testid={testid}>
      <header className="mb-2.5 flex items-center gap-2">
        {Icon && <Icon className={cn("h-4 w-4", A[accent].text)} aria-hidden="true" />}
        <h2 className="text-sm font-semibold text-white/85">{title}</h2>
        <span className="flex-1" />
        {right}
      </header>
      {children}
    </section>
  );
}

export function Quiet({ children }: { children: ReactNode }) {
  return <p className="px-1 py-2 text-sm text-white/45">{children}</p>;
}
