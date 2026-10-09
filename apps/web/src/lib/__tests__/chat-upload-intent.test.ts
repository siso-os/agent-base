// @ts-nocheck
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { describe, expect, it } from 'vitest';

// Executable source contracts; the accompanying real-ChatView DOM suite covers
// socket events, upload completion ordering, preservation, and explicit retry.
const source = readFileSync('apps/web/src/components/ChatView.tsx', 'utf8');
const start = source.indexOf('  const uploadSend =');
const end = source.indexOf('  const takebacks =', start);
if (start < 0 || end < start) throw Error('Queued upload ownership contract is missing');
const compile = new Function('useRef', 'useCallback', 'settingsConnection', 'sealedSocketVerified', 'ws', 'WebSocket', 'setSendWhenAdded', 'setHint',
  stripTypeScriptTypes(source.slice(start, end)) + '\nreturn {uploadSend, queuedUploadIsCurrent, cancelQueuedUpload};');
function fixture() {
  const socket = { readyState: 1 };
  const settingsConnection: { current: null | { socket: typeof socket; session: string | null; hosted: boolean } } = { current: { socket, session: 'original', hosted: true } };
  const ws = { current: socket }, sealed = { current: true }, flags: boolean[] = [], hints: string[] = [];
  const ownership = compile((current: unknown) => ({ current }), (fn: Function) => fn, settingsConnection, sealed, ws, { OPEN: 1 }, (flag: boolean) => flags.push(flag), (hint: string) => hints.push(hint));
  ownership.uploadSend.current = { ...settingsConnection.current };
  return { ...ownership, socket, settingsConnection, ws, sealed, flags, hints };
}

describe('queued upload send connection ownership', () => {
  it('allows the same verified socket, session and mode', () => {
    const f = fixture(); expect(f.queuedUploadIsCurrent()).toBe(true);
    f.settingsConnection.current = { ...f.settingsConnection.current! };
    expect(f.queuedUploadIsCurrent()).toBe(true);
  });
  for (const [name, change] of [
    ['session replacement', (f: ReturnType<typeof fixture>) => { f.settingsConnection.current!.session = 'replacement'; }],
    ['missing session', (f: ReturnType<typeof fixture>) => { f.settingsConnection.current!.session = null; }],
    ['mode change', (f: ReturnType<typeof fixture>) => { f.settingsConnection.current!.hosted = false; }],
    ['read-only or unverified snapshot', (f: ReturnType<typeof fixture>) => { f.settingsConnection.current = null; }],
    ['replacement binding socket', (f: ReturnType<typeof fixture>) => { f.settingsConnection.current!.socket = { readyState: 1 }; }],
    ['replacement active socket', (f: ReturnType<typeof fixture>) => { f.ws.current = { readyState: 1 }; }],
    ['closed socket', (f: ReturnType<typeof fixture>) => { f.socket.readyState = 3; }],
    ['invalidated pin', (f: ReturnType<typeof fixture>) => { f.sealed.current = false; }],
  ] as const) it(`refuses ${name}`, () => {
    const f = fixture(); change(f); expect(f.queuedUploadIsCurrent()).toBe(false);
  });
  it('cancels once, requests a fresh explicit Send, and cannot revive after identity returns', () => {
    const f = fixture(); f.cancelQueuedUpload(); f.cancelQueuedUpload();
    expect(f.uploadSend.current).toBe(null); expect(f.flags).toEqual([false]);
    expect(f.hints).toHaveLength(1); expect(f.hints[0]).toMatch(/text and attachments are kept; press Send again/);
    expect(f.queuedUploadIsCurrent()).toBe(false);
    f.settingsConnection.current = { socket: f.socket, session: 'original', hosted: true };
    expect(f.queuedUploadIsCurrent()).toBe(false);
  });
  it('does not leave a warning when no queued send exists', () => {
    const f = fixture(); f.uploadSend.current = null; f.cancelQueuedUpload();
    expect(f.flags).toEqual([]); expect(f.hints).toEqual([]);
  });
});
