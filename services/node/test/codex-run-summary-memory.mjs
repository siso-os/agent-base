import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';

if (!global.gc) throw new Error('Run with --expose-gc');
const source=fileURLToPath(new URL('../src/codex-runs.ts', import.meta.url));
const {readCodexRuns}=await import(pathToFileURL(source));
const root=fs.mkdtempSync(path.join(os.tmpdir(),'dot-summary-retention-'));
const count=12,messageBytes=4*1024*1024,now=Date.UTC(2026,9,5,21);
function write(size){
  for(let i=0;i<count;i++){
    const prefix=path.join(root,String(i));
    fs.writeFileSync(prefix+'.meta.json',JSON.stringify({started:now,name:'Synthetic',parent_session:'synthetic'}));
    fs.writeFileSync(prefix+'.jsonl',JSON.stringify({type:'item.completed',item:{id:'a',type:'agent_message',text:'x'.repeat(size)}})+'\n');
  }
}
function heap(){for(let i=0;i<8;i++)global.gc();return process.memoryUsage().heapUsed;}
try{
  write(messageBytes);
  const before=heap();
  readCodexRuns(now,root,{session:'synthetic'},{includeItems:false});
  const after=heap();
  write(200);readCodexRuns(now+1000,root,{session:'synthetic'},{includeItems:false});
  const replaced=heap();
  const retained=after-before,reclaimed=after-replaced;
  assert.ok(retained<8*1024*1024,`Unexpected retained message bodies: ${retained} bytes`);
  console.log(JSON.stringify({source,sourceSha256:createHash('sha256').update(fs.readFileSync(source)).digest('hex'),node:process.version,count,messageBytes,before,after,replaced,retained,reclaimed,note:'Forced-GC Node cloud fixture; not production RSS or host RAM savings'},null,2));
}finally{fs.rmSync(root,{recursive:true,force:true});}
