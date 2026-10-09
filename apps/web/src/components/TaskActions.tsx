import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, Play, RotateCcw, PencilLine } from 'lucide-react';
import { saveTask, useA0Tasks } from '../lib/a0-tasks';
import type { TaskSummary } from './widgets/TasksWidget';
import { MicButton } from './MicButton';
import './TaskActions.css';

type Capability = { specReady: boolean; canStart: boolean; reason?: string; expectedRevision?: string; idempotencyKey?: string; action?: 'retry'; workspace?: { phase: string; name: string; error?: string | null } };
type Receipt = { task: TaskSummary; stage: 'happy' | 'rework'; note: string; at: number };
const RECEIPT = 'ab-task-verdict-saved';
const UNDONE = 'ab-task-verdict-undone';
const noHotkey = () => false;
// Timestamps can have second precision. Compare the displayed scope too; availability is not a new scope.
const taskIdentity = (task: TaskSummary) => JSON.stringify([
  task.id, task.updated, task.stage, task.title, task.project, task.priority, task.owner, task.model,
  task.workspace, task.parent, task.agent, task.next, task.his, task.short, task.needs, task.live_at,
]);
// Every mounted receipt surface receives the same event object. Share its Undo operation.
const undoRequests = new WeakMap<Receipt, ReturnType<typeof saveTask>>();
function undoReceipt(receipt: Receipt) {
  const existing = undoRequests.get(receipt);
  if (existing) return existing;
  const request = saveTask(receipt.task.id, { stage: 'preview', reason: 'undo' }).then(result => {
    if (result.ok) window.dispatchEvent(new CustomEvent(UNDONE, { detail: taskIdentity(receipt.task) }));
    else undoRequests.delete(receipt);
    return result;
  });
  undoRequests.set(receipt, request);
  return request;
}

/** Explicit task actions. A server acknowledgement is required before any success state is shown. */
export function TaskActions({ task, disabled = false }: { task: TaskSummary; disabled?: boolean }) {
  const { failed } = useA0Tasks();
  // A different task/revision must not inherit a pending action, draft or accepted verdict.
  return <RevisionTaskActions key={taskIdentity(task)} task={task} disabled={disabled || failed} />;
}

