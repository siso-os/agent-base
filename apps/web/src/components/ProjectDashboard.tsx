import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { Activity, BellRing, BookOpen, CheckCircle2, ChevronRight, ChessKing, Hand, Lightbulb, ListChecks, Megaphone, MessageSquare, X, icons, type LucideIcon } from "lucide-react";
import type { GroupId, PlanItem, PlanState } from "../lib/org-types";
import { AgentFace, type AgentStatus } from "../../../../packages/halo-face";
import "./ProjectDashboard.css";

// Structural copy of hub-design/hub-types.ts until hub-1 supplies the shared module.
// The integrator can pass HubProject / HubAgent from that module without conversion.
export type DashboardAgent = {
  name: string; kind: "owner" | "worker" | "zero"; project: string; domain?: string; owner?: string; role?: string;
  icon: string; accent: string; harness: "claude" | "codex" | "siso" | "herdr"; model: string; machine: string;
  state: "working" | "done" | "idle" | "off"; spunUp: boolean;
  holding?: { id: string; title: string; status: PlanState } | null;
  lastReport?: { at: string; ageMin: number; text: string; log: string } | null;
  plan?: { checked: number; total: number; counts: Record<PlanState, number> } | null;
  workers?: { total: number; working: number };
};
export type HubProject = {
  id: string; name: string; group: GroupId; line: string; accent: string; icon: string; owners: DashboardAgent[];
  counts: Record<PlanState, number>; open: (PlanItem & { owner: string })[];
  needsYou: { id: string; title: string; owner?: string; link?: string; minutes?: number }[];
  timeline: { at: string; kind: "board" | "report" | "checked"; who: string; text: string }[];
  health: { icon: string; name: string; value: string; level: "ok" | "warn" | "bad" | "unknown"; source: string; at: string }[];
  spendToday: null | { claudeUsdEquiv: number; codexCredits: number };
  /** Agent Base's research team (4 Oct): the idea farm (his ideas first, then the miners' ranked) and the research base. */
  ideas?: { id: string; text: string; by: string; score: number | null; status: string; size?: string | null; why?: string | null; evidence?: string | null; his?: string | null }[];
  library?: { title: string; path: string; count: number; unit: string; by: string; at: string }[];
};
type Item = HubProject["open"][number];
export type ProjectDashboardProps = {
  project: HubProject; agents?: DashboardAgent[]; onOpen: (name: string) => void;
  onGroup?: (group: GroupId) => void; onNeed?: (need: HubProject["needsYou"][number]) => void;
  onItem?: (item: Item) => void;
  /** ecosystem SPEC §3.4: the project's Live strip, under the header. */
  live?: ReactNode;
  /** Existing widgets within the shared project shell. */
  embedded?: boolean;
};
const STATES = ["asked", "specced", "allocated", "building", "built", "checked"] as const;
const GROUPS = { agency: "SISO Agency", labs: "SISO Labs", family: "SISO Family" };
const STATUS = { working: "Working", done: "Turn done", idle: "Idle", off: "Not running" };
const n = (value?: number) => Number.isFinite(value) ? Math.max(0, value!) : 0;
const time = (at: string) => at ? at.replace("T", " ").slice(0, 16) : "Time not recorded";
const FACE_HUES: Record<string, number> = { halo: 325, "fahmy's": 215, "fahmy's agency": 215, "agent zero": 75, "agent base": 190, efficiency: 268, health: 145, "laptop health": 145 };
const iconFor = (name: string): LucideIcon => icons[name.replace(/(^|-)(\w)/g, (_, _dash, c: string) => c.toUpperCase()) as keyof typeof icons] ?? Activity;

function ItemDetail({ item }: { item: Item }) {
  return <><p className="pd-meta">{item.id} · {item.status} · {item.owner}{item.to?.agent ? ` · held by ${item.to.agent}` : ""}</p>
    <h2>{item.title}</h2><h3>His words</h3>{item.his ? <blockquote>“{item.his}”</blockquote> : <p className="pd-muted">No words recorded yet.</p>}
    <h3>Evidence</h3>{item.evidence?.length ? <ul className="pd-evidence">{item.evidence.map((e, i) => <li key={i}>{e}</li>)}</ul> : <p className="pd-muted">No evidence recorded yet.</p>}
    <p className="pd-meta">{time(item.at ?? "")}</p></>;
}

