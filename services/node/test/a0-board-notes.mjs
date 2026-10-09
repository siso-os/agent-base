import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, stat, chmod, rm, symlink, link } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { writeBoardNote, readBoardNotes, parseNoteJournal, parseNoteCommand } from '../src/a0-board-notes.ts';
import { createA0BoardReader } from '../src/a0-board.ts';

const create=(requestId='fixture-create',text='Synthetic board note')=>({action:'create',requestId,text,why:'A synthetic pending decision',by:'Fixture Zero',source:'fixture:board-notes'});
const change=(action,id,expectedRevision,requestId,rest={})=>({action,id,expectedRevision,requestId,by:'Fixture Zero',source:'fixture:board-notes',...rest});
async function fixture(fn){const root=await mkdtemp(path.join(os.tmpdir(),'ab-board-notes-'));try{await fn(root);}finally{await rm(root,{recursive:true,force:true});}}
const cli=path.resolve(import.meta.dirname,'../bin/ab-note.mjs');
function runCLI(root,command,input=''){
 return new Promise((resolve,reject)=>{const child=spawn(process.execPath,['--experimental-strip-types',cli,command],{env:{...process.env,AB_A0_NOTES_ROOT:root},stdio:['pipe','pipe','pipe']});let out='',err='';child.stdout.on('data',b=>out+=b);child.stderr.on('data',b=>err+=b);child.on('error',reject);child.on('close',code=>resolve({code,out,err}));child.stdin.end(input);});
}

test('empty owned store is a read-only fresh empty source, not another folder of notes',()=>fixture(async root=>{
 const store=path.join(root,'owned');assert.deepEqual(await readBoardNotes({root:store}),{items:[],retired:[],error:null,initialized:false,eventCount:0});
 await assert.rejects(stat(store),{code:'ENOENT'});
 await mkdir(path.join(root,'notes'));await writeFile(path.join(root,'notes','notes.jsonl'),JSON.stringify({id:'foreign',text:'Must not be imported'})+'\n');
 const board=await createA0BoardReader({root,notesRoot:store})();assert.equal(board.notes.state,'fresh');assert.equal(board.notes.initialized,false);assert.deepEqual(board.notes.items,[]);
}));

test('create, process reload, update, retire and restore retain every revision and provenance',()=>fixture(async root=>{
 const c=await writeBoardNote(create(),{root});assert.equal(c.revision,1);assert.equal(c.replayed,false);
 let state=await readBoardNotes({root});assert.equal(state.items[0].id,c.id);assert.equal(state.items[0].source,'fixture:board-notes');
 const u=await writeBoardNote(change('update',c.id,1,'fixture-update',{text:'Updated synthetic note'}),{root});assert.equal(u.revision,2);
 const r=await writeBoardNote(change('retire',c.id,2,'fixture-retire'),{root});assert.equal(r.status,'retired');
 state=await readBoardNotes({root});assert.equal(state.items.length,0);assert.equal(state.retired[0].text,'Updated synthetic note');assert.equal(state.eventCount,3);
 const restored=await writeBoardNote(change('restore',c.id,3,'fixture-restore'),{root});assert.equal(restored.revision,4);
 state=await readBoardNotes({root});assert.equal(state.items.length,1);assert.equal(state.retired.length,0);
 const events=parseNoteJournal(await readFile(path.join(root,'notes.jsonl'),'utf8'));assert.deepEqual(events.map(x=>x.action),['create','update','retire','restore']);assert.equal(events[0].text,'Synthetic board note');assert.equal(new Set(events.map(x=>x.at)).size,1);assert.equal(events[3].previousHash,events[2].hash);
 for(const f of ['notes.jsonl','notes.last-good.jsonl'])assert.equal((await stat(path.join(root,f))).mode&0o777,0o600);
}));

test('exact retry after later revisions returns the original durable receipt without rewriting',()=>fixture(async root=>{
 const command=create(),c=await writeBoardNote(command,{root});await writeBoardNote(change('update',c.id,1,'updated',{why:'New synthetic reason'}),{root});
 const before=await readFile(path.join(root,'notes.jsonl'));const replay=await writeBoardNote({...command},{root});assert.equal(replay.replayed,true);assert.equal(replay.revision,1);assert.equal(replay.id,c.id);assert.deepEqual(await readFile(path.join(root,'notes.jsonl')),before);
 await assert.rejects(writeBoardNote({...command,text:'different'},{root}),{code:'conflict'});assert.deepEqual(await readFile(path.join(root,'notes.jsonl')),before);
}));

test('concurrent duplicate creates converge and concurrent different updates preserve one winner',()=>fixture(async root=>{
 const results=await Promise.all([writeBoardNote(create(),{root}),writeBoardNote(create(),{root})]);assert.equal(results[0].id,results[1].id);assert.equal(results.filter(x=>x.replayed).length,1);
 const id=results[0].id, updates=await Promise.allSettled([writeBoardNote(change('update',id,1,'update-a',{text:'A'}),{root}),writeBoardNote(change('update',id,1,'update-b',{text:'B'}),{root})]);
 assert.equal(updates.filter(x=>x.status==='fulfilled').length,1);assert.equal(updates.find(x=>x.status==='rejected').reason.code,'conflict');assert.equal((await readBoardNotes({root})).eventCount,2);
}));

