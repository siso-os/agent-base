import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { syncBuiltinESMExports } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';

const now = Date.UTC(2026, 9, 5, 21);
const parent = {session: 'synthetic-parent'};
const options = {includeItems: false};
let moduleId = 0;
const source = fileURLToPath(new URL('../src/codex-runs.ts', import.meta.url));
const candidate = source;
const fresh = file => import(pathToFileURL(file).href + `?regression=${++moduleId}`);
function fixture() { return fs.mkdtempSync(path.join(os.tmpdir(), 'dot-agentbase-regression-')); }
const stripItems = rows => rows.map(({items, ...r}) => r);
const event = (id, text, type = 'agent_message') => JSON.stringify({type:'item.completed',item:{id,type,text}}) + '\n';
function makeRun(root, id, text = 'Synthetic answer', session = parent.session) {
  const prefix = path.join(root,id);
  fs.writeFileSync(prefix + '.meta.json',JSON.stringify({name:id,parent_session:session,pid:process.pid,started:now - 86_400_000}));
  fs.writeFileSync(prefix + '.jsonl',event('a',text));
  return prefix;
}
function countReads(fn) {
  const old=fs.readFileSync, reads=[];
  fs.readFileSync=function(file,...args) {
    const result=old.call(this,file,...args);
    if(String(file).endsWith('.jsonl'))reads.push(String(file));
    return result;
  };
  syncBuiltinESMExports();
  try { return {result:fn(),reads}; } finally {fs.readFileSync=old;syncBuiltinESMExports();}
}

test('33 and 184 summary streams retain warm hits, with parent isolation and full history',async()=>{
  for(const size of [33,184]){
    const root=fixture();
    try{
      const {readCodexRuns}=await fresh(candidate);
      for(let i=0;i<size;i++)makeRun(root,`run-${String(i).padStart(4,'0')}`);
      makeRun(root,'foreign','Unrelated synthetic content','another-parent');
      const cold=countReads(()=>readCodexRuns(now,root,parent,options));
      assert.equal(cold.reads.length,size);assert.ok(!cold.reads.some(x=>x.endsWith('foreign.jsonl')));
      assert.ok(cold.result.every(x=>x.items.length===0));
      const warm=countReads(()=>readCodexRuns(now+1000,root,parent,options));
      assert.equal(warm.reads.length,0);
      assert.ok(cold.result.every(r=>r.rateMeasured===false&&r.rate===0));
      assert.ok(warm.result.every(r=>r.rateMeasured===true&&r.rate===0&&r.rateEstimated===true));
      const withoutMeasurementFlag=rows=>rows.map(({rateMeasured,...row})=>row);
      assert.deepEqual(withoutMeasurementFlag(warm.result),withoutMeasurementFlag(cold.result));
      const detail=countReads(()=>readCodexRuns(now+1000,root,parent));
      assert.equal(detail.result.length,size);assert.ok(detail.result.every(x=>x.items[0].text==='Synthetic answer'));
      assert.deepEqual(stripItems(detail.result),stripItems(warm.result));
      assert.equal(countReads(()=>readCodexRuns(now+2000,root,parent,options)).reads.length,0);
    }finally{fs.rmSync(root,{recursive:true,force:true});}
  }
});

test('summary parity through append, partial UTF-8/JSON, duplicate IDs, completion, rotation and truncate',async()=>{
  const root=fixture();
  try{
    const before=await fresh(source),after=await fresh(candidate);
    const prefix=makeRun(root,'run');let tick=0;
    function check(label){
      tick+=1000;
      const full=before.readCodexRuns(now+tick,root,parent);
      const summary=after.readCodexRuns(now+tick,root,parent,options);
      assert.deepEqual(stripItems(summary),stripItems(full),label);
      assert.deepEqual(after.readCodexRuns(now+tick,root,parent),full,`${label}: detail`);
    }
    check('initial');
    fs.appendFileSync(prefix+'.jsonl',event('b','RETURN\nSTATUS: done — second answer')+event('a','Updated answer'));
    check('duplicate IDs reorder last item');
    const partial=Buffer.from(event('c','Synthetic café 🦊'));
    const cut=partial.indexOf(Buffer.from('🦊'))+2;
    fs.appendFileSync(prefix+'.jsonl',partial.subarray(0,cut));check('partial UTF-8 and JSON');
    fs.appendFileSync(prefix+'.jsonl',partial.subarray(cut));check('completed UTF-8 and JSON');
    fs.appendFileSync(prefix+'.jsonl',JSON.stringify({type:'turn.completed',usage:{input_tokens:500,output_tokens:150}})+'\n');
    check('authoritative usage');
    fs.writeFileSync(prefix+'.last.md','STATUS: done\n');fs.utimesSync(prefix+'.last.md',new Date(now),new Date(now));
    check('completion and historical detail');
    fs.renameSync(prefix+'.jsonl',prefix+'.old');fs.writeFileSync(prefix+'.jsonl',event('replacement','replacement'));
    check('inode rotation');
    fs.writeFileSync(prefix+'.jsonl','');check('truncate');
    fs.writeFileSync(prefix+'.jsonl',event('restored','restored'));check('restore');
    fs.writeFileSync(prefix+'.jsonl',event('unicode','x'.repeat(179)+'🦊'));check('surrogate pair split at step limit');
  }finally{fs.rmSync(root,{recursive:true,force:true});}
});

