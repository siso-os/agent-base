import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, mkdirSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { WebSocket } from 'ws';

const root = path.resolve(import.meta.dirname, '../../..');
const dir = mkdtempSync(path.join(tmpdir(), '.siso-task-attribution-'));
const hosts = path.join(dir, 'hosts');
const resumed = process.env.AB_ATTRIBUTION_RESUME === '1';
const untagged = process.env.FAKE_TASK_UNTAGGED_ONLY === '1';
const legacy = process.env.AB_ATTRIBUTION_LEGACY === '1';
const env = { ...process.env, HERDR_ENV: '0', AB_HOSTS_DIR: hosts, AB_PROMPT_QUEUE_DIR: path.join(dir, 'queues'), AB_ACTIVITY_DIR: path.join(dir, 'activity'), AB_CODEX_BIN: path.join(root, 'services/host/test/fake-task-codex.mjs'), AB_TASK_ID: 't-fixture' };
if (legacy) delete env.AB_TASK_ID;
const hostFile = path.join(hosts, 'name-TASK-FIXTURE.json');
const wait = ms => new Promise(r => setTimeout(r, ms));
async function until(fn, ms = 8000) { const end = Date.now() + ms; while (Date.now() < end) { if (await fn()) return; await wait(25); } throw Error('fixture timeout'); }
let child, ws;
try {
  child = spawn(process.execPath, ['--experimental-strip-types', '--no-warnings', path.join(root, 'services/host/src/codex-host.ts'), '--name', 'TASK-FIXTURE', '--model', 'fixture', '--sandbox', 'read-only', '--approval', 'never', ...(resumed ? ['--resume','12345678-1234-1234-1234-123456789abc'] : [])], { cwd: dir, env, stdio: 'ignore' });
  await until(() => { try { return JSON.parse(readFileSync(hostFile)).port > 0; } catch { return false; } });
  const host = JSON.parse(readFileSync(hostFile)), frames = [];
  ws = new WebSocket(`ws://127.0.0.1:${host.port}/ws?token=${host.token}`); ws.on('message', raw => frames.push(JSON.parse(String(raw))));
  await until(() => frames.some(e => e.t === 'hello'));
  for (let n = 1; n <= 3; n++) {
    const key = randomUUID(); ws.send(JSON.stringify({ t: 'prompt', key, messageId: key, text: `fixture-${n}`, images: [], delivery: 'auto' }));
    await until(() => frames.filter(e => e.t === 'result').length >= n);
  }
  const h = JSON.parse(readFileSync(hostFile));
  assert.equal(h.taskId, legacy ? undefined : 't-fixture'); assert.deepEqual([h.tokensIn, h.tokensOut], untagged ? [8888,8888] : [190, 25]);
  const journal = readFileSync(h.activityJournal, 'utf8').trim().split('\n').map(JSON.parse);
  const starts = journal.filter(e => e.kind === 'run.started'), terminals = journal.filter(e => ['run.completed','run.failed','run.cancelled'].includes(e.kind));
  assert.equal(starts.length, 3); assert.equal(terminals.length, 3);
  assert.deepEqual(starts.map(e=>[e.usage?.inputTokens,e.usage?.outputTokens]),[resumed ? [undefined,undefined] : [0,0],untagged ? [undefined,undefined] : [100,10],untagged ? [undefined,undefined] : [160,20]]);
  assert.ok(starts.every(e => e.ref.taskId === (legacy ? undefined : 't-fixture'))); assert.ok(terminals.every(e => e.ref.taskId === (legacy ? undefined : 't-fixture')));
  assert.deepEqual(terminals.map(e => [e.usage?.inputTokens, e.usage?.outputTokens]), untagged ? [[undefined,undefined],[undefined,undefined],[undefined,undefined]] : [[100,10],[160,20],[190,25]]);
  assert.deepEqual(terminals.map(e => e.kind), ['run.completed','run.failed','run.cancelled']);
  const proof = process.env.AB_ATTRIBUTION_PROOF_DIR;
  if (proof) { mkdirSync(proof, { recursive: true }); copyFileSync(h.activityJournal, path.join(proof, 'task-attribution.fixture.jsonl')); }
  console.log('PASS task identity, cumulative usage, stale/untagged rejection, failed/cancelled durable terminals');
} finally {
  ws?.close(); if (child && child.exitCode === null && child.signalCode === null) { const exited = new Promise(resolve => child.once('exit', resolve)); child.kill('SIGTERM'); await Promise.race([exited, wait(2000)]); if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); }
}

