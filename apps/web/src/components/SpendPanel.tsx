import { useMemo } from "react";
import { ArrowUpRight, ChevronDown, Coins, X } from "lucide-react";
import { localDay, todayUsd } from "../lib/spend";
import "./SpendPanel.css";

export type SpendCredits = [number, number];
export type SpendAgent = { agent: string; claude_usd_equiv: number; codex_credits: SpendCredits; steps: number; finished: number; items: Record<string, number> };
export type SpendOwner = { owner: string; claude_usd_equiv: number; codex_credits: SpendCredits; finished: number; agents: SpendAgent[] };
export type SpendProject = { project: string; claude_usd_equiv: number; codex_credits: SpendCredits; finished: number; owners: SpendOwner[] };
export type SpendPlanItem = { id: string; title: string; plan: string | null; claude_usd_equiv: number; codex_credits: SpendCredits; steps: number; finished: boolean };
export type SpendData = { day: string; claude_usd_equiv: number; codex_credits: SpendCredits; attributed_to_plan_items: number; projects: SpendProject[]; plan_items: SpendPlanItem[]; note?: string };
export type SpendResponse = ({ source: "pending" } | { source: "stack-opt"; data: SpendData }) & {
  attribution?: { source: "stack-opt"; scope: "report-day"; state: "fresh" | "stale" | "unavailable"; observedAt: number | null; attemptedAt: number; day: string | null; reason: "unavailable" | "timeout" | "malformed" | "schema" | "day-mismatch" | "transport" | null };
  today?: { usd: number; from: "tokens"; day?: string; observedAt?: number };
};

