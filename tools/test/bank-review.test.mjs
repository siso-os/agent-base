import assert from 'node:assert/strict';
import { test } from 'node:test';
import { reviewLensLines } from '../../apps/web/src/lib/review-lens.ts';
import { recordedReplay } from '../../apps/web/src/lib/recorded-replay.ts';

const file = { revisionId: 'rev1', file: { id: 'file1', content: 'available' }, hunks: [{ rows: [
  { kind: 'context', oldLine: 7, newLine: 8, text: 'same' },
  { kind: 'deleted', oldLine: 8, newLine: null, text: 'old' },
  { kind: 'marker', oldLine: null, newLine: null, text: '\\ No newline at end of file' },
  { kind: 'added', oldLine: null, newLine: 9, text: '' },
] }] };
test('review lens retains exact sides and coordinates without pairing unrelated lines', () => {
  assert.deepEqual(reviewLensLines(file, 'rev1'), [
    { id: 'rev1:file1:0:1', before: 'old', beforeLine: 8 },
    { id: 'rev1:file1:0:3', after: '', afterLine: 9 },
  ]);
});
test('stale revisions and unavailable contents cannot become a lens', () => {
  assert.deepEqual(reviewLensLines(file, 'rev2'), []);
  for (const content of ['binary', 'too-large', 'omitted']) assert.deepEqual(reviewLensLines({ ...file, file: { ...file.file, content } }, 'rev1'), []);
});
test('lens identity changes with capture and keeps deleted-only files', () => {
  const deleted = { ...file, revisionId: 'rev2', hunks: [{ rows: [file.hunks[0].rows[1]] }] };
  assert.deepEqual(reviewLensLines(deleted, 'rev2'), [{ id: 'rev2:file1:0:0', before: 'old', beforeLine: 8 }]);
});
const owner = { name: 'Recorded agent', family: 'codex' };
const at = Date.parse('2026-10-06T00:00:00Z');
const tool = { t: 'tool', id: 'tool1', name: 'Read', summary: 'Read synthetic file', at };
const question = { t: 'question', request: { id: 'q1', hostInstance: 'host1', session: 's1', createdAt: at + 1000, questions: [{ question: 'Which layout?' }] } };
test('replay uses explicit event timestamps and identities in recorded order', () => {
  const { frames, omitted } = recordedReplay([tool, question, { t: 'tool_done', id: 'tool1', ok: false, out: 'Failed read', at: at + 2000 }], 's1', owner);
  assert.equal(omitted, 0);
  assert.deepEqual(frames.map(f => f.kind), ['tool-working', 'decision-waiting', 'failed']);
  assert.equal(frames[0].timestamp, '2026-10-06T00:00:00.000Z');
  assert.equal(frames[0].reference, tool.id);
  assert.equal(frames[2].receipt, 'Failed read');
});
test('missing or invalid timestamp is never replaced by wall clock', () => {
  for (const bad of [undefined, NaN, Infinity, -1, 0, 9e15]) {
    assert.equal(recordedReplay([{ ...tool, at: bad }, { t: 'tool_done', id: 'x', ok: false, at: bad }], 's1', owner).frames.length, 0);
  }
});
test('successful tool completion and answered questions never imply ready or accepted', () => {
  const events = [{ t: 'tool_done', id: 'tool1', ok: true, at }, { t: 'question_done', id: 'q1', outcome: 'answered', at }, { t: 'approval_done', id: 'a1', allow: true }, { t: 'result', ms: 3, at }];
  assert.deepEqual(recordedReplay(events, 's1', owner), { frames: [], omitted: 4, total: 4 });
});
test('foreign questions and unidentified workers do not inherit parent ownership', () => {
  assert.equal(recordedReplay([question, { ...tool, parent: 'worker-tool' }], 's2', owner).frames.length, 0);
});
test('event duplicates and missing IDs are omitted with coverage counts', () => {
  const result = recordedReplay([tool, tool, { ...tool, id: '' }], 's1', owner);
  assert.equal(result.frames.length, 1); assert.equal(result.omitted, 2); assert.equal(result.total, 3);
});
