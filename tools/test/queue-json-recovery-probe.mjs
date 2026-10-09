// Pinned synthetic evidence for queue.jsonl malformed-JSON policy. No git, deploy, notifier, or real queue state.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const queue = path.resolve(import.meta.dirname, '../ab-queue');
const at = new Date().toISOString();
const cli = (dir) => spawnSync(queue, ['status', '--json'], {
  env: { ...process.env, HOME: dir, AB_QUEUE_STATE: dir }, encoding: 'utf8', timeout: 5000,
});
const row = JSON.stringify({ id: 'fixture', state: 'queued', at });

for (const [label, contents] of [
  ['malformed non-final line is rejected', `${row}\nnot-json\n${JSON.stringify({ id: 'fixture', state: 'live', at })}\n`],
  ['malformed newline-terminated final line is rejected', `${row}\nnot-json\n`],
]) {
  test(label, () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'ab-queue-json-recovery-'));
    try {
      writeFileSync(path.join(dir, 'queue.jsonl'), contents);
      const result = cli(dir);
      assert.equal(result.status, 2, result.stdout + result.stderr);
      assert.match(result.stderr, /invalid JSON/);
      assert.equal(result.stdout, '');
      console.log(JSON.stringify({ check: label, status: result.status, stderr: result.stderr.trim() }));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
}

test('unterminated malformed final tail remains tolerated', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'ab-queue-json-recovery-tail-'));
  try {
    writeFileSync(path.join(dir, 'queue.jsonl'), `${row}\n{"id":"tail"`);
    const result = cli(dir);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /fixture/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('blank separator lines remain tolerated', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'ab-queue-json-recovery-blank-'));
  try {
    writeFileSync(path.join(dir, 'queue.jsonl'), `${row}\n\n${JSON.stringify({ id: 'fixture', state: 'live', at })}\n`);
    const result = cli(dir);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /live/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('pinned pre-fix CLI skipped a complete malformed line', () => {
  const baselineCommit = '1fe23d2';
  const snapshot = spawnSync('git', ['show', `${baselineCommit}:tools/ab-queue`], { encoding: 'utf8' });
  assert.equal(snapshot.status, 0, `${baselineCommit} missing tools/ab-queue: ${snapshot.stderr}`);
  const dir = mkdtempSync(path.join(tmpdir(), 'ab-queue-json-recovery-baseline-'));
  try {
    const script = path.join(dir, 'ab-queue-baseline');
    writeFileSync(script, snapshot.stdout);
    writeFileSync(path.join(dir, 'queue.jsonl'), `${row}\nnot-json\n`);
    const result = spawnSync('python3', [script, 'status', '--json'], { env: { ...process.env, HOME: dir, AB_QUEUE_STATE: dir }, encoding: 'utf8', timeout: 5000 });
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /fixture/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('parseable non-object remains fail-closed and distinct from malformed JSON tolerance', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'ab-queue-json-recovery-schema-'));
  try {
    writeFileSync(path.join(dir, 'queue.jsonl'), `${row}\n[]\n`);
    const result = cli(dir);
    assert.equal(result.status, 2);
    assert.match(result.stderr, /expected an object/);
    assert.equal(result.stdout, '');
    console.log(JSON.stringify({ check: 'parseable non-object fail-closed', status: result.status }));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('append refuses to concatenate onto an unterminated tail', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'ab-queue-json-recovery-append-'));
  try {
    const original = `${row}\n{"id":"tail"`;
    writeFileSync(path.join(dir, 'queue.jsonl'), original);
    const result = spawnSync(queue, ['drop', 'fixture'], { env: { ...process.env, HOME: dir, AB_QUEUE_STATE: dir }, encoding: 'utf8', timeout: 5000 });
    assert.equal(result.status, 2, result.stdout + result.stderr);
    assert.match(result.stderr, /unterminated tail; refusing append/);
    assert.equal(readFileSync(path.join(dir, 'queue.jsonl'), 'utf8'), original);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('append also refuses a valid final record without a newline', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'ab-queue-json-recovery-valid-tail-'));
  try {
    const original = row;
    writeFileSync(path.join(dir, 'queue.jsonl'), original);
    const result = spawnSync(queue, ['drop', 'fixture'], { env: { ...process.env, HOME: dir, AB_QUEUE_STATE: dir }, encoding: 'utf8', timeout: 5000 });
    assert.equal(result.status, 2, result.stdout + result.stderr);
    assert.match(result.stderr, /unterminated tail; refusing append/);
    assert.equal(readFileSync(path.join(dir, 'queue.jsonl'), 'utf8'), original);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
