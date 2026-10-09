// Fully isolated codex-run, ticket and herdr fixtures. Never attach to a live terminal.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, appendFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { suitePort, webkit } from './suite-runtime.mjs';
import { codexWorkers, codexWorkerRows, roleLedger } from '../src/codex-workers.ts';

const root = path.resolve(import.meta.dirname, '../../..');
const scratch = mkdtempSync(path.join(tmpdir(), '.siso-ephemeral-ab-codex-workers.'));
const runs = path.join(scratch, 'runs'), tasks = path.join(scratch, 'tasks'), roles = path.join(scratch, 'roles');
mkdirSync(runs); mkdirSync(tasks); mkdirSync(roles);
process.env.AB_CODEX_RUNS = runs; process.env.AB_A0_TASKS = tasks; process.env.AB_A0_ROLES = roles;
writeFileSync(path.join(tasks, 't-0293.json'), JSON.stringify({ title: 'Show Builder progress' }));
const pid = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
const meta = { worker: 'Builder', tickets: ['t-0293'], model: 'gpt-6.1-sol', pid: pid.pid, parent_session: 'fixture-zero', batch: 'fixture' };
const record = (type, item) => JSON.stringify({ type, ...(item ? { item } : {}) }) + '\n';
writeFileSync(path.join(runs, 'current.meta.json'), JSON.stringify({ ...meta, name: 'Builder current', started: new Date().toISOString() }));
writeFileSync(path.join(runs, 'current.jsonl'), record('item.completed', { id: 'm1', type: 'agent_message', text: 'Building the worker row.' }) + record('item.completed', { id: 'thought', type: 'reasoning', text: 'Reuse the existing chat transcript components.' }) + record('item.started', { id: 'cmd', type: 'command_execution', command: 'pnpm check', status: 'in_progress' }));
writeFileSync(path.join(runs, 'prior.meta.json'), JSON.stringify({ ...meta, name: 'Earlier ticket', pid: 0, started: '2026-10-01T00:00:00Z' }));
writeFileSync(path.join(runs, 'prior.jsonl'), record('item.completed', { id: 'p1', type: 'agent_message', text: 'Prior run message' }));
writeFileSync(path.join(runs, 'prior.last.md'), 'RETURN\nSTATUS: done — prior ticket\nVERIFY: fixture passed');
writeFileSync(path.join(runs, 'unowned.meta.json'), JSON.stringify({ pid: pid.pid }));
writeFileSync(path.join(runs, 'broken.meta.json'), '{');

