import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { routes,bugId,allowedRequest,walk,fixtureResponse } from '../ab-qa-walk.mjs';
const sha='a'.repeat(40);
test('inventory covers spaces, app pages and library routes once',()=>{
 assert.equal(routes.length,25);assert.equal(new Set(routes.map(r=>r.id)).size,25);
 for(const id of ['agents','tasks','servers','tokens','whatsapp','library-docs','research','estate','canvas','product-map'])assert.ok(routes.find(r=>r.id===id));
});
test('request gate excludes writes, sockets, live API and external destinations',()=>{
 const origin='http://127.0.0.1:4567';
 assert.ok(allowedRequest('GET',origin+'/assets/app.js',origin));
 for(const [method,url] of [['POST',origin+'/'],['GET',origin+'/api/agents'],['GET',origin+'/chat/a/ws'],['GET','http://127.0.0.1:5401/'],['GET','wss://example.com/']])assert.equal(allowedRequest(method,url,origin),false);
});
test('bug identity is stable across random fixture ports, revisions and widths',()=>{
 assert.equal(bugId('tasks','render','http://127.0.0.1:42/x'),bugId('tasks','render','http://127.0.0.1:87/x'));
 assert.notEqual(bugId('tasks','render','bad'),bugId('stats','render','bad'));
});
test('missing or mismatched build cannot produce clean receipt',async()=>{
 const tmp=mkdtempSync(path.join(tmpdir(),'.siso-ephemeral-qa-walk.'));
 try{
  const build=path.join(tmp,'build');mkdirSync(build);writeFileSync(path.join(build,'DEPLOYED_SHA'),'b'.repeat(40));
  const result=await walk({revision:sha,out:path.join(tmp,'out'),build,browserType:{launch(){assert.fail('must not launch')}}});
  assert.equal(result.state,'blocked');assert.match(result.reason,/mismatch/);assert.equal(JSON.parse(readFileSync(path.join(tmp,'out/walk.json'))).state,'blocked');
 }finally{rmSync(tmp,{recursive:true});}
});
test('browser failure writes blocked receipt and closes owned server',async()=>{
 const tmp=mkdtempSync(path.join(tmpdir(),'.siso-ephemeral-qa-walk.'));
 try{
  const build=path.join(tmp,'build');mkdirSync(build);writeFileSync(path.join(build,'DEPLOYED_SHA'),sha);writeFileSync(path.join(build,'index.html'),'<div id="root">fixture</div>');
  const result=await walk({revision:sha,out:path.join(tmp,'out'),build,browserType:{async launch(){throw new Error('unavailable')}}});
  assert.equal(result.state,'blocked');assert.match(result.reason,/unavailable/);
 }finally{rmSync(tmp,{recursive:true});}
});
test('headless synthetic walk blocks attempted POST/socket and retains deduplicated error shots',async()=>{
 const {createRequire}=await import('node:module');
 const {webkit}=createRequire(path.resolve('services/node/package.json'))('playwright');
 const tmp=mkdtempSync(path.join(tmpdir(),'.siso-ephemeral-qa-headless.'));
 try{
  const build=path.join(tmp,'build');mkdirSync(build);writeFileSync(path.join(build,'DEPLOYED_SHA'),sha);
  writeFileSync(path.join(build,'index.html'),`<div id="root">Synthetic walker safety fixture content</div><script>
  fetch('/api/unsafe', {method:'POST'}).catch(()=>{});
  fetch('/estate-world/', {method:'POST'}).catch(()=>{});
  fetch('http://127.0.0.1:5401/api/agents').catch(()=>{});
  new WebSocket(location.origin.replace('http','ws')+'/chat/live/ws');
  setTimeout(()=>{throw new Error('synthetic render failure')},100);
  </script>`);
  const inventory=[{id:'synthetic',space:'agents'}];
  const out=path.join(tmp,'out');
  const first=await walk({revision:sha,out,build,browserType:webkit,inventory});
  assert.equal(first.state,'failed');assert.equal(first.routes.length,2);
  assert.ok(first.routes.every(r=>r.blockedRequests.some(x=>x.method==='POST')));
  assert.ok(first.routes.every(r=>r.blockedRequests.some(x=>x.method==='POST' && x.path==='/estate-world/')));
  assert.ok(first.routes.every(r=>r.blockedRequests.some(x=>x.path==='/api/agents')));
  assert.ok(first.routes.every(r=>readFileSync(r.shot).length>100));
  const second=await walk({revision:sha,out,build,browserType:webkit,inventory});
  assert.deepEqual(second.bugs,first.bugs);
  assert.equal(Object.keys(JSON.parse(readFileSync(path.join(tmp,'bugs.json')))).length,first.bugs.length);
 }finally{rmSync(tmp,{recursive:true});}
});

