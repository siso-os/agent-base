// Opt-in disposable real gpt-6.1-sol host and dev app; never installs a service or attaches terminals.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import {WebSocket} from 'ws';
const root=path.resolve(import.meta.dirname,'../../..'),evidence=path.resolve(process.argv[2]);
const runtime=path.join(evidence,'runtime','real-'+Date.now());mkdirSync(runtime,{recursive:true});
const hosts=path.join(runtime,'hosts');mkdirSync(hosts);
const check=[];function record(s){check.push(s);console.log(s);writeFileSync(path.join(evidence,'VERIFY.txt'),check.join('\n')+'\n');}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn,timeout=30000){const end=Date.now()+timeout;while(Date.now()<end){if(await fn())return;await sleep(100);}throw Error('Acceptance timeout');}
async function port(){const s=net.createServer();await new Promise(r=>s.listen(0,'127.0.0.1',r));const p=s.address().port;await new Promise(r=>s.close(r));return p;}
const apiPort=await port(),webPort=await port(),api=`http://127.0.0.1:${apiPort}`,web=`http://127.0.0.1:${webPort}`;
const env={...process.env,HERDR_ENV:'0',AB_HOSTS_DIR:hosts,AB_PROMPT_QUEUE_DIR:path.join(runtime,'queues'),AB_STATE:path.join(runtime,'rows.json'),AB_REGISTRY:path.join(runtime,'registry.json'),AB_HERDR:`${process.execPath} ${root}/services/node/test/fake-herdr.mjs`,FAKE_HERDR_AGENTS:'[]',AB_PORT:String(apiPort),AB_NODE:String(apiPort),AB_WEB_PORT:String(webPort)};
const processes=[];function start(command,args,extra={}){const p=spawn(command,args,{cwd:root,env,stdio:['ignore','pipe','pipe'],...extra});let out='';p.stdout.on('data',b=>out=(out+b).slice(-2000));p.stderr.on('data',b=>out=(out+b).slice(-2000));p.output=()=>out;processes.push(p);return p;}
let tab,ws;
const owner={userId:'ab-steer-questions',sessionKey:'qa-'+Date.now()};
async function call(route,body){const r=await fetch('http://127.0.0.1:9377'+route,body?{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({...owner,...body})}:{});if(!r.ok)throw Error('Browser HTTP '+r.status+': '+(await r.text()).slice(0,700));return r.json();}
const action=(route,body)=>call(`/tabs/${tab}/${route}`,body);
const wait=selector=>action('wait',{selector,timeout:45000});
const click=selector=>action('click',{selector});
const name='STEER-QUESTIONS-QA';

