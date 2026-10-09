/** Pure projections for the approved chat surfaces; presentation never creates a receipt. */
import type { Call, Ev, Task, Turn } from './chat';
import type { ChatActivityRailProps } from '../components/ChatActivityRail';
import type { InspectOutputItem } from '../components/OutputInspectDock';

export function safeChatDestination(raw: string): string | null {
  try {
    if (!/^https?:\/\//i.test(raw) || /[\u0000-\u0020\u007f]/.test(raw)) return null;
    const url = new URL(raw);
    return ['http:', 'https:'].includes(url.protocol) && url.hostname && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}
export function resultReceipts(events: readonly Ev[]): ReadonlySet<number> {
  return new Set(events.flatMap(event => event.t === 'result' && !('parent' in event && event.parent) && Number.isFinite(event.at) ? [event.at] : []));
}
export function responseReceipt(turn: Turn, completed: ReadonlySet<number>, live: boolean) {
  const failure = [...turn.work, ...turn.answer].find(item => item.k === 'error');
  if (failure?.k === 'error') return { status: 'failed' as const, failure: failure.text };
  if (live) return { status: turn.answer.some(item => item.k === 'said' && item.text) ? 'streaming' as const : 'working' as const };
  return { status: turn.done && turn.endedAt != null && completed.has(turn.endedAt) ? 'complete' as const : 'unconfirmed' as const };
}
export function callActivity(call: Call, task?: Task, delegation = false): Pick<ChatActivityRailProps, 'kind' | 'status' | 'summary' | 'command' | 'output' | 'result' | 'delegation' | 'worker'> {
  if (delegation) {
    const returned = !!task?.endedAt && !!task.summary && ['done', 'completed'].includes(task.status);
    const failed = call.end?.ok === false || !!task?.endedAt && ['failed', 'killed', 'stopped', 'blocked'].includes(task.status);
    return { kind: 'delegating', summary: call.summary, status: failed ? 'failed' : returned ? 'succeeded' : task?.status === 'running' || call.done === undefined ? 'running' : 'idle',
      delegation: returned ? 'result-returned' : task?.hostName || call.bg ? 'child-started' : 'assignment-pending',
      worker: task?.hostName ? { name: task.hostName } : undefined,
      output: returned ? task!.summary! : undefined,
      result: failed ? task?.status ?? call.end?.status : undefined };
  }
  return { kind: 'command', status: call.done ? call.done.ok ? 'succeeded' : 'failed' : 'running', summary: call.summary,
    command: call.input?.command, output: call.done?.out, result: call.done ? call.done.ok ? 'Tool result received' : 'Tool reported failure' : undefined };
}
export function suppliedToolOutputs(turns: readonly Turn[]): InspectOutputItem[] {
  const supplied = new Map<string, InspectOutputItem>();
  for (const turn of turns) for (const item of [...turn.work, ...turn.answer]) {
    // Child launch handles remain in their existing task rows; they are not completed output documents.
    const calls = item.k === 'run' ? item.calls : item.k === 'one' ? [item.call] : [];
    for (const call of calls) if (call.done?.out !== undefined) supplied.set(`tool:${call.id}`, {
      id: `tool:${call.id}`, title: call.summary || call.name, kind: 'log', state: call.done.ok ? 'ready' : 'failed',
      detail: `${call.name} · supplied tool output`, body: call.done.out,
    });
  }
  return [...supplied.values()].reverse().slice(0, 20);
}
