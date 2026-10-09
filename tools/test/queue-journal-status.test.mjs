// Actual CLI against a synthetic journal; no git, deploy, notifier or live queue access.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
const queue = path.resolve(import.meta.dirname, '../ab-queue');
const cli = (dir, ...args) => spawnSync(queue, args, { env: { ...process.env, HOME: dir, AB_QUEUE_STATE: dir }, encoding: 'utf8', timeout: 5000 });
test('dropping an unknown ID cannot create an orphan journal event', () => {
 const dir = mkdtempSync(path.join(tmpdir(), 'ab-journal-drop-'));
 try {
  const r = cli(dir, 'drop', 'unknown-fixture');
  assert.equal(r.status, 2, r.stdout+r.stderr);
  assert.match(r.stderr, /unknown queue item/);
  assert.equal(existsSync(path.join(dir,'queue.jsonl')), false);
 } finally { rmSync(dir, { recursive:true, force:true }); }
});
test('legacy standalone dropped row remains readable in human and alarm status', () => {
 const dir = mkdtempSync(path.join(tmpdir(), 'ab-journal-legacy-'));
 try {
  const file = path.join(dir,'queue.jsonl');
  writeFileSync(file, JSON.stringify({id:'legacy-fixture',state:'dropped',at:new Date().toISOString()})+'\n');
  const before = readFileSync(file,'utf8');
  for (const args of [['status'],['status','--alarm','0']]) {
   const r = cli(dir,...args); assert.equal(r.status,0,r.stdout+r.stderr); assert.match(r.stdout,/legacy-fixture/);
  }
  assert.equal(readFileSync(file,'utf8'), before, 'status must not rewrite journal history');
 } finally { rmSync(dir, { recursive:true, force:true }); }
});
