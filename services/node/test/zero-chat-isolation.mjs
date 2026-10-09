// Two real fixture host sockets, identical A0 names, distinct panes/sessions. No live agent connections.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import http from 'node:http';
import net from 'node:net';
import { WebSocketServer } from 'ws';
import { suitePort, webkit } from './suite-runtime.mjs';

const root = path.resolve(import.meta.dirname, '../../..');
const scratch = mkdtempSync(path.join(tmpdir(), '.siso-ephemeral-zero-isolation.'));
const hosts = path.join(scratch, 'hosts'), runs = path.join(scratch, 'runs'), tasks = path.join(scratch, 'tasks');
for (const dir of [hosts, runs, tasks]) mkdirSync(dir);
const shots = process.argv[2];
if (shots) mkdirSync(shots, { recursive: true });
const repo = path.join(scratch, 'SISO_Workspace/SISO_Agents/agent-zero/siso-agent-zero');
const sessions = ['isolation-one', 'isolation-two'];
const at = Date.parse('2026-10-03T19:10:00Z');
const marker = 'ONLY_SECOND_REPLY';
const reply = marker + '\n\n' + 'This long assistant answer belongs exclusively to the second Agent Zero session. '.repeat(160);
const fixtureHosts = [], children = [], errors = [], attached = [];
let browser;
const until = async fn => { const end = Date.now() + 60000; while (Date.now() < end) { if (await fn()) return; await new Promise(r => setTimeout(r, 100)); } throw Error('fixture wait timed out'); };
const logs = sessions.map((s, i) => [{ t: 'user', id: 'same-user-id', text: `CHAT ${i + 1} ONLY`, at, from: 'shaan' }]);
const lines = [], failures = [];
// Keep independent historical UI contracts visible even if one surface has moved.
const contract = async (name, fn) => { try { await fn(); pass(`PASS ${name}`); } catch (e) { failures.push({ name, error: e.message }); console.log(`FAIL ${name}: ${e.message}`); } };
const openFleet = async page => {
  const toggle = page.getByTestId('chat-panel-toggle');
  await toggle.waitFor();
  if (await toggle.getAttribute('aria-pressed') !== 'true') await toggle.click();
  await page.getByTestId('panel-tab-subagents').click();
  await page.getByTestId('fleet-board').waitFor();
};
const selectZero = async (page, second) => {
  if (!second) { await page.locator('.siso-zero [data-testid=rail-row]').click(); return; }
  await openFleet(page);
  await page.locator('.ab-fleet__row').filter({ has: page.locator('b', { hasText: /^A0$/ }) }).click();
};
const pass = line => { lines.push(line); console.log(line); };
try {
  for (const [i, session] of sessions.entries()) {
    const server = http.createServer((req, res) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ pid: process.pid })); });
    const sockets = new WebSocketServer({ server });
    sockets.on('connection', ws => ws.send(JSON.stringify({ t: 'hello', name: 'A0', session, state: 'idle', log: logs[i], tasks: [], bg: [] })));
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    fixtureHosts.push({ server, sockets });
    writeFileSync(path.join(hosts, `pane-${i + 1}.json`), JSON.stringify({ pid: process.pid, port: server.address().port, token: 'fixture-only', name: 'A0', session, pane: `w1:p${i + 1}`, cwd: repo, startedAt: at + i * 3600000 }));
  }
  writeFileSync(path.join(scratch, 'seat.json'), JSON.stringify({ session: sessions[0], pane: 'w1:p1' }));
  writeFileSync(path.join(tasks, 't-9999.json'), JSON.stringify({ title: 'Keep replies in their own chat' }));
  writeFileSync(path.join(runs, 'builder.meta.json'), JSON.stringify({ worker: 'Builder', tickets: ['t-9999'], name: 'Isolation test', model: 'gpt-6.1-sol', pid: process.pid, started: at }));
  writeFileSync(path.join(runs, 'builder.jsonl'), JSON.stringify({ type: 'item.completed', item: { id: 'm', type: 'agent_message', text: 'Checking independent Agent Zero chats. ' + 'Long status text. '.repeat(30) } }) + '\n' + JSON.stringify({ type: 'item.started', item: { id: 'cmd', type: 'command_execution', command: 'DO NOT SHOW THIS SHELL COMMAND', status: 'in_progress' } }) + '\n' + JSON.stringify({ type: 'turn.completed' }) + '\n');
  const port = await suitePort();
  const webListener = net.createServer();
  await new Promise(resolve => webListener.listen(0, '127.0.0.1', resolve));
  const webPort = webListener.address().port;
  await new Promise(resolve => webListener.close(resolve));
  const url = `http://127.0.0.1:${port}`, webUrl = process.env.AB_WEB_DIST ? url : `http://127.0.0.1:${webPort}`;
  const env = { ...process.env, AB_PORT: String(port), AB_AGENTS_MS: '100', AB_HERDR: `${process.execPath} ${path.join(root, 'services/node/test/fake-herdr.mjs')}`, FAKE_HERDR_AGENTS: '[]', AB_HUB_HOME: scratch, AB_HOSTS_DIR: hosts, AB_A0_SEAT: path.join(scratch, 'seat.json'), AB_STATE: path.join(scratch, 'state.json'), AB_REGISTRY: path.join(scratch, 'registry.json'), AB_CLAUDE_DIRS: scratch, AB_CODEX_DIRS: scratch, AB_CODEX_RUNS: runs, AB_A0_TASKS: tasks, AB_RESURRECT_DIR: path.join(scratch, 'none'), AB_CONSOLE_EVENTS: path.join(scratch, 'none.jsonl') };
  children.push(spawn(process.execPath, ['--experimental-strip-types', '--no-warnings', 'src/server.ts'], { cwd: path.join(root, 'services/node'), env, stdio: 'ignore' }));
  await until(() => fetch(`${url}/api/health`).then(r => r.ok, () => false));
  const agents = (await (await fetch(`${url}/api/agents`)).json()).agents;
  assert.equal(agents.filter(a => a.a0).length, 2);
  assert.deepEqual(agents.filter(a => a.a0).map(a => a.session).sort(), sessions);
  assert.equal(agents.find(a => a.zero).pane, 'w1:p1');
  pass('PASS API: HTTP 200; two A0 host entries, two distinct sessions/panes, one seat');
  if (!process.env.AB_WEB_DIST) children.push(spawn('pnpm', ['--filter', '@agent-base/web', 'dev', '--host', '127.0.0.1'], { cwd: root, env: { ...env, AB_WEB_PORT: String(webPort), AB_NODE: String(port) }, stdio: 'ignore' }));
  await until(() => fetch(webUrl).then(r => r.ok, () => false));
  console.log('FIXTURE browser launch');
  browser = await webkit.launch({ headless: true });
  const pages = [];
  for (const active of ['host-w1:p2', 'host-w1:p1']) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
    page.setDefaultTimeout(15000);
    page.on('pageerror', e => { errors.push(e.message); console.log('PAGE ERROR:', e.message); });
    page.on('websocket', ws => { if (ws.url().includes('/term/')) attached.push(ws.url()); });
    await page.addInitScript(() => { localStorage.setItem('agent-base:sidebar-open', 'true'); localStorage.setItem('agent-base:browser-setup', JSON.stringify({ step: 4, doneAt: 1 })); });
    console.log('FIXTURE navigate', active);
    await page.goto(webUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.locator('[data-testid=zero-name]').waitFor();
    console.log('FIXTURE select', active);
    await selectZero(page, active.endsWith('p2'));
    await page.locator('[data-testid=chat-view]').filter({ hasText: active.endsWith('p2') ? 'CHAT 2 ONLY' : 'CHAT 1 ONLY' }).first().waitFor({ timeout: 10000 }).catch(async e => { console.log('ACTIVE:', await page.evaluate(() => localStorage.getItem('agent-base:active'))); console.log('CHAT:', (await page.locator('[data-testid=chat-view]').allTextContents()).map(s => s.replace(/\s+/g, ' ').slice(0, 180))); console.log('CLIENTS:', fixtureHosts.map(h => h.sockets.clients.size)); if (shots) await page.screenshot({ path: path.join(shots, 'isolation-failure.png') }); throw e; });
    pages.push(page);
  }
  const [page, otherTab] = pages;
  await page.locator('[data-testid=zero-face]').click();
  const dock = page.locator('[data-testid=zero-dock]');
  await dock.getByText('CHAT 1 ONLY', { exact: true }).waitFor();
  await contract('two distinct dated Agent Zero chats remain selectable', async () => {
    const switcher = page.locator('[data-testid=zero-switch]');
    if (await switcher.getAttribute('aria-expanded') !== 'true') await switcher.click();
    const dates = await page.locator('[data-testid=zero-session-open] b').allTextContents();
    assert.equal(dates.length, 2); assert.notEqual(dates[0], dates[1]);
    assert.ok(dates.every(s => /^A0 · \d+ \w+ \d\d:\d\d$/.test(s)));
  });
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('[data-testid=zero-name]').innerText(), 'Agent Zero');
  if (shots) await page.screenshot({ path: path.join(shots, 'isolation-before-1440x900.png') });
  await until(() => fixtureHosts[1].sockets.clients.size >= 2);
  const broadcast = event => { for (const ws of fixtureHosts[1].sockets.clients) ws.send(JSON.stringify(event)); };
  broadcast({ t: 'state', state: 'working' });
  // Stream and then finalize the answer using deliberately shared event IDs across sessions.
  for (let n = 0; n < reply.length; n += 500) broadcast({ t: 'delta', id: 'same-answer-id', text: reply.slice(n, n + 500) });
  const answer = { t: 'text', id: 'same-answer-id', text: reply, at: at + 1000 };
  const result = { t: 'result', ms: 1000, cost: null, at: at + 2000 };
  logs[1].push(answer, result);
  broadcast(answer); broadcast(result); broadcast({ t: 'state', state: 'idle' });
  const own = page.locator('[data-testid=chat-view]').filter({ hasText: 'CHAT 2 ONLY' });
  await own.getByText(marker, { exact: false }).waitFor();
  assert.equal(await own.locator('.cr-answer .siso-chat__said').filter({ hasText: marker }).count(), 1);
  assert.ok((await own.innerText()).includes(reply.trim()));
  for (const surface of [page.locator('[data-testid=chat-view]').filter({ hasText: 'CHAT 1 ONLY' }), dock, otherTab.locator('[data-testid=chat-view]').filter({ hasText: 'CHAT 1 ONLY' })]) assert.ok(!(await surface.allTextContents()).join('\n').includes(marker));
  assert.equal(await otherTab.getByText(marker, { exact: false }).filter({ visible: true }).count(), 0);
  if (shots) await page.screenshot({ path: path.join(shots, 'isolation-after-1440x900.png') });
  pass(`PASS rendered isolation: ${reply.length}-character streamed reply only in chat 2; absent from chat 1, its dock, and other active tab`);
  await selectZero(page, false);
  await page.getByText('CHAT 1 ONLY', { exact: true }).first().waitFor();
  assert.equal(await page.getByText(marker, { exact: false }).filter({ visible: true }).count(), 0);
  assert.equal(await page.locator('[data-testid=zero-name]').innerText(), 'Agent Zero');
  assert.equal(await page.locator('.siso-zero [data-testid=rail-row]').getAttribute('data-item'), 'host-w1:p1');
  await openFleet(page);
  await contract('worker ticket and hover retain message-only truncated status', async () => {
  const row = page.locator('.ab-fleet__row').filter({ has: page.locator('b', { hasText: /^Builder$/ }) });
  assert.equal(await row.locator('.ab-fleet__copy > span').innerText(), 'Keep replies in their own chat');
  await row.hover();
  const hover = page.locator('[data-testid=worker-hover]');
  await hover.waitFor({ timeout: 3000 });
  assert.match(await hover.innerText(), /Checking independent Agent Zero chats/);
  assert.doesNotMatch(await hover.innerText(), /DO NOT SHOW|turn complete/);
  assert.equal(await hover.locator('.ab-codex-hoverline').last().evaluate(el => getComputedStyle(el).whiteSpace), 'nowrap');
  });
  if (shots) await page.screenshot({ path: path.join(shots, 'side-nav-builder-1440x900.png') });
  assert.deepEqual(errors, []); assert.deepEqual(attached, []);
  pass('PASS current Fleet selection: seat card stable; 0 page errors; no terminal attachments');
  if (shots) writeFileSync(path.join(shots, 'isolation-VERIFY.txt'), lines.join('\n') + '\n' + JSON.stringify({ failures }, null, 2));
  assert.deepEqual(failures, [], 'Historical UI acceptance contracts must remain satisfied');
} catch (error) {
  if (browser) for (const [i, page] of browser.contexts().flatMap(c => c.pages()).entries()) {
    console.log('UI FAILURE STATE:', (await page.locator('body').innerText().catch(() => '')).slice(0, 5000));
    if (shots) await page.screenshot({ path: path.join(shots, `failure-${i}.png`), timeout: 5000 }).catch(() => {});
  }
  throw error;
} finally {
  await browser?.close();
  for (const child of children) child.kill('SIGTERM');
  for (const { server, sockets } of fixtureHosts) { for (const ws of sockets.clients) ws.terminate(); sockets.close(); server.close(); }
}
