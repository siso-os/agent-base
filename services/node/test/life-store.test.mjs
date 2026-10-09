// Synthetic regression checks only. No API, credentials, or real browser storage.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { allowed } from '../src/life.ts';
const storage = new Map();
globalThis.localStorage = { getItem: k => storage.get(k) ?? null, setItem: (k,v) => storage.set(k,v) };
const store = await import('../../../apps/web/src/components/life/store.ts');
const event = (id, overrides = {}) => ({id,day:'2026-10-07',kind:'add',key:'water',value:250,at:1,...overrides});
const put = events => storage.set('life-queue-v1', JSON.stringify(events));
test('GET /days is allowed; writes and unrelated paths stay blocked', () => {
  assert.equal(allowed('GET','/days'),true);
  assert.equal(allowed('POST','/days'),false);
  assert.equal(allowed('GET','/days/private'),false);
});
test('calendar date validation rejects impossible dates', () => {
  assert.equal(store.isDay('2026-02-30'),false);
  assert.equal(store.isDay('2024-02-29'),true);
});
test('a rejected batch retains every entry and exposes a safe error', async () => {
  put([event('valid'),event('invalid',{key:'unknown'})]);
  globalThis.fetch = async () => new Response(JSON.stringify({error:'PRIVATE RESPONSE SHOULD NEVER BE LOGGED'}),{status:400});
  await store.flush();
  assert.equal(store.queue().length,2);
  assert.match(store.syncError(),/nothing was discarded/);
  assert.ok(!store.syncError().includes('PRIVATE'));
});
test('a lost response keeps stable ids and the retry drains the queue', async () => {
  const seen = new Set();let attempt=0;
  put([event('same-id')]);
  globalThis.fetch = async (_url, options) => {
    for (const e of JSON.parse(options.body).events) seen.add(e.id);
    if(attempt++===0) throw new Error('synthetic lost response');
    return new Response('{}',{status:200});
  };
  await store.flush();assert.equal(store.queue().length,1);
  await store.flush();assert.equal(store.queue().length,0);assert.equal(seen.size,1);
});
test('entries added during a POST survive acknowledgement and drain next', async () => {
  put([event('first')]);let batches=0;
  globalThis.fetch = async () => {
    if(batches++===0) put([...store.queue(),event('second')]);
    return new Response('{}',{status:200});
  };
  await store.flush();assert.equal(batches,2);assert.equal(store.queue().length,0);
});
test('client event fold uses backend lexical tie ordering', () => {
  const state=store.applyEvents({checks:{},sets:{},counters:{}}, [event('Z',{kind:'set',key:'rating',value:1}),event('a',{kind:'set',key:'rating',value:9})]);
  assert.equal(state.sets.rating,9);
});