function RevisionTaskActions({ task, disabled }: { task: TaskSummary; disabled: boolean }) {
  const [cap, setCap] = useState<Capability | null>(null);
  const [capError, setCapError] = useState('');
  const [redo, setRedo] = useState(false);
  const [note, setNote] = useState('');
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'failed'>('idle');
  const [message, setMessage] = useState('');
  const [tracking, setTracking] = useState(false);
  const busy = useRef(false);
  const mounted = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const preview = task.stage === 'preview' || task.stage === 'feedback';
  const allocatable = ['thought', 'specced', 'allocated', 'rework'].includes(task.stage);
  const unavailable = disabled || task.source === 'unavailable';
  const observeWorkspace = useCallback((body: Capability) => {
    const workspace = body.workspace;
    if (!workspace || busy.current) return;
    if (workspace.phase === 'active') { setMessage(`Workspace connected · ${workspace.name}`); setTracking(false); }
    else if (workspace.error || ['failed', 'cancelled', 'archived'].includes(workspace.phase)) { setState('failed'); setMessage(workspace.error || body.reason || `Workspace ${workspace.phase}`); setTracking(false); }
    else { setMessage(`Workspace ${workspace.phase} · ${workspace.name}`); setTracking(true); }
  }, []);
  useEffect(() => {
    const undone = (event: Event) => { if ((event as CustomEvent<string>).detail === taskIdentity(task) && !busy.current) { setState('idle'); setMessage(''); } };
    window.addEventListener(UNDONE, undone); return () => window.removeEventListener(UNDONE, undone);
  }, [task.id]);
  useEffect(() => {
    if (!allocatable || unavailable) return;
    let active = true;
    setCap(null); setCapError('');
    void fetch(`/api/a0/tasks/${encodeURIComponent(task.id)}/actions`, { cache:'no-store' }).then(async r => {
      const body = await r.json();
      if (!r.ok || typeof body.specReady !== 'boolean' || typeof body.canStart !== 'boolean' || (body.canStart && (!/^[a-f0-9]{64}$/.test(body.expectedRevision || '') || !/^task-[a-f0-9]{40}$/.test(body.idempotencyKey || '')))) throw Error(body.error || 'Start is unavailable');
      return body as Capability;
    }).then(v => { if (active) { setCap(v); observeWorkspace(v); } }).catch(e => { if (active) setCapError(e.message); });
    return () => { active = false; };
  }, [task.id, task.updated, allocatable, unavailable, observeWorkspace]);
  useEffect(() => {
    if (!tracking || !allocatable) return;
    let active = true;
    const poll = async () => {
      try {
        const response = await fetch(`/api/a0/tasks/${encodeURIComponent(task.id)}/actions`, { cache: 'no-store' });
        const body = await response.json() as Capability;
        if (!response.ok || !active) return;
        setCap(body);
        observeWorkspace(body);
      } catch { /* Preserve the accepted receipt during a temporary polling failure. */ }
    };
    const timer = window.setInterval(() => void poll(), 2000);
    return () => { active = false; window.clearInterval(timer); };
  }, [tracking, task.id, allocatable, observeWorkspace]);
  const run = async (action: 'happy' | 'rework' | 'allocate' | 'spec') => {
    if (busy.current || unavailable || (action === 'rework' && !note.trim())) return;
    if ((action === 'allocate' && (!cap?.specReady || !cap.canStart || !cap.expectedRevision || !cap.idempotencyKey)) || (action === 'spec' && (!cap || cap.specReady))) return;
    busy.current = true; setState('saving'); setMessage('Saving…');
    try {
      const result = action === 'allocate'
        ? await fetch(`/api/a0/tasks/${encodeURIComponent(task.id)}/allocate`, { method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({expectedRevision:cap?.expectedRevision,idempotencyKey:cap?.idempotencyKey}) }).then(async r => { const v=await r.json(); if (v.workspace && mounted.current) setCap(previous => previous ? { ...previous, workspace: v.workspace, action: 'retry' } : previous); return r.ok && v.ok === true ? v : {ok:false,error:v.error || v.workspace?.error || 'Start was not accepted'}; })
        : await saveTask(task.id, action === 'spec' ? {next:`NOW: spec it (Shaan asked ${new Date().toISOString()})`} : {stage:action,reason:action === 'happy' ? 'Good' : note.trim()});
      if (!result.ok) throw Error(result.error || 'Not saved');
      // Keep the accepted receipt even if the index already moved this task out of view.
      if (action === 'happy' || action === 'rework') window.dispatchEvent(new CustomEvent<Receipt>(RECEIPT,{detail:{task,stage:action,note:action==='happy'?'Good':note.trim(),at:Date.now()}}));
      if (!mounted.current) return;
      setState('saved'); setRedo(false);
      if (action === 'allocate') setTracking(result.workspace?.phase !== 'active');
      const words = action === 'happy' ? 'Rated Good' : action === 'rework' ? 'Redo saved' : action === 'spec' ? 'Spec asked' : `Workspace ${result.workspace?.phase === 'active' ? 'connected' : result.workspace?.phase || 'accepted'}${typeof result.name === 'string' ? ` · ${result.name}` : ''}`;
      setMessage(words);
    } catch (e) { if (mounted.current) { setState('failed'); setMessage(e instanceof Error ? e.message : 'No answer from the node'); } }
    finally { busy.current = false; }
  };
  if (!preview && !allocatable) return null;
  return <div className="ab-task-actions" data-testid="task-actions" data-state={state}>
    {preview && state !== 'saved' && <div className="ab-task-actions__buttons">
      <button type="button" disabled={unavailable || state==='saving'} onClick={()=>void run('happy')}><Check size={13}/>Good</button>
      <button type="button" disabled={unavailable || state==='saving'} aria-expanded={redo} onClick={()=>setRedo(v=>!v)}><RotateCcw size={12}/>Redo</button>
    </div>}
    {allocatable && state !== 'saved' && <button type="button" disabled={unavailable || state==='saving' || !cap || (cap.specReady && !cap.canStart)} title={cap?.reason || capError || undefined} onClick={()=>void run(cap?.specReady?'allocate':'spec')}>
      {cap && !cap.specReady ? <PencilLine size={12}/> : <Play size={12}/>}{cap ? cap.specReady ? cap.action === 'retry' ? 'Retry Start' : 'Start' : 'Spec it' : capError ? 'Start unavailable' : 'Checking Start…'}
    </button>}
    {redo && <form className="ab-task-actions__redo" onSubmit={e=>{e.preventDefault();void run('rework');}}>
      <label className="sr-only" htmlFor={`redo-${task.id}`}>What needs redoing</label>
      <input id={`redo-${task.id}`} autoFocus value={note} onChange={e=>setNote(e.target.value)} placeholder="What's off?" disabled={unavailable || state==='saving'}/>
      <MicButton label="Dictate task feedback" hotkey={noHotkey} disabled={unavailable || state==='saving'} onText={text=>setNote(v=>v?`${v} ${text}`:text)}/>
      <button type="submit" disabled={unavailable || !note.trim() || state==='saving'}>Save Redo</button>
    </form>}
    {message && <span className="ab-task-actions__message" role={state==='failed'?'alert':'status'}>{state==='saved'&&<Check size={13} className="ab-task-accepted-check"/>}{message}</span>}
    {cap?.reason && (!cap.canStart || !cap.specReady) && state==='idle' && <small>{cap.reason}</small>}
    {unavailable && <small>Task source unavailable; actions are disabled.</small>}
  </div>;
}

