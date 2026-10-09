// uihub: arc:notification-center
// Synthetic preview only. Every API call is handled in memory; no node or agent connection.
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { Attention } from '../src/lib/attention';
import type { OwnerNote } from '../src/components/OwnerLinkToast';
import { bellItems } from '../src/lib/bell';
import '../src/index.css';
import './bell.css';

const before = new URLSearchParams(location.search).has('before');
const { AttentionPanel } = before ? await import('./bell-baseline/AttentionPanel') : await import('../src/components/AttentionPanel');
const { NotificationsBell } = before ? await import('./bell-baseline/NotificationsBell') : await import('../src/components/NotificationsBell');
const settings = {desktop:false,phone:false,phoneConfigured:false,appUrl:'',snoozeUntil:0};
let generation=0;
const make = (index: number, phase: Attention['phase'] = 'needs'): Attention => ({
  id:`activity:fixture-${index}`,ref:{hostInstanceId:`fixture-host-${index}`,sessionId:`fixture-session-${index}`,runId:`fixture-run-${generation}`},
  requestId:'same-request-id',requestKind:'approval',phase,at:`2026-10-08T09:${String(index%60).padStart(2,'0')}:00Z`,
  agentId:`fixture-agent-${index}`,agentName:index===0?'Agent Zero':index===1?'Astra':'Builder '+index,
  headline:phase==='needs'?'Review the isolated preview build':phase==='failed'?'Preview check needs another pass':'Preview build is ready to inspect',
  read:false,revision:1,buzz:false,delivery:'off',
});
let items: Attention[] = [make(1),make(0),make(2,'completed')];
let healthy = true;
let mode = 'ok';
export const fixtureCommands: unknown[] = [];
Object.assign(window, {bellFixture:{commands:fixtureCommands,setMode:(value:string)=>{mode=value;}}});
window.fetch = async (input, init) => {
  const url = typeof input==='string'?input:input instanceof URL?input.pathname:input.url;
  if(!url.startsWith('/api/attention')) throw Error('Synthetic bell preview blocks non-fixture requests');
  const id = decodeURIComponent(url.split('/')[3]??'');
  const item = items.find(i=>i.id===id);
  const body = JSON.parse(String(init?.body??'{}'));
  if(url.endsWith('/read')&&item) item.read=true;
  if(url.endsWith('/command')) {
    fixtureCommands.push(body);
    await new Promise(resolve=>setTimeout(resolve,100));
    if(mode==='uncertain') throw new TypeError('Fixture disconnected');
    if(mode==='stale'||!item||body.expectedRevision!==item.revision||body.ref.hostInstanceId!==item.ref.hostInstanceId||body.ref.sessionId!==item.ref.sessionId)
      return Response.json({status:'stale'},{status:409});
    if(['approve','deny'].includes(body.action.kind)) {item.phase='resolved';item.revision++;}
  }
  return Response.json({ok:true,status:'accepted',items:[...items],settings,healthy});
};
function Preview() {
  const [rows,setRows] = useState(items);
  const [open,setOpen] = useState(false);
  const [status,setStatus] = useState('Choose a fixture state. Actions stay in this preview.');
  const [revision,setRevision] = useState(0);
  const notes: OwnerNote[] = [];
  const refresh=async()=>{setRows([...items]);setRevision(value=>value+1);};
  function state(name:string) {
    localStorage.removeItem('ab.bell.later.v1');
    dispatchEvent(new StorageEvent('storage',{key:'ab.bell.later.v1',newValue:'{}'}));
    generation++;healthy=true;mode='ok';fixtureCommands.length=0;
    items=name==='Nothing'?[]:name==='Outcomes only'?[make(2,'completed'),make(3,'failed')]:name==='Many (35)'?Array.from({length:35},(_,i)=>make(i,i%3===2?'completed':'needs')):[make(1),make(0),make(2,'completed')];
    if(name==='Snoozed') {
      const key=bellItems(items)[0].identity;
      const value=JSON.stringify({[key]:Date.now()+15*60_000});
      localStorage.setItem('ab.bell.later.v1',value);dispatchEvent(new StorageEvent('storage',{key:'ab.bell.later.v1',newValue:value}));
    }
    setRows([...items]);setOpen(true);setStatus(`${name} · synthetic fixture`);
  }
  return <main className="bell-preview" data-revision={revision}>
    <header className="bell-preview__strip"><strong>Agent Base <span>Bell preview</span></strong><NotificationsBell {...{items:rows,needs:rows.filter(i=>i.phase==='needs').length,ownerNotes:notes,open,onToggle:()=>setOpen(!open)}} /></header>
    <section className="bell-preview__intro"><p className="bell-preview__eyebrow">{before?'ORIGIN/MAIN BASELINE':'ASTRA · 08 OCTOBER'} / FIXTURE ONLY</p><h1>Needs you.<br/><span>Then outcomes.</span></h1><p>One home for decisions and finished work.<br/>Reading a request keeps it open.</p>
      <div className="bell-preview__states">{['Nothing','Needs you','Outcomes only','Snoozed','Many (35)'].map(name=><button type="button" key={name} onClick={()=>state(name)}>{name}</button>)}</div>
      <p role="status" data-testid="fixture-status">{status}</p>
      <div className="bell-preview__edges">
        <button type="button" onClick={()=>{const item=bellItems(items).find(i=>i.phase==='needs')?.attention;if(item){item.phase='resolved';item.revision++;void refresh();}}}>Withdraw first request</button>
        <button type="button" onClick={()=>{healthy=!healthy;void refresh();}}>Toggle feed unavailable</button>
      </div>
    </section>
    {open&&<div className="ab-attention-anchor"><AttentionPanel items={rows} ownerNotes={notes} settings={settings} healthy={healthy} refresh={refresh} onClose={()=>setOpen(false)} onOpen={id=>{const item=items.find(i=>i.id===id);if(item)item.read=true;void refresh();setStatus(`Opened chat for ${item?.agentName}`);setOpen(false);}}/></div>}
  </main>;
}
createRoot(document.getElementById('root')!).render(<Preview/>);
