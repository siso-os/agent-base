import {useState} from 'react';
import {createRoot} from 'react-dom/client';
import {refresh} from '../src/lib/poll';
import {ChatView} from '../src/components/ChatView';
import {ZeroOrbit} from '../src/components/ZeroOrbit';
import {ZeroPipelineMetric} from '../src/components/DeliveryEvidence';
import type {Agent} from '../src/lib/agents';
import '../src/index.css';
const sha='a'.repeat(40),now=Date.now();let socket:FixtureSocket;
const delivery={id:'d1',taskId:'fixture-task',title:'Synthetic delivery example',agentKey:'fixture',session:'fixture-session',prompt:{id:'p1',at:new Date(now-180_000).toISOString(),source:'fixture-prompt-ledger'},live:{id:'l1',at:new Date(now-60_000).toISOString(),source:'fixture-live-ledger',revision:sha,verified:true},evidence:{state:'available',pairs:[{id:'sample',title:'Synthetic pair',before:`/api/releases/${sha}/evidence/sample/before`,after:`/api/releases/${sha}/evidence/sample/after`,beforeSha:'b'.repeat(40),afterSha:sha}]}};
let cliRows:unknown[]=[];
window.fetch=async input=>new Response(JSON.stringify(String(input).includes('/api/delight')?{deliveries:[delivery]}:String(input).includes('/subagents')?{session:'fixture-session',rows:cliRows,running:cliRows.length,tokens:0}:{}),{headers:{'content-type':'application/json'}});
const hello=()=>({t:'hello',session:'fixture-session',state:'working',log:[{t:'user',text:'Synthetic lifecycle test',from:'app',at:now-300_000},{t:'tool',id:'history',name:'Agent',summary:'Historical worker',at:now-200_000},{t:'tool_done',id:'history',ok:true,at:now-190_000}],partial:{},tasks:[],bg:[]});
class FixtureSocket {static OPEN=1;readyState=1;onopen=null;onclose=null;onmessage=null;constructor(){socket=this;setTimeout(()=>{this.onopen?.();this.emit(hello());},30);}emit(e){this.onmessage?.({data:JSON.stringify(e)});}send(){throw Error('Fixture must not send');}close(){this.readyState=3;}}
Object.assign(window,{WebSocket:FixtureSocket,__delight:{emit:(e)=>socket.emit(e),hello:()=>socket.emit(hello()),cli:async(rows)=>{cliRows=rows;await refresh('/api/agents/fixture/subagents');},flightCount:0}});
new MutationObserver(records=>{for(const record of records)for(const node of record.addedNodes)if(node instanceof HTMLElement&&node.matches('[data-testid=flight]'))(window as any).__delight.flightCount++;}).observe(document.body,{childList:true});
function Fixture(){const [stale,setStale]=useState(false),[selected,setSelected]=useState('none');const research={fleets:{at:stale?now-60_000:Date.now(),error:null,data:[{name:'Fixture batch',created:new Date(now).toISOString(),finished:null,model:'synthetic',topic:'Fixture',jobs:[{id:'job',status:'running',output:null,error:null}],then:null}]},topics:{at:now,error:null,data:[]}};
return <main style={{height:'100vh',display:'flex',flexDirection:'column',color:'var(--crm-color-text-strong)'}}><header style={{padding:12}}><b>Isolated synthetic delight events</b><button onClick={()=>setStale(v=>!v)}>Toggle stale research</button><output>{selected}</output><ZeroPipelineMetric agentKey="fixture"/></header><div style={{position:'relative',flex:1,minHeight:0}}><ChatView agentId="fixture" agentKey="fixture" active hud={<button data-testid="faces-pill" style={{display:'block',width:110,height:28}}>Workers</button>}/></div><ZeroOrbit zero={{hud:null} as Agent} needs={[]} research={research} onOpenResearch={s=>setSelected(s.fleet)}/></main>}
createRoot(document.getElementById('root')!).render(<Fixture/>);