export function ProjectDashboard({ project, agents = [], onOpen, onGroup, onNeed, onItem, live, embedded = false }: ProjectDashboardProps) {
  const [selection, setSelection] = useState<{ item?: Item; state?: PlanState } | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { if (selection && !dialog.current?.open) dialog.current?.showModal(); }, [selection]);
  useEffect(() => { setSelection(null); dialog.current?.close(); }, [project.id]);
  const openItem = (item: Item) => { setSelection({ item }); onItem?.(item); };
  const hue = FACE_HUES[project.name.toLowerCase()];
  const ProjectIcon = project.id.toLowerCase() === "halo" ? ChessKing : iconFor(project.icon);
  const faceState = (agent: DashboardAgent): AgentStatus => project.needsYou.some(need => need.owner === agent.name) ? "needs-shaan" : !agent.spunUp || agent.state === "off" ? "offline" : agent.state === "working" ? "working" : "waiting";
  const total = Object.values(project.counts).reduce((sum, count) => sum + n(count), 0);
  // Owners + their deduplicated worker counts; never count plan holders as additional sessions.
  const working = project.owners.reduce((sum, owner) => sum + Number(owner.state === "working") + n(owner.workers?.working), 0);
  const ordered = [...project.open].filter(item => STATES.includes(item.status as typeof STATES[number])).sort((a, b) => STATES.indexOf(b.status as typeof STATES[number]) - STATES.indexOf(a.status as typeof STATES[number]));
  const selectNeed = (need: HubProject["needsYou"][number]) => {
    if (onNeed) return onNeed(need);
    if (need.link && /^https?:\/\//i.test(need.link)) window.open(need.link, "_blank", "noopener,noreferrer");
    else if (need.owner) onOpen(need.owner);
  };
  return <div className="project-dashboard" style={{ "--pd-accent": project.accent || "var(--accent-tasks)" } as CSSProperties} data-testid="project-dashboard">
    {!embedded && <><nav className="pd-crumb" aria-label="Breadcrumb">{onGroup ? <button onClick={() => onGroup(project.group)}>{GROUPS[project.group]}</button> : <span>{GROUPS[project.group]}</span>}<ChevronRight size={13}/><b>{project.name}</b></nav>
    <header className="pd-header"><div className="pd-mark"><ProjectIcon size={40} aria-label={`${project.name} project`}/></div><div className="pd-identity"><h1>{project.name}</h1><p>{project.line}</p></div>
      <div className="pd-kpis"><div><b>{n(project.counts.checked)}<small>/{total}</small></b><span>checked</span></div><div><b>{n(project.counts.building)}</b><span>building</span></div><div><b>{working}</b><span>{working === 1 ? "agent working" : "agents working"}</span></div><div className="pd-warn"><b>{project.needsYou.length}</b><span>need you</span></div><div className="pd-spend" title={project.spendToday ? "Claude USD equivalent · Codex credits" : "waits on EFFICIENCY's meter"}><b>{project.spendToday ? `$${n(project.spendToday.claudeUsdEquiv).toFixed(2)}` : "—"}</b><span>{project.spendToday ? `${n(project.spendToday.codexCredits)} Codex credits` : "waits on EFFICIENCY's meter"}</span></div></div>
    </header></>}
    {live}
    {project.health.length > 0 && <div className="pd-health">{project.health.map((cell, i) => { const Icon = iconFor(cell.icon); return <article key={`${cell.name}-${i}`} className={`pd-health-cell pd-health-${cell.level}`}><Icon size={16}/><div><b>{cell.name}</b><span>{cell.value || "—"}</span><small>{time(cell.at)} · {cell.source || "Source not recorded"}</small></div></article>; })}</div>}
    <div className="pd-owners">{project.owners.map(owner => {
      const items = ordered.filter(item => item.owner === owner.name && item.status !== "checked");
      const crew = [...new Map(agents.filter(agent => agent.owner === owner.name).map(agent => [agent.name, agent])).values()];
      const checked = n(owner.plan?.checked), count = n(owner.plan?.total), pct = count ? Math.min(1, checked / count) : 0;
      return <article className={`pd-owner ${owner.spunUp ? "" : "pd-off"}`} key={owner.name}>
        <div className="pd-owner-head"><AgentFace name={owner.name} project={project.name} hue={hue} status={faceState(owner)} size={40}/><div><span className="pd-label">{owner.role ?? "Owner"}</span><h2>{owner.name}</h2></div><span className={`pd-pill pd-agent-${owner.state}`}><i/>{STATUS[owner.state]}</span></div>
        {owner.plan ? <><div className="pd-owner-progress"><svg viewBox="0 0 76 76" className="pd-ring" aria-label={`${checked} of ${count} checked`} role="img"><circle cx="38" cy="38" r="33"/><circle className="pd-ring-fill" cx="38" cy="38" r="33" pathLength="100" strokeDasharray={`${pct * 100} 100`} transform="rotate(-90 38 38)"/></svg><div className="pd-owner-number"><b>{checked}<small>/{count}</small></b><span>checked</span></div><p className="pd-domain">{owner.domain ?? "No domain recorded"}</p></div>
          <div className="pd-pipeline" role="img" aria-label="Plan items by stage">{STATES.map(state => <div className={`pd-stage pd-state-${state}`} key={state}><b>{n(owner.plan!.counts[state])}</b></div>)}</div><div className="pd-stage-legend" aria-hidden="true">{STATES.map(state => <span className={`pd-state-${state}`} key={state}>{state}</span>)}</div></> : <p className="pd-no-plan">No plan yet</p>}
        <div><h3 className="pd-label">Open, furthest along first</h3><ul className="pd-owner-items">{items.slice(0, 4).map(item => <li key={item.id}><button onClick={() => openItem(item)} title={item.title}><span className={`pd-chip pd-state-${item.status}`}>{item.id}</span><span className="pd-item-title">{item.title}</span>{item.to?.agent !== owner.name && <span className="pd-holder">{item.to?.agent ?? "unassigned"}</span>}</button></li>)}</ul>{!items.length && <p className="pd-muted">No open items.</p>}</div>
        <div className="pd-crew"><span className="pd-label">Crew</span>{crew.map(agent => <button key={agent.name} className={`pd-face pd-agent-${agent.state}`} title={`${agent.name} · ${STATUS[agent.state]}`} aria-label={`Open ${agent.name}`} disabled={!agent.spunUp} onClick={() => onOpen(agent.name)}><AgentFace name={agent.name} project={project.name} hue={hue} status={faceState(agent)} size={24}/></button>)}{!crew.length && <span className="pd-muted">{owner.workers?.total ? `${owner.workers.total} ${owner.workers.total === 1 ? "worker" : "workers"} · ${owner.workers.working} working` : "No crew yet"}</span>}</div>
        <div className="pd-report"><MessageSquare size={13}/>{owner.lastReport ? <p><time dateTime={owner.lastReport.at}>{time(owner.lastReport.at)}</time> · {owner.lastReport.text}</p> : <p className="pd-muted">No report yet.</p>}</div>
        <button className="pd-open-owner" disabled={!owner.spunUp} onClick={() => onOpen(owner.name)}>{owner.spunUp ? `Open ${owner.name}` : "No owner session yet"}<ChevronRight size={14}/></button>
      </article>;
    })}</div>
    {!project.owners.length && <p className="pd-muted">No owners yet.</p>}
    <div className="pd-middle"><section className="pd-panel"><div className="pd-panel-head"><BellRing size={16}/><h2>Needs you</h2><span>{project.needsYou.length} · each says how long</span></div><ul className="pd-needs">{project.needsYou.map(need => <li key={need.id}><Hand size={15}/><div><b>{need.title}</b><span>{need.owner ?? "Agent Zero"} · {need.minutes !== undefined ? `${need.minutes} min` : "Time not estimated"}</span></div>{(onNeed || need.owner || (need.link && /^https?:\/\//i.test(need.link))) && <button onClick={() => selectNeed(need)}>Open</button>}</li>)}</ul>{!project.needsYou.length && <p className="pd-muted">Nothing needs you.</p>}</section>
      <section className="pd-panel"><div className="pd-panel-head"><Activity size={16}/><h2>What happened</h2><span>board + owners’ reports, newest first</span></div><ul className="pd-timeline">{[...project.timeline].sort((a,b) => b.at.localeCompare(a.at)).slice(0, 8).map((event,i) => { const Icon = event.kind === "board" ? Megaphone : event.kind === "checked" ? CheckCircle2 : MessageSquare; return <li key={`${event.at}-${i}`}><i><Icon size={12}/></i><div><span>{event.at ? `${time(event.at)} · ${event.who}` : event.who}</span><p title={event.text}>{event.text.length > 150 ? `${event.text.slice(0, 150)}…` : event.text}</p></div></li>; })}</ul>{!project.timeline.length && <p className="pd-muted">No activity recorded yet.</p>}</section>
    </div>
    {(project.ideas || project.library) && <div className="pd-middle" data-testid="pd-research">
      <section className="pd-panel"><div className="pd-panel-head"><Lightbulb size={16}/><h2>Idea farm</h2><span>{project.ideas?.length ?? 0} · his first, then the miners' by score</span></div><ul className="pd-needs">{(project.ideas ?? []).slice(0, 12).map(idea => <li key={idea.id}><span className={`pd-chip pd-state-${idea.status === "integrated" ? "checked" : idea.status === "approved" ? "building" : "asked"}`}>{idea.by === "Shaan" ? "his" : idea.score ?? "—"}</span><div><b title={idea.text}>{idea.text.length > 110 ? `${idea.text.slice(0, 110)}…` : idea.text}</b><span>{[idea.by === "Shaan" ? null : idea.size ? `size ${idea.size}` : null, idea.why].filter(Boolean).join(" · ").slice(0, 160)}</span></div></li>)}</ul>{!project.ideas?.length && <p className="pd-muted">No ideas farmed yet.</p>}</section>
      <section className="pd-panel"><div className="pd-panel-head"><BookOpen size={16}/><h2>Research base</h2><span>what the research team found · in the project's repo</span></div><ul className="pd-timeline">{(project.library ?? []).map(doc => <li key={doc.path}><i><BookOpen size={12}/></i><div><span>{doc.at} · {doc.by}</span><p title={doc.path}>{doc.title}: <b>{doc.count}</b> {doc.unit}</p></div></li>)}</ul>{!project.library?.length && <p className="pd-muted">Nothing researched yet.</p>}</section>
    </div>}
    <section className="pd-panel"><div className="pd-panel-head"><ListChecks size={16}/><h2>Every open {project.name} item</h2><span>click opens his words and the evidence</span></div><div className="pd-board">{STATES.map(state => {
      const items = ordered.filter(item => item.status === state);
      const visibleCount = Math.min(items.length, 5);
      const countedElsewhere = Math.max(0, n(project.counts[state]) - items.length);
      return <section className="pd-column" key={state} data-state={state}><h3><i className={`pd-state-${state}`}/>{state}<b>{state === "checked" ? n(project.counts.checked) : visibleCount}</b></h3>{state === "checked" ? <div className="pd-board-checked"><CheckCircle2 size={14}/>{n(project.counts.checked)} checked, each with its evidence</div> : <>{items.slice(0,5).map(item => <button className="pd-board-card" title={item.title} aria-label={`${item.id}: ${item.title}`} key={`${item.owner}-${item.id}`} onClick={() => openItem(item)}><span>{item.id}</span>{item.title.length > 90 ? `${item.title.slice(0,90)}…` : item.title}<small>{project.owners.find(o => o.name === item.owner)?.role ?? item.owner}</small></button>)}{items.length > 5 && <button className="pd-more" onClick={() => setSelection({ state })}>+{items.length - 5} more</button>}{countedElsewhere > 0 && <p className="pd-muted">{countedElsewhere} {countedElsewhere === 1 ? "item" : "items"} in owner totals aren’t on this board.</p>}{!items.length && !countedElsewhere && <p className="pd-muted">No items</p>}</>}</section>;
    })}</div></section>
    <dialog ref={dialog} className="pd-dialog" onClose={() => setSelection(null)} onClick={e => { if (e.target === e.currentTarget) { const rect = e.currentTarget.getBoundingClientRect(); if (e.clientX < rect.left || e.clientX > rect.right || e.clientY < rect.top || e.clientY > rect.bottom) dialog.current?.close(); } }}><button className="pd-dialog-close" aria-label="Close item details" onClick={() => dialog.current?.close()}><X size={20}/></button>{selection?.item ? <ItemDetail item={selection.item}/> : selection?.state && <><h2>All {selection.state} items</h2><ul className="pd-all-items">{ordered.filter(item => item.status === selection.state).map(item => <li key={`${item.owner}-${item.id}`}><button onClick={() => openItem(item)}>{item.id} · {item.title}<small>{item.owner}</small></button></li>)}</ul></>}</dialog>
  </div>;
}
