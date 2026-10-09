import { acceptLaunch, getWorkspace, receiptFile, save, snapshot, withLaunch, WorkspaceError } from './worktrees.ts';
import { validateWorkspaceReceipt, type LaunchInput, type WorkspaceReceipt } from '../../host/src/worktree-contract.ts';
export type LaunchStartEnvironment = { AB_CODEX_BIN: string };
export type LaunchAdapters = {
  find: (r: WorkspaceReceipt) => Promise<{ id: string; session: string; pane?: string } | null>;
  beforeStart?: (r: WorkspaceReceipt, receipt: string) => Promise<LaunchStartEnvironment | undefined>;
  start: (r: WorkspaceReceipt, receipt: string, trustedEnvironment?: LaunchStartEnvironment) => Promise<{ pane?: string; label?: string }>;
};
const running = new Set<string>();
export function scheduleLaunch(r: WorkspaceReceipt, adapters: LaunchAdapters) {
  if (running.has(r.workspaceId) || ['active','failed','cancelled','archived'].includes(r.phase)) return;
  running.add(r.workspaceId);
  void withLaunch(r,async r => {
    validateWorkspaceReceipt(receiptFile(r.workspaceId),r.worktreePath);
    let host=await adapters.find(r);
    if (!host && !r.handoffAttempted) {
      // A denied preflight performed no handoff. Keep that state retryable under this launch lock.
      const file=receiptFile(r.workspaceId), trustedEnvironment=await adapters.beforeStart?.(r,file);
      // Persist intent BEFORE the external side effect. Ambiguous recovery must never repeat a prompt.
      r.phase='starting';r.handoffAttempted=true;r.agent={name:r.name};
      const s=r.stages.find(s=>s.id==='agent')!;s.status='running';s.startedAt=Date.now();save(r);
      const started=await adapters.start(r,file,trustedEnvironment);r.agent={name:r.name,...started};save(r);
    }
    for(let n=0;!host && n<120;n++) { await new Promise(resolve=>setTimeout(resolve,250));host=await adapters.find(r); }
    if (!host) { r.phase='starting';r.error='Agent handoff is still unconfirmed; retry reconciles it without launching twice';save(r);return; }
    r.phase='active';r.error=null;r.agentId=host.id;r.agent={...r.agent,name:r.name,session:host.session,...(host.pane?{pane:host.pane}:{})};
    const s=r.stages.find(s=>s.id==='agent')!;s.status='done';s.endedAt=Date.now();save(r);
  }).catch(()=>{/* Another process owns the launch; clients observe its durable receipt. */}).finally(()=>running.delete(r.workspaceId));
}
export async function launchAgent(input: LaunchInput, adapters: LaunchAdapters) { const r=await acceptLaunch(input);scheduleLaunch(r,adapters);return snapshot(r); }
export function retryLaunch(id: string, adapters: LaunchAdapters) {
  const r=getWorkspace(id);
  if(r.phase==='cancelled' || r.phase==='archived')throw new WorkspaceError('This launch is cancelled or archived; create a new task');
  if(r.phase==='failed') { if(r.preparationPid)throw new WorkspaceError('Preparation still owns this launch');r.phase=r.handoffAttempted?'starting':'preparing';r.error=null;save(r); }
  scheduleLaunch(r,adapters);return snapshot(r);
}
