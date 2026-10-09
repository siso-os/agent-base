import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {syncBuiltinESMExports} from 'node:module';
import {pathToFileURL,fileURLToPath} from 'node:url';
const now=Date.UTC(2026,9,5,21),parent={session:'fixture'},options={includeItems:false};
let sequence=0;
const moduleOf=file=>import(pathToFileURL(path.resolve(file)).href+'?sidecar='+ ++sequence);
const basePath=fileURLToPath(new URL('../src/codex-runs.ts',import.meta.url)),candidatePath=basePath;
const strip=rows=>rows.map(({items,...rest})=>rest);
function root(){return fs.mkdtempSync(path.join(os.tmpdir(),'dot-sidecar-'));}
function run(dir,id='run'){
 const p=path.join(dir,id);fs.writeFileSync(p+'.meta.json',JSON.stringify({started:now,parent_session:parent.session,pid:process.pid,task:'t-9000'}));
 fs.writeFileSync(p+'.jsonl',JSON.stringify({type:'item.completed',item:{id:'a',type:'agent_message',text:'Synthetic'}})+'\n');return p;
}
function reads(fn){const orig=fs.readFileSync,paths=[];fs.readFileSync=function(file,...args){paths.push(String(file));return orig.call(this,file,...args);};syncBuiltinESMExports();try{return{value:fn(),paths};}finally{fs.readFileSync=orig;syncBuiltinESMExports();}}

test('sidecar changes preserve baseline status, completion and task/prompt/meta fallback',async()=>{
 const dir=root();const oldTasks=process.env.AB_A0_TASKS;process.env.AB_A0_TASKS=path.join(dir,'tasks');fs.mkdirSync(process.env.AB_A0_TASKS);
 try{
  const b=await moduleOf(basePath),c=await moduleOf(candidatePath);const p=run(dir);let tick=0;
  function write(suffix,text){fs.writeFileSync(p+suffix,text);fs.utimesSync(p+suffix,(now+ ++tick*1000)/1000,(now+tick*1000)/1000);}
  function check(label){const a=b.readCodexRuns(now+tick,dir,parent),z=c.readCodexRuns(now+tick,dir,parent,options);assert.deepEqual(strip(z),strip(a),label);return z[0];}
  assert.equal(check('metadata fallback').ticket,'t-9000 t-9000');
  write('.prompt.md','t-1000');assert.equal(check('prompt fallback').ticket,'t-1000 t-1000');
  write('.task.md','');check('empty task falls through');
  write('.task.md','   \n');assert.equal(check('whitespace task wins').ticket,'');
  write('.task.md','preamble t-0001\nTaSk selected t-0002 t-0002\nfooter t-0003');assert.equal(check('TASK line precedence and dedup').ticket,'t-0002 t-0002');
  fs.writeFileSync(path.join(process.env.AB_A0_TASKS,'t-0002.json'),JSON.stringify({short:'Fresh task title'}));assert.equal(check('title remains freshly read').ticket,'t-0002 Fresh task title');
  write('.last.md','STATUS: DONE');assert.equal(check('finished').status,'done');
  write('.last.md','STATUS: failed');assert.equal(check('changed result').status,'failed');
  fs.renameSync(p+'.last.md',p+'.last.old');write('.last.md','STATUS: blocked');check('result inode replacement');
  fs.unlinkSync(p+'.last.md');assert.equal(check('result deletion').running,true);
  fs.renameSync(p+'.task.md',p+'.task.old');write('.task.md','t-0004');check('task inode replacement');
  write('.task.md','');check('task truncation');fs.unlinkSync(p+'.task.md');check('task deletion');
  fs.unlinkSync(p+'.prompt.md');check('prompt deletion');
 }finally{if(oldTasks===undefined)delete process.env.AB_A0_TASKS;else process.env.AB_A0_TASKS=oldTasks;fs.rmSync(dir,{recursive:true,force:true});}
});