const number = new Intl.NumberFormat("en", { maximumFractionDigits: 1 });
export const formatSpendCredits = (value: SpendCredits) => value[0] === 0 && value[1] === 0 ? "—" : `${number.format(value[0])}–${number.format(value[1])}`;
export const spendShare = (value: number, total: number) => total > 0 ? `${Math.round(value / total * 100)}%` : "0%";
export const topSpendProject = (data: SpendData) => data.projects.reduce<SpendProject | null>((top, project) => !top || project.claude_usd_equiv > top.claude_usd_equiv ? project : top, null);
export const topSpendOwner = (project: SpendProject | null) => project?.owners.reduce<SpendOwner | null>((top, owner) => !top || owner.claude_usd_equiv > top.claude_usd_equiv ? owner : top, null) ?? null;
const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });
/** "Sat 3 Oct" from the meter's YYYY-MM-DD. */
const dayLabel = (day: string) => new Date(`${day}T12:00:00`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
const creditsWithUnit = (value: SpendCredits) => {
  const range = formatSpendCredits(value);
  return range === "—" ? range : `${range} credits`;
};

type Props = { spend: SpendResponse | null; open: boolean; onClose: () => void };
export function SpendPanel({ spend, open, onClose }: Props) {
  const data = spend?.source === "stack-opt" ? spend.data : null;
  const planItems = useMemo(() => new Map(data?.plan_items.map((item) => [item.id, item]) ?? []), [data]);
  const project = data ? topSpendProject(data) : null;
  const owner = topSpendOwner(project);
  const freshness = spend?.attribution;
  const stale = Boolean(data && (!freshness || freshness.state !== "fresh" || data.day !== localDay()));
  const stamp = (at: number | null | undefined) => at == null ? "unknown" : new Date(at).toLocaleString("en-GB");
  if (!open) return null;

  return <aside className="spend-panel" aria-label="Today's spend" role="dialog" aria-modal="false" onKeyDown={e => { if (e.key === "Escape") { e.stopPropagation(); onClose(); } }}>
    <header className="spend-panel__header">
      <div className="spend-panel__heading"><span className="spend-panel__icon"><Coins size={16} /></span><div><h2>Today’s spend</h2><p>Tokens scan · local day {localDay()}</p></div></div>
      <button className="spend-panel__close" type="button" aria-label="Close spend panel" onClick={onClose}><X size={16} /></button>
    </header>
    <div className="spend-panel__total" data-testid="spend-total"><b>{todayUsd(spend) ?? "—"}</b><span>Claude, at API prices · {todayUsd(spend) ? `read ${stamp(spend?.today?.observedAt)}` : "today’s Tokens total unavailable"}</span></div>
    <div className="spend-panel__freshness" role="status" data-state={!spend ? "loading" : !data ? "unavailable" : stale ? "stale" : "fresh"}>
      <strong>{!spend ? "Loading attribution…" : !data ? "Attribution unavailable" : stale ? "Stale attribution · last successful report" : "Attribution refreshed"}</strong>
      <span>STACK-OPT · {data ? `report day ${data.day} (${dayLabel(data.day)})` : "report day unknown"}</span>
      <span>Last successful read: {stamp(freshness?.observedAt)} · Last attempt: {stamp(freshness?.attemptedAt)}</span>
      {freshness?.reason && <span>{freshness.reason === "day-mismatch" ? "The report is for a different day." : `Refresh failed (${freshness.reason}).`}</span>}
    </div>
    {!data ? <div className="spend-panel__pending">{!spend ? "Waiting for the first report." : "No successful attribution report is available."}</div> : <>
      <div className="spend-panel__basis">Shares below use the {data.day} STACK-OPT report total ({usd.format(data.claude_usd_equiv)}).</div>
      <div className="spend-panel__summary">
        <div><span>Most went to</span><strong>{project?.project ?? "No project attribution"}</strong><small>{project ? `${spendShare(project.claude_usd_equiv, data.claude_usd_equiv)} of Claude spend` : "No project totals reported"}</small><small>{owner ? `Top owner · ${owner.owner}` : "No owner attribution"}</small></div>
        <div><span>Codex credits</span><strong className={formatSpendCredits(data.codex_credits) === "—" ? "is-muted" : undefined}>{formatSpendCredits(data.codex_credits)}</strong><small>reported range</small></div>
      </div>
      <div className="spend-panel__attribution"><span>Attributed to plan items</span><b>{Math.round(data.attributed_to_plan_items * 100)}%</b></div>
      <div className="spend-panel__section-title"><span>By project and owner</span><span>Claude share · Codex credits</span></div>
      <div className="spend-panel__projects">
        {data.projects.length === 0 && <div className="spend-panel__pending">No project attribution in this report.</div>}
        {data.projects.map((project) => <details className="spend-panel__project" key={project.project}>
          <summary><ChevronDown size={14} /><b>{project.project}</b><span>{spendShare(project.claude_usd_equiv, data.claude_usd_equiv)}</span><small>{creditsWithUnit(project.codex_credits)}</small></summary>
          {project.owners.map((owner) => <details className="spend-panel__owner" key={owner.owner}>
            <summary><ChevronDown size={13} /><b>{owner.owner}</b><span>{spendShare(owner.claude_usd_equiv, data.claude_usd_equiv)}</span><small>{formatSpendCredits(owner.codex_credits)}</small></summary>
            {owner.agents.map((agent) => <details className="spend-panel__agent" key={agent.agent}>
              <summary><ChevronDown size={12} /><b>{agent.agent}</b><span>{spendShare(agent.claude_usd_equiv, data.claude_usd_equiv)}</span><small>{formatSpendCredits(agent.codex_credits)}</small></summary>
              <div className="spend-panel__items">
                {Object.entries(agent.items).map(([id, steps]) => {
                  const item = planItems.get(id);
                  return <div className="spend-panel__item" key={id}>
                    <span className="spend-panel__item-title">{item?.title || (id === "unattributed" ? "Unattributed" : `Plan item ${id}`)}</span>
                    <span>{item ? spendShare(item.claude_usd_equiv, data.claude_usd_equiv) : "—"}</span><small>{number.format(steps)} steps</small>
                    {item && <span className="spend-panel__item-link" title={item.plan ?? undefined}><ArrowUpRight size={12} />{item.id}</span>}
                  </div>;
                })}
              </div>
            </details>)}
          </details>)}
        </details>)}
      </div>
    </>}
  </aside>;
}
