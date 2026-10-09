import { useState } from 'react';
import { formatAge } from '@siso/side-nav';
import type { Agent, OrgProject } from '../lib/agents';
import { tasksOf, taskRoots } from '../lib/a0-tasks';
import { crewTitle, projectTasks } from '../lib/project-crew';
import { useProjectCrew } from '../lib/use-project-crew';
import { AgentFace, faceFor } from '../lib/face';
import { useSharedState } from '../lib/poll';
import type { CodexWorker } from '../../../../services/node/src/codex-workers';
import { taskProgress } from './panel/TaskTree';
import { LandedRows } from './panel/LandedRows';
import './ProjectCrew.css';

function CrewCard({ a, all, onOpen }: { a: Agent; all: ReturnType<typeof projectTasks>; onOpen: (a: Agent) => void }) {
  const { data: worker } = useSharedState<CodexWorker>(a.codexWorker ? `/api/codex-workers/${a.id}` : null, 5000);
  const task = tasksOf(all, a.name).find(t => !!taskProgress(t, all));
  const step = worker?.runs[0]?.step ?? a.workerSummary?.message ?? a.role ?? 'No step reported';
  const title = crewTitle(a);
  return <button type="button" className="ab-project-crew__card" data-testid="project-crew-card" onClick={() => onOpen(a)}>
    <span className={`ab-ring is-${a.status}`}><AgentFace {...faceFor(a)} size={22} /></span>
    <strong title={title}>{title}</strong><span className="ab-project-crew__step" title={step}>{step}</span>
    <small><span>{a.status === 'idle' ? 'quiet' : a.status} · {formatAge(a.status === 'idle' ? a.lastEvent ?? a.since : a.since, Date.now())}</span>{task && <span>{taskProgress(task, all)}</span>}</small>
  </button>;
}

/** Added above either existing project page, leaving their existing contents intact. */
export function ProjectCrew({ project, agents, onOpen, onTask }: { project: OrgProject; agents: Agent[]; onOpen: (a: Agent) => void; onTask: (id: string) => void }) {
  const { shown, earlier, tasks, error, tasksReady, tasksFailed } = useProjectCrew(project, agents);
  const [more, setMore] = useState(false), all = projectTasks(project, tasks);
  const landed = taskRoots(all).filter(t => t.stage === 'preview' || t.stage === 'feedback');
  return <div className="siso-org ab-project-overview" data-testid="project-overview">
    <h1>{project.name}</h1>
    <section data-testid="project-dashboard-crew"><div className="ab-project-overview__heading"><h2>Crew</h2><span>{shown.filter(a => a.status === 'working').length} working</span></div>
      {error && <p role="status">Crew refresh unavailable; showing the last read.</p>}
      {!shown.length && <p className="siso-org__muted">No current crew.</p>}
      <div className="ab-project-crew">{(more ? [...shown, ...earlier] : shown).map(a => <CrewCard key={a.id} a={a} all={all} onOpen={onOpen} />)}</div>
      {!!earlier.length && <button type="button" className="ab-project-overview__earlier" onClick={() => setMore(!more)}>{more ? 'Hide earlier' : `Show ${earlier.length} earlier`}</button>}
    </section>
    <section data-testid="project-landed"><div className="ab-project-overview__heading"><h2>Landed · rate it</h2>{tasksReady && <span>{landed.length}</span>}</div>
      {tasksReady ? landed.length ? <LandedRows tasks={landed} all={all} agents={agents} onOpen={onTask} /> : <p className="siso-org__muted">Nothing to rate yet.</p> : <p className="siso-org__muted">{tasksFailed ? 'Tasks unavailable.' : 'Reading tasks…'}</p>}
    </section>
  </div>;
}