test('summary admission cap does not recreate the sequential-scan cliff; deletion releases capacity',async()=>{
  const root=fixture();
  try{
    const {readCodexRuns}=await fresh(candidate);
    for(let i=0;i<4097;i++)makeRun(root,`run-${String(i).padStart(5,'0')}`,'x');
    readCodexRuns(now,root,parent,options);
    const warm=countReads(()=>readCodexRuns(now+1000,root,parent,options));
    assert.equal(warm.reads.length,1,'only the unadmitted item is reparsed');
    fs.unlinkSync(path.join(root,'run-00000.meta.json'));
    assert.equal(readCodexRuns(now+2000,root,parent,options).length,4096);
    assert.equal(countReads(()=>readCodexRuns(now+3000,root,parent,options)).reads.length,0);
  }finally{fs.rmSync(root,{recursive:true,force:true});}
});

test('cleanup is root-scoped, survives enumeration failure, and normalizes root aliases',async()=>{
  const root=fixture(),other=fixture();
  try{
    const {readCodexRuns}=await fresh(candidate);
    const a=makeRun(root,'one'),b=makeRun(other,'two');
    readCodexRuns(now,root,parent,options);readCodexRuns(now,other,parent,options);
    fs.unlinkSync(a+'.meta.json');assert.deepEqual(readCodexRuns(now+1000,root,parent,options),[]);
    assert.equal(countReads(()=>readCodexRuns(now+1000,other+path.sep,parent,options)).reads.length,0);
    const unavailable=other+'-unavailable';fs.renameSync(other,unavailable);
    assert.deepEqual(readCodexRuns(now+2000,other,parent,options),[]);
    fs.renameSync(unavailable,other);
    assert.equal(countReads(()=>readCodexRuns(now+2000,path.relative(process.cwd(),other),parent,options)).reads.length,0);
    fs.unlinkSync(b+'.jsonl');assert.equal(readCodexRuns(now+3000,other,parent,options)[0].tokens,0);
    fs.writeFileSync(b+'.jsonl',event('new','New after deletion'));
    assert.equal(readCodexRuns(now+4000,other,parent,options)[0].step,'New after deletion');
  }finally{fs.rmSync(root,{recursive:true,force:true});fs.rmSync(other,{recursive:true,force:true});fs.rmSync(other+'-unavailable',{recursive:true,force:true});}
});

test('one changed stream invalidates one summary, while default full-detail cache remains available',async()=>{
  const root=fixture();
  try{
    const {readCodexRuns}=await fresh(candidate);
    for(let i=0;i<40;i++)makeRun(root,`run-${String(i).padStart(4,'0')}`);
    readCodexRuns(now,root,parent,options);
    fs.appendFileSync(path.join(root,'run-0012.jsonl'),event('new','new content'));
    const changed=countReads(()=>readCodexRuns(now+1000,root,parent,options));
    assert.deepEqual(changed.reads,[path.join(root,'run-0012.jsonl')]);
    assert.equal(changed.result.find(r=>r.id==='run-0012').step,'new content');
    const selected={session:'detail-only'};
    makeRun(root,'detail','Detail text',selected.session);
    readCodexRuns(now,root,selected);
    assert.equal(countReads(()=>readCodexRuns(now+1000,root,selected)).reads.length,0);
    assert.equal(countReads(()=>readCodexRuns(now+1000,root,selected,options)).reads.length,0);
  }finally{fs.rmSync(root,{recursive:true,force:true});}
});
