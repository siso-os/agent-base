import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { readDeliveredWork } from '../src/delight.ts';

const root = mkdtempSync(path.join(tmpdir(), '.siso-ephemeral-delivery-'));
mkdirSync(path.join(root, 'ui-hub/proof'), { recursive: true });
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==', 'base64');
for (const name of ['before', 'after']) writeFileSync(path.join(root, `ui-hub/proof/${name}.png`), png);
const notes = path.join(root, 'notes.jsonl'), log = path.join(root, 'live.jsonl');
const sha = 'a'.repeat(40), session = 'session-a', agentKey = 'agent-key-a';
const prompt = { id: 'prompt-a', at: '2026-10-05T20:00:00Z', source: 'message:prompt-a' };
const note = { sha, title: 'A real delivered change', delivery: { taskId: 't-0001', agentKey, session, prompt }, evidence: [{ id: 'surface', title: 'Surface', before: { path: 'ui-hub/proof/before.png', sha: 'b'.repeat(40) }, after: { path: 'ui-hub/proof/after.png', sha } }] };
const live = { sha, at: '2026-10-05T20:05:00Z', kind: 'web', result: 'live' };
const put = (ns = [note], ls = [live]) => { writeFileSync(notes, ns.map(n => JSON.stringify(n)).join('\n')); writeFileSync(log, ls.map(l => JSON.stringify(l)).join('\n')); };
const read = (key = agentKey, sid = session) => readDeliveredWork(root, key, sid, { notes, log, now: Date.parse('2026-10-06T00:00:00Z') });
put();
assert.equal(read().deliveries.length, 1);
assert.equal(read().deliveries[0].evidence.state, 'available');
assert.equal(read().deliveries[0].live.verified, true);
assert.equal(read('same-name-different-key').deliveries.length, 0);
assert.equal(read(agentKey, 'successor-session').deliveries.length, 0);
put([{ ...note, delivery: undefined }]); assert.equal(read().deliveries.length, 0);
put([note], [{ ...live, result: 'built' }]); assert.equal(read().deliveries.length, 0);
put([note], [{ ...live, result: 'refused' }]); assert.equal(read().deliveries.length, 0);
put([note], [live, { ...live, at: '2026-10-05T20:06:00Z', result: 'rolled-back' }]); assert.equal(read().deliveries.length, 0);
put([note], [live, { ...live, at: '2026-10-05T20:06:00Z', result: 'rolled-back' }, { ...live, at: '2026-10-05T20:07:00Z' }]); assert.equal(read().deliveries[0].live.at, '2026-10-05T20:07:00Z');
put([note, note], [live, { ...live, kind: 'node' }]); assert.equal(read().deliveries.length, 1);
for (const bad of ['invalid', live.at, '2026-10-07T00:00:00Z']) {
  put([{ ...note, delivery: { ...note.delivery, prompt: { ...prompt, at: bad } } }]); assert.equal(read().deliveries.length, 0);
}
put([{ ...note, evidence: undefined }]); assert.equal(read().deliveries[0].evidence.state, 'unavailable');
put([note], [{ ...live, at: '2026-10-07T00:00:00Z' }]); assert.equal(read().deliveries.length, 0);
assert.equal(readDeliveredWork(root, agentKey, session, { notes: path.join(root, 'missing'), log }).error, 'Delivery provenance is unavailable.');
console.log('PASS delivery provenance: exact recipient/session, original prompt, real release, rollback/reinstall, deduplication, dates and missing evidence');
