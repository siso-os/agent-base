/** Recovery's local state machine, adapted from preview/creative-20261008/mini/recovery.
 * No transport or resend effects. Socket epochs and exact prompt keys own receipts. */
export type Delivery = 'sending' | 'unknown' | 'saved' | 'confirmed' | 'failed';
export type Boundary = { id: string; text: string; at: number; turnKey: string };
export type Recovery = {
  epoch: number; transport: 'connecting' | 'online' | 'offline'; session: string | null;
  changed: boolean; attempts: number; droppedAt: number | null; backAt: number | null;
  boundary: Boundary | null; response: 'complete' | 'interrupted' | 'continued';
  deliveries: Record<string, { session: string | null; status: Delivery }>;
};
export const initialRecovery = (): Recovery => ({ epoch: 0, transport: 'connecting', session: null,
  changed: false, attempts: 0, droppedAt: null, backAt: null, boundary: null, response: 'complete', deliveries: {} });
export type RecoveryEvent =
  | { type: 'CONNECT' }
  | { type: 'DISCONNECT'; epoch: number; at: number; boundary: Boundary | null }
  | { type: 'HELLO'; epoch: number; session: string | null; at: number; text?: string; complete: boolean }
  | { type: 'SEND'; epoch: number; key: string }
  | { type: 'RECEIPT'; epoch: number; key: string; phase: string }
  | { type: 'PROGRESS'; epoch: number; id?: string; complete?: boolean }
  | { type: 'CLEAR'; epoch: number };
export function recover(s: Recovery, e: RecoveryEvent): Recovery {
  if ('epoch' in e && e.epoch !== s.epoch) return s;
  switch (e.type) {
    case 'CONNECT': return { ...s, epoch: s.epoch + 1, transport: 'connecting', attempts: s.droppedAt ? s.attempts + 1 : 0 };
    case 'DISCONNECT': return { ...s, transport: 'offline', droppedAt: s.droppedAt ?? e.at, backAt: null,
      boundary: e.boundary ?? (s.response === 'complete' ? null : s.boundary), response: e.boundary || s.response !== 'complete' && s.boundary ? 'interrupted' : s.response,
      deliveries: Object.fromEntries(Object.entries(s.deliveries).map(([k, d]) => [k, d.status === 'sending' ? { ...d, status: 'unknown' } : d])) };
    case 'HELLO': {
      const changed = !!s.session && e.session !== s.session;
      const continued = !!s.boundary && e.text !== undefined && e.text.startsWith(s.boundary.text) && e.text.length > s.boundary.text.length;
      return { ...s, transport: 'online', session: e.session, changed: s.changed || changed,
        backAt: s.droppedAt ? e.at : null,
        response: changed && s.boundary ? 'interrupted' : e.complete ? 'complete' : continued ? 'continued' : s.boundary ? 'interrupted' : s.response };
    }
    case 'SEND': return { ...s, deliveries: { ...s.deliveries, [e.key]: { session: s.session, status: 'sending' } } };
    case 'RECEIPT': {
      const d = s.deliveries[e.key];
      if (!d || d.session !== s.session || s.transport !== 'online') return s;
      if (d.status === 'confirmed') return s;
      const status: Delivery = ['accepted', 'started'].includes(e.phase) ? 'confirmed' : ['failed', 'cancelled'].includes(e.phase) ? 'failed' : e.phase === 'unknown' ? 'unknown' : ['saved', 'dispatching', 'offered'].includes(e.phase) ? 'saved' : d.status;
      return { ...s, deliveries: { ...s.deliveries, [e.key]: { ...d, status } } };
    }
    case 'PROGRESS':
      if (s.transport !== 'online' || s.changed || !s.boundary) return s;
      return e.complete ? { ...s, response: 'complete' } : e.id === s.boundary.id ? { ...s, response: 'continued' } : s;
    case 'CLEAR': return s.transport === 'online' && s.response === 'complete' && !s.changed && !Object.values(s.deliveries).some(d => d.status === 'unknown' || d.status === 'sending') ? { ...s, droppedAt: null, backAt: null, boundary: null, attempts: 0 } : s;
  }
}
export const continueDraft = (draft: string) => draft.trim() ? draft : 'continue from where you stopped';
export function recoveryMessage(s: Recovery) {
  if (s.transport !== 'online') return `Connection lost · reconnecting (attempt ${Math.max(1, s.attempts)})`;
  if (s.changed) return 'This is a new session · earlier messages are history';
  if (Object.values(s.deliveries).some(d => d.status === 'unknown')) return 'Back in this session · message delivery not known';
  if (s.response === 'interrupted') return 'Back · the reply stopped at the marker';
  if (s.boundary) return 'Back · the reply continued';
  return 'Back in the same session';
}
