// Synthetic queue journals only. No git, deploy, notifier, or real queue state.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const queue = path.resolve(import.meta.dirname, '../ab-queue');
const cli = (dir, ...args) => spawnSync(queue, args, { env: { ...process.env, HOME: dir, AB_QUEUE_STATE: dir }, encoding: 'utf8', timeout: 5000 });
const at = new Date().toISOString();

for (const [label, row, message] of [
  ['valid JSON array', [], 'expected an object'],
  ['missing id', { state: 'queued', at }, 'missing id'],
  ['missing state', { id: 'fixture', at }, 'invalid or missing state'],
  ['invalid state', { id: 'fixture', state: 'alarm', at }, 'invalid or missing state'],
  ['non-string state', { id: 'fixture', state: [], at }, 'invalid or missing state'],
  ['invalid timestamp', { id: 'fixture', state: 'queued', at: 'tomorrow' }, 'invalid timestamp'],
]) {
  test(`rejects ${label} without resurrecting a prior row`, () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'ab-queue-malformed-'));
    try {
      writeFileSync(path.join(dir, 'queue.jsonl'), `${JSON.stringify({ id: 'old', state: 'queued', at })}\n${JSON.stringify(row)}\n`);
      const result = cli(dir, 'status', '--json');
      assert.equal(result.status, 2, result.stdout + result.stderr);
      assert.match(result.stderr, new RegExp(message));
      assert.equal(result.stdout, '');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
}

test('keeps deliberate truncated JSON tail tolerance', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'ab-queue-truncated-'));
  try {
    writeFileSync(path.join(dir, 'queue.jsonl'), `${JSON.stringify({ id: 'old', state: 'dropped', at })}\n{"id":"tail"`);
    const result = cli(dir, 'status', '--json');
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /old/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

for (const [label, builtAt] of [
  ['invalid built_at string', 'not-a-date'],
  ['non-string built_at', 42],
  ['naive built_at', '2026-10-03T00:00:00'],
]) {
  test(`rejects ${label} without a traceback`, () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'ab-queue-age-'));
    try {
      writeFileSync(path.join(dir, 'queue.jsonl'), `${JSON.stringify({ id: 'fixture', state: 'queued', at, built_at: builtAt })}\n`);
      for (const args of [['status'], ['status', '--alarm', '0']]) {
        const result = cli(dir, ...args);
        assert.equal(result.status, 2, result.stdout + result.stderr);
        assert.match(result.stderr, /invalid built_at timestamp/);
        assert.doesNotMatch(result.stderr, /Traceback/);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
}
