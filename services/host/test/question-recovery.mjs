// Real Questions class, separate processes and sealed private files. No provider/account/model calls.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { Questions, normalizeQuestions } from '../src/questions.ts';
const specs = normalizeQuestions([{ id: 'pick', question: 'Choose a fixture?', options: [{ label: 'A' }, { label: 'B' }], isOther: false }], 'codex');
const input = session => ({ session, provider: 'codex', toolId: 'native-tool', nativeRequestId: 'native-envelope', turnId: 'native-turn', questions: specs });
const answer = (q, id) => ({ t: 'answer_question', id: q.id, hostInstance: q.hostInstance, session: q.session, submissionId: id, action: 'answer', answers: { pick: ['B'] } });
const mode = process.argv[2], root = process.argv[3];
const persistence = directory => ({ directory, owner: { seat: 'fixture-seat', cwd: '/fixture-workspace', provider: 'codex', workspaceId: 'fixture-workspace-id' } });
if (mode === 'seed') {
  const q = new Questions(() => {}, persistence(root));
  const pending = q.add(input('pending'), async () => { throw Error('Seed pending callback must not run'); });
  const dispatching = q.add(input('dispatching'), async () => { writeFileSync(path.join(root, 'provider-received'), 'one'); await new Promise(() => {}); });
  void q.answer(answer(dispatching, 'reserved-original'));
  const done = q.add(input('done'), async () => {});
  await q.answer(answer(done, 'completed-original'));
  writeFileSync(path.join(root, 'seed.json'), JSON.stringify({ pending, dispatching, done }));
  // Abrupt exit skips suspend/cancellation: on-disk dispatch must recover as uncertain, never answered.
  process.exit(0);
}
if (mode === 'restore') {
  const seed = JSON.parse(readFileSync(path.join(root, 'seed.json'))), events = [];
  const q = new Questions(e => events.push(e), persistence(root));
  for (const session of ['pending', 'dispatching']) {
    const state = q.recoverySnapshot(session);
    assert.equal(state.records.length, 1); assert.equal(state.records[0].phase, 'unconfirmed'); assert.equal(state.records[0].actionable, false);
  }
  assert.equal(q.snapshot().length, 0, 'saved data must never create a provider callback');
  assert.equal(q.recoverySnapshot('dispatching').submissions[0].phase, 'unconfirmed');
  assert.equal(q.recoverySnapshot('done').records[0].phase, 'answered');
  await q.answer(answer(seed.done, 'completed-original'));
  assert.equal(events.at(-1).t, 'question_failed', 'old-host receipt replay cannot acknowledge this host');
  let sends = 0;
  const rebound = q.add(input('pending'), async () => { sends++; await new Promise(r => setTimeout(r, 5)); });
  assert.deepEqual(rebound.recoveredFrom, { id: seed.pending.id, hostInstance: seed.pending.hostInstance });
  assert.notEqual(rebound.id, seed.pending.id); assert.notEqual(rebound.hostInstance, seed.pending.hostInstance);
  const duplicate = q.add(input('pending'), async () => { throw Error('Duplicate provider callback invoked'); });
  assert.equal(duplicate.id, rebound.id);
  assert.throws(() => q.add({ ...input('pending'), questions: [{ ...specs[0], question: 'Changed body' }] }, async () => {}), /identity changed/);
  await q.answer(answer(seed.pending, 'stale-host'));
  await q.answer({ ...answer(rebound, 'stale-session'), session: 'another-session' });
  assert.equal(sends, 0);
  const other = q.add({ ...input('pending'), toolId: 'other', nativeRequestId: 'other' }, async () => { sends++; });
  other.questions[0].question = 'Caller mutation';
  assert.equal(q.snapshot().find(r => r.id === other.id).questions[0].question, 'Choose a fixture?');
  const command = answer(rebound, 'immutable');
  await Promise.all([q.answer(command), q.answer(command), q.answer(answer(other, 'immutable'))]);
  await q.answer(command);
  assert.equal(sends, 1, 'concurrent viewers and cross-request submission reuse send once');
  assert.ok(events.some(e => e.t === 'question_failed' && e.code === 'invalid'));
  const afterDone = q.add(input('pending'), async () => { throw Error('Settled native envelope replayed'); });
  assert.equal(afterDone.id, rebound.id);
  const inflight = q.add(input('dispatching'), async () => { sends++; });
  await q.answer(answer(inflight, 'reserved-original'));
  assert.equal(sends, 1, 'reserved answer identity stays immutable across host restart');
  await q.answer(answer(inflight, 'explicit-after-rebind'));
  assert.equal(sends, 2);
  const secondWriter = new Questions(() => {}, persistence(root));
  assert.equal(secondWriter.recoverySnapshot('pending').status, 'unavailable');
  assert.throws(() => secondWriter.add(input('pending'), async () => { sends++; }), /unavailable/);
  for (const [key, value] of [['seat','other-seat'],['cwd','/other-workspace'],['workspaceId','other-workspace-id'],['serviceLabel','other-service-label'],['provider','claude']]) {
    const options = persistence(root); options.owner[key] = value;
    const otherOwner = new Questions(() => {}, options);
    assert.equal(otherOwner.recoverySnapshot('pending').records.length, 0, `${key} cannot read another owner's question`);
  }
  const distinct = q.add({ ...input('different-session'), questions: specs }, async () => { sends++; });
  assert.equal(distinct.recoveredFrom, undefined);
  const failing = q.add({ ...input('pending'), toolId: 'failed', nativeRequestId: 'failed' }, async () => { throw Error('Uncertain provider failure'); });
  const failed = await q.answer(answer(failing, 'failed-delivery'));
  assert.equal(failed.outcome, 'cancelled'); assert.equal(failed.reason, 'delivery-unconfirmed');
  assert.equal(q.recoverySnapshot('pending').records.find(r => r.request.id === failing.id).phase, 'unconfirmed');
  let release;
  const suspended = q.add({ ...input('pending'), toolId: 'suspended', nativeRequestId: 'suspended' }, async () => { await new Promise(r => { release = r; }); });
  const settling = q.answer(answer(suspended, 'suspend-race'));
  q.suspend(); release(); await settling;
  assert.ok(!events.some(e => e.t === 'question_done' && e.id === suspended.id && e.outcome === 'answered'));
  assert.equal(q.recoverySnapshot('pending').records.find(r => r.request.id === suspended.id).phase, 'unconfirmed');
  const journals = readdirSync(root).filter(f => /^[a-f0-9]{64}\.json$/.test(f));
  for (const file of journals) assert.equal(statSync(path.join(root, file)).mode & 0o777, 0o600);
  assert.equal(statSync(root).mode & 0o777, 0o700);
  const target = journals.find(file => JSON.parse(readFileSync(path.join(root, file))).session === 'pending');
  writeFileSync(path.join(root, 'corrupt-target'), target);
  console.log(JSON.stringify({ ok: true, checks: ['process recovery has no callbacks', 'in-flight result stays unconfirmed', 'completed historical receipt is not acknowledged for a new host', 'native callback rebind changes host/request IDs', 'duplicate native envelopes deduplicate', 'changed native body refused', 'stale host/session refused', 'concurrent immutable submissions send once', 'reserved pre-crash submission cannot be reused', 'rebind requires an explicit new submission', 'second writer blocked', 'seat/cwd/workspace/provider/session isolated', 'provider failure stays unconfirmed', 'suspend/delivery race never emits answered', 'private file modes'] }));
  process.exit(0);
}
if (mode === 'corrupt') {
  const q = new Questions(() => {}, persistence(root));
  const state = q.recoverySnapshot('pending');
  assert.equal(state.status, 'unavailable'); assert.ok(state.records.length > 0, 'last-good history remains visible');
  assert.ok(state.records.every(r => r.actionable === false));
  assert.throws(() => q.add(input('pending'), async () => { throw Error('Callback must not run'); }), /unavailable/);
  console.log('PASS corrupt primary: last-good evidence retained, all delivery blocked'); process.exit(0);
}

