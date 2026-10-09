import { useEffect, useRef, useState, useId, type ReactNode } from 'react';
import { BellRingIcon, SlidersHorizontalIcon, XIcon } from 'lucide-react';
import { attentionPost, type Attention, type Settings } from '../../src/lib/attention';
import { QuestionCard } from '../../src/components/QuestionCard';
import { buildAnswers, type QuestionDraft } from '../../src/lib/questions';
import type { QuestionRequest } from '../../../../services/host/src/questions';
import { AgentNotificationStack } from '../../src/components/AgentNotificationStack';
import './AttentionPanel.css';
function AttentionActions({item:i,refresh,healthy}:{item:Attention;refresh:()=>Promise<void>;healthy:boolean}) {
  const actionsId = useId();
  const [expanded,setExpanded]=useState(false),[text,setText]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const [request,setRequest]=useState<QuestionRequest|null>(null),[draft,setDraft]=useState<QuestionDraft>({index:0,answers:{},status:'editing'});
  const [blocked,setBlocked]=useState(false);
  const lock=useRef(false);
  const requestIdentity=JSON.stringify([i.ref,i.requestId]);
  const identity=JSON.stringify([requestIdentity,i.revision]);
  const current=useRef(identity);current.current=identity;
  useEffect(()=>{setRequest(null);setBlocked(false);setError('');},[identity]);
  useEffect(()=>{setDraft({index:0,answers:{},status:'editing'});},[requestIdentity]);
  useEffect(()=>{
    let disposed=false;
    if(expanded&&i.phase==='needs'&&i.requestKind==='input')void fetch(`/api/attention/${encodeURIComponent(i.id)}/request`).then(async r=>{
      if(!r.ok)throw Error('Question unavailable');const d=await r.json();
      if(d.request?.id!==i.requestId||d.request?.hostInstance!==i.ref.hostInstanceId||d.request?.session!==i.ref.sessionId||!d.request?.questions?.length)throw Error('Question changed; refresh this notification');
      if(!disposed)setRequest(d.request);
    }).catch(e=>{if(!disposed)setError((e as Error).message);});
    return()=>{disposed=true;};
  },[expanded,i.id,identity,i.phase,i.requestKind]);
  const send=async(action:unknown)=>{
    if(lock.current||blocked||!healthy)return;
    lock.current=true;setBusy(true);setError('');const sentIdentity=identity;
    try{
      await attentionPost(`/api/attention/${encodeURIComponent(i.id)}/command`,{commandId:crypto.randomUUID(),ref:i.ref,expectedRevision:i.revision,action});
      if(current.current===sentIdentity){setText('');setExpanded(false);}
      await refresh();
    }catch(e){
      if(current.current===sentIdentity){
        const message=e instanceof Error?e.message:'Notifications unavailable';
        const uncertain=e instanceof TypeError||e instanceof SyntaxError||/uncertain/i.test(message);
        setError(uncertain?'Delivery uncertain; open the chat to verify before sending again.':message);
        setBlocked(uncertain||/changed|stale/i.test(message));
      }
    }finally{lock.current=false;setBusy(false);}
  };
  const disabled=busy||blocked||!healthy;
  return <div data-testid="attention-row" data-id={i.id}>
    <div className="an-item__actions"><button type="button" aria-expanded={expanded} aria-controls={actionsId} onClick={()=>setExpanded(!expanded)}>{expanded?'Close actions':'Act here'}</button></div>
    {expanded&&<div id={actionsId} className="ab-attention__expanded">
      {i.phase==='needs'&&i.requestKind==='approval'&&<div className="siso-chat__ask"><b>Approve this agent’s pending tool request?</b><div><button disabled={disabled||!i.requestId} onClick={()=>void send({kind:'approve',requestId:i.requestId})}>Allow</button><button disabled={disabled||!i.requestId} onClick={()=>void send({kind:'deny',requestId:i.requestId})}>Deny</button></div></div>}
      {i.phase==='needs'&&i.requestKind==='input'&&request&&request.id===i.requestId&&<QuestionCard request={request} draft={{...draft,status:busy?'sending':draft.status}} connected={!disabled} onChange={setDraft} onSubmit={dismiss=>void send({kind:dismiss?'dismiss':'answer',requestId:i.requestId,answers:buildAnswers(request,draft)})}/>}
      <form onSubmit={e=>{e.preventDefault();if(text.trim())void send({kind:'reply',text});}} className="an-item__reply"><textarea rows={2} aria-label={`Reply to ${i.agentName}`} value={text} onChange={e=>setText(e.target.value)} placeholder="Reply to this agent…" disabled={busy}/><div><span>Enter adds a new line</span><button disabled={disabled||!text.trim()}>Send reply</button></div></form>
    </div>}
    {!healthy&&<p role="status" className="an-item__pending">Feed unavailable · drafts kept. Refresh before sending.</p>}
    {error&&<p role="alert" className="an-item__error">{error}</p>}
  </div>;
}
export function AttentionPanel({items,settings,healthy,onOpen,onClose,refresh,top}:{items:Attention[];settings:Settings|null;healthy:boolean;onOpen:(id:string)=>void;onClose:()=>void;refresh:()=>Promise<void>;top?:ReactNode}) {
  const root = useRef<HTMLElement>(null);
  const close = useRef(onClose); close.current = onClose;
  const settingsId = useId();
  const [options,setOptions]=useState(false),[topic,setTopic]=useState(''),[appUrl,setAppUrl]=useState(''),[error,setError]=useState('');
  useEffect(() => {
    const trigger = document.querySelector<HTMLElement>('[aria-label="Agent notifications"]');
    const opener = document.activeElement instanceof HTMLElement && document.activeElement !== document.body ? document.activeElement : trigger;
    const panel = root.current;
    panel?.querySelector<HTMLButtonElement>('button')?.focus({preventScroll:true});
    const key = (event:KeyboardEvent) => { if(event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); close.current(); } };
    const outside = (event:PointerEvent) => { if(event.target instanceof Node && !panel?.contains(event.target) && !trigger?.contains(event.target)) close.current(); };
    document.addEventListener('keydown',key,true);
    document.addEventListener('pointerdown',outside,true);
    return () => {
      document.removeEventListener('keydown',key,true);
      document.removeEventListener('pointerdown',outside,true);
      if(opener?.isConnected && (document.activeElement === document.body || panel?.contains(document.activeElement))) opener.focus({preventScroll:true});
    };
  },[]);
  const needs = items.filter(item => item.phase === 'needs').length;
  const unread = items.filter(item => !item.read && item.phase !== 'needs').length;
  const save=async(patch:unknown)=>{setError('');try{await attentionPost('/api/attention/settings',patch);await refresh();}catch(e){setError((e as Error).message);}};
  return <section ref={root} id="agent-notifications" role="dialog" aria-modal="false" aria-label="Notifications" data-testid="attention-panel" className="ab-attention">
    <header className="ab-attention__header">
      <span className="ab-attention__bell"><BellRingIcon size={16} aria-hidden="true" /></span>
      <div className="ab-attention__heading"><h2>Notifications</h2><p>{!healthy ? 'Feed unavailable' : needs ? `${needs} need you` : 'No requests waiting'}{healthy && unread ? ` · ${unread} unread updates` : ''}</p></div>
      <button type="button" className="ab-attention__icon" aria-label="Notification settings" title="Notification settings" aria-expanded={options} aria-controls={settingsId} onClick={()=>setOptions(!options)}><SlidersHorizontalIcon size={14} aria-hidden="true"/><span>Settings</span></button>
      <button type="button" className="ab-attention__icon" aria-label="Close notifications" title="Close · Esc" onClick={onClose}><XIcon size={14} aria-hidden="true"/></button>
    </header>
    <div className="ab-attention__scroll">
    {top}
    {!healthy&&<p className="ab-attention__status" role="status">Notifications unavailable</p>}
    {options&&<div id={settingsId} className="ab-attention__settings" aria-label="Notification settings">
      <button onClick={async()=>{if(settings?.desktop)return void save({desktop:false});if(!('Notification' in window))return setError('This browser does not support notifications');const p=await Notification.requestPermission();if(p==='granted')await save({desktop:true});else setError('Allow notifications in this browser’s settings');}}>{settings?.desktop?'Disable browser notifications':'Enable browser notifications'}</button>
      <p>Phone: {settings?.phone?'enabled':settings?.phoneConfigured?'configured, off':'not connected'}</p>
      <button onClick={() => setTopic(crypto.randomUUID().replaceAll('-',''))}>Generate private topic</button>{topic && <button onClick={() => void navigator.clipboard.writeText(topic)}>Copy topic</button>}
      <input className="w-full" aria-label="Private ntfy topic" type="password" value={topic} onChange={e=>setTopic(e.target.value)} placeholder="Private ntfy topic (24+ characters)"/>
      <input className="w-full" aria-label="Phone app address" value={appUrl} onChange={e=>setAppUrl(e.target.value)} placeholder="Your authenticated HTTPS Agent Base address"/>
      <p>Subscribe to this topic in the free ntfy phone app. Only the agent name and status go to ntfy. The app address must be reachable from your phone.</p>
      <button onClick={()=>void save({phone:!settings?.phone,...(topic?{topic}:{}),...(appUrl?{appUrl}:{})})}>{settings?.phone?'Disable phone notifications':'Enable phone notifications'}</button>
      <button onClick={()=>void save({snoozeUntil:Date.now()+3600000})}>Quiet for 1 hour</button>
    </div>}
    {error&&<p className="ab-attention__status" role="alert">{error}</p>}
    {items.length?<AgentNotificationStack agent={{id:'attention',name:'Agents'}} embedded
      notifications={items.map(i=>({id:i.id,at:i.at,title:i.headline,read:i.read,owner:{id:i.agentId??i.ref.hostInstanceId,name:i.agentName},url:`#attention/${encodeURIComponent(i.id)}`,...(i.phase==='needs'?{needs:i.requestKind==='approval'?'Approval requested':i.requestKind==='input'?'Question waiting':'Response requested'}:{})}))}
      relatedLabel="Open chat" onRelated={item=>onOpen(item.id)}
      renderActions={item=>{const attention=items.find(i=>i.id===item.id);return attention?<AttentionActions key={attention.id} item={attention} refresh={refresh} healthy={healthy}/>:null;}}/>
      :<p className="ab-attention__empty">New finished turns, failures and requests appear here.</p>}
    </div>
  </section>;
}
