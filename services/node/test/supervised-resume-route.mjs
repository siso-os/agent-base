// Actual HTTP route + current lifecycle bodies, real controller/runner/host; sealed run metadata and provider.
import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import http from 'node:http';
import path from 'node:path';
import vm from 'node:vm';
import { WebSocketServer } from 'ws';
import ts from '../../../apps/web/node_modules/typescript/lib/typescript.js';
import { agentSessionRoutes } from '../src/routes/agent-session.area.ts';
import { listServiceHosts } from '../src/service-hosts.ts';
import { resumeSupervisedSession, confirmSupervisedResume } from '../src/claude-service-lifecycle.ts';

const execute = promisify(execFile), repo = path.resolve(import.meta.dirname,'../../..');
const root = realpathSync(mkdtempSync(path.join(tmpdir(),'.siso-ephemeral-resume-route.')));
const hosts = path.join(root,'hosts'), plists = path.join(root,'plists'), calls = path.join(root,'provider.jsonl');
mkdirSync(hosts); mkdirSync(plists);
const fakeLaunchctl=path.join(root,'launchctl'), provider=path.join(root,'provider.mjs');
writeFileSync(fakeLaunchctl,'#!/bin/sh\nif [ "$1" = print ]; then exit 1; fi\nexit 0\n',{mode:0o700});
writeFileSync(provider,`#!/usr/bin/env node
import fs from 'node:fs'; import readline from 'node:readline';
const send=m=>process.stdout.write(JSON.stringify(m)+'\\n');
readline.createInterface({input:process.stdin}).on('line',line=>{const m=JSON.parse(line),p=m.params??{};fs.appendFileSync(${JSON.stringify(calls)},JSON.stringify({method:m.method,params:p})+'\\n');const reply=result=>send({id:m.id,result});
if(m.method==='initialize')reply({});
else if(m.method==='thread/resume'){if(p.threadId==='missing-thread')send({id:m.id,error:{code:-32600,message:'no rollout found for thread id missing-thread'}});else reply({thread:{id:p.threadId==='wrong-thread'?'foreign-thread':p.threadId,turns:[],createdAt:1}});}
else if(m.method==='thread/start')reply({thread:{id:'ACCIDENTAL-FRESH',turns:[],createdAt:1}});
else if(m.method==='turn/start'){reply({turn:{id:'fixture-turn'}});send({method:'turn/started',params:{threadId:p.threadId,turn:{id:'fixture-turn'}}});send({method:'item/completed',params:{threadId:p.threadId,item:{type:'agentMessage',id:'reply',text:'same-thread reply'}}});send({method:'turn/completed',params:{threadId:p.threadId,turn:{id:'fixture-turn',status:'completed'}}});}
else if(m.id!==undefined)reply({});
});
`,{mode:0o700});
const env={...process.env,AB_HOSTS_DIR:hosts,AB_LAUNCHCTL:fakeLaunchctl,AB_LAUNCH_AGENTS_DIR:plists,AB_CODEX_BIN:provider,AB_BACKEND_SELECTION:'',AB_WORKSPACE_RECEIPT:'',AB_PROMPT_QUEUE_DIR:path.join(root,'queues'),HERDR_ENV:'0'};
const runners=[], checks=[];
const observed=()=>existsSync(calls)?readFileSync(calls,'utf8').trim().split('\n').filter(Boolean).map(JSON.parse):[];
const until=async fn=>{for(let i=0;i<120;i++){if(await fn())return;await new Promise(r=>setTimeout(r,50));}throw Error('Fixture timeout');};
const xml=s=>s.replace(/&quot;/g,'"').replace(/&apos;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&');
async function install(command,args,options){
  assert.equal(command,path.join(repo,'services/host/bin/siso-host-service'));
  assert.equal(args[0],'install');
  const result=await execute(command,args,{...options,env:{...env,...options.env},maxBuffer:100000});
  const label=args[args.indexOf('--label')+1],body=readFileSync(path.join(plists,label+'.plist'),'utf8');
  const argumentsXml=body.match(/<key>ProgramArguments<\/key><array>(.*?)<\/array>/s)[1];
  const argv=[...argumentsXml.matchAll(/<string>(.*?)<\/string>/gs)].map(m=>xml(m[1]));
  const environment=body.match(/<key>EnvironmentVariables<\/key><dict>(.*?)<\/dict>/s)[1];
  const persisted=Object.fromEntries([...environment.matchAll(/<key>(.*?)<\/key><string>(.*?)<\/string>/gs)].map(m=>[xml(m[1]),xml(m[2])]));
  assert.equal(persisted.AB_EXACT_RESUME,args[args.indexOf('--resume')+1]);
  const cwd=xml(body.match(/<key>WorkingDirectory<\/key><string>(.*?)<\/string>/s)[1]);
  const child=spawn(argv[0],argv.slice(1),{cwd,env:{...env,...persisted},stdio:['ignore','ignore','pipe']});
  child.errors='';child.stderr.on('data',d=>child.errors+=d);runners.push(child);
  return result;
}
const runs=[
  {id:'good',worker:'GOOD',model:'fixture-model',dir:root,running:false},
  {id:'missing',worker:'MISSING',model:'fixture-model',dir:root,running:false},
  {id:'wrong',worker:'WRONG',model:'fixture-model',dir:root,running:false},
  {id:'socket',worker:'SOCKET',model:'fixture-model',dir:root,running:false},
  {id:'no-dir',worker:'NODIR',model:'fixture-model',dir:path.join(root,'absent'),running:false},
  {id:'running',worker:'RUNNING',model:'fixture-model',dir:root,running:true},
  {id:'pane-owned',worker:'PANE-RENAME',model:'fixture-model',dir:root,running:false},
];
const threads={good:'original-thread',missing:'missing-thread',wrong:'wrong-thread',socket:'socket-thread','no-dir':'no-dir-thread',running:'running-thread','pane-owned':'pane-thread'};
const source=readFileSync(path.join(repo,'services/node/src/server.ts'),'utf8'),ast=ts.createSourceFile('server.ts',source,ts.ScriptTarget.Latest,true);
const bodies=ast.statements.filter(n=>ts.isFunctionDeclaration(n)&&['talkTo','forkChat'].includes(n.name?.text)).map(n=>n.getText(ast)).join('\n').replaceAll('import.meta.dirname',JSON.stringify(path.join(repo,'services/node/src')));
assert.ok(bodies.includes('resumeSupervisedSession')&&bodies.includes('confirmSupervisedResume'));
const context=vm.createContext({path,existsSync,process:{env},listAgents:async()=>[{id:'parent',name:'Parent'}],readCodexRuns:()=>runs,runThread:id=>threads[id],listServiceHosts,resumeSupervisedSession,confirmSupervisedResume,HOSTS_DIR:hosts,run:install,agentsRead:null,listSubagents:()=>({rows:[{id:'claude-child',type:'claude',name:'Child'}]}),cwdOf:new Map(),sessionOf:new Map(),sessionFile:()=>null,herdr:()=>{throw Error('herdr forbidden in fixture');}});
new vm.Script(ts.transpileModule(bodies,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText).runInContext(context);
const runtime={ALLOWED_ORIGINS:new Set(),MACHINE_KEY:'fixture',cwdOf:new Map(),sessionOf:new Map(),forkChat:context.forkChat,talkTo:context.talkTo,listAgents:async()=>[{id:'parent',name:'Parent'}],listEnded:()=>[],machines:()=>[],sayTo:async()=>{throw Error('unrelated live-name route is outside this fixture');},readBody:async req=>{let body='';for await(const chunk of req)body+=chunk;return body;},json:(res,status,body)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(body));}};
const route=agentSessionRoutes(runtime);
const server=http.createServer(async(req,res)=>{try{const done=await route.handle(req,res,[],new URL(req.url,'http://fixture'));if(done===false)res.writeHead(404).end();}catch(e){res.writeHead(500).end(JSON.stringify({error:e.message}));}});
let fakeServer,fakeWs;
try{
  await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin=`http://127.0.0.1:${server.address().port}`;
  const request=async key=>{const response=await fetch(`${origin}/api/agents/parent/subagents/${encodeURIComponent(key)}/talk`,{method:'POST'});return {status:response.status,body:await response.json()};};
  const first=await request('run:good');assert.equal(first.status,200,JSON.stringify(first.body));assert.equal(first.body.started,true);
  const saved=JSON.parse(readFileSync(path.join(hosts,'name-GOOD.json'),'utf8'));assert.equal(saved.session,'original-thread');assert.equal(saved.cwd,root);assert.equal(saved.model,'fixture-model');
  assert.equal(observed().filter(m=>m.method==='thread/start').length,0);assert.equal(observed().filter(m=>m.method==='turn/start').length,0);
  checks.push('actual talk HTTP route waits for exact live original thread without injecting a prompt or starting a fresh thread');
  const reused=await request('run:good');assert.equal(reused.status,200);assert.equal(reused.body.started,false);assert.equal(runners.length,1);
  checks.push('same identity is reused without another install');
  const sent=await context.talkTo('parent','run:good','follow up once');assert.equal(sent.ok,true,JSON.stringify(sent));
  await until(()=>observed().some(m=>m.method==='turn/start'));
  const turns=observed().filter(m=>m.method==='turn/start');assert.equal(turns.length,1);assert.equal(turns[0].params.threadId,'original-thread');assert.equal(turns[0].params.input[0].text,'follow up once');
  checks.push('optional follow-up uses durable queue receipt and reaches original thread exactly once');
  threads.good='unrelated-thread';
  const mismatch=await request('run:good');assert.equal(mismatch.status,409);assert.match(mismatch.body.error,/identity differs/);
  const noSend=await context.talkTo('parent','run:good','must never send');assert.equal(noSend.code,409);assert.equal(observed().filter(m=>m.method==='turn/start').length,1);threads.good='original-thread';
  checks.push('same-name wrong-session route rejected before send or install');
  writeFileSync(path.join(hosts,'fixture-pane.json'),JSON.stringify({name:'ORIGINAL-PANE',harness:'codex',session:'pane-thread',pid:2147483647}));
  const owned=await request('run:pane-owned');assert.equal(owned.status,409);assert.match(owned.body.error,/already has a host owner/);assert.equal(runners.length,1);
  checks.push('pane-owned original session cannot acquire a second differently named service');
  assert.equal((await request('run:no-dir')).status,409);assert.equal((await request('run:running')).status,409);assert.equal((await request('claude-child')).status,409);
  checks.push('missing source CWD, still-running run and unresumable Claude subagent fail explicitly');
  let received=0;const token='isolated-socket-token';
  fakeServer=http.createServer((req,res)=>{res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({pid:process.pid}));});fakeWs=new WebSocketServer({server:fakeServer});
  fakeWs.on('connection',ws=>{ws.send(JSON.stringify({t:'hello',name:'SOCKET',session:'foreign-thread',child:'running'}));ws.on('message',()=>received++);});
  await new Promise(r=>fakeServer.listen(0,'127.0.0.1',r));
  writeFileSync(path.join(hosts,'name-SOCKET.json'),JSON.stringify({name:'SOCKET',harness:'codex',session:'socket-thread',cwd:root,model:'fixture-model',pid:process.pid,port:fakeServer.address().port,token,label:'com.siso.host-SOCKET',state:'idle'}));
  const socketMismatch=await context.talkTo('parent','run:socket','must not reach wrong socket');assert.equal(socketMismatch.code,409);assert.match(socketMismatch.error,/socket identity/);assert.equal(received,0);
  checks.push('authenticated socket greeting mismatch receives zero messages even when saved file matches');
  for(const key of ['missing','wrong']){const result=await request('run:'+key);assert.equal(result.status,409,JSON.stringify(result));assert.ok(!existsSync(path.join(hosts,`name-${key.toUpperCase()}.json`)));}
  assert.equal(observed().filter(m=>m.method==='thread/start').length,0);assert.equal(observed().filter(m=>m.method==='turn/start').length,1);
  checks.push('missing rollout and provider-changed thread both fail closed with no fresh thread, live identity or accidental send');
  const before=readFileSync(path.join(plists,'com.siso.host-GOOD.plist'),'utf8');assert.match(before,/<key>AB_EXACT_RESUME<\/key><string>original-thread<\/string>/);
  await assert.rejects(execute(path.join(repo,'services/host/bin/siso-host-service'),['install','--harness','codex','--name','BAD-EXACT','--label','com.siso.host-BAD-EXACT','--model','fixture-model','--cwd',root,'--resume','original-thread'],{env:{...env,AB_EXACT_RESUME:'different-thread'}}),/Exact resume identity disagrees/);
  assert.ok(!existsSync(path.join(plists,'com.siso.host-BAD-EXACT.plist')));
  checks.push('real controller persists strict identity and rejects a mismatched resume before writing a definition');
  console.log(JSON.stringify({ok:true,count:checks.length,checks,evidence:root,scope:'Real route and lifecycle bodies; synthetic run metadata, launchctl and provider. No production server discovery or live accounts.'}));
}finally{
  for(const child of runners)if(child.exitCode===null)child.kill('SIGTERM');
  await Promise.all(runners.map(child=>child.exitCode===null?new Promise(r=>child.once('exit',r)):Promise.resolve()));
  for(const ws of fakeWs?.clients??[])ws.terminate();
  if(fakeWs)await new Promise(r=>fakeWs.close(r));if(fakeServer)await new Promise(r=>fakeServer.close(r));
  await new Promise(r=>server.close(r));
}
