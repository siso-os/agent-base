// A failed first herdr read must not hide independent hosts. Every process, port and path is a fixture.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import http from 'node:http';

const root = path.resolve(import.meta.dirname, '../../..');
const scratch = mkdtempSync(path.join(tmpdir(), '.siso-ephemeral-host-cold.'));
const hosts = path.join(scratch, 'hosts'); mkdirSync(hosts);
const calls = path.join(scratch, 'calls.jsonl'), fake = path.join(scratch, 'herdr.mjs');
writeFileSync(fake, `import { appendFileSync } from 'node:fs'; appendFileSync(${JSON.stringify(calls)}, JSON.stringify(process.argv.slice(2))+'\\n'); process.exit(1);`);
const health = http.createServer((req, res) => res.end(JSON.stringify({ pid: process.pid })));
await new Promise(r => health.listen(0, '127.0.0.1', r));
const privateHost = { pid: process.pid, port: health.address().port, token: 'fixture-private', cwd: '/fixture', state: 'idle' };
writeFileSync(path.join(hosts, 'name-OWNER.json'), JSON.stringify({ ...privateHost, name: 'OWNER', session: 'owner-session' }));
writeFileSync(path.join(hosts, 'pane-scout.json'), JSON.stringify({ ...privateHost, name: 'SCOUT', session: 'scout-session', pane: 'w1:p1' }));
const reserve = http.createServer(); await new Promise(r => reserve.listen(0, '127.0.0.1', r));
const port = reserve.address().port; await new Promise(r => reserve.close(r));
const empty = path.join(scratch, 'none');
const child = spawn(process.execPath, ['--experimental-strip-types', '--no-warnings', 'src/server.ts'], {
  cwd: path.join(root, 'services/node'), stdio: ['ignore', 'ignore', 'pipe'],
  env: { ...process.env, HOME: scratch, AB_HOME: scratch, AB_HUB_HOME: scratch, AB_PORT: String(port), AB_AGENTS_MS: '100', AB_HERDR: `${process.execPath} ${fake}`, AB_HOSTS_DIR: hosts, AB_STATE: path.join(scratch, 'rows.json'), AB_REGISTRY: path.join(scratch, 'registry.json'), AB_A0_SEAT: empty, AB_CLAUDE_DIRS: empty, AB_CODEX_DIRS: empty, AB_CODEX_HOME: empty, AB_CODEX_RUNS: empty, AB_A0_TASKS: empty, AB_RESURRECT_DIR: empty, AB_CONSOLE_EVENTS: empty, AB_VOICE_WATCH: '0' },
});
let stderr = ''; child.stderr.on('data', b => stderr += b);
try {
  let agents;
  for (const until = Date.now() + 15000; Date.now() < until;) {
    assert.equal(child.exitCode, null, stderr);
    try { const r = await fetch(`http://127.0.0.1:${port}/api/agents`); if (r.ok) { agents = (await r.json()).agents; break; } } catch {}
    await new Promise(r => setTimeout(r, 50));
  }
  assert.ok(agents, 'cold /api/agents responds despite herdr outage');
  for (const session of ['owner-session', 'scout-session']) {
    const matched = agents.filter(a => a.session === session);
    assert.equal(matched.length, 1, `exactly one row for ${session}`);
    assert.equal(matched[0].serviceHost.state, 'live');
  }
  assert.equal(new Set(agents.map(a => a.id)).size, agents.length);
  assert.ok(!JSON.stringify(agents).includes('fixture-private'));
  const trace = readFileSync(calls, 'utf8').trim().split('\n').map(JSON.parse);
  assert.ok(trace.some(c => c[0] === 'agent' && c[1] === 'list'));
  assert.ok(trace.every(c => c[1] === 'list'), 'discovery performs no terminal writes');
  console.log('PASS: cold unavailable herdr; healthy named and pane hosts listed once; private token absent; zero terminal writes');
} finally {
  child.kill('SIGTERM');
  if (child.exitCode === null) await new Promise(r => child.once('exit', r));
  await new Promise(r => health.close(r));
}
