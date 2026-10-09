import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {readCodexRuns} from '../src/codex-runs.ts';
if(!global.gc)throw Error('Run with --expose-gc');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'dot-sidecar-memory-'));
const oldTasks=process.env.AB_A0_TASKS;process.env.AB_A0_TASKS=path.join(root,'tickets');fs.mkdirSync(process.env.AB_A0_TASKS);
const now=Date.UTC(2026,9,5,21),count=12,payload=4*1024*1024;
function setup(){for(let i=0;i<count;i++){const p=path.join(root,'run-'+i);fs.writeFileSync(p+'.meta.json',JSON.stringify({started:now,parent_session:'synthetic'}));fs.writeFileSync(p+'.jsonl','');fs.writeFileSync(p+'.last.md','STATUS: done\n'+'z'.repeat(payload));fs.writeFileSync(p+'.task.md','TASK t-0001 '+'q'.repeat(payload));}}
function heap(){for(let i=0;i<6;i++)global.gc();return process.memoryUsage().heapUsed;}
function scan(){const rows=readCodexRuns(now,root,{session:'synthetic'},{includeItems:false});assert.equal(rows.length,count);assert.ok(rows.every(r=>r.status==='done'&&r.tickets[0].id==='t-0001'));}
try{
 setup();const before=heap();scan();const cold=heap();scan();const warm=heap();
 // One legacy RegExp subject can survive the first scan. A warm scan releases
 // it naturally; neither cache may retain a body per sidecar.
 assert.ok(cold-before<8*1024*1024,`Unexpected cold retention: ${cold-before}`);
 assert.ok(warm-before<2*1024*1024,`Unexpected warm retention: ${warm-before}`);
 const source=fileURLToPath(new URL('../src/codex-runs.ts',import.meta.url));
 console.log(JSON.stringify({node:process.version,sourceSha256:createHash('sha256').update(fs.readFileSync(source)).digest('hex'),count,syntheticBodyBytes:count*payload*2,before,cold,warm,coldRetainedBytes:cold-before,warmRetainedBytes:warm-before,note:'Forced-GC synthetic heap regression; no RSS or live savings claim'}));
}finally{if(oldTasks===undefined)delete process.env.AB_A0_TASKS;else process.env.AB_A0_TASKS=oldTasks;fs.rmSync(root,{recursive:true,force:true});}
