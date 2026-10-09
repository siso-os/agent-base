// JSON routing/origin checks use one scratch Git worktree and a fake local host, never fleet recipients.
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, realpathSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { once } from 'node:events';
import { WebSocketServer } from 'ws';
const root=path.resolve(import.meta.dirname,'../../..'),scratch=realpathSync(mkdtempSync('/tmp/ab-changes-http-'));
const repo=path.join(scratch,'repo'),cwd=path.join(scratch,'worktree'),hosts=path.join(scratch,'hosts');mkdirSync(repo);mkdirSync(hosts);
const git=(cwd,args)=>execFileSync('git',['-C',cwd,...args],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
git(repo,['init','-b','dev']);git(repo,['config','user.name','Fixture']);git(repo,['config','user.email','fixture@example.invalid']);writeFileSync(path.join(repo,'one.txt'),'old\n');git(repo,['add','.']);git(repo,['commit','-m','base']);git(repo,['update-ref','refs/remotes/origin/dev','HEAD']);git(repo,['worktree','add','-b','job/http-fixture',cwd,'HEAD']);writeFileSync(path.join(cwd,'one.txt'),'new\n');
// One file exceeds preview budget; a later file must still exist in the independent file inventory.
writeFileSync(path.join(cwd,'big-text.txt'),'a\n'.repeat(70000));writeFileSync(path.join(cwd,'tail.txt'),'tail\n');
const fake=http.createServer((req,res)=>res.writeHead(200,{'content-type':'application/json'}).end(JSON.stringify({pid:process.pid})));fake.listen(0,'127.0.0.1');await once(fake,'listening');
const messages=[],token='synthetic-http-token',queue=[];
const wss=new WebSocketServer({server:fake});wss.on('connection',ws=>{ws.send(JSON.stringify({t:'hello',session:'http-session',child:'running',capabilities:{version:1},queue:{entries:queue}}));ws.on('message',raw=>{const m=JSON.parse(String(raw));if(m.t==='prompt'){messages.push(m);queue.push({key:m.key,id:m.messageId,phase:'accepted',providerTurnId:'http-native-1'});ws.send(JSON.stringify({t:'prompt.receipt',key:m.key,id:m.messageId,phase:'accepted'}));}});});
writeFileSync(path.join(hosts,'name-HTTP.json'),JSON.stringify({pid:process.pid,port:fake.address().port,token,name:'HTTP',session:'http-session',cwd,harness:'codex',child:'running'}));
const herdr=path.join(scratch,'fake-herdr.mjs');writeFileSync(herdr,"#!/usr/bin/env node\nconsole.log(JSON.stringify({result:{agents:[]}}));\n",{mode:0o700});
const portServer=http.createServer();portServer.listen(0,'127.0.0.1');await once(portServer,'listening');const port=portServer.address().port;await new Promise(r=>portServer.close(r));
const env={...process.env,AB_PORT:String(port),AB_MACHINE_KEY:'fixture',AB_STATE:path.join(scratch,'rows.json'),AB_REGISTRY:path.join(scratch,'registry.json'),AB_ENDED:path.join(scratch,'ended.jsonl'),AB_ATTENTION_DIR:path.join(scratch,'attention'),AB_ACTIVITY_DIR:path.join(scratch,'activity'),AB_HOSTS_DIR:hosts,AB_WORKSPACES_DIR:path.join(scratch,'receipts'),AB_HERDR:herdr,AB_LAUNCHCTL:'/usr/bin/false',AB_CTX_DIR:scratch,AB_RESURRECT_DIR:scratch,AB_A0_SEAT:path.join(scratch,'seat.json'),AB_CONSOLE_EVENTS:path.join(scratch,'console.jsonl'),AB_MACHINES_FILE:path.join(scratch,'machines.json'),AB_APP_ROOT:root,AB_SUPERVISED:'0'};
const node=spawn(process.execPath,['--experimental-strip-types','--no-warnings',path.join(root,'services/node/src/server.ts')],{env,stdio:'ignore'});
const base=`http://127.0.0.1:${port}`,url=base+'/api/agents/service-HTTP/changes';let count=0;const ok=name=>console.log(`PASS ${++count}: ${name}`);
const request=async(pathname,body,headers={})=>{const r=await fetch(pathname,{...(body?{method:'POST',body:JSON.stringify(body)}:{}),headers:{'content-type':'application/json',...headers}});return {status:r.status,body:await r.json()};};
try {
  let ready=false;for(let i=0;i<100;i++){try{if((await fetch(base+'/api/version')).ok){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,50));}assert.ok(ready,'isolated node booted');
  const p=await request(url+'?sessionId=http-session');assert.equal(p.status,200);assert.equal(p.body.files.length,3);assert.equal(p.body.truncated,true);assert.ok(p.body.files.some(f=>f.newPath==='tail.txt'));assert.ok(!JSON.stringify(p.body).includes(token));assert.ok(!JSON.stringify(p.body).includes(cwd));ok('GET preview HTTP 200; bounded patch preserves full inventory; no cwd/token in contract');
  const f=p.body.files.find(f=>f.newPath==='one.txt'),revisionId=p.body.revision.id,reviewKey=p.body.identity.reviewKey,sessionId='http-session';
  const expanded=await request(`${url}/files/${f.id}?sessionId=${sessionId}&revisionId=${revisionId}`);assert.equal(expanded.status,200);assert.equal(expanded.body.newText,'new\n');ok('GET pinned file HTTP 200 with semantic hunks');
  const comment=await request(url+'/comments',{sessionId,reviewKey,revisionId,fileId:f.id,start:{side:'old',line:1},text:'Keep this behavior'});assert.equal(comment.status,201);assert.equal((await request(url+'/comments?sessionId='+sessionId)).body.comments[0].id,comment.body.id);ok('POST create HTTP 201 and GET list HTTP 200');
  const denied=await request(url+'/feedback',{},{origin:'https://untrusted.invalid'});assert.equal(denied.status,403);assert.equal(messages.length,0);ok('mutation origin check HTTP 403 before host I/O');
  const batch={version:1,clientKey:'http-batch',sessionId,reviewKey,revisionId,commentIds:[comment.body.id]};const sent=await request(url+'/feedback',batch);assert.equal(sent.status,202);assert.equal(sent.body.status,'submitted');const receipt=await request(url+'/feedback/http-batch?sessionId='+sessionId);assert.equal(receipt.status,200);assert.equal((await request(url+'/feedback',batch)).body.batchId,sent.body.batchId);assert.equal(messages.length,1);assert.equal(messages[0].delivery,'next');ok('POST batch HTTP 202, GET receipt HTTP 200; one host message and idempotent retry');
  const resolved=await request(url+'/comments/'+comment.body.id+'/resolve',{sessionId,reviewKey});assert.equal(resolved.status,200);assert.equal(resolved.body.state,'resolved');ok('POST resolve HTTP 200');
  const stale=await request(url+'?sessionId=another-session');assert.equal(stale.status,409);assert.equal(stale.body.error.code,'stale-recipient');const target=await request(url+'?sessionId='+sessionId+'&targetRef=missing-target');assert.equal(target.status,409);assert.equal(target.body.error.code,'target-unavailable');ok('stale recipient/unknown target HTTP 409 retain typed errors');
  assert.equal((await request(base+'/api/changes/turns',{sessionId,turnId:'http-turn',phase:'baseline'})).status,403);
  assert.equal((await request(base+'/api/changes/turns',{sessionId,turnId:'http-turn',phase:'baseline'},{authorization:'Bearer '+token})).status,200);writeFileSync(path.join(cwd,'turn.txt'),'turn edit\n');assert.equal((await request(base+'/api/changes/turns',{sessionId,turnId:'http-turn',phase:'completion',providerTurnId:'provider-http-turn',status:'completed'},{authorization:'Bearer '+token})).status,200);
  const turn=await request(url+'?sessionId='+sessionId+'&scope=turn&turnId=provider-http-turn');assert.equal(turn.status,200);assert.deepEqual(turn.body.files.map(f=>f.newPath),['turn.txt']);ok('host-only boundaries HTTP 403/200; provider-ID turn review HTTP 200');
  console.log(`RESULT: ${count} HTTP checks passed; scratch=${scratch}`);
} finally {if(node.exitCode===null){const exited=once(node,'exit');node.kill('SIGTERM');await exited;}for(const ws of wss.clients)ws.terminate();await new Promise(r=>wss.close(r));fake.closeAllConnections();await new Promise(r=>fake.close(r));}
