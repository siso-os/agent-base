// Execute production delivery/restart admission against the real durable queue in a sealed VM.
// No model, host process, account, socket or terminal capability is available here.
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { stripTypeScriptTypes } from 'node:module';
import { randomUUID } from 'node:crypto';
import { PromptQueue } from '../src/prompt-queue.ts';
import { validatePrompt } from '../src/delivery.ts';

process.env.AB_PROMPT_QUEUE_DIR = mkdtempSync(path.join(tmpdir(), '.siso-ephemeral-stopped-queue.'));
const source = readFileSync(new URL('../src/host.ts', import.meta.url), 'utf8');
const start = source.indexOf('function validQueuedImages('), end = source.indexOf('// ---------------------------------------------------------------- compaction,', start);
const offer = source.indexOf('function offerClaude('), offerEnd = source.indexOf('/** He took a waiting message back', offer);
assert.ok(start > 0 && end > start && offer > end && offerEnd > offer);
const production = stripTypeScriptTypes(source.slice(start, end) + source.slice(offer, offerEnd)) + '\nglobalThis.command = deliveryCommand; globalThis.drain = drainNext;';
const prompt = (id, extra = {}) => ({ t: 'prompt', key: id, messageId: id, text: `fixture-${id}`, images: [], delivery: 'next', from: 'app', ...extra });
function fixture() {
  const queue = new PromptQueue(randomUUID(), 'sealed-session'); queue.hold();
  const events = [], inbox = [], waiting = new Map(); let wakes = 0;
  const context = vm.createContext({
    queueStore: queue, child: 'stopped', rootEpoch: null, rootPrompt: null, session: 'sealed-session',
    compacting: null, waiting, inbox, settingsHeld: [], held: [], pending: new Map(), questions: new Map(), state: 'blocked',
    randomUUID, validatePrompt, Date, Map, Set, compactedAuto: new Set(), UPLOADS: '/fixture/uploads',
    MEDIA: { png: 'image/png' }, path: { extname: path.extname }, uploadPath: (_root, p) => typeof p === 'string' && p.startsWith('/fixture/uploads/') ? p : null,
    imageBlocks: images => ({ blocks: [], ok: images.filter(p => p === '/fixture/uploads/valid.png') }),
    emit: e => events.push(e), publishQueue: () => {}, report: () => {}, activity: { start: () => {} }, out: () => {}, dim: s => s,
    enqueueClaude: msg => { inbox.push(msg); wakes++; }, restartNow: () => wakes++, wake: () => { throw Error('stopped child must not use the running-child wake'); }, bootstrap: [],
  }, { codeGeneration: { strings: false, wasm: false } });
  vm.runInContext(production, context, { timeout: 1000 });
  return { queue, events, inbox, command: context.command, drain: context.drain, wakes: () => wakes };
}
const cases = [];
async function check(name, run) { await run(); cases.push(name); console.log(`PASS ${name}`); }

await check('fresh next prompt restarts once; exact retry and automatic drains do not loop', async () => {
  const f = fixture(), p = prompt('new');
  await f.command(p); await f.command(p); f.drain(); f.drain('new');
  assert.equal(f.wakes(), 1); assert.equal(f.inbox.length, 1); assert.equal(f.inbox[0].uuid, 'new');
  assert.equal(f.queue.snapshot().held, true);
});
await check('unknown previous delivery stays held; its retry cannot restart; new prompt is distinct', async () => {
  const f = fixture(), old = prompt('old'); f.queue.command(old); f.queue.claim('old'); f.queue.record('old', 'unknown');
  await f.command(old); assert.equal(f.wakes(), 0);
  await f.command(prompt('fresh'));
  assert.equal(f.wakes(), 1); assert.deepEqual(f.inbox.map(x => x.uuid), ['fresh']);
  assert.equal(f.queue.snapshot().entries.find(e => e.id === 'old').phase, 'unknown');
});
await check('cancelled prompt, its replay and explicit send cannot restart', async () => {
  const f = fixture(), p = prompt('cancelled'); f.queue.command(p);
  await f.command({ t: 'queue.remove', key: 'remove', id: 'cancelled', expectedRevision: f.queue.snapshot().revision });
  await f.command(p);
  await f.command({ t: 'queue.send', key: 'send-cancelled', id: 'cancelled', expectedRevision: f.queue.snapshot().revision });
  assert.equal(f.wakes(), 0); assert.equal(f.inbox.length, 0);
  assert.equal(f.queue.snapshot().entries[0].phase, 'cancelled');
});
await check('stale revision and stale steering cannot restart', async () => {
  const f = fixture(); f.queue.command(prompt('saved'));
  await f.command({ t: 'queue.send', key: 'stale-send', id: 'saved', expectedRevision: -1 });
  await f.command(prompt('steer', { delivery: 'steer', expectedTurnId: 'ended-turn' }));
  assert.equal(f.wakes(), 0); assert.equal(f.inbox.length, 0);
  assert.ok(f.events.some(e => e.code === 'conflict')); assert.ok(f.events.some(e => e.code === 'stale_turn'));
});
await check('empty, outside-root and missing-image prompts cannot restart', async () => {
  const f = fixture();
  await f.command(prompt('blank', { text: '' }));
  await f.command(prompt('outside', { images: ['/outside/private.png'] }));
  await f.command(prompt('missing', { images: ['/fixture/uploads/gone.png'] }));
  assert.equal(f.wakes(), 0); assert.equal(f.inbox.length, 0);
  assert.equal(f.queue.snapshot().entries.find(e => e.id === 'missing').phase, 'saved');
  assert.equal(f.queue.snapshot().entries.find(e => e.id === 'missing').failure, 'invalid_upload');
});
await check('edits and reorder keep stopped child down; explicit Send dispatches exact saved entry once', async () => {
  const f = fixture(); f.queue.command(prompt('saved')); f.queue.command(prompt('other'));
  await f.command({ t: 'queue.edit', key: 'edit', id: 'saved', text: 'corrected', expectedRevision: f.queue.snapshot().revision });
  await f.command({ t: 'queue.move', key: 'move', id: 'saved', beforeId: null, expectedRevision: f.queue.snapshot().revision });
  assert.equal(f.wakes(), 0);
  const send = { t: 'queue.send', key: 'explicit-send', id: 'saved', expectedRevision: f.queue.snapshot().revision };
  await f.command(send); await f.command(send);
  assert.equal(f.wakes(), 1); assert.deepEqual(f.inbox.map(x => x.uuid), ['saved']);
  assert.equal(f.inbox[0].message.content, 'corrected');
  assert.equal(f.queue.snapshot().entries.find(e => e.id === 'other').phase, 'saved');
});
console.log(JSON.stringify({ passed: cases.length, of: cases.length, proof: 'sealed production delivery functions, real durable queue; no model or host controls' }));
