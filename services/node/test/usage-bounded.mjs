import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

process.env.NODE_ENV='test';process.env.AB_USAGE_COMMAND_MS='120';process.env.AB_USAGE_CACHE_MS='5000';
process.env.AB_BURN_CMD=`${process.execPath} ${path.join(import.meta.dirname,'fixtures/usage/hang.mjs')}`;
process.env.AB_SPLIT_CMD='none';
const {createUsageReader,handleUsage}=await import('../src/usage.ts');
let checks=0;
const check=(condition,name)=>{assert.ok(condition,name);checks++};
const flush=()=>new Promise(resolve=>setImmediate(resolve));
let now=1000,calls=0,resolve,reject;
const reader=createUsageReader(()=>{calls++;return new Promise((yes,no)=>{resolve=yes;reject=no})},()=>now,50);
const first=reader();check(first.status==='pending'&&first.at===null,'cold reading returns explicit pending without awaiting source');
for(let i=0;i<10;i++)reader();await flush();check(calls===1,'concurrent cold readers share one refresh');
now=1005;resolve({source:'stack-opt',data:{fixture:'first'}});await flush();
const fresh=reader();check(fresh.status==='ready'&&fresh.at===1005&&!fresh.stale&&!fresh.refreshing,'successful reading has observed time and fresh status');
now=1055;const stale=reader();check(stale.data.fixture==='first'&&stale.at===1005&&stale.stale&&stale.refreshing,'stale reading returns previous value immediately');
await flush();reject(Error('private credential text'));await flush();
const failed=reader();check(failed.stale&&!failed.refreshing&&failed.at===1005&&failed.data.fixture==='first','failed refresh retains original last-good reading and timestamp');
check(!JSON.stringify(failed).includes('private credential'),'errors do not expose source exception text');
for(let i=0;i<10;i++)reader();await flush();check(calls===2,'failed source respects retry cooldown');
now=1105;reader();await flush();resolve({source:'stack-opt',data:{fixture:'next'}});await flush();
check(reader().data.fixture==='next'&&reader().at===1105&&!reader().stale,'due successful retry replaces last-good reading');
const missing=createUsageReader(async()=>({source:'pending'}),()=>now,50);missing();await flush();check(missing().status==='unavailable'&&missing().source==='pending'&&missing().at===null,'cold failure is explicit unavailable with backwards-compatible source');
const never=createUsageReader(()=>new Promise(()=>{}),()=>now,50);const before=performance.now();check(never().status==='pending'&&performance.now()-before<50,'a non-resolving source cannot block a page read');

const server=http.createServer(async(req,res)=>{if(!await handleUsage(req,res,new URL(req.url,'http://fixture')))res.writeHead(404).end()});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
try{
  const base=`http://127.0.0.1:${server.address().port}`,at=performance.now();
  const response=await fetch(base+'/api/usage'),body=await response.json();
  check(response.status===200&&body.status==='pending'&&performance.now()-at<500,'actual HTTP handler returns cold pending promptly while command is hung');
  let unavailable;
  for(let i=0;i<40;i++){await delay(20);unavailable=await(await fetch(base+'/api/usage')).json();if(unavailable.status==='unavailable')break;}
  check(unavailable?.status==='unavailable'&&!unavailable.refreshing,'hard child deadline clears pending despite SIGTERM-ignoring command');
  check(unavailable.at===null&&unavailable.attemptedAt===body.attemptedAt,'failed command retains unknown observation and original attempt time');
  const later=await(await fetch(base+'/api/usage')).json();check(later.status==='unavailable'&&later.attemptedAt===body.attemptedAt,'HTTP failure cooldown does not spawn a new command');
  check((await fetch(base+'/api/usage',{method:'POST'})).status===405,'GET-only boundary retained');
  check((await fetch(base+'/unrelated')).status===404,'unrelated path remains unhandled');
}finally{await new Promise(resolve=>server.close(resolve));}
// A hung optional split must not discard an otherwise valid burn reading.
// Allow cold Node startup under shared-machine load; the first scenario still proves the 120 ms hard deadline.
process.env.AB_USAGE_COMMAND_MS='1000';
process.env.AB_BURN_CMD=`${process.execPath} ${path.join(import.meta.dirname,'fake-print.mjs')} ${path.join(import.meta.dirname,'fixtures/usage/burn.json')}`;
process.env.AB_SPLIT_CMD=`${process.execPath} ${path.join(import.meta.dirname,'fixtures/usage/hang.mjs')}`;
const splitModule=await import('../src/usage.ts?bounded-split-fixture');
const splitServer=http.createServer(async(req,res)=>{await splitModule.handleUsage(req,res,new URL(req.url,'http://fixture'))});
await new Promise(resolve=>splitServer.listen(0,'127.0.0.1',resolve));
try{
  const url=`http://127.0.0.1:${splitServer.address().port}/api/usage`,at=performance.now();
  const cold=await(await fetch(url)).json();check(cold.status==='pending'&&performance.now()-at<500,'hung optional split does not delay HTTP response');
  let ready;
  for(let i=0;i<250;i++){await delay(20);ready=await(await fetch(url)).json();if(ready.status==='ready')break;}
  check(ready?.source==='stack-opt'&&ready.status==='ready'&&!ready.stale,'valid burn survives optional split deadlines');
  check(ready.data.split.today===null&&ready.data.split.yesterday===null,'unavailable split readings remain null rather than invented');
}finally{await new Promise(resolve=>splitServer.close(resolve));}
console.log(`PASS usage-bounded: ${checks} focused cases; fake hung child terminated, HTTP server closed, no live commands`);
