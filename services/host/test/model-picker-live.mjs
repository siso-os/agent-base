// Opt-in real Codex proof, isolated host/node state, headless WebKit, owned processes only.
// heavy -- node services/host/test/model-picker-live.mjs jobs/ab-model-picker
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { WebSocket } from 'ws';
const root=path.resolve(import.meta.dirname,'../../..');
const evidence=path.resolve(process.argv[2]);
const runtime=path.join(evidence,'runtime',String(Date.now()));
const hosts=path.join(runtime,'hosts');mkdirSync(hosts,{recursive:true});
const name='MODEL-PICKER-QA', file=path.join(hosts,`name-${name}.json`);
const read=()=>JSON.parse(readFileSync(file));
const lines=[];const check=text=>{lines.push(text);console.log(text);writeFileSync(path.join(evidence,'LIVE-VERIFY.txt'),lines.join('\n')+'\n');};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn,ms=45000){const end=Date.now()+ms;while(Date.now()<end){if(await fn())return;await sleep(200);}throw Error('Timed out waiting for live proof');}
async function freePort(){const s=net.createServer();await new Promise(r=>s.listen(0,'127.0.0.1',r));const p=s.address().port;await new Promise(r=>s.close(r));return p;}
const port=await freePort(),webPort=await freePort(),api=`http://127.0.0.1:${port}`,web=`http://127.0.0.1:${webPort}`;
const env={...process.env,HERDR_ENV:'0',AB_HOSTS_DIR:hosts,AB_PROMPT_QUEUE_DIR:path.join(runtime,'queue'),AB_ACTIVITY_DIR:path.join(runtime,'activity')};
const processes=[];
function start(cmd,args,extra={}){const p=spawn(cmd,args,{cwd:root,env:{...env,...extra},stdio:['ignore','pipe','pipe']});let out='';p.stdout.on('data',d=>out=(out+d).slice(-4000));p.stderr.on('data',d=>out=(out+d).slice(-4000));p.output=()=>out;processes.push(p);return p;}
async function stop(p){if(!p||p.exitCode!==null)return;const done=new Promise(r=>p.once('exit',r));p.kill('SIGTERM');await done;}
const args=['--experimental-strip-types','--no-warnings','services/host/src/service-runner.ts','--harness','codex','--name',name,'--cwd',runtime,'--model','gpt-6.1-sol','--effort','medium','--sandbox','read-only','--approval','never'];
let runner,browser,page,ws,events=[];
async function connect(){ws?.close();events=[];const h=read();ws=new WebSocket(`ws://127.0.0.1:${h.port}/ws?token=${h.token}`);ws.on('message',b=>events.push(JSON.parse(b)));await until(()=>events.some(e=>e.t==='hello'));}
async function row(){return (await (await fetch(api+'/api/agents')).json()).agents.find(a=>a.id===`service-${name}`);}
async function openChat(){await page.goto(web);const row=page.locator(`[data-testid="rail-row"][aria-label^="${name}"]`);if(!await row.isVisible()){await page.getByText('SISO Labs',{exact:true}).click();await page.getByText('Picker QA',{exact:true}).click();}await row.click({timeout:15000});await page.locator(`[data-testid="chat-view"][data-agent-id="service-${name}"][data-connected="1"]`).waitFor({timeout:30000});}
async function openPicker(){const menu=page.getByTestId('model-menu');if(!await menu.isVisible())await page.getByTestId('model-chip').click();return menu;}
async function turn(expectedModel){const n=events.length;ws.send(JSON.stringify({t:'prompt',text:'Reply with exactly PICKER-OK. Do not use tools.'}));await until(()=>events.slice(n).some(e=>e.t==='result'),150000);assert.ok(!events.slice(n).some(e=>e.t==='error'),JSON.stringify(events.slice(n).filter(e=>e.t==='error')));assert.equal(read().model,expectedModel);check(`Real turn completed: ${read().model} effort=${read().effort} session=${read().session}`);}
function nativeContexts(session){const base=path.join(process.env.CODEX_HOME??path.join(process.env.HOME,'.codex'),'sessions');const walk=dir=>readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(path.join(dir,e.name)):e.name.includes(session)?[path.join(dir,e.name)]:[]);return walk(base).flatMap(f=>readFileSync(f,'utf8').trim().split('\n').map(l=>{try{return JSON.parse(l);}catch{return {};}})).filter(e=>e.type==='turn_context').map(e=>({model:e.payload.model,effort:e.payload.effort??e.payload.reasoning_effort}));}
try{
 runner=start(process.execPath,args);await until(()=>{if(runner.exitCode!==null)throw Error(runner.output());try{return read().models?.length>0;}catch{return false;}});await connect();
 assert.ok(read().models.some(m=>m.id==='gpt-6-astra'));check(`Account catalog: ${read().models.length} models including Astra; initial Sol / medium`);
 start(process.execPath,['--experimental-strip-types','--no-warnings','services/node/src/server.ts'],{AB_PORT:String(port),AB_STATE:path.join(runtime,'rows.json'),AB_REGISTRY:path.join(runtime,'registry.json'),AB_HERDR:`${process.execPath} ${root}/services/node/test/fake-herdr.mjs`,FAKE_HERDR_AGENTS:'[]',AB_CTX_DIR:path.join(runtime,'ctx'),AB_CONSOLE_EVENTS:path.join(runtime,'none.jsonl'),AB_RESURRECT_DIR:path.join(runtime,'none')});
 await until(()=>fetch(api+'/api/health').then(r=>r.ok,()=>false));
 const registered=await fetch(api+'/api/registry',{method:'POST',headers:{'content-type':'application/json',origin:api},body:JSON.stringify({op:'register',name,main:true,project:'Picker QA'})});assert.equal(registered.status,200);
 start('pnpm',['--filter','@agent-base/web','dev','--host','127.0.0.1'],{AB_NODE:String(port),AB_WEB_PORT:String(webPort)});await until(()=>fetch(web).then(r=>r.ok,()=>false));
 const {webkit}=await import('../../node/node_modules/playwright/index.mjs');browser=await webkit.launch({headless:true});page=await browser.newPage({viewport:{width:1440,height:1000}});await page.routeWebSocket(/\/term\//,s=>s.close());
 await until(async()=>!!await row());check('Isolated node reports the test soul with host HUD');await openChat();await page.locator('textarea').waitFor({timeout:30000});
 await openPicker();await page.getByRole('radio',{name:'max',exact:true}).click();await until(()=>read().effort==='max');await until(async()=>(await row())?.hud?.effort==='max');
 await until(async()=>await page.getByRole('radio',{name:'max',exact:true}).getAttribute('aria-checked')==='true');
 await page.keyboard.press('Escape');await turn('gpt-6.1-sol');
 // Leave this chat, then reload the app, reopening the same host.
 await page.goto(web+'/#at='+encodeURIComponent(JSON.stringify({s:'agents',v:{kind:'tab',id:'tasks'},a:null,o:null})));await page.reload();await openChat();
 await openPicker();await until(async()=>await page.getByRole('radio',{name:'max',exact:true}).getAttribute('aria-checked')==='true');check('WebKit: max remains selected after leaving the chat and reloading');
 await page.getByRole('menuitemradio',{name:'GPT-6-Astra',exact:true}).click();await until(()=>read().model==='gpt-6-astra');await turn('gpt-6-astra');
 const before=read();ws.close();process.kill(before.pid,'SIGTERM');await until(()=>read().pid!==before.pid&&read().child==='running');await connect();
 assert.equal(read().effort,'max');assert.equal(read().model,'gpt-6-astra');assert.equal(read().session,before.session);check(`Host restart: Astra / max kept on same thread; ${before.pid} -> ${read().pid}`);
 const beforeRunner=read();await stop(runner);runner=start(process.execPath,args);await until(()=>read().pid!==beforeRunner.pid&&read().child==='running');await connect();assert.equal(events[0].effort,'max');assert.equal(events[0].model,'gpt-6-astra');check('Runner restart with original --model Sol --effort medium: host hello still reports Astra / max');
 await page.reload();await openChat();await openPicker();
 await until(async()=>await page.getByRole('menuitemradio',{name:'GPT-6-Astra',exact:true}).getAttribute('aria-checked')==='true');await until(async()=>await page.getByRole('radio',{name:'max',exact:true}).getAttribute('aria-checked')==='true');
 assert.equal(await page.getByRole('menuitem',{name:'Codex Luna Codex · Luna'}).getByLabel('Current model').count(),0);
 await page.screenshot({path:path.join(evidence,'astra-max-restarted.png')});check('Screenshot: astra-max-restarted.png (1440x1000), Astra and max selected after both restarts');
 await page.getByRole('menuitemradio',{name:'GPT-6.1-Sol',exact:true}).click();await until(()=>read().model==='gpt-6.1-sol');const resume=page.getByRole('button',{name:'Resume',exact:true});if(await resume.isVisible())await resume.click();await turn('gpt-6.1-sol');assert.equal(read().effort,'max');
 const contexts=nativeContexts(read().session);assert.ok(contexts.some(c=>c.model==='gpt-6-astra'&&c.effort==='max'),JSON.stringify(contexts));assert.equal(contexts.at(-1).model,'gpt-6.1-sol');assert.equal(contexts.at(-1).effort,'max');check('Native Codex turn_context proof: '+JSON.stringify(contexts));
 check('PASS: real Sol -> Astra -> Sol, max retained through navigation/reload/host+runner restart; no real agents touched');
}catch(e){if(page)await page.screenshot({path:path.join(evidence,'failure.png')}).catch(()=>{});check('FAIL: '+e.message);throw e;}
finally{ws?.close();await browser?.close();for(const p of processes.reverse())await stop(p);check('Cleanup: headless browser and all owned host/node/Vite processes stopped');}
