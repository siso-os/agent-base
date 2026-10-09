import { ArrowUpRight, ArrowRight, Coins, ListChecks, Network, SlidersHorizontal } from "lucide-react";
import { useState } from "react";
import type { Agent, Org, Stats } from "../../lib/agents";
import { isDone, isNow, isParked, taskRoots, tasksOf, useA0Tasks } from "../../lib/a0-tasks";
import { useSpend, todayUsd, todayReport, localDay } from "../../lib/spend";
import { AgentFace, faceFor } from "../../lib/face";
import { panelTeam, flattenPanelTeam } from "../../lib/panel-team";
import { SpendPanel, formatSpendCredits } from "../SpendPanel";
import { StatsCard } from "./StatsCard";
import { WorkingBrief } from "./WorkingBrief";
import type { PanelTab } from "./PanelTabs";
import "./AgentCompanion.css";

export function AgentOverview({ a, agents, org, stats, onPick, onStanding }: {
  a: Agent; agents: Agent[]; org: Org | null; stats: Stats | null; onPick: (tab: PanelTab) => void; onStanding?: () => void;
}) {
  const { index, failed } = useA0Tasks();
  const spend = useSpend();
  const [tools, setTools] = useState(false);
  const scoped = tasksOf(index?.tasks ?? [], a.name, !!a.zero);
  const active = scoped.filter(t => !isDone(t) && !isParked(t));
  const open = taskRoots(active);
  const review = open.filter(t => t.needs || t.stage === "preview" || t.stage === "feedback");
  const focus = active.find(isNow) ?? open.find(t => t.stage === "building" || t.stage === "rework");
  const focusLine = focus?.next?.replace(/^\s*NOW:\s*/i, "") || focus?.title;
  const team = flattenPanelTeam(panelTeam(a, agents, org));
  const working = team.filter(n => n.state === "working");
  const needs = team.filter(n => n.state === "needs" || n.state === "failed");
  const money = todayUsd(spend);
  const report = todayReport(spend);
  const owners = team.filter(n => n.owner);
  const when = index ? new Date(index.updated) : null;
  const stamp = when && Number.isFinite(when.valueOf()) ? when.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : null;
  return <section className="ac-overview" data-testid="companion-overview">
    <WorkingBrief agentName={a.name} />
    <header className="ac-overview-head"><div><span className="ac-eyebrow">AT A GLANCE</span><h2>What’s moving</h2></div><button className="ac-icon-button" type="button" onClick={() => onPick("stats")} title="Open Stats" aria-label="Open Stats"><SlidersHorizontal size={16} /></button></header>
    <button type="button" className="ac-focus" onClick={() => onPick("tasks")}>
      <span className="ac-eyebrow"><i className={focus ? "is-working" : ""} />{focus ? "CURRENT STEP" : "CURRENT FOCUS"}<ArrowUpRight size={13} /></span>
      <strong>{focusLine || (failed ? "Tasks are unavailable" : index ? "No current step recorded" : "Reading current work…")}</strong>
      <span className="ac-focus-meta">{focus ? <><span>{focus.owner || "Unassigned"}</span><span>{focus.stage}</span></> : <span>{index ? "The agent’s task board sets this focus." : "Waiting for the task board"}</span>}{stamp && <time>Updated {stamp}</time>}</span>
    </button>
    {index && failed && <p className="ac-note" role="status">Task refresh unavailable; showing the last successful task list.</p>}
    <div className="ac-overview-grid">
      <button type="button" className="ac-summary-tile" onClick={() => onPick("tasks")}><ListChecks size={16} /><span>Tasks</span><strong>{index ? open.length : "—"}<small> open</small></strong><p>{index ? `${review.length} ready for your attention` : failed ? "Task source unavailable" : "Reading task board"}</p></button>
      <button type="button" className="ac-summary-tile" onClick={() => onPick("subagents")}><Network size={16} /><span>Team</span><strong>{working.length}<small> working</small></strong><p>{needs.length ? `${needs.length} need attention` : `${owners.length} owners · current sessions`}</p></button>
    </div>
    <button type="button" className="ac-spend" onClick={() => onPick("spend")} data-testid="companion-spend"><span className="ac-spend-icon"><Coins size={19} /></span><span className="ac-spend-copy"><strong>{a.zero ? "Today’s spend" : "Fleet spend today"}</strong><small>All agents · Claude at API prices</small><small>{spend?.today?.day === localDay() && money ? `Read ${new Date(spend.today.observedAt!).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : spend ? "Current total unavailable" : "Reading spend…"}</small></span><span className="ac-spend-value"><b>{money ?? "—"}</b><small>{report ? `${formatSpendCredits(report.codex_credits)} Codex credits` : "Codex attribution unavailable"}</small></span></button>
    <button type="button" className="ac-team-peek" onClick={() => onPick("subagents")}><span className="ac-eyebrow">OWNERS & WORKERS <ArrowRight size={13} /></span><span className="ac-owner-faces">{owners.slice(0, 7).map(n => <span key={n.id} title={`${n.name} · ${n.state}`}><AgentFace {...faceFor(n.agent ?? { name: n.name, project: n.group, status: "idle" })} status={n.agent ? faceFor(n.agent).status : "offline"} size={30} /></span>)}{owners.length > 7 && <small>+{owners.length - 7}</small>}</span><small>{org || !a.zero ? "See who owns the work and what their team is doing" : "Owner registry unavailable · see connected sessions"}</small></button>
    <StatsCard a={a} stats={stats} onOpen={() => onPick("stats")} />
    <div className="ac-overview-footer"><button type="button" className="ac-text-action" onClick={() => onPick("timeline")}>Activity & delivery pipeline <ArrowRight size={12} /></button><button type="button" className="ac-text-action" aria-expanded={tools} onClick={() => setTools(!tools)}>More</button></div>
    {tools && <div className="ac-secondary-tools" aria-label="Additional agent tools"><button type="button" onClick={() => onPick("changes")}>Changes <small>Files changed in this session</small></button>{a.zero && <><button type="button" onClick={() => onPick("board")}>Your board <small>Notes, ideas and to-dos</small></button><button type="button" onClick={() => onPick("widgets")}>Widgets <small>Agent-published panels</small></button></>}{onStanding && <button type="button" onClick={onStanding}>Where things stand <small>Full workspace dashboard</small></button>}</div>}
  </section>;
}

/** The dashboard keeps the existing spend reader and attribution semantics. */
export function AgentSpendDetail({ onBack }: { onBack: () => void }) {
  const spend = useSpend();
  return <div className="ac-spend-detail"><SpendPanel spend={spend} open onClose={onBack} /></div>;
}
