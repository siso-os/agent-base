/** Isolated workspace registry and headless WebKit; never a live agent connection. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { suitePort, webkit } from './suite-runtime.mjs';
import { readClaudeUsage, defaultClaudeDir } from '../src/claude-usage.ts';
const root = path.resolve(import.meta.dirname, '../../..');
const scratch = mkdtempSync(path.join(tmpdir(), 'ab-usage-nav-'));
const evidence = process.argv[2];
const registryFile = path.join(scratch, '.local/state/agent-base/registry.json');
mkdirSync(path.dirname(registryFile), { recursive: true });
assert.ok(evidence, 'pass evidence directory');
mkdirSync(evidence, { recursive: true });
for (const dir of ['hosts', 'runs', 'ctx']) mkdirSync(path.join(scratch, dir));
const fakeHost = http.createServer((req, res) => res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ pid: process.pid })));
await new Promise(r => fakeHost.listen(0, '127.0.0.1', r));
const port = await suitePort(), webPort = await suitePort(), url = `http://127.0.0.1:${port}`, web = `http://127.0.0.1:${webPort}`;
const host = (name, extra = {}) => writeFileSync(path.join(scratch, 'hosts', `name-${name}.json`), JSON.stringify({ name, port: fakeHost.address().port, pid: process.pid, token: 'fixture-private', cwd: scratch, configDir: defaultClaudeDir(), ...extra }));
host('A0', { session: 'fixture-zero' });
host('AGENT BASE UI', { pane: 'base-pane', session: 'fd10d9db' });
host('HOST-CHILD', { lead: 'OPERATOR-DESIGN', session: 'fixture-child' });
host('ZERO-SOL', { harness: 'codex', parent: 'Agent Zero', session: 'fixture-sol' });
host('ZERO-SOUL', { parent: 'Agent Zero', session: 'fixture-soul' });
host('OWNER-CHILD', { lead: 'OPERATOR-DESIGN' });
for (const name of ['STREAM-QUALITY','EFFICIENCY','KIKAS','FAHMY']) host(name);
host('HEALTH', { lead: 'Agent Zero' });
const terminal = (name, pane, session) => ({ name, pane_id: pane, terminal_id: `term-${name}`, agent: 'siso', agent_status: 'idle', cwd: scratch, terminal_title_stripped: name, ...(session ? { agent_session: { value: session } } : {}) });
const terminals = [terminal('AGENT BASE UI', 'base-pane', 'fd10d9db'), terminal('OPERATOR-DESIGN', 'design-pane'), terminal('PACK-NAV', 'pack-pane'), terminal('SCOUT', 'scout-pane'), terminal('MINER', 'miner-pane'), terminal('UNKNOWN', 'unknown-pane')];
for (const [name, data] of Object.entries({ 'PACK-NAV': { pane: 'pack-pane', parent_session: 'fd10d9db' }, 'PACK-TOP': { parent_pane: 'design-pane' } })) writeFileSync(path.join(scratch, 'runs', `${name}.meta.json`), JSON.stringify({ worker: name, started: Date.now(), pid: 0, ...data }));
const env = { ...process.env, AB_PORT: String(port), AB_WORKSPACE_LOGOS_DIR: path.join(scratch, 'logos'), AB_MINI_LANES: '0', AB_FLEET_STATE: path.join(scratch, 'fleets'), AB_DISPATCH_FILE: path.join(scratch, 'dispatch.jsonl'), AB_HERDR: `${process.execPath} ${root}/services/node/test/fake-herdr.mjs`, FAKE_HERDR_AGENTS: JSON.stringify(terminals), AB_HOSTS_DIR: path.join(scratch, 'hosts'), AB_CODEX_RUNS: path.join(scratch, 'runs'), AB_STATE: path.join(scratch, 'rows.json'), AB_REGISTRY: registryFile, AB_HOME: scratch, AB_HUB_HOME: scratch, AB_ORG_HOME: scratch, AB_CTX_DIR: path.join(scratch, 'ctx'), AB_A0_SEAT: path.join(scratch, 'seat.json'), AB_VOICE_WATCH: '0', AB_LAUNCHCTL: '/usr/bin/false', AB_CONSOLE_EVENTS: path.join(scratch, 'no-events'), AB_CLAUDE_DIRS: scratch, AB_CODEX_DIRS: scratch };
const children = []; let browser, page;
const wait = async fn => { for (let i = 0; i < 100; i++) { if (await fn()) return; await new Promise(r => setTimeout(r, 200)); } throw Error('dev fixture wait timed out'); };
const register = async body => {
  const res = await fetch(`${url}/api/registry`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }); assert.equal(res.status, 200); return res;
};
const snapshot = async () => page.locator('body').innerText();
const shot = async name => page.screenshot({ path:path.join(evidence,name) });
try {
  children.push(spawn(process.execPath, ['--experimental-strip-types', '--no-warnings', 'src/server.ts'], { cwd: `${root}/services/node`, env, stdio: 'ignore' }));
  await wait(() => fetch(`${url}/api/health`).then(r => r.ok, () => false));
  for (const [name, fields] of Object.entries({ 'ZERO-SOL': { zero: true, main: true }, 'AGENT BASE UI': { project: 'SISO Internal Labs', main: true }, 'OPERATOR-DESIGN': { project: 'HALO', main: true }, SCOUT: { project: 'Agent Base', owner: 'AGENT BASE UI', icon: 'search' }, MINER: { project: 'Agent Base', owner: 'SCOUT' }, 'HOST-CHILD': { project: 'HALO', owner: 'AGENT BASE UI', domain: 'Design', icon: 'search' } })) await register({ op: 'register', name, ...fields });
  for (const [name,workspace] of [['OPERATOR-DESIGN','halo-operator'],['STREAM-QUALITY','halo-streaming'],['AGENT BASE UI','agent-base'],['EFFICIENCY','agent-base'],['KIKAS','kikas'],['FAHMY','fahmy']]) await register({op:'update',name,workspace,kind:'owner'});
  await register({op:'update',name:'EFFICIENCY',main:true});
  await register({op:'register',name:'OWNER-CHILD',lead:'OPERATOR-DESIGN'});
  const ws=(await (await fetch(`${url}/api/workspace-registry`)).json()).workspaces;
  assert.deepEqual(ws.filter(w=>w.nav).sort((a,b)=>a.order-b.order).map(w=>w.id),['halo','agent-base','siso-agency','clients','research','playground','ui-hub']); // t-0563: sub-projects and folders
  assert.equal(JSON.parse(readFileSync(registryFile)).agents['OPERATOR-DESIGN'].workspace,'halo-operator');
  const logoUrl = `${url}/api/workspace-logos/halo`;
  assert.equal((await fetch(logoUrl)).status,404);
  mkdirSync(path.join(scratch,'logos'));
  const svg = '<svg xmlns="http://www.w3.org/2000/svg"><circle r="10"/></svg>';
  writeFileSync(path.join(scratch,'logos/halo.svg'),svg);
  const logoResponse = await fetch(logoUrl);
  assert.equal(logoResponse.status,200); assert.equal(await logoResponse.text(),svg);
  assert.equal(logoResponse.headers.get('cache-control'),'no-store');

  const invalid=await fetch(`${url}/api/registry`,{method:'POST',body:JSON.stringify({op:'update',name:'SCOUT',workspace:'missing'})}); assert.equal(invalid.status,400);
  await register({ op: 'update', name: 'SCOUT', main: true });
  assert.equal(JSON.parse(readFileSync(registryFile)).agents.SCOUT.main, true);
  await register({ op: 'update', name: 'SCOUT', main: false });
  assert.equal(JSON.parse(readFileSync(registryFile)).agents.SCOUT.main, false);
  const bad = await fetch(`${url}/api/registry`, { method: 'POST', body: JSON.stringify({ op: 'update', name: 'SCOUT', main: 'yes' }) }); assert.equal(bad.status, 400);
  let list;
  await wait(async () => { list = (await (await fetch(`${url}/api/agents`)).json()).agents; return list?.some(a => a.name === 'SCOUT'); });
  const named = name => list.find(a => a.name === name);
  const zero = named('Agent Zero'); assert.ok(zero);
  assert.deepEqual(list.filter(a => a.main).map(a => a.name).sort(), ['AGENT BASE UI', 'Agent Zero', 'OPERATOR-DESIGN', 'ZERO-SOL', 'EFFICIENCY'].sort());
  assert.equal(named('ZERO-SOL').zero, true); assert.equal(named('ZERO-SOL').parentId, null);
  assert.equal(named('AGENT BASE UI').project, 'Agent Base');
  for (const [child, parent] of [['HOST-CHILD', 'OPERATOR-DESIGN'], ['ZERO-SOUL', 'Agent Zero'], ['PACK-NAV', 'AGENT BASE UI'], ['PACK-TOP', 'OPERATOR-DESIGN'], ['SCOUT', 'AGENT BASE UI'], ['MINER', 'SCOUT'], ['UNKNOWN', 'Agent Zero']]) assert.equal(named(child).parentId, named(parent).id, `${child} parent`);
  assert.equal(list.filter(a => a.name === 'PACK-NAV').length, 1); assert.equal(named('PACK-NAV').id, 'term-PACK-NAV');
  assert.equal(named('HOST-CHILD').project, 'HALO'); assert.equal(named('HOST-CHILD').domain, 'Design'); assert.equal(named('HOST-CHILD').icon, 'search');
  assert.ok(list.some(a => a.name === 'SCOUT' && a.project === 'Agent Base')); assert.ok(list.some(a => a.name === 'MINER' && a.project === 'Agent Base'));
  assert.ok(!JSON.stringify(list).includes('fixture-private'));
  const project = await (await fetch(`${url}/api/hub/project/agent-base`)).json();
  assert.ok(project.owners.some(a => a.name === 'SCOUT')); assert.ok(project.owners.some(a => a.name === 'MINER'));
  assert.equal(named('OWNER-CHILD').navParentId,named('OPERATOR-DESIGN').id);
  assert.equal(named('OWNER-CHILD').workspace,'halo-operator');
  for (const name of ['PACK-NAV','PACK-TOP','SCOUT','MINER','HOST-CHILD']) assert.equal(named(name).navOwner,false);
  if (process.env.AB_REAL_OAUTH === '1') {
    let usage; await wait(async()=>{usage=await(await fetch(`${url}/api/claude-usage`)).json();return !!usage.fiveHour;});
    const direct=await readClaudeUsage(defaultClaudeDir()); assert.equal(usage.fiveHour.pct,direct.fiveHour.pct);
  }
  children.push(spawn('pnpm', ['--filter', '@agent-base/web', 'dev', '--host', '127.0.0.1'], { cwd: root, env: { ...env, AB_WEB_PORT: String(webPort), AB_NODE: String(port) }, stdio: 'ignore' }));
  await wait(() => fetch(web).then(r => r.ok, () => false));
  browser=await webkit.launch({headless:true}); page=await browser.newPage({viewport:{width:1440,height:900}});
  page.on('pageerror', error => console.error('pageerror:', error.message));
  for (let attempt=0; attempt<2; attempt++) {
    try { await page.goto(web,{timeout:60000,waitUntil:'domcontentloaded'}); await page.locator('[data-testid="nav-workspaces"] [data-workspace="halo"]').waitFor({timeout:60000}); break; }
    catch (error) { if (attempt === 1) throw error; }
  }
  await page.locator('[data-workspace="halo"] .ab-workspace__name').click();
  const nav=page.locator('[data-testid="nav-workspaces"]');
  await nav.getByText('OPERATOR-DESIGN',{exact:true}).waitFor();
  await nav.getByText('STREAM-QUALITY',{exact:true}).waitFor();
  assert.ok(await nav.locator('[data-owner="service-OWNER-CHILD"].is-child').count());
  const navText=await nav.innerText(); for(const name of ['SCOUT','MINER','PACK-NAV','PACK-TOP','HOST-CHILD']) assert.ok(!navText.includes(name));
  assert.equal(await page.locator('[data-testid="zero-crew-face"], [data-testid="project-crew-face"]').count(),0);
  await shot('halo-nav-1440x900.png');
  assert.equal(await page.locator('[data-tab="owner:term-OPERATOR-DESIGN"]').count(),1);
  assert.equal(await page.locator('[data-tab="owner:service-STREAM-QUALITY"]').count(),1);
  await shot('halo-tabs-1440x900.png');
  await nav.getByRole('button',{name:'Open HALO Fleet',exact:true}).click();
  await page.locator('[data-testid="fleet-board"] .ab-fleet__widget').first().waitFor();
  const fleetIds=await page.locator('[data-testid="fleet-board"] .ab-fleet__widget').evaluateAll(nodes=>nodes.map(n=>n.dataset.workspace));
  assert.ok(fleetIds.length && fleetIds.every(id=>['halo','halo-operator','halo-streaming'].includes(id)));
  await page.getByRole('button',{name:'Agent Zero chats',exact:true}).click();
  await page.getByRole('menuitem',{name:'Agent Zero · Claude'}).waitFor();
  await page.getByRole('menuitem',{name:'Agent Zero · Sol'}).waitFor();
  assert.equal(await page.locator('[data-tab^="zero:"]').count(),0);
  await shot('zero-dropdown-1440x900.png');
  await page.getByRole('menuitem',{name:'Agent Zero · Sol'}).click();
  assert.equal(await page.locator('[data-tab^="owner:"]').count(),0);
  // A newly registered lasting owner appears automatically on the next metadata poll.
  await register({op:'update',name:'HOST-CHILD',kind:'owner',lead:'OPERATOR-DESIGN',workspace:'halo-operator'});
  const haloName=page.locator('[data-workspace="halo"] .ab-workspace__name');
  if (await haloName.getAttribute('aria-expanded') !== 'true') await haloName.click();
  await nav.getByText('HOST-CHILD',{exact:true}).waitFor({timeout:15000});
  await nav.getByText('HOST-CHILD',{exact:true}).click();
  await page.locator('[data-tab="owner:service-HOST-CHILD"]').waitFor();
  writeFileSync(path.join(evidence,'VERIFY.txt'),'PASS: registry persistence, workspace parents, owner nesting, job exclusion, three workspace cards, workspace tabs, Zero dropdown, dynamic owner arrival. WebKit 1440x900. Fixture only; no live attachments.\n');
  writeFileSync(path.join(evidence,'nav.snapshot.txt'),await snapshot());
  console.log('PASS workspace registry/API + WebKit: points 1-6, dynamic owner arrival; 3 screenshots 1440x900');
} finally {
  if (browser) await browser.close();
  for (const child of children.reverse()) { child.kill('SIGTERM'); await new Promise(resolve => { if (child.exitCode !== null) return resolve(); child.once('exit', resolve); }); }
  await new Promise(resolve => fakeHost.close(resolve));
}
