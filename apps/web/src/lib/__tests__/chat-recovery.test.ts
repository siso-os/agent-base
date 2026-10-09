// @ts-nocheck
import { continueDraft, initialRecovery, recover, recoveryMessage, type Recovery } from '../chat-recovery';
const boundary = { id: 'reply', text: 'Received words', at: 100, turnKey: 'turn-1' };
function online(): Recovery { return recover(recover(initialRecovery(), { type: 'CONNECT' }), { type: 'HELLO', epoch: 1, session: 'one', at: 90, complete: true }); }
function dropped() { return recover(online(), { type: 'DISCONNECT', epoch: 1, at: 110, boundary }); }
describe('local chat recovery', () => {
  it('keeps a last received boundary and increments reconnection attempts', () => {
    const s = recover(dropped(), { type: 'CONNECT' });
    expect(s.boundary).toEqual(boundary); expect(s.response).toBe('interrupted'); expect(s.attempts).toBe(1);
    expect(recoveryMessage(s)).toContain('attempt 1');
  });
  it('does not turn a successful socket into a completed reply', () => {
    const s = recover(recover(dropped(), { type: 'CONNECT' }), { type: 'HELLO', epoch: 2, session: 'one', at: 120, text: boundary.text, complete: false });
    expect(s.response).toBe('interrupted'); expect(recoveryMessage(s)).toContain('stopped at the marker');
  });
  it('distinguishes continued replay and authoritative completion', () => {
    let s = recover(recover(dropped(), { type: 'CONNECT' }), { type: 'HELLO', epoch: 2, session: 'one', at: 120, text: boundary.text + ' and the rest', complete: false });
    expect(s.response).toBe('continued');
    s = recover(s, { type: 'PROGRESS', epoch: 2, complete: true }); expect(s.response).toBe('complete');
    expect(recover(s, { type: 'CLEAR', epoch: 2 }).boundary).toBeNull();
  });
  it('rejects stale socket receipts and a different session', () => {
    let s = recover(online(), { type: 'SEND', epoch: 1, key: 'p1' });
    s = recover(s, { type: 'DISCONNECT', epoch: 1, at: 110, boundary });
    expect(s.deliveries.p1.status).toBe('unknown');
    s = recover(s, { type: 'CONNECT' });
    expect(recover(s, { type: 'RECEIPT', epoch: 1, key: 'p1', phase: 'accepted' })).toBe(s);
    s = recover(s, { type: 'HELLO', epoch: 2, session: 'two', at: 120, complete: true });
    expect(s.changed).toBe(true); expect(s.response).toBe('interrupted');
    expect(recover(s, { type: 'RECEIPT', epoch: 2, key: 'p1', phase: 'accepted' })).toBe(s);
  });
  it('unknown and unrecognised missing phases never unlock retry', () => {
    let s = recover(online(), { type: 'SEND', epoch: 1, key: 'p1' });
    s = recover(s, { type: 'RECEIPT', epoch: 1, key: 'p1', phase: 'unknown' });
    expect(recover(s, { type: 'RECEIPT', epoch: 1, key: 'p1', phase: 'missing' }).deliveries.p1.status).toBe('unknown');
    expect(recover(s, { type: 'RECEIPT', epoch: 1, key: 'p1', phase: 'failed' }).deliveries.p1.status).toBe('failed');
    s = recover(s, { type: 'RECEIPT', epoch: 1, key: 'p1', phase: 'accepted' });
    expect(s.deliveries.p1.status).toBe('confirmed');
    expect(recover(s, { type: 'RECEIPT', epoch: 1, key: 'p1', phase: 'unknown' })).toBe(s);
  });
  it('prepares a follow-up without overwriting newer writing', () => {
    expect(continueDraft('')).toBe('continue from where you stopped'); expect(continueDraft('Keep my draft')).toBe('Keep my draft');
  });
  it('keeps windows independent', () => { const second = online(); dropped(); expect(second.droppedAt).toBeNull(); });
});
