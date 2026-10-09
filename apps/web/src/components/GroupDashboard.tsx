import { icons, ArrowUpRight, BellRing, Hand, Pin, Megaphone, Coins, Circle, CircleHelp } from "lucide-react";
import type { CSSProperties } from "react";
import type { GroupId, PlanItem, PlanState } from "../lib/org-types";
import "./GroupDashboard.css";

// Structural subset of hub-types.ts, so this independent lane compiles before hub-1 lands.
// The integrator can pass HubProject[] directly; no data reads happen here.
type Counts = Record<PlanState, number>;
export type GroupAgent = {
  name: string; owner?: string; role?: string; domain?: string; icon: string;
  state: "working" | "done" | "idle" | "off"; spunUp: boolean;
  holding?: Pick<PlanItem, "id" | "title" | "status"> | null;
  plan?: { checked: number; total: number; counts: Counts } | null;
  workers?: { total: number; working: number };
};
export type GroupProject = {
  id: string; name: string; group: GroupId; line: string; accent: string; icon: string;
  counts: Counts;
  owners: GroupAgent[];
  needsYou: { id: string; title: string; owner?: string; link?: string; minutes?: number }[];
  timeline: { at: string; kind: string; who: string; text: string }[];
  spendToday: null | { claudeUsdEquiv: number; codexCredits: number };
};
export type GroupClient = {
  id?: string; name?: string; folder: string; kind: string; note: string; people: string[];
  on_rolodex: boolean; place: string; icon?: string; pinned?: boolean; status?: string;
};
export type GroupDashboardProps = {
  group: GroupId;
  projects: GroupProject[];
  clients: GroupClient[];
  /** Canonical /api/hub/agents data supplies real crew identities and held items. */
  agents?: GroupAgent[];
  onOpen: (id: string) => void;
  onPin: (id: string) => void;
  /** Reserved compatibility callback; the amended design has no Shown/All control. */
  onShowAll?: () => void;
};
const states = ["asked", "specced", "allocated", "building", "built", "checked"] as const;
const names = { agency: "SISO Agency", labs: "SISO Labs", family: "SISO Family" };
const labels = { agency: "Clients", labs: "Systems", family: "Life, organised" };
const stateLabels = { working: "Working", done: "Turn done", idle: "Idle", off: "Not running" };
const domains = [
  ["finance", "Finance", "wallet"], ["legal", "Legal", "gavel"], ["study", "Study", "graduation-cap"],
  ["goals", "Goals", "rocket"], ["property", "Property", "map-pin-house"],
];
const sections = [
  { title: "Clients and leads", kinds: ["client", "lead", "partner-client"] },
  { title: "Friends and favours", kinds: ["friend-favour"] },
  { title: "Templates", kinds: ["template"] },
  { title: "Off-boarded and declined", kinds: ["offboarded", "declined"] },
];
// ICON-MAP.md uses the upstream pq name "cart"; its static Lucide twin is ShoppingCart.
const clientIcons: Record<string, string> = {
  halo: "chess-king", fahmy: "heart-handshake", melanotresses: "sparkles", "college-besties": "graduation-cap",
  actionmodel: "bot", "bike-rental": "route", blackbox4: "box", buildstockpro: "construction",
  "business-to-government": "stamp", "cafe-89": "coffee", "construction-rc": "hammer",
  "five-star-hire": "user-check", "home-essentials": "home", lumelle: "cart", "patchwork-store": "palette",
  "provider-compliance-2026-08": "shield-check", "restaurant-app": "cooking-pot", "siso-fullora": "layers",
  thehrworld: "users", "tour-guides": "compass", "visa-run-da-nang": "plane-takeoff",
};
function CrewFaces({ owner, crew }: { owner: GroupAgent; crew: GroupAgent[] }) {
  const count = Math.max(owner.workers?.total || 0, crew.length);
  if (!count) return null;
  const shown = crew.slice(0, 3);
  return <span className="gd-crew" aria-label={`${count} crew; ${owner.workers?.working ?? crew.filter(a => a.state === "working").length} working`}>
    <span className="gd-faces">{shown.map(agent => <span key={agent.name} className="gd-face" title={`${agent.name} · ${stateLabels[agent.state]}`} aria-label={agent.name}>{agent.name.split(/[- ]/).map(part => part[0]).join("").slice(0, 2)}</span>)}{shown.length > 0 && count > shown.length && <span className="gd-face gd-face-more" title={`${count - shown.length} more crew`}>+{count - shown.length}</span>}</span>
    <span>{count} crew · {owner.workers?.working ?? crew.filter(a => a.state === "working").length} working</span>
  </span>;
}
function AgentLane({ agent, crew = [], worker = false }: { agent: GroupAgent; crew?: GroupAgent[]; worker?: boolean }) {
  return <article className={`gd-lane ${worker ? "gd-worker-lane" : ""}`} data-agent={agent.name}>
    <div className={worker ? "gd-face gd-worker-face" : "gd-icon"}>{worker ? agent.name.split(/[- ]/).map(part => part[0]).join("").slice(0, 2) : <Icon name={agent.icon} />}</div><div className="gd-lane-main">
      <div className="gd-lane-heading"><b>{worker ? agent.name : agent.role || agent.domain || agent.name}</b>{!worker && <span className="gd-owner-name">{agent.name}</span>}<span className={`gd-state gd-state-${agent.spunUp ? agent.state : "off"}`}>{stateLabels[agent.spunUp ? agent.state : "off"]}</span></div>
      <div className="gd-held">{agent.holding && <span className={`gd-item-chip gd-${agent.holding.status}`}>{agent.holding.id}</span>}<p className="gd-current" title={agent.holding?.title}>{agent.holding?.title || (agent.spunUp ? "No plan item held" : "Not spun up yet")}</p></div>
      {!worker && <div className="gd-lane-progress">{agent.plan ? <><Stack counts={agent.plan.counts} /><span>{agent.plan.checked}/{agent.plan.total}</span></> : <span>No plan yet</span>}<CrewFaces owner={agent} crew={crew} /></div>}
    </div>
  </article>;
}
function Icon({ name, size = 20 }: { name: string; size?: number }) {
  const key = (name === "cart" ? "shopping-cart" : name === "home" ? "house" : name).replace(/(^|-)([a-z0-9])/g, (_, _prefix, letter: string) => letter.toUpperCase());
  const Glyph = icons[key as keyof typeof icons] ?? Circle;
  return <Glyph size={size} strokeWidth={1.8} aria-hidden="true" />;
}
function total(counts: Counts) { return Object.values(counts).reduce((sum, value) => sum + Math.max(0, value || 0), 0); }
function Stack({ counts }: { counts: Counts }) {
  const sum = total(counts);
  return <div className="gd-stack" role="img" aria-label={sum ? states.map(s => `${counts[s] || 0} ${s}`).join(", ") + `; ${sum} total` : "No plan items yet"}>
    {states.map(s => counts[s] > 0 && <i key={s} className={`gd-${s}`} style={{ flex: counts[s] }} title={`${counts[s]} ${s}`} />)}
  </div>;
}
function projectStyle(project: GroupProject): CSSProperties { return { "--gd-accent": project.accent } as CSSProperties; }
function Hero({ project, agents, onOpen }: { project: GroupProject; agents: GroupAgent[]; onOpen: (id: string) => void }) {
  const count = total(project.counts);
  const latest = [...project.timeline].sort((a, b) => b.at.localeCompare(a.at))[0];
  return <section className="gd-hero" style={projectStyle(project)} aria-label={`${project.name} overview`}>
    <div className="gd-hero-left">
      <div className="gd-eyebrow">Top {project.group === "agency" ? "client" : "project"} · {project.owners.filter(o => o.state === "working").length} owners working now</div>
      <div className="gd-identity"><div className={`gd-mark ${project.id === "halo" ? "gd-halo" : ""}`}><Icon name={project.id === "halo" ? "chess-king" : project.icon} size={46} /></div><div><h2>{project.name}</h2><p>{project.line}</p></div></div>
      <div className="gd-numbers"><div><b>{project.counts.checked || 0}</b><span>of {count} checked</span></div><div><b>{project.counts.building || 0}</b><span>building</span></div><div><b>{(project.counts.asked || 0) + (project.counts.specced || 0)}</b><span>not picked up yet</span></div></div>
      <Stack counts={project.counts} />
      <div className="gd-legend">{states.map(s => <span key={s}><i className={`gd-${s}`} />{s} {project.counts[s] || 0}</span>)}</div>
      <div className="gd-needs"><h3><BellRing size={14} /> Needs you · {project.needsYou.length}</h3>
        {project.needsYou.length ? <ul>{project.needsYou.map(need => <li key={need.id}><Hand size={14} /><div>{need.link ? <a href={need.link}>{need.title}</a> : <span>{need.title}</span>}{need.minutes != null && <small> · {need.minutes} min</small>}</div></li>)}</ul> : <p>Nothing needs you right now.</p>}
      </div>
    </div>
    <div className="gd-hero-right"><h3 className="gd-eyebrow">Owners</h3>
      {project.owners.length ? project.owners.map(owner => <AgentLane key={owner.name} agent={owner} crew={agents.filter(a => a.owner === owner.name)} />) : <div className="gd-unowned">No owner yet</div>}
      {project.owners.length === 1 && <><h3 className="gd-eyebrow">Crew · {project.owners[0].name}</h3>{agents.filter(a => a.owner === project.owners[0].name).length ? <div className="gd-crew-lanes" tabIndex={0} aria-label={`${project.owners[0].name} crew lanes`}>{agents.filter(a => a.owner === project.owners[0].name).map(agent => <AgentLane key={agent.name} agent={agent} worker />)}</div> : <p className="gd-crew-empty">Crew details not supplied yet.</p>}</>}
      {latest && <div className="gd-announcement"><Megaphone size={15} /><span>{latest.text} <time dateTime={latest.at}>{latest.who} · {formatTime(latest.at)}</time></span></div>}
      <div className="gd-spend"><Coins size={15} />{project.spendToday ? <span>Today · ${project.spendToday.claudeUsdEquiv.toFixed(2)} Claude equivalent · {project.spendToday.codexCredits.toLocaleString()} Codex credits</span> : <span>Spend today — <small>waiting on EFFICIENCY’s meter</small></span>}</div>
    </div>
    <button className="gd-open-hero" onClick={() => onOpen(project.id)}>Open {project.name} <ArrowUpRight size={14} /></button>
  </section>;
}
function formatTime(at: string) { const date = new Date(at); return Number.isNaN(date.getTime()) ? at : date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }); }
function ClientCard({ client, onOpen, onPin }: { client: GroupClient; onOpen: (id: string) => void; onPin: (id: string) => void }) {
  const id = client.id || client.folder;
  const name = client.name || client.folder.split("/").filter(Boolean).pop()?.replace(/[()-]/g, " ").trim() || client.folder;
  const retired = ["offboarded", "declined"].includes(client.kind);
  return <article data-client={id} className={`gd-card ${retired ? "gd-retired" : ""} ${client.pinned ? "gd-pinned" : ""}`}>
    <div className="gd-card-top"><div className="gd-icon"><Icon name={clientIcons[client.folder.split("/").pop()?.replace(/[()]/g, "") || ""] || client.icon || "circle-help"} /></div><span className="gd-tag">{client.status || client.kind.replace(/-/g, " ")}</span><button className="gd-pin" aria-label={`${client.pinned ? "Unpin" : "Pin"} ${name}`} aria-pressed={client.pinned || false} onClick={() => onPin(id)}><Pin size={14} /></button></div>
    <button className="gd-card-open" onClick={() => onOpen(id)}><h3>{name}</h3><p>{client.note}</p><span>{client.people.length ? client.people.join(" · ") : "No contact recorded"}<ArrowUpRight size={14} /></span></button>
  </article>;
}
export function GroupDashboard({ group, projects, clients, agents = [], onOpen, onPin }: GroupDashboardProps) {
  const ownProjects = projects.filter(p => p.group === group);
  const hero = ownProjects.find(p => p.id === (group === "agency" ? "halo" : "agent-base")) || (group !== "family" ? ownProjects[0] : undefined);
  const ownClients = clients.filter(c => c.place === group && c.folder !== "../partners/halo");
  const partners = ownClients.filter(c => c.kind === "partner");
  const knownKinds = ["partner", ...sections.flatMap(s => s.kinds)];
  function cards(title: string, items: GroupClient[]) {
    return items.length > 0 && <section className="gd-section" key={title}><header><h2>{title}</h2><span>{items.length}</span></header><div className="gd-grid">{items.map(client => <ClientCard key={client.id || client.folder} client={client} onOpen={onOpen} onPin={onPin} />)}</div></section>;
  }
  return <main className={`group-dashboard gd-group-${group}`}>
    <header className="gd-page-heading"><div><div className="gd-eyebrow">{names[group]}</div><h1>{labels[group]}</h1></div><span>Projects, owners, and what needs you</span></header>
    {hero && <Hero project={hero} agents={agents} onOpen={onOpen} />}
    {group === "family" ? <section className="gd-section"><header><h2>Your domains</h2><span>Owners grow here</span></header><div className="gd-grid">{domains.map(([id, name, icon]) => {
      const project = ownProjects.find(p => p.id === id);
      return <article className={`gd-card ${!project?.owners.length ? "gd-unowned" : ""}`} key={id}><div className="gd-icon"><Icon name={icon} /></div><button className="gd-card-open" onClick={() => onOpen(project?.id || id)}><h3>{name}</h3>{project?.line && <p>{project.line}</p>}<span>{project?.owners.length ? project.owners.map(o => o.name).join(" · ") : "No owner yet"}<ArrowUpRight size={14} /></span></button>{project && <Stack counts={project.counts} />}</article>;
    })}</div></section> : group === "agency" ? <>{cards("Partners", partners)}{sections.map(s => cards(s.title, ownClients.filter(c => s.kinds.includes(c.kind))))}{cards("To classify", ownClients.filter(c => !knownKinds.includes(c.kind)))}</> : <>
      {cards("Projects", ownProjects.filter(p => p !== hero).map(p => ({ id: p.id, name: p.name, folder: p.id, kind: "project", note: p.line, people: p.owners.map(o => o.name), on_rolodex: false, place: "labs", icon: p.icon })))}
      {cards("Agent systems", ownClients)}
    </>}
    {!hero && group !== "family" && ownProjects.length === 0 && ownClients.length === 0 && <div className="gd-empty"><CircleHelp size={24} /><h2>No projects yet</h2><p>This group has no projects or clients in the supplied data.</p></div>}
  </main>;
}
