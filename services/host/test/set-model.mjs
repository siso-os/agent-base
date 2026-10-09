import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readdirSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {WebSocket} from 'ws';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
test('live query model changes only after SDK acknowledgement; failures retain state',async()=>{
 const dir=mkdtempSync(path.join(tmpdir(),'.siso-ephemeral-model.')),hosts=path.join(dir,'hosts');mkdirSync(hosts);
 const fixture=path.join(dir,'sdk.mjs'),mark=path.join(dir,'picked');
 writeFileSync(fixture,`import {writeFileSync} from 'node:fs';export const getSessionMessages=async()=>[];export function query({options}){return {close(){},supportedCommands:async()=>[],async applyFlagSettings(s){if(s.effortLevel==='low')throw new Error('fixture refused effort');},async setModel(m){if(m.includes('haiku'))throw new Error('fixture refused');await new Promise(r=>setTimeout(r,50));writeFileSync(${JSON.stringify(mark)},m);},async *[Symbol.asyncIterator](){yield {type:'system',subtype:'init',session_id:'model-fixture',model:options.model??'claude-opus-5-5[1m]'};await new Promise(()=>{});}}}`);
 const start=()=>spawn(path.resolve(import.meta.dirname,'../bin/siso-host'),['--no-stack','--name','MODEL-QA','--resume','model-fixture','--model','claude-opus-5-5[1m]','--effort','medium'],{cwd:dir,stdio:['ignore','ignore','pipe'],env:{...Object.fromEntries(Object.entries(process.env).filter(([k])=>k!=='CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY')/* t-0447: an agent's own session sets it; the fixture's models must stand */),HOME:dir,HERDR_ENV:'0',AB_HOSTS_DIR:hosts,AB_HOST_SDK:fixture}});let child=start(),ws;let errors='';child.stderr.on('data',d=>errors+=d);
 try{
  let desc;for(let i=0;i<500;i++){const f=readdirSync(hosts).find(f=>f.endsWith('.json'));if(f){desc=JSON.parse(readFileSync(path.join(hosts,f),'utf8'));if(desc.model)break;}await sleep(30);}assert.ok(desc?.model,errors);
  assert.deepEqual(desc.models.map(m=>m.id),["claude-opus-5-5[1m]","claude-sonnet-5-5","claude-haiku-4-5-20251001"]);assert.ok(desc.models.every(m=>m.efforts.includes("high")));
  ws=new WebSocket(`ws://127.0.0.1:${desc.port}/ws?token=${desc.token}`);const events=[];ws.on('message',b=>events.push(JSON.parse(String(b))));await new Promise(r=>ws.once('open',r));
  ws.send(JSON.stringify({t:'set_model',model:'claude-sonnet-5-5'}));for(let i=0;i<100&&!events.some(e=>e.t==='init'&&e.model==='claude-sonnet-5-5');i++)await sleep(20);
  assert.equal(readFileSync(mark,'utf8'),'claude-sonnet-5-5');assert.ok(events.some(e=>e.t==='init'&&e.model==='claude-sonnet-5-5'));
  const descriptor=()=>JSON.parse(readFileSync(path.join(hosts,`pid-${child.pid}.json`),'utf8'));
  // The SDK acknowledgement is published before the durable descriptor is written. Observe both boundaries.
  for(let i=0;i<100&&descriptor().model!=='claude-sonnet-5-5';i++)await sleep(20);
  assert.equal(descriptor().model,'claude-sonnet-5-5');
  ws.send(JSON.stringify({t:'set_model',model:'claude-haiku-4-5-20251001'}));ws.send(JSON.stringify({t:'set_model',model:'unknown'}));for(let i=0;i<100&&events.filter(e=>e.label==='Model unchanged').length<2;i++)await sleep(20);
  assert.equal(events.filter(e=>e.label==='Model unchanged').length,2);assert.equal(readFileSync(mark,'utf8'),'claude-sonnet-5-5');
  ws.send(JSON.stringify({t:'set_effort',effort:'max'}));for(let i=0;i<100&&!events.some(e=>e.label==='Effort');i++)await sleep(20);
  for(let i=0;i<100&&descriptor().effort!=='max';i++)await sleep(20);
  assert.equal(descriptor().effort,'max');
  ws.send(JSON.stringify({t:'set_effort',effort:'low'}));for(let i=0;i<100&&!events.some(e=>e.label==='Effort unchanged');i++)await sleep(20);
  assert.ok(events.some(e=>e.label==='Effort unchanged'));
  ws.close();await sleep(30);ws=new WebSocket(`ws://127.0.0.1:${desc.port}/ws?token=${desc.token}`);const hello=await new Promise(r=>ws.once('message',b=>r(JSON.parse(String(b)))));assert.equal(hello.model,'claude-sonnet-5-5');assert.equal(hello.effort,'max');
  ws.close();const stopped=new Promise(r=>child.once('exit',r));child.kill('SIGTERM');await stopped;child=start();
  let restored;for(let i=0;i<500;i++){try{restored=JSON.parse(readFileSync(path.join(hosts,`pid-${child.pid}.json`)));}catch{await sleep(30);continue;}if(restored.pid===child.pid&&restored.model==='claude-sonnet-5-5')break;await sleep(30);}
  assert.equal(restored.pid,child.pid);assert.equal(restored.model,'claude-sonnet-5-5');assert.equal(restored.effort,'max');
 }finally{ws?.close();child.kill('SIGTERM');}
});
