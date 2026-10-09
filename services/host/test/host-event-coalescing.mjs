// HostEventCoalescingParity. Run original first with --baseline, then candidate without it.
// Controls herdr completion cadence; reads the real host source and its WebSocket events.
import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, chmodSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { WebSocket } from 'ws';

const baseline = process.argv.includes('--baseline');
const source = path.resolve(import.meta.dirname, '../src/host.ts');
const fixture = path.join(import.meta.dirname, 'reporting-fixture.mjs');
const dir = mkdtempSync(path.join(tmpdir(), '.siso-ephemeral-host-reporting.'));
const hosts = path.join(dir, 'hosts');
mkdirSync(hosts);
const herdr = path.join(dir, 'herdr');
writeFileSync(herdr, '#!/bin/sh\nexit 0\n'); chmodSync(herdr, 0o700);
const env = {
  PATH: process.env.PATH, HOME: dir, TMPDIR: dir,
  HERDR_ENV: '1', HERDR_PANE_ID: 'synthetic-pane', HERDR_BIN_PATH: herdr,
  AB_HOSTS_DIR: hosts, AB_PROMPT_QUEUE_DIR: path.join(dir, 'queues'),
  AB_ACTIVITY_DIR: path.join(dir, 'activity'), AB_HOST_SDK: fixture,
  AB_UPLOADS: path.join(dir, 'uploads'), AB_CHILD_ID: 'fixture-child',
};
const observations = [], frames = [], checks = [];
let child, ws, stderr = '', commandId = 0;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(predicate, label) {
  const end = Date.now() + 10000;
  while (Date.now() < end) {
    if (predicate()) return;
    if (child?.exitCode != null) throw Error(`Host exited ${child.exitCode}: ${stderr}`);
    await sleep(10);
  }
  throw Error(`Timeout: ${label}; ${stderr}`);
}
const reports = () => observations.filter(e => e.kind === 'herdr' && e.args[1] === 'report-agent');
const afterArg = (e, key) => e.args[e.args.indexOf(key) + 1];
// Fake consumer only: production report/adoptSession calls still execute in the real host.
// Deliver session registration before the outstanding state commands, under either possible
// sequence domain. Stale reports succeed at the transport but cannot change consumer truth.
function reorderedConsumer(calls, shared) {
  const watermarks = new Map();
  let state = 'idle', session = 'synthetic-session-a', ignored = 0;
  const ordered = [...calls.filter(e => e.args[1] === 'report-agent-session'), ...calls.filter(e => e.args[1] === 'report-agent')];
  for (const call of ordered) {
    const domain = shared ? 'siso-host' : call.args[1];
    const seq = BigInt(afterArg(call, '--seq'));
    if (seq <= (watermarks.get(domain) ?? 0n)) { ignored++; continue; }
    watermarks.set(domain, seq);
    if (call.args[1] === 'report-agent') state = afterArg(call, '--state');
    if (call.args.includes('--agent-session-id')) session = afterArg(call, '--agent-session-id');
  }
  return { sends: ordered.length, ignored, state, session };
}
const hostFile = path.join(hosts, 'synthetic-pane.json');
const host = () => JSON.parse(readFileSync(hostFile, 'utf8'));
async function command(op, data = {}) {
  const id = `command-${++commandId}`;
  child.send({ op, ...data, id });
  await until(() => observations.some(e => e.kind === 'ack' && e.id === id), op);
  return id;
}
async function settled(fail) {
  await command('settle', { fail });
  await until(() => observations.filter(e => e.kind === 'herdr').every(e => observations.some(s => s.kind === 'herdr-settled' && s.id === e.id)), 'herdr completion');
}
const start = id => ({ type: 'stream_event', event: { type: 'message_start', message: { id } } });
async function events(batch, label) {
  await command('events', { events: [...batch, { type: 'system', subtype: 'informational', level: 'notice', content: label }] });
  await until(() => frames.some(e => e.t === 'note' && e.text === label), label);
}
function check(name, fn) { fn(); checks.push(name); }
const count = () => ({
  herdrSpawns: observations.filter(e => e.kind === 'herdr').length,
  stateReports: reports().length,
  hostWrites: observations.filter(e => e.kind === 'write' && e.target === 'host').length,
  queueWrites: observations.filter(e => e.kind === 'write' && e.target === 'queue').length,
  broadcasts: frames.filter(e => e.t !== 'hello').length,
  stateBroadcasts: frames.filter(e => e.t === 'state').length,
  queueBroadcasts: frames.filter(e => e.t === 'queue.snapshot').length,
  usageReads: observations.filter(e => e.kind === 'usage-read').length,
});
try {
  child = fork(source, ['--name', 'REPORTING-FIXTURE', '--resume', 'synthetic-session-a', '--no-stack'], {
    cwd: dir, env, execArgv: ['--experimental-strip-types', '--no-warnings', '--import', fixture], silent: true,
  });
  child.stdout.resume(); child.stderr.on('data', data => { stderr += data; });
  child.on('message', event => observations.push(event));
  await until(() => { try { return host().rateLimits; } catch { return false; } }, 'host ready');
  ws = new WebSocket(`ws://127.0.0.1:${host().port}/ws?token=${host().token}`);
  ws.on('message', value => frames.push(JSON.parse(value)));
  await until(() => frames.some(e => e.t === 'hello'), 'hello');
  await settled();
  check('initial/resume', () => { assert.equal(host().session, 'synthetic-session-a'); assert.equal(afterArg(reports()[0], '--state'), 'idle'); });
  await command('hold');
  const sequenceStart = observations.filter(e => e.kind === 'herdr').length;
  ws.send(JSON.stringify({ t: 'prompt', text: 'synthetic lifecycle', key: 'first', messageId: 'first', delivery: 'auto', images: [] }));
  await until(() => observations.some(e => e.kind === 'input' && e.id === 'first'), 'SDK prompt');
  await events([{ type: 'system', subtype: 'compact_boundary', session_id: 'synthetic-sequence-b', compact_metadata: {} }, start('after-session-report')], 'reordered session report');
  const sequenceCalls = observations.filter(e => e.kind === 'herdr').slice(sequenceStart);
  const sequenceConsumers = { shared: reorderedConsumer(sequenceCalls, true), separate: reorderedConsumer(sequenceCalls, false) };
  check('reordered shared per-source acceptance', () => assert.deepEqual(sequenceConsumers.shared, { sends: 4, ignored: 2, state: 'working', session: 'synthetic-sequence-b' }));
  check('reordered separate state/session acceptance', () => assert.deepEqual(sequenceConsumers.separate, { sends: 4, ignored: 0, state: 'working', session: 'synthetic-sequence-b' }));
  await settled();

  await command('hold');
  const beforeBurst = count();
  const burst = Array.from({ length: 32 }, (_, i) => [start(`burst-${i}`), { type: 'assistant', message: { id: `burst-${i}`, content: [{ type: 'text', text: `Synthetic message ${i}` }] } }]).flat();
  await events(burst, 'burst completed');
  const afterBurst = count();
  const burstCosts = Object.fromEntries(Object.keys(afterBurst).map(key => [key, afterBurst[key] - beforeBurst[key]]));
  check('equal in-flight repeats', () => assert.equal(burstCosts.stateReports, baseline ? 32 : 1));
  check('messages and broadcast parity', () => {
    assert.equal(frames.filter(e => e.t === 'text' && e.text.startsWith('Synthetic message ')).length, 32);
    assert.equal(burstCosts.stateBroadcasts, 32); assert.equal(burstCosts.queueBroadcasts, 32);
  });
  await settled();
  const heartbeatBefore = reports().length;
  await events([start('heartbeat')], 'heartbeat completed');
  await settled();
  check('heartbeat after completion has no time gate', () => assert.equal(reports().length, heartbeatBefore + 1));

  await command('hold');
  const failureBefore = reports().length;
  await events([start('failure-1'), start('failure-2')], 'failure burst completed');
  const failedId = reports()[failureBefore].id;
  await settled(failedId);
  check('failed shared report retries once', () => {
    assert.equal(reports().length, failureBefore + 2);
    assert.equal(observations.filter(e => e.kind === 'herdr-settled' && e.failed).length, 1);
  });

  await command('hold');
  const beforeAdoptionBurst = reports().length;
  await events([start('before-adopt'), start('before-adopt-repeat')], 'pre-adoption report');
  const adoptionBefore = reports().length;
  await events([{ type: 'system', subtype: 'compact_boundary', session_id: 'synthetic-session-b', compact_metadata: {} }], 'session adopted');
  check('session adoption while same state', () => {
    assert.equal(reports().length, adoptionBefore + 1);
    assert.equal(afterArg(reports().at(-1), '--agent-session-id'), 'synthetic-session-b');
    assert.equal(host().session, 'synthetic-session-b');
  });
  const beforeSupersededFailure = reports().length;
  await settled(reports()[beforeAdoptionBurst].id);
  check('superseded failure cannot retry the old session', () => assert.equal(reports().length, beforeSupersededFailure));

  const revision = frames.filter(e => e.t === 'queue.snapshot').at(-1).snapshot.revision;
  ws.send(JSON.stringify({ t: 'prompt', text: 'synthetic queued', key: 'queued', messageId: 'queued', delivery: 'next', images: [] }));
  await until(() => frames.some(e => e.t === 'queue.snapshot' && e.snapshot.revision > revision && e.snapshot.entries.some(x => x.id === 'queued')), 'queue revision');
  check('queue revisions', () => assert.ok(frames.some(e => e.t === 'prompt.receipt' && e.key === 'queued' && e.phase === 'saved')));
  const queued = frames.filter(e => e.t === 'queue.snapshot').at(-1).snapshot;
  ws.send(JSON.stringify({ t: 'queue.remove', key: 'remove', id: 'queued', expectedRevision: queued.revision }));
  await until(() => frames.some(e => e.t === 'prompt.receipt' && e.key === 'remove'), 'queue removal');

  await command('hold');
  const toolOne = await command('tool', { tool: 'Bash', input: { command: 'synthetic one' } });
  await until(() => frames.some(e => e.t === 'approval' && e.summary.includes('synthetic one')), 'first approval');
  const toolTwo = await command('tool', { tool: 'Bash', input: { command: 'synthetic two' } });
  await until(() => frames.filter(e => e.t === 'approval').length === 2, 'second approval');
  check('same-state approval messages remain distinct', () => {
    const blocked = reports().filter(e => afterArg(e, '--state') === 'blocked');
    assert.equal(blocked.length, 2);
    assert.ok(afterArg(blocked[0], '--message').includes('synthetic one'));
    assert.ok(afterArg(blocked[1], '--message').includes('synthetic two'));
  });
  for (const approval of frames.filter(e => e.t === 'approval')) ws.send(JSON.stringify({ t: 'approve', id: approval.id, allow: true }));
  await until(() => [toolOne, toolTwo].every(id => observations.some(e => e.kind === 'tool-result' && e.id === id)), 'approval replies');
  await settled();
  check('approval resolution restores working', () => assert.equal(host().state, 'working'));

  const questionId = await command('tool', { tool: 'AskUserQuestion', input: { questions: [{ question: 'Synthetic direction?', header: 'Fixture', multiSelect: false, options: [{ label: 'Alpha', description: 'First' }, { label: 'Beta', description: 'Second' }] }] } });
  await until(() => frames.some(e => e.t === 'question'), 'question');
  const question = frames.find(e => e.t === 'question').request;
  const replay = [];
  const reconnect = new WebSocket(`ws://127.0.0.1:${host().port}/ws?token=${host().token}`);
  reconnect.on('message', value => replay.push(JSON.parse(value)));
  await until(() => replay.some(e => e.t === 'hello'), 'reconnect');
  check('reconnect retains pending question/session/queue', () => {
    const hello = replay[0];
    assert.equal(hello.session, 'synthetic-session-b'); assert.equal(hello.state, 'blocked');
    assert.equal(hello.pendingQuestions[0].id, question.id); assert.ok(hello.queue.revision > revision);
  });
  reconnect.close();
  ws.send(JSON.stringify({ t: 'answer_question', id: question.id, hostInstance: question.hostInstance, session: question.session, submissionId: 'answer', action: 'answer', answers: { [question.questions[0].id]: ['Beta'] } }));
  await until(() => observations.some(e => e.kind === 'tool-result' && e.id === questionId), 'question reply');
  await settled();
  check('question resolution', () => assert.ok(frames.some(e => e.t === 'question_done' && e.outcome === 'answered')));

  await events([{ type: 'stream_event', event: { type: 'message_delta', usage: { output_tokens: 55 } } }, { type: 'result', subtype: 'success', duration_ms: 25, total_cost_usd: 0 }], 'final completed');
  await until(() => host().ctx?.used === 321 && observations.filter(e => e.kind === 'usage-read').length === 2, 'final usage');
  await settled();
  check('final state and usage', () => {
    assert.equal(host().state, 'idle'); assert.equal(host().rateLimits.five_hour.used_percentage, 7);
    assert.ok(frames.some(e => e.t === 'usage' && e.out === 55)); assert.ok(frames.some(e => e.t === 'result'));
  });
  check('monotonic herdr sequence', () => {
    const seq = observations.filter(e => e.kind === 'herdr' && e.args.includes('--seq')).map(e => BigInt(afterArg(e, '--seq')));
    assert.ok(seq.every((value, i) => !i || value > seq[i - 1]));
  });
  console.log(JSON.stringify({ acceptance: 'HostEventCoalescingParity', mode: baseline ? 'baseline' : 'candidate', sourceSha256: createHash('sha256').update(readFileSync(source)).digest('hex'), cadence: '32 SDK message starts while fake-herdr completion is held; next message after completion sends immediately', sequenceConsumers, burst: burstCosts, lifecycle: count(), checks, exit: 0 }));
} finally {
  ws?.close();
  if (child && child.exitCode == null) { const exited = new Promise(resolve => child.once('exit', resolve)); child.kill('SIGTERM'); await exited; }
  rmSync(dir, { recursive: true, force: true });
}
