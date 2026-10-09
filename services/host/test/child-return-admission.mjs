// Actual controller + durable queue contracts. No sockets, hosted runtimes, SDK or provider calls.
import assert from 'node:assert/strict';
import {test, after} from 'node:test';
import {mkdtempSync, readFileSync, writeFileSync, readdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {stripTypeScriptTypes} from 'node:module';
import {CodexChildren, readChildren} from '../src/codex-children.ts';
import {PromptQueue} from '../src/prompt-queue.ts';
import {admitChildReturn,holdChildReturnDispatch} from '../src/child-return.ts';

const root=mkdtempSync(path.join(tmpdir(),'ab-child-returns-'));
process.env.AB_HOSTS_DIR=path.join(root,'hosts'); process.env.AB_PROMPT_QUEUE_DIR=path.join(root,'queues');
let n=0; const controllers=[];
function fixture(returned) {
  const session=`parent-${++n}`, events=[], tasks=[]; let current=session, attempts=0, admissions=0, dispatches=0;
  const queue=new PromptQueue('PARENT',session);
  const owner={name:'PARENT',session:()=>current,task:t=>tasks.push(t),emit:e=>events.push(e),returned:async input=>{
    attempts++; if(returned)return returned(input,{queue,events});
    const {receipt,fresh}=admitChildReturn(queue,input); if(fresh){admissions++;dispatches++;} return receipt;
  }};
  const children=new CodexChildren(owner); controllers.push(children);
  const id=`child-${String(n).padStart(8,'0')}-1111-1111-1111-111111111111`;
  const c={id,name:'CHILD',hostName:'CHILD-11111111',model:'gpt-6.1-sol',effort:'high',cwd:root,parentSession:session,controlToken:'fixture-only',session:`child-${n}`,status:'done',startedAt:1,endedAt:10,tokens:1,tools:0,rate:0,last:null,summary:'first result',resultAt:10,returnedAt:0};
  children.children.set(id,c); children.parentSession=session;
  const conn={active:false,queue:{session:c.session,revision:0,held:false,entries:[]},requests:new Map()};
  return {children,c,conn,queue,events,tasks,owner,session,setSession:s=>current=s,get counts(){return {attempts,admissions,dispatches};}};
}
function observe(f,turnId,summary,at=10,status='completed') {f.c.summary=summary;f.children.observeResult(f.c,{turnId,at,status});return f.children.returnResult(f.c,f.conn);}
const until=async fn=>{for(let i=0;i<150;i++){if(fn())return;await new Promise(r=>setTimeout(r,10));}throw Error('fixture deadline');};
after(async()=>{await Promise.all(controllers.map(c=>c.close()));});

test('pre-admission rejection remains pending, retries once, and acknowledges only an explicit receipt',async()=>{
  let reject=true,admissions=0;const f=fixture(async(input,{queue})=>{if(reject)throw Error('before admission');const x=admitChildReturn(queue,input);if(x.fresh)admissions++;return x.receipt;});
  await observe(f,'turn-one','first result');
  assert.equal(f.c.returnedAt,0);assert.equal(f.events.filter(e=>e.t==='tool_done').length,0);assert.equal(f.c.pendingReturns.length,1);assert.equal(readChildren(f.session)[0].pendingReturns.length,1);
  reject=false;await until(()=>f.c.returnedAt===10);assert.equal(admissions,1);assert.equal(f.c.pendingReturns.length,0);assert.equal(f.events.filter(e=>e.t==='tool_done').length,1);
  await f.children.returnResult(f.c,f.conn);assert.equal(admissions,1);
});

test('lost callback result after durable admission reconciles exact body without dispatching twice',async()=>{
  let lose=true,dispatches=0;const bodies=[];const f=fixture(async(input,{queue})=>{bodies.push(JSON.stringify(input));const x=admitChildReturn(queue,input);if(x.fresh)dispatches++;if(lose)throw Error('after admission');return x.receipt;});
  await observe(f,'turn-one','first result');assert.equal(f.c.returnedAt,0);assert.equal(dispatches,1);
  lose=false;f.c.summary='changed after admission';await f.children.flushReturns(f.c);
  assert.equal(dispatches,1);assert.equal(bodies[0],bodies[1]);assert.equal(f.c.returnedAt,10);assert.equal(f.events.filter(e=>e.t==='tool_done')[0].out,'first result');
});

test('new result while admission awaits keeps two immutable envelopes, including equal timestamps',async()=>{
  let release;const gate=new Promise(r=>release=r),bodies=[];const f=fixture(async(input,{queue})=>{bodies.push(input);if(bodies.length===1)await gate;return admitChildReturn(queue,input).receipt;});
  const first=observe(f,'turn-one','first result');await until(()=>bodies.length===1);
  const second=observe(f,'turn-two','second result');await second;
  assert.equal(readChildren(f.session)[0].pendingReturns.length,2);
  release();await first;
  assert.equal(bodies.length,2);assert.notEqual(bodies[0].key,bodies[1].key);assert.match(bodies[0].text,/first result/);assert.match(bodies[1].text,/second result/);
  assert.equal(Object.keys(f.c.returnReceipts).length,2);assert.equal(f.events.filter(e=>e.t==='tool_done').length,2);
  await observe(f,'turn-two','second result');assert.equal(bodies.length,2);
});

test('duplicate/reentrant observations do not duplicate a pending return',async()=>{
  let release;const gate=new Promise(r=>release=r);const f=fixture(async(input,{queue})=>{await gate;return admitChildReturn(queue,input).receipt;});
  const first=observe(f,'turn-one','same');await f.children.returnResult(f.c,f.conn);await f.children.returnResult(f.c,f.conn);
  assert.equal(f.c.pendingReturns.length,1);assert.equal(f.counts.attempts,1);release();await first;assert.equal(f.events.filter(e=>e.t==='tool_done').length,1);
});

test('staging write failure cannot admit from memory; it retains snapshot and retries persistence',async()=>{
  const f=fixture(),save=f.children.save.bind(f.children);let fail=true;
  f.children.save=()=>{if(fail)throw Error('disk unavailable');save();};
  await observe(f,'turn-one','first result');assert.equal(f.counts.admissions,0);assert.equal(f.c.pendingReturns.length,1);
  await f.children.flushReturns(f.c);assert.equal(f.counts.admissions,0);
  fail=false;await until(()=>f.counts.admissions===1);assert.equal(f.c.returnedAt,10);
});

test('ack write failure retains exact durable envelope and retry never repeats dispatch',async()=>{
  const f=fixture(),save=f.children.save.bind(f.children);let fail=true;
  f.children.save=()=>{if(fail&&f.c.returnReceipts&&Object.keys(f.c.returnReceipts).length)throw Error('ack write failed');save();};
  await observe(f,'turn-one','first result');assert.equal(f.c.returnedAt,0);assert.equal(f.c.pendingReturns.length,1);assert.equal(f.counts.dispatches,1);
  fail=false;await f.children.flushReturns(f.c);assert.equal(f.counts.dispatches,1);assert.equal(f.c.pendingReturns.length,0);assert.equal(f.events.filter(e=>e.t==='tool_done').length,1);
});

test('unknown provider outcome remains held and cancelled admission never replays',async()=>{
  for(const phase of ['unknown','cancelled']){
    let lose=true,dispatches=0;const f=fixture(async(input,{queue})=>{const x=admitChildReturn(queue,input);if(x.fresh){dispatches++;queue.record(input.messageId,phase);}if(lose)throw Error('receipt lost');return admitChildReturn(queue,input).receipt;});
    await observe(f,'turn-one','result');lose=false;await f.children.flushReturns(f.c);
    assert.equal(dispatches,1);assert.equal(f.queue.snapshot().entries[0].phase,phase);assert.equal(f.queue.snapshot().held,phase==='unknown');
    assert.equal(Object.values(f.c.returnReceipts)[0].phase,phase);
  }
});

test('missing/mismatched receipt is never treated as admission',async()=>{
  for(const value of [undefined,{t:'prompt.receipt',key:'wrong',id:'wrong',phase:'saved',queueRevision:1},{t:'prompt.receipt',key:'wrong',id:'wrong',phase:'failed',queueRevision:1}]){
    const f=fixture(async()=>value);await observe(f,'one','result');assert.equal(f.c.returnedAt,0);assert.equal(f.c.pendingReturns.length,1);assert.equal(f.events.filter(e=>e.t==='tool_done').length,0);
  }
});

test('restart reconciles pending result without reconnecting a dead child, preserving all ledger rows',async()=>{
  const f=fixture(async()=>{throw Error('before admission');});await observe(f,'one','result');await f.children.close();
  let admissions=0;const resumed=new CodexChildren({...f.owner,returned:async input=>{admissions++;return admitChildReturn(f.queue,input).receipt;}});controllers.push(resumed);
  resumed.connect=async()=>{throw Error('child gone');};await resumed.restore();await until(()=>readChildren(f.session)[0].pendingReturns.length===0);
  assert.equal(admissions,1);assert.equal(readChildren(f.session)[0].returnedAt,10);
});

test('session replacement cannot send or acknowledge an old child result into a new parent',async()=>{
  let release;const gate=new Promise(r=>release=r);const f=fixture(async(input,{queue})=>{const receipt=admitChildReturn(queue,input).receipt;await gate;return receipt;});
  const work=observe(f,'one','old parent result');f.setSession('different-parent');release();await work;
  assert.equal(f.c.returnedAt,0);assert.equal(f.c.pendingReturns.length,1);await f.children.flushReturns(f.c);assert.equal(f.counts.attempts,1);
  f.setSession(f.session);await f.children.flushReturns(f.c);assert.equal(f.c.returnedAt,10);assert.equal(f.queue.snapshot().entries.length,1);
});

test('legacy acknowledged timestamps are not replayed, while later identified turns still return',async()=>{
  const f=fixture();f.c.returnedAt=10;f.children.observeResult(f.c,{at:5,turnId:'historical',status:'completed'},true);await f.children.returnResult(f.c,f.conn);assert.equal(f.counts.admissions,0);
  await observe(f,'new-turn','new result',10);assert.equal(f.counts.admissions,1);
  const legacy=fixture();legacy.c.returnedAt=10;await legacy.children.returnResult(legacy.c,legacy.conn);assert.equal(legacy.counts.admissions,0);
});

test('restored stable identity ignores different replay timestamp and preserves interrupted result',async()=>{
  const f=fixture();await observe(f,'one','stopped result',40,'interrupted');f.children.observeResult(f.c,{at:5,turnId:'one',status:'interrupted'},true);await f.children.returnResult(f.c,f.conn);
  assert.equal(f.counts.admissions,1);assert.equal(f.c.status,'stopped');assert.equal(f.events.filter(e=>e.t==='tool_done')[0].ok,false);
});

test('active child and queued child work defer capturing a result',async()=>{
  const f=fixture();f.conn.active=true;await observe(f,'one','result');assert.equal(f.counts.admissions,0);f.conn.active=false;
  f.conn.queue.entries=[{phase:'saved'}];await f.children.returnResult(f.c,f.conn);assert.equal(f.counts.admissions,0);f.conn.queue.entries=[];
  await f.children.returnResult(f.c,f.conn);assert.equal(f.counts.admissions,1);
});

test('close cancels local retries and cannot manufacture acknowledgement',async()=>{
  const f=fixture(async()=>{throw Error('before admission');});await observe(f,'one','result');await f.children.close();await new Promise(r=>setTimeout(r,1050));
  assert.equal(f.counts.attempts,1);assert.equal(f.c.returnedAt,0);assert.equal(f.c.pendingReturns.length,1);
});

test('launch failure uses the same durable admission protocol',async()=>{
  const f=fixture();f.children.initialized=true;f.children.launch=async()=>{throw Error('synthetic launch failure');};
  const child=await f.children.call('spawn_codex',{name:'FAILED',brief:'fixture',cwd:root});await until(()=>f.events.some(e=>e.t==='tool_done'&&e.id===child.id));
  assert.equal(f.counts.admissions,1);assert.equal(f.events.find(e=>e.t==='tool_done'&&e.id===child.id).ok,false);assert.match(f.queue.snapshot().entries[0].text,/synthetic launch failure/);
});

test('both actual parent callbacks dedupe across turn changes and respect held queues',async()=>{
  for(const harness of ['host','codex-host']){
    const source=readFileSync(new URL(`../src/${harness}.ts`,import.meta.url),'utf8');
    const start=source.indexOf('returned: async input => {')+'returned: '.length,end=source.indexOf('\n} });',start)+2;
    const body=source.slice(start,end);let scheduled=[];const calls=[];const queue=new PromptQueue(`callback-${harness}`,`callback-${harness}`);
    const callback=new Function('admitChildReturn','holdChildReturnDispatch','queueStore','setImmediate','calls',`
      let rootEpoch='turn-a',turnId='turn-a',compacting=false,starting=false,child='running',closing=false,shuttingDown=false;
      const emit=x=>calls.push(['emit',x]),publishQueue=()=>{},snapshot=()=>{},error=e=>{throw e},offerClaude=(...x)=>calls.push(['offer',...x]),drainNext=()=>calls.push(['drain']),drain=()=>{calls.push(['drain']);return Promise.resolve()},steer=(id,target)=>{const entry=queueStore.claim(id);if(entry)calls.push(['steer',id,target]);return Promise.resolve()};
      return {returned:${body},turn:id=>{rootEpoch=turnId=id},stop:()=>{child='stopped'}};
    `)(admitChildReturn,holdChildReturnDispatch,queue,fn=>scheduled.push(fn),calls);
    const input={t:'prompt',text:'return',key:`callback-${harness}-one`,messageId:`callback-${harness}-one`,images:[],delivery:'auto',from:'pane'};
    await callback.returned(input);callback.turn('turn-b');await callback.returned(input);assert.equal(scheduled.length,1);scheduled.shift()();
    const sent=calls.filter(x=>['steer','offer'].includes(x[0]));assert.equal(sent.length,1);if(harness==='codex-host')assert.equal(sent[0][2],'turn-b');
    await callback.returned(input);assert.equal(scheduled.length,0);
    queue.hold();await callback.returned({...input,key:input.key+'held',messageId:input.key+'held'});scheduled.shift()();assert.equal(calls.filter(x=>['steer','offer'].includes(x[0])).length,1);
    assert.equal(queue.snapshot().held,true);
    queue.command({t:'queue.resume',key:input.key+'resume',expectedRevision:queue.snapshot().revision});
    const failed={...input,key:input.key+'failed',messageId:input.key+'failed'};
    await callback.returned(failed);const claim=queue.claim.bind(queue);queue.claim=()=>{throw Error('claim fsync failed');};
    // A delayed failure is contained; admission remains durable and the queue held.
    await scheduled.shift()();queue.claim=claim;assert.equal(queue.snapshot().held,true);
    await callback.returned(failed);assert.equal(scheduled.length,0);
  }
});

test('actual Codex replay emits only terminal statuses with provider turn identity',()=>{
  const source=readFileSync(new URL('../src/codex-host.ts',import.meta.url),'utf8');
  const start=source.indexOf('  for (const turn of result.thread.turns ?? []) {'),end=source.indexOf('\n  await new Promise<void>',start);
  const run=new Function('result','codexItem','log',source.slice(start,end));const log=[];
  run({thread:{createdAt:1,turns:[{id:'one',status:'completed'},{id:'two',status:'interrupted'},{id:'three',status:'failed'},{id:'four',status:'inProgress'},{id:'five'}]}},()=>[],log);
  assert.deepEqual(log.map(x=>[x.turnId,x.status]),[['one','completed'],['two','interrupted'],['three','failed']]);
  assert.match(source,/emit\(\{ t: "result", turnId: p\.turn\.id, status: p\.turn\.status/);
});

test('real process crashes before admission, after admission, during provider handoff, before ack and after ack recover safely',()=>{
  for(const point of ['before-admission','after-admission','during-provider','before-ack','after-ack']){
    const dir=mkdtempSync(path.join(root,`crash-${point}-`)),worker=new URL('./child-return-crash-worker.mjs',import.meta.url);
    let crash;
    try{execFileSync(process.execPath,['--experimental-strip-types','--no-warnings',worker.pathname,point,dir],{timeout:5000});}catch(e){crash=e;}
    assert.equal(crash?.status,73,point);
    const resumed=JSON.parse(execFileSync(process.execPath,['--experimental-strip-types','--no-warnings',worker.pathname,'restore',dir],{timeout:5000,encoding:'utf8'}));
    assert.equal(resumed.child.pendingReturns.length,0,point);assert.equal(resumed.child.returnedAt,10,point);assert.equal(resumed.queue.entries.length,1,point);
    assert.equal(resumed.dispatches,['before-admission','during-provider'].includes(point)?1:0,point);
    if(point==='during-provider'){assert.equal(resumed.queue.held,true);assert.equal(resumed.queue.entries[0].phase,'unknown');}
    if(['after-admission','before-ack','after-ack'].includes(point)){assert.equal(resumed.queue.held,true);assert.equal(resumed.queue.entries[0].phase,'saved');}
    assert.equal(resumed.admissions,point==='before-admission'?1:0,point);
  }
});


test('unexpected partially offered dispatch is quarantined, while confirmed phases stay intact',()=>{
  for(const phase of ['saved','dispatching','offered','accepted','started','cancelled']){
    const q=new PromptQueue(`quarantine-${phase}`,`quarantine-${phase}`),key=`return-${phase}`;
    q.command({t:'prompt',text:'fixture',key,messageId:key,images:[],delivery:'auto',from:'pane'});q.record(key,phase);
    holdChildReturnDispatch(q,key);assert.equal(q.snapshot().held,true);assert.equal(q.snapshot().entries[0].phase,['dispatching','offered'].includes(phase)?'unknown':phase);
  }
});


test('hello captures only the selected terminal turn output, ignoring newer unfinished text',()=>{
  const source=readFileSync(new URL('../src/codex-children.ts',import.meta.url),'utf8');
  const start=source.indexOf('          const lastIndex = e.log.findLastIndex'),end=source.indexOf('          if (conn.active)',start);
  const replay=new Function('e','c',stripTypeScriptTypes(source.slice(start,end))),f=fixture();
  replay.call(f.children,{log:[{t:'text',text:'old output'},{t:'result',turnId:'old',at:4,status:'completed'},{t:'text',text:'correct final output'},{t:'result',turnId:'new',at:5,status:'completed'},{t:'text',text:'unfinished future output'}]},f.c);
  assert.equal(f.c.summary,'correct final output');
  replay.call(f.children,{log:[{t:'text',text:'old output'},{t:'result',turnId:'old',at:4,status:'completed'},{t:'result',turnId:'failed',at:5,status:'failed'}]},f.c);
  assert.equal(f.c.summary,null);assert.equal(f.c.status,'failed');
});
