import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ActivityJournal, classifyClaudeResult, classifyCodexTurn } from '../src/activity.ts';
const root = path.resolve(import.meta.dirname, '../../..');
const scratch = mkdtempSync(path.join(tmpdir(), '.siso-ephemeral-ab-notify-'));
process.env.AB_ACTIVITY_DIR = path.join(scratch, 'activity');
const j = new ActivityJournal('qa','instance',{taskId:'task-1',workspaceId:'ws-1'}); j.start('s','r'); j.finish('failed',0,{inputTokens:10,outputTokens:4,cacheReadInputTokens:null,cacheCreationInputTokens:null,cumulative:true}); j.runtimeFailed('s'); j.finish('completed');
assert.equal(readFileSync(j.journal,'utf8').trim().split('\n').length,2);
const terminal = JSON.parse(readFileSync(j.journal,'utf8').trim().split('\n')[1]); assert.equal(terminal.ref.taskId,'task-1'); assert.equal(terminal.ref.workspaceId,'ws-1'); assert.equal(terminal.usage.outputTokens,4); assert.equal(terminal.usage.cumulative,true);
assert.equal(classifyClaudeResult({is_error:true},false),'failed');
assert.equal(classifyClaudeResult({subtype:'success'},true),'cancelled');
assert.equal(classifyCodexTurn({status:'interrupted'}),'cancelled');
process.env.AB_ACTIVITY_DIR = '/dev/null/unwritable';
const bad = new ActivityJournal('qa'); bad.start('s'); assert.equal(bad.healthy,false);
console.log('PASS classification, terminal dedup and storage failure isolation');
writeFileSync(path.join(scratch,'sdk.mjs'), `export const getSessionMessages=async()=>[]; export function query({prompt,options}){return {close(){},supportedCommands:async()=>[],getContextUsage:async()=>({}),async *[Symbol.asyncIterator](){yield {type:'system',subtype:'init',session_id:'session',model:'fixture'};for await(const m of prompt){const text=m.message.content;if(text==='question')await options.canUseTool('AskUserQuestion',{questions:[{question:'Pick?',options:[{label:'A',description:'First'},{label:'B',description:'Second'}]}]},{signal:new AbortController().signal,toolUseID:'i'});else if(text==='approval')await options.canUseTool('Bash',{}, {signal:new AbortController().signal});else yield {type:'result',subtype:text==='failed'?'error':'success',is_error:text==='failed',duration_ms:1};}}};}`);
writeFileSync(path.join(scratch,'codex.mjs'), `#!/usr/bin/env node
import readline from 'node:readline';if(process.argv[2]!=='-m')process.exit(2);const send=m=>process.stdout.write(JSON.stringify(m)+'\\n');let n=0;readline.createInterface({input:process.stdin}).on('line',line=>{const m=JSON.parse(line);const p=m.params??{};if(m.method==='initialize')send({id:m.id,result:{}});if(m.method==='thread/start')send({id:m.id,result:{thread:{id:'session',turns:[]}}});if(m.method==='turn/start'){const id='r'+ ++n;send({method:'turn/started',params:{turn:{id}}});send({id:m.id,result:{turn:{id}}});const text=p.input[0].text;if(text==='question')send({id:10,method:'item/tool/requestUserInput',params:{threadId:'session',turnId:id,itemId:'i',questions:[{id:'pick',header:'Pick',question:'Pick?',options:[{label:'A',description:'First'},{label:'B',description:'Second'}]}]}});else if(text==='approval')send({id:11,method:'item/commandExecution/requestApproval',params:{threadId:'session',command:'private'}});else send({method:'turn/completed',params:{turn:{id,status:text==='failed'?'failed':'completed'}}});}});`,{mode:0o700});
const delay = ms => new Promise(r=>setTimeout(r,ms));
for (const provider of ['claude','codex']) for (const scenario of ['completed','failed','question','approval']) {
  const dir = path.join(scratch,provider+'-'+scenario);mkdirSync(dir);
  const env = {...process.env,HERDR_ENV:'0',AB_HOSTS_DIR:path.join(dir,'hosts'),AB_ACTIVITY_DIR:path.join(dir,'events'),AB_PROMPT_QUEUE_DIR:path.join(dir,'queues'),AB_SERVICE_NAME:'QA',AB_HOST_SDK:path.join(scratch,'sdk.mjs'),AB_CODEX_BIN:path.join(scratch,'codex.mjs')};
  const p = spawn(process.execPath,['--experimental-strip-types','--no-warnings',path.join(root,'services/host/src/'+(provider==='codex'?'codex-host':'host')+'.ts'),'--name','QA',...(provider==='codex'?['--model','fixture']:['--no-stack']),'--prompt',scenario],{cwd:scratch,env,stdio:'ignore'});
  try {
    let events = [];const end=Date.now()+10000;
    while(Date.now()<end){try{const h=JSON.parse(readFileSync(path.join(dir,'hosts/name-QA.json')));events=readFileSync(h.activityJournal,'utf8').trim().split('\n').map(JSON.parse);if(events.length>=2)break;}catch{}await delay(30);}
    const expected=scenario==='question'||scenario==='approval'?'request.opened':'run.'+scenario;
    assert.equal(events.filter(e=>e.kind===expected).length,1,provider+' '+scenario);
    assert.equal(events[0].kind,'run.started');assert.ok(events.every(e=>e.ref.runId===events[0].ref.runId));
    console.log('PASS '+provider+' '+scenario+': one durable event, zero chat clients');
  } finally {p.kill('SIGTERM');await new Promise(r=>p.once('exit',r));}
}
console.log('PASS 8 zero-client host lifecycle fixtures');
