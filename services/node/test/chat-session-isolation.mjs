/** Synthetic registry and real loopback WS transport; no application boot, provider, private chat, or external service. */
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import http from 'node:http';
import vm from 'node:vm';
import { WebSocket, WebSocketServer } from 'ws';
import ts from '../../../apps/web/node_modules/typescript/lib/typescript.js';
import { listServiceHosts, bindServiceRows } from '../src/service-hosts.ts';
import { parseConversationChatTarget, matchesConversationTarget } from '../src/conversation-route.ts';
import { chatWindow, olderPage } from '../src/transcript.ts';
import { sendDeliveredChat } from '../src/review-delivery.ts';

const root = path.resolve(import.meta.dirname, '../../..');
const scratch = mkdtempSync(path.join(tmpdir(), '.siso-ephemeral-chat-isolation.'));
const hostsDir = path.join(scratch, 'hosts');
mkdirSync(hostsDir);
const source = readFileSync(path.join(root, 'services/node/src/server.ts'), 'utf8');
const ast = ts.createSourceFile('server.ts', source, ts.ScriptTarget.Latest, true);
const upgrade = ast.statements.find(n => ts.isExpressionStatement(n) && ts.isCallExpression(n.expression) && n.expression.expression.getText(ast) === 'server.on' && n.expression.arguments[0]?.text === 'upgrade');
const bodies = ast.statements.filter(n => ts.isFunctionDeclaration(n) && ['passThrough', 'watchHostState'].includes(n.name?.text));
assert.ok(upgrade && bodies.length === 2, 'production route and transport functions are present');
const compiled = ts.transpileModule([...bodies.map(n => n.getText(ast)), upgrade.getText(ast)].join('\n'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
const checks = [], fixtures = [], clients = [];
let bridge, bridgeSockets, freshHosts = [], registryNames = [];
const paneOf = new Map(), sessionOf = new Map(), nameOf = new Map(), serviceByRow = new Map();
const until = async (predicate, label) => {
  const end = Date.now() + 10000;
  while (Date.now() < end) { if (predicate()) return; await new Promise(r => setTimeout(r, 5)); }
  throw Error('Timed out: ' + label);
};
// One file per session: `name-SAME.json` and `name-same.json` are one file on macOS's case-insensitive disk (t-0447);
// a plain file name (as 00-pane.json) takes the host's name from inside it.
async function fixture(name, session, pane = null, file = `host-${session}.json`) {
  const messages = [], sockets = new Set();
  const server = http.createServer((req, res) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ pid: process.pid })); });
  const wss = new WebSocketServer({ noServer: true });
  const token = 'synthetic-' + session;
  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url, 'http://fixture');
    if (url.pathname !== '/ws' || url.searchParams.get('token') !== token) return socket.destroy();
    wss.handleUpgrade(req, socket, head, ws => {
      sockets.add(ws); ws.on('close', () => sockets.delete(ws));
      ws.on('message', data => messages.push(JSON.parse(String(data))));
      ws.send(JSON.stringify({ t: 'hello', name, session, state: 'idle', log: Array.from({ length: 75 }, (_, i) => ({ t: 'text', id: 'shared-' + i, text: `${session} HISTORY ${i}`, at: i + 1 })), partial: {}, tasks: [], bg: [] }));
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const metadata = { name, session, pane, pid: process.pid, port: server.address().port, token, state: 'idle', cwd: scratch };
  writeFileSync(path.join(hostsDir, file), JSON.stringify(metadata));
  const result = { server, wss, messages, sockets, metadata, file };
  fixtures.push(result);
  return result;
}
async function refresh() {
  freshHosts = await listServiceHosts({ dir: hostsDir, processAlive: () => true, portHealthy: () => true, launchdLoaded: () => false });
  const rows = bindServiceRows([...paneOf].map(([id, pane]) => ({ id, pane, session: sessionOf.get(id), name: nameOf.get(id), cwd: scratch })), freshHosts);
  registryNames = rows.map(row => row.id);
  serviceByRow.clear();
  for (const row of rows) if (row.serviceHost && !row.pane) serviceByRow.set(row.id, row.serviceHost.name);
  return rows;
}
async function connect(id, { raw = false } = {}) {
  const ws = new WebSocket(`ws://127.0.0.1:${bridge.address().port}/chat/${raw ? id : encodeURIComponent(id)}/ws`, { origin: 'http://fixture' });
  const result = { ws, events: [], rejected: false };
  clients.push(ws);
  ws.on('message', data => result.events.push(JSON.parse(String(data))));
  ws.on('error', () => { result.rejected = true; });
  ws.on('close', () => { result.rejected = !result.events.length; });
  await until(() => result.rejected || result.events.some(e => e.t === 'hello'), id);
  return result;
}
try {
  const terminal = await fixture('SAME', 'pane-session', 'fixture:p1', '00-pane.json');
  const service = await fixture('SAME', 'service-session');
  await fixture('same', 'lowercase-session');
  paneOf.set('terminal-same', 'fixture:p1'); sessionOf.set('terminal-same', 'pane-session'); nameOf.set('terminal-same', 'SAME');
  await refresh();
  assert.ok(registryNames.includes('service-SAME') && registryNames.includes('terminal-same'));
  bridge = http.createServer(); bridgeSockets = new WebSocketServer({ noServer: true });
  const context = { Buffer, console, WebSocket, URL, parseConversationChatTarget, matchesConversationTarget, MACHINE_KEY: "laptop", ALLOWED_ORIGINS: new Set(['http://fixture']), server: bridge, wss: bridgeSockets,
    paneOf, sessionOf, nameOf, serviceByRow, successor: new Map(), cwdOf: new Map(), toolOf: new Map(), hostStates: new Map(),
    HOSTS_DIR: hostsDir, listAgents: refresh, listServiceHosts: async () => freshHosts,
    hostsByPane: () => new Map(freshHosts.filter(h => h.pane).map(h => [h.pane, h])),
    codexAppThread: () => null, sessionFile: () => null, codexFile: () => null,
    chatWindow, olderPage, sendDeliveredChat, reviewDeliveryOptions: { file: path.join(scratch, 'reviews.json') },
  };
  vm.runInNewContext(compiled, context, { filename: 'actual-chat-upgrade-and-pass-through' });
  await new Promise(resolve => bridge.listen(0, '127.0.0.1', resolve));
  const a = await connect('terminal-same'), b = await connect('service-SAME'), c = await connect('service-same');
  assert.equal(a.events[0].session, 'pane-session');
  assert.equal(b.events[0].session, 'service-session', 'service route must not use its pane-backed namesake');
  assert.equal(c.events[0].session, 'lowercase-session', 'names are exact, never normalized aliases');
  checks.push('same-name terminal and pane-less service greet with distinct exact sessions; case-distinct names remain distinct');
  const encoded = await connect('service-%53AME', { raw: true });
  assert.equal(encoded.events[0].session, 'service-session');
  assert.ok((await connect('service-%2Fescape', { raw: true })).rejected);
  assert.ok((await connect('service-%GG', { raw: true })).rejected);
  assert.ok((await connect('service-missing')).rejected);
  checks.push('encoded allowed names resolve exactly; malformed, path-like and unknown identities fail closed');
  for (const socket of service.sockets) socket.send(JSON.stringify({ t: 'text', id: 'shared-live', text: 'SERVICE ONLY', at: 99 }));
  await until(() => b.events.some(e => e.text === 'SERVICE ONLY'), 'service live reply');
  assert.ok(!a.events.some(e => e.text === 'SERVICE ONLY')); assert.ok(!c.events.some(e => e.text === 'SERVICE ONLY'));
  b.ws.send(JSON.stringify({ t: 'older', before: b.events[0].before, want: 30 }));
  await until(() => b.events.some(e => e.t === 'older'), 'older service history');
  assert.ok(b.events.find(e => e.t === 'older').events.every(e => e.text.startsWith('service-session')));
  assert.equal(service.messages.length, 0, 'pagination handled locally without a host command');
  checks.push('real loopback subscription and older-page stash stay with their owning service session');
  rmSync(path.join(hostsDir, service.file)); await refresh();
  assert.ok((await connect('service-SAME')).rejected, 'removed service must not fall through to same-name pane');
  assert.equal((await connect('terminal-same')).events[0].session, 'pane-session');
  checks.push('removed pane-less service fails closed while same-name terminal remains available');
  await fixture('SAME', 'service-replacement'); await refresh();
  assert.equal((await connect('service-SAME')).events[0].session, 'service-replacement');
  checks.push('unique same-seat replacement resolves its current session without modifying existing history');
  await fixture('SAME', 'ambiguous-service', null, 'duplicate-service.json'); await refresh();
  assert.ok((await connect('service-SAME')).rejected);
  checks.push('duplicate pane-less identities fail closed rather than following file order');
  rmSync(path.join(hostsDir, terminal.file));
  await fixture('OTHER', 'reused-pane-session', 'fixture:p1', 'new-pane.json'); await refresh();
  assert.ok((await connect('terminal-same')).rejected, 'cached old session cannot route to the reused pane owner');
  sessionOf.delete('terminal-same');
  assert.ok((await connect('terminal-same')).rejected, 'unknown session cannot authorize a pane host');
  sessionOf.set('terminal-same', 'reused-pane-session');
  assert.equal((await connect('terminal-same')).events[0].session, 'reused-pane-session');
  paneOf.delete('terminal-same'); sessionOf.delete('terminal-same'); await refresh();
  assert.ok((await connect('terminal-same')).rejected, 'removed exact row cannot fall back to its old pane');
  checks.push('stale or unknown cached pane session fails closed; verified refreshed session reconnects; removed row stays unavailable');
  assert.equal(fixtures.flatMap(f => f.messages).length, 0, 'no provider/control/prompt frames');
  console.log(JSON.stringify({ ok: true, checks, providerFrames: 0, loopbackOnly: true, scope: 'actual extracted WS upgrade/passThrough + actual registry, pagination and delivery modules; synthetic in-process hosts' }));
} finally {
  for (const ws of clients) ws.terminate();
  for (const ws of bridgeSockets?.clients ?? []) ws.terminate();
  for (const f of fixtures) for (const ws of f.wss.clients) ws.terminate();
  await Promise.all([...(bridge ? [new Promise(r => bridge.close(r))] : []), ...fixtures.map(f => new Promise(r => f.server.close(r)))]);
  bridgeSockets?.close(); fixtures.forEach(f => f.wss.close());
  rmSync(scratch, { recursive: true, force: true });
}
