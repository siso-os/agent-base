import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtempSync,mkdirSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {ActivityCollector} from '../src/activity.ts';
import {executeAttentionCommand} from '../src/attention-actions.ts';
const root=path.resolve(import.meta.dirname,'../../..'),fixture=mkdtempSync(path.join(tmpdir(),'.siso-ephemeral-notify-actions-')),hosts=path.join(fixture,'hosts');mkdirSync(hosts);
process.env.AB_ACTIVITY_DIR=path.join(fixture,'activity');
const env={...process.env,HERDR_ENV:'0',AB_HOSTS_DIR:hosts,AB_CODEX_BIN:path.join(root,'services/host/test/fake-codex.mjs'),AB_HOST_SDK:path.join(root,'services/host/test/fake-sdk.mjs'),AB_SERVICE_NAME:'ApprovalQA',AB_PROMPT_QUEUE_DIR:path.join(fixture,'queues'),FAKE_STEER_QUESTIONS:'1'};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));async function until(fn){for(let i=0;i<200;i++){if(fn())return;await sleep(50);}throw Error('Action fixture timeout');}
const collector=new ActivityCollector(hosts,path.join(fixture,'attention'),h=>'service-'+h.name);
for(const provider of ['codex','claude']){
  const name='ApprovalQA-'+provider;
  const host=spawn(process.execPath,['--experimental-strip-types','--no-warnings',path.join(root,'services/host/src/'+(provider==='codex'?'codex-host':'host')+'.ts'),'--name',name,...(provider==='codex'?['--model','fixture']:['--no-stack'])],{cwd:fixture,env:{...env,AB_SERVICE_NAME:name},stdio:['pipe','ignore','inherit']});
  try{
    let h;await until(()=>{try{h=JSON.parse(readFileSync(path.join(hosts,'name-'+name+'.json')));return !!h.session;}catch{return false;}});
    if(provider==='codex'){
      host.stdin.write('approval\n');await until(()=>collector.list().some(i=>i.agentName===name&&i.requestKind==='approval'));
      const approval=collector.list().find(i=>i.agentName===name&&i.requestKind==='approval');
      const cmd={commandId:'duplicate-approve',ref:approval.ref,expectedRevision:approval.revision,action:{kind:'approve',requestId:approval.requestId}};
      const results=await Promise.all([executeAttentionCommand(collector,approval.id,cmd),executeAttentionCommand(collector,approval.id,cmd)]);assert.ok(results.every(r=>r.status==='accepted'));
      await until(()=>collector.get(approval.id)?.phase==='resolved');assert.equal((await executeAttentionCommand(collector,approval.id,cmd)).status,'stale');
      const events=readFileSync(h.activityJournal,'utf8').trim().split('\n').map(JSON.parse);assert.equal(events.filter(e=>e.kind==='request.resolved').length,1);
      console.log('PASS overview approval: two viewers accepted same command, one native resolution, stale revision rejected');
    }
    host.stdin.write('question\n');await until(()=>collector.list().some(i=>i.agentName===name&&i.phase==='needs'&&i.requestKind==='input'));
    const q=collector.list().find(i=>i.agentName===name&&i.phase==='needs'&&i.requestKind==='input');
    const expectedQuestion=provider==='codex'?'choice':'q0';
    // Read the original native question ID from hello via the same private node helper.
    const {readAttentionRequest}=await import('../src/attention-actions.ts');const request=await readAttentionRequest(collector,q.id);assert.ok(request);
    const answer={commandId:'answer-'+provider,ref:q.ref,expectedRevision:q.revision,action:{kind:'answer',requestId:q.requestId,answers:{[request.questions[0].id]:['Beta']}}};
    assert.equal((await executeAttentionCommand(collector,q.id,{...answer,ref:{...q.ref,hostInstanceId:'another-epoch'}})).status,'stale');
    assert.equal((await executeAttentionCommand(collector,q.id,answer)).status,'accepted');await until(()=>collector.get(q.id)?.phase==='resolved');
    console.log('PASS '+provider+' overview question: wrong epoch rejected; original callback ACK accepted, request resolved');
  }finally{if(host.exitCode===null){const stopped=new Promise(r=>host.once('exit',r));host.kill('SIGTERM');await stopped;}}
}
collector.close();console.log('CLEANUP: both task-owned fixture hosts stopped');
