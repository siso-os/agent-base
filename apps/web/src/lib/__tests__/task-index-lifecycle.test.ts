// @ts-nocheck
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Exercise the real shared transport; only React's mount subscription is driven manually.
const effects = vi.hoisted(() => [] as (() => void | (() => void))[]);
vi.mock('react', () => ({ useState: () => [0, () => {}], useEffect: (effect: () => void | (() => void)) => effects.push(effect) }));
const task = (title = 'Current', stage = 'building') => ({ id: 't-fixture', title, stage, updated: 'same-second', project: 'Fixture', priority: 'P1', owner: 'FIXTURE', model: null });
const index = (title = 'Current', stage = 'building') => ({ updated: 'same-second', counts: {}, tasks: [task(title, stage)] });
const deferred = () => { let resolve!: (value: unknown) => void, reject!: (error: Error) => void; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { resolve, reject, promise }; };
const response = (value: unknown, ok = true) => ({ ok, status: ok ? 200 : 503, json: async () => value });
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
let reads: (ReturnType<typeof deferred> & { signal?: AbortSignal })[];
let cleanups: (() => void)[];
let mod: typeof import('../a0-tasks');
class Source {
  static all: Source[] = [];
  events = new Map<string, (e: { data: string }) => void>();
  closed = false;
  constructor(public url: string) { Source.all.push(this); }
  addEventListener(name: string, fn: (e: { data: string }) => void) { this.events.set(name, fn); }
  emit(name: string, value: unknown = {}) { this.events.get(name)?.({ data: JSON.stringify(value) }); }
  close() { this.closed = true; }
}
const mount = () => { mod.useA0Tasks(); for (const effect of effects.splice(0)) { const cleanup = effect(); if (cleanup) cleanups.push(cleanup); } };
const state = () => { const result = mod.useA0Tasks(); effects.splice(0); return result; };
const answer = async (n: number, value: unknown, ok = true) => { reads[n].resolve(response(value, ok)); await flush(); };
const emit = async (name: string, value?: unknown) => { Source.all.at(-1)!.emit(name, value); await flush(); };
beforeEach(async () => {
  vi.resetModules(); vi.useFakeTimers(); effects.splice(0); reads = []; cleanups = []; Source.all = [];
  vi.stubGlobal('window', { setInterval, clearInterval, setTimeout, clearTimeout }); vi.stubGlobal('document', { hidden: false }); vi.stubGlobal('EventSource', Source);
  vi.stubGlobal('fetch', vi.fn((_url: string, init?: RequestInit) => { const read = { ...deferred(), signal: init?.signal ?? undefined }; reads.push(read); return read.promise; }));
  mod = await import('../a0-tasks');
});
afterEach(() => { for (const cleanup of cleanups.splice(0)) cleanup(); effects.splice(0); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('shared task index transport lifecycle', () => {
  it('keeps loading distinct from failure and accepted empty data', async () => { mount(); expect(state()).toEqual({ index: null, failed: false }); await answer(0, { updated: '', counts: {}, tasks: [] }); expect(state().index?.tasks).toEqual([]); expect(state().failed).toBe(false); });
  it('does not let initial HTTP overwrite a newer SSE snapshot with equal timestamps', async () => { mount(); await emit('index', index('SSE')); expect(reads[0].signal?.aborted).toBe(true); await answer(0, index('Old HTTP')); expect(state().index?.tasks[0].title).toBe('SSE'); });
  it('ignores an older reconnect response and its later failure', async () => { mount(); await emit('open'); await answer(1, index('New')); reads[0].reject(Error('Old failure')); await flush(); expect(state().index?.tasks[0].title).toBe('New'); expect(state().failed).toBe(false); });
  it('retains last good rows after failure and recovers on a valid snapshot', async () => { mount(); await answer(0, index()); await emit('open'); await answer(1, {}, false); expect(state().index?.tasks).toHaveLength(1); expect(state().failed).toBe(true); await emit('index', index('Recovered')); expect(state().failed).toBe(false); });
  it('marks stream loss stale and ignores a queued HTTP response after it', async () => { mount(); await emit('error'); await answer(0, index('Old')); expect(state()).toEqual({ index: null, failed: true }); await emit('open'); await answer(1, index('Recovered')); expect(state().failed).toBe(false); });
  it('rejects malformed JSON and shape while keeping prior rows', async () => { mount(); await answer(0, index()); Source.all[0].events.get('index')?.({ data: '{' }); await flush(); expect(state().index?.tasks).toHaveLength(1); expect(state().failed).toBe(true); await emit('index', { tasks: [] }); expect(state().index?.tasks).toHaveLength(1); });
  it('shares one connection and closes only when the last viewer leaves', () => { mount(); mount(); expect(reads).toHaveLength(1); expect(Source.all).toHaveLength(1); cleanups.shift()!(); expect(Source.all[0].closed).toBe(false); cleanups.shift()!(); expect(Source.all[0].closed).toBe(true); expect(reads[0].signal?.aborted).toBe(true); });
  it('ignores old connection callbacks after remount', async () => { mount(); const old = Source.all[0]; cleanups.shift()!(); mount(); await answer(1, index('New mount')); old.emit('index', index('Closed stream')); old.emit('error'); await answer(0, index('Old request')); expect(state().index?.tasks[0].title).toBe('New mount'); expect(state().failed).toBe(false); });
  it('retains cached data as stale until a reopened subscription reads again', async () => { mount(); await answer(0, index()); cleanups.shift()!(); mount(); expect(state().index?.tasks).toHaveLength(1); expect(state().failed).toBe(true); await answer(1, index()); expect(state().failed).toBe(false); });
  it('does not starve a slow fallback read with overlapping interval requests', async () => { vi.stubGlobal('EventSource', undefined); mount(); vi.advanceTimersByTime(10_000); expect(reads).toHaveLength(1); await answer(0, index('Slow')); expect(state().index?.tasks[0].title).toBe('Slow'); vi.advanceTimersByTime(5_000); expect(reads).toHaveLength(2); });
  it('times out a hung fallback read and lets a later poll recover', async () => { vi.stubGlobal('EventSource', undefined); mount(); vi.advanceTimersByTime(15_000); expect(reads[0].signal?.aborted).toBe(true); expect(state().failed).toBe(true); expect(reads).toHaveLength(2); await answer(1, index('Recovered')); await answer(0, index('Timed out')); expect(state().index?.tasks[0].title).toBe('Recovered'); expect(state().failed).toBe(false); });
  it('does not poll while hidden and clears interval after unmount', async () => { vi.stubGlobal('EventSource', undefined); mount(); await answer(0, index()); Object.assign(document, { hidden: true }); vi.advanceTimersByTime(10_000); expect(reads).toHaveLength(1); Object.assign(document, { hidden: false }); vi.advanceTimersByTime(5_000); expect(reads).toHaveLength(2); cleanups.shift()!(); vi.advanceTimersByTime(10_000); expect(reads).toHaveLength(2); });
  it('refuses stale edits without any POST', async () => { mount(); await answer(0, index()); await emit('error'); const before = reads.length; const result = await mod.saveTask('t-fixture', { stage: 'happy' }); expect(result.ok).toBe(false); expect(result.error).toMatch(/refresh unavailable/i); expect(reads).toHaveLength(before); });
});

describe('task index validation', () => {
  it.each([null, {}, {tasks:[]}, {...index(), tasks: null}, {...index(), tasks:[task(),task()]}, {...index(),tasks:[{...task(),id:'../escape'}]}, {...index(),tasks:[{...task(),title:null}]}, {...index(),tasks:[{...task(),next:42}]}, {...index(),tasks:[{...task(),needs:'yes'}]}])('rejects malformed or ambiguous payload %#', value => { expect(mod.validTaskIndex(value)).toBe(false); });
  it.each([null, [], {by_project:{Fixture:{}}}, {by_stage:{building:-1}}, {by_priority:{P1:1.5}}, {by_project:{Fixture:Infinity}}])('rejects invalid count buckets %#', counts => { expect(mod.validTaskIndex({...index(),counts})).toBe(false); });
  it('preserves unknown stages and optional metadata', () => { expect(mod.validTaskIndex(index('Future task','new-stage'))).toBe(true); expect(mod.validTaskIndex({...index(), tasks:[{...task(),parent:'t-parent',source:'unavailable'}]})).toBe(true); });
});
