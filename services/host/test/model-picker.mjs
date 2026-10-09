// Deterministic settings, rejection, turn parameters, reconnect and supervised restart contract.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { WebSocket } from 'ws';
import { readServiceHosts, bindServiceRows } from '../../node/src/service-hosts.ts';
const dir = mkdtempSync(path.join(tmpdir(), '.siso-ephemeral-model-picker.'));
const fixture = path.join(dir, 'codex.mjs'), calls = path.join(dir, 'turns.jsonl');
writeFileSync(fixture, `#!/usr/bin/env node
import readline from 'node:readline';
import {appendFileSync} from 'node:fs';
const send = x => process.stdout.write(JSON.stringify(x)+'\\n');
readline.createInterface({input:process.stdin}).on('line', line => {
 const m=JSON.parse(line), p=m.params??{}, result=x=>send({id:m.id,result:x});
 if(m.method==='initialize') result({});
 else if(m.method==='model/list') result({data:['gpt-6.1-sol','gpt-6-astra','limited'].map(model=>({model,displayName:model,description:'Test model',supportedReasoningEfforts:(model==='limited'?['low']:['low','medium','high','max','ultra']).map(reasoningEffort=>({reasoningEffort}))})),nextCursor:null});
 else if(['thread/start','thread/resume'].includes(m.method)) result({thread:{id:'picker-thread',turns:[]}});
 else if(m.method==='turn/start') {
  appendFileSync(${JSON.stringify(calls)},JSON.stringify(p)+'\\n');
  send({method:'turn/started',params:{threadId:'picker-thread',turn:{id:'turn'}}});result({turn:{id:'turn'}});
  setTimeout(()=>send({method:'turn/completed',params:{threadId:'picker-thread',turn:{id:'turn',status:'completed'}}}),200);
 }
});`, {mode:0o700});
const env={...process.env,HERDR_ENV:'0',AB_HOSTS_DIR:dir,AB_PROMPT_QUEUE_DIR:path.join(dir,'queue'),AB_CODEX_BIN:fixture};
const runner=path.resolve('services/host/src/service-runner.ts');
const file=path.join(dir,'name-PICKER.json');
const read=()=>JSON.parse(readFileSync(file));
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn){for(let i=0;i<200;i++){if(await fn())return;await sleep(50);}throw Error('picker timeout');}
let child,ws;let events=[];
function start(){child=spawn(process.execPath,['--experimental-strip-types','--no-warnings',runner,'--harness','codex','--name','PICKER','--model','gpt-6.1-sol','--effort','medium'],{cwd:dir,env,stdio:'ignore'});}
async function connect(){
 const connectionEvents=events=[];const h=read();
 const socket=ws=new WebSocket(`ws://127.0.0.1:${h.port}/ws?token=${h.token}`);
 socket.on('message',b=>connectionEvents.push(JSON.parse(b)));
 await until(()=>connectionEvents.some(e=>e.t==='hello'));
 assert.equal(connectionEvents[0].t,'hello');
}
const send=m=>ws.send(JSON.stringify(m));
async function stop(){ws?.close();if(child?.exitCode===null){const done=new Promise(r=>child.once('exit',r));child.kill('SIGTERM');await done;}}
try{
 start();await until(()=>{try{return read().models?.length===3;}catch{return false;}});await connect();
 send({t:'set_effort',effort:'max'});await until(()=>read().effort==='max');
 send({t:'set_model',model:'gpt-6-astra'});await until(()=>read().model==='gpt-6-astra');
 send({t:'set_model',model:'limited'});send({t:'set_effort',effort:'bogus'});send({t:'set_model',model:'unknown'});
 await until(()=>events.filter(e=>e.label==='Settings unchanged').length===3);
 assert.equal(read().model,'gpt-6-astra');assert.equal(read().effort,'max');
 send({t:'prompt',text:'settings proof'});await until(()=>read().state==='working');
 send({t:'set_effort',effort:'low'});await until(()=>events.filter(e=>e.label==='Settings unchanged').length===4);
 await until(()=>events.some(e=>e.t==='result'));
 const turn=JSON.parse(readFileSync(calls,'utf8').trim());assert.equal(turn.model,'gpt-6-astra');assert.equal(turn.effort,'max');
 ws.close();await connect();assert.equal(events[0].effort,'max');assert.equal(events[0].model,'gpt-6-astra');
 let h=read();ws.close();process.kill(h.pid,'SIGTERM');await until(()=>read().pid!==h.pid && read().child==='running');
 assert.equal(read().effort,'max');assert.equal(read().model,'gpt-6-astra');assert.equal(read().session,h.session);
 await stop();start();await until(()=>read().pid!==h.pid && read().child==='running');await connect();
 assert.equal(events[0].effort,'max');assert.equal(events[0].model,'gpt-6-astra');
 const hosts=await readServiceHosts({dir,launchdLoaded:()=>false});const row=bindServiceRows([],hosts.hosts)[0];
 assert.equal(row.hud.effort,'max');assert.equal(row.hud.model,'gpt-6-astra');assert.equal(row.hud.models.length,3);
 send({t:'set_model',model:'gpt-6.1-sol'});await until(()=>read().model==='gpt-6.1-sol');assert.equal(read().effort,'max');
 console.log('PASS model picker: account catalog, invalid/active rejection, exact turn overrides, reconnect, host+runner restart, HUD, Sol -> Astra -> Sol; max retained');
}finally{await stop();}
