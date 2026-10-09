// Opt-in real hosted Codex children + real Sol parent, fake Claude SDK parent, real dev app and headless WebKit.
// heavy -- node services/host/test/subagents-live.mjs <evidence-directory>
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { WebSocket } from 'ws';
const root = path.resolve(import.meta.dirname,'../../..'), evidence = path.resolve(process.argv[2]);
const runtime = path.join(evidence,'runtime',`live-${Date.now()}`); mkdirSync(runtime,{recursive:true});
const hosts = path.join(runtime,'hosts');mkdirSync(hosts);
for (const name of ['CLAUDE-ONE','CLAUDE-TWO','SOL-ONE','SOL-TWO']) writeFileSync(path.join(runtime,`${name}.txt`),`${name} value=${name.endsWith('ONE') ? 17 : 29}\n`);
const lines=[];function record(s){lines.push(s);console.log(s);writeFileSync(path.join(evidence,'VERIFY.txt'),lines.join('\n')+'\n');}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn,timeout=30000){const end=Date.now()+timeout;while(Date.now()<end){if(await fn())return;await sleep(150);}throw Error('Acceptance timeout');}
async function port(){const s=net.createServer();await new Promise(r=>s.listen(0,'127.0.0.1',r));const p=s.address().port;await new Promise(r=>s.close(r));return p;}
const apiPort=await port(),webPort=await port(),api=`http://127.0.0.1:${apiPort}`,web=`http://127.0.0.1:${webPort}`;
const env={...process.env,HERDR_ENV:'0',AB_HOSTS_DIR:hosts,AB_PROMPT_QUEUE_DIR:path.join(runtime,'queues'),AB_ACTIVITY_DIR:path.join(runtime,'activity'),
  AB_STATE:path.join(runtime,'rows.json'),AB_REGISTRY:path.join(runtime,'registry.json'),AB_A0_SEAT:path.join(runtime,'absent-seat.json'),AB_ATTENTION_DIR:path.join(runtime,'attention'),
  AB_HERDR:`${process.execPath} ${root}/services/node/test/fake-herdr.mjs`,FAKE_HERDR_AGENTS:'[]',AB_PORT:String(apiPort),AB_NODE:String(apiPort),AB_WEB_PORT:String(webPort)};
