import { useEffect, useState, type CSSProperties } from "react";
import { HaloRim } from "@siso/shell";
import { ActivityIcon, CircleDollarSignIcon, ClipboardCheckIcon, CpuIcon, LayoutGridIcon, ServerIcon, WorkflowIcon } from "lucide-react";
import { type Agent, type Org, compact } from "../lib/agents";
import { AgentFace, accentRgb, faceFor } from "../lib/face";
import { canonName, needWhat, needsYou, ownerNames, useA0Tasks } from "../lib/a0-tasks";
import { useSharedResult } from "../lib/poll";
import { isOpenTask, sortTasks, type TaskSummary } from "./widgets/TasksWidget";
import { HubPage, Widget, WidgetGrid } from "./page/HubPage";
import { Ring } from "./page/Figures";
import type { TopPage } from "./TopNav";
import type { Tokens } from "./TokensSpace";
import "./DashboardPage.css";

type Machine = { key: string; name: string; here?: boolean; health: { level: string; at: number | null; source?: string; cpus: number | null; load: number[] | null; why?: string[] } };
type Servers = { servers: Machine[] };
type WindowUsage = { used_pct: number | null; resets_at?: number | string | null; stale?: boolean };
type Usage = { source: string; data?: { claude: { login: string; five_hour: WindowUsage; seven_day: WindowUsage }[] } };
type Mini = { enabled: boolean; reachable: boolean; note: string | null; lanes: { running: boolean }[] };
type Crew = { rows: { id: string; kind: string; running: boolean }[] };
type Need = { key: string; name: string; project?: string | null; agent?: Agent; task?: TaskSummary; what: string };

const FLOW = [
  { id: "thought", title: "Thought", stages: ["thought"] },
  { id: "specced", title: "Specced", stages: ["specced", "allocated"] },
  { id: "building", title: "Building", stages: ["building", "rework"] },
  { id: "built", title: "Built", stages: ["built", "tested"] },
  { id: "preview", title: "Preview", stages: ["preview", "feedback"] },
  { id: "live", title: "Live today", stages: ["live", "integrated", "happy"] },
];
const clock = (at: number | null | undefined) => at ? new Date(at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }) : "time unknown";
const reset = (at: number | string | null | undefined) => {
  if (!at) return "Reset time unavailable";
  const ms = typeof at === "number" ? at * 1000 : Date.parse(at);
  if (!Number.isFinite(ms)) return "Reset time unavailable";
  return `Resets ${new Date(ms).toLocaleString("en-GB", { weekday: "short", hour: "2-digit", minute: "2-digit" })}`;
};
const usd = (n: number) => `$${n.toFixed(2)}`;
const sameDay = (at: string | null | undefined) => !!at && new Date(at).toDateString() === new Date().toDateString();
const ownerOf = (task: TaskSummary, agents: Agent[]) => agents.find(a => ownerNames(task.agent || task.owner).map(canonName).includes(canonName(a.name)));
const taskFace = (task: TaskSummary, agents: Agent[]) => {
  const agent = ownerOf(task, agents);
  return agent ? faceFor(agent) : { name: task.agent || task.owner || "Unassigned", project: task.project, status: needsYou(task) ? "needs-shaan" as const : task.stage === "building" || task.stage === "rework" ? "working" as const : "waiting" as const };
};

