// Second consumer: only shared packages. All values are synthetic; callbacks are recorded locally.
import { useLayoutEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { HaloRim } from '@siso/shell';
import { AgentFace } from '../../../packages/halo-face';
import { ComposerFrame, ComposerHud, ContextPopover, UsagePopover, UsageRingCard, ModelPicker, ActivityPill, ActivityPopover, ArtifactShelfView, type ActivityItem } from '../../../packages/siso-composer/src';
import '@siso/tokens/siso.css';
import '@siso/tokens/tokens.css';
import '@siso/shell/shell.css';

const events: string[] = [];
Object.assign(window, { __composerEvents: events });
const record = (event: string) => events.push(event);
function PackageConsumer() {
  const [context, setContext] = useState<number | null>(32), [model, setModel] = useState('gpt-6-astra');
  const [effort, setEffort] = useState('high'), [draft, setDraft] = useState('Review this synthetic task');
  const [receipt, setReceipt] = useState<{key:string}|null>(null), [activityOpen, setActivityOpen] = useState(false);
  const [items, setItems] = useState(Array.from({length:5},(_,index)=>({id:`artifact-${index}`,label:`Artifact ${index+1}`,title:'Synthetic artifact',kind:'file',icon:<span aria-hidden>◇</span>})));
  const trigger = useRef<HTMLButtonElement>(null);
  const [position, setPosition] = useState<{left:number;bottom:number}|null>(null);
  useLayoutEffect(() => {
    if (!activityOpen) return;
    const place = () => {const rect=trigger.current!.getBoundingClientRect();const half=Math.min(640,innerWidth-32)/2;setPosition({left:Math.min(Math.max(rect.left+rect.width/2,half+16),innerWidth-half-16),bottom:innerHeight-rect.top+12});};
    place();window.addEventListener('resize',place);return()=>window.removeEventListener('resize',place);
  },[activityOpen]);
  const face = (name:string,size=28) => <AgentFace name={name} family="codex" size={size} paused track={false} status="waiting"/>;
  const row = (id:string,done=false):ActivityItem => ({id,title:done?'Finished review':'Active review',identity:face(id),compactIdentity:face(id,16),modelLabel:'GPT 6-astra',description:'Synthetic activity projection',tone:done?'done':'working',detail:done?'done · 120 tokens':'18 tok/s',onSelect:()=>record(`open:${id}`)});
  const windows=[{id:'short',label:'5 hours',shortLabel:'5h',pct:43,resetDescription:'Synthetic reset in 2 hours'},{id:'week',label:'Week',shortLabel:'wk',pct:null,resetDescription:'not reported'}];
  return <main style={{minHeight:'100vh',boxSizing:'border-box',padding:24,background:'#171715',color:'#e7e5df',fontFamily:'var(--crm-font-sans)'}}>
    <h1 style={{fontSize:22,margin:0}}>Shared composer · second consumer</h1><p style={{color:'#aaa',fontSize:13}}>Synthetic values. No Agent Base components, requests or session controls.</p>
    <div style={{display:'flex',flexWrap:'wrap',gap:12,marginBottom:32}}><button onClick={()=>setContext(92)}>Report context 92</button><button onClick={()=>setContext(null)}>Report unknown context</button><button onClick={()=>setModel('gpt-6.1-sol')}>Acknowledge selected model</button><button onClick={()=>setReceipt({key:String(Date.now())})}>Accept synthetic task</button><button onClick={()=>setActivityOpen(false)}>Close activity</button></div>
    <div style={{maxWidth:892,margin:'180px auto 0'}}>
      <ArtifactShelfView items={items} onOpen={id=>record(`artifact:${id}`)} onHide={id=>{record(`hide:${id}`);setItems(current=>current.filter(item=>item.id!==id));}}/>
      <ComposerFrame surface={HaloRim} state="idle" acceptedReceipt={receipt} data-testid="shared-composer" hud={<ComposerHud
        identity={<ModelPicker className="ab-hud__model" label={model} identity={face(model,16)} selection={{model,effort,wrap:true,options:[{id:'gpt-6-astra',label:'GPT 6-astra',description:'Fixture model A',identity:face('astra',34)},{id:'gpt-6.1-sol',label:'GPT 6.1-sol',description:'Fixture model B',identity:face('sol',34)}],efforts:[{id:'high',label:'high'},{id:'low',label:'low'}],onSelect:id=>{record(`model:${id}`);},onEffort:id=>{record(`effort:${id}`);setEffort(id);}}}/>}
        context={<ContextPopover value={context}><p>Context details supplied by this consumer.</p></ContextPopover>}
        usage={<UsagePopover windows={windows} freshness={{label:'unverified',detail:'Synthetic fixture'}}><UsageRingCard windows={windows}><p>Account identity not supplied.</p></UsageRingCard></UsagePopover>}
        activity={<span className="ab-subagents"><ActivityPill triggerRef={trigger} open={activityOpen} onOpenChange={setActivityOpen} faces={[{id:'review',identity:face('review',18)}]} active running={1} status="1 working" rate={18} rateLabel="18 tok/s" paused label="Fixture activities"/><ActivityPopover open={activityOpen} position={position} label="Fixture activity popup" heading={{label:'Synthetic owner',identity:face('owner',22),onSelect:()=>record('owner')}} summary="1 working · supplied measurement" groups={[{id:'group',title:'Review pass',color:'#85b6ff',summary:'1 of 2 done',progress:[{id:'a',tone:'working'},{id:'b',tone:'done'}],items:[row('review')]}]} utilities={[{id:'build',label:'Build output',onStop:()=>record('stop:build')}]} finished={[row('finished',true)]}/></span>}
      />}>
        <div className="siso-chat__inputrow"><textarea aria-label="Package draft" value={draft} rows={1} onChange={e=>setDraft(e.target.value)} style={{flex:1,background:'transparent',border:0,color:'inherit',font:'inherit',resize:'none'}}/><button className="siso-chat__send" aria-label="Request synthetic task" onClick={()=>record(`submit:${draft}`)}>↑</button></div>
      </ComposerFrame>
    </div>
  </main>;
}
createRoot(document.getElementById('root')!).render(<PackageConsumer/>);
