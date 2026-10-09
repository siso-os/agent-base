import assert from 'node:assert/strict';
import {spawn,spawnSync} from 'node:child_process';
import {mkdtempSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {WebSocket} from 'ws';
import {renderPlist} from '../src/service-control.ts';
import {readServiceHosts,bindServiceRows} from '../../node/src/service-hosts.ts';
const root = path.resolve(import.meta.dirname,'../../..');
const dir = mkdtempSync(path.join(tmpdir(),'.siso-ephemeral-codex-test.'));
const entry = path.join(root,'services/host/bin/siso-host');
assert.equal(spawnSync(entry,['--harness','codex','--name','TEST'],{encoding:'utf8'}).status,2);
const model = 'caller-model';
const plist = renderPlist({label:'com.siso.host-TEST',name:'TEST',resume:'test-thread',cwd:dir,seat:'unused',hosts:dir,node:process.execPath,runner:'runner.ts',harness:'codex',model});
assert.match(plist,/<key>KeepAlive<\/key><true\/>/); assert.match(plist,/<string>caller-model<\/string>/);
const env = {...process.env,HERDR_ENV:'0',AB_HOSTS_DIR:dir,AB_PROMPT_QUEUE_DIR:path.join(dir,"queues"),AB_CODEX_BIN:path.join(root,'services/host/test/fake-codex.mjs')};
let child, ws;
const sleep = ms => new Promise(r=>setTimeout(r,ms));
async function until(fn) {for(let i=0;i<200;i++){if(await fn()) return; await sleep(50);} throw Error('timeout');}
const file = path.join(dir,'name-TEST.json');
const read = ()=>JSON.parse(readFileSync(file));
try {
  child=spawn(process.execPath,['--experimental-strip-types','--no-warnings',path.join(root,'services/host/src/service-runner.ts'),'--harness','codex','--name','TEST','--model',model],{cwd:dir,env,stdio:'ignore'});
  await until(()=>{try{return read().session;}catch{return false;}});
  assert.equal(read().model,model); assert.equal(read().state,'idle');
  const h=read(), frames=[];
  ws=new WebSocket(`ws://127.0.0.1:${h.port}/ws?token=${h.token}`); ws.on('message',m=>frames.push(JSON.parse(m)));
  await until(()=>frames.some(m=>m.t==='hello'));
  ws.send(JSON.stringify({t:'prompt',text:'hello'}));
  await until(()=>read().state==='blocked');
  let hosts=await readServiceHosts({dir,launchdLoaded:()=>true});
  assert.equal(bindServiceRows([],hosts.hosts)[0].status,'needs');
  ws.send(JSON.stringify({t:'approve',id:'100',allow:true}));
  await until(()=>frames.some(m=>m.t==='result'));
  hosts=await readServiceHosts({dir,launchdLoaded:()=>true});
  const row=bindServiceRows([],hosts.hosts)[0];
  assert.equal(row.status,'idle'); assert.equal(row.hud.model,model); assert.equal(row.context,10); assert.equal(row.hud.tokensOut,10); assert.ok(row.hud.tokensPerSecond>0);
  assert.ok(!JSON.stringify(hosts.publicHosts).includes(h.token));
  ws.close(); process.kill(h.pid,'SIGKILL');
  await until(()=>read().pid!==h.pid && read().session==='test-thread');
  assert.equal(read().state,'idle');
  // send: one turn from outside the app, back comes the final message (a watching client approves, as he would in the app).
  const h2=read(), watch=new WebSocket(`ws://127.0.0.1:${h2.port}/ws?token=${h2.token}`);
  watch.on('message',m=>{const e=JSON.parse(m); if(e.t==='approval') watch.send(JSON.stringify({t:'approve',id:e.id,allow:true}));});
  await new Promise(r=>watch.once('open',r));
  const promptFile=path.join(dir,'turn.txt'); (await import('node:fs')).writeFileSync(promptFile,'next run');
  const sent=await new Promise(r=>{const c=spawn(process.execPath,['--experimental-strip-types','--no-warnings',path.join(root,'services/host/src/service-control.ts'),'send','--name','TEST','--prompt-file',promptFile,'--timeout','20'],{env});
    let stdout='',stderr=''; c.stdout.on('data',d=>stdout+=d); c.stderr.on('data',d=>stderr+=d); c.on('exit',status=>r({status,stdout,stderr}));});
  watch.close();
  assert.equal(sent.status,0,sent.stderr); assert.equal(sent.stdout.trim(),'Approved reply');
  assert.equal(spawnSync(process.execPath,['--experimental-strip-types','--no-warnings',path.join(root,'services/host/src/service-control.ts'),'send','--name','NOPE','--prompt-file',promptFile],{env,encoding:'utf8'}).status,2);
  // A thread that never had a turn cannot be resumed: the host starts a fresh one instead of crash-looping.
  const d2=mkdtempSync(path.join(tmpdir(),'.siso-ephemeral-codex-test.'));
  const c2=spawn(process.execPath,['--experimental-strip-types','--no-warnings',path.join(root,'services/host/src/codex-host.ts'),'--name','T2','--model',model,'--resume','never-used'],{cwd:d2,env:{...env,AB_HOSTS_DIR:d2,AB_PROMPT_QUEUE_DIR:path.join(d2,"queues")},stdio:'ignore'});
  const f2=path.join(d2,'name-T2.json');
  await until(()=>{try{return JSON.parse(readFileSync(f2)).session==='test-thread';}catch{return false;}});
  c2.kill('SIGTERM');
  console.log('Codex host: unresumable empty thread -> fresh thread');
  console.log('Codex host: send returns the final message; no host = exit 2');
  console.log('Codex host: explicit arbitrary model, KeepAlive plist, approval/status/HUD/private projection and supervised same-thread restart passed');
} finally {
  ws?.close();
  if(child) {child.kill('SIGTERM'); await new Promise(r=>child.once('exit',r));}
}
