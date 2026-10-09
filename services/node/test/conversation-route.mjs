/** Pin intent must survive row reuse, and native history/control delivery waits for exact hello. Synthetic sockets only. */
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { listServiceHosts } from '../src/service-hosts.ts';
import http from 'node:http';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { conversationChatQuery, parseConversationChatTarget, matchesConversationTarget } from '../src/conversation-route.ts';

const require = createRequire(import.meta.url);
// typescript is the web app's dependency, not the node's (t-0447: "Cannot find module 'typescript'" since b044d233).
const ts = createRequire(new URL('../../../apps/web/package.json', import.meta.url))('typescript');
const { WebSocket, WebSocketServer } = require('ws');
const target = { kind: 'conversation', machine: 'laptop', harness: 'claude', session: 'pinned-session' };
const row = { id: 'service-SAME', name: 'SAME', machineKey: 'laptop', tool: 'siso', session: target.session, row: 'live' };

test('Conversation route query preserves the whole clicked seal; ordinary routes remain unsealed', () => {
  assert.deepEqual(parseConversationChatTarget(new URLSearchParams(conversationChatQuery(target))), { valid: true, target });
  assert.deepEqual(parseConversationChatTarget(new URLSearchParams()), { valid: true, target: null });
  assert.equal(conversationChatQuery(), '');
});

test('Conversation route query fails closed on malformed, duplicate, incomplete and unsupported targets', () => {
  const values = ['', '{', 'null', '[]', JSON.stringify({ kind: 'owner', workspaceId: 'agent-base' }),
    JSON.stringify({ ...target, session: '' }), JSON.stringify({ ...target, machine: null }),
    JSON.stringify({ ...target, unsupported: true }), JSON.stringify({ ...target, session: 'bad\nsession' }),
    JSON.stringify({ ...target, harness: 'siso' }),
    '{"kind":"conversation","machine":"wrong","machine":"laptop","harness":"claude","session":"pinned-session"}'];
  for (const value of values) assert.equal(parseConversationChatTarget(new URLSearchParams({ pin: value })).valid, false, value);
  assert.equal(parseConversationChatTarget(new URLSearchParams(`${conversationChatQuery(target).slice(1)}&pin=${encodeURIComponent(JSON.stringify(target))}`)).valid, false);
});

test('Fresh inventory must uniquely prove the exact row, machine, harness and session', () => {
  assert.equal(matchesConversationTarget(target, [row], row.id), true);
  for (const patch of [{ session: 'replacement' }, { session: null }, { machineKey: 'elsewhere' }, { tool: 'codex' }, { row: 'settled' }, { serviceHost: { state: 'down' } }]) {
    assert.equal(matchesConversationTarget(target, [{ ...row, ...patch }], row.id), false, JSON.stringify(patch));
  }
  for (const rows of [[], [row, row], [row, { ...row, id: 'second' }], [row, { ...row, session: 'different' }]]) {
    assert.equal(matchesConversationTarget(target, rows, row.id), false);
  }
  assert.equal(matchesConversationTarget(target, [{ ...row, id: 'successor' }], row.id), false);
});

