/** A child return is acknowledged at durable parent admission, not provider consumption. */
import { validatePrompt, type PromptReceipt } from './delivery.ts';
import type { PromptQueue } from './prompt-queue.ts';

export type ChildReturnCommand = { t: 'prompt'; text: string; key: string; messageId: string; images: []; delivery: 'auto'; from: 'pane' };
export type PendingChildReturn = { parentSession: string; resultId: string; at: number; ok: boolean; summary: string; command: ChildReturnCommand };
export function validateChildReturnCommand(command: ChildReturnCommand) {
  validatePrompt(command, false);
  if (command.t !== 'prompt' || command.delivery !== 'auto' || command.from !== 'pane' || command.messageId !== command.key
    || command.images.length || Object.keys(command).some(k => !['t','text','key','messageId','images','delivery','from'].includes(k))) throw Error('Invalid child return command');
}
export function admitChildReturn(queue: PromptQueue | null, command: ChildReturnCommand): { receipt: PromptReceipt; fresh: boolean } {
  if (!queue) throw Error('Parent input unavailable');
  validateChildReturnCommand(command);
  // Exact replay only reconciles admission. In particular, unknown, cancelled and saved
  // receipts must not re-enter provider dispatch or release a held queue.
  const prior = queue.prior(command);
  return prior ? { receipt: prior, fresh: false } : { receipt: structuredClone(queue.command(command)), fresh: true };
}
/** Unexpected errors after admission must not turn a possibly offered return into a retry. */
export function holdChildReturnDispatch(queue: PromptQueue, id: string) {
  const entry = queue.snapshot().entries.find(e => e.id === id);
  if (entry && ['dispatching','offered'].includes(entry.phase)) queue.record(id, 'unknown', undefined, 'Child return dispatch unconfirmed');
  else queue.hold();
}
