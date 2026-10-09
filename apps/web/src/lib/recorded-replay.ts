import type { Ev } from './chat';
import type { SessionReplayAgent, SessionReplayEvent } from '../components/SessionReplay';

/** A projection of recorded observations, never a reconstruction of missing lifecycle events. */
export function recordedReplay(events: readonly Ev[], sessionId: string, owner: SessionReplayAgent) {
  const frames: SessionReplayEvent[] = [];
  const seen = new Set<string>();
  const timestamp = (at: unknown) => typeof at === 'number' && Number.isFinite(at) && at > 0 && at <= 8.64e15 ? new Date(at).toISOString() : null;
  for (const event of events) {
    // A parent tool ID does not identify the worker's face or session ownership.
    if ('parent' in event && event.parent) continue;
    let frame: SessionReplayEvent | null = null;
    if (event.t === 'tool' && event.id && timestamp(event.at)) {
      frame = { id: `tool:${event.id}:${event.at}`, timestamp: timestamp(event.at)!, kind: 'tool-working', owner,
        title: `Tool invocation: ${event.name}`, tool: { name: event.name, detail: event.summary },
        receipt: 'Tool invocation recorded at this position. Its outcome is not inferred.', reference: event.id };
    } else if (event.t === 'tool_done' && event.id && event.ok === false && timestamp(event.at)) {
      frame = { id: `tool_done:${event.id}:${event.at}`, timestamp: timestamp(event.at)!, kind: 'failed', owner,
        title: 'Tool failure recorded', receipt: event.out || 'The recorded tool result reports failure.', reference: event.id };
    } else if (event.t === 'question' && event.request.session === sessionId && event.request.id && timestamp(event.request.createdAt)) {
      frame = { id: `question:${event.request.hostInstance}:${event.request.id}`, timestamp: timestamp(event.request.createdAt)!, kind: 'decision-waiting', owner,
        title: 'Question recorded', decision: { question: event.request.questions.map(q => q.question).join('\n') },
        receipt: 'Question opened at this position. Later answers remain in the original chat.', reference: event.request.id };
    }
    // Successful tool results do not establish artifact readiness. An answered question
    // does not carry its answer or prove a decision was accepted. Keep those in chat.
    if (frame && !seen.has(frame.id)) { seen.add(frame.id); frames.push(frame); }
  }
  return { frames, omitted: events.length - frames.length, total: events.length };
}
