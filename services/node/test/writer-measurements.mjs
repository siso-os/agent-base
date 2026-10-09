import assert from 'node:assert/strict';
import {mkdtemp,writeFile,mkdir,readFile,rm,realpath,chmod} from 'node:fs/promises';
import os from 'node:os';import path from 'node:path';import {execFileSync} from 'node:child_process';
import {createWriterMeasurementOwner} from '../src/writer-measurements.ts';
import {compareWriterJobs} from '../src/writer-gates.ts';

const root=await mkdtemp(path.join(os.tmpdir(),'writer-measurements-'));
try{
 const repo=path.join(root,'repo'),store=path.join(root,'store');await mkdir(path.join(repo,'src'),{recursive:true});await mkdir(store,{mode:0o700});await chmod(store,0o700);execFileSync('git',['init','-q',repo]);await writeFile(path.join(repo,'src/dashboard.tsx'),'fixture dashboard source inventory\n');execFileSync('git',['-C',repo,'add','.']);execFileSync('git',['-C',repo,'-c','user.name=fixture','-c','user.email=fixture@example.test','commit','-qm','base']);
 const revision=execFileSync('git',['-C',repo,'rev-parse','HEAD'],{encoding:'utf8'}).trim(),sourceHash=(await import('node:crypto')).createHash('sha256').update(await readFile(path.join(repo,'src/dashboard.tsx'))).digest('hex');const owner=createWriterMeasurementOwner(await realpath(store));
 const png=(w,h)=>{const b=Buffer.alloc(24);Buffer.from('89504e470d0a1a0a','hex').copy(b);b.write('IHDR',12);b.writeUInt32BE(w,16);b.writeUInt32BE(h,20);return b;};
 async function run(id,mode,session,resumedFrom){await owner.begin({runId:id,mode,sessionId:session,resumedFrom,taskId:'dashboard-redo',jobDigest:'a'.repeat(64),baseRevision:revision,dossierDigest:'b'.repeat(64),sourceRevision:revision,sourcePath:repo,sourceFiles:[{path:'src/dashboard.tsx',sha256:sourceHash}]});if(mode==='saved')await owner.nativeCommand(id,'codex resume DASH');await owner.nativeEdit(id,'src/dashboard.tsx');if(mode==='fresh')await owner.nativeCommand(id,'codex start dashboard redo');await owner.bindEvidenceRevision(id);const code=await owner.executeCheck(id,process.execPath,['-e','process.exit(2)']);assert.equal(code,2);const shot=path.join(root,`${id}.png`);await writeFile(shot,png(800,600));await owner.screenshot(id,shot,{width:800,height:600});return owner.finalize(id);}
 const saved=await run('saved-1','saved','session-saved','DASH'),fresh=await run('fresh-1','fresh','session-fresh',null);
 assert.equal(saved.commandsBeforeFirstEdit,1);assert.equal(fresh.commandsBeforeFirstEdit,0);assert.equal(saved.checks[0].exitCode,2);
 const compared=await compareWriterJobs('saved-1','fresh-1',id=>owner.resolve(id));assert.equal(compared.status,'comparable');assert.equal(compared.commandsBeforeFirstEditDelta,-1);assert.equal(compared.checks.saved,false);assert.equal(compared.visualVerdict,'unreviewed');
 assert.equal(await owner.resolve('missing'),null);
 // Stored summary counters cannot be forged without invalidating the producer digest.
 const recordPath=path.join(store,'saved-1.json'),record=JSON.parse(await readFile(recordPath,'utf8'));record.measurement.commandsBeforeFirstEdit=0;await writeFile(recordPath,JSON.stringify(record));assert.equal(await owner.resolve('saved-1'),null);
 // A changed screenshot invalidates otherwise finalized evidence.
 const cleanSaved=await run('saved-2','saved','session-saved-2','DASH');assert.ok(cleanSaved);await writeFile(path.join(root,'saved-2.png'),png(801,600));assert.equal(await owner.resolve('saved-2'),null);
 // Same session is rejected by the comparison contract even when each record is intact.
 await run('saved-3','saved','session-shared','DASH');await run('fresh-3','fresh','session-shared',null);await assert.rejects(()=>compareWriterJobs('saved-3','fresh-3',id=>owner.resolve(id)),/same task, input/);
 assert.ok(await owner.resolve('fresh-3'));
 // The HTTP route exposes only ID lookup and returns no fabricated body when records are absent.
 process.env.AB_WRITER_MEASUREMENTS=store;const {route}=await import('../src/routes/writer-measurements.route.ts');
 const response=()=>({status:0,headers:{},body:'',writeHead(code,headers){this.status=code;this.headers=headers;},end(body){this.body=body;}});
 let res=response();await route.handle({url:'/api/writer-jobs/compare?saved=absent&fresh=also-absent'},res,[],new URL('http://localhost/api/writer-jobs/compare?saved=absent&fresh=also-absent'));assert.equal(res.status,422);assert.match(res.body,/comparison/i);
 res=response();await route.handle({url:'/api/writer-jobs/compare?saved=saved-1&fresh=fresh-1&commandsBeforeFirstEdit=0'},res,[],new URL('http://localhost/api/writer-jobs/compare?saved=saved-1&fresh=fresh-1&commandsBeforeFirstEdit=0'));assert.equal(res.status,400);
 console.log('PASS writer measurement producer: native events, executed exit codes, screenshot hashing, forged counters, changed evidence, missing runs and comparison contract');
}finally{await rm(root,{recursive:true,force:true});}
