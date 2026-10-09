// Isolated allocation contract: real task reader/writer and copied CLI; no live hosts, tasks or worktrees.
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,copyFile,chmod,symlink,realpath} from 'node:fs/promises';
import {tmpdir,homedir} from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {createA0TasksHandler,createA0TaskWriter,taskEditArgs} from '../src/a0-tasks.ts';
import {createTaskActionsHandler,incompleteTaskSpec} from '../src/task-actions.ts';
import {snapshot} from '../src/worktrees.ts';
const scratch=await realpath(await mkdtemp(path.join(tmpdir(),'.siso-ephemeral-task-actions.')));
const repo=path.join(scratch,'repo'),tasks=path.join(scratch,'tasks'),bin=path.join(scratch,'bin'),routingFile=path.join(scratch,'routing.json'),stateDir=path.join(scratch,'actions');
process.env.AB_WORKSPACES_DIR=path.join(scratch,'workspaces');
for(const dir of [repo,tasks,bin,path.join(repo,'ui-hub/complete')])await mkdir(dir,{recursive:true});
execFileSync('git',['init','-q',repo]);
await writeFile(routingFile,JSON.stringify({roles_model:'gpt-6-astra'}));
const cli=path.join(bin,'a0-task');await copyFile(path.join(homedir(),'SISO_Workspace/SISO_Agents/agent-zero/siso-agent-zero/bin/a0-task'),cli);await chmod(cli,0o700);
const titles=['His words','What is wrong now','The real data','His moments','Options','Anatomy',"Keep and don't",'Acceptance'];
const spec=titles.map((title,i)=>`## ${i+1}. ${title}\n\nConcrete fixture content for ${title}: preserve the approved layout and verify the result.\n`).join('\n');
await writeFile(path.join(repo,'ui-hub/complete/SPEC.md'),spec);
// Current component writer contract requires committed code and version-bound context.
const g=(...args)=>execFileSync('git',['-C',repo,...args],{encoding:'utf8'}).trim();
g('config','user.name','Writer fixture');g('config','user.email','fixture@example.invalid');
await writeFile(path.join(repo,'.gitignore'),'ui-hub/incomplete/\nui-hub/link\n');
await writeFile(path.join(repo,'source.txt'),'Synthetic component source.\n');
const context='The fixture owns source.txt; preserve its behavior and verify the allocation contract.\n';
await writeFile(path.join(repo,'ui-hub/complete/CONTEXT.md'),context);
g('add','.');g('commit','-qm','Fixture source');
const hashText=v=>createHash('sha256').update(v).digest('hex');
await writeFile(path.join(repo,'ui-hub/components.json'),JSON.stringify({components:[{id:'complete',writerDossier:{version:1,sourceRevision:g('rev-parse','HEAD'),files:[{path:'source.txt',sha256:hashText('Synthetic component source.\n')}],context:['files','traps','reasoning','feedback'].map(role=>({role,path:'ui-hub/complete/CONTEXT.md',sha256:hashText(context)}))}}]}));
g('add','.');g('commit','-qm','Fixture dossier');
let rows=[],n=9900,checks=[];
const create=async(extra={})=>{const t={id:`t-${++n}`,title:'Synthetic allocation contract',project:'Fixture',owner:'OWNER',stage:'specced',priority:'P1',updated:new Date().toISOString(),created:new Date().toISOString(),his:'Build this approved fixture',next:'',agent:null,model:null,links:{spec:'ui-hub/complete/SPEC.md',surface:'complete'},history:[],evidence:[],feedback:{his:null,at:null,verdict:null},...extra};rows.push(t);await writeFile(path.join(tasks,t.id+'.json'),JSON.stringify(t));await writeFile(path.join(tasks,'INDEX.json'),JSON.stringify({updated:new Date().toISOString(),counts:{},tasks:rows}));return t;};
const alter=async(t,change)=>{const file=path.join(tasks,t.id+'.json'),v=JSON.parse(await readFile(file,'utf8'));Object.assign(v,change);await writeFile(file,JSON.stringify(v));};
const read=createA0TasksHandler(tasks),write=createA0TaskWriter(read,cli),receipts=new Map();
const digest=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
let launchCalls=0,startCalls=0,retryCalls=0,findCalls=0,gate=true,gateThrow=false,connected=false,mode='normal',capturedAdapters;
const adapters={beforeStart:async()=>({AB_CODEX_BIN:'/fixture/pinned-codex'}),start:async(_r,_file,env)=>{assert.deepEqual(env,{AB_CODEX_BIN:'/fixture/pinned-codex'});startCalls++;return {};},find:async()=>{findCalls++;return connected?{id:'fixture-host',session:'fixture-session'}:null;}};
const lifecycle={
 get:id=>{const r=receipts.get(id);if(!r)throw Object.assign(Error('missing'),{code:'ENOENT'});return r;},
 launch:async(input,a)=>{launchCalls++;capturedAdapters=a;if(mode==='throw-before')throw Error('fixture failure');const r={workspaceId:`ws-${digest(input.taskId).slice(0,24)}`,launchId:input.launchId,taskId:input.taskId,name:input.name,input,phase:'preparing',stages:[],sequence:1,error:null,branch:null,baseRef:null,baseSha:null,agentId:null,handoffAttempted:false};receipts.set(r.workspaceId,r);if(mode==='throw-after')throw Error('ambiguous acknowledgement');await a.start(r,'fixture-receipt',await a.beforeStart?.(r,'fixture-receipt'));r.handoffAttempted=true;if(mode==='failed'){r.phase='failed';r.error='Fixture handoff refused';}return snapshot(r);},
 retry:async(id,a)=>{retryCalls++;capturedAdapters=a;const r=lifecycle.get(id);if(!r.handoffAttempted){await a.start(r,'fixture-receipt',await a.beforeStart?.(r,'fixture-receipt'));r.handoffAttempted=true;}r.phase='starting';r.error=null;if(await a.find(r)){r.phase='active';r.agentId='fixture-host';}return snapshot(r);}
};
const opts={read,write,projects:()=>[{name:'Fixture',path:repo}],adapters,lifecycle,routingFile,stateDir,admit:async()=>{if(gateThrow)throw Error('fixture unavailable');return {ok:gate,reason:gate?'':'Fixture admission declined'};}};
let handler=createTaskActionsHandler(opts);
const ready=async t=>(await handler.readiness(t.id)).body;
const request=r=>({expectedRevision:r.expectedRevision,idempotencyKey:r.idempotencyKey});
const saved=async t=>(await read('/api/a0/tasks/'+t.id)).body;
// The real CLI writer allows 15 s; a shared, loaded laptop must not fail this contract after only 1 s.
const settle=async predicate=>{const deadline=Date.now()+20_000;while(Date.now()<deadline){if(await predicate())return;await new Promise(r=>setTimeout(r,25));}assert.fail('reconciliation timeout');};
assert.deepEqual(incompleteTaskSpec(spec),[]);
assert.equal(incompleteTaskSpec(titles.map(x=>'## '+x+'\nTODO').join('\n')).length,8);
assert.equal(incompleteTaskSpec('```md\n'+spec+'\n```').length,8);
checks.push('Complete eight-section specification, blank/TODO and fenced templates');
const first=await create(),r=await ready(first);assert.equal(r.canStart,true);assert.equal(r.model,'gpt-6-astra');
assert.equal((await handler.allocate(first.id,{...request(r),repo:'/tmp/untrusted'})).status,400);
assert.equal((await handler.allocate(first.id,{...request(r),idempotencyKey:'task-'+'c'.repeat(40)})).status,409);
const both=await Promise.all([handler.allocate(first.id,request(r)),handler.allocate(first.id,request(r))]);
assert.deepEqual(both.map(x=>x.status),[202,202]);assert.equal(launchCalls,1);assert.equal(startCalls,1);assert.equal((await saved(first)).stage,'specced');
assert.equal(capturedAdapters.beforeStart,adapters.beforeStart);checks.push('Task allocation forwards the shared pre-handoff hook and exact ephemeral pin');
const firstWorkspace=both[0].body.workspace.workspaceId;assert.equal(lifecycle.get(firstWorkspace).input.model,'gpt-6-astra');assert.equal(lifecycle.get(firstWorkspace).input.harness,'codex');assert.match(lifecycle.get(firstWorkspace).input.prompt,/bounded worker/);
handler=createTaskActionsHandler(opts);assert.equal((await handler.allocate(first.id,request(r))).status,202);assert.equal(launchCalls,1);
checks.push('Concurrent duplicate POST and handler restart preserve one allocation, explicit current model and no premature task stage');
connected=true;const receipt=lifecycle.get(firstWorkspace);await capturedAdapters.find(receipt);receipt.phase='active';await settle(async()=>(await saved(first)).stage==='building' && (await saved(first)).agent===receipt.name);assert.equal((await saved(first)).agent,receipt.name);assert.equal((await handler.allocate(first.id,request(r))).status,200);assert.equal(startCalls,1);connected=false;
checks.push('Only an identity-verified host advances the board through the existing CLI');
for(const change of [{title:'Task edited since readiness'},{links:{spec:'ui-hub/missing/SPEC.md'}}]){const t=await create(),c=await ready(t);await alter(t,change);assert.equal((await handler.allocate(t.id,request(c))).status,409);}
const staleSpec=await create(),old=await ready(staleSpec);await writeFile(path.join(repo,'ui-hub/complete/SPEC.md'),spec+'\nChanged acceptance.');assert.equal((await handler.allocate(staleSpec.id,request(old))).status,409);await writeFile(path.join(repo,'ui-hub/complete/SPEC.md'),spec);
checks.push('Task and specification content changes invalidate captured revisions');
for(const extra of [{project:'Unknown'},{links:{spec:'ui-hub/missing/SPEC.md'}},{links:{spec:'ui-hub/../escape/SPEC.md'}},{links:{spec:'/absolute/SPEC.md'}},{owner:null},{agent:'EXISTING-WORKER'}])assert.equal((await ready(await create(extra))).canStart,false);
await mkdir(path.join(repo,'ui-hub/incomplete'));await writeFile(path.join(repo,'ui-hub/incomplete/SPEC.md'),'## Acceptance\nTODO');assert.equal((await ready(await create({links:{spec:'ui-hub/incomplete/SPEC.md'}}))).specReady,false);
await symlink(path.join(repo,'ui-hub/complete'),path.join(repo,'ui-hub/link'));assert.match((await ready(await create({links:{spec:'ui-hub/link/SPEC.md'}}))).reason,/symlink/);
checks.push('Unknown repository, missing owner/spec, incomplete spec, traversal and symlink confinement');
const capTask=await create(),cap=await ready(capTask),beforeLaunch=launchCalls;gate=false;assert.equal((await handler.allocate(capTask.id,request(cap))).status,429);assert.equal((await ready(capTask)).canStart,false);gateThrow=true;assert.equal((await ready(capTask)).canStart,false);assert.equal(launchCalls,beforeLaunch);gateThrow=false;gate=true;
checks.push('Current injected resource admission denies or fails closed before launch');
for(const failure of ['throw-before','throw-after','failed']){const t=await create(),c=await ready(t),before=startCalls;mode=failure;const result=await handler.allocate(t.id,request(c));assert.equal(result.body.ok,false);assert.equal((await saved(t)).stage,'specced');mode='normal';handler=createTaskActionsHandler(opts);const again=await ready(t);assert.equal(again.canStart,true);assert.deepEqual(request(again),request(c));const recovery=await handler.allocate(t.id,request(again));assert.ok([202,200].includes(recovery.status));assert.equal(startCalls,before+1);assert.equal((await saved(t)).stage,'specced');}
checks.push('Failure before/after durable workspace acceptance and failed handoff recover with the same identity and one external start');
// A connected worker and edited task must coexist without silently overwriting the edit.
const conflict=await create(),cr=await ready(conflict),ca=await handler.allocate(conflict.id,request(cr));await alter(conflict,{title:'Human changed task'});connected=true;const rc=lifecycle.get(ca.body.workspace.workspaceId);rc.phase='active';await capturedAdapters.find(rc);await settle(async()=>Boolean((await ready(conflict)).taskUpdateError));assert.equal((await saved(conflict)).stage,'specced');connected=false;
// Missing board persistence can be reconciled without launching another worker.
const recover=await create(),rr=await ready(recover);let denyWrite=true;const recoverHandler=createTaskActionsHandler({...opts,write:async(...args)=>denyWrite?{status:503,body:{ok:false}}:write(...args)});const ra=await recoverHandler.allocate(recover.id,request(rr));const rw=lifecycle.get(ra.body.workspace.workspaceId);connected=true;rw.phase='active';await capturedAdapters.find(rw);await settle(async()=>Boolean((await recoverHandler.readiness(recover.id)).body.taskUpdateError));const starts=startCalls;denyWrite=false;await recoverHandler.allocate(recover.id,request(rr));await settle(async()=>(await saved(recover)).stage==='building' && (await saved(recover)).agent===rw.name);assert.equal(startCalls,starts);connected=false;
// Task fields can be visible before the asynchronous reconciliation has finished its readback.
await settle(async()=>{const state=(await recoverHandler.readiness(recover.id)).body;return state.taskUpdated===true&&!state.taskUpdateError;});
const recoveredState=(await recoverHandler.readiness(recover.id)).body;assert.equal(recoveredState.taskUpdated,true);assert.equal(recoveredState.taskUpdateError,undefined);
checks.push('Board conflicts preserve human edits; failed board save reconciles the already-connected workspace without a second start');
for(const reason of ['', '   ', '...', 'Redo', 'rework'])assert.equal(taskEditArgs('t-1',{stage:'rework',reason}).ok,false);
const verdict=await create({stage:'preview'});const verdictResult=await write(verdict.id,{stage:'rework',reason:'The mobile spacing is off'});assert.equal(verdictResult.status,200);assert.equal(verdictResult.body.task.feedback.his,'The mobile spacing is off');assert.equal(verdictResult.body.task.feedback.verdict,'rework');
const good=await write(verdict.id,{stage:'happy',reason:'Good'});assert.equal(good.status,200);assert.equal(good.body.task.feedback.his,'Good');
assert.equal((await write(verdict.id,{stage:'preview',reason:'undo'})).status,200);
const noop=path.join(bin,'noop');await writeFile(noop,'#!/bin/sh\nexit 0\n');await chmod(noop,0o700);assert.equal((await createA0TaskWriter(read,noop)(verdict.id,{priority:'P0'})).status,503);
let readN=0;const broken=createA0TaskWriter(async p=>++readN===1?read(p):{status:503,body:{error:'unreadable'}},noop);assert.equal((await broken(verdict.id,{priority:'P1'})).status,503);
checks.push('Real copied task CLI saves meaningful Redo, Good and Undo; noop or unreadable save cannot produce success');
console.log(JSON.stringify({status:'PASS',checks,launchCalls,startCalls,retryCalls,findCalls,scope:'Synthetic repository/tasks and stub lifecycle only; no live task or agent actions'},null,2));
