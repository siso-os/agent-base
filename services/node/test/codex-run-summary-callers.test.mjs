import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import cp from 'node:child_process';
import {registerHooks,syncBuiltinESMExports} from 'node:module';
import {pathToFileURL} from 'node:url';

// Load the actual modified caller. Stub only unrelated providers, which are not
// part of this Codex-run path; never invoke hosts, sessions or external tools.
const subagentsURL=new URL('../src/subagents.ts', import.meta.url).href;
const inactiveProviders=new Set(['../../host/src/codex-children.ts','./transcript.ts','../../host/src/events.ts','./codex-transcript.ts']);
const hooks=registerHooks({resolve(specifier,context,next){
  if(context.parentURL===subagentsURL&&inactiveProviders.has(specifier))return{
    url:'data:text/javascript,'+encodeURIComponent('export const readChildren=()=>[]; export const sessionFile=()=>null; export const lineToEvents=()=>[]; export const summarize=()=>"";'),shortCircuit:true,
  };
  return next(specifier,context);
}});
const {listSubagents,subagentEvents}=await import(subagentsURL);
hooks.deregister();

test('actual listSubagents uses warm summaries; historical subagentEvents retains full items',()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'dot-subagents-integration-'));
  const oldRoot=process.env.AB_FLEET_RUNS,oldRead=fs.readFileSync,oldExec=cp.execFileSync;
  const parent={id:'fixture',name:'Fixture',session:'synthetic-parent',cwd:root,tool:'codex'};
  const reads=[];process.env.AB_FLEET_RUNS=root;
  fs.readFileSync=function(file,...args){const value=oldRead.call(this,file,...args);if(String(file).endsWith('.jsonl'))reads.push(String(file));return value;};
  cp.execFileSync=()=>{throw new Error('External execution is forbidden in this fixture');};
  syncBuiltinESMExports();
  try{
    for(let i=0;i<40;i++){
      const prefix=path.join(root,`run-${String(i).padStart(3,'0')}`);
      fs.writeFileSync(prefix+'.meta.json',JSON.stringify({name:'Synthetic',parent_session:parent.session,started:Date.now()-1000}));
      fs.writeFileSync(prefix+'.jsonl',JSON.stringify({type:'item.completed',item:{id:'one',type:'agent_message',text:'Synthetic detail '+i}})+'\n');
      fs.writeFileSync(prefix+'.last.md','STATUS: done\n');
    }
    const first=listSubagents(parent,[]);assert.equal(first.rows.length,40);assert.equal(reads.length,40);
    reads.length=0;const second=listSubagents(parent,[]);assert.equal(second.rows.length,40);assert.equal(reads.length,0);
    for(const row of second.rows)assert.ok(row.what.startsWith('Synthetic detail '));
    const old=path.join(root,'run-000.last.md');fs.utimesSync(old,new Date(0),new Date(0));
    assert.equal(listSubagents(parent,[]).rows.length,39,'only the list applies the historical visibility filter');
    reads.length=0;const detail=subagentEvents(parent,'run:run-000');
    assert.equal(detail.events[0].text,'Synthetic detail 0');assert.equal(detail.events.length,1);
    assert.equal(reads.length,40,'default historical detail contract remains unchanged');
    reads.length=0;listSubagents(parent,[]);assert.equal(reads.length,0,'detail-cache churn cannot evict summary hits');
  }finally{
    fs.readFileSync=oldRead;cp.execFileSync=oldExec;syncBuiltinESMExports();
    if(oldRoot===undefined)delete process.env.AB_FLEET_RUNS;else process.env.AB_FLEET_RUNS=oldRoot;
    fs.rmSync(root,{recursive:true,force:true});
  }
});
