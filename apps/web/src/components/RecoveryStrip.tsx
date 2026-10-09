import { continueDraft, recoveryMessage, type Recovery } from '../lib/chat-recovery';
// uihub: messaging-conversation — existing chat, with the approved recovery proposal.
export function RecoveryStrip({ recovery, memoryOnly, draft, onDraft }: { recovery: Recovery; memoryOnly: boolean; draft: string; onDraft: (text: string) => void }) {
  if (!recovery.droppedAt && !recovery.changed) return null;
  return <div className="chat-recovery" role="status" data-testid="recovery-strip">
    <span><strong>{recoveryMessage(recovery)}</strong><small>{recovery.droppedAt ? new Date(recovery.droppedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) + ' · ' : ''}{memoryOnly ? 'Draft kept in this window only' : 'Your draft is kept'} · nothing resent</small></span>
    {recovery.transport === 'online' && recovery.response === 'interrupted' && !recovery.changed && <button type="button" title={draft.trim() ? 'Your draft is kept; send when ready' : 'Puts a follow-up in the composer; does not send'} onClick={() => onDraft(continueDraft(draft))}>Ask it to continue</button>}
  </div>;
}