test('warm sidecars avoid body reads; one changed file is read once',async()=>{
 const dir=root();try{
  const c=await moduleOf(candidatePath),p=run(dir);fs.writeFileSync(p+'.last.md','STATUS: done');fs.writeFileSync(p+'.task.md','No ticket references');
  c.readCodexRuns(now,dir,parent,options);
  // t-0534: unchanged metadata is parsed once too, so a warm read touches no file bodies at all.
  const warm=reads(()=>c.readCodexRuns(now+1000,dir,parent,options));assert.deepEqual(warm.paths,[]);
  fs.writeFileSync(p+'.task.md','Changed non-ticket brief');
  const changed=reads(()=>c.readCodexRuns(now+2000,dir,parent,options));assert.deepEqual(changed.paths,[p+'.task.md']);
  const details=reads(()=>c.readCodexRuns(now+2000,dir,parent));assert.ok(details.paths.includes(p+'.last.md'));assert.ok(details.paths.includes(p+'.task.md'));
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('read and stat failures preserve unavailable fallbacks without caching a failure',async()=>{
 const dir=root();const origRead=fs.readFileSync,origStat=fs.statSync;
 try{
  const b=await moduleOf(basePath),c=await moduleOf(candidatePath),p=run(dir);fs.writeFileSync(p+'.last.md','STATUS: done');fs.writeFileSync(p+'.task.md','t-1111');fs.writeFileSync(p+'.prompt.md','t-2222');
  fs.readFileSync=function(file,...args){if([p+'.last.md',p+'.task.md'].includes(String(file))){const e=new Error('Synthetic EACCES');e.code='EACCES';throw e;}return origRead.call(this,file,...args);};syncBuiltinESMExports();
  assert.deepEqual(strip(c.readCodexRuns(now,dir,parent,options)),strip(b.readCodexRuns(now,dir,parent)));
  fs.readFileSync=origRead;syncBuiltinESMExports();assert.equal(c.readCodexRuns(now+1000,dir,parent,options)[0].status,'done');
  fs.statSync=function(file,...args){if(String(file)===p+'.last.md'){const e=new Error('Synthetic stat EACCES');e.code='EACCES';throw e;}return origStat.call(this,file,...args);};syncBuiltinESMExports();
  // A failed stat cannot expose cached completion. Original still reads the result
  // text, but both classify the still-alive worker as working with ended=null.
  assert.deepEqual(strip(c.readCodexRuns(now+2000,dir,parent,options)),strip(b.readCodexRuns(now+2000,dir,parent)));
  fs.writeFileSync(p+'.meta.json',JSON.stringify({started:now,parent_session:parent.session,task:'t-9000'}));
  assert.deepEqual(strip(c.readCodexRuns(now+3000,dir,parent,options)),strip(b.readCodexRuns(now+3000,dir,parent)),'readable result survives stat error even with no live pid');
 }finally{fs.readFileSync=origRead;fs.statSync=origStat;syncBuiltinESMExports();fs.rmSync(dir,{recursive:true,force:true});}
});

test('large ticket lists are not truncated or cached; bounded admission stays scan-resistant',async()=>{
 const dir=root();try{
  const c=await moduleOf(candidatePath),p=run(dir);const ticketText=Array.from({length:65},(_,i)=>`t-${String(i).padStart(4,'0')}`).join(' ');fs.writeFileSync(p+'.task.md',ticketText);
  assert.equal(c.readCodexRuns(now,dir,parent,options)[0].tickets.length,65);
  assert.ok(reads(()=>c.readCodexRuns(now+1000,dir,parent,options)).paths.includes(p+'.task.md'));
  fs.writeFileSync(p+'.task.md','no IDs');c.readCodexRuns(now+2000,dir,parent,options);assert.ok(!reads(()=>c.readCodexRuns(now+3000,dir,parent,options)).paths.includes(p+'.task.md'));
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
