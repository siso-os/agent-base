// uihub: arc:notification-center
import { useEffect, useRef, useState, useId, type ReactNode } from 'react';
import { SlidersHorizontalIcon, XIcon } from 'lucide-react';
import { attentionPost, type Attention, type Settings } from '../lib/attention';
import { QuestionCard } from './QuestionCard';
import { buildAnswers, type QuestionDraft } from '../lib/questions';
import type { QuestionRequest } from '../../../../services/host/src/questions';
import { AgentNotificationStack } from './AgentNotificationStack';
import './AttentionPanel.css';
import { AgentFace } from '../lib/face';
import { NotificationCenterFrame } from './NotificationCenterFrame';
import { attentionIdentity, bellItems, bellCounts, visibleBellItems, isLater, type BellItem, type BellShelf } from '../lib/bell';
import { useBellSnooze } from '../lib/bell-snooze';
import { useOwnerNotes, markOwnerNoteRead, type OwnerNote } from './OwnerLinkToast';
import { openOwner, openOwnerLink } from '../lib/owners';
import { attentionCommandState, updateAttentionCommand, useAttentionCommandState } from '../lib/attention-command-state';
function AttentionActions({item:i,refresh,healthy}:{item:Attention;refresh:()=>Promise<void>;healthy:boolean}) {
  const actionsId = useId();
  const [expanded,setExpanded]=useState(false),[text,setText]=useState('');
  const [requestError,setRequestError]=useState('');
  const [request,setRequest]=useState<QuestionRequest|null>(null),[draft,setDraft]=useState<QuestionDraft>({index:0,answers:{},status:'editing'});
  const requestIdentity=JSON.stringify([i.ref,i.requestId]);
  const identity=attentionIdentity(i);
  const {busy,blocked,error:commandError}=useAttentionCommandState(identity);
  const error=commandError||requestError;
  const current=useRef(identity);current.current=identity;
  useEffect(()=>{setRequest(null);setRequestError('');},[identity]);
  useEffect(()=>{setDraft({index:0,answers:{},status:'editing'});},[requestIdentity]);
  useEffect(()=>{
    let disposed=false;
    if(expanded&&i.phase==='needs'&&i.requestKind==='input')void fetch(`/api/attention/${encodeURIComponent(i.id)}/request`).then(async r=>{
      if(!r.ok)throw Error('Question unavailable');const d=await r.json();
      if(d.request?.id!==i.requestId||d.request?.hostInstance!==i.ref.hostInstanceId||d.request?.session!==i.ref.sessionId||!d.request?.questions?.length)throw Error('Question changed; refresh this notification');
      if(!disposed)setRequest(d.request);
    }).catch(e=>{if(!disposed)setRequestError((e as Error).message);});
    return()=>{disposed=true;};
  },[expanded,i.id,identity,i.phase,i.requestKind]);
  const send=async(action:{kind:string;requestId?:string;answers?:unknown;text?:string})=>{
    const state=attentionCommandState(identity);
    if(state.busy||state.blocked||!healthy)return;
    updateAttentionCommand(identity,{busy:true,error:''});setRequestError('');const sentIdentity=identity;
    try{
      await attentionPost(`/api/attention/${encodeURIComponent(i.id)}/command`,{commandId:crypto.randomUUID(),ref:i.ref,expectedRevision:i.revision,action});
      updateAttentionCommand(sentIdentity,{blocked:['approve','deny','answer','dismiss'].includes(action.kind)});
      if(current.current===sentIdentity){setText('');setExpanded(false);}
      await refresh();
    }catch(e){
        const message=e instanceof Error?e.message:'Notifications unavailable';
        const uncertain=e instanceof TypeError||e instanceof SyntaxError||/uncertain/i.test(message);
        updateAttentionCommand(sentIdentity,{error:uncertain?'Delivery uncertain; open the chat to verify before sending again.':message,blocked:uncertain||/changed|stale/i.test(message)});
    }finally{updateAttentionCommand(sentIdentity,{busy:false});}
  };
  const disabled=busy||blocked||!healthy;
  return <div data-testid="attention-row" data-id={i.id}>
    <div className="an-item__actions">
      {i.phase==='needs'&&i.requestKind==='approval'&&<><button type="button" className="ab-bell-approve" disabled={disabled||!i.requestId} onClick={()=>void send({kind:'approve',requestId:i.requestId})}>Approve once</button><button type="button" disabled={disabled||!i.requestId} onClick={()=>void send({kind:'deny',requestId:i.requestId})}>Deny</button></>}
      <button type="button" aria-expanded={expanded} aria-controls={actionsId} onClick={()=>setExpanded(!expanded)}>{expanded?'Close reply':i.requestKind==='input'&&i.phase==='needs'?'Answer here':'Reply'}</button></div>
    {expanded&&<div id={actionsId} className="ab-attention__expanded">

      {i.phase==='needs'&&i.requestKind==='input'&&request&&request.id===i.requestId&&<QuestionCard request={request} draft={{...draft,status:busy?'sending':draft.status}} connected={!disabled} onChange={setDraft} onSubmit={dismiss=>void send({kind:dismiss?'dismiss':'answer',requestId:i.requestId,answers:buildAnswers(request,draft)})}/>}
      <form onSubmit={e=>{e.preventDefault();if(text.trim())void send({kind:'reply',text});}} className="an-item__reply"><textarea rows={2} aria-label={`Reply to ${i.agentName}`} value={text} onChange={e=>setText(e.target.value)} placeholder="Reply to this agent…" disabled={busy}/><div><span>Enter adds a new line</span><button disabled={disabled||!text.trim()}>Send reply</button></div></form>
    </div>}
    {busy&&<p role="status" className="an-item__pending">Sending to this agent…</p>}
    {blocked&&!error&&<p role="status" className="an-item__pending">Decision sent · waiting for the agent’s update.</p>}
    {!healthy&&<p role="status" className="an-item__pending">Feed unavailable · drafts kept. Refresh before sending.</p>}
    {error&&<p role="alert" className="an-item__error">{error}</p>}
  </div>;
}
export function AttentionPanel({items,settings,healthy,onOpen,onClose,refresh,top,ownerNotes}:{items:Attention[];settings:Settings|null;healthy:boolean;onOpen:(id:string)=>void;onClose:()=>void;refresh:()=>Promise<void>;top?:ReactNode;ownerNotes?:OwnerNote[]}) {
  const root = useRef<HTMLElement>(null);
  const feed = useOwnerNotes();
  const { snoozes, now, snooze } = useBellSnooze();
  const all = bellItems(items, ownerNotes ?? feed.notes);
  const counts = bellCounts(all, snoozes, now);
  const [shelf, setShelf] = useState<BellShelf>('all');
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [marking, setMarking] = useState(false);
  const markLock = useRef(false);
  const shown = visibleBellItems(all, snoozes, now, shelf, unreadOnly);
  const focusShelf = () => requestAnimationFrame(() => root.current?.querySelector<HTMLButtonElement>(`[data-shelf="${shelf}"]`)?.focus());
  async function markRead(rows: BellItem[]) {
    if(markLock.current) return;
    markLock.current=true;setMarking(true);setError('');
    try {
      for(const item of rows) {
        if(item.note) markOwnerNoteRead(item.note.key);
        else await attentionPost(`/api/attention/${encodeURIComponent(item.id)}/read`, {});
      }
      await refresh(); if(unreadOnly) focusShelf();
    } catch { setError('Could not mark every update read. Refresh and try again.'); }
    finally {markLock.current=false;setMarking(false);}
  }
  function open(item: BellItem) {
    if(item.note) { openOwner(item.note.name); markOwnerNoteRead(item.note.key); onClose(); }
    else onOpen(item.id);
  }
  const close = useRef(onClose); close.current = onClose;
  const settingsId = useId();
  const [options,setOptions]=useState(false),[topic,setTopic]=useState(''),[appUrl,setAppUrl]=useState(''),[error,setError]=useState('');
  useEffect(() => {
    const trigger = document.querySelector<HTMLElement>('[data-testid="notifications-bell"]');
    const opener = document.activeElement instanceof HTMLElement && document.activeElement !== document.body ? document.activeElement : trigger;
    const panel = root.current;
    panel?.querySelector<HTMLButtonElement>('button')?.focus({preventScroll:true});
    const key = (event:KeyboardEvent) => { if(event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); close.current(); } };
    const outside = (event:PointerEvent) => { if(event.target instanceof Node && !panel?.contains(event.target) && !trigger?.contains(event.target)) close.current(); };
    const observer = new MutationObserver(() => {
      if(document.activeElement===document.body) panel?.querySelector<HTMLButtonElement>('[data-shelf][aria-pressed="true"]')?.focus({preventScroll:true});
    });
    if(panel) observer.observe(panel,{childList:true,subtree:true});
    document.addEventListener('keydown',key,true);
    document.addEventListener('pointerdown',outside,true);
    return () => {
      observer.disconnect();
      document.removeEventListener('keydown',key,true);
      document.removeEventListener('pointerdown',outside,true);
      if(opener?.isConnected && (document.activeElement === document.body || panel?.contains(document.activeElement))) opener.focus({preventScroll:true});
    };
  },[]);
  const needs = counts.needs;
  const unread = counts.unread;
  const save=async(patch:unknown)=>{setError('');try{await attentionPost('/api/attention/settings',patch);await refresh();}catch(e){setError((e as Error).message);}};
  return <NotificationCenterFrame panelRef={root} shelf={shelf} onShelf={setShelf} counts={counts} unread={unreadOnly} onUnread={()=>setUnreadOnly(!unreadOnly)}
    bulk={<button type="button" disabled={marking||!healthy||!all.some(i=>i.phase==='outcome'&&!i.read&&!isLater(i,snoozes,now))} onClick={()=>void markRead(all.filter(i=>i.phase==='outcome'&&!i.read&&!isLater(i,snoozes,now)))}>Read outcomes</button>}
    header={
    <header className="ab-attention__header">
      <span className="ab-attention__bell"><AgentFace name="Agent Zero" size={32} /></span>
      <div className="ab-attention__heading"><h2>Notifications</h2><p aria-live="polite">{!healthy ? 'Feed unavailable' : needs ? `${needs} need you` : 'No requests waiting'}{healthy && unread ? ` · ${unread} unread` : ''}</p></div>
      <button type="button" className="ab-attention__icon" aria-label="Notification settings" title="Notification settings" aria-expanded={options} aria-controls={settingsId} onClick={()=>setOptions(!options)}><SlidersHorizontalIcon size={14} aria-hidden="true"/><span>Settings</span></button>
      <button type="button" className="ab-attention__icon" aria-label="Close notifications" title="Close · Esc" onClick={onClose}><XIcon size={14} aria-hidden="true"/></button>
    </header>}>
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
    {(['needs','outcome'] as const).map(phase=>{
      const group=shown.filter(i=>i.phase===phase);
      return group.length ? <section key={phase} aria-label={phase==='needs'?'Needs you requests':'Agent outcomes'}>
        <h3 className="ab-bell-group">{phase==='needs'?'Needs you':'Outcomes'} <span>{group.length}</span></h3>
        <AgentNotificationStack agent={{id:`bell-${phase}`,name:'Agents'}} embedded preserveOrder className="an-stack--bell"
          notifications={group} renderActions={row=>{
            const item=group.find(i=>i.id===row.id)!;
            const later=isLater(item,snoozes,now);
            return <div data-bell-row={item.id}>
              {item.attention&&<AttentionActions key={item.identity} item={item.attention} refresh={refresh} healthy={healthy}/>}
              <div className="an-item__actions ab-bell-row-tools">
                <button type="button" onClick={()=>open(item)}>{item.note?'Open owner':'Open chat'}</button>
                {item.note?.page&&<button type="button" onClick={()=>{openOwnerLink(item.note!.page!,item.title);markOwnerNoteRead(item.note!.key);onClose();}}>Open result</button>}
                {!item.read&&<button type="button" disabled={marking||!healthy} onClick={()=>void markRead([item])}>Mark read</button>}
                {later ? <button type="button" onClick={()=>{snooze(item.identity,0);focusShelf();}}>Bring back</button> :
                  <select aria-label={`Snooze ${item.owner?.name}: ${item.title}`} value="" onChange={event=>{snooze(item.identity,Number(event.target.value));focusShelf();}}>
                    <option value="" disabled>Snooze…</option><option value="15">15 minutes</option><option value="60">1 hour</option><option value="240">4 hours</option>
                  </select>}
              </div>
              {later&&<p className="ab-bell-later">Back in {Math.ceil((snoozes[item.identity]-now)/60000)} min · on this device</p>}
            </div>;
          }}/>
      </section> : null;
    })}
    {!shown.length&&<p className="ab-attention__empty">{shelf==='later'?'Nothing saved for later. Snoozed rows will appear here.':unreadOnly?'No unread items in this view. Read requests still need you — turn off Unread only to see them.':shelf==='needs'?'No requests waiting. Outcomes are kept separately.':shelf==='outcomes'?'No outcomes yet. Requests stay in Needs you until the agent ends them.':counts.later?'Everything is on the Later shelf. Bring a row back whenever you are ready.':'You’re all caught up. New requests and outcomes will appear here.'}</p>}
    <footer className="ab-bell-footer">Reading keeps requests open. Snooze saves them in Later.</footer>
  </NotificationCenterFrame>;
}
