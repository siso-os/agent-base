// uihub: siso:stat-tile — existing LifeLock counter controls.
import { HeartPulseIcon } from "lucide-react";
import { cn } from "@siso/shell";
import { Panel, Stepper, ThinBar } from "./ui";
import { add, useDay, type Config } from "./store";
export function Health({ day, dep, cfg }: { day: string; dep: number; cfg: Config }) {
  const { state: s } = useDay(day, dep);
  return <Panel title="Health throughout the day" icon={HeartPulseIcon} accent="emerald" testid="life-health">
    <div className="divide-y divide-white/5">{cfg.counters.map(c => {
      const value = s.counters[c.key] ?? 0, slip = c.good === "down" && value > (c.goal ?? 0);
      // One row shape for every counter: the label takes what is left, the stepper never wraps under it.
      return <div key={c.key} className="space-y-2 py-2.5" data-testid={`life-counter-${c.key}`}>
        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
          <div className="min-w-0"><h3 className={cn("truncate text-sm font-medium", slip ? "text-amber-200" : "text-white/85")}>{c.label}</h3><p className="truncate text-xs text-white/40">{c.goal ? `Daily target ${c.goal.toLocaleString()} ${c.unit}` : c.good === "down" ? "Log honestly; every day is a fresh start" : "Small actions add up"}</p></div>
          <Stepper value={value} step={c.inc} unit={c.unit || " "} accent="emerald" onChange={n => add(day, c.key, n - value)} />
        </div>
        {!!c.goal && <ThinBar pct={100 * value / c.goal} accent="emerald" />}
      </div>;
    })}</div>
  </Panel>;
}
