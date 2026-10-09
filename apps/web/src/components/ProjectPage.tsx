// uihub: siso:stat-tile, arc:tabs, arc:sortable-data-table; extends the EntityPage inspiration shelf.
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowUpRight, CheckCircle2, ListChecks, X } from 'lucide-react';
import { EntityPage } from './EntityPage';
import { AgentFace, faceFor } from '../lib/face';
import { TaskTree, taskProgress } from './panel/TaskTree';
import { LandedRows } from './panel/LandedRows';
import { useProjectCrew } from '../lib/use-project-crew';
import { projectTasks } from '../lib/project-crew';
import { projectEntity, projectTaskLane, projectTaskRows, projectWithEntityOwner } from '../lib/project-page';
import type { Agent, OrgProject } from '../lib/agents';
import type { EntityPageData } from '../lib/org-types';
import type { TaskSummary } from './widgets/TasksWidget';
import './ProjectPage.css';
import { SprintLine, TaskBoard } from './TaskBoard';
import { useBoard } from '../lib/board';
import { useSharedState } from '../lib/poll';
import type { Org } from '../lib/agents';
import type { WorkingBrief } from '../../../../services/node/src/working-brief';

type Props = { project:OrgProject; entity?:EntityPageData|null; agents:Agent[]; onOpen:(name:string)=>void; onTask:(id:string)=>void; onCrumb:()=>void; error?:string|null; loading?:boolean; live?:ReactNode; overview?:ReactNode; onStart?:(s:{name:string;project:string})=>Promise<string|null> };
type Data = { owner?:Agent; shown:Agent[]; earlier:Agent[]; tasks:TaskSummary[]; tasksReady:boolean; tasksFailed:boolean; error:boolean; brief?:WorkingBrief|null; briefError?:boolean; sprint?:import('../lib/board').Board['sprint'] };
const tabs = ['Overview','Tasks','Momentum'] as const;
// t-0567: Agent Base's page is its task board; the old Overview (owner cards, face grid, stats strip) is gone for it.
const boardTabs = ['Tasks','Momentum'] as const;
const stamp = (at:string) => Number.isFinite(Date.parse(at)) ? new Date(at).toLocaleString('en-GB',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}) : 'Time not recorded';

export function ProjectRoute({id,org,...props}:Omit<Props,'project'|'entity'|'loading'|'error'> & {id:string;org:Org|null}) {
  const {data,error}=useSharedState<OrgProject & {page?:EntityPageData|null;error?:string}>(`/api/org/project/${encodeURIComponent(id)}`,15000);
  const registered=org?.groups.flatMap(g=>g.projects).find(p=>p.id===id);
  const project=projectWithEntityOwner(registered ?? (data&&!data.error?data:null) ?? {id,name:id,group:'labs',shown:true,order:0,owners:[]},data?.page);
  return <ProjectPage {...props} project={project} entity={data?.page} loading={!data&&!error} error={error||data?.error? 'Project details could not be read. The last available project shell is shown.':null}/>;
}

export function ProjectPage(props:Props) {
  const crew=useProjectCrew(props.project,props.agents);
  const board=props.project.id==='agent-base';
  const brief=useSharedState<WorkingBrief>(crew.owner&&!board ? `/api/agents/${encodeURIComponent(crew.owner.id)}/working-brief` : null,30000);
  const sprint=useBoard(board?7:null);
  return <ProjectPageView {...props} data={{...crew,error:!!crew.error,brief:brief.data,briefError:!!brief.error,...(board?{sprint:sprint.data?.sprint??null}:{})}} />;
}

