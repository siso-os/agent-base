import { isDone, isNow, isParked, priorityRank } from "./a0-tasks";
import type { TaskSummary } from "../components/widgets/TasksWidget";

/**
 * The Tasks page as an Oh My Pi todo (t-0336; Shaan 4 Oct: "three main stages ... inside there there's like a b c d e ...
 * they tick as they go through"; 5 Oct: "we keep specking it out but it just doesn't ever get done"). The board has no
 * hand-made phases, so the phases come from where each task is: his turn, being built, up next, ideas. A task ticks
 * (struck through) in the phase it just left: rated good today in Your turn, gone live today in Building.
 */
export type PlanMark = "done" | "current" | "todo";
export type PlanStep = { t: TaskSummary; mark: PlanMark };
export type PlanKey = "turn" | "building" | "next" | "ideas";
export type PlanPhase = { key: PlanKey; name: string; steps: PlanStep[]; done: number; total: number };

const DAY = 24 * 3600e3;
const BUILDING = new Set(["building", "built", "tested", "rework"]);
const NEXT = new Set(["specced", "allocated"]);

/** Waiting on him: landed and waiting for his look, or a task that names him as the next step. Parked never is. */
export const yourTurn = (t: TaskSummary) => !isDone(t) && !isParked(t) && (t.stage === "preview" || t.stage === "feedback" || !!t.needs);
const within = (iso: string | null | undefined, now: number) => !!iso && now - Date.parse(iso) >= 0 && now - Date.parse(iso) < DAY;

export function planPhases(all: TaskSummary[], onIt: (t: TaskSummary) => boolean, now = Date.now()): PlanPhase[] {
  const open = all.filter((t) => !isDone(t));
  const turn = open.filter(yourTurn);
  const building = open.filter((t) => !yourTurn(t) && (BUILDING.has(t.stage) || isNow(t) || onIt(t)));
  const taken = new Set([...turn, ...building]);
  const next = open.filter((t) => !taken.has(t) && !isParked(t) && (NEXT.has(t.stage) || priorityRank(t.priority) <= 1));
  const ideas = open.filter((t) => !taken.has(t) && !next.includes(t));
  const order = (a: TaskSummary, b: TaskSummary) => priorityRank(a.priority) - priorityRank(b.priority) || b.updated.localeCompare(a.updated);
  const phase = (key: PlanKey, name: string, ticked: TaskSummary[], todo: TaskSummary[]): PlanPhase => {
    const steps: PlanStep[] = [
      ...[...ticked].sort((a, b) => (a.live_at ?? a.updated).localeCompare(b.live_at ?? b.updated)).map((t) => ({ t, mark: "done" as const })),
      ...[...todo].sort((a, b) => Number(onIt(b) || isNow(b)) - Number(onIt(a) || isNow(a)) || order(a, b)).map((t) => ({ t, mark: onIt(t) || isNow(t) ? ("current" as const) : ("todo" as const) })),
    ];
    return { key, name, steps, done: ticked.length, total: steps.length };
  };
  return [
    phase("turn", "Your turn", all.filter((t) => t.stage === "happy" && within(t.updated, now)), turn),
    phase("building", "Building", all.filter((t) => (t.stage === "live" || t.stage === "integrated") && within(t.live_at ?? t.updated, now)), building),
    phase("next", "Up next", [], next),
    phase("ideas", "Ideas", [], ideas),
  ];
}

/** His turn as a verb: "Shaan tries the browser tab" → "Try the browser tab"; "" when the task names no step for him. */
export function turnAction(t: TaskSummary): string {
  const next = (t.next ?? "").replace(/^\s*(NOW|NEXT):\s*/i, "").trim();
  const m = next.match(/^shaan\s+(\w+)\s+(.+)$/i);
  if (m) {
    const v = m[1].toLowerCase(), base = v === "tries" ? "try" : v.endsWith("es") && /(sh|ch|ss|x)es$/.test(v) ? v.slice(0, -2) : v.endsWith("s") ? v.slice(0, -1) : v;
    return `${base[0].toUpperCase()}${base.slice(1)} ${m[2]}`;
  }
  return /^shaan\b/i.test(next) ? next : "";
}

/** Letters past z go aa, ab, … as in Oh My Pi. */
export const stepLetter = (i: number): string => (i < 26 ? String.fromCharCode(97 + i) : stepLetter(Math.floor(i / 26) - 1) + String.fromCharCode(97 + (i % 26)));