const port = await suitePort(), url = `http://127.0.0.1:${port}`;
const webPort = await suitePort(), webUrl = `http://127.0.0.1:${webPort}`;
const env = { ...process.env, AB_PORT: String(port), AB_AGENTS_MS: '100', AB_HERDR: `${process.execPath} ${path.join(root, 'services/node/test/fake-herdr.mjs')}`, FAKE_HERDR_AGENTS: JSON.stringify([{ agent: 'siso', agent_status: 'idle', name: 'A0', cwd: path.join(scratch, 'SISO_Workspace/SISO_Agents/agent-zero/siso-agent-zero'), pane_id: 'w1:p1', terminal_id: 'zero-fixture', terminal_title_stripped: 'A0' }]), AB_HUB_HOME: scratch, AB_HOSTS_DIR: path.join(scratch, 'hosts'), AB_A0_SEAT: path.join(scratch, 'seat.json'), AB_STATE: path.join(scratch, 'rows.json'), AB_REGISTRY: path.join(scratch, 'registry.json'), AB_RESURRECT_DIR: path.join(scratch, 'none'), AB_CONSOLE_EVENTS: path.join(scratch, 'none.jsonl'), AB_CLAUDE_DIRS: scratch, AB_CODEX_DIRS: scratch };
const children = [];
let browser;
const until = async fn => { for (let i = 0; i < 150; i++) { if (await fn()) return; await new Promise(r => setTimeout(r, 100)); } throw Error('fixture wait timed out'); };
const agents = async () => (await (await fetch(`${url}/api/agents`)).json()).agents;
const shots = process.argv[2];
const suffix = '-r2';
try {
  const now = Date.now();
  let workers = codexWorkers(now);
  assert.equal(workers.length, 1); assert.equal(workers[0].runs.length, 2);
  assert.equal(workers[0].runs[0].id, 'current');
  assert.equal(workers[0].runs[0].tokensPerSecond, 0, 'first read must not count historical text');
  assert.equal(workers[0].runs[1].returned, 'done — prior ticket');
  assert.equal(codexWorkerRows('fixture')[0].status, 'working');
  assert.equal(codexWorkerRows('fixture')[0].title, "Show Builder progress");
  assert.equal(codexWorkerRows('fixture')[0].workerSummary.message, "Building the worker row.");
  appendFileSync(path.join(runs, 'current.jsonl'), record('item.updated', { id: 'm1', type: 'agent_message', text: 'Building the worker row. More streamed assistant text.' }) + record('item.completed', { id: 'files', type: 'file_change', changes: [{ kind: 'update', path: 'Sidebar.tsx' }], status: 'completed' }));
  workers = codexWorkers(now + 1000);
  assert.equal(workers[0].runs[0].items.filter(i => i.id === 'm1').length, 1);
  assert.match(workers[0].runs[0].step, /Sidebar.tsx/);
  assert.ok(workers[0].runs[0].tokensPerSecond > 0);
  assert.equal(workers[0].runs[0].rateEstimated, true);
  appendFileSync(path.join(runs, 'current.jsonl'), JSON.stringify({ type: 'turn.completed', usage: { input_tokens: 100, output_tokens: 125 } }) + '\n');
  workers = codexWorkers(now + 2000);
  assert.equal(workers[0].runs[0].tokensPerSecond, 25);
  assert.equal(workers[0].runs[0].rateEstimated, false);
  assert.equal(workers[0].runs[1].returnStatus, 'done');
  assert.equal(codexWorkers(now + 8000)[0].runs[0].tokensPerSecond, 0);
  appendFileSync(path.join(runs, 'current.jsonl'), '{"type":');
  console.log('PASS reader: grouped worker, PID working, tickets, commands/files, updated message deduplication, partial JSON, estimated and usage rates expire after 5 seconds');

  for (const [role, alive] of [['Estate', true], ['Health', false], ['Efficiency', true]]) {
    writeFileSync(path.join(runs, `${role}.meta.json`), JSON.stringify({ ...meta, worker: role, name: `${role} current`, pid: alive ? pid.pid : 0, started: new Date().toISOString() }));
    writeFileSync(path.join(runs, `${role}.jsonl`), record('item.completed', { id: 'role-message', type: 'agent_message', text: `Checking ${role} progress.` }) + record('item.started', { id: 'role-command', type: 'command_execution', command: 'secret-command --fixture', status: 'in_progress' }));
    writeFileSync(path.join(roles, `${role.toLowerCase()}.jsonl`), JSON.stringify({ number: 'warnings 50 -> 46', status: 'done — four warnings resolved' }) + '\n{"number":');
  }
  await Promise.all(['HEALTH', 'EFFICIENCY', 'ESTATE'].map(roleLedger));
  const roleRows = codexWorkerRows('fixture').filter(a => a.infrastructureRole);
  assert.equal(roleRows.length, 3);
  assert.equal(roleRows.find(a => a.name === 'Estate').status, 'working');
  assert.equal(roleRows.find(a => a.name === 'Health').status, 'idle');
  assert.ok(roleRows.every(a => a.lead === null));
  assert.ok(roleRows.every(a => a.infrastructureSummary.ledger === 'warnings 50 -> 46 · done — four warnings resolved'));
  assert.ok(roleRows.every(a => !a.infrastructureSummary.line.includes('secret-command')));
  console.log('PASS infrastructure reader: three roles outside Agent Zero, PID states, last complete ledger, command-free progress');

  children.push(spawn(process.execPath, ['--experimental-strip-types', '--no-warnings', 'src/server.ts'], { cwd: path.join(root, 'services/node'), env, stdio: 'ignore' }));
  await until(() => fetch(`${url}/api/health`).then(r => r.ok, () => false));
  assert.equal((await agents()).filter(a => a.codexWorker && !a.infrastructureRole).length, 1);
  assert.equal((await fetch(`${url}/api/codex-workers/codex-worker-Builder`)).status, 200);
  assert.equal((await fetch(`${url}/api/codex-workers/unknown`)).status, 404);
  const org = await (await fetch(`${url}/api/org`)).json();
  assert.equal(org.bottom.find(a => a.name === 'ESTATE').status, 'working');
  assert.match(org.bottom.find(a => a.name === 'ESTATE').ledger, /warnings 50 -> 46/);
  children.push(spawn('pnpm', ['--filter', '@agent-base/web', 'dev', '--host', '127.0.0.1'], { cwd: root, env: { ...env, AB_WEB_PORT: String(webPort), AB_NODE: String(port) }, stdio: 'ignore' }));
  await until(() => fetch(webUrl).then(r => r.ok, () => false));
  browser = await webkit.launch({ headless: true });
  if (shots) mkdirSync(shots, { recursive: true });
  const errors = [], sockets = [];
  for (const [width, height] of [[1440, 900], [390, 844]]) {
    const page = await browser.newPage({ viewport: { width, height } });
    page.on('pageerror', e => { errors.push(e.message); console.log("PAGE ERROR:", e.message); });
    page.on('websocket', ws => sockets.push(ws.url()));
    await page.addInitScript(() => localStorage.setItem('agent-base:sidebar-open', 'true'));
    await page.goto(webUrl);
    const row = page.locator('[data-testid=codex-worker-row]');
    await row.waitFor({ timeout: 60000 }).catch(async error => {
      if (shots) await page.screenshot({ path: path.join(shots, 'failure.png') });
      console.log('API:', await page.evaluate(() => fetch('/api/agents').then(async r => [r.status, (await r.text()).slice(0, 300)]).catch(e => String(e))));
      console.log('PAGE:', (await page.locator('body').innerText()).slice(0, 900));
      throw error;
    }); assert.equal(await row.count(), 1);
    const estateDot = page.locator('.siso-infra__dots [data-role=ESTATE]');
    await page.locator('.siso-infra__entry').waitFor();
    assert.equal(await page.locator('.siso-infra__dots i').count(), 3);
    assert.ok((await estateDot.getAttribute('class')).includes('is-working'));
    assert.ok((await page.locator('.siso-infra__dots [data-role=HEALTH]').getAttribute('class')).includes('is-idle'));
    assert.equal(await estateDot.evaluate(el => getComputedStyle(el, '::after').animationName), 'ab-ring-turn');
    await page.locator('.siso-infra__entry').click();
    const infra = page.getByRole('menu', { name: 'Agent Infrastructure', exact: true });
    await infra.waitFor();
    const estate = infra.getByRole('menuitem').filter({ hasText: 'ESTATE' });
    assert.match(await estate.innerText(), /t-0293: Show Builder progress · Checking Estate progress/);
    assert.match(await estate.innerText(), /warnings 50 -> 46 · done — four warnings resolved/);
    assert.doesNotMatch(await infra.innerText(), /secret-command/);
    if (shots && width === 1440) await page.screenshot({ path: path.join(shots, 'infrastructure-popover-1440x900.png') });
    assert.equal(await row.count(), 1, 'only Builder has a worker row under Agent Zero');
    if (width === 1440) {
      await estate.click();
      await page.locator('[data-testid=codex-worker-page]').getByText('Checking Estate progress.', { exact: true }).waitFor();
    }
    await page.locator('.siso-infra__entry').click();
    await page.mouse.move(800, 400);
    assert.equal(await row.locator('.ab-ring.is-working').count(), 1);
    assert.match(await row.innerText(), /Show Builder progress/);
    assert.doesNotMatch(await row.innerText(), /pnpm check|turn complete|t-0293:/);
    await row.hover();
    const hover = page.locator('[data-testid=worker-hover]');
    await hover.waitFor();
    assert.match(await hover.innerText(), /t-0293: Show Builder progress/);
    assert.match(await hover.innerText(), /gpt-6.1-sol/);
    assert.match(await hover.innerText(), width === 1440 ? /Building the worker row/ : /Live refresh arrived/);
    assert.doesNotMatch(await hover.innerText(), /pnpm check|turn complete/);
    await page.mouse.move(800, 400);
    assert.ok(await page.locator('.siso-zero').count());
    if (shots) await page.screenshot({ path: path.join(shots, `working-row-${width}x${height}${suffix}.png`) });
    appendFileSync(path.join(runs, 'current.jsonl'), width === 1440 ? '"turn.completed","usage":{"output_tokens":50}}\n' : JSON.stringify({ type: 'turn.completed', usage: { output_tokens: 50 } }) + '\n');
    await row.getByRole('button', { name: 'Builder, working', exact: true }).click();
    const chat = page.locator('[data-testid=codex-worker-page]');
    await chat.getByText('Building the worker row. More streamed assistant text.', { exact: true }).waitFor();
    assert.equal(await chat.locator('input, textarea, [contenteditable=true]').count(), 0);
    assert.equal(await chat.locator('details[open]').count(), 0);
    await chat.locator('summary').getByText(/Earlier ticket/).waitFor();
    assert.equal(await chat.locator('summary .ab-codex-return.is-done').innerText(), 'done');
    assert.ok(await chat.locator('summary .ab-codex-duration').innerText());
    assert.equal(await chat.locator('.cr-answer .siso-chat__said:visible').count(), width === 1440 ? 1 : 2);
    assert.equal(await chat.locator('.siso-chat__call').count(), 2);
    assert.equal(await chat.locator('.siso-chat__thoughthead[aria-expanded=false]').count(), 1);
    assert.equal(await chat.locator('.siso-chat__thoughttext').count(), 0);
    assert.match(await chat.locator('header').innerText(), /t-0293 · Show Builder progress/);
    assert.equal(await chat.locator('header svg').count() > 0, true);
    assert.doesNotMatch(await chat.locator('header').innerText(), /(?:^|\s)~?0\.0 tokens/);
    assert.match(await chat.innerText(), /pnpm check/); assert.match(await chat.innerText(), /Sidebar.tsx/);
    if (shots) await page.screenshot({ path: path.join(shots, `working-page-${width}x${height}${suffix}.png`) });
    // Truncated last line must not hide later events once the writer completes it.
    if (width === 1440) {
      appendFileSync(path.join(runs, 'current.jsonl'), '{"type":"item.completed", "item":{"id":"new","type":"agent_message","text":"Live refresh arrived."}}\n');
      await chat.getByText('Live refresh arrived.', { exact: true }).waitFor({ timeout: 20000 });
    }
    await page.close();
  }
  pid.kill('SIGTERM'); await new Promise(r => pid.once('exit', r));
  await until(async () => (await agents()).find(a => a.codexWorker)?.status === 'idle');
  assert.equal(codexWorkerRows('fixture').length, 4);
  assert.equal(codexWorkerRows('fixture')[0].status, 'idle');
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.addInitScript(() => localStorage.setItem('agent-base:sidebar-open', 'true'));
  await page.goto(webUrl);
  await page.locator('[data-testid=codex-worker-row] .ab-ring.is-idle').waitFor();
  await page.locator('.siso-infra__dots [data-role=ESTATE].is-idle').waitFor();
  assert.equal(await page.locator('[data-testid=codex-worker-row]').count(), 1);
  await page.getByRole('button', { name: 'Builder, idle', exact: true }).click();
  await page.locator('[data-testid=codex-worker-page] header').getByText(/Read only/).waitFor();
  assert.equal(await page.locator('[data-testid=codex-worker-rate]').count(), 0);
  await page.close();
  assert.deepEqual(errors, []);
  assert.ok(!sockets.some(s => /codex-worker|\/term\//.test(s)), 'worker must never attach to a terminal/socket');
  console.log('PASS infrastructure fixture: Estate has no Agent Zero row; animated working dot then idle; ticket/message and ledger in footer; role click opens Builder page');
  console.log('PASS API/UI: one Builder row working then idle; read-only live page, collapsed RETURN, 1440x900 + 390x844, no worker sockets, 0 page errors');
  if (shots) writeFileSync(path.join(shots, 'VERIFY-infrastructure.txt'), 'PASS infrastructure fixture: no role rows under Agent Zero; animated Estate dot working then idle; latest ledger and command-free ticket/message; role opens Builder run page; footer screenshot 1440x900\n' + 'PASS reader: grouping, PID liveness, ticket title, item updates, partial JSON, 5-second measured/estimated rate expiry\nPASS API/UI: one Builder row working then idle; live read-only page; Claude assistant/tool rows; folded reasoning; header face/ticket/model/elapsed; RETURN status chip/duration; idle rate hidden; no worker sockets; 0 page errors\nScreenshots: working-row and working-page at 1440x900 and 390x844\n');
} finally {
  await browser?.close();
  for (const child of children) child.kill('SIGTERM');
  if (pid.exitCode === null && pid.signalCode === null) pid.kill('SIGTERM');
}
