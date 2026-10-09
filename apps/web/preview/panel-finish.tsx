import { createRoot } from 'react-dom/client';
import { useState } from 'react';
import { AgentPanel } from '../src/components/AgentPanel';
import type { Agent } from '../src/lib/agents';
import '../src/index.css';

// This review page is sealed: its API reads are synthetic, and it cannot mutate live records or attach to agents.
const now = new Date().toISOString();
const mode = new URLSearchParams(location.search).get('source') ?? 'ready';
const sources: Record<string, unknown> = {
  '/api/a0/tasks': {counts:{},tasks:[{id:'t-fixture',title:'Confirm the panel preserves the current chat draft',owner:'A0',priority:'P1',project:'SISO',stage:'building',updated:now,model:null}],updated:now},
  '/api/agents/fixture-zero/subagents': {rows:[],running:0},
  '/api/a0/now': {lanes:{at:Date.now(),data:{runs:[{at:now,task:'Review keyboard and phone behavior',dir:'/synthetic/panel',min:4,status:'running',mtok:0,model:'gpt-6-astra'}],pairs:[],tabs:[]},error:null}},
  '/api/a0/board': mode === 'empty' ? {ideas:{items:[],error:null},notes:{items:[],error:null}} : {
    ideas:{items:[{id:'idea-fixture',text:'Keep the board glanceable on a small phone',by:'Shaan',status:'new',why:'Review without leaving the current chat'},{id:'idea-retired',text:'Retired idea must not appear',status:'retired'}],error:null},
    notes:{items:[{id:'note-fixture',text:'Check the panel at three viewport widths',status:'open',why:'Desktop and phone use the same board'}],error:null},
  },
};
const nativeFetch=window.fetch.bind(window);
window.fetch=async (input,init) => {
  const request=new Request(input,init), url=new URL(request.url);
  if(!url.pathname.startsWith('/api/')) return nativeFetch(input,init);
  const data=request.method==='GET' && !(mode==='unavailable' && url.pathname==='/api/a0/board') ? sources[url.pathname] : null;
  return new Response(JSON.stringify(data ?? {error:'Synthetic source unavailable'}),{status:data?200:503,headers:{'Content-Type':'application/json'}});
};
Object.defineProperty(window,'EventSource',{value:undefined,configurable:true});
const zero = { id:'fixture-zero', name:'A0', zero:true, row:'live', status:'working', since:Date.now()-300000, project:'SISO', tool:'codex', machine:'laptop', hud:{} } as Agent;
function Fixture(){
  const [open,setOpen]=useState(false);
  return <main style={{display:'flex',height:'100dvh',background:'var(--crm-color-canvas)',color:'var(--crm-color-text)'}}>
    <section style={{flex:1,padding:24,minWidth:0}}>
      <button data-testid="chat-panel-toggle" onClick={()=>setOpen(!open)}>Panel</button>
      <h1 style={{margin:'20px 0'}}>Agent Zero · synthetic panel fixture</h1>
      <button data-testid="background-action">Background action</button>
      <textarea style={{display:'block',marginTop:20,width:'100%',maxWidth:520,minHeight:90}} aria-label="Chat draft" defaultValue="Draft preserved while reviewing the board" />
    </section>
    <AgentPanel open={open} a={zero} agents={[zero]} org={null} stats={null} people={[]} focus={null} onOpenAgent={()=>{}} onStatsPage={()=>{}} onOrgChart={()=>{}} onPage={()=>{}} onClose={()=>setOpen(false)} />
  </main>;
}
createRoot(document.getElementById('root')!).render(<Fixture/>);