test('domain fixtures are bounded synthetic contracts; unknown endpoints remain unavailable',()=>{
 for(const route of ['/api/whatsapp/chats','/api/life/xp','/api/rolodex','/api/library','/api/voice/history','/api/servers','/api/tokens','/api/releases','/api/research','/api/product-map','/api/delight','/api/remote/agents']) {
  const value=fixtureResponse(route,sha);assert.notEqual(value,undefined,route);assert.ok(JSON.stringify(value).length<50000,route);
 }
 assert.equal(fixtureResponse('/api/unknown-live-contract',sha),undefined);
 assert.equal(fixtureResponse('/api/product-map',sha).rows[0].rating,null);
 for(const task of fixtureResponse('/api/a0/tasks',sha).tasks)if(task.shots)for(const url of Object.values(task.shots))assert.match(decodeURIComponent(url),/^data:image\/svg\+xml,.*Synthetic (before|after) fixture/);
 assert.equal(fixtureResponse('/api/whatsapp/health',sha).appSendEnabled,false);
 const delivery=fixtureResponse('/api/delight',sha);
 assert.deepEqual(delivery.deliveries,[]);assert.match(delivery.error,/Synthetic.*no joined live delivery evidence/);
 const remote=fixtureResponse('/api/remote/agents',sha);
 assert.deepEqual({...remote,at:0},{enabled:false,configured:false,readOnly:true,at:0,sources:[]});
 assert.ok(Number.isFinite(remote.at) && remote.at>=0);
});

test('missing fixture is blocked and destination fallback cannot pass',async()=>{
 const {createRequire}=await import('node:module');
 const {webkit}=createRequire(path.resolve('services/node/package.json'))('playwright');
 const tmp=mkdtempSync(path.join(tmpdir(),'.siso-ephemeral-qa-missing.'));
 try{
  const build=path.join(tmp,'build');mkdirSync(build);writeFileSync(path.join(build,'DEPLOYED_SHA'),sha);
  writeFileSync(path.join(build,'index.html'),'<div id="root">Synthetic application shell is visible</div><script>fetch("/api/unimplemented-contract").catch(()=>{})</script>');
  const result=await walk({revision:sha,out:path.join(tmp,'out'),build,browserType:webkit,inventory:[{id:'synthetic',space:'agents'},{id:'canvas',space:'agents'},{id:'library-works',space:'library',hash:'#library/works'}],widths:[390]});
  assert.equal(result.routes[0].state,'blocked');assert.deepEqual(result.routes[0].missingFixtures,['/api/unimplemented-contract']);
  assert.equal(result.routes[1].state,'failed');assert.ok(result.routes[1].errors.includes('requested destination not rendered: canvas'));
  assert.equal(result.routes[2].state,'failed');assert.ok(result.routes[2].errors.includes('requested Library tab not rendered: library-works'));
 }finally{rmSync(tmp,{recursive:true});}
});

test('visible Estate blocker stays blocked, while hidden frames and real errors still fail',async()=>{
 const {createRequire}=await import('node:module');
 const {webkit}=createRequire(path.resolve('services/node/package.json'))('playwright');
 const tmp=mkdtempSync(path.join(tmpdir(),'.siso-ephemeral-qa-estate.'));
 try{
  const build=path.join(tmp,'build');mkdirSync(build);writeFileSync(path.join(build,'DEPLOYED_SHA'),sha);
  for(const scenario of ['visible','hidden','render-error']){
   writeFileSync(path.join(build,'index.html'),`<div id="root" style="height:800px"><iframe title="Estate world" src="/estate-world/" style="${scenario==='hidden'?'display:none':'width:100%;height:700px'}"></iframe></div>${scenario==='render-error'?'<script>setTimeout(()=>{throw new Error("independent render failure")},100)</script>':''}`);
   const result=await walk({revision:sha,out:path.join(tmp,scenario),build,browserType:webkit,inventory:[{id:'estate',space:'estate'}],widths:scenario==='visible'?[1440,390]:[390]});
   assert.equal(result.state,scenario==='visible'?'blocked':'failed');
   for(const row of result.routes){
    assert.ok(row.missingFixtures.includes('companion:estate-world synthetic bundle unavailable'));
    assert.equal(row.estatePlaceholderVisible,scenario!=='hidden');
    if(scenario==='visible'){assert.deepEqual(row.errors,[]);assert.ok(row.bodyExcerpt.trim().length<20);}
    else assert.ok(row.errors.includes(scenario==='hidden'?'empty rendered application':'independent render failure'));
   }
  }
 }finally{rmSync(tmp,{recursive:true});}
});
