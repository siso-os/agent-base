import {createRoot} from 'react-dom/client';
import {Hud} from '../src/components/Hud';
import {ChatRim} from '../src/components/Composer';
import {refresh} from '../src/lib/poll';
import type {Agent} from '../src/lib/agents';
import '../src/index.css';
let scenario='fresh';const now=Date.now(),requests:string[]=[];
const windowLimit=(usedPct:number)=>({usedPct,resetsAt:now+3600_000,expired:false});
const data=()=>{
 const claude={id:'claude:fixture',kind:'claude',folder:'claude-fixture',person:{label:scenario==='long'?'Fixture account with a deliberately long reported identity '.repeat(4):'Fixture Claude account',email:'fixture@example.invalid',mine:true},limits:{at:now,source:'Fixture Claude usage cache',fiveHour:windowLimit(22),weekly:windowLimit(75)}};
 const codex={id:'codex',kind:'codex',name:'Codex (fixture plan)',limits:{at:now,source:'Fixture Codex token_count cache',fiveHour:windowLimit(92),weekly:windowLimit(18)}};
 if(scenario==='unknown')return {accounts:[]};
 if(scenario==='malformed')return {accounts:42};
 if(scenario==='stale'){claude.limits.at=now-3600_000;codex.limits.fiveHour.resetsAt=now-1;}
 if(scenario==='partial')claude.limits.weekly=null as never;
 return {at:now,accounts:[claude,codex],scanning:false};
};
window.fetch=async input=>{const url=String(input);requests.push(url);return new Response(JSON.stringify(url==='/api/tokens'?data():url.includes('/subagents')?{rows:[],running:0,tokens:0}:{}),{status:url==='/api/tokens'&&scenario==='error'?503:200,headers:{'content-type':'application/json'}});};
Object.assign(window,{__dualProvider:{requests,scenario:async(value:string)=>{scenario=value;await refresh('/api/tokens');}}});
const params=new URLSearchParams(location.search), variant=params.get('variant')==='strip'?'strip':'rim';
const agent={id:'fixture',name:'Fixture agent',tool:'codex',status:'working',session:'fixture',host:true,chat:true,project:'Fixture',hud:{model:'gpt-6-astra',context:41,tokensIn:45000,tokensOut:1200,cachePct:75,costUsd:0.25,tokensPerSecond:22,at:now,limitsAt:now,fiveHour:{pct:92,resetsAt:now+3600_000},week:{pct:18,resetsAt:now+86400000},effort:'high'}} as Agent;
const hud=<Hud a={agent} onOpenCrew={()=>{}} variant={variant}/>;
createRoot(document.getElementById('root')!).render(<main style={{height:'100vh',display:'flex',flexDirection:'column',padding:variant==='rim'?12:0,color:'var(--crm-color-text-strong)'}}><h1 style={{padding:12,fontSize:16}}>Synthetic dual-provider footer</h1><p style={{padding:12,fontSize:12}}>Actual HUD · cached synthetic data · no live account requests</p><div style={{marginTop:'auto',width:'100%',maxWidth:892,alignSelf:'center'}}>{params.get('copies')==='2'&&<div style={{display:'none'}}>{hud}</div>}{variant==='rim'?<ChatRim working hud={hud}><div style={{height:60,padding:12,fontSize:13}}>Existing composer material</div></ChatRim>:hud}</div></main>);
