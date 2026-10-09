// Task-owned, synthetic-only renderer. Network isolation is supplied by the capture runner.
import {createRoot} from 'react-dom/client';
import {fixtureResponse} from '../../../tools/ab-qa-fixtures.mjs';
import '../src/index.css';
import '../src/components/AgentPanel.css';
import '../src/components/Phone.css';
const get=(p:string):any=>fixtureResponse(p,'0'.repeat(40)), noop=()=>{}, now=Date.now();
const a={...get('/api/agents').agents[0],id:'fixture-zero',name:'Fixture Zero',pinned:true,status:'idle',zero:true,hud:null};
const id=new URLSearchParams(location.search).get('surface')??'servers';
const source='/src/components/';
const sources:Record<string,string>={'servers':'ServersSpace','tokens':'TokensSpace','stats':'StatsPage','ended':'EndedPage','starred':'StarredPage','research':'ResearchPage','codex-work':'CodexWorkPage','life':'LifeSpace','voice':'VoiceSpace','rolodex':'RolodexSpace','entity':'EntityPage','product-map':'ProductMap','org-chart':'OrgChart','whatsnew':'WhatsNew','laptop-jobs':'LaptopJobsPage','dictation':'DictationSpace','mini-lanes':'MiniLanes','codex-worker':'CodexWorkerPage','agent-zero-page':'AgentZeroPage','chat-header':'ChatHeader','agent-zero-board':'panel/A0Board'};
const entity:any={kind:'client',id:'fixture',name:'Fixture Studio',kicker:['Synthetic client'],line:{text:'A synthetic project record for component review.',src:'Fixture'},since:null,tags:[{label:'Review',tone:'working'}],owner:{mode:'record',name:'Fixture owner',state:'idle',sentence:'Synthetic owner',why:{text:'Component capture only',src:'Fixture'},crew:[],planned:null},stats:[{label:'Open work',period:'Fixture',value:'1',line:'Synthetic task',src:'Fixture'}],activity:{days:[{date:'2026-10-05',n:3}],src:'Fixture'},live:[],thumbs:[],work:{open:1,total:2,byState:{building:1,done:1},items:[{id:'fixture-task',title:'Review component states',state:'building'}],src:'Fixture'},clients:[],built:[{title:'Preview',line:'Synthetic review surface',chip:'Fixture',tone:'neutral'}],people:[{name:'Avery Fixture',note:'Synthetic collaborator',contact:false}],happened:[],assets:[],notes:[{text:'No client data is connected.',src:'Fixture'}],missing:[]};
let node;
if(id==='terminal'){
 const {TerminalView}=await import('@siso/terminal');await import('@siso/terminal/terminal.css');node=<TerminalView socketPath="/term/synthetic-capture/ws" active={false}/>;
}else{
 const m=await import(/* @vite-ignore */source+sources[id]+'.tsx');
 switch(id){
 case 'servers':node=<m.ServersPage agents={[a]} onOpenAgent={noop}/>;break;
 case 'tokens':node=<m.TokensPage/>;break;
 case 'stats':node=<m.StatsPage stats={get('/api/agents/fixture/stats')}/>;break;
 case 'ended':node=<m.EndedPage ended={get('/api/ended').ended} onOpen={noop}/>;break;
 case 'starred':node=<m.StarredPage agents={[a]} pins={[]} workspaces={[]} pages={[]} onOpenAgent={noop} onOpenPage={noop} onEdit={noop} onUnpinPage={noop}/>;break;
 case 'research':node=<m.ResearchPage/>;break;
 case 'codex-work':node=<m.CodexWorkPage/>;break;
 case 'life':node=<m.LifeMain selected="today"/>;break;
 case 'voice':node=<m.VoiceMain selected="history"/>;break;
 case 'rolodex':node=<m.RolodexMain book={{data:get('/api/rolodex/book'),loading:false,reload:async()=>{},act:async()=>({}),hide:noop}} selected="all" onSelect={noop} person={null} onPerson={noop} projectHref={()=>'#fixture'}/>;break;
 case 'entity':node=<m.EntityPage page={entity} crumb={['Clients','Fixture Studio']} onCrumb={noop} onOpen={noop}/>;break;
 case 'product-map':node=<m.ProductMap/>;break;
 case 'org-chart':node=<m.OrgChart org={get('/api/hub/org')} agents={[a]} roster={get('/api/org')} onOpen={noop}/>;break;
 case 'whatsnew':node=<m.WhatsNewPage/>;break;
 case 'laptop-jobs':node=<m.LaptopJobsPage onBack={noop}/>;break;
 case 'dictation':node=<m.DictationSpace/>;break;
 case 'mini-lanes':node=<m.MiniLanePage name="fixture" onBack={noop}/>;break;
 case 'codex-worker':node=<m.CodexWorkerPage agent={a}/>;break;
 case 'agent-zero-page':{const w=(shape:string,data:any)=>({id:shape,agent:'a0',title:shape,shape,updated:new Date(now).toISOString(),data});node=<m.AgentZeroPage data={get('/api/hub/a0')} widgets={{needs:w('needs',{items:[{id:'fixture',title:'Review the synthetic page',detail:'Component review only',minutes:1}]}),progress:w('progress',{checked:1,total:2,counts:{building:1,checked:1},items:[]}),team:w('team',{members:[]}),systems:w('systems',{servers:[],heavy:'Synthetic fixture'}),list:w('list',{rows:[]})}}/>;break;}
 case 'agent-zero-board':node=<div style={{width:'min(100%,540px)',margin:'auto',height:'100%',display:'flex'}}><m.A0Board a={a} agents={[a]}/></div>;break;
 case 'chat-header':node=<m.ChatHeader a={a} state="idle" doing="Review component capture" onIt="Synthetic work" needText={null} move={null} tasks={null} tasksOpen={false} onTasks={noop} view="chat" onView={noop} cardOpen={false} onCard={noop} renaming={false} onRenameStart={noop} onRename={noop} pinned={false} onPin={noop} toHost={null} onOpenPage={noop} onAnswer={noop} now={now} org={null} agents={[a]} onOpenAgent={noop} onOrgChart={noop} doingOf={()=>'Synthetic work'}/>;break;
 }
}
createRoot(document.getElementById('root')!).render(<main style={{height:'100vh',display:'flex',flexDirection:'column',width:'100%',minWidth:0,background:'var(--crm-color-canvas)',color:'var(--crm-color-text)'}}><header style={{padding:'10px 20px',font:'12px system-ui',background:'#252b24',borderBottom:'1px solid #40503a'}}>SYNTHETIC COMPONENT CAPTURE · {id} · no live account or agent connected</header><section data-capture-component={id} style={{flex:1,minHeight:0,minWidth:0,overflow:'auto',padding:id==='terminal'?0:20}}>{node}</section></main>);