/** Keep the accepted task visible for five seconds even if the next index refresh moves it out of this filter. */
export function TaskActionReceipts() {
  const { failed } = useA0Tasks();
  const [saved,setSaved]=useState<{receipt:Receipt;generation:number}|null>(null);
  useEffect(()=>{const saved=(e:Event)=>{const receipt=(e as CustomEvent<Receipt>).detail;setSaved(previous=>({receipt,generation:(previous?.generation ?? 0)+1}));};window.addEventListener(RECEIPT,saved);return()=>window.removeEventListener(RECEIPT,saved);},[]);
  const expire=useCallback(()=>setSaved(previous=>previous===saved?null:previous),[saved]);
  if(!saved)return null;
  return <TaskActionReceipt key={saved.generation} receipt={saved.receipt} disabled={failed} onExpire={expire} />;
}

function TaskActionReceipt({ receipt, disabled, onExpire }: { receipt: Receipt; disabled: boolean; onExpire: () => void }) {
  const [message,setMessage]=useState('');
  const busy=useRef(false);
  const mounted=useRef(false);
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
  useEffect(()=>{const timer=window.setTimeout(()=>{if(!busy.current)onExpire();},5000);return()=>window.clearTimeout(timer);},[message,onExpire]);
  return <div className="ab-task-receipt" role="status" data-testid="task-verdict-receipt"><Check size={16} className="ab-task-accepted-check"/><span><b>{receipt.task.title}</b><small>{message || (receipt.stage==='happy'?'Rated Good · saved':`Redo saved · ${receipt.note}`)}</small></span>{receipt.stage==='happy'&&<button type="button" disabled={disabled || message === "Undoing…" || message === "Restored to preview"} onClick={async()=>{
    if(busy.current||disabled)return;busy.current=true;setMessage('Undoing…');const r=await undoReceipt(receipt);busy.current=false;if(mounted.current)setMessage(r.ok?'Restored to preview':r.error||'Undo not saved');
  }}>Undo</button>}</div>;
}
