import type { WebSocket } from 'ws';
import { createReviewCapture, type VerifiedReviewDelivery } from './review-capture.ts';

export type ChatDeliveryIdentity = { adapter: 'native' | 'legacy'; agentId: string; sessionId: string | null; by: string };
type CaptureOptions = { file?: string; onCaptured?: () => void; onError?: () => void };

/** A successful socket write records a sent link, never a user open or approval.
 * Identity is supplied by the authenticated source route and frozen before sending.
 * Only the exact frame sent to this socket is considered; no transcript is read here.
 */
export function sendDeliveredChat(ws: Pick<WebSocket, 'readyState' | 'OPEN' | 'send'>, frame: unknown, identity: ChatDeliveryIdentity, options: CaptureOptions = {}, encoded?: string): void {
  if (ws.readyState !== ws.OPEN) return;
  const context = { ...identity };
  const message = frame && typeof frame === 'object' ? frame as Record<string, unknown> : null;
  const events = message?.t === 'hello' ? message.log : message?.t === 'older' ? message.events : [message];
  // Chat windows already bound these pages. Refuse a malformed or oversized page rather than crawling history.
  const complete = context.sessionId && Array.isArray(events) && events.length <= 4000 ? events.flatMap(event => {
    if (!event || typeof event !== 'object' || event.t !== 'text' || event.parent || typeof event.id !== 'string' || typeof event.text !== 'string' || typeof event.at !== 'number' || !event.text.includes('http')) return [];
    return [{ t: 'text', id: event.id, text: event.text, at: event.at }];
  }) : [];
  ws.send(encoded ?? JSON.stringify(frame), error => {
    if (error || !complete.length || !context.sessionId) return;
    const deliveredAt = Date.now();
    void (async () => {
      let changed = false, failed = false;
      for (const event of complete) {
        const ref = { adapter: context.adapter, agentId: context.agentId, sessionId: context.sessionId!, messageId: event.id };
        const delivery: VerifiedReviewDelivery = { ...ref, by: context.by, deliveredAt, boundary: 'assistant-message-complete', event };
        try {
          const capture = createReviewCapture({ file: options.file, resolve: async () => delivery });
          const result = await capture(ref);
          changed = result.captured > 0 || changed;
        } catch { failed = true; }
      }
      if (changed) options.onCaptured?.();
      if (failed) options.onError?.();
    })();
  });
}