test('Native harness proof preserves malformed metadata as unavailable without changing ordinary rows', async t => {
  const dir = mkdtempSync(path.join(tmpdir(), '.siso-ephemeral-conversation-route.'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const cases = [[undefined, 'claude'], ['claude', 'claude'], ['codex', 'codex'], [null, null], ['unknown', null], ['', null], [12, null], [{ provider: 'claude' }, null]];
  for (const [harness, expected] of cases) {
    writeFileSync(path.join(dir, 'name-SAME.json'), JSON.stringify({ name: 'SAME', pid: process.pid, port: 12345, token: 'synthetic', session: target.session, ...(harness === undefined ? {} : { harness }) }));
    const hosts = await listServiceHosts({ dir, processAlive: () => true, portHealthy: () => true, launchdLoaded: () => false });
    assert.equal(hosts.length, 1);
    assert.equal(hosts[0].conversationHarness, expected, JSON.stringify(harness));
    assert.equal(hosts[0].harness, harness === 'codex' ? 'codex' : undefined, 'ordinary compatibility');
  }
});

const source = readFileSync(new URL('../src/server.ts', import.meta.url), 'utf8');
const ast = ts.createSourceFile('server.ts', source, ts.ScriptTarget.Latest, true);
const pass = ast.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === 'passThrough');
assert.ok(pass, 'Test the actual production passThrough function');
const js = ts.transpileModule(pass.getText(ast), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
const until = async (predicate, label) => {
  const end = Date.now() + 3000;
  while (!predicate()) {
    if (Date.now() >= end) throw Error(`Timed out: ${label}`);
    await new Promise(resolve => setTimeout(resolve, 5));
  }
};
async function bridge(t, seal = target) {
  const upServer = http.createServer(), downServer = http.createServer();
  const upstream = new WebSocketServer({ server: upServer });
  const downstream = new WebSocketServer({ server: downServer });
  const controls = [], events = [];
  let native;
  upstream.on('connection', ws => { native = ws; ws.on('message', data => controls.push(JSON.parse(String(data)))); });
  const context = { WebSocket, Buffer, watchHostState: () => { throw Error('No pane in synthetic bridge'); },
    chatWindow: log => ({ stash: [], shown: log, before: 0, more: false }), olderPage: () => ({ t: 'older', events: [] }),
    sendDeliveredChat: (ws, frame, _identity, _options, text) => ws.send(text ?? JSON.stringify(frame)), reviewDeliveryOptions: {} };
  vm.runInNewContext(js, context);
  await Promise.all([new Promise(resolve => upServer.listen(0, '127.0.0.1', resolve)), new Promise(resolve => downServer.listen(0, '127.0.0.1', resolve))]);
  downstream.on('connection', ws => context.passThrough(ws, `ws://127.0.0.1:${upServer.address().port}`, undefined, { adapter: 'native', agentId: row.id, by: row.name, sessionId: null }, seal));
  const client = new WebSocket(`ws://127.0.0.1:${downServer.address().port}`);
  let closed = false;
  client.on('message', data => events.push(JSON.parse(String(data))));
  client.on('error', () => {});
  client.on('close', () => { closed = true; });
  t.after(async () => {
    client.terminate();
    for (const ws of [...upstream.clients, ...downstream.clients]) ws.terminate();
    await Promise.all([new Promise(resolve => upstream.close(resolve)), new Promise(resolve => downstream.close(resolve))]);
    await Promise.all([new Promise(resolve => upServer.close(resolve)), new Promise(resolve => downServer.close(resolve))]);
  });
  await until(() => native && client.readyState === WebSocket.OPEN, 'synthetic bridge connected');
  return { client, controls, events, native, closed: () => closed };
}
const hello = session => ({ t: 'hello', session, state: 'idle', log: [{ t: 'text', id: 'history', text: `${session} history` }] });

test('Sealed bridge rejects a metadata-to-hello replacement before history or queued controls escape', async t => {
  const b = await bridge(t);
  b.client.send(JSON.stringify({ t: 'prompt', text: 'early control' }));
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.equal(b.controls.length, 0);
  b.native.send(JSON.stringify(hello('replacement')));
  await until(b.closed, 'mismatch closed');
  assert.equal(b.events.length, 0);
  assert.equal(b.controls.length, 0);
});

test('Matching hello releases queued controls; a later wrong hello cannot replace history', async t => {
  const b = await bridge(t);
  b.client.send(JSON.stringify({ t: 'prompt', text: 'exact control' }));
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.equal(b.controls.length, 0);
  b.native.send(JSON.stringify(hello(target.session)));
  await until(() => b.controls.length === 1 && b.events.length === 1, 'matching hello and queued control');
  assert.equal(b.events[0].session, target.session);
  b.native.send(JSON.stringify(hello('replacement')));
  await until(b.closed, 'later mismatch closed');
  assert.equal(b.events.length, 1);
  assert.equal(b.controls.length, 1);
});

test('Sealed bridge rejects non-hello data before identity proof', async t => {
  const b = await bridge(t);
  b.native.send(JSON.stringify({ t: 'text', text: 'unproven history' }));
  await until(b.closed, 'unproven data closed');
  assert.equal(b.events.length, 0);
});

test('Ordinary native routes retain legacy forwarding without the pin gate', async t => {
  const b = await bridge(t, null);
  b.client.send(JSON.stringify({ t: 'prompt', text: 'ordinary control' }));
  await until(() => b.controls.length === 1, 'ordinary forwarding before hello');
  b.native.send(JSON.stringify(hello('current-session')));
  await until(() => b.events.length === 1, 'ordinary current history');
  assert.equal(b.events[0].session, 'current-session');
});


for (const session of ['replacement', null, undefined, '', 42, { id: 'pinned-session' }]) {
  test(`Sealed bridge rejects adopted or malformed init session: ${JSON.stringify(session)}`, async t => {
    const b = await bridge(t);
    b.native.send(JSON.stringify(hello(target.session)));
    await until(() => b.events.length === 1, 'initial exact hello');
    b.native.send(JSON.stringify({ t: 'init', session, model: 'synthetic-model' }));
    await until(b.closed, 'init identity mismatch closed');
    assert.equal(b.events.length, 1, 'replacement init must not reach the client');
    assert.equal(b.controls.length, 0, 'no settings or prompt frame may escape');
  });
}

test('A same-session init acknowledgement preserves sealed controls', async t => {
  const b = await bridge(t);
  b.native.send(JSON.stringify(hello(target.session)));
  await until(() => b.events.length === 1, 'initial exact hello');
  b.native.send(JSON.stringify({ t: 'init', session: target.session, model: 'synthetic-model' }));
  await until(() => b.events.length === 2, 'same-session init retained');
  b.client.send(JSON.stringify({ t: 'set_model', model: 'synthetic-next-model' }));
  await until(() => b.controls.length === 1, 'same-session control retained');
  assert.equal(b.closed(), false);
  assert.equal(b.controls[0].t, 'set_model');
});

test('An ordinary native route can adopt a new session through init', async t => {
  const b = await bridge(t, null);
  b.native.send(JSON.stringify(hello('ordinary-first')));
  await until(() => b.events.length === 1, 'ordinary hello');
  b.native.send(JSON.stringify({ t: 'init', session: 'ordinary-next', model: 'synthetic-model' }));
  await until(() => b.events.length === 2, 'ordinary replacement init');
  b.client.send(JSON.stringify({ t: 'set_effort', effort: 'max' }));
  await until(() => b.controls.length === 1, 'ordinary control retained');
  assert.equal(b.events[1].session, 'ordinary-next');
  assert.equal(b.closed(), false);
});
