// Focused controller/runtime contracts; disposable private hosts directory, no launchd or live seats.
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { WebSocket } from 'ws';
const fixture = mkdtempSync(path.join(tmpdir(), '.siso-ephemeral-ab-subagents-'));
process.env.AB_HOSTS_DIR = path.join(fixture,'hosts');
process.env.AB_PROMPT_QUEUE_DIR = path.join(fixture,'queues');
process.env.AB_CODEX_BIN = fileURLToPath(new URL('./fake-child-codex.mjs',import.meta.url));
process.env.AB_ACTIVITY_DIR = path.join(fixture,'activity');
process.env.AB_WORKSPACES_DIR = path.join(fixture,'workspaces');
process.env.AB_WORKTREE_ROOT = path.join(fixture,'copies');
const { CodexChildren, dynamicChildTools } = await import('../src/codex-children.ts');
const returned = [], tasks = new Map(), events = [];
const owner = { name: 'PARENT', session: () => 'fixture-parent', task: t => tasks.set(t.id,t), emit: e => events.push(e), returned: async command => { returned.push({text:command.text,key:command.key}); return {t:'prompt.receipt',key:command.key,id:command.messageId,phase:'saved',queueRevision:returned.length}; } };
const children = new CodexChildren(owner), foreign = new CodexChildren({...owner,name:'FOREIGN',session:()=> 'foreign-parent'});
const wait = ms => new Promise(r=>setTimeout(r,ms));
async function until(fn) { for(let n=0;n<100;n++) { if(await fn()) return; await wait(100); } throw Error('Fixture wait timed out'); }
const sockets=[];let parentRuntime;
async function connect(child) {
  await until(()=>tasks.get(child.id)?.status==='running');
  const host = JSON.parse(readFileSync(path.join(process.env.AB_HOSTS_DIR,`name-${tasks.get(child.id).hostName}.json`)));
  const ws = new WebSocket(`ws://127.0.0.1:${host.port}/ws?token=${host.token}`);sockets.push(ws);
  const frames=[];ws.on('message',raw=>frames.push(JSON.parse(String(raw))));await until(()=>frames.some(m=>m.t==='hello'));
  return {host,ws,frames};
}
try {
  const parentMeasurementReceipt=path.join(fixture,'parent-measurement-receipt.json');writeFileSync(parentMeasurementReceipt,JSON.stringify({runId:'parent-only-marker'}),{mode:0o600});
  process.env.AB_WRITER_MEASUREMENT_RECEIPT=parentMeasurementReceipt;
  await assert.rejects(()=>children.call('spawn_codex',{name:'BAD',brief:'invalid',defer_install:true}),/worktree:true/);
  await assert.rejects(()=>children.call('spawn_codex',{name:'BAD',brief:'invalid',worktree:true,defer_install:'yes'}),/Invalid deferred/);
  await assert.rejects(()=>children.call('spawn_codex',{name:'BAD',brief:'invalid',task_id:123}),/Invalid task_id/);
  process.env.AB_TASK_ID='parent-task-must-not-leak'; process.env.AB_WORKSPACE_ID='parent-workspace-must-not-leak';
  const one=await children.call('spawn_codex',{name:'ONE',brief:'marker-one hold',task_id:'task-explicit'});
  const two=await children.call('spawn_codex',{name:'TWO',brief:'marker-two hold'});
  assert.equal(one.state,'starting');assert.equal(two.state,'starting');
  const a=await connect(one),b=await connect(two);
  assert.equal(b.host.taskId,undefined); assert.equal(b.host.workspaceId,undefined);
  delete process.env.AB_TASK_ID; delete process.env.AB_WORKSPACE_ID;
  assert.equal(process.env.AB_WRITER_MEASUREMENT_RECEIPT,parentMeasurementReceipt,'the parent retains its measurement binding');
  assert.equal(readFileSync(parentMeasurementReceipt,'utf8'),JSON.stringify({runId:'parent-only-marker'}),'children do not alter parent measurement state');
  delete process.env.AB_WRITER_MEASUREMENT_RECEIPT;
  const ordinary=await children.call('spawn_codex',{name:'ORDINARY',brief:'normal child without receipt'});const ordinaryHost=await connect(ordinary);assert.equal(ordinary.state,'starting');assert.ok(ordinaryHost.host.session,'ordinary child path remains unchanged');
  assert.equal(a.host.parentSession,'fixture-parent');assert.equal(a.host.childId,one.id);
  await until(()=>{try{return JSON.parse(readFileSync(path.join(process.env.AB_HOSTS_DIR,`name-${a.host.name}.json`))).taskId==='task-explicit';}catch{return false;}});
  assert.equal(JSON.parse(readFileSync(path.join(process.env.AB_HOSTS_DIR,`name-${a.host.name}.json`))).taskId,'task-explicit');assert.equal((await children.call('codex_status',{id:one.id})).taskId,'task-explicit');
  assert.equal(a.host.depth,1);assert.equal(a.host.lead,'PARENT');
  await assert.rejects(()=>foreign.call('message_codex',{id:one.id,text:'forged'}),/not owned/);
  await assert.rejects(()=>children.call('message_codex',{id:one.id,text:'x'.repeat(33000)}),/Invalid text/);
  process.env.AB_CHILD_ID=one.id;
  assert.deepEqual(dynamicChildTools(),[]);await assert.rejects(()=>children.call('spawn_codex',{name:'GRANDCHILD',brief:'no'}),/unavailable/);
  delete process.env.AB_CHILD_ID;
  // Human writes directly to hosted child, while it works; parent receives attribution.
  const key=randomUUID();a.ws.send(JSON.stringify({t:'prompt',key,messageId:key,text:'human follow-up',images:[],delivery:'next'}));
  await until(()=>a.frames.some(m=>m.t==='prompt.receipt'&&m.key===key&&m.phase==='saved'));
  const stop=await children.call('stop_codex',{id:two.id});assert.equal(stop.outcome,'stop_requested');
  await until(()=>tasks.get(two.id).status==='stopped');
  // Controller state and the observer socket arrive on independent channels. Observe both before asserting.
  await until(()=>b.frames.some(m=>m.t==='note'&&m.text==='Turn interrupted'));
  assert.equal(tasks.get(one.id).status,'running');assert.ok(b.frames.some(m=>m.t==='note'&&m.text==='Turn interrupted'));
  await until(()=>returned.some(r=>r.text.includes('human follow-up')));
  assert.ok(returned.find(r=>r.text.includes('human follow-up')).text.includes('Remembered marker-one hold'));
  assert.ok(events.some(e=>e.t==='note'&&e.text==='Shaan wrote to ONE'));
  assert.equal(returned.filter(r=>r.text.includes('ONE returned')).length,1);
  await children.call('message_codex',{id:one.id,text:'continue same child'});
  await until(()=>returned.some(r=>r.text.includes('continue same child')));
  assert.equal((await children.call('codex_status',{id:one.id})).state,'done');
  assert.equal((await children.call('codex_status',{id:one.id})).tokens,86,'provider cumulative tokens survive follow-up turns');
  assert.equal(JSON.parse(readFileSync(path.join(process.env.AB_HOSTS_DIR,`name-${a.host.name}.json`))).session,a.host.session);
  assert.equal((await children.call('stop_codex',{id:one.id})).outcome,'already_finished');
  await children.call('message_codex',{id:two.id,text:'fresh follow-up after stop'});
  await until(()=>returned.some(r=>r.text.includes('fresh follow-up after stop')));
  assert.equal(JSON.parse(readFileSync(path.join(process.env.AB_HOSTS_DIR,`name-${b.host.name}.json`))).session,b.host.session);
  const repo=path.join(fixture,'repo');mkdirSync(path.join(repo,'.agents'),{recursive:true});
  writeFileSync(path.join(repo,'.agents/workspace.json'),JSON.stringify({version:1,fetch:false,setup:[],copyFiles:[],submodules:'none'}));
  const git=args=>execFileSync('git',['-C',repo,...args],{stdio:'ignore'});
  git(['init','-b','dev']);git(['add','.agents/workspace.json']);git(['-c','user.name=Fixture','-c','user.email=fixture@example.invalid','-c','commit.gpgsign=false','commit','-m','Fixture']);
  const copy=await children.call('spawn_codex',{name:'COPY',brief:'isolated copy',cwd:repo,worktree:true,task_id:'task-copy'});
  const copyHost=await connect(copy);assert.notEqual(copyHost.host.cwd,repo);await until(()=>{try{return !!JSON.parse(readFileSync(path.join(process.env.AB_HOSTS_DIR,`name-${copyHost.host.name}.json`))).workspaceId;}catch{return false;}});copyHost.host=JSON.parse(readFileSync(path.join(process.env.AB_HOSTS_DIR,`name-${copyHost.host.name}.json`)));assert.ok(copyHost.host.workspaceId);
  const receipt=JSON.parse(readFileSync(path.join(process.env.AB_WORKSPACES_DIR,`${copyHost.host.workspaceId}.json`)));
  assert.equal(receipt.input.taskId,'task-copy');assert.equal(copyHost.host.taskId,'task-copy');
  assert.equal(receipt.phase,'active');assert.equal(receipt.agent.session,copyHost.host.session);assert.equal(receipt.stages.find(s=>s.id==='agent').status,'done');
  await until(()=>returned.some(r=>r.text.includes('COPY returned')));
  const sourceOnly=path.join(fixture,'source-only');mkdirSync(sourceOnly);
  writeFileSync(path.join(sourceOnly,'pnpm-lock.yaml'),'lockfileVersion: 9\n');
  const sourceGit=args=>execFileSync('git',['-C',sourceOnly,...args],{stdio:'ignore'});
  sourceGit(['init','-b','dev']);sourceGit(['add','pnpm-lock.yaml']);sourceGit(['-c','user.name=Fixture','-c','user.email=fixture@example.invalid','-c','commit.gpgsign=false','commit','-m','Fixture']);
  const deferred=await children.call('spawn_codex',{name:'DEFER',brief:'source-only ready',cwd:sourceOnly,worktree:true,defer_install:true});
  await until(()=>returned.some(r=>r.text.includes('DEFER returned')));
  const deferredHost=JSON.parse(readFileSync(path.join(process.env.AB_HOSTS_DIR,`name-${tasks.get(deferred.id).hostName}.json`)));
  const deferredReceipt=JSON.parse(readFileSync(path.join(process.env.AB_WORKSPACES_DIR,`${deferredHost.workspaceId}.json`)));
  assert.equal(deferredReceipt.phase,'active');assert.equal(deferredReceipt.input.deferDefaultInstall,true);
  assert.equal(deferredReceipt.stages.find(s=>s.id==='setup').status,'skipped');
  assert.ok(returned.some(r=>r.text.includes('DEFER returned')&&r.text.includes('Dependency installation was explicitly deferred')));
  const parentName='WAITING-PARENT';
  parentRuntime=spawn(process.execPath,['--experimental-strip-types','--no-warnings',path.resolve(import.meta.dirname,'../src/codex-host.ts'),'--name',parentName,'--model','gpt-6.1-sol','--sandbox','read-only','--approval','never'],{
    env:{...process.env,HERDR_ENV:'0',AB_CODEX_BIN:path.join(import.meta.dirname,'fake-waiting-codex.mjs')},stdio:'ignore',
  });
  let parentHost;await until(()=>{try{parentHost=JSON.parse(readFileSync(path.join(process.env.AB_HOSTS_DIR,`name-${parentName}.json`)));return !!parentHost.session;}catch{return false;}});
  const parentSocket=new WebSocket(`ws://127.0.0.1:${parentHost.port}/ws?token=${parentHost.token}`);sockets.push(parentSocket);
  const parentEvents=[];parentSocket.on('message',raw=>parentEvents.push(JSON.parse(String(raw))));await until(()=>parentEvents.some(e=>e.t==='hello'));
  const parentKey=randomUUID();parentSocket.send(JSON.stringify({t:'prompt',key:parentKey,messageId:parentKey,text:'Spawn two and stay in a waiting turn',images:[],delivery:'next'}));
  await until(()=>parentEvents.some(e=>e.t==='text'&&e.text.startsWith('Both waiting children:')));
  // Under load two returns can be taken in one mid-turn delivery: require both children's returns, however they are grouped.
  // The host can broadcast the parent's reply before the second mid-turn note or the result: wait for them, don't race.
  const notes=()=>parentEvents.filter(e=>e.t==='user'&&e.text.includes('<task-notification>')&&e.mid).map(e=>e.text).join('\n');
  await until(()=>notes().includes('WAIT-1')&&notes().includes('WAIT-2')).catch(()=>{});
  assert.ok(notes().includes('WAIT-1')&&notes().includes('WAIT-2'),'both waiting children returned mid-turn');
  await until(()=>parentEvents.some(e=>e.t==='result')).catch(()=>{});
  assert.ok(parentEvents.some(e=>e.t==='text'&&e.text.includes('WAIT-1 returned')&&e.text.includes('WAIT-2 returned')));
  assert.equal(parentEvents.filter(e=>e.t==='result').length,1);
  console.log('PASS: managed-child contracts; spawn, one level, ownership, attribution, queue, scoped Stop, automatic returns, same-thread continuation, isolated-worktree receipt and busy-parent automatic-return regression');
} finally { for(const s of sockets)s.close();if(parentRuntime&&parentRuntime.exitCode===null){const stopped=new Promise(r=>parentRuntime.once('exit',r));parentRuntime.kill('SIGTERM');await stopped;}await children.close();await foreign.close(); }
