// Restart timing proof: real headless named herdr, synthetic SDK seats, random node port. No live sockets.
import assert from 'node:assert/strict';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { once } from 'node:events';
import { createRequire } from 'node:module';
import { mkdtempSync, mkdirSync, writeFileSync, openSync, writeSync, closeSync, readFileSync } from 'node:fs';
import path from 'node:path';
import http from 'node:http';
const root = path.resolve(import.meta.dirname, '..');
const require = createRequire(path.join(root, 'services/node/package.json'));
const { webkit } = require('playwright'), { WebSocket, WebSocketServer } = require('ws');
const run = promisify(execFile), sleep = ms => new Promise(r => setTimeout(r, ms));
const phase = process.argv[2] ?? 'before';
const out = path.join(root, 'ui-hub/right-panel/rounds/reconnect');
const scratch = mkdtempSync('/tmp/abr-');
const lab = `ab-reconnect-${process.pid}`;
const binary = process.env.RECONNECT_HERDR ?? path.join(process.env.HOME, '.local/bin/herdr.real');
const env = { ...process.env, HOME: scratch, SHELL: '/bin/sh', HERDR_CONFIG_PATH: path.join(scratch, 'herdr.toml') };
for (const k of ['HERDR_ENV','HERDR_SOCKET_PATH','HERDR_SESSION','HERDR_PANE_ID','HERDR_TAB_ID','HERDR_WORKSPACE_ID','HERDR_BIN_PATH']) delete env[k];
writeFileSync(env.HERDR_CONFIG_PATH, '');
const calls = path.join(scratch, 'calls.jsonl');
const wrapper = path.join(scratch, 'herdr.mjs');
writeFileSync(wrapper, `import {spawn} from 'node:child_process';import {appendFileSync} from 'node:fs';const args=process.argv.slice(2),start=Date.now();const child=spawn(${JSON.stringify(binary)},['--session',${JSON.stringify(lab)},...args],{env:process.env,stdio:['inherit','pipe','pipe']});child.stdout.pipe(process.stdout);child.stderr.pipe(process.stderr);child.on('exit',code=>{appendFileSync(${JSON.stringify(calls)},JSON.stringify({args,start,end:Date.now(),ok:code===0})+'\\n');process.exitCode=code??1;});process.on('SIGTERM',()=>child.kill());`);
const cli = async (...args) => JSON.parse((await run(binary, ['--session', lab, ...args], { env, timeout: 15000 })).stdout || '{}');
const seats = Number(process.env.RECONNECT_SEATS ?? 6), mb = Number(process.env.RECONNECT_MB ?? 128), count = Number(process.env.RECONNECT_SAMPLES ?? 3);
for (const dir of ['hosts','ctx','runs','claude/projects/fixture']) mkdirSync(path.join(scratch, dir), { recursive: true });
let server, node, browser, host, sockets;
const receipt = { phase, lab: { kind: 'real named headless herdr + synthetic SDK seats', session: lab, livePortUsed: false, seats, megabytesPerSeat: mb }, corpusBytes: 0, samples: [], cleanup: {} };
const stop = async child => { if (child && child.exitCode === null) { if(child.spawnargs.includes(path.join(root,'services/node/src/server.ts'))) process.kill(-child.pid,'SIGTERM');else child.kill('SIGTERM'); await once(child, 'exit'); } };
const wait = async fn => { for (let i = 0; i < 2400; i++) { if (await fn()) return; await sleep(25); } throw Error('lab readiness timed out'); };
try {
  server = spawn(binary, ['--session', lab, 'server'], { env, stdio: ['ignore','ignore','pipe'] });
  let err = ''; server.stderr.on('data', b => err += b);
  await wait(() => cli('pane','list').then(() => true, () => { if (server.exitCode !== null) throw Error(`lab exited: ${err.slice(-1000)}`); return false; }));
  host = http.createServer((req, res) => res.end(JSON.stringify({ pid: process.pid })));
  await new Promise(r => host.listen(0, '127.0.0.1', r));
  sockets = new WebSocketServer({ server: host });
  sockets.on('connection', ws => ws.send(JSON.stringify({ t: 'hello', session: 'reconnect-seat-0', name: 'Agent Zero', state: 'idle', log: [{t:'assistant',text:'LAB CHAT READY'}], partial: {}, tasks: [] })));
  const panes = [];
  for (let i = 0; i < seats; i++) {
    const created = await cli('workspace', 'create', '--label', `RECONNECT-${i}`, '--no-focus', '--cwd', scratch);
    const pane = created.result.root_pane;
    assert.ok(pane?.pane_id);
    panes.push(pane);
    const session = `reconnect-seat-${i}`;
    const file = path.join(scratch, 'claude/projects/fixture', `${session}.jsonl`);
    const line = JSON.stringify({ type:'assistant',timestamp:new Date().toISOString(), message:{id:'same-api-call',model:'claude-opus-5-5',usage:{input_tokens:12000,output_tokens:100},content:[{type:'text',text:'Synthetic accounting history '.repeat(4)}]} })+'\n';
    const chunk = Buffer.from(line.repeat(4096)), fd = openSync(file, 'w');
    let bytes = 0;
    while (bytes < mb * 1024 * 1024) { bytes += writeSync(fd, chunk); }
    closeSync(fd); receipt.corpusBytes += bytes;
    writeFileSync(path.join(scratch, `hosts/seat-${i}.json`), JSON.stringify({pid:process.pid,port:host.address().port,token:'lab-fixture',name:i ? `RECONNECT-${i}` : 'A0',pane:pane.pane_id,cwd:scratch,session,model:'claude-opus-5-5',state:'idle',child:'running'}));
  }
  browser = await webkit.launch({headless:true});
  const context = await browser.newContext({viewport:{width:1440,height:900},deviceScaleFactor:2});
  const reserve = http.createServer(); await new Promise(r => reserve.listen(0,'127.0.0.1',r));
  const port = reserve.address().port; await new Promise(r => reserve.close(r)); assert.notEqual(port, 5401);
  receipt.lab.nodePort = port;
  const url = `http://127.0.0.1:${port}`;
  for (let i = 0; i < count; i++) {
    writeFileSync(calls, '');
    const startedAt = Date.now();
    const sample = { run:i+1, requests:[], errors:[] }, t0 = performance.now();
    receipt.samples.push(sample);
    const at = () => Math.round((performance.now()-t0)*10)/10;
    let listening;
    node = spawn(process.execPath, ['--experimental-strip-types','--no-warnings',path.join(root,'services/node/src/server.ts')], {detached:true,cwd:path.join(root,'services/node'),stdio:['ignore','pipe','pipe'],env:{...env,AB_PORT:String(port),AB_HERDR:`${process.execPath} ${wrapper}`,AB_WEB_DIST:path.join(root,'apps/web/dist'),AB_STATE:path.join(scratch,'rows.json'),AB_REGISTRY:path.join(scratch,'registry.json'),AB_HOSTS_DIR:path.join(scratch,'hosts'),AB_CTX_DIR:path.join(scratch,'ctx'),AB_CODEX_RUNS:path.join(scratch,'runs'),AB_CLAUDE_DIRS:path.join(scratch,'claude'),CLAUDE_CONFIG_DIR:path.join(scratch,'claude'),AB_HUB_HOME:scratch,AB_CONSOLE_EVENTS:path.join(scratch,'none'),AB_RESURRECT_DIR:path.join(scratch,'none'),AB_A0_TASKS:path.join(scratch,'tasks'),AB_A0_SEAT:path.join(scratch,'none-seat'),AB_LANDING_FETCH:'0',AB_VOICE_WATCH:'0',AB_BURN_CMD:'',AB_SPLIT_CMD:'none',AB_AGENTS_MS:'500'}});
    node.stdout.on('data', b => { if (String(b).includes('agent-base node on')) listening ??= at(); });
    node.stderr.on('data', b => sample.errors.push(String(b).slice(-500)));
    await wait(() => { assert.equal(node.exitCode,null,'owned node exited'); return !!listening; });
    sample.nodeListeningMs = listening;
    const page = await context.newPage();
    page.on('pageerror', e => sample.errors.push(e.message));
    page.on('request', req => { const p = new URL(req.url()).pathname; if (p.startsWith('/api/')) sample.requests.push({path:p,startMs:at()}); });
    let agentsDone;
    page.on('response', async res => { const pathname=new URL(res.url()).pathname;if(pathname.startsWith('/api/')) {await res.finished().catch(()=>{});const request=sample.requests.find(r=>r.path===pathname && r.status===undefined);if(request){request.status=res.status();request.endMs=at();}} if (new URL(res.url()).pathname === '/api/agents' && !agentsDone) { const d = await res.json(); sample.agentResponses??=[];sample.agentResponses.push({ms:at(),status:res.status(),count:d.agents?.length,error:d.error});if(d.agents?.length>=seats) {agentsDone=d;sample.firstAgentsMs=at();sample.agentsStatus=res.status();sample.agentCount=d.agents.length;} } });
    const socketsSeen = [];
    page.on('websocket', ws => { const entry={path:new URL(ws.url()).pathname,openMs:at()};socketsSeen.push(entry);ws.on('framereceived', e=>{try{if(JSON.parse(String(e.payload)).t==='hello')entry.helloMs??=at();}catch{}}); });
    await page.goto(url, {waitUntil:'domcontentloaded'}); sample.domReadyMs=at();
    await page.locator('[data-testid=rail-row]').filter({hasText:'Agent Zero'}).first().waitFor({state:'visible'});sample.firstRowPaintMs=at();sample.cachedPaint= !agentsDone;sample.cachedMarkedStale=sample.cachedPaint ? await page.locator('[data-testid=nav-rows]').getAttribute('data-stale')==='' : null;
    await wait(() => !!agentsDone);
    await page.waitForFunction(()=>document.querySelector('[data-testid=nav-rows]') && !document.querySelector('[data-testid=nav-rows]').hasAttribute('data-stale'));
    await page.locator('[data-testid=rail-row]').filter({hasText:'Agent Zero'}).first().waitFor({state:'visible'}); sample.liveRowsRenderedMs=at();
    await page.locator('[data-testid=rail-row]').filter({hasText:'Agent Zero'}).first().click();
    await wait(() => socketsSeen.some(s => s.helloMs)); sample.chatHelloMs=socketsSeen.find(s=>s.helloMs).helloMs;
    const agent=agentsDone.agents.find(a=>a.zero); assert.ok(agent);
    const ws = new WebSocket(`${url.replace('http','ws')}/term/${agent.id}/ws`, {headers:{Origin:url}});
    const terminal = new Promise((resolve,reject)=>{ const timer=setTimeout(()=>reject(Error('lab terminal timeout')),10000);ws.on('open',()=>{sample.terminalOpenMs=at();ws.send(JSON.stringify({columns:80,rows:24}));});ws.on('message',b=>{if(String(b).startsWith('0')){sample.terminalFirstDataMs=at();clearTimeout(timer);resolve();}});ws.on('error',reject); });
    await terminal; ws.close();
    sample.webSockets=socketsSeen;
    sample.herdrCalls=readFileSync(calls,'utf8').trim().split('\n').filter(Boolean).map(l=>{const c=JSON.parse(l);return {args:c.args,startMs:c.start-startedAt,endMs:c.end-startedAt,ok:c.ok};});
    const statsResponse=await fetch(`${url}/api/agents/${agent.id}/stats`);sample.statsStatus=statsResponse.status;const stats=await statsResponse.json();assert.equal(stats.apiCalls,1);assert.equal(stats.tokens.output,100);sample.statsExact=true;
    const h0=performance.now(); await fetch(`${url}/api/health`); sample.healthRoundTripMs=Math.round(performance.now()-h0);
    if(phase==='after' && i===count-1) {
      const checks=[];
      const heldReload=async (name,seed,cached) => {
        if(seed!==undefined)await page.evaluate(value=>localStorage.setItem('agent-base:agents-last',value),seed);
        let release;const gate=new Promise(r=>release=r);
        await page.route('**/api/agents',async route=>{await gate;await route.continue();});
        await page.reload({waitUntil:'domcontentloaded'});
        if(cached){await page.getByText('Reconnecting to herdr',{exact:false}).first().waitFor();assert.equal(await page.locator('[data-testid=nav-rows]').getAttribute('data-stale'),'');}
        else {await page.getByText('Reading herdr…',{exact:true}).waitFor();}
        const live=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/agents' && r.status()===200);release();await (await live).json();await page.getByText('Reading herdr…',{exact:true}).waitFor({state:'hidden'});await page.waitForFunction(()=>document.querySelector('[data-testid=nav-rows]') && !document.querySelector('[data-testid=nav-rows]').hasAttribute('data-stale'));
        await page.unroute('**/api/agents');checks.push({name,passed:true});
      };
      await heldReload('remembered rows paint with timestamp/stale marker before live API',undefined,true);
      await heldReload('corrupt cache falls back to cold fetch','{bad json',false);
      const good=await page.evaluate(()=>localStorage.getItem('agent-base:agents-last'));
      const expired=JSON.parse(good);expired.at=Date.now()-25*3600_000;
      await heldReload('expired cache falls back to cold fetch',JSON.stringify(expired),false);
      await page.addInitScript(()=>{const get=Storage.prototype.getItem,set=Storage.prototype.setItem;Storage.prototype.getItem=function(key){if(key==='agent-base:agents-last')throw Error('Storage denied');return get.call(this,key);};Storage.prototype.setItem=function(key,value){if(key==='agent-base:agents-last')throw Error('Storage denied');return set.call(this,key,value);};});
      await heldReload('denied cache storage falls back to cold fetch',undefined,false);
      receipt.cacheChecks=checks;
    }
    await page.close(); await stop(node); node=null;
    console.log(JSON.stringify({phase,run:sample.run,nodeListeningMs:sample.nodeListeningMs,firstRowPaintMs:sample.firstRowPaintMs,cachedPaint:sample.cachedPaint,firstAgentsMs:sample.firstAgentsMs,liveRowsRenderedMs:sample.liveRowsRenderedMs,chatHelloMs:sample.chatHelloMs,terminalFirstDataMs:sample.terminalFirstDataMs,errors:sample.errors.length}));
  }
  const median = key => [...receipt.samples].sort((a,b)=>a[key]-b[key])[Math.floor(count/2)][key];
  receipt.medianMs = Object.fromEntries(['nodeListeningMs','firstAgentsMs','liveRowsRenderedMs','chatHelloMs','terminalFirstDataMs'].map(k=>[k,median(k)]));
} finally {
  await stop(node); await browser?.close();
  if(sockets) {for(const ws of sockets.clients)ws.terminate();sockets.close();}
  if(host) await new Promise(r=>host.close(r));
  await stop(server);
  receipt.cleanup = {nodeStopped:!node||node.exitCode!==null,browserClosed:true,hostClosed:!host?.listening,herdrStopped:!server||server.exitCode!==null,scratch};
  mkdirSync(out,{recursive:true});writeFileSync(path.join(out,`receipt-${phase}.json`),JSON.stringify(receipt,null,2)+'\n');
}
