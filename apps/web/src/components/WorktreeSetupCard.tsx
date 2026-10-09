import { useEffect, useState } from 'react';
import { requestWorkspace, type WorkspaceStatus } from '../lib/agents';
import './SayNew.css';
export function WorktreeSetupCard({ id, onActive, onClose }: { id:string; onActive:(s:WorkspaceStatus)=>void; onClose:()=>void }) {
  const [state,setState]=useState<WorkspaceStatus|null>(null),[error,setError]=useState<string|null>(null);
  useEffect(()=>{
    let live=true,last=-1;
    const update=(s:WorkspaceStatus)=>{if(!live || s.sequence<=last)return;last=s.sequence;setState(s);if(s.phase==='active')onActive(s);};
    void requestWorkspace(`/api/workspaces/${id}`).then(update).catch(e=>setError(e.message));
    const events=new EventSource(`/api/workspaces/${id}/events`);events.addEventListener('workspace.snapshot',e=>{update(JSON.parse((e as MessageEvent).data));setError(null);});
    events.onerror=()=>setError('Reconnecting to workspace preparation…');
    return ()=>{live=false;events.close();};
  },[id,onActive]);
  const action=async(op:string)=>{try {await requestWorkspace(`/api/workspaces/${id}/${op}`,{});setError(null);}catch(e){setError((e as Error).message);}};
  return <section className="ab-saynew" aria-label="Workspace preparation" data-testid="worktree-setup">
    <div className="ab-saynew__foot"><p><b>{state?.name??'New chat'}</b> · {state?.phase??'Preparing…'}</p><button type="button" onClick={onClose}>Close</button></div>
    {state?.branch && <p className="text-xs break-all" data-testid="workspace-branch">{state.branch} · from {state.baseRef}</p>}
    <div className="ab-saynew__foot flex-wrap">{state?.stages.map(s=><span key={s.id} className="text-xs" data-stage={s.id} data-status={s.status}>{s.id} · {s.status}</span>)}</div>
    {(error || state?.error) && <div className="ab-saynew__foot"><p role="alert" className="is-err">{error??state?.error}</p></div>}
    <div className="ab-saynew__foot">
      {state?.phase==='failed' && <button type="button" onClick={()=>void action('retry')}>Retry</button>}
      {state?.phase==='preparing' && <button type="button" onClick={()=>void action('cancel')}>Cancel preparation</button>}
      {state && ['active','ready','failed'].includes(state.phase) && <button type="button" onClick={()=>void action('archive')}>Archive</button>}
    </div>
  </section>;
}
