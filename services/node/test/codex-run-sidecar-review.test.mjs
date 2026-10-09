import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {syncBuiltinESMExports} from 'node:module';
import {pathToFileURL,fileURLToPath} from 'node:url';
const candidate=fileURLToPath(new URL('../src/codex-runs.ts',import.meta.url));
const original=candidate;
const oldTasks=process.env.AB_A0_TASKS,ticketRoot=fs.mkdtempSync(path.join(os.tmpdir(),'sidecar-tickets-'));process.env.AB_A0_TASKS=ticketRoot;
after(()=>{fs.rmSync(ticketRoot,{recursive:true,force:true});if(oldTasks===undefined)delete process.env.AB_A0_TASKS;else process.env.AB_A0_TASKS=oldTasks;});
const now=Date.UTC(2026,9,5,21), parent={session:'review'}, opts={includeItems:false};
let n=0;
const fresh=f=>import(pathToFileURL(f).href+'?review='+ ++n);
const makeRoot=()=>fs.mkdtempSync(path.join(os.tmpdir(),'sidecar-review-'));
function makeRun(root,id='run',meta={}){const p=path.join(root,id);fs.writeFileSync(p+'.meta.json',JSON.stringify({started:now,pid:process.pid,parent_session:parent.session,...meta}));fs.writeFileSync(p+'.jsonl','');return p;}
function monitor(fn, intercept){const old=fs.readFileSync,reads=[];fs.readFileSync=function(file,...args){reads.push(String(file));if(intercept)intercept(String(file));return old.call(this,file,...args);};syncBuiltinESMExports();try{return {value:fn(),reads};}finally{fs.readFileSync=old;syncBuiltinESMExports();}}
const sideReads=reads=>reads.filter(f=>/\.(last|task|prompt)\.md$/.test(f));
const ids=row=>row.tickets.map(t=>t.id);