test('CLI concurrent retries, reload and stale conflict work across separate processes',()=>fixture(async root=>{
 const command=create('cli-request','Synthetic private text omitted from receipt');const results=await Promise.all([runCLI(root,'apply',JSON.stringify(command)),runCLI(root,'apply',JSON.stringify(command))]);
 for(const result of results){assert.equal(result.code,0,result.err);assert.ok(!result.out.includes(command.text));}
 const receipts=results.map(x=>JSON.parse(x.out));assert.equal(receipts[0].id,receipts[1].id);assert.equal(receipts.filter(x=>x.replayed).length,1);
 const list=await runCLI(root,'list');assert.equal(list.code,0);assert.equal(JSON.parse(list.out).items[0].text,command.text);
 const update=await runCLI(root,'apply',JSON.stringify(change('update',receipts[0].id,1,'cli-u',{text:'CLI changed'})));assert.equal(update.code,0,update.err);
 const before=await readFile(path.join(root,'notes.jsonl'));const conflict=await runCLI(root,'apply',JSON.stringify(change('retire',receipts[0].id,1,'cli-stale')));assert.equal(conflict.code,1);assert.equal(JSON.parse(conflict.err).error,'conflict');assert.deepEqual(await readFile(path.join(root,'notes.jsonl')),before);
}));

test('partial file keeps persistent last-good across reader restart and refuses mutation/overwrite',()=>fixture(async root=>{
 const c=await writeBoardNote(create(),{root});const torn=(await readFile(path.join(root,'notes.jsonl'),'utf8'))+'{"partial":';await writeFile(path.join(root,'notes.jsonl'),torn);
 const source=await createA0BoardReader({root:path.join(root,'unused-zero'),notesRoot:root})();assert.equal(source.notes.state,'stale');assert.equal(source.notes.error,'malformed');assert.equal(source.notes.items[0].id,c.id);
 await assert.rejects(writeBoardNote(change('update',c.id,1,'blocked-u',{text:'must not overwrite'}),{root}),{code:'malformed'});assert.equal(await readFile(path.join(root,'notes.jsonl'),'utf8'),torn);
 const freshProcess=await runCLI(root,'list');assert.equal(JSON.parse(freshProcess.out).error,'malformed');assert.equal(JSON.parse(freshProcess.out).items[0].id,c.id);
}));

test('clean journal truncation, removed primary and hash tampering are not successful emptiness',()=>fixture(async root=>{
 const c=await writeBoardNote(create(),{root});const good=await readFile(path.join(root,'notes.jsonl'),'utf8');
 for(const raw of ['',good.replace('Synthetic board note','Tampered board note')]){
  await writeFile(path.join(root,'notes.jsonl'),raw);const state=await readBoardNotes({root});assert.equal(state.error,'malformed');assert.equal(state.items[0].text,'Synthetic board note');await assert.rejects(writeBoardNote(create('another'),{root}),{code:'malformed'});assert.equal(await readFile(path.join(root,'notes.jsonl'),'utf8'),raw);
 }
 await rm(path.join(root,'notes.jsonl'));const state=await readBoardNotes({root});assert.equal(state.error,'missing');assert.equal(state.items[0].id,c.id);
}));

test('damaged checkpoint never authorizes a blind overwrite',()=>fixture(async root=>{
 await writeBoardNote(create(),{root});const before=await readFile(path.join(root,'notes.jsonl'));await writeFile(path.join(root,'notes.last-good.jsonl'),'{');
 await assert.rejects(writeBoardNote(create('second'),{root}),{code:'malformed'});assert.deepEqual(await readFile(path.join(root,'notes.jsonl')),before);
}));

test('retry seals a primary committed before its recovery checkpoint without another revision',()=>fixture(async root=>{
 const c=await writeBoardNote(create(),{root});const old=await readFile(path.join(root,'notes.last-good.jsonl'));
 const command=change('update',c.id,1,'checkpoint-retry',{text:'Committed before checkpoint'});await writeBoardNote(command,{root});const primary=await readFile(path.join(root,'notes.jsonl'));
 await writeFile(path.join(root,'notes.last-good.jsonl'),old);assert.equal((await readBoardNotes({root})).items[0].revision,2);
 const retry=await writeBoardNote(command,{root});assert.equal(retry.replayed,true);assert.equal(retry.revision,2);assert.deepEqual(await readFile(path.join(root,'notes.jsonl')),primary);assert.deepEqual(await readFile(path.join(root,'notes.last-good.jsonl')),primary);
}));

