import { useEffect, useRef, useState } from "react";
import type { Research, ResearchSelection } from "../../../../services/node/src/research";
import { clock, usePageVisible } from "../lib/poll";
import { runningResearch } from "../lib/delight";
import { usageAge } from "../lib/usage-age";
import type { Agent } from "../lib/agents";
import "./ZeroOrbit.css";

/** One open need around Agent Zero's face: a task waiting on him, or an agent herdr says needs him. */
export type Need = { key: string; label: string; onOpen: () => void };

const tone = (p: number) => (p >= 95 ? "is-bad is-pulse" : p >= 80 ? "is-bad" : "is-warn");
const left = (at: number | null) => {
  if (!at) return "";
  const m = Math.max(0, Math.round((at - Date.now()) / 60000)), h = Math.floor(m / 60);
  return h >= 24 ? ` (resets in ${Math.floor(h / 24)}d ${h % 24}h)` : ` (resets in ${h}h${String(m % 60).padStart(2, "0")})`;
};

/**
 * Around Agent Zero's face, bottom right (SPEC-DELIGHT §2; Shaan 3 Oct 01:00: "the agent number two is quite cool"):
 * - one amber dot per open need on a ring that turns once per 14 s (only while there is one, and paused while the face
 *   dozes); a new need pops in; hover names it, click opens it; more than 5 shows "5+";
 * - the limit arc: filled to the higher of the 5-hour and weekly limits, hidden under 60%, amber to 79%, red from 80%,
 *   pulsing from 95% (the HUD's own thresholds);
 * - while he talks to Agent Zero (the mic or ⌘⇧Space) the dots dim and stop (ZeroOrbit.css reads the mic's own phase).
 * Reduced motion: no turning, no pop, no pulse; the dots and the arc still show.
 * `size` is the face's (60 px): the arc sits just outside its rim, the dots on the spec's ring (0.62 × size + 4).
 */
export function ZeroOrbit({ zero, needs, size = 60, research, researchError, onOpenResearch }: { zero: Agent; needs: Need[]; size?: number; research?: Research | null; researchError?: string | null; onOpenResearch?: (selection: ResearchSelection) => void }) {
  const visible = usePageVisible(), root = useRef<HTMLDivElement>(null);
  const [intersecting, setIntersecting] = useState(true), [now, setNow] = useState(Date.now());
  useEffect(() => clock(() => setNow(Date.now())), []);
  const batches = runningResearch(research, researchError, Math.max(now, Date.now()));
  const hasContent = needs.length > 0 || batches.fleets.length > 0 || research !== undefined || researchError !== undefined || Math.max(zero.hud?.fiveHour?.pct ?? 0, zero.hud?.week?.pct ?? 0) >= 60;
  useEffect(() => {
    if (!root.current) return;
    const observer = new IntersectionObserver(([entry]) => setIntersecting(entry.isIntersecting));
    observer.observe(root.current); return () => observer.disconnect();
  }, [hasContent]);
  const ARC_R = Math.round(size * 0.58), DOT_R = Math.round(size * 0.62 + 4);
  const five = zero.hud?.fiveHour ?? null, week = zero.hud?.week ?? null;
  const pct = Math.max(five?.pct ?? 0, week?.pct ?? 0);
  const arc = pct >= 60;
  if (!hasContent) return null;
  const tip = [usageAge(zero.hud), needs.length ? `${needs.length} need${needs.length === 1 ? "s" : ""} you` : null, five ? `5h ${five.pct}%${left(five.resetsAt)}` : null, week ? `wk ${week.pct}%${left(week.resetsAt)}` : null].filter(Boolean).join(" · ");
  const shown = needs.slice(0, 5);
  const batchTip = batches.unavailable ? "Research status unavailable" : `${batches.fleets.length} running research ${batches.fleets.length === 1 ? "batch" : "batches"}`;
  const c = 2 * Math.PI * ARC_R, box = 2 * (DOT_R + 6), mid = box / 2;
  return (
    <div ref={root} className="ab-zorbit" data-paused={!visible || !intersecting ? "1" : "0"} data-testid="zero-orbit" style={{ width: box, height: box }} title={tip}>
      {arc && (
        <svg className={`ab-zorbit__arc ${tone(pct)}`} width={box} height={box} viewBox={`0 0 ${box} ${box}`} data-testid="zero-limit-arc" data-pct={pct} aria-label={tip} role="img">
          <circle cx={mid} cy={mid} r={ARC_R} className="ab-zorbit__track" />
          <circle cx={mid} cy={mid} r={ARC_R} className="ab-zorbit__fill" strokeDasharray={`${(c * Math.min(pct, 100)) / 100} ${c}`} transform={`rotate(-90 ${mid} ${mid})`} />
        </svg>
      )}
      {(batches.fleets.length > 0 || ((research !== undefined || researchError) && batches.unavailable)) && <div className="ab-zorbit__research" data-testid="zero-research-orbit" data-running={batches.fleets.length > 0 ? "1" : "0"}>
        {(batches.fleets.length ? batches.fleets.slice(0,3) : [null]).map((fleet, i) => <button key={fleet ? `${fleet.machine}:${fleet.name}` : 'unknown'} type="button" className={`ab-zorbit__batch${!fleet ? ' is-unknown' : ''}`} style={{left: mid + (DOT_R-10)*Math.cos(i*2*Math.PI/3), top: mid + (DOT_R-10)*Math.sin(i*2*Math.PI/3)}} disabled={!fleet || !onOpenResearch} title={fleet ? `${fleet.name} · ${batchTip}` : batchTip} aria-label={fleet ? `Open running research batch ${fleet.name}` : batchTip} onClick={() => fleet && onOpenResearch?.({fleet:fleet.name})}>{fleet ? '↗' : '?'}</button>)}
      </div>}
      {shown.length > 0 && (
        <div className="ab-zorbit__ring" data-testid="zero-orbit-ring">
          {shown.map((n, i) => {
            const a = (i / shown.length) * 2 * Math.PI - Math.PI / 2;
            const more = i === 4 && needs.length > 5;
            return (
              <button key={n.key} type="button" className={`ab-zorbit__dot${more ? " is-more" : ""}`} data-testid="zero-need" style={{ left: mid + DOT_R * Math.cos(a), top: mid + DOT_R * Math.sin(a) }} title={more ? `${needs.length} need you` : n.label} aria-label={more ? `${needs.length} need you` : n.label} onClick={n.onOpen}>
                {more ? "5+" : null}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