const scratch = mkdtempSync(path.join(tmpdir(), '.siso-ephemeral-question-recovery.'));
try {
  const journalDir = path.join(scratch, 'questions');
  const run = stage => {
    const result = spawnSync(process.execPath, ['--experimental-strip-types', '--no-warnings', import.meta.filename, stage, journalDir], { encoding: 'utf8', timeout: 20000 });
    assert.equal(result.status, 0, result.stderr || result.error?.message); if (result.stdout.trim()) console.log(result.stdout.trim());
  };
  run('seed'); run('restore');
  writeFileSync(path.join(journalDir, readFileSync(path.join(journalDir, 'corrupt-target'), 'utf8')), '{broken'); run('corrupt');
  let sends = 0; const dir = path.join(scratch, 'write-failure'), q = new Questions(() => {}, persistence(dir));
  const request = q.add(input('failure'), async () => { sends++; });
  const file = path.join(dir, readdirSync(dir).find(f => f.endsWith('.json')));
  renameSync(file, file + '.retained'); mkdirSync(file);
  await q.answer(answer(request, 'failed-reservation'));
  assert.equal(sends, 0); assert.equal(q.recoverySnapshot('failure').status, 'unavailable'); q.suspend();
  console.log('PASS reservation write failure blocks provider send');
  const bounded = new Questions(() => {});
  for (let n = 0; n < 256; n++) bounded.add({ ...input('bounded'), toolId: 'tool-' + n, nativeRequestId: 'native-' + n }, async () => {});
  assert.throws(() => bounded.add({ ...input('bounded'), toolId: 'overflow', nativeRequestId: 'overflow' }, async () => {}), /limit/);
  bounded.suspend(); console.log('PASS bounded journal refuses overflow without evicting identities');
} finally { rmSync(scratch, { recursive: true, force: true }); }