test('stale and invalid state transitions preserve current data; restore requires retired revision',()=>fixture(async root=>{
 const c=await writeBoardNote(create(),{root});await assert.rejects(writeBoardNote(change('restore',c.id,1,'bad-restore'),{root}),{code:'conflict'});
 await writeBoardNote(change('retire',c.id,1,'retire'),{root});const before=await readFile(path.join(root,'notes.jsonl'));
 for(const command of [change('update',c.id,2,'update-retired',{text:'wrong'}),change('retire',c.id,2,'retire-again'),change('restore',c.id,1,'restore-stale'),change('update','unknown',1,'unknown',{text:'no'})])await assert.rejects(writeBoardNote(command,{root}),{code:'conflict'});
 assert.deepEqual(await readFile(path.join(root,'notes.jsonl')),before);
}));

test('journal bounds, invalid commands and unknown fields cannot create or overwrite notes',()=>fixture(async root=>{
 for(const command of [null,{}, {...create(),unexpected:'field'}, {...create(),text:''}, {...create(),text:'x'.repeat(32769)}, {...create(),id:'chosen-id'}, {...create(),requestId:'../escape'},change('update','n',1,'u'),change('retire','n',0,'r')])assert.throws(()=>parseNoteCommand(command),{code:'invalid-command'});
 await assert.rejects(writeBoardNote(create(),{root,maxBytes:30}),{code:'too-large'});await assert.rejects(stat(path.join(root,'notes.jsonl')),{code:'ENOENT'});
 assert.throws(()=>parseNoteJournal('{"id":"private-other-format"}\n'),{code:'malformed'});
}));

test('unknown journal fields remain outside the board projection even with a recomputed digest',()=>fixture(async root=>{
 await writeBoardNote(create(),{root});const event=JSON.parse((await readFile(path.join(root,'notes.jsonl'),'utf8')).trim());delete event.hash;event.uncontracted='Synthetic unrelated field';event.hash=createHash('sha256').update(JSON.stringify(event)).digest('hex');
 const raw=JSON.stringify(event)+'\n';assert.throws(()=>parseNoteJournal(raw),{code:'malformed'});await writeFile(path.join(root,'notes.jsonl'),raw);
 const board=await readBoardNotes({root});assert.equal(board.error,'malformed');assert.ok(!JSON.stringify(board).includes('uncontracted'));assert.equal(board.items[0].text,'Synthetic board note');
}));

test('symlinked store or files, hardlinks, public mode and Git locations fail closed',()=>fixture(async root=>{
 const target=path.join(root,'target');await mkdir(target,{mode:0o700});await symlink(target,path.join(root,'alias'));
 await assert.rejects(writeBoardNote(create(),{root:path.join(root,'alias')}),{code:'unsafe-store'});
 await assert.rejects(writeBoardNote(create(),{root:path.join(root,'alias','nested')}),{code:'unsafe-store'});
 const git=path.join(root,'repo');await mkdir(git,{mode:0o700});await writeFile(path.join(git,'.git'),'gitdir: synthetic');await assert.rejects(writeBoardNote(create(),{root:path.join(git,'notes')}),{code:'unsafe-store'});
 await chmod(target,0o755);await assert.rejects(writeBoardNote(create(),{root:target}),{code:'unsafe-store'});await chmod(target,0o700);
 const outside=path.join(root,'outside');await writeFile(outside,'outside',{mode:0o600});await symlink(outside,path.join(target,'notes.jsonl'));await assert.rejects(writeBoardNote(create(),{root:target}),{code:'unreadable'});assert.equal(await readFile(outside,'utf8'),'outside');
 await rm(path.join(target,'notes.jsonl'));await link(outside,path.join(target,'notes.jsonl'));await assert.rejects(writeBoardNote(create(),{root:target}),{code:'unsafe-store'});assert.equal(await readFile(outside,'utf8'),'outside');
}));

test('an existing writer lock is retained with no forced unlock or note mutation',()=>fixture(async root=>{
 await writeFile(path.join(root,'.writer-lock'),'synthetic owner',{mode:0o600});await assert.rejects(writeBoardNote(create(),{root}),{code:'busy'});assert.equal(await readFile(path.join(root,'.writer-lock'),'utf8'),'synthetic owner');await assert.rejects(stat(path.join(root,'notes.jsonl')),{code:'ENOENT'});
}));

test('board refresh sees revisions and retirement independently of unavailable ideas',()=>fixture(async root=>{
 const notesRoot=path.join(root,'owned'),read=createA0BoardReader({root:path.join(root,'zero'),notesRoot,ttlMs:0});const c=await writeBoardNote(create(),{root:notesRoot});
 let board=await read();assert.equal(board.notes.state,'fresh');assert.equal(board.notes.items[0].revision,1);assert.equal(board.ideas.error,'missing');
 await writeBoardNote(change('retire',c.id,1,'retire-refresh'),{root:notesRoot});board=await read();assert.equal(board.notes.items.length,0);assert.equal(board.notes.retired[0].revision,2);assert.equal(board.notes.store,'agent-base-board-notes-v1');
}));
