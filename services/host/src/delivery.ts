// Queue contract adapted from T3 Code orchestrationV2.ts (MIT, T3 Tools Inc., 2026).
export type DeliveryMode = 'next' | 'steer' | 'auto';
export type DeliveryPhase = 'saved' | 'dispatching' | 'offered' | 'accepted' | 'started' | 'cancelled' | 'unknown';
export type QueuedPrompt = { id: string; key: string; text: string; images: string[]; from: 'app' | 'pane'; mode: DeliveryMode; phase: DeliveryPhase; targetTurnId?: string; providerTurnId?: string; failure?: string };
export type QueueSnapshot = { session: string; revision: number; held: boolean; entries: QueuedPrompt[] };
export type DeliveryCapabilities = { version: 1; auto?: boolean; steer: 'native-turn' | 'sdk-boundary' | false; images: boolean; activeTurnId: string | null; compacting: boolean };
export type PromptReceipt = { t: 'prompt.receipt'; key: string; id?: string; phase: DeliveryPhase | 'failed'; queueRevision: number; code?: string; text?: string };
export const validId = (s: unknown): s is string => typeof s === 'string' && /^[A-Za-z0-9:_-]{1,180}$/.test(s);
export function validatePrompt(m: any, images: boolean) {
  if (!validId(m.key) || !validId(m.messageId) || !['next','steer','auto'].includes(m.delivery)) throw Error('invalid_command');
  if (typeof m.text !== 'string' || m.text.length > 100_000 || !Array.isArray(m.images) || m.images.length > 20 || m.images.some((p: unknown) => typeof p !== 'string' || p.length > 4096) || (!m.text.trim() && !m.images.length)) throw Error('invalid_prompt');
  if (!images && m.images.length) throw Error('unsupported_images');
  if (m.delivery === 'steer' && !validId(m.expectedTurnId)) throw Error('stale_turn');
}
