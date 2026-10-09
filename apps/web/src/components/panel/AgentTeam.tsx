import { useEffect, useState, type ComponentProps } from "react";
import { ChevronDown, ChevronRight, ArrowUpRight, Search, Network } from "lucide-react";
import type { Agent, Org } from "../../lib/agents";
import { AgentFace, faceFor } from "../../lib/face";
import { panelTeam, flattenPanelTeam, type PanelTeamNode } from "../../lib/panel-team";
import { every } from "../../lib/poll";
import { subName, type SubRowData } from "./SubRow";
import { FleetBoard } from "../FleetBoard";
import { OwnerRoster } from "./OwnerRoster";
import "./AgentCompanion.css";

const stateName = (state: string) => ({ working: "Working", needs: "Needs you", failed: "Failed", idle: "Idle", done: "Finished", offline: "Offline", planned: "Planned", unresolved: "Unknown" }[state] ?? "Unknown");
const needsHelp = (r: SubRowData) => r.status === "blocked" || r.status === "failed";
const hasWorking = (node: PanelTeamNode): boolean => node.state === "working" || node.state === "needs" || node.state === "failed" || node.children.some(hasWorking);

export function AgentTeam({ a, agents, org, onOpenAgent, onSubagent, onGraph, onFleetCrew }: {
  a: Agent; agents: Agent[]; org: Org | null; onOpenAgent: (a: Agent) => void;
  onSubagent: (r: SubRowData) => void; onGraph: () => void;
  onFleetCrew: ComponentProps<typeof FleetBoard>["onCrew"];
}) {
  const [fleet, setFleet] = useState(false);
  useEffect(() => setFleet(false), [a.id]);
  const [q, setQ] = useState("");
  const [working, setWorking] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [folded, setFolded] = useState<Record<string, boolean>>({});
  const [subs, setSubs] = useState<SubRowData[] | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true; let generation = 0; let settled = 0; setSubs(null); setFailed(false); setSelected(null);
    const stop = every(async () => {
      const request = ++generation;
      try {
        const r = await fetch(`/api/agents/${encodeURIComponent(a.id)}/subagents`, { cache: "no-store" });
        if (!r.ok) throw new Error("unavailable");
        const d = await r.json(); if (!Array.isArray(d.rows)) throw new Error("malformed");
        if (alive && request > settled) { settled = request; setSubs(d.rows); setFailed(false); }
      } catch { if (alive && request > settled) { settled = request; setFailed(true); } }
    }, 10_000);
    return () => { alive = false; stop(); };
  }, [a.id]);
  const roots = panelTeam(a, agents, org);
  const all = flattenPanelTeam(roots);
  const owners = all.filter(n => n.owner);
  const workers = all.filter(n => !n.owner && n.agent && n.state !== "done");
  const busy = all.filter(n => n.state === "working").length;
  const names = new Set(all.filter(n => n.agent).map(n => n.agent!.id));
  const launches = (subs ?? []).filter(r => !r.agentId || !names.has(r.agentId));
  const current = launches.filter(r => r.running || r.quiet || needsHelp(r));
  const finished = launches.filter(r => !r.running && !r.quiet && !needsHelp(r));
  const needle = q.toLowerCase().trim();
  const launchMatches = (r: SubRowData) => (!working || r.running || needsHelp(r)) && (!needle || `${subName(r)} ${r.what} ${r.last}`.toLowerCase().includes(needle));
  const shownFinished = finished.filter(launchMatches);
  const match = (node: PanelTeamNode): boolean => (!working || hasWorking(node)) && (!needle || `${node.name} ${node.group} ${node.agent?.title ?? ""}`.toLowerCase().includes(needle) || node.children.some(match));
  const row = (node: PanelTeamNode, depth = 0) => {
    if (!match(node)) return null;
    const expanded = !!needle || !folded[node.id];
    const isSelected = node.id === selected;
    const agent = node.agent;
    const activeChildren = node.children.filter(n => (n.owner || n.state !== "done") && match(n));
    const endedChildren = node.children.filter(n => !n.owner && n.state === "done" && match(n));
    return <li className="ac-team-node" key={node.id} data-node-id={node.id} data-state={node.state} data-depth={depth}>
      <div className={`ac-team-line${isSelected ? " is-selected" : ""}`}>
        {node.children.length > 0 ? <button className="ac-team-fold" type="button" aria-label={`${expanded ? "Fold" : "Expand"} ${node.name}`} aria-expanded={expanded} onClick={() => setFolded(s => ({ ...s, [node.id]: expanded }))}>{expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}</button> : <span className="ac-team-fold" />}
        <button type="button" className="ac-team-main" aria-expanded={isSelected} aria-label={`Details for ${node.name}`} onClick={() => setSelected(isSelected ? null : node.id)}>
          <AgentFace {...faceFor(agent ?? { name: node.name, project: node.group, status: "idle" })} status={agent ? faceFor(agent).status : "offline"} size={depth ? 24 : 30} />
          <span className="ac-team-copy"><strong>{node.name}</strong><small>{agent?.title || (node.owner ? "Owner" : "Worker")}</small></span>
          <span className={`ac-state is-${node.state}`}><i />{stateName(node.state)}</span>
        </button>
      </div>
      {isSelected && <div className="ac-team-detail"><p>{agent?.title || `${node.name} is ${stateName(node.state).toLowerCase()}.`}</p><dl><dt>Workspace</dt><dd>{node.group}</dd><dt>Model</dt><dd>{agent?.hud?.model || agent?.tool || "Not reported"}</dd><dt>Machine</dt><dd>{agent?.machine || "Not connected"}</dd></dl>{agent ? <button type="button" className="ac-text-action" onClick={() => onOpenAgent(agent)}>Open conversation <ArrowUpRight size={12} /></button> : <p className="ac-note">{node.state === "unresolved" ? "More than one session has this name. Ownership needs resolving." : "This owner stays on the team when its session is closed."}</p>}</div>}
      {expanded && activeChildren.length > 0 && <ul className="ac-team-children">{activeChildren.map(n => row(n, depth + 1))}</ul>}
      {expanded && endedChildren.length > 0 && <details className="ac-history" open={needle ? true : undefined}><summary>{endedChildren.length} finished worker{endedChildren.length === 1 ? "" : "s"}</summary><ul className="ac-team-children">{endedChildren.map(n => row(n, depth + 1))}</ul></details>}
    </li>;
  };
  const groups = [...new Set(roots.map(n => n.group))];
  const launch = (r: SubRowData) => <li key={`${r.kind}:${r.id}`}><button type="button" className="ac-launch" onClick={() => onSubagent(r)}><AgentFace name={subName(r)} project={a.project ?? undefined} status={r.status === "failed" ? "blocked" : r.status === "blocked" ? "needs-shaan" : r.running ? "working" : r.quiet ? "waiting" : "done"} size={24} /><span><strong>{subName(r)}</strong><small>{r.what || r.last || "Delegated run"}</small></span><span className={`ac-state is-${needsHelp(r) ? "needs" : r.running ? "working" : r.quiet ? "idle" : "done"}`}>{r.status === "failed" ? "Failed" : needsHelp(r) ? "Needs you" : r.running ? "Working" : r.quiet ? "Quiet" : "Finished"}</span></button></li>;
  return <section className="ac-team" data-testid="companion-team">
    {/* The Fleet's owner cards live here now, on top (Shaan, 6 Oct 22:00: "I can click on team, and I should be able to see
        the owners in team cleanly at the top"); their workers follow below. */}
    {a.zero && <OwnerRoster />}
    {a.zero && <section className="ac-team-group ac-all-fleet" aria-label="All-fleet inventory">
      <button type="button" className="ac-text-action" aria-expanded={fleet} onClick={() => setFleet(value => !value)}>{fleet ? "Hide all-fleet inventory" : "Show all-fleet inventory"}</button>
      <p className="ac-note">Every owner's delegated runs and manifest-only jobs, grouped by workspace.</p>
      {fleet && <FleetBoard owners={false} onOpen={onOpenAgent} onCrew={onFleetCrew} />}
    </section>}
    <div className="ac-team-summary"><span><b>{owners.length}</b> owners</span><span><b>{workers.length}</b> workers</span><span className="is-working"><b>{busy}</b> working</span><button type="button" title="Open full org graph" aria-label="Open full org graph" onClick={onGraph}><Network size={15} /></button></div>
    {!org && a.zero && <p className="ac-note" role="status">Owner registry unavailable. Connected sessions are still shown.</p>}
    <div className="ac-team-faces" aria-label="Team owners">{owners.map(n => <button key={n.id} type="button" aria-label={`Find ${n.name}`} aria-pressed={selected === n.id} title={`${n.name} · ${stateName(n.state)}`} onClick={() => { setWorking(false); setQ(""); setSelected(n.id); setFolded({}); window.requestAnimationFrame(() => document.querySelector(`[data-node-id="${CSS.escape(n.id)}"]`)?.scrollIntoView({ block: "nearest", behavior: "instant" })); }}><AgentFace {...faceFor(n.agent ?? { name: n.name, project: n.group, status: "idle" })} status={n.agent ? faceFor(n.agent).status : "offline"} size={26} /></button>)}</div>
    <div className="ac-team-tools"><label><Search size={13} /><input value={q} onChange={e => setQ(e.target.value)} aria-label="Find a team member" placeholder="Find a person or task" /></label><button type="button" aria-pressed={working} title="Working or needs attention" onClick={() => setWorking(!working)}>Active</button></div>
    {groups.map(group => { const shown = roots.filter(n => n.group === group && match(n)); return shown.length > 0 && <section className="ac-team-group" key={group}><h4>{group}<span>{flattenPanelTeam(shown).filter(n => !!n.agent && n.state !== "done").length} connected</span></h4><ul>{shown.map(n => row(n))}</ul></section>; })}
    {!roots.some(match) && <p className="ac-note">{q || working ? "No team members match this view." : "No team members recorded yet."}</p>}
    <section className="ac-team-group ac-launches"><h4>Delegated by {a.name}<span>{failed ? "Unavailable" : subs ? `${current.length} current` : "Reading…"}</span></h4>{failed && <p className="ac-note" role="status">Could not refresh delegated runs. Previous rows may be stale.</p>}<ul>{current.filter(launchMatches).map(launch)}</ul>{subs && !current.length && !failed && <p className="ac-note">No delegated runs active.</p>}{shownFinished.length > 0 && <details className="ac-history" open={needle ? true : undefined}><summary>{shownFinished.length} finished runs</summary><ul>{shownFinished.map(launch)}</ul></details>}</section>
  </section>;
}
