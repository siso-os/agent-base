// Opt-in real Codex proof through the actual composer, isolated node, and headless WebKit.
// Usage: heavy -- node services/host/test/steer-default-live.mjs .lab-ab-steer-default
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { WebSocket } from 'ws';
const root=path.resolve(import.meta.dirname,'../../..');
if (!process.argv[2]) throw Error('An evidence directory is required');
const legacy=process.env.STEER_DEFAULT_LEGACY === '1';
const evidence=path.resolve(process.argv[2]), runtime=path.join(evidence,'runtime-'+Date.now());
mkdirSync(runtime,{recursive:true});
const hosts=path.join(runtime,'hosts');mkdirSync(hosts);
const { webkit }=createRequire(path.join(root,'services/node/package.json'))('playwright');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn,timeout=45000){const end=Date.now()+timeout;while(Date.now()<end){if(await fn())return;await sleep(100);}throw Error('Acceptance timeout');}
async function port(){const s=net.createServer();await new Promise(r=>s.listen(0,'127.0.0.1',r));const p=s.address().port;await new Promise(r=>s.close(r));return p;}
const apiPort=await port(),api=`http://127.0.0.1:${apiPort}`;
const env={...process.env,HERDR_ENV:'0',AB_HOSTS_DIR:hosts,AB_PROMPT_QUEUE_DIR:path.join(runtime,'queues'),AB_ACTIVITY_DIR:path.join(runtime,'activity'),AB_WEB_DIST:path.join(root,'apps/web/dist'),AB_BROWSER_STATE:path.join(runtime,'browser.json'),AB_STATE:path.join(runtime,'rows.json'),AB_REGISTRY:path.join(runtime,'registry.json'),AB_HERDR:`${process.execPath} ${root}/services/node/test/fake-herdr.mjs`,FAKE_HERDR_AGENTS:'[]',AB_PORT:String(apiPort)};
const processes=[],lines=[];
function record(s){lines.push(s);console.log(s);writeFileSync(path.join(evidence,'VERIFY.txt'),lines.join('\n')+'\n');}
function start(cmd,args){const p=spawn(cmd,args,{cwd:root,env,stdio:['ignore','pipe','pipe']});let out='';p.stdout.on('data',b=>out=(out+b).slice(-4000));p.stderr.on('data',b=>out=(out+b).slice(-4000));p.output=()=>out;processes.push(p);return p;}
let browser,ws,page;
try {
  start(process.execPath,['--experimental-strip-types','--no-warnings','services/node/src/server.ts']);
  await until(()=>fetch(api+'/api/health').then(r=>r.ok,()=>false));
  assert.ok((await fetch(api)).ok, 'Node serves the checked web build');
  const name='STEER-DEFAULT-QA-'+Date.now();
  start(process.execPath,['--experimental-strip-types','--no-warnings','services/host/src/codex-host.ts','--name',name,'--model','gpt-6.1-sol','--effort','low','--cwd',runtime,'--sandbox','read-only','--approval','never']);
  let host;await until(()=>{try{host=JSON.parse(readFileSync(path.join(hosts,`name-${name}.json`)));return !!host.session;}catch{return false;}});
  const frames=[];ws=new WebSocket(`${api.replace('http','ws')}/chat/service-${name}/ws`,{headers:{Origin:api}});
  ws.on('message',m=>frames.push(JSON.parse(m)));await until(()=>frames.some(e=>e.t==='hello'));
  browser=await webkit.launch({headless:true});
  page=await browser.newPage({viewport:{width:1440,height:900}});
  if (legacy) await page.routeWebSocket('**/chat/**/ws', client => {
    const upstream=client.connectToServer();
    upstream.onMessage(message=>{
      const e=JSON.parse(String(message));if(e.capabilities)delete e.capabilities.auto;
      client.send(JSON.stringify(e));
    });
  });
  await page.addInitScript(id=>{localStorage.setItem('agent-base:active',JSON.stringify(id));localStorage.setItem('agent-base:open',JSON.stringify([id]));localStorage.setItem('agent-base:space',JSON.stringify('agents'));localStorage.setItem('agent-base:view',JSON.stringify({kind:'chat'}));},`service-${name}`);
  writeFileSync(path.join(evidence,'fixture-agents.json'),JSON.stringify(await (await fetch(api+'/api/agents')).json(),null,2));
  await page.goto(api+'/#at='+encodeURIComponent(JSON.stringify({s:'agents',v:{kind:'chat'},a:`service-${name}`,o:null})));
  // Select only the isolated host via the app's persisted selection; unnamed fixture owners need no sidebar registration.
  const composer=page.getByRole('textbox',{name:'Message',exact:true});await composer.waitFor();
  const send=async text=>{await composer.fill(text);await composer.press('Enter');};
  await send('Use your shell tool to run sleep 15. Do not read or write any files. After the sleep, follow any correction received during the sleep. If no correction arrives reply ORIGINAL.');
  await until(()=>frames.some(e=>e.t==='tool'&&e.name==='Bash') || frames.some(e=>e.t==='tool'));
  const target=frames.filter(e=>e.t==='queue.snapshot').at(-1).capabilities.activeTurnId;
  assert.ok(target);assert.ok(!frames.some(e=>e.t==='result'));
  assert.equal(await page.getByRole('button',{name:'Do this next',exact:true}).count(),0);
  assert.equal(await page.getByRole('button',{name:'Steer now',exact:true}).count(),0);
  const correction='Mid-turn correction: reply exactly STEER-DEFAULT-ACCEPTED when the sleep finishes.';
  await send(correction);
  await until(()=>frames.some(e=>e.t==='user'&&e.text===correction&&e.mid));
  const user=frames.find(e=>e.t==='user'&&e.text===correction&&e.mid);
  const entry=frames.filter(e=>e.t==='queue.snapshot').at(-1).snapshot.entries.find(e=>e.id===user.id);
  assert.equal(entry.providerTurnId,target);assert.equal(entry.phase,'accepted');assert.equal(entry.mode,legacy?'steer':'auto');
  assert.ok(!frames.some(e=>e.t==='result'));assert.equal(frames.filter(e=>e.t==='user'&&e.id===user.id).length,1);
  await until(async()=>await page.getByTestId('queued-row').count()===0);
  await sleep(400);await page.screenshot({path:path.join(evidence,'sent-mid-turn-1440.png')});
  record(`PASS composer Enter: ${legacy?'legacy native steer':'auto'} accepted on original turn ${target}; no result yet; zero queued rows; one user event`);
  await until(()=>frames.some(e=>e.t==='result'),150000);
  const final=frames.filter(e=>e.t==='text').at(-1)?.text;
  assert.equal(final?.trim(),'STEER-DEFAULT-ACCEPTED');
  const roots=frames.filter(e=>e.t==='user'&&!e.mid);assert.equal(roots.length,1);
  assert.equal(frames.filter(e=>e.t==='result').length,1);
  writeFileSync(path.join(evidence,'real-continuation.txt'),final+'\n');
  writeFileSync(path.join(evidence,'receipt.json'),JSON.stringify({session:host.session,originalTurn:target,entry,results:1,rootPrompts:roots.length},null,2));
  await page.screenshot({path:path.join(evidence,'answered-1440.png')});
  record('PASS real Codex: one root turn, one result, final reply STEER-DEFAULT-ACCEPTED; screenshot captured in headless WebKit');
  await page.setViewportSize({width:390,height:844});await page.screenshot({path:path.join(evidence,'answered-390.png')});
  record(`HTTP 200 fixture node and built web ${apiPort}; isolated hosts and fake herdr; no real chat touched`);
} catch(e) {
  if(page){await page.screenshot({path:path.join(evidence,'failure.png')}).catch(()=>{});writeFileSync(path.join(evidence,'failure-dom.txt'),await page.locator('body').innerText().catch(()=>''));}
  for(let i=0;i<processes.length;i++)writeFileSync(path.join(evidence,`process-${i}.log`),processes[i].output());
  throw e;
} finally {
  ws?.close();await browser?.close();
  for(const p of processes.reverse()){if(p.exitCode!==null)continue;const done=new Promise(r=>p.once('exit',r));p.kill('SIGTERM');await Promise.race([done,sleep(5000)]);if(p.exitCode===null){p.kill('SIGKILL');await done;}}
  record('CLEANUP: WebKit closed; task-owned host, node and web processes stopped; no services installed or live agents restarted');
}
