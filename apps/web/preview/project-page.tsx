import React, {useState} from 'react';
import {createRoot} from 'react-dom/client';
import {ProjectPageView,ProjectRoute} from '../src/components/ProjectPage';
import {projectEntity} from '../src/lib/project-page';
import type {Agent,OrgProject} from '../src/lib/agents';
import type {TaskSummary} from '../src/components/widgets/TasksWidget';
import '../src/index.css';

const project:OrgProject={id:'preview-project',name:'Project studio',group:'labs',shown:true,order:0,line:'One place to see the commitment, the crew and what moved forward.',owners:[{name:'STUDIO-OWNER',main:true,domain:'Own the outcome and check every return.',icon:'box',state:'live',working:1,plan:null}]};
const agent=(name:string,id:string,status='working')=>({id,name,title:name,project:project.id,status,row:'live',since:Date.now()-60000,tool:'codex',machine:'MB',cwd:'/fixture',pane:'fixture',session:null,context:null} as Agent);
const owner=agent('STUDIO-OWNER','fixture-owner');
const worker=agent('STUDIO-BUILD','fixture-worker');
const task=(id:string,title:string,stage:TaskSummary['stage'],extra:Partial<TaskSummary>={}):TaskSummary=>({id,title,stage,project:project.id,priority:'P1',owner:'STUDIO-OWNER',agent:'STUDIO-BUILD',model:null,updated:'2026-10-08T02:00:00Z',...extra});
const tasks=[task('demo-1','Bring the project page together without losing its existing widgets','building',{next:'NOW: Check crew filtering and the complete inline plan',his:'Make the whole project readable in one place.'}),...Array.from({length:40},(_,i)=>task(`demo-step-${i+1}`,`Step ${i+1}: ${i===0?'Keep the current owner visible':'Verify the project outcome and preserve the recorded evidence'}`,i<7?'done':'specced',{parent:'demo-1'})),task('demo-2','Connect the next reviewed design','specced',{agent:'STUDIO-NEXT'}),task('demo-3','Review the missing acceptance receipt','built',{needs:true,next:'The integrating owner needs the evidence before landing.'}),task('demo-4','Project navigation now keeps its identity through reload','live',{live_at:'2026-10-08T02:00:00Z',next:'Checked with synthetic projects at desktop and phone widths.'})];
function Preview(){const [state,setState]=useState('busy'),[action,setAction]=useState('');
 const route=new URLSearchParams(location.search).get('route');
 if(route)return <ProjectRoute id={route} org={{groups:[{id:'labs',name:'SISO Labs',icon:'box',order:0,folders:[],projects:[{...project,id:route,name:route,owners:project.owners}]}]} as never} agents={[{...owner,project:route},{...worker,project:route}]} onOpen={n=>setAction(n)} onTask={setAction} onCrumb={()=>setAction('directory')}/>;
 return <>
 <aside style={{padding:12,display:'flex',gap:12,flexWrap:'wrap',borderBottom:'1px solid #333'}}><label>Synthetic state <select aria-label="Synthetic state" value={state} onChange={e=>setState(e.target.value)}>{['busy','calm','offline','unreadable','empty','stale','client','industry'].map(s=><option key={s}>{s}</option>)}</select></label><output>{action}</output></aside>
 <ProjectPageView key={state} project={state==='empty'?{...project,owners:[]}:project} entity={['client','industry'].includes(state)?{...projectEntity(project,owner),kind:state as 'client'|'industry'}:null} agents={[]} onCrumb={()=>setAction('Project directory')} onOpen={n=>setAction(`Open ${n}`)} onTask={id=>setAction(`Open ${id}`)} data={{owner:['offline','empty'].includes(state)?undefined:{...owner,status:state==='calm'?'idle':'working'},shown:['offline','empty'].includes(state)?[]:[{...worker,status:state==='calm'?'idle':'working'}],earlier:[],tasks:state==='empty'?[]:tasks,tasksReady:state!=='unreadable',tasksFailed:['unreadable','stale'].includes(state),error:state==='stale',brief:['busy','calm','stale'].includes(state)?{state:'available',source:'.agents/HANDOFF.md',updated:'2026-10-08T02:00:00Z',heading:'One place to move the project forward',text:'Keep the owner accountable, make every task readable, and preserve the project’s existing design.\n\nNext: check the complete plan and its evidence at both widths.',truncated:false}:null}}/>
 </>;}
createRoot(document.getElementById('root')!).render(<Preview/>);
