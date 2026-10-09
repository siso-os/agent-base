// uihub: arc:hover-card — Home door from the selected 8 October navigation design.
import { useId, useLayoutEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowUpRight, ChevronRight } from 'lucide-react';
import { AgentFace, faceFor } from '../lib/face';
import type { Agent } from '../lib/agents';
import type { OrgProject } from '../lib/agents';
import { ProjectMark } from './ProjectMark';
import './HomePeek.css';

export type HomePeekProps = {
  projects: readonly OrgProject[]; agents: readonly Agent[]; loading?: boolean; unavailable?: boolean;
  currentProject?: string | null; onProject: (id: string) => void; onAgent: (agent: Agent) => void;
  onHome: () => void; close: () => void;
};
const projectKey = (value: string | null | undefined) => (value ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
const tabs = ['Projects', 'Agents', 'Activity'] as const;
const stateLabel = (agent: Agent) => ({ working: 'Working', needs: 'Needs you', failed: 'Failed', done: 'Done', idle: 'Idle' })[agent.status];
export function HomePeek({ projects, agents, loading, unavailable, currentProject, onProject, onAgent, onHome, close }: HomePeekProps) {
  const id = useId();
  const [tab, setTab] = useState<typeof tabs[number]>('Projects');
  const [projectId, setProjectId] = useState<string | null>(null);
  const previousProject = useRef<string | null>(null);
  useLayoutEffect(() => {
    if (projectId) document.getElementById(`${id}-back`)?.focus();
    else if (previousProject.current) document.getElementById(`${id}-project-${previousProject.current}`)?.focus();
    previousProject.current = projectId;
  }, [id, projectId]);
  const project = projects.find(item => item.id === projectId);
  const crew = (item: OrgProject) => agents.filter(agent => (projectKey(agent.project) === projectKey(item.id) || projectKey(agent.project) === projectKey(item.name)) || item.owners.some(owner => owner.name === agent.name));
  const go = (action: () => void) => { close(); action(); };
  const agentRow = (agent: Agent) => <button type="button" className="hp-row" key={agent.id} onClick={() => go(() => onAgent(agent))}>
    <AgentFace {...faceFor(agent)} size={28}/><span className="hp-copy"><strong>{agent.name}</strong><small>{agent.title || 'Open conversation'}</small></span>
    <span className={agent.status === 'needs' ? 'hp-needs' : 'hp-state'}>{stateLabel(agent)}</span>
  </button>;
  return <div className="hp">
    {project ? <button id={`${id}-back`} type="button" className="hp-back" onClick={() => setProjectId(null)}><ArrowLeft size={14}/> All projects</button> :
      <div className="hp-tabs" role="tablist" aria-label="Home views">{tabs.map((item, index) => <button type="button" key={item} id={`${id}-${item}`} role="tab" aria-selected={tab === item} aria-controls={`${id}-body`} tabIndex={tab === item ? 0 : -1} onClick={() => setTab(item)} onKeyDown={event => {
        if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
          event.preventDefault();
          const next = event.key === 'Home' ? 0 : event.key === 'End' ? 2 : (index + (event.key === 'ArrowRight' ? 1 : 2)) % 3;
          setTab(tabs[next]); document.getElementById(`${id}-${tabs[next]}`)?.focus();
        }
      }}>{item}</button>)}</div>}
    <div className="hp-body" id={`${id}-body`} role={project ? undefined : 'tabpanel'} aria-labelledby={project ? undefined : `${id}-${tab}`}>
      {unavailable && <p className="hp-empty" role="status">Source unavailable. Showing the last supplied rows.</p>}
      {loading ? <p className="hp-empty" role="status">Loading projects and agents…</p> : project ? <>
        <div className="hp-project-title"><ProjectMark project={project.name}/><h3>{project.name}</h3></div>
        {project.line && <p className="hp-empty">{project.line}</p>}
        <button type="button" className="hp-row" onClick={() => go(() => onProject(project.id))}><span className="hp-copy"><strong>Open project</strong><small>Overview, team, pages and activity</small></span><ArrowUpRight size={16}/></button>
        <p className="hp-section">Team · {crew(project).length}</p>
        {crew(project).map(agentRow)}
        {!crew(project).length && <p className="hp-empty">No running agents in this project.</p>}
      </> : tab === 'Projects' ? <>
        <p className="hp-section">Your projects · {projects.length}</p>
        {projects.map(item => {
          const members = crew(item);
          const owner = item.owners.map(record => members.find(agent => agent.name === record.name)).find(Boolean);
          const needs = members.filter(agent => agent.status === 'needs').length;
          const current = !!currentProject && (projectKey(item.id) === projectKey(currentProject) || projectKey(item.name) === projectKey(currentProject));
          return <button type="button" className="hp-row" key={item.id} id={`${id}-project-${item.id}`} aria-current={current ? 'location' : undefined} onClick={() => setProjectId(item.id)}>
            <ProjectMark project={item.name}/><span className="hp-copy"><strong>{item.name}</strong><small>{item.line || `${members.length} running agents`}</small></span>
            {owner && <AgentFace {...faceFor(owner)} size={24}/>}
            {needs > 0 ? <span className="hp-needs">{needs} needs you</span> : current ? <span className="hp-current">Current</span> : null}<ChevronRight size={14}/>
          </button>;
        })}
        {!projects.length && <p className="hp-empty">No projects yet.</p>}
      </> : tab === 'Agents' ? <>{agents.map(agentRow)}{!agents.length && <p className="hp-empty">No running agents.</p>}</> : <>
        <p className="hp-section">Latest observed agent states</p>
        {[...agents].sort((a, b) => b.since - a.since).map(agentRow)}
        {!agents.length && <p className="hp-empty">No agent activity supplied.</p>}
      </>}
    </div>
    <footer className="hp-footer"><button type="button" onClick={() => go(onHome)}>Open Home <ArrowUpRight size={13}/></button><span>Esc to close</span></footer>
  </div>;
}
