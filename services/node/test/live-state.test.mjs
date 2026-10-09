// t-0569 (Shaan, 9 Oct 01:44: "the research agent stopped, but it still shows ... the operator UI is working, but it doesn't
// show"). One resolver for live state: a real host process answers /health; its dot follows its own state, a killed host goes
// idle within seconds, and a dead record that shares a live one's name and session is ignored. Fixture hosts dir only.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test, { after } from 'node:test';
import { bindServiceRows, readServiceHosts, resolveLive } from '../src/service-hosts.ts';

const dir = mkdtempSync(path.join(tmpdir(), '.siso-ephemeral-live-state-'));
const children = [];
after(() => { for (const c of children) c.kill('SIGKILL'); rmSync(dir, { recursive: true, force: true }); });

/** A stand-in host: a process whose /health answers its own pid, as siso-host's does. */
async function host() {
  const child = spawn(process.execPath, ['-e', "const s=require('http').createServer((q,r)=>r.end(JSON.stringify({pid:process.pid})));s.listen(0,'127.0.0.1',()=>console.log(s.address().port))"], { stdio: ['ignore', 'pipe', 'inherit'] });
  children.push(child);
  const port = await new Promise(done => child.stdout.once('data', d => done(Number(String(d).trim()))));
  return { child, pid: child.pid, port };
}
const write = (file, h) => writeFileSync(path.join(dir, file), JSON.stringify({ token: 'fixture-token', model: 'claude-opus', ...h }));
const read = () => readServiceHosts({ dir, launchdLoaded: () => false, maxStartingAgeMs: 0 });
const rows = async (list = []) => bindServiceRows(list, (await read()).hosts, { machine: 'MB' });

test('a pane-less live host shows its own state: idle is idle, not working', async () => {
  const h = await host();
  write('remote-mini-1.json', { name: 'RESEARCH', pid: h.pid, port: h.port, state: 'idle', session: 's-research' });
  let row = (await rows()).find(r => r.name === 'RESEARCH');
  assert.equal(row.status, 'idle', 'stopped research reads idle');
  write('remote-mini-1.json', { name: 'RESEARCH', pid: h.pid, port: h.port, state: 'working', session: 's-research' });
  row = (await rows()).find(r => r.name === 'RESEARCH');
  assert.equal(row.status, 'working');
  // Killed: idle within seconds (the port check is cached for at most 3 s).
  h.child.kill('SIGKILL');
  await new Promise(done => h.child.once('exit', done));
  const t0 = Date.now();
  for (;;) {
    row = (await rows()).find(r => r.name === 'RESEARCH');
    if (row.status === 'idle') break;
    assert.ok(Date.now() - t0 < 5000, 'a killed host goes idle within 5 s');
    await new Promise(r => setTimeout(r, 250));
  }
  assert.equal(row.host.state, 'down');
  rmSync(path.join(dir, 'remote-mini-1.json'));
});

test('a dead record sharing a live chat\'s name and session is ignored: the live one binds', async () => {
  const h = await host();
  write('w7_p49.json', { name: 'OPERATOR-UI', pid: 999999, port: 1, state: 'idle', session: 's-op', pane: 'w7:p49' });
  write('w7_p52.json', { name: 'OPERATOR-UI', pid: h.pid, port: h.port, state: 'working', session: 's-op', pane: 'w7:p52' });
  const hosts = (await read()).hosts.filter(x => x.name === 'OPERATOR-UI');
  assert.deepEqual(hosts.map(x => x.pane), ['w7:p52'], 'one OPERATOR-UI, the live one');
  const [row] = await rows([{ id: 'term_x', name: 'OPERATOR-UI', cwd: '/x', pane: 'w7:p52', session: 's-op', status: 'idle' }]);
  assert.deepEqual([row.status, row.host.state], ['working', 'live']);
});

test('dead records alone: the newest stays, and reads down', () => {
  const base = { model: null, session: null, pane: null, port: 1, token: 't', pid: 1, activity: 'idle', startedAt: null };
  const kept = resolveLive([
    { ...base, name: 'A0-LAB', state: 'down', updatedAt: 1, file: 'a' },
    { ...base, name: 'A0-LAB', state: 'down', updatedAt: 5, file: 'b' },
    { ...base, name: 'TWO', state: 'live', updatedAt: 1, file: 'c', pane: 'w1:p1' },
    { ...base, name: 'TWO', state: 'live', updatedAt: 1, file: 'd', pane: 'w1:p2' },
  ]);
  assert.deepEqual(kept.map(h => h.file), ['b', 'c', 'd'], 'two live chats of one name both stay');
});

test('a stopped helper (a host its spawner started) is settled and done; a stopped owner keeps its place, idle', async () => {
  write('name-configs-1.json', { name: 'configs-1', pid: 999998, port: 1, state: 'idle', session: 's-c1', lead: 'ASTRA-CONFIGS', harness: 'codex' });
  write('name-RESEARCH.json', { name: 'RESEARCH', pid: 999997, port: 1, state: 'idle', session: 's-r' });
  // Stopped a minute ago: a file written this instant reads as a host still starting.
  const ago = Date.now() / 1000 - 60;
  for (const f of ['name-configs-1.json', 'name-RESEARCH.json']) utimesSync(path.join(dir, f), ago, ago);
  const all = await rows();
  const job = all.find(r => r.name === 'configs-1'), owner = all.find(r => r.name === 'RESEARCH');
  assert.deepEqual([job.row, job.status, job.hostParent, job.finished], ['settled', 'done', 'ASTRA-CONFIGS', true]);
  assert.deepEqual([owner.row, owner.status], ['live', 'idle']);
  rmSync(path.join(dir, 'name-configs-1.json')); rmSync(path.join(dir, 'name-RESEARCH.json'));
});
