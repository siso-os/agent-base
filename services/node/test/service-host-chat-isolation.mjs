// Sealed transport test: same-named hosts, four viewers and a seat change. Dummy sockets only.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { WebSocket, WebSocketServer } from 'ws';

const root = path.resolve(import.meta.dirname, '../../..');
const scratch = mkdtempSync(path.join(tmpdir(), '.siso-ephemeral-host-isolation.'));
const hosts = path.join(scratch, 'hosts'); mkdirSync(hosts);
const seat = path.join(scratch, 'seat.json');
const fixtureHosts = [], viewers = [];
let child;
const until = async fn => {
  for (const end = Date.now() + 15000; Date.now() < end;) {
    if (await fn()) return;
    await new Promise(r => setTimeout(r, 40));
  }
  throw Error('synthetic isolation fixture timed out');
};
try {
  for (const [i, name] of ['A0', 'A0', 'ZERO-SOL'].entries()) {
    const session = `sealed-${i}`, pane = i < 2 ? `w1:p${i + 1}` : null;
    const received = [];
    const server = http.createServer((req, res) => res.end(JSON.stringify({ pid: process.pid })));
    const sockets = new WebSocketServer({ server });
    sockets.on('connection', ws => {
      ws.send(JSON.stringify({ t: 'hello', name, session, state: 'idle', log: [{ t: 'text', id: 'shared-event-id', text: `history-${i}` }], tasks: [], bg: [] }));
      ws.on('message', b => {
        const message = JSON.parse(String(b)); received.push(message);
        if (message.t === 'prompt') ws.send(JSON.stringify({ t: 'sent', key: message.key }));
      });
    });
    await new Promise(r => server.listen(0, '127.0.0.1', r));
    fixtureHosts.push({ server, sockets, received });
    writeFileSync(path.join(hosts, pane ? `pane-${i}.json` : 'name-ZERO-SOL.json'), JSON.stringify({ pid: process.pid, port: server.address().port, token: `fixture-${i}`, name, session, pane, cwd: '/fixture', state: 'idle' }));
  }
  writeFileSync(seat, JSON.stringify({ session: 'sealed-0', pane: 'w1:p1' }));
  const reserve = http.createServer(); await new Promise(r => reserve.listen(0, '127.0.0.1', r));
  const port = reserve.address().port; await new Promise(r => reserve.close(r));
  const empty = path.join(scratch, 'none'), base = `http://127.0.0.1:${port}`;
  child = spawn(process.execPath, ['--experimental-strip-types', '--no-warnings', 'src/server.ts'], {
    cwd: path.join(root, 'services/node'), stdio: 'ignore',
    env: { ...process.env, HOME: scratch, AB_HOME: scratch, AB_HUB_HOME: scratch, AB_PORT: String(port), AB_AGENTS_MS: '100', AB_HERDR: `${process.execPath} ${path.join(root, 'services/node/test/fake-herdr.mjs')}`, FAKE_HERDR_AGENTS: '[]', AB_HOSTS_DIR: hosts, AB_A0_SEAT: seat, AB_STATE: path.join(scratch, 'rows.json'), AB_REGISTRY: path.join(scratch, 'registry.json'), AB_CLAUDE_DIRS: empty, AB_CODEX_DIRS: empty, AB_CODEX_HOME: empty, AB_CODEX_RUNS: empty, AB_A0_TASKS: empty, AB_RESURRECT_DIR: empty, AB_CONSOLE_EVENTS: empty, AB_VOICE_WATCH: '0' },
  });
  let agents;
  await until(async () => { try { const r = await fetch(`${base}/api/agents`); if (r.ok) { agents = (await r.json()).agents; return true; } } catch {} return false; });
  assert.equal(agents.filter(a => a.session?.startsWith('sealed-')).length, 3);
  assert.equal(agents.find(a => a.zero).session, 'sealed-0');
  for (const index of [0, 0, 1, 2]) {
    const agent = agents.find(a => a.session === `sealed-${index}`);
    const events = [], ws = new WebSocket(`${base.replace('http', 'ws')}/chat/${encodeURIComponent(agent.id)}/ws`, { origin: base });
    ws.on('message', b => events.push(JSON.parse(String(b))));
    ws.on('error', () => {});
    viewers.push({ ws, events, index });
    await until(() => events.some(e => e.t === 'hello'));
    assert.equal(events.find(e => e.t === 'hello').session, `sealed-${index}`);
  }
  const broadcastSecond = text => { for (const ws of fixtureHosts[1].sockets.clients) ws.send(JSON.stringify({ t: 'text', id: 'shared-event-id', text })); };
  broadcastSecond('ONLY_SECOND_BEFORE_SEAT_CHANGE');
  await until(() => viewers[2].events.some(e => e.text === 'ONLY_SECOND_BEFORE_SEAT_CHANGE'));
  for (const v of viewers.filter(v => v.index !== 1)) assert.ok(!v.events.some(e => e.text === 'ONLY_SECOND_BEFORE_SEAT_CHANGE'));
  writeFileSync(seat, JSON.stringify({ session: 'sealed-1', pane: 'w1:p2' }));
  await until(async () => ((await (await fetch(`${base}/api/agents`)).json()).agents.find(a => a.zero)?.session === 'sealed-1'));
  broadcastSecond('ONLY_SECOND_AFTER_SEAT_CHANGE');
  await until(() => viewers[2].events.some(e => e.text === 'ONLY_SECOND_AFTER_SEAT_CHANGE'));
  for (const v of viewers.filter(v => v.index !== 1)) assert.ok(!v.events.some(e => e.text === 'ONLY_SECOND_AFTER_SEAT_CHANGE'));
  for (const [i, v] of viewers.entries()) {
    v.ws.send(JSON.stringify({ t: 'prompt', key: `viewer-${i}`, text: `only-host-${v.index}` }));
    await until(() => v.events.some(e => e.t === 'sent' && e.key === `viewer-${i}`));
  }
  assert.deepEqual(fixtureHosts.map(h => h.received.filter(m => m.t === 'prompt').map(m => m.text)), [['only-host-0', 'only-host-0'], ['only-host-1'], ['only-host-2']]);
  console.log('PASS: three distinct same-name/zero-alias sessions; four viewers; shared event IDs isolated before/after seat change; old sockets deliver only to their opened host');
} finally {
  for (const v of viewers) v.ws.terminate();
  if (child) { child.kill('SIGTERM'); if (child.exitCode === null) await new Promise(r => child.once('exit', r)); }
  for (const h of fixtureHosts) {
    for (const ws of h.sockets.clients) ws.terminate();
    await new Promise(r => h.sockets.close(r));
    await new Promise(r => h.server.close(r));
  }
}
