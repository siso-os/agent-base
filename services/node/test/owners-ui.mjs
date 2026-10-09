// Headless visual/interaction proof. All sockets closed before navigation: never attaches to agents.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { suitePort, webkit } from './suite-runtime.mjs';
if (process.argv.includes('--live')) throw Error('Owner truth proof is synthetic only');
const live = false;
const shots = path.resolve('.agents/runs/owner-truth/screenshots'); mkdirSync(shots,{recursive:true});
const scratch = mkdtempSync(path.join(tmpdir(),'.siso-ephemeral-owner-ui.'));
process.on('exit', () => rmSync(scratch, { recursive: true, force: true }));
process.env.AB_HOSTS_DIR = path.join(scratch, 'empty-hosts');
let fixtureOwners, hostFail = false, fixtureClock = Date.now(), disconnect = false;
const streams = new Set();
const ws = [{id:'halo',name:'HALO',color:'#b19aff',nav:true,order:0},{id:'agent-base',name:'Agent Base',color:'#6aaeff',nav:true,order:1}];
const agent = {id:'fixture-zero',key:'laptop/A0',pane:'fixture:p1',name:'Agent Zero',title:'Coordinating owners',status:'idle',since:Date.now(),row:'live',snoozedUntil:null,settledAt:null,seenAt:null,order:0,tool:'claude',cwd:scratch,folder:'zero',machine:'laptop',session:null,context:null,hud:null,zero:true,a0:true,host:false,chat:true,pages:[]};
let server, vite, browser;
let url='http://127.0.0.1:5401';
if (!live) {
  process.env.AB_OWNERS_DIR=path.join(scratch,'owners');mkdirSync(process.env.AB_OWNERS_DIR);
  process.env.AB_REGISTRY=path.join(scratch,'registry.json');writeFileSync(process.env.AB_REGISTRY,JSON.stringify({workspaces:ws}));
  const fixture={name:'ORACLE-RESEARCH',workspace:'halo',title:'Make every broadcast reliable',subtitle:'Tracing reconnect failures and recovery evidence',status:'building',started:new Date(Date.now()-4*3600_000).toISOString(),updated:new Date(Date.now()-45*60_000).toISOString(),summary:'Two recovery gaps are now reproducible. The next pass checks whether a stale stream can recover without operator help.',page:'https://example.com/report',findings:[{title:'Recovery drops the active broadcast',impact:'big',evidence:'https://example.com/proof',fix:'Preserve the broadcast identity through reconnect',effort:'hours'}],subagents:[{name:'Reconnect audit',where:'mini',title:'Trace failed recovery',status:'running'},{name:'Log sweep',where:'laptop',title:'Inspect recovery logs',status:'done'}],next:'Verify recovery against the captured failure',asks:['Choose the recovery time budget']};
  writeFileSync(path.join(process.env.AB_OWNERS_DIR,'ORACLE-RESEARCH.json'),JSON.stringify(fixture));
  writeFileSync(path.join(process.env.AB_OWNERS_DIR,'AB-RESEARCH.json'),JSON.stringify({...fixture,name:'AB-RESEARCH',workspace:'agent-base',title:'Numbers you can trust',status:'done',updated:new Date().toISOString(),findings:[],asks:[]}));
  writeFileSync(path.join(process.env.AB_OWNERS_DIR,'_a0.json'),JSON.stringify({picks:[{name:'ORACLE-RESEARCH',why:'Closest to reliable live broadcasts'}]}));
  const {ownersRoute}=await import('../src/routes/owners.route.ts');
  const {createOwners}=await import('../src/owners.ts');
  const miniName='oracle-astra-build-20261005';
  const jobs=Array.from({length:5},(_,i)=>({id:`0${i+1}-build`,status:i===0?'done':'running',peak_rss_bytes:512*1024**2,started:new Date(Date.now()-3600_000).toISOString(),ended:i===0?new Date().toISOString():null}));
  for(const j of jobs)writeFileSync(path.join(process.env.AB_OWNERS_DIR,`${miniName}--${j.id}.json`),JSON.stringify({...fixture,name:`${miniName}/${j.id}`,parent:'ORACLE-RESEARCH',title:`Astra build ${j.id}`,status:j.id==='01-build'?'blocked':'building',model:'gpt-6-astra',machine:'mini',fleet:miniName,job:j.id,branch:`codex/${j.id}`,report:`/reports/${j.id}/RETURN.md`,locks:['oracle-vps/shared.ts'],subagents:[]}));
  writeFileSync(path.join(scratch,'locks.json'),JSON.stringify({locks:[{owner:`${miniName}/01-build`,parent:'ORACLE-RESEARCH',repo:'oracle',branch:'codex/01-build',files:['oracle-vps/shared.ts'],mode:'Own branch only'}],rules:[`${miniName}: cold review before landing`]}));
  fixtureOwners = createOwners(process.env.AB_OWNERS_DIR, {now:()=>fixtureClock, fetchMini:async()=>[{name:miniName,jobs}], readServiceHosts: async()=>{ if(hostFail) throw Error('synthetic outage'); return {publicHosts:[],hosts:[{name:'ORACLE-RESEARCH',state:'live',activity:'idle',model:'gpt-6-astra',updatedAt:fixtureClock-2000,token:'SYNTHETIC_SECRET',port:9999},{name:'AB-RESEARCH',state:'live',activity:'working',model:'gpt-6-astra',updatedAt:fixtureClock-2000}]}; }});
  const route=ownersRoute(fixtureOwners);
  server=http.createServer((req,res)=>{ const pathname=new URL(req.url,'http://fixture').pathname,m=pathname.match(route.path);if(m){if(pathname.endsWith('/events')){if(disconnect)return res.writeHead(503).end();streams.add(res);res.on('close',()=>streams.delete(res));}return route.handle(req,res,m);}let data={};
    if(pathname==='/api/agents') data={agents:[agent],workspaces:ws,domains:[],pinned:[],pinnedPages:[],recentPages:[]};
    else if(pathname==='/api/fleet-board') data={groups:ws.map(w=>({...w,owner:'',ownerId:null,rows:[]})),miniEnabled:false,miniAt:null};
    else if(pathname.endsWith('/subagents')) data={rows:[],machine:null};
    else if(pathname==='/api/org') data={groups:[],top:[],bottom:[]};
    else if(pathname==='/api/a0/tasks') data={tasks:[],counts:{},updated:new Date().toISOString()};
    else if(pathname==='/api/attention') data={items:[],settings:{desktop:false,snoozeUntil:0},healthy:true};
    else if(pathname.includes('/timeline')) data={events:[]};
    else if(pathname==='/api/mini/lanes') data={enabled:false,reachable:false,lanes:[],at:Date.now()};
    if(!Object.keys(data).length) return res.writeHead(503).end();
    res.writeHead(200,{'Content-Type':'application/json'}).end(JSON.stringify(data)); });
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const webPort=await suitePort();url=`http://127.0.0.1:${webPort}`;
  vite=spawn('pnpm',['--filter','@agent-base/web','dev','--host','127.0.0.1'],{env:{...process.env,AB_NODE:String(server.address().port),AB_WEB_PORT:String(webPort)},stdio:'ignore'});
  for(let i=0;i<100;i++){try{if((await fetch(url)).ok)break;}catch{}await new Promise(r=>setTimeout(r,200));}
}
try {
  browser=await webkit.launch({headless:true});
  const page=await browser.newPage({viewport:{width:1440,height:900}});
  await page.routeWebSocket('**/*', socket=>socket.close());
  // Live proof is read-only: deny every write request, including visit and selection telemetry.
  if(live) await page.route('**/api/**',route=>route.request().method()==='GET' ? route.continue() : route.abort());
  await page.addInitScript(()=>{localStorage.setItem('agent-base:panel.open.zero','true');localStorage.setItem('agent-base:sidebar-open','true');});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(url);await page.locator('[data-testid=agent-panel]').waitFor({timeout:30000}).catch(async e=>{console.log('BODY', (await page.locator('body').innerText()).slice(0,1500));console.log('ERRORS',errors);await page.screenshot({path:path.join(shots,'failure.png')});throw e;});
  await page.getByText('Coordinating owners', {exact:true}).waitFor();
  await page.getByTestId('panel-tab-subagents').click();
  // Team leads with the compact roster; the full owner cards are one click away (A0-PANEL, 6 Oct).
  await page.getByTestId('owner-roster').waitFor({timeout:10000});
  await page.getByTestId('roster-cards').click();
  await page.getByTestId('owner-board').waitFor({timeout:10000}).catch(async e=>{console.log('FIXTURE BODY', (await page.locator('body').innerText()).slice(-4000));console.log('ERRORS',errors);await page.screenshot({path:path.join(shots,'failure.png')});throw e;});
  const first=page.locator('.ab-owner').first();await first.waitFor();
  const data=await page.evaluate(()=>fetch('/api/owners').then(r=>r.json()));
  assert.equal(await first.getAttribute('data-testid'),`owner-${data.owners[0].name}`);
  assert.ok(data.owners[0].pick);
  if(!live) assert.ok(await page.locator('.ab-owner.is-stale').count());
  const oracle=page.getByTestId('owner-ORACLE-RESEARCH');
  // One truth (6 Oct 22:00): the runtime's word first, the card's word second.
  await oracle.getByTestId('owner-state').getByText(/Idle/).waitFor();
  assert.match(await oracle.getByTestId('owner-state').innerText(), /Idle\s*· building/);
  assert.match(await page.getByTestId('owner-AB-RESEARCH').getByTestId('owner-state').innerText(), /Working\s*· done/);
  assert.doesNotMatch(JSON.stringify(data), /SYNTHETIC_SECRET|"port"|"token"/);
  await oracle.scrollIntoViewIfNeeded();
  const family=oracle.locator('../..');  // card › .ab-owner-wrap › family
  await family.locator('.is-child').nth(4).waitFor();
  assert.equal(await family.locator('.is-child').count(),5);
  await page.locator('.ab-owners__checked').waitFor({timeout:30000});
  await page.screenshot({path:path.join(shots,live?'fleet-mini-live-1440x900.png':'fleet-fixture-1440x900.png')});
  await family.locator('.is-child').last().scrollIntoViewIfNeeded();
  await page.screenshot({path:path.join(shots,live?'nested-mini-live-1440x900.png':'nested-mini-fixture-1440x900.png')});
  const astra=family.locator('.is-child .ab-owner').first();
  await astra.click();await page.getByTestId('owner-page').waitFor();
  assert.match(await page.getByTestId('owner-page').innerText(),/Astra|gpt-6-astra/);
  assert.match(await page.getByTestId('owner-page').innerText(),/Branch|Report path|Integration rules/);
  await page.locator('.ab-owner-page__locks summary').click();
  assert.ok(await page.getByRole('heading',{name:'Where it stands',exact:true}).count());
  assert.ok(await page.getByRole('heading',{name:'Findings',exact:true}).count());
  assert.equal(await page.getByText('Browser state is unavailable.',{exact:true}).count(),0);
  assert.equal(await page.getByText('The side nav could not be shown',{exact:true}).count(),0);
  await page.screenshot({path:path.join(shots,live?'astra-mini-live-1440x900.png':'owner-fixture-1440x900.png')});
  if(!live){
    assert.match(await page.getByTestId('owner-page').innerText(),/oracle-vps\/shared.ts/);
    assert.match(await page.getByTestId('owner-page').innerText(),/Manifest status[\s\S]*execution finished/);
    assert.match(await page.getByTestId('owner-page').innerText(),/Reported: blocked/);
    assert.match(await page.getByTestId('owner-page').innerText(),/delivery acceptance not established/);
    await page.getByRole('button',{name:'Back to Fleet'}).click();
    await page.getByTestId('panel-tab-subagents').click();
    writeFileSync(path.join(process.env.AB_OWNERS_DIR,'AB-RESEARCH.json'),JSON.stringify({...data.owners.find(o=>o.name==='AB-RESEARCH'),subtitle:'Fresh evidence just landed'}));
    await page.getByTestId('owner-AB-RESEARCH').getByText('Fresh evidence just landed').waitFor();
    // Overview's Team tile also opens the board even when the local crew is empty.
    await page.getByTestId('panel-tab-home').click();
    // Agent Zero's home (t-0440) shows its owners itself; the previous Overview, with this tile, is one click below.
    await page.getByTestId('zero-home').getByTestId('zh-owners').waitFor();
    await page.getByRole('button',{name:'Previous overview'}).click();
    await page.getByTestId('companion-overview').locator('.ac-summary-tile', {hasText:'Team'}).click();
    await page.getByTestId('owner-board').waitFor();
    await page.setViewportSize({width:390,height:844});
    await page.getByTestId('owner-board').waitFor();
    assert.ok(await page.getByTestId('owner-board').evaluate(el=>el.scrollWidth<=el.clientWidth+1), 'owner board overflow');
    await page.screenshot({path:path.join(shots,'fleet-fixture-390x844.png')});
    await page.getByTestId('owner-ORACLE-RESEARCH').click();
    await page.getByTestId('owner-page').waitFor();
    assert.match(await page.getByTestId('owner-page').innerText(), /Reported: building/);
    assert.match(await page.getByTestId('owner-page').getByTestId('owner-state').innerText(), /Idle\s*· building/);
    assert.ok(await page.getByTestId('owner-page').evaluate(el=>el.scrollWidth<=el.clientWidth+1), 'owner detail overflow');
    await page.screenshot({path:path.join(shots,'owner-fixture-390x844.png')});
    fixtureClock += 15_001; hostFail = true; await fixtureOwners.refreshHosts();
    await page.getByTestId('owner-page').getByText(/Runtime: idle · stale observation/).waitFor();
    await page.screenshot({path:path.join(shots,'stale-runtime-390x844.png')});
    disconnect = true; for(const stream of streams) stream.end();
    await page.getByText(/Owner updates disconnected/).waitFor();
    assert.match(await page.getByTestId('owner-page').innerText(), /Runtime: idle · stale observation/);
    assert.match(await page.getByTestId('owner-page').innerText(), /Reported: building/);
    await page.screenshot({path:path.join(shots,'disconnected-390x844.png')});
    disconnect = false; hostFail = false; fixtureClock += 15_001;
    // Fresh again: the stale line goes and the page's state word reads the runtime.
    await page.getByTestId('owner-page').getByText(/stale observation/).first().waitFor({state:'detached',timeout:20000});
    assert.match(await page.getByTestId('owner-page').getByTestId('owner-state').innerText(), /Idle\s*· building/);
    console.log('PASS owner truth UI: building+idle, done+working, Mini done+blocked, source ages, 390px overflow, cached stale fetch/SSE failure and reconnect');
    console.log('PASS UI: Fleet and empty Sub-agents entry points, picks first, stale badge, detail page, live file update');
  }
  assert.deepEqual(errors,[]);console.log(`PASS ${live?'LIVE':'fixture'} WebKit: ${data.owners.length} owners, 1440x900 Fleet/detail captures, no page errors, sockets blocked`);
} finally {await browser?.close();vite?.kill('SIGTERM');fixtureOwners?.close();for(const stream of streams) stream.destroy();server?.closeAllConnections();if(server)await new Promise(r=>server.close(r));}