/** One scan of attention, work and capacity. Sources are shared with the pages that own their detail. */
export function DashboardPage({ org, orgDown, agents, onOpen, onOpenAgent, onTasks }: {
  org: Org | null; orgDown?: boolean; agents: Agent[]; onOpen: (page: TopPage) => void;
  onOpenAgent?: (agent: Agent) => void;
  onTasks?: (focus: { stages?: string[]; id?: string; needs?: boolean }) => void;
}) {
  const { index, failed: tasksFailed } = useA0Tasks();
  const stats = useSharedResult<Tokens>("/api/tokens", 60_000);
  const servers = useSharedResult<Servers>("/api/servers?view=1", 30_000);
  const usage = useSharedResult<Usage>("/api/usage", 60_000);
  const mini = useSharedResult<Mini>("/api/mini/lanes", 30_000);
  const zero = agents.find(a => a.zero);
  const crew = useSharedResult<Crew>(zero ? `/api/agents/${encodeURIComponent(zero.id)}/subagents` : null, 5_000);
  const [slow, setSlow] = useState(false);
  const [serversFailedAt, setServersFailedAt] = useState<number | null>(null);
  useEffect(() => { const timer = window.setTimeout(() => setSlow(true), 12_000); return () => window.clearTimeout(timer); }, []);
  useEffect(() => { setServersFailedAt(old => servers.error ? old ?? Date.now() : null); }, [servers.error]);
  const waiting = (name: string) => slow ? `${name} has not answered this view yet.` : `Reading ${name.toLowerCase()}…`;
  const all = index?.tasks ?? [];
  const openTasks = sortTasks(all.filter(isOpenTask));
  const taskNeeds = openTasks.filter(needsYou);
  const running = agents.filter(a => a.status === "working");
  const needs: Need[] = agents.filter(a => a.status === "needs").map(agent => {
    const task = taskNeeds.find(t => ownerOf(t, agents)?.id === agent.id);
    return { key: agent.id, name: agent.name, project: agent.project, agent, task, what: task ? needWhat(task.next) : agent.title || "Waiting for your reply" };
  });
  for (const task of taskNeeds) {
    const agent = ownerOf(task, agents), name = agent?.name || task.agent || task.owner || "Unassigned";
    const key = agent?.id || (task.agent || task.owner ? canonName(name) : task.id);
    if (!needs.some(n => n.key === key)) needs.push({ key, name, project: task.project, agent, task, what: needWhat(task.next) });
  }
  const openTask = (focus: { stages?: string[]; id?: string; needs?: boolean } = {}) => onTasks ? onTasks(focus) : onOpen("tasks");
  const openAgent = (a: Agent) => {
    if (onOpenAgent) onOpenAgent(a);
    else if (a.project) window.location.hash = `project/${encodeURIComponent(a.project)}`;
    else onOpen("org");
  };
  const projects = org?.groups.flatMap(g => g.projects.filter(p => p.shown && !p.elsewhere)) ?? [];
  const account = usage.data?.data?.claude?.[0];
  const hud = zero?.hud;
  const five = hud?.fiveHour?.pct ?? account?.five_hour.used_pct ?? null;
  const week = hud?.week?.pct ?? account?.seven_day.used_pct ?? null;
  const laptop = servers.data?.servers.find(s => s.key === "laptop") ?? servers.data?.servers.find(s => s.here);
  const freshLaptop = !servers.error && laptop && laptop.health.source !== "fleet record" && laptop.health.at !== null && Date.now() - laptop.health.at < 120_000;
  const codex = running.filter(a => a.codexWorker).length;
  const claude = crew.data?.rows.filter(r => r.kind === "claude" && r.running).length;
  const totals = stats.data?.overall.today;
  const hourly = stats.data?.hourOfDay ?? [];
  const peak = Math.max(1, ...hourly.map(h => h.total));
  const topSpenders = [...(stats.data?.accounts ?? [])].sort((a,b) => b.today.cost - a.today.cost).slice(0,3);

  return <HubPage id="dashboard" icon={LayoutGridIcon} kicker="Agent Base · operation" title="Dashboard" blurb="Who needs you, what is moving, and room for the next job.">
    <WidgetGrid label="The operation">
      <HaloRim className="dash-now" hue={`rgb(${accentRgb(zero?.project)})`} state="idle">
        <Widget id="dashboard-now" size="XL" icon={ActivityIcon} title="Now" sub="Attention first · the fleet at work">
          <div className="dash-now__grid">
            <div className="dash-needs">
              <button className="dash-count" type="button" onClick={() => needs[0] ? needs[0].agent ? openAgent(needs[0].agent) : openTask({ id: needs[0].task?.id }) : openTask({ needs: true })}><b>{needs.length}</b><span>need you{!index ? " · known" : ""}</span></button>
              <div className="dash-people">{needs.slice(0, 3).map(n => <button type="button" className="dash-person" key={n.key} onClick={() => n.agent ? openAgent(n.agent) : openTask({ id: n.task?.id })}>
                <AgentFace name={n.name} project={n.project ?? undefined} status="needs-shaan" size={32} />
                <span><b>{n.name}</b><small>{n.what}</small></span>
              </button>)}</div>
              {needs.length > 3 && <button type="button" className="dash-more" onClick={() => openTask({ needs:true })}>+{needs.length - 3} more waiting</button>}
              {!needs.length && <p className="dash-note">{!index ? tasksFailed ? "No agent wait reported. Task needs are unavailable." : waiting("Task index") : "Nobody is waiting on you."}</p>}
            </div>
            <div className="dash-running">
              <div className="dash-label"><span>Working now</span><b>{running.length}</b></div>
              <div className="dash-people">{running.slice(0, 3).map(a => <button type="button" className="dash-person" key={a.id} onClick={() => openAgent(a)}>
                <AgentFace {...faceFor(a)} size={28} /><span><b>{a.name}</b><small>{a.title || a.role || "Working · step not reported"}</small></span>
              </button>)}</div>
              {running.length > 3 && <button type="button" className="dash-more" onClick={() => onOpen("org")}>+{running.length - 3} working across the fleet</button>}
              {!running.length && <p className="dash-note">No agents are reporting work.</p>}
            </div>
            <button type="button" className="dash-limits" onClick={() => onOpen("tokens")} aria-label="Open Tokens usage">
              <span className="dash-label">{hud?.fiveHour || hud?.week ? `${zero?.name} · limits` : account?.login || "Usage windows"}</span>
              <Ring pct={five} label="5 hours" size={48} sub={reset(hud?.fiveHour?.resetsAt ?? account?.five_hour.resets_at)} />
              <Ring pct={week} label="This week" size={48} sub={reset(hud?.week?.resetsAt ?? account?.seven_day.resets_at)} />
              {(hud?.limitsStale || account?.five_hour.stale || account?.seven_day.stale) && <small>Last reported limits · stale</small>}
              {five === null && week === null && <small>{usage.error ? "Usage source unavailable" : "No usage windows reported"}</small>}
            </button>
          </div>
        </Widget>
      </HaloRim>
      <Widget id="dashboard-pipeline" size="XL" icon={ClipboardCheckIcon} title="Pipeline" sub="What is coming · what landed" door={{ label:"Open all tasks", onOpen:()=>openTask() }} empty={!index ? tasksFailed ? "Agent Zero's task index is unavailable." : waiting("Task index") : undefined}>
        {index && <><div className="dash-pipeline">{FLOW.map(stage => {
          const tasks = sortTasks(all.filter(t => stage.stages.includes(t.stage) && (stage.id !== "live" || sameDay(t.live_at))));
          const faces = [...new Map(tasks.filter(t => t.agent || t.owner).map(t => [canonName(t.agent || t.owner || ""), t])).values()].slice(0,3);
          return <button type="button" key={stage.id} className={`dash-stage is-${stage.id}`} onClick={() => openTask({ stages:stage.stages })} aria-label={`Open ${stage.title} tasks (${tasks.length})`}>
            <span className="dash-stage__head"><span>{stage.title}</span><b>{tasks.length}</b></span>
            <span className="dash-stage__faces">{faces.map(t => <AgentFace key={t.id} {...taskFace(t,agents)} size={24} />)}</span>
            <span className="dash-stage__titles">{tasks.slice(0,2).map(t => <span key={t.id}>{t.short || t.title}</span>)}{!tasks.length && <small>{stage.id === "live" ? "Nothing live today yet" : "No tasks in this stage"}</small>}</span>
          </button>;
        })}</div><p className="dash-note dash-pipeline__note">Allocated in Specced · Rework in Building · Tested in Built · Feedback in Preview{all.some(t => ["live", "integrated", "happy"].includes(t.stage) && !t.live_at) ? " · Undated live tasks excluded from today" : ""}</p></>}
      </Widget>
      <Widget id="dashboard-org" size="L" icon={WorkflowIcon} title="Org" sub="Projects and the seats that own them" door={{label:"Open the org chart",onOpen:()=>onOpen("org")}} empty={orgDown ? "Org source unavailable. Last known seats stay visible below." : !org ? waiting("Org") : !projects.length ? "Projects and their owner seats will appear here when registered." : undefined}>
        {!!projects.length && <div className="dash-org">{orgDown && <p className="dash-note">Org source unavailable · last known seats</p>}{org?.groups.map(g => <div key={g.id} className="dash-org__group"><h4>{g.name}</h4><div className="dash-projects">{projects.filter(p=>p.group===g.id).map(p => {
          const waitingHere = needs.some(n => n.project?.toLowerCase() === p.name.toLowerCase() || p.owners.some(o => canonName(o.name) === canonName(n.name)));
          return <a href={`#project/${encodeURIComponent(p.id)}`} key={p.id} className={`dash-project${waitingHere ? " is-needs" : ""}`} style={{"--dash-project":`rgb(${accentRgb(p.name)})`} as CSSProperties}>
            <div className="dash-project__head"><b>{p.name}</b><small>{waitingHere ? "Needs you" : `${p.owners.filter(o=>o.state==='live').length} / ${p.owners.length} seats live`}</small></div>
            <div className="dash-seats">{p.owners.map(o => {
              const a=agents.find(a=>canonName(a.name)===canonName(o.name));
              const live=o.state==='live';
              return <span className="dash-seat" key={o.name} title={`${o.name} · ${o.domain || 'Owner'} · ${live?'live':'empty seat'}`}>
                {live ? <AgentFace name={o.name} project={p.name} status={a ? faceFor(a).status : "waiting"} size={30} /> : <span className="dash-seat__empty" aria-label={`${o.name}: empty seat`}>+</span>}
                <small>{o.domain || o.name}</small>
              </span>;
            })}{!p.owners.length && <span className="dash-note">No owner seats registered</span>}</div>
          </a>;
        })}</div></div>)}</div>}
      </Widget>
      <Widget id="dashboard-capacity" size="S-wide" icon={CpuIcon} title="Capacity" sub="Can another job fit?" onOpen={()=>onOpen("servers")}>
        <dl className="dash-capacity">
          <div><dt>Laptop load</dt><dd>{freshLaptop && laptop.health.load && laptop.health.cpus ? <><b>{laptop.health.load[0].toFixed(1)}</b><small> / {laptop.health.cpus} cores</small></> : <b>—</b>}</dd><span>{freshLaptop ? "1 minute average · not CPU %" : servers.error ? "Machine source unavailable" : "Awaiting a current machine reading"}</span></div>
          <div><dt>Mini lanes</dt><dd><b>{mini.data?.enabled && mini.data.reachable ? mini.data.lanes.filter(l=>l.running).length : "—"}</b><small>{mini.data?.enabled && mini.data.reachable ? ` / ${mini.data.lanes.length} busy` : ""}</small></dd><span>{mini.error ? "Mini source unavailable" : mini.data?.enabled === false ? "Mini reads are disabled" : mini.data && !mini.data.reachable ? mini.data.note || "Mini is unreachable" : "Observed lanes · separate machine"}</span></div>
          <div><dt>Codex souls</dt><dd><b>{codex}</b><small> working</small></dd><span>From the fleet's live agent list</span></div>
          <div><dt>Claude sub-agents</dt><dd><b>{claude ?? "—"}</b><small>{claude !== undefined ? " working" : ""}</small></dd><span>{claude !== undefined ? "Agent Zero's reported crew" : crew.error ? "Crew source unavailable" : "Waiting for Zero's crew"}</span></div>
        </dl>
      </Widget>
      <Widget id="dashboard-spend" size="M" icon={CircleDollarSignIcon} title="Spend today" sub="Tokens and estimated API value" onOpen={()=>onOpen("tokens")} empty={!stats.data ? stats.error ? "Token accounting is unavailable. Open Tokens for source details." : waiting("Tokens") : undefined}>
        {totals && <><div className="dash-spend__totals"><b>{compact(totals.total)}<small> tokens</small></b><b>{usd(totals.cost)}<small> estimated</small></b></div>
          <div className="dash-hours" role="img" aria-label="24-hour token rhythm across retained history, not today's hourly spend">{Array.from({length:24},(_,hour)=>{const value=hourly.find(h=>h.hour===hour)?.total;return <i key={hour} style={{height:`${value === undefined ? 2 : Math.max(3,value/peak*100)}%`}} title={`${hour}:00 · ${value === undefined ? 'unavailable' : compact(value)} tokens across history`} />;})}</div>
          <div className="dash-hours__axis"><span>00</span><span>12</span><span>24</span></div>
          <p className="dash-note">24-hour rhythm · retained history. Today's hourly spend is not reported.</p>
          <ol className="dash-spenders">{topSpenders.map(a=><li key={a.id}><AgentFace name={a.name} status="waiting" size={26} /><span>{a.name}<small>{compact(a.today.total)} tokens</small></span><b>{usd(a.today.cost)}</b></li>)}</ol>
          <p className="dash-note">Top accounts · daily agent attribution is unavailable.{totals.unpricedTokens > 0 ? ` ${compact(totals.unpricedTokens)} tokens unpriced.` : ""}{stats.error ? " Last retained accounting · refresh failed." : ""}</p>
        </>}
      </Widget>
      <Widget id="dashboard-servers" size="M" icon={ServerIcon} title="Servers" sub="Machines reporting in" door={{label:"Open Servers",onOpen:()=>onOpen("servers")}}>
        {servers.error && <div className="dash-server-error"><b>Machine readings are unavailable</b><p>This view first observed the failure at {clock(serversFailedAt)}. The outage start is unknown.</p><button type="button" onClick={()=>openTask({id:"t-0372"})}>t-0372 · repair the Servers source ↗</button></div>}
        {servers.data?.servers.length ? <ul className="dash-machines">{servers.data.servers.map(s=>{
          const stale=!!servers.error || s.health.at === null || Date.now()-s.health.at>120_000 || s.health.source === "fleet record";
          const down=["down","bad"].includes(s.health.level), state=down ? "Down" : stale || s.health.level === "unknown" ? "Stale" : s.health.level === "ok" ? "Up" : "Degraded";
          return <li key={s.key}><i className={`dash-machine-dot is-${state.toLowerCase()}`} aria-hidden /><span><b>{s.name}</b><small>{s.health.at ? `Read ${clock(s.health.at)}` : "No current reading"}</small></span><strong>{state}</strong></li>;
        })}</ul> : !servers.error && <p className="dash-note">{servers.data ? "Registered machines will appear when they report a health reading." : waiting("Servers")}</p>}
        <p className="dash-note">Readings describe machines, not release readiness.</p>
      </Widget>
    </WidgetGrid>
  </HubPage>;
}
