// Isolated synthetic fixture: no real HTTP, sockets, prompts, or model changes.
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ChatView } from '../src/components/ChatView';
import { Hud } from '../src/components/Hud';
import { ChatRim } from '../src/components/Composer';
import { ChatHeader, type HeaderProps } from '../src/components/ChatHeader';
import type { Agent } from '../src/lib/agents';
import '../src/index.css';

const sent: unknown[] = [];
Object.assign(window, { __chatPolish: { sent } });
window.fetch = async (input) => {
  const url = String(input);
  const body = url.includes('/subagents') ? { rows: [] } : url.includes('/context') ? { kinds: { files: 500, shell: 200, subagents: 0, talk: 300, tools: 0 }, top: [] } : url.includes('/stats') ? { subagents: { count: 0 } } : {};
  return new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
};
class FixtureSocket {
  static OPEN = 1; readyState = 1; onopen: (() => void) | null = null; onclose: (() => void) | null = null; onmessage: ((e: { data: string }) => void) | null = null;
  constructor() { setTimeout(() => { this.onopen?.(); this.onmessage?.({data:JSON.stringify({t:'hello',session:'synthetic-chat-polish',state:'idle',log:[{t:'text',id:'reply',text:'The fixture preserves selectable replies and the existing input controls.',at:Date.now()},{t:'commands',list:[{name:'compact',description:'Compact the current conversation'},{name:'clear',description:'Start a fresh conversation'}]}],partial:{},tasks:[],bg:[]})}); }, 20); }
  send(raw: string) { sent.push(JSON.parse(raw)); }
  close() { this.readyState = 3; }
}
Object.assign(window, { WebSocket: FixtureSocket });
const noop = () => {};
function Fixture() {
  const [context, setContext] = useState<number | null>(32);
  const [model, setModel] = useState('gpt-6-astra');
  const [nav, setNav] = useState(false);
  const [receipt, setReceipt] = useState<{key:string;text:string}|null>(null);
  const agent = { id:'fixture-agent',name:'Agent Base',tool:'codex',status:'idle',session:'synthetic-chat-polish',host:true,chat:true,zero:false,project:'Agent Base',hud:{model,context,tokensIn:64000,tokensOut:1400,tokensPerSecond:23,cachePct:60,costUsd:1.2,fiveHour:{pct:43,resetsAt:Date.now()+3600000},week:{pct:67,resetsAt:Date.now()+86400000},at:Date.now(),effort:'high',models:[{id:'gpt-6-astra',label:'Astra',description:'Host catalog description',efforts:['low','medium','high']},{id:'gpt-6.1-sol',label:'Sol',description:'Host catalog description',efforts:['low','medium','high','xhigh']}]}} as Agent;
  const header = {a:agent,state:'idle',doing:'Polishing the composer',onIt:'Polishing the composer',needText:null,move:null,tasks:null,tasksOpen:false,onTasks:noop,view:'chat',onView:noop,cardOpen:false,onCard:noop,renaming:false,onRenameStart:noop,onRename:noop,pinned:false,onPin:noop,toHost:null,onOpenPage:noop,onAnswer:noop,now:Date.now(),org:null,agents:[],onOpenAgent:noop,onOrgChart:noop,doingOf:()=>''} as HeaderProps;
  return <div style={{height:'100vh',display:'flex',flexDirection:'column',background:'var(--crm-color-surface)',color:'var(--crm-color-text-strong)'}}>
    <div style={{padding:12,display:'flex',flexWrap:'wrap',gap:12,fontSize:12}}><b>Synthetic chat polish fixture</b><button onClick={()=>setNav(v=>!v)}>Toggle nav width</button><button onClick={()=>setContext(92)}>Context 92</button><button onClick={()=>setContext(48)}>Context 48</button><button onClick={()=>setContext(null)}>Context unknown</button><button onClick={()=>setModel('gpt-6.1-sol')}>Acknowledge model</button><button onClick={()=>setReceipt({key:String(Date.now()),text:'Fixture acknowledgement'})}>Accept fixture</button><button onClick={()=>setReceipt(null)}>Reset receipt</button></div>
    <div style={{display:'flex',minHeight:0,flex:1}}>{nav&&<aside style={{width:innerWidth<500?64:240,flexShrink:0,padding:12,background:'#11151c'}}>Nav</aside>}<main style={{display:'flex',flex:1,minWidth:0,flexDirection:'column'}}><ChatHeader {...header}/><div style={{position:'relative',minHeight:0,flex:1}}>{location.search.includes('receipt')?<div style={{margin:'120px auto',maxWidth:600}}><ChatRim working={false} acceptedReceipt={receipt}><p>Server acceptance contract fixture</p></ChatRim></div>:<ChatView agentId={agent.id} agentName={agent.name} active hud={<Hud a={agent} onOpenCrew={noop} variant="rim"/>}/>}</div></main></div>
  </div>;
}
createRoot(document.getElementById('root')!).render(<Fixture/>);