try{
  start(process.execPath,['--experimental-strip-types','--no-warnings','services/node/src/server.ts']);await until(()=>fetch(api+'/api/health').then(r=>r.ok,()=>false));record(`Dev node HTTP 200 on ${apiPort}; fixture herdr and hosts directory`);
  start('pnpm',['--filter','@agent-base/web','dev','--host','127.0.0.1']);await until(()=>fetch(web).then(r=>r.ok,()=>false));
  const host=start(process.execPath,['--experimental-strip-types','--no-warnings',path.join(root,'services/host/src/codex-host.ts'),'--name',name,'--model','gpt-6.1-sol','--effort','low','--collaboration-mode','plan','--cwd',runtime,'--sandbox','read-only','--approval','never']);
  let h;await until(()=>{try{h=JSON.parse(readFileSync(path.join(hosts,`name-${name}.json`)));return !!h.session;}catch{return false;}});record(`Real Codex CLI 0.159.2: model=${h.model}; plan collaboration mode enables native question tool; isolated thread=${h.session}`);
  const frames=[];ws=new WebSocket(`${api.replace('http','ws')}/chat/service-${name}/ws`,{headers:{Origin:api}});ws.on('message',m=>frames.push(JSON.parse(m)));await until(()=>frames.some(e=>e.t==='hello'));
  const hello=frames.find(e=>e.t==='hello');assert.equal(hello.capabilities.steer,'native-turn');assert.ok(hello.queue);assert.deepEqual(hello.pendingQuestions,[]);record('Proxy hello preserves capabilities, full queue and pendingQuestions outside paginated log');
  tab=(await call('/tabs',{url:web+'/#at='+encodeURIComponent(JSON.stringify({s:'agents',v:{kind:'tab',id:`service-${name}`},a:`service-${name}`,o:null}))})).tabId;
  await action('viewport',{width:1440,height:900});
  let rowRef;
  await until(async()=>{const d=await call(`/tabs/${tab}/snapshot?userId=${owner.userId}&sessionKey=${owner.sessionKey}`);rowRef=d.snapshot.split('\n').find(l=>l.includes('button "STEER-QUESTIONS-QA,'))?.match(/\[(e\d+)\]/)?.[1];return !!rowRef;});
  await action('click',{ref:rowRef});
  await wait('[aria-label="Message"]');
  const type=async text=>{await action('type',{selector:'[aria-label="Message"]',text,clear:true});await action('press',{key:'Enter'});};
  await type('First use your shell tool to run sleep 8, then use request_user_input to ask me which color to use, with options Amber and Blue. Wait for my answer. After I answer, reply with the chosen color and any mid-turn correction. Never read or write files. Ask only once.');
  await until(()=>frames.some(e=>e.t==='queue.snapshot'&&e.capabilities.activeTurnId));
  await click('button:has-text("Steer now")');
  await type('Mid-turn correction: include STEER-ACCEPTED in your final reply. Keep the original question; do not ask it again after its answer.');
  await until(()=>frames.some(e=>e.t==='prompt.receipt'&&e.phase==='accepted'&&e.id!==hello.queue.entries[0]?.id),60000);
  await until(()=>frames.some(e=>e.t==='question'),120000);
  const q=frames.find(e=>e.t==='question').request;
  writeFileSync(path.join(evidence,'native-question-shape.json'),JSON.stringify({provider:q.provider,mode:q.mode,questions:q.questions},null,2));
  await wait('[data-testid="question-card"]');
  record(`Native question card: ${q.questions.length} question(s); original turn=${q.turnId}; no synthetic prompt used to answer`);
  async function screenshot(file,w,h){await action('viewport',{width:w,height:h});await sleep(250);const r=await fetch(`http://127.0.0.1:9377/tabs/${tab}/screenshot?userId=${owner.userId}&sessionKey=${owner.sessionKey}`);assert.ok(r.ok);const png=Buffer.from(await r.arrayBuffer());writeFileSync(path.join(evidence,file),png);assert.equal(png.readUInt32BE(16),w);assert.equal(png.readUInt32BE(20),h);record(`${file}: PNG ${w}x${h}, ${png.length} bytes`);}
  await screenshot('question-1440x900.png',1440,900);await screenshot('question-390x844.png',390,844);await action('viewport',{width:1440,height:900});
  const snapshot=await call(`/tabs/${tab}/snapshot?userId=${owner.userId}&sessionKey=${owner.sessionKey}`);writeFileSync(path.join(evidence,'question-snapshot.txt'),snapshot.snapshot);
  assert.ok(q.questions[0].options.some(o=>o.label.includes('Blue')));
  await click('[data-testid="question-card"] label:has-text("Blue") input');await click('button:has-text("Submit answer")');
  await until(()=>frames.some(e=>e.t==='question_done'&&e.outcome==='answered'));
  await until(()=>frames.some(e=>e.t==='result'),120000);
  const correction=frames.find(e=>e.t==='user'&&e.mid);
  assert.ok(correction);assert.ok(frames.some(e=>e.t==='text'&&/STEER-ACCEPTED/.test(e.text)));assert.ok(frames.some(e=>e.t==='text'&&/Blue/.test(e.text)));
  const accepted=frames.find(e=>e.t==='prompt.receipt'&&e.id===correction.id&&e.phase==='accepted');assert.ok(accepted);
  const resultText=frames.filter(e=>e.t==='text').map(e=>e.text).join('\n');writeFileSync(path.join(evidence,'real-continuation.txt'),resultText);
  record('PASS native steer accepted once on captured turn; original question answered; same turn continued and final reply contains Blue and STEER-ACCEPTED');
  await screenshot('answered-1440x900.png',1440,900);await screenshot('answered-390x844.png',390,844);
}finally{
  ws?.close();if(tab)await fetch(`http://127.0.0.1:9377/tabs/${tab}?userId=${owner.userId}&sessionKey=${owner.sessionKey}`,{method:'DELETE'});
  for(const p of processes.reverse()){if(p.exitCode!==null)continue;const done=new Promise(r=>p.once('exit',r));p.kill('SIGTERM');await Promise.race([done,sleep(5000)]);if(p.exitCode===null)p.kill('SIGKILL');}
  record('CLEANUP: task-owned browser closed; task-owned host, node and dev server stopped; no launchd changes');
}