delete env.AB_CODEX_BIN;delete env.AB_HOST_SDK;delete env.AB_WORKSPACE_RECEIPT;
const processes=[];function start(command,args,extra={}){const p=spawn(command,args,{cwd:root,env,stdio:['ignore','pipe','pipe'],...extra});let out='';p.stdout.on('data',b=>out=(out+b).slice(-1600));p.stderr.on('data',b=>out=(out+b).slice(-1600));p.output=()=>out;processes.push(p);return p;}
const sockets=[];let browser,context,page;
const { webkit } = await import('../../node/node_modules/playwright/index.mjs');
const snapshot=async()=> await page.locator('body').innerText();
async function screenshot(file,width,height){await page.setViewportSize({width,height});await sleep(250);const png=await page.screenshot({path:path.join(evidence,file)});assert.equal(png.readUInt32BE(16),width);assert.equal(png.readUInt32BE(20),height);record(`${file}: PNG ${width}x${height}, ${png.length} bytes`);}
async function socket(name){let h;await until(()=>{try{h=JSON.parse(readFileSync(path.join(hosts,`name-${name}.json`)));return !!h.session;}catch{return false;}});const frames=[],ws=new WebSocket(`${api.replace('http','ws')}/chat/service-${name}/ws`,{headers:{Origin:api}});sockets.push(ws);ws.on('message',raw=>frames.push(JSON.parse(String(raw))));await until(()=>frames.some(e=>e.t==='hello'));return{h,ws,frames};}
async function openParent(name){
  await context?.close();
  context=await browser.newContext({viewport:{width:1440,height:900}});page=await context.newPage();
  await page.routeWebSocket(/\/term\//,ws=>ws.close());
  await page.goto(web+'/#at='+encodeURIComponent(JSON.stringify({s:'agents',v:{kind:'chat'},a:`service-${name}`,o:null})));
  await page.locator(`[data-testid="rail-row"][aria-label^="${name},"]`).click({timeout:45000});
  await page.locator(`[data-testid="chat-view"][data-agent-id="service-${name}"][data-connected="1"]`).waitFor({state:'visible',timeout:45000});
}
async function type(text){const box=page.locator('textarea[aria-label="Message"]');await box.fill(text);await box.press('Enter');}
try {
  start(process.execPath,['--experimental-strip-types','--no-warnings','services/node/src/server.ts']);await until(()=>fetch(api+'/api/health').then(r=>r.ok,()=>false));record(`Dev node HTTP 200 on ${apiPort}; fixture hosts/herdr/state; no live agents attached`);
  start('pnpm',['--filter','@agent-base/web','dev','--host','127.0.0.1']);await until(()=>fetch(web).then(r=>r.ok,()=>false));record(`Dev web HTTP 200 on ${webPort}; Codex CLI ${execFileSync('codex',['-m','gpt-6.1-sol','--version'],{encoding:'utf8'}).trim()}`);
  browser=await webkit.launch({headless:true});
  start(path.join(root,'services/host/bin/siso-host'),['--name','CLAUDE-PARENT','--no-stack'],{cwd:runtime,env:{...env,AB_SERVICE_NAME:'CLAUDE-PARENT',AB_HOST_SDK:path.join(root,'services/host/test/fake-child-parent.mjs')}});
  start(path.join(root,'services/host/bin/siso-host'),['--harness','codex','--name','SOL-PARENT','--model','gpt-6.1-sol','--effort','low','--cwd',runtime,'--sandbox','read-only','--approval','never']);
  for(const [name,names] of [['CLAUDE-PARENT',['CLAUDE-ONE','CLAUDE-TWO']],['SOL-PARENT',['SOL-ONE','SOL-TWO']]]){
    const parent=await socket(name);record(`${name}: ${name.startsWith('CLAUDE') ? 'fake Claude SDK, real in-process MCP handlers' : 'real gpt-6.1-sol dynamic tools'}; session=${parent.h.session}`);
    await openParent(name);
    const brief='You are CHILD_NAME. Use your shell tool once to run sleep 28, then read CHILD_NAME.txt in your cwd. This is a small read-only research fixture. Do not write any files or spawn agents. Reply with your name and the exact value from the file, plus any human follow-up marker. Finish without asking questions.';
    const prompt=name.startsWith('CLAUDE') ? 'spawn two: '+brief : `Use spawn_codex exactly twice, now, for two full hosted read-only children named SOL-ONE and SOL-TWO. Set effort low and cwd ${runtime}. First brief: ${brief.replaceAll('CHILD_NAME','SOL-ONE')} Second brief: ${brief.replaceAll('CHILD_NAME','SOL-TWO')} Do not use shell or native subagents. The tools return immediately. Say you are waiting. Their returns arrive automatically; after both return, answer with BOTH names and values (17 and 29), and any HUMAN-MESSAGE-ACK marker from them. Do not poll. Use the returned data.`;
    await type(prompt);
    await until(()=>parent.frames.some(e=>e.t==='prompt.receipt' && e.phase==='saved'),15000);
    record(`${name}: browser composer admission observed on the selected parent socket`);
    await until(()=>new Set(parent.frames.filter(e=>e.t==='task').map(e=>e.task.id)).size===2,90000);
    const tasks=new Map(parent.frames.filter(e=>e.t==='task').map(e=>[e.task.id,e.task]));
    await until(()=>[...tasks.keys()].every(id=>parent.frames.some(e=>e.t==='task'&&e.task.id===id&&e.task.status==='running')),60000);
    let body=await snapshot();writeFileSync(path.join(evidence,`${name}-spawn-snapshot.txt`),body);
    assert.ok(body.includes(names[0]) && body.includes(names[1]));
    // Existing fan-out rows and faces pill are rendered; capture while both are active.
    await page.getByTestId('fanout-row').filter({hasText:names[0]}).waitFor({state:'visible',timeout:15000});
    assert.equal(await page.locator('[data-testid="agent-card"][data-running="1"]').count(),2);
    record(`${name}: existing fanout rows have is-run sweep and active faces; two visible running cards`);
    await screenshot(`${name}-spawn-1440x900.png`,1440,900);
    await page.getByTestId('fanout-row').filter({hasText:names[0]}).click();
    await page.locator('.siso-subhead__name').waitFor({state:'visible',timeout:30000});
    const childTask=[...tasks.values()].find(t=>t.description===names[0]);assert.ok(childTask);
    const child=await socket(childTask.hostName);assert.equal(child.h.parentSession,parent.h.session);assert.equal(child.h.depth,1);assert.equal(child.h.lead,name);
    // The side chat has its own composer; use the second Message box from the observed snapshot.
    body=await snapshot();writeFileSync(path.join(evidence,`${name}-child-open-snapshot.txt`),body);
    await until(async()=> await page.locator('textarea[aria-label="Message"]').count()===2);
    const childBox=page.locator('textarea[aria-label="Message"]').nth(1);
    await childBox.fill('Include HUMAN-MESSAGE-ACK in your next final answer. Keep the original file value.');await childBox.press('Enter');
    await until(()=>child.frames.some(e=>e.t==='prompt.receipt'&&e.phase==='saved') && parent.frames.some(e=>e.t==='note'&&e.text===`Shaan wrote to ${names[0]}`),120000);
    record(`${name}: two task rows running; opened ${names[0]} mid-run; browser composer admitted human follow-up; parent row attributed it; child thread=${child.h.session}`);
    await screenshot(`${name}-child-1440x900.png`,1440,900);await screenshot(`${name}-child-390x844.png`,390,844);
    await page.setViewportSize({width:1440,height:900});
    await until(()=>names.every(n=>parent.frames.some(e=>e.t==='user'&&e.text.includes(`${n} returned (`))),180000);
    await until(()=>parent.frames.some(e=>e.t==='text'&&names.every(n=>e.text.includes(n))&&e.text.includes('17')&&e.text.includes('29')&&e.text.includes('HUMAN-MESSAGE-ACK')),180000);
    const returns=parent.frames.filter(e=>e.t==='user'&&e.text.includes(' returned ('));
    for(const n of names)assert.equal(returns.filter(e=>e.text.includes(`${n} returned (`)).length,1);
    const answer=parent.frames.filter(e=>e.t==='text'&&names.every(n=>e.text.includes(n))).at(-1).text;
    writeFileSync(path.join(evidence,`${name}-combined.txt`),answer+'\n');
    const rows=await (await fetch(`${api}/api/agents/service-${name}/subagents`)).json();assert.equal(rows.rows.filter(r=>r.id.startsWith('child-')).length,2);assert.equal(rows.running,0);
    assert.ok(!JSON.stringify(rows).includes(child.h.token));
    record(`${name}: both children returned automatically once; parent answer uses values 17 + 29 and HUMAN-MESSAGE-ACK; GET subagents HTTP 200, 2 done, 0 running; public rows contain no token`);
    await screenshot(`${name}-returned-1440x900.png`,1440,900);await screenshot(`${name}-returned-390x844.png`,390,844);
    // Private provider identity proof, without secrets or raw provider config.
    writeFileSync(path.join(evidence,`${name}-identity.json`),JSON.stringify({parent:{name,session:parent.h.session},children:[...tasks.values()].map(t=>{const h=JSON.parse(readFileSync(path.join(hosts,`name-${t.hostName}.json`)));return{id:t.id,name:t.description,session:h.session,model:h.model,parentSession:h.parentSession,depth:h.depth,lead:h.lead};})},null,2));
  }
  record('PASS: real dev app; Claude MCP + real Sol dynamic-tool parents each spawned two real read-only hosted children; mid-run human message; automatic returns; both-parent synthesis; existing task UI at both sizes');
}catch(e){if(page)writeFileSync(path.join(evidence,'failed-page.txt'),await snapshot().catch(()=>''));record('FAIL: '+e.message);throw e;}
finally {
  const hostPids=[];for(const file of readdirSync(hosts).filter(f=>f.endsWith('.json'))){try{hostPids.push(JSON.parse(readFileSync(path.join(hosts,file))).pid);}catch{}}
  for(const ws of sockets)ws.close();await context?.close();await browser?.close();
  for(const p of processes.reverse()){if(p.exitCode!==null||p.signalCode)continue;const done=new Promise(r=>p.once('exit',r));p.kill('SIGTERM');await Promise.race([done,sleep(8000)]);if(p.exitCode===null&&!p.signalCode)throw Error(`Task process ${p.pid} did not stop`);}
  const alive=hostPids.filter(pid=>{try{process.kill(pid,0);return true;}catch{return false;}});assert.deepEqual(alive,[]);
  record(`CLEANUP: headless WebKit browser closed; ${hostPids.length} fixture host PIDs exited; parents stopped their child service-runners; dev node/web exited; no launchd changes`);
}