/** Pure view is shared by the route and sealed preview; no second fixture-only implementation. */
export function ProjectPageView({project,entity,onOpen,onTask,onCrumb,error,loading,live,overview,onStart,data}:Props & {data:Data}) {
  const board=project.id==='agent-base', shownTabs:readonly typeof tabs[number][]=board?boardTabs:tabs;
  const [tab,setTab]=useState<typeof tabs[number]>(board?'Tasks':'Overview');
  const [person,setPerson]=useState<string|null>(null), [earlier,setEarlier]=useState(false);
  const [selected,setSelected]=useState<TaskSummary|null>(null);
  const dialog=useRef<HTMLDialogElement>(null), trigger=useRef<HTMLButtonElement|null>(null);
  const all=projectTasks(project,data.tasksReady?data.tasks:[]), roots=projectTaskRows(all,person);
  const roster=[...new Map([...(data.owner?[data.owner]:[]),...data.shown,...(earlier?data.earlier:[])].map(a=>[a.id,a])).values()];
  const page=entity ?? projectEntity(project,data.owner);
  const current=all.find(t=>/^\s*NOW:/i.test(t.next??'')) ?? all.find(t=>t.stage==='building');
  const workingBrief=board ? <SprintLine sprint={data.sprint}/> : <section className="pp-commitment"><ListChecks size={22}/><small>Owner’s working brief</small>
    {data.brief?.state==='available' ? <>
      <h2>{data.brief.heading??'Recorded commitment'}</h2>
      <p className="pp-brief-excerpt">{data.brief.text?.slice(0,420)||'No commitment text recorded.'}</p>
      <span>{data.brief.source} · {stamp(data.brief.updated??'')}{data.briefError?' · refresh failed; last read':''}</span>
      {(data.brief.text?.length??0)>420&&<details><summary>Read the working brief</summary><p className="pp-brief-full">{data.brief.text}</p>{data.brief.truncated&&<span>Excerpt capped at 6,000 characters.</span>}</details>}
    </> : <><h2>{current?.title??'No current commitment recorded'}</h2><p>{current?.next?.replace(/^\s*NOW:\s*/i,'')??'The next step will appear when the owner records it.'}</p><span>{data.brief?.state==='private'?'Working brief is private.':data.briefError||data.brief?.state==='unavailable'?'Working brief unavailable.':!data.owner?'Owner offline.':'No working brief read yet.'}{current?` Task index · ${current.id} · ${stamp(current.updated)}`:''}</span></>}
    {current&&<button onClick={()=>{setTab('Tasks');setPerson(null);}}>View the plan <ArrowUpRight size={14}/></button>}
  </section>;
  useLayoutEffect(()=>{if(selected&&!dialog.current?.open)dialog.current?.showModal();},[selected]);
  const close=()=>{dialog.current?.close();setSelected(null);trigger.current?.focus();};
  const select=(task:TaskSummary,button:HTMLButtonElement)=>{trigger.current=button;setSelected(task);};
  // t-0567: Agent Base's own list is its task board (one store, five lanes); other projects keep the stage ledger.
  const lanes=board ? <div className="pp-ledger"><TaskBoard tasks={data.tasks} onTask={onTask}/></div> : null;
  const tasks=lanes ?? <div className="pp-ledger">
    {!data.tasksReady ? <p role="status">{data.tasksFailed?'Task source unreadable. No task totals are available.':'Reading tasks…'}</p> : <>
      {data.tasksFailed&&<p role="status" className="pp-warning">Task refresh failed. Showing the last read; states may be stale.</p>}
      {['Now','Next','Blocked','Unavailable','Done','Dropped'].map(lane=>{const rows=roots.filter(t=>projectTaskLane(t)===lane);return rows.length ? <section key={lane} aria-label={lane}>
        <h2>{lane}<span>{rows.length}</span></h2>
        {rows.map(task=><article className="pp-task" key={task.id} data-task={task.id}>
          <div className="pp-task-main"><button onClick={e=>select(task,e.currentTarget)}><small>{task.id} · {task.stage}</small><strong>{task.title}</strong></button>
            {task.source==='unavailable'&&<p role="status">Task record unreadable; showing the index entry.</p>}
            <p>{task.next?.replace(/^\s*NOW:\s*/i,'')??'Next step not recorded'}</p>{all.some(t=>t.parent===task.id)&&<details className="pp-plan"><summary>Plan · {taskProgress(task,all)} steps done</summary><TaskTree task={task} all={all}/></details>}</div>
          <div className="pp-task-people"><span>Owner <b>{task.owner??'Unassigned'}</b></span><span>Executor <b>{task.agent??task.owner??'Unassigned'}</b></span><span>{taskProgress(task,all)??'No steps recorded'}</span></div>
        </article>)}
      </section>:null;})}
      {!roots.length&&<p className="pp-empty">{person?`No tasks assigned to ${person}.`:'No tasks recorded for this project yet.'}</p>}
    </>}
  </div>;
  const momentum=<section className="pp-momentum"><h2>What moved forward</h2>
    {!data.tasksReady&&<p role="status">{data.tasksFailed?'Task source unreadable.':'Reading tasks…'}</p>}
    {data.tasksFailed&&data.tasksReady&&<p role="status" className="pp-warning">Showing the last read; activity may be stale.</p>}
    {roots.filter(t=>t.source!=='unavailable'&&['live','integrated','happy','preview','feedback','tested','built'].includes(t.stage)).sort((a,b)=>b.updated.localeCompare(a.updated)).map(t=><button key={t.id} onClick={e=>select(t,e.currentTarget)}><CheckCircle2 size={18}/><span><small>{t.stage==='live'&&t.live_at?stamp(t.live_at):stamp(t.updated)} · {t.stage}</small><strong>{t.title}</strong><span>{t.next??'No outcome detail recorded'}</span></span><ArrowUpRight size={16}/></button>)}
    {data.tasksReady&&!roots.some(t=>t.source!=='unavailable'&&['live','integrated','happy','preview','feedback','tested','built'].includes(t.stage))&&<p>No readable progress records. Running agents are shown in Crew.</p>}
  </section>;
  const controls=<>
    {entity&&workingBrief}
    {error&&<p className="pp-warning" role="alert">{error}</p>}
    {loading&&<p className="pp-source" role="status">Reading project details…</p>}
    {!board&&<section className="pp-crew" aria-label="Crew"><div className="pp-section-title"><h2>Crew</h2><span>{roster.filter(a=>a.status==='working').length} working</span><button aria-pressed={!person} onClick={()=>setPerson(null)}>All work</button></div>
      {data.error&&<p role="status" className="pp-warning">Crew refresh unavailable; showing the last read.</p>}
      <div className="pp-crew-band">{roster.map(a=><button key={a.id} aria-pressed={person===a.name} onClick={()=>{setPerson(person===a.name?null:a.name);setTab('Tasks');}}><AgentFace {...faceFor({...a,project:project.name})} size={32}/><span><b>{a.name}</b><small>{a.id===data.owner?.id?'Owner':'Executor'} · {a.status}</small></span></button>)}
      {!roster.length&&<p>{project.owners.length?'Owner offline. The project and its work remain here.':'No crew yet.'}</p>}</div>
      {!!data.earlier.length&&<button onClick={()=>setEarlier(!earlier)} aria-expanded={earlier}>{earlier?'Hide earlier':`Show ${data.earlier.length} earlier`}</button>}
    </section>}
    <div className="pp-tabs" role="tablist" aria-label="Project views">{shownTabs.map((name,i)=><button key={name} role="tab" id={`pp-tab-${name}`} aria-controls="pp-panel" aria-selected={tab===name} tabIndex={tab===name?0:-1} onClick={()=>setTab(name)} onKeyDown={e=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;e.preventDefault();const next=e.key==='Home'?0:e.key==='End'?shownTabs.length-1:(i+(e.key==='ArrowRight'?1:-1)+shownTabs.length)%shownTabs.length;setTab(shownTabs[next]);document.getElementById(`pp-tab-${shownTabs[next]}`)?.focus();}}>{name}</button>)}</div>
    {tab==='Overview'&&roots.some(t=>t.stage==='preview'||t.stage==='feedback')&&<section className="pp-landed"><h2>Landed · rate it</h2><LandedRows tasks={roots.filter(t=>t.stage==='preview'||t.stage==='feedback')} all={all} agents={roster} onOpen={onTask}/></section>}
  </>;
  return <div className="project-page" data-testid="project-page">
    <EntityPage page={page} crumb={[project.group==='agency'?'SISO Agency':project.group==='family'?'SISO Family':'SISO Labs',project.name]} onCrumb={onCrumb} onOpen={onOpen} onStart={onStart}
      stage={!entity?workingBrief:undefined}
      afterHeader={controls} contentId="pp-panel" contentLabelledBy={`pp-tab-${tab}`}>
      {tab==='Overview'&&entity?undefined:<div>
        {tab === 'Momentum' ? momentum : <>
          {tab === 'Overview' && <>{live}<div className="pp-summary">{['Now','Next','Blocked','Done'].map(lane => <div key={lane}><b>{data.tasksReady ? roots.filter(t => projectTaskLane(t) === lane).length : '—'}</b><span>{lane}</span></div>)}</div></>}
          {tab === 'Overview' && overview ? overview : tasks}
        </>}
      </div>}
    </EntityPage>
    <dialog ref={dialog} role="dialog" aria-modal="true" aria-labelledby="pp-task-title" className={`pp-dialog${selected ? " is-open" : ""}`}
      onKeyDown={e=>{if(e.key!=='Tab')return;const controls=[...e.currentTarget.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex="0"]')].filter(el=>el.getClientRects().length);if(!controls.length)return;e.preventDefault();const index=controls.indexOf(document.activeElement as HTMLElement);controls[(index+(e.shiftKey?-1:1)+controls.length)%controls.length].focus();}}
      onCancel={e=>{e.preventDefault();close();}} onClose={()=>{setSelected(null);trigger.current?.focus();}}>
      <button className="pp-close" aria-label="Close task details" onClick={close}><X size={20}/></button>
      {selected&&<><small>{selected.id} · {selected.stage}</small><h2 id="pp-task-title">{selected.title}</h2><p>Owner: {selected.owner??'Unassigned'} · Executor: {selected.agent??selected.owner??'Unassigned'}</p><h3>His words</h3><p>{selected.his||'No words recorded.'}</p><TaskTree task={selected} all={all}/><button onClick={()=>{close();onTask(selected.id);}}>Open full task <ArrowUpRight size={14}/></button></>}
    </dialog>
  </div>;
}
