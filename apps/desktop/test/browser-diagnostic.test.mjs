// Isolated node: fake herdr and private state overrides, never any terminal attachment.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import http from 'node:http';
const root = path.resolve(import.meta.dirname, '../../..');
const scratch = mkdtempSync(path.join(tmpdir(), 'ab-web-tabs-diagnostic-'));
const empty = path.join(scratch, 'empty'); mkdirSync(empty);
const fake = path.join(scratch, 'herdr.mjs'); writeFileSync(fake, 'console.log("[]");');
const listener = http.createServer();
await new Promise(r => listener.listen(0, '127.0.0.1', r));
const port = listener.address().port;
await new Promise(r => listener.close(r));
const base = `http://127.0.0.1:${port}`;
let output = '';
const child = spawn(process.execPath, ['--experimental-strip-types', '--no-warnings', 'src/server.ts'], {
  cwd: path.join(root, 'services/node'), stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env,
    AB_PORT: String(port), AB_HERDR: `${process.execPath} ${fake}`, AB_STATE: path.join(scratch, 'rows.json'),
    AB_REGISTRY: path.join(scratch, 'registry.json'), AB_BROWSER_STATE: path.join(scratch, 'browser.json'),
    AB_BROWSER_HISTORY: path.join(scratch, 'history.json'), AB_CLAUDE_DIRS: empty, AB_HOSTS_DIR: empty,
    AB_CTX_DIR: empty, AB_RESURRECT_DIR: empty, AB_CONSOLE_EVENTS: path.join(scratch, 'none'), AB_HUB_HOME: empty,
    AB_MINI_LANES: '0', AB_SERVERS_PROBE: '0', AB_SUPERVISED: '0', AB_PARENT_PID: String(process.pid),
  },
});
child.stdout.on('data', d => { output += d; }); child.stderr.on('data', d => { output += d; });
try {
  let ready = false;
  for (let i = 0; i < 100; i++) {
    if (await fetch(`${base}/api/health`).then(r => r.ok, () => false)) { ready = true; break; }
    await new Promise(r => setTimeout(r, 100));
  }
  assert.ok(ready, 'isolated node started');
  const send = (body, origin = base) => fetch(`${base}/api/browser/diagnostic`, { method: 'POST',
    headers: { 'content-type': 'application/json', origin }, body: JSON.stringify(body) });
  const b = { tab: 'tab:fixture#private@example.invalid', command: 'browser_open', status: 'ok', x: 300, y: 40, width: 1140, height: 860,
    rawUrl: 'https://example.invalid/?token=SECRET_QUERY', error: 'PRIVATE_ERROR', cookie: 'PRIVATE_COOKIE' };
  assert.equal((await send(b)).status, 200);
  assert.equal((await send(b, 'https://untrusted.invalid')).status, 403);
  assert.equal((await send({ ...b, command: 'anything' })).status, 400);
  await new Promise(r => setTimeout(r, 100));
  const events = output.split('\n').filter(s => s.startsWith('{')).map(s => JSON.parse(s)).filter(e => e.event === 'browser-command');
  assert.equal(events.length, 1);
  assert.match(events[0].tab, /^browser-page-[a-f0-9]{20}$/);
  assert.deepEqual(events[0].bounds, [300, 40, 1140, 860]);
  for (const secret of ['SECRET_QUERY', 'PRIVATE_ERROR', 'PRIVATE_COOKIE', 'private@example']) assert.ok(!output.includes(secret));
  console.log('PASS: command bounds recorded, private fields dropped, foreign origin and invalid command rejected');
} finally {
  const exited = new Promise(r => child.once('exit', r));
  if (child.exitCode === null) { child.kill('SIGTERM'); await exited; }
}