test('stable fallback, whitespace, TASK priority, metadata union, status and mtime parity',async()=>{
 const root=makeRoot();try{
 const a=await fresh(original),b=await fresh(candidate);const p=makeRun(root,'run',{task:'meta t-0009',tickets:['t-0008','wrong',1,'t-0008']});
 const compare=()=>assert.deepEqual(b.readCodexRuns(now,root,parent,opts),a.readCodexRuns(now,root,parent));
 compare();
 fs.writeFileSync(p+'.prompt.md','other t-0001\nTASK t-0002 t-0002\nother t-0003');compare();assert.deepEqual(ids(b.readCodexRuns(now,root,parent,opts)[0]),['t-0008','t-0002']);
 fs.writeFileSync(p+'.task.md','');compare();
 fs.writeFileSync(p+'.task.md',' ');compare();assert.deepEqual(ids(b.readCodexRuns(now,root,parent,opts)[0]),['t-0008']);
 fs.writeFileSync(p+'.task.md','TASK t-0004 t-0008');compare();
 for(const content of ['STATUS: done','STATUS: FAILED','noise STATUS:\n blocked','no status','']){fs.writeFileSync(p+'.last.md',content);compare();}
 fs.unlinkSync(p+'.last.md');compare();fs.unlinkSync(p+'.task.md');compare();fs.unlinkSync(p+'.prompt.md');compare();
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});

test('read failure retries on unchanged stamp, falls back, and preserves result mtime',async()=>{
 const root=makeRoot();try{
 const b=await fresh(candidate);const p=makeRun(root,'run',{task:'t-0009'});
 fs.writeFileSync(p+'.last.md','STATUS: done');fs.writeFileSync(p+'.task.md','TASK t-0001');fs.writeFileSync(p+'.prompt.md','TASK t-0002');
 const fail=monitor(()=>b.readCodexRuns(now,root,parent,opts),f=>{if(f===p+'.task.md'||f===p+'.last.md')throw Object.assign(new Error('synthetic EIO'),{code:'EIO'});});
 assert.equal(fail.value[0].ended,fs.statSync(p+'.last.md').mtimeMs);assert.equal(fail.value[0].running,false);assert.equal(fail.value[0].status,'blocked');assert.deepEqual(ids(fail.value[0]),['t-0002']);
 const retry=monitor(()=>b.readCodexRuns(now,root,parent,opts));assert.ok(retry.reads.includes(p+'.task.md'));assert.ok(retry.reads.includes(p+'.last.md'));assert.equal(retry.value[0].status,'done');assert.deepEqual(ids(retry.value[0]),['t-0001']);
 assert.equal(sideReads(monitor(()=>b.readCodexRuns(now,root,parent,opts)).reads).length,0);
 fs.writeFileSync(p+'.task.md','TASK t-0003');
 assert.deepEqual(ids(monitor(()=>b.readCodexRuns(now,root,parent,opts),f=>{if(f===p+'.task.md')throw Error('retry fail');}).value[0]),['t-0002']);
 assert.deepEqual(ids(b.readCodexRuns(now,root,parent,opts)[0]),['t-0003']);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});

test('same-size restored-mtime rewrite, inode rotation and symlink retarget invalidate',async()=>{
 const root=makeRoot();try{
 const b=await fresh(candidate);const p=makeRun(root);fs.writeFileSync(p+'.task.md','TASK t-0001');fs.writeFileSync(p+'.last.md','STATUS: done');
 b.readCodexRuns(now,root,parent,opts);const old=fs.statSync(p+'.task.md');
 fs.writeFileSync(p+'.task.md','TASK t-0002');fs.utimesSync(p+'.task.md',old.atime,old.mtime);
 assert.deepEqual(ids(b.readCodexRuns(now,root,parent,opts)[0]),['t-0002']);
 fs.renameSync(p+'.task.md',p+'.old');fs.writeFileSync(p+'.task.md','TASK t-0003');assert.deepEqual(ids(b.readCodexRuns(now,root,parent,opts)[0]),['t-0003']);
 fs.unlinkSync(p+'.task.md');fs.writeFileSync(p+'.one','TASK t-0004');fs.writeFileSync(p+'.two','TASK t-0005');fs.symlinkSync(p+'.one',p+'.task.md');assert.deepEqual(ids(b.readCodexRuns(now,root,parent,opts)[0]),['t-0004']);
 fs.unlinkSync(p+'.task.md');fs.symlinkSync(p+'.two',p+'.task.md');assert.deepEqual(ids(b.readCodexRuns(now,root,parent,opts)[0]),['t-0005']);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});

test('ticket cap declines admission without dropping tickets, including changed admitted file',async()=>{
 const root=makeRoot();try{
 const b=await fresh(candidate);const p=makeRun(root);const text=n=>'TASK '+Array.from({length:n},(_,i)=>'t-'+String(i).padStart(4,'0')).join(' ');
 fs.writeFileSync(p+'.task.md',text(64));assert.equal(ids(b.readCodexRuns(now,root,parent,opts)[0]).length,64);assert.equal(sideReads(monitor(()=>b.readCodexRuns(now,root,parent,opts)).reads).length,0);
 fs.writeFileSync(p+'.task.md',text(65));assert.equal(ids(b.readCodexRuns(now,root,parent,opts)[0]).length,65);assert.deepEqual(sideReads(monitor(()=>b.readCodexRuns(now,root,parent,opts)).reads),[p+'.task.md']);
 fs.writeFileSync(p+'.task.md',text(1));assert.equal(ids(b.readCodexRuns(now,root,parent,opts)[0]).length,1);assert.equal(sideReads(monitor(()=>b.readCodexRuns(now,root,parent,opts)).reads).length,0);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});

test('cap is scan resistant; metadata-only removal reclaims orphan sidecar capacity',async()=>{
 const root=makeRoot();try{
 const b=await fresh(candidate);
 for(let i=0;i<2049;i++){const p=makeRun(root,'run-'+String(i).padStart(4,'0'));fs.writeFileSync(p+'.last.md','STATUS: done');fs.writeFileSync(p+'.task.md','TASK t-0001');}
 b.readCodexRuns(now,root,parent,opts);
 assert.equal(sideReads(monitor(()=>b.readCodexRuns(now,root,parent,opts)).reads).length,2);
 fs.unlinkSync(path.join(root,'run-0000.meta.json'));
 b.readCodexRuns(now,root,parent,opts);
 assert.equal(sideReads(monitor(()=>b.readCodexRuns(now,root,parent,opts)).reads).length,0,'metadata deletion reclaims capacity even while sidecar files remain');
 fs.unlinkSync(path.join(root,'run-0000.last.md'));fs.unlinkSync(path.join(root,'run-0000.task.md'));
 b.readCodexRuns(now,root,parent,opts);
 assert.equal(sideReads(monitor(()=>b.readCodexRuns(now,root,parent,opts)).reads).length,0,'physical sidecar deletion reclaims capacity');
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});

test('root-scoped cleanup and failed enumeration preserve other valid entries',async()=>{
 const root=makeRoot(),other=makeRoot();try{
 const b=await fresh(candidate);const a=makeRun(root),c=makeRun(other);
 for(const p of [a,c]){fs.writeFileSync(p+'.last.md','STATUS: done');fs.writeFileSync(p+'.task.md','TASK t-0001');}
 b.readCodexRuns(now,root,parent,opts);b.readCodexRuns(now,other,parent,opts);
 fs.unlinkSync(a+'.last.md');fs.unlinkSync(a+'.task.md');b.readCodexRuns(now,root,parent,opts);
 assert.equal(sideReads(monitor(()=>b.readCodexRuns(now,other+'/',parent,opts)).reads).length,0);
 fs.renameSync(other,other+'-unavailable');assert.deepEqual(b.readCodexRuns(now,other,parent,opts),[]);fs.renameSync(other+'-unavailable',other);
 assert.equal(sideReads(monitor(()=>b.readCodexRuns(now,path.relative(process.cwd(),other),parent,opts)).reads).length,0);
 }finally{fs.rmSync(root,{recursive:true,force:true});fs.rmSync(other,{recursive:true,force:true});fs.rmSync(other+'-unavailable',{recursive:true,force:true});}
});

test('stat-only result failure on dead worker preserves readable completion status',async()=>{
 const root=makeRoot(),oldStat=fs.statSync;try{
 const a=await fresh(original),b=await fresh(candidate),p=makeRun(root,'run',{pid:0});fs.writeFileSync(p+'.last.md','STATUS: done');
 fs.statSync=function(file,...args){if(String(file)===p+'.last.md')throw Object.assign(Error('synthetic stat EIO'),{code:'EIO'});return oldStat.call(this,file,...args);};syncBuiltinESMExports();
 const base=a.readCodexRuns(now,root,parent)[0],current=b.readCodexRuns(now,root,parent,opts)[0];
 assert.equal(base.ended,null);assert.equal(current.ended,null);assert.equal(base.running,false);assert.equal(current.running,false);assert.equal(base.status,'done');assert.equal(current.status,'done');
 }finally{fs.statSync=oldStat;syncBuiltinESMExports();fs.rmSync(root,{recursive:true,force:true});}
});

test('result changed between stat and read returns post-read mtime and retries uncached race',async()=>{
 const root=makeRoot();try{
 const b=await fresh(candidate),p=makeRun(root);fs.writeFileSync(p+'.last.md','STATUS: done');fs.utimesSync(p+'.last.md',now/1000,now/1000);
 let fired=false;
 const first=monitor(()=>b.readCodexRuns(now,root,parent,opts),f=>{if(!fired&&f===p+'.last.md'){fired=true;fs.writeFileSync(f,'STATUS: failed');fs.utimesSync(f,(now+1000)/1000,(now+1000)/1000);}}).value[0];
 assert.equal(first.status,'failed');assert.equal(first.ended,now+1000);
 const observed=monitor(()=>b.readCodexRuns(now+1000,root,parent,opts));const retry=observed.value[0];assert.equal(retry.status,'failed');assert.equal(retry.ended,now+1000);assert.ok(observed.reads.includes(p+'.last.md'));assert.ok(!monitor(()=>b.readCodexRuns(now+2000,root,parent,opts)).reads.includes(p+'.last.md'));
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});

test('previously cacheable file enlarged past ticket cap frees its old slot',async()=>{
 const root=makeRoot();try{
 const b=await fresh(candidate);
 for(let i=0;i<2049;i++){const p=makeRun(root,'run-'+String(i).padStart(4,'0'));fs.writeFileSync(p+'.last.md','STATUS: done');fs.writeFileSync(p+'.task.md','TASK t-0001');}
 b.readCodexRuns(now,root,parent,opts);
 const enlarged=path.join(root,'run-0000.task.md');fs.writeFileSync(enlarged,'TASK '+Array.from({length:65},(_,i)=>'t-'+String(i).padStart(4,'0')).join(' '));
 b.readCodexRuns(now,root,parent,opts);
 const rereads=sideReads(monitor(()=>b.readCodexRuns(now,root,parent,opts)).reads);
 assert.equal(rereads.length,2,'oversized source and just one remaining unadmitted sidecar are reread');
 assert.ok(rereads.includes(enlarged));
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});

test('result deletion during failed read preserves baseline post-read unfinished state',async()=>{
 const root=makeRoot();try{
 const b=await fresh(candidate),p=makeRun(root);fs.writeFileSync(p+'.last.md','STATUS: done');
 let fired=false;
 const first=monitor(()=>b.readCodexRuns(now,root,parent,opts),f=>{if(!fired&&f===p+'.last.md'){fired=true;fs.unlinkSync(f);throw Object.assign(Error('synthetic read EIO after deletion'),{code:'EIO'});}}).value[0];
 assert.equal(first.ended,null);assert.equal(first.running,true);assert.equal(first.status,'working');
 const retry=b.readCodexRuns(now+1000,root,parent,opts)[0];assert.equal(retry.ended,null);assert.equal(retry.running,true);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
