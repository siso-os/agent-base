// uihub: arc:command-palette; existing HaloRim, faces and context meter.
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { HaloRim } from '@siso/shell';
import { UsageMeter } from '../src/components/ProviderUsageMeters';
import { ModelMenu, modelLabel } from '../src/components/ModelMenu';
import { AgentFace } from '../src/lib/face';
import { ContextPopover } from '../../../packages/siso-composer/src/ComposerHud';
import { ContextMix, ModelChip, contextSegments, type Mix } from '../src/components/Hud';
import { ContextStack, type ContextSource } from '../src/components/ContextStack';
import type { ClaudeAccounts } from '../../../services/node/src/claude-accounts';
import type { Agent } from '../src/lib/agents';
import type { MoveStatus, MoveTarget } from '../../../services/node/src/move';
import '../src/index.css';
import '../../../packages/siso-composer/src/composer.css';
import '../src/components/Hud.css';
import './model-accounts.css';
const at=Date.now();
const catalog = [{ id: 'claude-opus-5-5[1m]', label: 'Opus', description: 'Deep work and long sessions', efforts: ['low','medium','high','max'] }, { id: 'claude-sonnet-5-5', label: 'Sonnet', description: 'Fast implementation and everyday work', efforts: ['low','medium','high'] }];
const codexCatalog = [{id:'gpt-6-astra',label:'Astra',description:'Complex reasoning and architecture',efforts:['low','medium','high','xhigh']},{id:'gpt-6.1-sol',label:'Sol',description:'Implementation and focused changes',efforts:['low','medium','high']}];
const accounts: ClaudeAccounts={refreshing:false,accounts:[
 {id:'claude-siso-3',name:'lordsisodia',readOnly:false,week:{pct:68,resetsAt:at+5*86400000},usageAt:at,usageStale:false,renewsAt:at+9*86400000,renewalStatus:'active',credits:[{left:82.4,endsAt:at+7*86400000}],billingAt:at,billingStale:false},
 {id:'claude-siso',name:'fuzeheritage',readOnly:false,week:{pct:12,resetsAt:at+6*86400000},usageAt:at,usageStale:false,renewsAt:at+30*86400000,renewalStatus:'active',credits:[{left:210.6,endsAt:at+14*86400000}],billingAt:at,billingStale:false},
 {id:'claude-fahmy',name:'Fahmy’s',readOnly:true,week:null,usageAt:null,usageStale:true,renewsAt:null,renewalStatus:null,credits:null,billingAt:null,billingStale:true}
]};
const mix:Mix={kinds:{files:24000,tools:16000,talk:12000,shell:4000,subagents:8000},top:[{label:'Read Composer.tsx',tokens:12000},{label:'Test output',tokens:8000}],files:[{label:'Composer.tsx',state:'changed'},{label:'ModelMenu.tsx',state:'unchanged'},{label:'reference.md',state:'unknown'}]};
const states=['Idle','Working / steer','Near full','Codex','No catalog','Terminal','Two accounts','Failed upload','Move mid-turn','Stale readings'] as const;
type State=typeof states[number];
function Preview() {
 const [state,setState]=useState<State>('Idle'),[model,setModel]=useState(catalog[0].id),[pending,setPending]=useState<string|null>(null),[effort,setEffort]=useState('high'),[pendingEffort,setPendingEffort]=useState<string|null>(null),[move,setMove]=useState<MoveTarget|null>(null),[source,setSource]=useState<string|null>(null),[retry,setRetry]=useState(false);
 const codex=state==='Codex'||state==='No catalog';
 const terminal=state==='Terminal';
 const working=state==='Working / steer'||state==='Move mid-turn';
 const shownModel=codex?(model.startsWith('gpt-')?model:codexCatalog[0].id):model.startsWith('claude-')?model:catalog[0].id;
 const selectedAccount=state==='Two accounts'?'claude-siso-3':'claude-siso';
 const sources:ContextSource[]=[{id:'source',kind:'document',title:'Composer.tsx',state:'ready',capturedRevision:'capture-a',currentRevision:'capture-b',detail:'Synthetic file changed after it was captured.'},...(state==='Failed upload'?[{id:'upload',kind:'image' as const,title:'mockup.png',state:retry?'ready' as const:'failed' as const}]:[])];
 const snapshot=state==='Stale readings'?{...accounts,accounts:accounts.accounts.map(a=>({...a,usageStale:true,billingStale:true}))}:accounts;
 const status:MoveStatus|null=move?{state:'waiting-idle',message:'Move requested · waiting for this turn to finish'} as MoveStatus:null;
 const change=(next:State)=>{setState(next);setPending(null);setPendingEffort(null);setMove(null);setModel(next==='Codex'||next==='No catalog'?codexCatalog[0].id:catalog[0].id);setRetry(false);};
 if (new URLSearchParams(location.search).has('hosted')) return <main className="model-preview" style={{paddingTop:780}}><ModelChip a={{id:'fixture-seat',session:'fixture-session',tool:'siso',host:true,chat:true,hud:{accountId:'claude-siso',model:catalog[0].id,models:catalog,effort:'high'}} as Agent} model={catalog[0].id}/></main>;
 return <main className="model-preview">
   <header><span>AGENT BASE / COMPOSER</span><b>Fixture lab</b><UsageMeter now={at} accounts={accounts} providers={[{id:"claude",label:"Claude",accounts:[],pct:68,state:"fresh",partial:false,reason:null},{id:"codex",label:"Codex",accounts:[],pct:null,state:"unknown",partial:false,reason:null}]}/></header>
   <h1>The model knows its account.</h1><p className="model-preview__intro">One place for the model, reasoning, weekly limits and next renewal. The current label stays put until the host confirms.</p>
   <nav aria-label="Fixture states">{states.map(s=><button key={s} type="button" aria-pressed={state===s} onClick={()=>change(s)}>{s}</button>)}</nav>
   <div className="model-preview__workspace">
     <div className="model-preview__strip" data-testid="top-strip">Synthetic workspace <span>Local fixture · no connected agents</span></div>
     <iframe title="Fixture webview" srcDoc="<body style='background:#111317;color:#5e6978;font:13px system-ui;padding:20px'>Webview fixture · overlays cover this surface</body>"/>
     <div className="model-preview__turn"><AgentFace name={shownModel} family={codex?'codex':'claude'} size={36}/><div><b>{working?'Working on the composer':'Ready for the next move'}</b><p>{working?'Type now to steer this turn.':'Inspect the account or source breakdown without losing your draft.'}</p></div></div>
     <HaloRim state={working?'working':'idle'}><div className="model-preview__composer">
       <ContextStack sources={sources} variant="strip" expanded={true} onExpandedChange={()=>{}} onInspect={setSource} onRemove={()=>{}} openId={source} onClose={()=>setSource(null)} renderDetail={s=><p>{s.detail??'Synthetic attachment metadata.'}</p>}/>
       {state==='Failed upload'&&!retry&&<div className="model-preview__failure" role="alert">mockup.png · upload failed <button onClick={()=>setRetry(true)}>Retry upload</button></div>}
       <textarea aria-label="Message" defaultValue="Keep the faces and the halo rim." placeholder={working?'Steer this agent…':'What should we build next?'}/>
       <div className="ab-hud is-rim"><ModelMenu key={`${state}:${selectedAccount}`} className="ab-hud__model" label={modelLabel(shownModel)} accounts={snapshot} accountId={codex||terminal?null:selectedAccount} face={<AgentFace name={shownModel} family={codex?'codex':'claude'} size={18}/>} switcher={{model:shownModel,why:terminal?'This terminal picks its model in its own pane':null,harness:terminal?'terminal':codex?'codex':'claude',models:terminal?undefined:state==='No catalog'?[]:codex?codexCatalog:catalog,effort,onSay:()=>{},onModel:setPending,onEffort:setPendingEffort}} current={codex?'sol':'opus'} status={status} onMove={setMove}/>
       <ContextPopover value={state==='Near full'?94:62} segments={codex||terminal?undefined:contextSegments(mix)}><ContextMix agentId="fixture-only" mix={codex||terminal?null:mix}/></ContextPopover><span className="model-preview__steer">{working?'Steer now':'Ready'}</span></div>
     </div></HaloRim>
   </div>
   <div className="model-preview__receipt"><span role="status" data-testid="fixture-status">{pending||pendingEffort?'Awaiting host confirmation':move?'Harness move requested':'Observed model and account'}</span><button disabled={!pending&&!pendingEffort} onClick={()=>{if(pending)setModel(pending);if(pendingEffort)setEffort(pendingEffort);setPending(null);setPendingEffort(null)}}>Confirm from fixture host</button></div>
   {state==='Two accounts'&&<aside className="model-preview__second"><span>Another chat · same model</span><ModelMenu label={modelLabel(catalog[0].id)} accounts={accounts} accountId="claude-siso" switcher={{model:catalog[0].id,why:null,harness:'claude',models:catalog,onSay:()=>{}}}/></aside>}
   <p className="model-preview__foot">Synthetic accounts and dates. No account emails, session reads, model calls or production writes.</p>
 </main>;
}
createRoot(document.getElementById('root')!).render(<Preview/>);
