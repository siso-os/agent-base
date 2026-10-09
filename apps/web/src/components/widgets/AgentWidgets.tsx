import {useEffect,useRef,useState} from 'react';
import type {WidgetDocument,WidgetIndex,WidgetAction} from '../../../../../services/node/src/widgets';
import {NeedsWidget} from './NeedsWidget';
import {TeamWidget} from './TeamWidget';
import {SystemsWidget} from './SystemsWidget';
import {UnknownWidget} from './UnknownWidget';
import {WidgetCard} from './WidgetCard';
import {Boundary} from '../Boundary';
import {MicButton} from '../MicButton';
import {useSharedState} from '../../lib/poll';
import '../AgentZeroPage.css';
import './AgentWidgets.css';

export type WidgetActionRequest={agent:string;id:string;revision:string;kind:WidgetAction;itemId?:string;text?:string};
export async function postWidgetAction(action:WidgetActionRequest){
  const r=await fetch(`/api/widgets/${encodeURIComponent(action.agent)}/${encodeURIComponent(action.id)}/actions`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(action)});
  const data=await r.json();if(!r.ok||data.ok!==true)throw Error(data.error??'Action not delivered');
}
function Systems({widget}:{widget:WidgetDocument}){
  const live=useSharedState<any>(widget.data.source==='servers'?'/api/servers':null,10000);
  if(widget.data.source!=='servers')return <SystemsWidget widget={{...widget,shape:'systems'}} size="L"/>;
  if(live.error||!live.data)return <p role="status">{live.error?'Machine readings unavailable.':'Reading machines…'}</p>;
  const servers=(live.data.servers??[]).map((s:any)=>{const h=s.health??{};return {name:s.name,role:s.role??'',level:h.level==='bad'?'bad':h.level==='ok'?'ok':'warn',cpus:h.cpus??null,load:h.load??null,memTotalGb:h.memTotalGb??null,memAvailGb:h.memAvailGb??null,diskFreeGb:h.diskFreeGb??null,why:h.why??[]};});
  return <SystemsWidget widget={{...widget,shape:'systems',data:{servers,heavy:'See the existing machine readings for capacity.'}}} size="L"/>;
}
export function WidgetShape({widget,onAction,onVoice}:{widget:WidgetDocument;onAction?:(action:WidgetActionRequest)=>Promise<void>;onVoice?:()=>Promise<string>}){
  switch(widget.shape){
    case 'needs':return <NeedsWidget widget={{...widget,shape:'needs'}} size="L"/>;
    case 'list':return <WidgetCard size="L" title={widget.title} description={[widget.data.project,widget.data.domain,widget.data.sourceUpdated].filter(Boolean).join(' · ')||'Published records'} icon="history" className="widget-list-shape"><ul className="widget-list widget-list-shape__rows">{widget.data.rows.map((row:any,i:number)=><li key={i}><span className="widget-list__meta">{row.meta}</span><b>{row.title}</b>{row.quote&&<q>{row.quote}</q>}</li>)}</ul></WidgetCard>;
    case 'progress':return <WidgetCard size="L" title={widget.title} description="Published plan progress" icon="clipboard-check" className="widget-progress"><p>{widget.data.checked} of {widget.data.total} checked</p><p>{Object.entries(widget.data.counts).map(([status,count])=>`${count} ${status}`).join(' · ')}</p><ul className="widget-list widget-list-shape__rows">{widget.data.items.map((row:any,i:number)=><li key={i}><span className="widget-list__meta">{row.status} · {row.owner||'no owner yet'}</span><b>{row.title}</b></li>)}</ul></WidgetCard>;
    case 'team':return <TeamWidget widget={{...widget,shape:'team'}} size="L"/>;
    case 'systems':return <Systems widget={widget}/>;
    case 'announcements':return <WidgetCard size="L" title={widget.title} description="Updates from this agent" icon="radio"><ul className="widget-list">{widget.data.items.map((x:any)=><Announcement key={x.id} item={x} widget={widget} onAction={onAction} onVoice={onVoice}/>)}</ul></WidgetCard>;
    default:return <UnknownWidget widget={widget} size="L"/>;
  }
}
function Announcement({item,widget,onAction,onVoice}:{item:any;widget:WidgetDocument;onAction?:(action:WidgetActionRequest)=>Promise<void>;onVoice?:()=>Promise<string>}){
  const [draft,setDraft]=useState(''),[pending,setPending]=useState(false),[error,setError]=useState(''),[seen,setSeen]=useState(false),[sent,setSent]=useState(false);
  const mounted=useRef(true);useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
  const act=async(kind:WidgetAction,transcript?:string)=>{if(!onAction||pending)return;setPending(true);setError('');try{
    const text=transcript??(kind==='voice'?await onVoice?.():draft);
    if(kind!=='seen'&&!text?.trim())throw Error('No reply text received.');
    await onAction({agent:widget.agent,id:widget.id,revision:widget.revision,itemId:item.id,kind,...(kind==='seen'?{}:{text})});
    if(!mounted.current)return;if(kind==='seen')setSeen(true);else{setDraft('');setSent(true);}
  }catch(e){if(mounted.current)setError(e instanceof Error?e.message:'Action not delivered.');}finally{if(mounted.current)setPending(false);}};
  const isSeen=item.seen||seen;
  return <li data-announcement-id={item.id}><b>#{item.id} · {item.title}</b><span className="widget-list__meta">{item.project??'Unsorted'}{item.at?` · ${item.at}`:''}{isSeen?' · Seen':''}</span><p>{item.body}</p>{item.needs&&item.needs!=='nothing'&&<p>Needs: {item.needs}</p>}
    {onAction&&!isSeen&&<div className="agent-widgets__actions">
      {widget.actions.some(a=>a.kind==='seen')&&<button type="button" aria-label={`Mark announcement ${item.id} seen`} disabled={pending} onClick={()=>void act('seen')}>Seen</button>}
      {widget.actions.some(a=>a.kind==='reply'||a.kind==='voice')&&<><label>Reply<textarea aria-label={`Reply to announcement ${item.id}`} value={draft} maxLength={8000} disabled={pending} onChange={e=>setDraft(e.target.value)}/></label><button type="button" aria-label={`Send reply to announcement ${item.id}`} disabled={pending||!draft.trim()} onClick={()=>void act(widget.actions.some(a=>a.kind==='reply')?'reply':'voice',draft)}>Send reply</button></>}
      {widget.actions.some(a=>a.kind==='voice')&&(onVoice?<button type="button" disabled={pending} onClick={()=>void act('voice')}>Voice reply</button>:<MicButton label="Voice reply" to="zero" toName={item.title} disabled={pending} onText={(text,how)=>{if(!mounted.current)return;setDraft(text);if(how==='send')void act('voice',text);}}/>)}
    </div>}{sent&&<p role="status">Reply delivered.</p>}{error&&<p role="alert">{error}</p>}
  </li>;
}
/** Optional selectedId/onSelect lets any face, Needs item or pin open exactly one widget. */
export function AgentWidgets({agent,selectedId,onSelect,onAction=postWidgetAction,onVoice}:{agent:string;selectedId?:string|null;onSelect?:(id:string|null)=>void;onAction?:(action:WidgetActionRequest)=>Promise<void>;onVoice?:()=>Promise<string>}){
  const [local,setLocal]=useState<string|null>(null),selected=selectedId===undefined?local:selectedId;
  const [index,setIndex]=useState<WidgetIndex|null>(null),[widget,setWidget]=useState<WidgetDocument|null>(null),[error,setError]=useState<string|null>(null),[streamError,setStreamError]=useState(false),[draft,setDraft]=useState(''),[sending,setSending]=useState(false),[sent,setSent]=useState<WidgetAction|null>(null),[seenRevision,setSeenRevision]=useState<string|null>(null);
  const voiceTarget=useRef('');voiceTarget.current=`${agent}/${selected??''}`;
  const base=`/api/widgets/${encodeURIComponent(agent)}`;
  const select=(id:string|null)=>{setLocal(id);onSelect?.(id);};
  useEffect(()=>{let alive=true;setIndex(null);setWidget(null);setError(null);setStreamError(false);setLocal(null);
    const receive=(data:WidgetIndex)=>{if(alive){setIndex(data);setStreamError(false);}};
    fetch(base).then(r=>{if(!r.ok)throw Error();return r.json();}).then(receive).catch(()=>{if(alive)setStreamError(true);});
    const events=new EventSource(`${base}/events`);events.onmessage=e=>{try{receive(JSON.parse(e.data));}catch{if(alive)setStreamError(true);}};events.onerror=()=>{if(alive)setStreamError(true);};
    return()=>{alive=false;events.close();};
  },[base]);
  const revision=index?.widgets.find(x=>x.id===selected)?.revision;
  useEffect(()=>{const abort=new AbortController();setWidget(current=>current?.id===selected&&current.agent===agent?current:null);setError(null);setSent(null);if(!selected)return()=>abort.abort();
    fetch(`${base}/${encodeURIComponent(selected)}`,{signal:abort.signal}).then(r=>{if(!r.ok)throw Error('Widget unavailable.');return r.json();}).then(value=>{if(!abort.signal.aborted)setWidget(value);}).catch(e=>{if(!abort.signal.aborted)setError(e.message);});
    return()=>abort.abort();
  },[base,selected,revision]);
  useEffect(()=>setDraft(''),[base,selected]);
  const act=async(kind:WidgetAction,transcript?:string)=>{if(!widget||sending)return;setSending(true);setError(null);try{const text=transcript??(kind==='voice'?await onVoice?.():draft);if(kind==='voice'&&!text?.trim())throw Error('No voice text received.');await onAction({agent:widget.agent,id:widget.id,revision:widget.revision,kind,...(kind==='seen'?{}:{text})});setSent(kind);if(kind==='seen')setSeenRevision(widget.revision);if(kind!=='seen')setDraft('');}catch(e){setError(e instanceof Error?e.message:'Action not delivered.');}finally{setSending(false);}};
  return <section className="agent-zero-widget-sheet agent-widgets" data-testid="agent-widgets" aria-label={`${agent} widgets`}>
    {selected&&<button type="button" onClick={()=>select(null)}>All widgets</button>}
    {(streamError||index?.error)&&<p role="status">Widget updates unavailable. {index?.widgets.length?'Showing the last index.':''}</p>}
    {error&&<p role="alert">{error}</p>}
    {!selected?<nav aria-label="Choose a widget">{!index&&!streamError&&<p>Reading widgets…</p>}{index&&!index.error&&!index.widgets.length&&<p>No widgets published.</p>}{index?.widgets.map(w=><button type="button" key={w.id} onClick={()=>select(w.id)} aria-label={`Open ${w.title}`}><b>{w.title}</b><small>{w.shape}</small></button>)}{!!index?.excluded&&<p role="status">{index.excluded} unreadable or unsupported files excluded.</p>}</nav>
      :widget?<div data-widget-id={widget.id}><Boundary name={widget.title} kind="card"><WidgetShape widget={widget} onAction={onAction} onVoice={onVoice}/></Boundary>
        {widget.shape!=='announcements'&&widget.actions.length>0&&<div className="agent-widgets__actions">
          {widget.actions.some(a=>a.kind==='seen')&&<button type="button" disabled={sending||seenRevision===widget.revision} onClick={()=>void act('seen')}>{seenRevision===widget.revision?'Seen recorded':'Seen'}</button>}
          {widget.actions.some(a=>a.kind==='reply'||a.kind==='voice')&&<><label>Reply<textarea aria-label="Reply" value={draft} maxLength={8000} onChange={e=>setDraft(e.target.value)} disabled={sending}/></label><button type="button" disabled={sending||!draft.trim()} onClick={()=>void act(widget.actions.some(a=>a.kind==='reply')?'reply':'voice',draft)}>Send reply</button></>}
          {widget.actions.some(a=>a.kind==='voice')&&(onVoice?<button type="button" disabled={sending} onClick={()=>void act('voice')}>Voice reply</button>:<MicButton key={`${widget.agent}/${widget.id}`} label="Voice reply" to="zero" toName={widget.title} disabled={sending} onText={(text,how)=>{if(voiceTarget.current!==`${widget.agent}/${widget.id}`)return;setDraft(text);if(how==='send')void act('voice',text);}}/>)}
          {sent&&sent!=='seen'&&<p role="status">Reply delivered.</p>}
        </div>}
      </div>:!error&&<p>Reading widget…</p>}
  </section>;
}
