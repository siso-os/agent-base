// Isolated proof of t-0295/t-0296: no live seat, hosts, herdr, or terminal attachment.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import http from 'node:http';
import { WebSocket, WebSocketServer } from 'ws';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { suitePort, webkit } from './suite-runtime.mjs';
const root = path.resolve(import.meta.dirname, '../../..');
const scratch = mkdtempSync(path.join(tmpdir(), '.siso-ephemeral-ab-zero-follows.'));
const shots = process.argv[2];
if (shots) mkdirSync(shots, { recursive: true });
const port = await suitePort(), url = `http://127.0.0.1:${port}`;
const hosts = path.join(scratch, 'hosts'), seat = path.join(scratch, 'seat.json');
const repo = path.join(scratch, 'SISO_Workspace/SISO_Agents/agent-zero/siso-agent-zero');
mkdirSync(hosts); mkdirSync(path.join(repo, 'bin'), { recursive: true });
const sessions = ['00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002'];
const rows = sessions.map((session, i) => ({ agent: 'claude', agent_status: 'idle', cwd: repo, pane_id: `w1:p${i+1}`, terminal_id: `term_zero${i+1}`, terminal_title_stripped: `A0 ${i ? 'new' : 'old'}`, agent_session: { value: session } }));
const claude = path.join(scratch, 'claude');
mkdirSync(path.join(claude, 'projects/fixture'), { recursive: true });
for (const [i, session] of sessions.entries()) writeFileSync(path.join(claude, 'projects/fixture', `${session}.jsonl`), JSON.stringify({ type: 'user', uuid: `fixture-${i}`, message: { role: 'user', content: i ? 'NEW SEAT CHAT' : 'OLD SEAT CHAT' } })+'\n');
writeFileSync(seat, JSON.stringify({ session: sessions[0], pane: 'w1:p1' }));
const agentsFile = path.join(scratch, 'agents.json'); writeFileSync(agentsFile, JSON.stringify(rows));
const host = { pid: process.pid, port: 1, token: 'fixture-only', name: 'HOST-ONLY', session: 'hosts-only-session', pane: 'w2:p1', cwd: scratch };
writeFileSync(path.join(hosts, 'pane.json'), JSON.stringify(host));
writeFileSync(path.join(hosts, 'name-HOST-ONLY.json'), JSON.stringify(host));
const calls = path.join(scratch, 'calls.jsonl');
const fake = path.join(scratch, 'herdr.mjs');
writeFileSync(fake, `import {appendFileSync, writeFileSync} from 'node:fs';\nconst a=process.argv.slice(2);appendFileSync(${JSON.stringify(calls)},JSON.stringify(a)+'\\n');\nif(a[0]==='tab'&&a[1]==='create') console.log(JSON.stringify({result:{root_pane:{pane_id:'w3:p1'}}}));\nelse if(a[0]==='pane'&&a[1]==='run'){writeFileSync(${JSON.stringify(path.join(hosts,'launch.json'))}, JSON.stringify(${JSON.stringify({ ...host, name: 'A0 launched', pane: 'w3:p1', session: 'launched-session' })}));console.log('{}');}\nelse await import(${JSON.stringify(path.join(root,'services/node/test/fake-herdr.mjs'))});`);
writeFileSync(path.join(repo,'bin/a0-sdk'), '#!/bin/sh\nexit 0\n', {mode:0o755});
writeFileSync(path.join(repo,'bin/a0-keepalive'), `#!/usr/bin/env node\nconst fs=require('node:fs');const a=process.argv.slice(2);fs.writeFileSync(${JSON.stringify(path.join(scratch,'keeper.json'))},JSON.stringify(a));fs.writeFileSync(${JSON.stringify(seat)},JSON.stringify({session:a[a.indexOf('--session')+1],pane:a[a.indexOf('--pane')+1]}));\n`, {mode:0o755});
const child = spawn(process.execPath, ['--experimental-strip-types','--no-warnings','src/server.ts'], {cwd:path.join(root,'services/node'),stdio:'ignore',env:{...process.env,HOME:scratch,AB_HUB_HOME:scratch,AB_PORT:String(port),AB_AGENTS_MS:"100",AB_HERDR:`${process.execPath} ${fake}`,FAKE_HERDR_AGENTS_FILE:agentsFile,AB_CLAUDE_DIRS:claude,AB_A0_SEAT:seat,AB_HOSTS_DIR:hosts,AB_STATE:path.join(scratch,'rows.json'),AB_REGISTRY:path.join(scratch,'registry.json'),AB_RESURRECT_DIR:path.join(scratch,'none'),AB_CONSOLE_EVENTS:path.join(scratch,'none.jsonl')}});
const sleep = ms => new Promise(r=>setTimeout(r,ms));
const until = async fn => {for(let i=0;i<600;i++){if(await fn())return;await sleep(100);}throw Error('fixture wait timed out');};
const agents = async()=> (await (await fetch(`${url}/api/agents`)).json()).agents;
let browser, web;
const webPort = await suitePort(), webUrl = `http://127.0.0.1:${webPort}`;
const fixtureHosts = [];
try {
  await until(()=>fetch(`${url}/api/health`).then(r=>r.ok,()=>false));
  let list=await agents(); assert.equal(list.filter(a=>a.session===host.session).length,1);
  console.log('PASS hosts-only agent listed once (duplicate host files, no detected pane)');
  writeFileSync(agentsFile,JSON.stringify([...rows,{...rows[0],pane_id:host.pane,terminal_id:'term_host',terminal_title_stripped:host.name,agent_session:{value:host.session}}]));
  await until(async()=> (await agents()).some(a=>a.id==='term_host'));
  list=await agents(); assert.equal(list.filter(a=>a.session===host.session).length,1);
  console.log('PASS host merged with herdr row once by pane/session');
  for (let i = 1; i <= 2; i++) {
    const session = `duplicate-name-${i}`;
    const server = http.createServer((req, res) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ pid: process.pid })); });
    const sockets = new WebSocketServer({ server });
    sockets.on('connection', ws => ws.send(JSON.stringify({ session })));
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    fixtureHosts.push({ server, sockets });
    writeFileSync(path.join(hosts, `duplicate-${i}.json`), JSON.stringify({ ...host, name: 'A0 duplicate', session, pane: `w4:p${i}`, port: server.address().port }));
  }
  await until(async()=> (await agents()).filter(a=>a.name==='A0 duplicate').length===2);
  for (let i = 1; i <= 2; i++) {
    const received = await new Promise((resolve, reject) => {
      const ws = new WebSocket(`${url}/chat/host-w4:p${i}/ws`, { headers: { Origin: url } });
      const timer = setTimeout(()=>{ ws.terminate(); reject(Error('host chat routing timed out')); }, 5000);
      ws.once('message', data=>{clearTimeout(timer);ws.close();resolve(JSON.parse(String(data)).session);});
      ws.once('error', error=>{clearTimeout(timer);reject(error);});
    });
    assert.equal(received, `duplicate-name-${i}`);
  }
  console.log('PASS same-name host chats route to their own pane/session');
  web = spawn("pnpm", ["--filter", "@agent-base/web", "dev", "--host", "127.0.0.1"], { cwd: root, stdio: "ignore", env: { ...process.env, AB_WEB_PORT: String(webPort), AB_NODE: String(port) } });
  await until(() => fetch(webUrl).then(r => r.ok, () => false));
  browser=await webkit.launch({headless:true});
  const page=await browser.newPage({viewport:{width:1440,height:900}});
  let acknowledgedEffort = null;
  await page.route('**/api/agents', async route => {
    const response = await route.fetch(); const data = await response.json();
    if (acknowledgedEffort) for (const agent of data.agents ?? []) if (agent.zero) agent.hud = { ...agent.hud, effort: acknowledgedEffort };
    await route.fulfill({ response, json: data });
  });
  const errors=[];page.on('pageerror',e=>{errors.push(e.message);console.log('PAGE ERROR:', e.message);});
  await page.addInitScript(()=>localStorage.setItem('agent-base:sidebar-open','true'));
  await page.goto(webUrl);
  await page.locator('[data-testid=rail-row][aria-label^="Agent Zero"]').first().click();
  await page.getByText('OLD SEAT CHAT',{exact:true}).first().waitFor();
  if(shots) await page.screenshot({path:path.join(shots,'before.png')});
  // Agent Zero's Move is enabled and confirms once. Effort is unselected until
  // the fixture reports acknowledgement, matching the host-owned model controls.
  const posted=[];
  await page.route('**/api/agents/Agent%20Zero/move', async route => {
    posted.push(route.request().postDataJSON());
    await route.fulfill({json:{state:'failed',message:'Forced failure: old agent untouched',to:'sol'}});
  });
  await page.locator('[data-testid=model-chip]').first().click();
  assert.equal(await page.getByRole('menuitem',{name:'Codex Sol',exact:false}).isEnabled(),true);
  assert.equal(await page.getByRole('radio',{name:'high',exact:true}).getAttribute('aria-checked'),'false');
  if(shots) await page.screenshot({path:path.join(shots,'menu.png')});
  page.once('dialog',dialog=>dialog.dismiss());
  await page.getByRole('menuitem',{name:'Codex Sol',exact:false}).click();
  assert.equal(posted.length,0);
  await page.getByRole('radio',{name:'x-high',exact:true}).click();
  acknowledgedEffort = 'xhigh';
  await until(async () => await page.getByRole('radio',{name:'x-high',exact:true}).getAttribute('aria-checked') === 'true');
  page.once('dialog',dialog=>{assert.equal(dialog.message(),'Move Agent Zero to Codex Sol? It reads its handover first; this chat stays on disk');return dialog.accept();});
  await page.getByRole('menuitem',{name:'Codex Sol',exact:false}).click();
  await until(()=>posted.length===1);
  assert.deepEqual(posted[0],{to:'sol',effort:'xhigh'});
  await page.getByText('Forced failure: old agent untouched',{exact:false}).first().waitFor();
  assert.equal((await agents()).find(a=>a.zero).session,sessions[0]);
  console.log('PASS Agent Zero Move enabled, confirm cancel/accept, effort forwarded, failure visible and seat retained');
  // Deliberately inside the selection guard's 10 s window, without another click.
  writeFileSync(seat,JSON.stringify({session:sessions[1],pane:'w1:p2'}));
  await until(async()=> (await agents()).find(a=>a.zero)?.session===sessions[1]);
  list=await agents();assert.equal(list.find(a=>a.id==='term_zero1').name,'A0 old');assert.equal(list.filter(a=>a.zero).length,1);
  await page.getByText('NEW SEAT CHAT',{exact:true}).first().waitFor({timeout:20000});
  assert.ok(await page.locator('[data-testid=chat-head] .ab-head__name').filter({hasText:'Agent Zero'}).first().isVisible());
  const log=await page.evaluate(()=>JSON.parse(localStorage.getItem('agent-base:selection-log')??'[]'));
  assert.ok(log.some(e=>e.cause==='seat-follow'&&!e.blocked));
  if(shots) await page.screenshot({path:path.join(shots,'after.png')});
  assert.equal(await page.locator('[data-testid=zero-name]').innerText(), 'Agent Zero');
  const switcher = page.locator('[data-testid=zero-switch]');
  const cardBefore = await page.locator('.siso-zero').boundingBox();
  if (await switcher.getAttribute('aria-expanded') !== 'true') await switcher.click();
  await page.locator('[data-testid=zero-switcher]').waitFor({ timeout: 5000 });
  assert.deepEqual(await page.locator('.siso-zero').boundingBox(), cardBefore, 'New-chat controls overlay the unchanged nav');
  assert.equal(await page.getByRole('dialog', { name: 'New chat' }).count(), 1);
  assert.equal(await page.getByTestId('new-zero-chat').innerText(), 'Claude chat');
  assert.equal(await page.getByTestId('new-codex-chat').innerText(), 'Codex chat');
  await page.keyboard.press('Escape');
  await page.getByRole('dialog', { name: 'New chat' }).waitFor({ state: 'hidden' });
  console.log('PASS new-chat controls overlay the nav, expose both runtimes and close with Escape');
  // Start from another selected agent: the explicit start action still lands on its new Zero.
  await page.evaluate(()=>{ localStorage.setItem('agent-base:active',JSON.stringify('term_zero1')); localStorage.setItem('agent-base:open',JSON.stringify(['term_zero1'])); });
  await page.reload();
  await page.getByText('OLD SEAT CHAT',{exact:true}).first().waitFor();
  assert.equal(await page.locator('[data-testid=zero-name]').innerText(), 'Agent Zero');
  assert.equal(await page.locator('.siso-zero .ab-zero__row[data-testid=rail-row]').getAttribute('data-item'), 'term_zero2');
  // The launched host uses a fixture transcript socket rather than a real SDK.
  await page.routeWebSocket(/\/chat\/host-w3:p1\/ws/, ws => {
    ws.send(JSON.stringify({ t: 'user', text: 'LAUNCHED ZERO CHAT', id: 'launch' }));
  });
  if (await switcher.getAttribute('aria-expanded') !== 'true') await switcher.click();
  await page.locator('[data-testid=new-zero-chat]').click();
  await until(()=> {try{return readFileSync(seat,'utf8').includes('launched-session');}catch{return false;}});
  await until(async()=>await page.evaluate(()=>localStorage.getItem('agent-base:active')===JSON.stringify('host-w3:p1')));
  console.log('PASS explicit New Agent Zero selects its session from another open agent');
  const argv=JSON.parse(readFileSync(calls,'utf8').trim().split('\n').find(l=>JSON.parse(l)[0]==='tab'));
  assert.deepEqual(argv,['tab','create','--workspace','A0','--cwd',repo,'--label','A0','--no-focus']);
  const keep=JSON.parse(readFileSync(path.join(scratch,'keeper.json'),'utf8'));
  assert.deepEqual(keep,['set','--session','launched-session','--launcher',path.join(repo,'bin/a0-sdk'),'--pane','w3:p1']);
  assert.ok(readFileSync(calls,'utf8').includes(path.join(repo,'bin/a0-sdk')));
  // A Codex agent that holds the seat is Zero; another Codex in the folder stays a worker.
  const codex=[0,1].map(i=>({...rows[0],agent:'codex',name:`codex-${i}`,pane_id:`w8:p${i}`,terminal_id:`term_codex${i}`,agent_session:{value:`codex-seat-${i}`}}));
  writeFileSync(agentsFile,JSON.stringify(codex));
  writeFileSync(seat,JSON.stringify({session:'codex-seat-0',pane:'w8:p0'}));
  await until(async()=> (await agents()).some(a=>a.id==='term_codex0'&&a.zero));
  const codexRows=await agents();
  assert.equal(codexRows.find(a=>a.id==='term_codex0').name,'Agent Zero');
  assert.equal(codexRows.find(a=>a.id==='term_codex1').zero,false);
  console.log('PASS Codex seat is Agent Zero; same-folder Codex worker excluded');
  assert.deepEqual(errors,[]);
  console.log('PASS New Agent Zero: fixture tab/launcher/host-session/keepalive chain; 0 page errors');
  console.log(JSON.stringify({ passed: 8, of: 8 }));
} finally { await browser?.close();web?.kill("SIGTERM");child.kill('SIGTERM'); for (const {server,sockets} of fixtureHosts) { for (const client of sockets.clients) client.terminate(); sockets.close(); server.close(); } }
