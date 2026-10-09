import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, appendFileSync, utimesSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { readCodexRuns, visibleRuns, belongs, codexWorkerRows, groupCodexRuns } from '../src/codex-runs.ts';

test('fixture runs: parent, streaming rate, standing worker, RETURN retention', () => {
  const root = mkdtempSync(path.join(tmpdir(), '.siso-ephemeral-codex-runs.'));
  const now = Date.now();
  process.env.AB_CODEX_RUNS = root;
  try {
    writeFileSync(path.join(root, 'one.meta.json'), JSON.stringify({ name: 'Implement', worker: 'Builder', parent_session: 'fixture-session', parent_pane: 'w1:p1', model: 'gpt-6.1-sol', pid: process.pid, started: Math.floor(now / 1000) }));
    const stream = path.join(root, 'one.jsonl');
    writeFileSync(stream, JSON.stringify({ type: 'thread.started', thread_id: 'thread' }) + '\n');
    let [r] = readCodexRuns(now);
    assert.equal(r.running, true); assert.equal(belongs(r, { session: 'fixture-session' }), true); assert.equal(belongs(r, { session: 'other' }), false);
    assert.equal(belongs(r, { session: null, pane: 'w1:p1' }), false);
    assert.equal(belongs({ ...r, parent_session: null }, { session: null, pane: 'w1:p1' }), true);
    appendFileSync(stream, JSON.stringify({ type: 'item.started', item: { id: 'a', type: 'agent_message', text: 'x'.repeat(200) } }) + '\n' + '{"type":');
    [r] = readCodexRuns(now + 1000); assert.equal(r.rate, 50); assert.equal(r.estimated, true); assert.equal(r.items.length, 1);
    appendFileSync(stream, '"turn.completed","usage":{"output_tokens":150}}\n');
    [r] = readCodexRuns(now + 2000); assert.equal(r.tokens, 150); assert.equal(r.estimated, false); assert.equal(r.rateEstimated, true); assert.equal(r.rate, 25, "usage reconciliation does not create an output burst");
    assert.equal(readCodexRuns(now + 8000)[0].rate, 0);
    const rows = codexWorkerRows([r, { ...r, id: 'two' }], {}); assert.equal(rows.length, 1); assert.equal(rows[0].status, 'working');
    writeFileSync(path.join(root, 'one.last.md'), 'RETURN\nSTATUS: blocked — needs input\n'); utimesSync(path.join(root, 'one.last.md'), now / 1000, now / 1000);
    [r] = readCodexRuns(now + 9000); assert.equal(r.running, false); assert.equal(r.status, 'blocked');
    assert.equal(visibleRuns([r], now + 599999).length, 1); assert.equal(visibleRuns([r], now + 600000).length, 0);
    assert.equal(codexWorkerRows([r], {})[0].status, 'idle');
    writeFileSync(path.join(root, 'broken.meta.json'), '{'); assert.equal(readCodexRuns(now).length, 1);
    writeFileSync(path.join(root, 'one.last.md'), 'RETURN\nSTATUS: done\n'); assert.equal(readCodexRuns(now)[0].status, 'done');
    writeFileSync(path.join(root, 'one.last.md'), 'RETURN\nSTATUS: failed\n'); assert.equal(readCodexRuns(now)[0].status, 'failed');
  } finally { delete process.env.AB_CODEX_RUNS; rmSync(root, { recursive: true }); }
});

test('batches stay within one parent and a sixty-second launch window', () => {
 const base = { id: "a", started: 0, parent_session: "p" };
 assert.deepEqual(groupCodexRuns([base, {...base,id:"b",started:60000}, {...base,id:"c",started:60001}, {...base,id:"d",parent_session:"other"}]).map(g=>g.runs.length), [2,1,1]);
 assert.equal(groupCodexRuns([{...base,batch:"named"},{...base,id:"b",batch:"named",started:90000}]).length,1);
});
