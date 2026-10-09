import assert from 'node:assert/strict';
import fs from 'node:fs';
import { mkdtemp, mkdir, writeFile, readFile, chmod, rm, realpath } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { syncBuiltinESMExports } from 'node:module';
import { readWriterMeasurementReceipt, createWriterMeasurementObserver } from '../src/writer-measurement-observer.ts';
import { createWriterMeasurementOwner } from '../../node/src/writer-measurements.ts';

// fs.watch does not promise one callback per write. The contract cases control only
// callback delivery; real Git, private receipts, file bytes, hashing and storage stay real.
function controlledWatch(expectedDirectory) {
  const original = fs.watch, callbacks = new Map();
  fs.watch = (dir, options, callback) => {
    assert.equal(dir, expectedDirectory);
    assert.deepEqual(options, { persistent: false });
    const watcher = new EventEmitter();
    callbacks.set(dir, callback);
    watcher.close = () => callbacks.delete(dir);
    return watcher;
  };
  syncBuiltinESMExports();
  return {
    changed(file) {
      const callback = callbacks.get(path.dirname(file));
      assert.ok(callback, 'The observer must have armed the actual inventory directory');
      callback('change', path.basename(file));
    },
    restore() { fs.watch = original; syncBuiltinESMExports(); },
  };
}

