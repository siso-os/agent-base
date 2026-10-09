// Synthetic closed-chat retention probe; no workstation transcript reads.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { setImmediate as turn } from 'node:timers/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

if (!global.gc) throw Error('Run with --expose-gc');
const kind = process.argv[2];
assert.ok(['claude', 'codex'].includes(kind));
const measuring = process.argv.includes('--baseline');
const source = new URL(`../src/${kind === 'codex' ? 'codex-' : ''}transcript.ts`, import.meta.url);
const { transcriptOf } = await import(source);
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), '.siso-ephemeral-app-weight-'));
const count = 48, payloadBytes = 512 * 1024;
const record = (id, text) => JSON.stringify(kind === 'codex'
  ? { type: 'response_item', timestamp: '2026-10-09T00:00:00Z', payload: { type: 'message', id, role: 'user', content: [{ type: 'input_text', text }] } }
  : { type: 'user', uuid: id, timestamp: '2026-10-09T00:00:00Z', message: { role: 'user', content: text } }) + '\n';
const file = i => path.join(scratch, `${i}.jsonl`);
const heap = async () => { await turn(); for (let i = 0; i < 5; i++) global.gc(); return process.memoryUsage(); };
async function visit(i, subscribe = true) {
  const t = transcriptOf(file(i));
  assert.equal(t.log[0].text.length, payloadBytes);
  if (subscribe) { const stop = t.subscribe(() => {}); stop(); }
}
try {
  for (let i = 0; i < count; i++) fs.writeFileSync(file(i), record(`large-${i}`, String(i % 10).repeat(payloadBytes)));
  const before = await heap();
  for (let i = 0; i < count; i++) { await visit(i); await turn(); }
  const closed = await heap();
  // An ended or sleeping chat reads history without subscribing.
  for (let i = 0; i < count; i++) { await visit(i, false); await turn(); }
  const readOnly = await heap();
  const retained = closed.heapUsed - before.heapUsed;
  if (!measuring) {
    assert.ok(retained < 3 * payloadBytes, `closed-chat heap retained ${retained}`);
    assert.ok(readOnly.heapUsed - before.heapUsed < 3 * payloadBytes, 'read-only opens must not remain globally cached');
  }
  // Active viewers share a source; removing one must not cut off the other.
  let a = transcriptOf(file(0)); const eventsA = [], eventsB = [];
  const stopA = a.subscribe(e => eventsA.push(e));
  let b = transcriptOf(file(0)); assert.equal(a, b);
  const stopB = b.subscribe(e => eventsB.push(e));
  stopA();
  fs.appendFileSync(file(0), record('append', 'still delivered'));
  b.catchUp();
  assert.equal(eventsB.filter(e => e.text === 'still delivered').length, 1);
  assert.equal(eventsA.length, 0);
  assert.equal(transcriptOf(file(0)), b);
  stopB(); await turn();
  const reopened = transcriptOf(file(0));
  assert.equal(reopened.log[0].text.length, payloadBytes);
  assert.equal(reopened.log.at(-1).text, 'still delivered');
  if (!measuring) assert.notEqual(reopened, a);
  if (kind === 'claude' && !measuring) {
    const imageFile = file('images');
    fs.writeFileSync(imageFile, record('old-image', '[Image #1] old'));
    const first = transcriptOf(imageFile);
    const close = first.subscribe(() => {});
    first.expectImages(['fixture.png']); close(); await turn();
    const next = transcriptOf(imageFile);
    const closeNext = next.subscribe(() => {});
    assert.equal(next.log[0].images, undefined, 'old images must not consume a pending paste');
    fs.appendFileSync(imageFile, record('new-image', '[Image #1] new'));
    next.catchUp();
    assert.deepEqual(next.log.at(-1).images, ['fixture.png']);
    closeNext(); await turn();
    assert.deepEqual(transcriptOf(imageFile).log.at(-1).images, ['fixture.png'], 'reopen preserves matched image names');
    await turn();
    // A delivery that awaited recipient verification can call the disconnected source.
    first.expectImages(['late.png']);
    fs.appendFileSync(imageFile, record('late-image', '[Image #1] late'));
    assert.deepEqual(transcriptOf(imageFile).log.at(-1).images, ['late.png']);
    await turn();
    const now = Date.now;
    first.expectImages(['expired.png']);
    try {
      Date.now = () => now() + 120_001;
      fs.appendFileSync(imageFile, record('expired-image', '[Image #1] expired'));
      assert.equal(transcriptOf(imageFile).log.at(-1).images, undefined);
    } finally { Date.now = now; }
  }
  console.log(JSON.stringify({ kind, node: process.version, count, payloadBytes, sourceSha256: createHash('sha256').update(fs.readFileSync(source)).digest('hex'), before, closed, readOnly, retainedHeapBytes: retained, readOnlyRetainedHeapBytes: readOnly.heapUsed - before.heapUsed, checks: ['complete history', 'shared active viewers', 'last viewer release', 'remaining viewer receives append', 'reopen catches up'], scope: 'forced-GC synthetic transcript ownership; not live server RSS' }, null, 2));
} finally { fs.rmSync(scratch, { recursive: true, force: true }); }
