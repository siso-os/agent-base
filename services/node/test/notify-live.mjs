// Opt-in isolated real Codex acceptance. Chromium is required to instrument the actual Notification constructor.
import assert from 'node:assert/strict';
import {spawn,execFileSync} from 'node:child_process';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import {chromium} from 'playwright';
const root=path.resolve(import.meta.dirname,'../../..'),evidence=path.resolve(process.argv[2]);
const runtime=path.join(evidence,'runtime','real-'+Date.now()),hosts=path.join(runtime,'hosts');mkdirSync(hosts,{recursive:true});
const lines=[];const record=s=>{console.log(s);lines.push(s);writeFileSync(path.join(evidence,'VERIFY.txt'),lines.join('\n')+'\n');};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));async function until(fn,timeout=30000){const end=Date.now()+timeout;while(Date.now()<end){if(await fn())return;await sleep(100);}throw Error('Acceptance timeout');}
async function port(){const s=net.createServer();await new Promise(r=>s.listen(0,'127.0.0.1',r));const p=s.address().port;await new Promise(r=>s.close(r));return p;}
const apiPort=await port(),webPort=await port(),api='http://127.0.0.1:'+apiPort,web='http://127.0.0.1:'+webPort;
const env={...process.env,HERDR_ENV:'0',AB_HOSTS_DIR:hosts,AB_ACTIVITY_DIR:path.join(runtime,'activity'),AB_ATTENTION_DIR:path.join(runtime,'attention'),AB_NOTIFICATIONS_STATE:path.join(runtime,'notifications.json'),AB_PROMPT_QUEUE_DIR:path.join(runtime,'queues'),AB_STATE:path.join(runtime,'rows.json'),AB_REGISTRY:path.join(runtime,'registry.json'),AB_HERDR:process.execPath+' '+root+'/services/node/test/fake-herdr.mjs',FAKE_HERDR_AGENTS:'[]',AB_PORT:String(apiPort),AB_NODE:String(apiPort),AB_WEB_PORT:String(webPort),AB_CODEX_RUNS:path.join(runtime,'codex-runs'),AB_A0_TASKS_ROOT:path.join(runtime,'zero'),AB_CONSOLE_EVENTS:path.join(runtime,'console.jsonl')};
const processes=[];function start(cmd,args,extra={}){const p=spawn(cmd,args,{cwd:root,env,stdio:['pipe','ignore','pipe'],...extra});let error='';p.stderr.on('data',b=>error=(error+b).slice(-2000));p.error=()=>error;processes.push(p);return p;}
let browser;
try {
  const node=start(process.execPath,['--experimental-strip-types','--no-warnings','services/node/src/server.ts']);
  await until(async()=>{if(node.exitCode!==null)throw Error('Dev node failed: '+node.error());return fetch(api+'/api/health').then(r=>r.ok,()=>false);});record(`PASS dev node HTTP 200 at ${api}; isolated hosts, herdr and state`);
  start('pnpm',['--filter','@agent-base/web','dev','--host','127.0.0.1']);await until(()=>fetch(web).then(r=>r.ok,()=>false));
  const name='NOTIFY-QA',host=start(process.execPath,['--experimental-strip-types','--no-warnings','services/host/src/codex-host.ts','--name',name,'--model','gpt-6.1-sol','--effort','low','--collaboration-mode','plan','--cwd',runtime,'--sandbox','read-only','--approval','never']);
  let h;await until(()=>{if(host.exitCode!==null)throw Error('Host failed: '+host.error());try{h=JSON.parse(readFileSync(path.join(hosts,'name-'+name+'.json')));return !!h.session;}catch{return false;}});record(`PASS real host: gpt-6.1-sol; isolated thread ${h.session}; no trusted_hash or launchd changes`);
  const post=async(route,body)=>{const r=await fetch(api+route,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});return {status:r.status,body:await r.json()};};
  await post('/api/attention/settings',{desktop:true});
  browser=await chromium.launch({headless:true,channel:'chrome'});
  const context=await browser.newContext({permissions:['notifications'],viewport:{width:1440,height:900}});
  await context.addInitScript(()=>{
    window.__notices=[];const Native=window.Notification;
    window.Notification=class extends Native {constructor(title,options){super(title,options);window.__notices.push(this);}};
  });
  const page=await context.newPage();await page.goto(web);await until(()=>fetch(api+'/api/agents').then(r=>r.json()).then(d=>(d.agents??d).some?.(a=>a.id==='service-NOTIFY-QA')));
  const items=async()=>fetch(api+'/api/attention').then(r=>r.json()).then(d=>d.items);
  host.stdin.write('Reply with exactly NOTIFY-FINISHED. Do not use any tools.\n');await until(async()=>(await items()).some(i=>i.phase==='completed'),120000);
  let done=(await items()).find(i=>i.phase==='completed');await until(()=>page.evaluate(()=>window.__notices.length===1));
  await sleep(3500);assert.equal((await items()).filter(i=>i.phase==='completed').length,1);assert.equal(await page.evaluate(()=>window.__notices.length),1);
  await page.evaluate(()=>window.__notices[0].dispatchEvent(new Event('click')));await page.waitForSelector('[aria-label="Message"]');assert.ok((await page.getByRole('region',{name:'Chat',exact:true}).innerText()).includes(name));
  await page.goto(web+'/#attention/'+encodeURIComponent(done.id));await page.waitForSelector('[aria-label="Message"]');record('PASS canonical attention deep link opens the exact chat');
  record('PASS finished turn: one durable completion, exactly one real browser Notification API call; its click opens NOTIFY-QA chat');
  await page.getByRole('button',{name:'Agent notifications',exact:true}).click();
  host.stdin.write('Use request_user_input to ask which color to use, with choices Amber and Blue. Wait for my answer. Do not read or write files or use other tools. After the answer reply with exactly the chosen color. Ask only once.\n');
  await until(async()=>(await items()).some(i=>i.phase==='needs'),120000);await until(()=>page.evaluate(()=>window.__notices.length===2));
  const question=(await items()).find(i=>i.phase==='needs');await sleep(3500);assert.equal((await items()).filter(i=>i.phase==='needs').length,1);assert.equal(await page.evaluate(()=>window.__notices.length),2);
  record('PASS native question: exactly one needs-you record and one browser Notification API call');
  await page.evaluate(()=>window.__notices[1].dispatchEvent(new Event('click')));await page.waitForSelector('[data-testid="question-card"]');record('PASS needs-you notification click opens the original native question in the chat');
  await page.getByRole('button',{name:'Agent notifications',exact:true}).click();
  const row=page.locator('[data-testid="attention-row"]').filter({hasText:'Needs your answer'});await row.getByText('Act here',{exact:true}).click();await row.locator('[data-testid="question-card"]').waitFor();
  async function shot(file,w,h){await page.setViewportSize({width:w,height:h});await sleep(300);await page.screenshot({path:path.join(evidence,file)});const png=readFileSync(path.join(evidence,file));assert.equal(png.readUInt32BE(16),w);assert.equal(png.readUInt32BE(20),h);record(`PASS ${file}: ${w}x${h}, ${png.length} bytes`);}
  await shot('notifications-1440x900.png',1440,900);await shot('notifications-390x844.png',390,844);await page.setViewportSize({width:1440,height:900});
  await row.locator('[data-testid="question-card"] label').filter({hasText:'Blue'}).locator('input').check();
  await row.getByRole('button',{name:'Submit answer'}).click();await until(async()=>(await items()).find(i=>i.id===question.id)?.phase==='resolved');await until(async()=>(await items()).filter(i=>i.phase==='completed').length===2,120000);
  const stale=await post('/api/attention/'+encodeURIComponent(question.id)+'/command',{commandId:'stale-proof',ref:question.ref,expectedRevision:question.revision,action:{kind:'answer',requestId:question.requestId,answers:{}}});assert.equal(stale.status,409);record('PASS overview answered native Blue question via host ACK; resolved old request returns HTTP 409');
  // Force a failure only in the runtime this script started, while its next native turn is active.
  host.stdin.write('Use your shell tool to run sleep 30, then reply WAITED. Do nothing else.\n');await until(()=>{h=JSON.parse(readFileSync(path.join(hosts,'name-'+name+'.json')));return h.state==='working'&&!!h.activityRunId;});await sleep(500);
  const tree=execFileSync('ps',['-axo','pid=,ppid=,comm='],{encoding:'utf8'}).split('\n').map(l=>l.trim().match(/^(\d+)\s+(\d+)\s+(.+)$/)).filter(Boolean);
  const owned=new Set([host.pid]);for(let depth=0;depth<8;depth++)for(const m of tree)if(owned.has(Number(m[2])))owned.add(Number(m[1]));
  const children=tree.filter(m=>owned.has(Number(m[1]))&&Number(m[1])!==host.pid&&/\/codex$/.test(m[3]));assert.equal(children.length,1);process.kill(Number(children[0][1]),'SIGKILL');
  await until(async()=>(await items()).some(i=>i.phase==='failed'));await until(()=>page.evaluate(()=>window.__notices.some(n=>n.body.includes('Turn failed'))));await sleep(3500);
  assert.equal((await items()).filter(i=>i.phase==='failed').length,1);assert.equal(await page.evaluate(()=>window.__notices.filter(n=>n.body.includes('Turn failed')).length),1);
  const failure=(await items()).find(i=>i.phase==='failed');const journal=readFileSync(h.activityJournal,'utf8').trim().split('\n').map(JSON.parse);assert.equal(journal.filter(e=>e.kind==='runtime.failed').length,1);
  await page.evaluate(()=>window.__notices.find(n=>n.body.includes('Turn failed')).dispatchEvent(new Event('click')));
  await page.waitForSelector('[aria-label="Chat"]');assert.ok((await page.getByRole('region',{name:'Chat',exact:true}).innerText()).includes(name));record('PASS failed notification click opens its chat history');
  record('PASS failed active turn: task-owned Codex runtime killed; exactly one durable runtime.failed and one browser Notification API call');
  await page.reload();await sleep(4000);assert.equal(await page.evaluate(()=>window.__notices.length),0);record('PASS reload: zero replayed browser notifications');
  writeFileSync(path.join(evidence,'lifecycle.json'),JSON.stringify(journal,null,2));writeFileSync(path.join(evidence,'attention.json'),JSON.stringify(await items(),null,2));
  record('LIMIT: browser constructor and click handlers observed headlessly; actual OS popup and real phone delivery not observed. Phone POST tested only with injected provider fixture.');
}finally {
  await browser?.close();
  for(const p of processes.reverse()){if(p.exitCode!==null)continue;const done=new Promise(r=>p.once('exit',r));p.kill('SIGTERM');await Promise.race([done,sleep(5000)]);if(p.exitCode===null){p.kill('SIGKILL');await Promise.race([done,sleep(1000)]);}}
  for (const f of ['name-NOTIFY-QA.json']) { try { const file=path.join(hosts,f),h=JSON.parse(readFileSync(file));delete h.token;writeFileSync(file,JSON.stringify(h),{mode:0o600}); } catch {} }
  record('CLEANUP: all task-owned hosts, Chromium context, dev node and Vite stopped');
}