const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'writer-observer-')));
let observer, watcherFixture;
try {
  const repo = path.join(root, 'repo'), store = path.join(root, 'store'), receipts = path.join(root, 'receipts');
  await mkdir(path.join(repo, 'ui-hub', 'dashboard'), { recursive: true });
  for (const dir of [store, receipts]) { await mkdir(dir, { mode: 0o700 }); await chmod(dir, 0o700); }
  execFileSync('git', ['init', '-q', repo]);
  const owned = path.join(repo, 'ui-hub', 'dashboard', 'FILES.md');
  await writeFile(owned, 'Dashboard source inventory details for the trusted measurement observer test.\n');
  execFileSync('git', ['-C', repo, 'add', '.']);
  execFileSync('git', ['-C', repo, '-c', 'user.name=fixture', '-c', 'user.email=fixture@example.test', 'commit', '-qm', 'baseline']);
  const revision = execFileSync('git', ['-C', repo, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  const source = await readFile(owned), fileHash = createHash('sha256').update(source).digest('hex'), repoReal = await realpath(repo);
  const workspace = { version: 1, workspaceId: 'ws-test', name: 'DASH', worktreePath: repoReal, baseSha: revision, input: { taskId: 't-dashboard', workspace: { type: 'isolated' }, writer: { sourceRevision: revision, dossierDigest: 'd'.repeat(64) } } };
  const receipt = { version: 1, issuer: 'agent-base-node', runId: 'saved-test', mode: 'saved', taskId: 't-dashboard', jobDigest: 'a'.repeat(64), baseRevision: revision, dossierDigest: 'd'.repeat(64), sourceRevision: revision, sourcePath: repoReal, workspaceId: 'ws-test', hostName: 'DASH', expectedResumeSession: 'session-dash', files: [{ path: 'ui-hub/dashboard/FILES.md', sha256: fileHash }] };
  const receiptPath = path.join(await realpath(receipts), 'job.json');
  await writeFile(receiptPath, JSON.stringify(receipt), { mode: 0o600 });
  await chmod(receiptPath, 0o600);
  const loaded = await readWriterMeasurementReceipt(receiptPath, workspace, repo);
  const storeReal = await realpath(store), owner = createWriterMeasurementOwner(storeReal), arm = createWriterMeasurementObserver(owner);
  const record = async id => JSON.parse(await readFile(path.join(storeReal, id + '.json'), 'utf8'));
  const edit = 'Dashboard source inventory changed by an observed real fixture edit.\n';
  const command = { type: 'commandExecution', id: 'cmd-1', command: 'cat ui-hub/dashboard/FILES.md' };
  const start = async id => {
    await writeFile(owned, source);
    observer = await arm({ ...loaded, runId: id }, 'session-dash', 'session-dash');
    observer.observe('item/started', command);
    await observer.flush();
    observer.observe('item/completed', { ...command, exitCode: 0 });
  };
  const close = async () => { await observer.close(); observer = null; };
  await assert.rejects(() => arm(loaded, 'other-session', 'session-dash'), /session or resume/);

  watcherFixture = controlledWatch(path.dirname(owned));
  await start('saved-test');
  await writeFile(owned, edit);
  watcherFixture.changed(owned);
  await observer.flush();
  assert.equal(observer.invalidReason, null);
  const run = await record('saved-test');
  assert.deepEqual(run.events.map(e => e.kind), ['command', 'edit']);
  assert.equal(run.events[0].command, command.command);
  observer.observe('item/completed', { type: 'commandExecution', id: 'missing-start', command: 'echo unpaired' });
  assert.match(observer.invalidReason, /missing, duplicate or out of order/);
  await close();
  assert.match((await record('saved-test')).invalidReason, /missing, duplicate or out of order/);
  const receipt2 = { ...receipt, runId: 'fresh-test', mode: 'fresh', expectedResumeSession: null };
  const receiptPath2 = path.join(await realpath(receipts), 'fresh.json');
  await writeFile(receiptPath2, JSON.stringify(receipt2), { mode: 0o600 });
  const fresh = await readWriterMeasurementReceipt(receiptPath2, workspace, repo).catch(e => e);
  assert.ok(fresh instanceof Error, 'changed source inventory must stale the owner receipt');

  // Deliver both callbacks before the first asynchronous hash/storage operation finishes.
  await start('duplicate-test');
  await writeFile(owned, edit);
  watcherFixture.changed(owned);
  watcherFixture.changed(owned);
  await observer.flush();
  assert.match(observer.invalidReason, /Repeated dossier file event/);
  await close();
  const duplicate = await record('duplicate-test');
  assert.deepEqual(duplicate.events.map(e => e.kind), ['command', 'edit']);
  assert.match(duplicate.invalidReason, /Repeated dossier file event/);

  await start('repeated-write-test');
  await writeFile(owned, edit);
  watcherFixture.changed(owned);
  await observer.flush();
  await writeFile(owned, edit + 'second write\n');
  watcherFixture.changed(owned);
  await observer.flush();
  assert.match(observer.invalidReason, /Repeated dossier file event/);
  await close();
  assert.match((await record('repeated-write-test')).invalidReason, /Repeated dossier file event/);

  await start('unchanged-test');
  watcherFixture.changed(owned);
  await observer.flush();
  assert.match(observer.invalidReason, /Ambiguous duplicate filesystem event/);
  await close();
  const unchanged = await record('unchanged-test');
  assert.deepEqual(unchanged.events.map(e => e.kind), ['command']);
  assert.match(unchanged.invalidReason, /Ambiguous duplicate filesystem event/);
  watcherFixture.restore();
  watcherFixture = null;

  // Separately exercise the real native watcher without assuming callback cardinality.
  // Every callback is forwarded unchanged. Duplicate delivery must fail closed.
  const nativeWatch = fs.watch;
  let nativeEvents = 0;
  fs.watch = (dir, options, callback) => nativeWatch(dir, options, (kind, filename) => {
    if (String(filename) === path.basename(owned)) nativeEvents++;
    callback(kind, filename);
  });
  syncBuiltinESMExports();
  watcherFixture = { restore() { fs.watch = nativeWatch; syncBuiltinESMExports(); } };
  await start('native-test');
  await writeFile(owned, edit);
  const deadline = Date.now() + 2000;
  while (!nativeEvents && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 10));
  assert.ok(nativeEvents > 0, 'Native watcher must observe the real inventory write');
  await new Promise(resolve => setTimeout(resolve, 50));
  await observer.flush();
  await close();
  const native = await record('native-test');
  assert.deepEqual(native.events.map(e => e.kind), ['command', 'edit']);
  if (nativeEvents === 1) assert.equal(native.invalidReason, null);
  else assert.match(native.invalidReason, /Repeated dossier file event/);
  console.log(JSON.stringify({ checks: 5, passed: ['single delivered edit and exact session/command binding', 'duplicate callbacks fail closed', 'repeated writes fail closed', 'unchanged-hash event fails closed', 'native callbacks preserve the same strict policy'], nativeEvents, nativeMeasurementValid: native.invalidReason === null, providerCalls: 0 }));
} finally {
  try { await observer?.close(); }
  finally { watcherFixture?.restore(); await rm(root, { recursive: true, force: true }); }
}
