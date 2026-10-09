import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ChatView } from '../src/components/ChatView';
import { Sidebar } from '../src/components/Sidebar';
import { AgentFace } from '../src/lib/face';
import type { Agent } from '../src/lib/agents';
import '../src/index.css';
import './idle-sleep.css';
let mode = new URLSearchParams(location.search).has('before') ? 'idle' : 'asleep';
const at = new Date('2026-10-08T10:52:00+07:00').getTime();
const sleep = { asleepAt: at, rssAtSleep: 98, keepAwake: false };
const log = [
  { t: 'user', text: 'Finish the preview and check both widths.', at: at - 50_000, from: 'app' },
  { t: 'text', id: 'answer', text: 'The preview is ready. Desktop and phone checks passed, and the evidence is saved.', at: at - 40_000 },
  { t: 'result', status: 'completed', ms: 10000, at: at - 40_000 },
];
class FakeSocket {
  static CONNECTING=0; static OPEN=1; static CLOSING=2; static CLOSED=3;
  readyState=0; onopen: (() => void) | null=null; onclose: (() => void) | null=null; onmessage: ((m: { data:string }) => void) | null=null;
  constructor() { setTimeout(() => { this.readyState=1; this.onopen?.(); this.hello(mode !== 'idle'); }, 20); }
  emit(e: unknown) { this.onmessage?.({data:JSON.stringify(e)}); }
  hello(asleep: boolean) { this.emit({t:'hello',name:'STUDIO-BUILD',session:'fixture-thread',state:'idle',model:'fixture-model',log,partial:{},tasks:[],bg:[],...(asleep ? {sleep:{...sleep,...(mode==='failed'?{error:'Could not wake: runner not responding (pid 60101)'}:{})}} : {}),capabilities:{version:1,auto:true,steer:false,images:false,activeTurnId:null,compacting:false}}); }
  send(raw: string) {
    const m=JSON.parse(raw);
    if(!['prompt','keep_awake'].includes(m.t))return;
    this.emit({t:'sleep',...sleep,waking:true});
    setTimeout(() => {
      if(mode==='failed' || m.text==='FAIL') { const text='Could not wake: runner not responding (pid 60101)';this.emit({t:'sleep',...sleep,error:text});this.emit({t:'prompt.receipt',key:m.key,id:m.messageId,phase:'failed',code:'wake_failed',text,queueRevision:0});return; }
      this.hello(false);
      this.emit({t:'prompt.receipt',key:m.key,id:m.messageId,phase:'accepted',queueRevision:1});
      window.dispatchEvent(new Event('fixture-awake'));
    }, 700);
  }
  close() { this.readyState=3; }
}
(window as unknown as {WebSocket: unknown}).WebSocket=FakeSocket;
const noop=()=>{};
function Preview() {
  const [state,setState]=useState(mode);
  mode=state;
  const a={id:'service-STUDIO-BUILD',key:'service/STUDIO-BUILD',pane:'',name:'STUDIO-BUILD',title:'Preview and checks',row:'live',status:'idle',since:at,tool:'codex',cwd:'/fixture',folder:'',machine:'Laptop',machineKey:'MB',zero:false,project:'Agent Base',chat:true,host:true,pinned:false,main:true,pages:[],serviceHost:{name:'STUDIO-BUILD',state:state==='idle'?'live':'asleep',...sleep}} as Agent;
  return <div className="sleep-preview">
    <header><AgentFace name="Agent Base" project="Agent Base" size={24}/><strong>Agent Base</strong><label>Synthetic state <select aria-label="Synthetic state" value={state} onChange={e=>setState(e.target.value)}><option value="idle">Before · finished, idle</option><option value="asleep">Asleep</option><option value="failed">Wake failed</option></select></label></header>
    <div className="sleep-preview-body">
      <aside><Sidebar agents={[a]} domains={[]} error={null} activeId={a.id} onOpen={noop} onAct={noop} onEdit={noop} onReorder={noop} onReorderProjects={noop} onWorkers={noop} onRename={noop} org={null} onOrg={noop} onPage={noop} onProjectDashboard={noop} onEndedPage={noop} onDashboard={noop}/></aside>
      <main><ChatView key={state} agentId={a.id} agentName={a.name} active people={{}} accent="130 160 255"/></main>
    </div>
  </div>;
}
createRoot(document.getElementById('root')!).render(<Preview/>);
