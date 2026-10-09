// Exercise the URL gate against a disposable app that attempts a POST and a chat
// socket. Neither request may reach its server; the rendered chat must still pass.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import http from 'node:http';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '../..');
const smoke = process.argv[2] ?? path.join(root, 'tools/ab-smoke');
let writes = 0, sockets = 0;
const server = http.createServer((req, res) => {
  if (req.method !== 'GET') { writes++; res.writeHead(204).end(); return; }
  const data = req.url === '/api/health' ? { ok: true } : req.url === '/api/version' ? { sha: 'a'.repeat(40) } : req.url === '/api/agents' ? { agents: [{ id: 'fixture-zero', name: 'Agent Zero', zero: true }] } : null;
  if (data) { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(data)); return; }
  res.writeHead(200, { 'content-type': 'text/html' });
  res.end(`<button data-testid="rail-row" data-item="fixture-zero" aria-label="Agent Zero, idle">Agent Zero</button>
    <section hidden data-testid="chat-head"><span class="ab-head__name">Agent Zero</span><textarea aria-label="Message"></textarea></section>
    <script>
      fetch('/unexpected-write', { method: 'POST', body: 'synthetic fixture only' }).catch(() => {});
      const socket = new WebSocket(location.origin.replace('http', 'ws') + '/chat/live/ws'); socket.onerror = () => {};
      document.querySelector('button').onclick = () => { document.querySelector('section').hidden = false; };
    </script>`);
});
server.on('upgrade', (_req, socket) => { sockets++; socket.destroy(); });
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
try {
  const child = spawn(process.execPath, [smoke, `http://127.0.0.1:${server.address().port}`], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  child.stdout.on('data', data => output += data); child.stderr.on('data', data => output += data);
  const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', resolve); });
  assert.equal(code, 0, output);
  const result = JSON.parse(output.trim().split('\n').at(-1));
  assert.equal(result.ok, true);
  assert.equal(writes, 0, 'URL smoke must block every non-GET request');
  assert.equal(sockets, 0, 'URL smoke must block chat sockets as well as terminal sockets');
  console.log(JSON.stringify({ ok: true, appAndChatVerified: true, serverWrites: writes, serverSockets: sockets }));
} finally {
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
}
