import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { syncBuiltinESMExports } from 'node:module';

const originalRead = fs.readFileSync;
let reads = [];
fs.readFileSync = function (file, ...args) {
  const value = originalRead.call(this, file, ...args);
  if (String(file).endsWith('.jsonl')) reads.push(String(file));
  return value;
};
syncBuiltinESMExports();
const { readCodexRuns } = await import('../src/codex-runs.ts');
const { listSubagents } = await import('../src/subagents.ts');
const event = text => JSON.stringify({ type: 'item.completed', item: { id: 'answer', type: 'agent_message', text } }) + '\n';

test('summary hits recalculate CLI rates through output, reconciliation, expiry, reset and history', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), '.siso-ephemeral-rate-cache.'));
  const now = Date.UTC(2026, 9, 6), parent = { session: 'rate-cache-parent' };
  try {
    for (let i = 0; i < 33; i++) {
      const prefix = path.join(root, `run-${String(i).padStart(3, '0')}`);
      fs.writeFileSync(prefix + '.meta.json', JSON.stringify({ started: now, parent_session: parent.session, pid: process.pid }));
      fs.writeFileSync(prefix + '.jsonl', '');
    }
    const first = path.join(root, 'run-000');
    const observe = (offset, expectedReads) => {
      reads = [];
      const rows = readCodexRuns(now + offset, root, parent, { includeItems: false });
      assert.equal(rows.length, 33);
      assert.ok(rows.every(row => row.items.length === 0));
      assert.equal(reads.length, expectedReads);
      return rows.find(row => row.id === 'run-000');
    };
    let row = observe(0, 33);
    assert.equal(row.rateMeasured, false);
    row = observe(1000, 0);
    assert.equal(row.rateMeasured, true); assert.equal(row.rate, 0);
    fs.appendFileSync(first + '.jsonl', event('x'.repeat(200)));
    row = observe(2000, 1); assert.equal(row.rate, 25);
    fs.appendFileSync(first + '.jsonl', JSON.stringify({ type: 'turn.completed', usage: { input_tokens: 900000000, output_tokens: 150 } }) + '\n');
    row = observe(3000, 1);
    assert.equal(row.tokens, 150); assert.equal(row.estimated, false);
    assert.equal(row.rateEstimated, true); assert.equal(row.rate, 50 / 3);
    row = observe(4500, 0); assert.equal(row.rate, 50 / 4.5);
    row = observe(9000, 0); assert.equal(row.rate, 0); assert.equal(row.rateMeasured, true);
    row = observe(30000, 0); assert.equal(row.rateMeasured, false);
    fs.writeFileSync(first + '.jsonl', event('y'.repeat(400)));
    row = observe(31000, 1); assert.equal(row.rate, 50);
    fs.writeFileSync(first + '.jsonl', event('z'));
    row = observe(32000, 1); assert.equal(row.rateMeasured, false);
    fs.renameSync(first + '.jsonl', first + '.old');
    fs.writeFileSync(first + '.jsonl', event('q'.repeat(81)));
    row = observe(33000, 1); assert.equal(row.rate, 20);
    fs.writeFileSync(first + '.last.md', 'STATUS: done\n');
    fs.utimesSync(first + '.last.md', new Date(now - 86400000), new Date(now - 86400000));
    row = observe(34000, 0); assert.equal(row.running, false); assert.equal(row.rate, 0);
    const detail = readCodexRuns(now + 34000, root, parent).find(item => item.id === row.id);
    assert.deepEqual({ ...detail, items: [] }, row);
    assert.equal(detail.items[0].text, 'q'.repeat(81));
    fs.unlinkSync(first + '.last.md');
    row = observe(35000, 0); assert.equal(row.running, true);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('hosted child counter-cache hits age rates and ignore legacy lifetime averages', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), '.siso-ephemeral-child-rate.'));
  const keys = ['AB_CLAUDE_DIRS', 'AB_CODEX_DIRS', 'AB_HOSTS_DIR', 'AB_FLEET_RUNS', 'AB_CODEX_RUNS'];
  const saved = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  const originalNow = Date.now, now = Date.now();
  Date.now = () => now;
  const parent = { id: 'parent', name: 'RATE-PARENT', session: 'hosted-rate-parent', cwd: root, tool: 'codex' };
  try {
    for (const key of keys) {
      process.env[key] = path.join(root, key);
      fs.mkdirSync(process.env[key], { recursive: true });
    }
    const children = [0, 1].map(index => {
      const id = `child-00000000-0000-0000-0000-00000000000${index}`, name = `RATE-CHILD-${index}`;
      return { id, name, hostName: `${name}-${id.slice(-8)}`, model: 'synthetic-model', effort: 'medium', cwd: root,
        parentSession: parent.session, session: `hosted-rate-session-${index}`, status: 'running', startedAt: now - 20000,
        endedAt: null, tokens: 945600000, tools: 0, rate: 9000000, last: 'Fixture only', summary: null };
    });
    const ledger = path.join(process.env.AB_HOSTS_DIR, '.children');
    fs.mkdirSync(ledger);
    fs.writeFileSync(path.join(ledger, createHash('sha256').update(parent.session).digest('hex') + '.json'), JSON.stringify({ version: 1, parentSession: parent.session, children }));
    const sessions = path.join(process.env.AB_CODEX_DIRS, 'sessions');
    fs.mkdirSync(sessions);
    const file = path.join(sessions, children[0].session + '.jsonl');
    const usage = (at, output, total) => JSON.stringify({ type: 'event_msg', timestamp: new Date(at).toISOString(), payload: { type: 'token_count', info: { total_token_usage: { total_tokens: total, output_tokens: output } } } }) + '\n';
    fs.writeFileSync(file, JSON.stringify({ type: 'session_meta', timestamp: new Date(now - 20000).toISOString(), payload: { cwd: root } }) + '\n' + usage(now - 10000, 1000, 945000000) + usage(now, 1500, 945600000));
    const observe = () => {
      const rows = listSubagents(parent, []).rows;
      assert.equal(rows.length, 2); assert.ok(rows.every(row => !('outputSamples' in row)));
      assert.equal(rows.find(row => row.id === children[1].id).rate, undefined);
      return rows.find(row => row.id === children[0].id);
    };
    let row = observe(); assert.equal(row.rate, 50); assert.equal(row.tokens, 945600000);
    Date.now = () => now + 5000; reads = [];
    row = observe(); assert.equal(row.rate, 500 / 15); assert.equal(row.rateAt, now + 5000);
    assert.equal(row.rateWindowMs, 30000); assert.equal(reads.filter(name => name === file).length, 0);
    Date.now = () => now + 31000; reads = [];
    row = observe(); assert.equal(row.rate, undefined); assert.equal(row.rateAt, now + 31000);
    assert.equal(reads.filter(name => name === file).length, 0);
  } finally {
    Date.now = originalNow;
    for (const key of keys) if (saved[key] === undefined) delete process.env[key]; else process.env[key] = saved[key];
    fs.rmSync(root, { recursive: true, force: true });
  }
});
