import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp,mkdir,writeFile,rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { createA0BoardReader,parseBoardSource,boardRoot } from '../src/a0-board.ts';
import { writeBoardNote } from '../src/a0-board-notes.ts';
import { a0BoardRoute } from '../src/routes/a0-board.route.ts';
import { dispatchRoute } from '../src/routes/registry.ts';
const line=(...rows)=>rows.map(x=>JSON.stringify(x)).join('\n');
const item=(id,text,rest={})=>({id,text,at:'2026-10-01T12:00:00Z',...rest});

test('canonical board root follows AB_A0_TASKS without creating a second location',()=>{
 const prior=process.env.AB_A0_TASKS;process.env.AB_A0_TASKS='/synthetic/zero/tasks';try{assert.equal(boardRoot(),'/synthetic/zero');}finally{if(prior===undefined)delete process.env.AB_A0_TASKS;else process.env.AB_A0_TASKS=prior;}
});
test('latest revision wins, retired latest cannot resurrect, and optional nullable fields match the idea writer',()=>{
 const rows=parseBoardSource(line(item('i1','old',{revision:1}),item('i1','new',{revision:2,why:null,score:null,by:'Shaan'}),item('i1','late old',{revision:1,updated:'2026-10-05T12:00:00Z'}),item('i2','open'),item('i2','retired',{updated:'2026-10-02T12:00:00Z',status:'retired'}),item('i3','integrated',{status:'integrated'})),'ideas');
 assert.equal(rows.length,2);assert.equal(rows[0].id,'i1');assert.equal(rows[0].text,'new');assert.equal(rows[1].integrated,true);assert.ok(!('why' in rows[0]));
});
test('timestamp and append order break equal-revision ties; rejected latest stays hidden',()=>{
 const rows=parseBoardSource(line(item('n1','new',{updated:'2026-10-03T12:00:00Z'}),item('n1','old'),item('n2','first'),item('n2','second'),item('i3','old'),item('i3','rejected',{status:'rejected'})),'notes');
 assert.deepEqual(rows.map(x=>x.text),['new','second']);
});
test('his ideas rank first then farmed score; private uncontracted fields never escape',()=>{
 const rows=parseBoardSource(line(item('a','farmer',{score:9,by:'Reader',private:'never return'}),item('b','his',{by:'Shaan',score:null,his:'do not copy this field'}),item('c','other',{by:'Reader',score:1})),'ideas');
 assert.deepEqual(rows.map(x=>x.id),['b','a','c']);assert.ok(rows.every(x=>!('his' in x)&&!('private' in x)));
});
test('malformed JSON or schema rejects the whole file rather than manufacturing partial emptiness',()=>{
 for(const bad of ['{','null','[]',line({id:'x'}),line(item('x','ok',{score:'9'})),line(item('x','ok',{updated:'invalid'})),line(item('x','ok',{revision:-1}))])assert.throws(()=>parseBoardSource(line(item('good','kept'))+'\n'+bad,'notes'),/malformed/);
});
test('fresh, independently missing, cached, stale malformed, deleted and recovered sources',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'siso-a0-board-test-'));let now=100;
 try{await mkdir(path.join(root,'ideas'));await writeFile(path.join(root,'ideas/ideas.jsonl'),line(item('i','kept')));
 const read=createA0BoardReader({root,notesRoot:path.join(root,'notes'),now:()=>now,ttlMs:50});let board=await read();assert.equal(board.ideas.state,'fresh');assert.equal(board.notes.error,null);assert.equal(board.notes.initialized,false);
 await writeFile(path.join(root,'ideas/ideas.jsonl'),'{');board=await read();assert.equal(board.ideas.error,null,'TTL preserves successful cache');now+=51;board=await read();assert.equal(board.ideas.error,'malformed');assert.equal(board.ideas.state,'stale');assert.equal(board.ideas.items[0].text,'kept');assert.equal(board.ideas.observedAt,100);
 await rm(path.join(root,'ideas/ideas.jsonl'));now+=51;board=await read();assert.equal(board.ideas.error,'missing');assert.equal(board.ideas.items.length,1);
 await writeFile(path.join(root,'ideas/ideas.jsonl'),'');const written=await writeBoardNote({action:'create',requestId:'reader-note',text:'new note',by:'Fixture Zero',source:'fixture:reader'},{root:path.join(root,'notes')});now+=51;board=await read();assert.equal(board.ideas.error,null);assert.deepEqual(board.ideas.items,[]);assert.equal(board.notes.items[0].id,written.id);
 }finally{await rm(root,{recursive:true,force:true});}
});
test('byte and row bounds fail explicitly, without inventing an empty successful source',async()=>{
 const read=createA0BoardReader({root:'/synthetic',maxBytes:10,read:async()=>line(item('i','too large'))});assert.equal((await read()).ideas.error,'too-large');
 assert.throws(()=>parseBoardSource(Array.from({length:5001},(_,n)=>JSON.stringify(item(String(n),'row'))).join('\n'),'notes'),/too-large/);
});
test('real bounded file reads reject an oversized file, directories and invalid UTF-8',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'siso-a0-board-bounds-'));
 try{await mkdir(path.join(root,'ideas'));await mkdir(path.join(root,'notes'),{mode:0o700});await writeFile(path.join(root,'ideas/ideas.jsonl'),'x'.repeat(65));await writeFile(path.join(root,'notes/notes.jsonl'),Buffer.from([0xff,0xfe]),{mode:0o600});
 const board=await createA0BoardReader({root,notesRoot:path.join(root,'notes'),maxBytes:64})();assert.equal(board.ideas.error,'too-large');assert.equal(board.notes.error,'malformed');
 await rm(path.join(root,'ideas/ideas.jsonl'));await mkdir(path.join(root,'ideas/ideas.jsonl'));assert.equal((await createA0BoardReader({root,notesRoot:path.join(root,'notes')})()).ideas.error,'unreadable');
 }finally{await rm(root,{recursive:true,force:true});}
});
test('timeout keeps only one in-flight operation per source and later success recovers',async()=>{
 const resolve={};const calls={ideas:0,notes:0};const read=createA0BoardReader({root:'/synthetic',timeoutMs:5,ttlMs:1000,read:file=>{const kind=file.includes('/ideas/')?'ideas':'notes';calls[kind]++;return new Promise(r=>resolve[kind]=r);}});
 const first=await read();assert.equal(first.ideas.error,'timeout');await Promise.all([read(),read(),read()]);assert.deepEqual(calls,{ideas:1,notes:1});resolve.ideas(line(item('i','late success')));resolve.notes('');await new Promise(r=>setTimeout(r,0));const fresh=await read();assert.equal(fresh.ideas.items[0].id,'i');assert.equal(fresh.ideas.state,'fresh');assert.equal(fresh.ideas.error,null);assert.deepEqual(calls,{ideas:1,notes:1});
});
test('GET route is exact, read-only and no-store through the actual route dispatcher',async()=>{
 let reads=0;const data={ideas:{items:[],error:null,state:'fresh',observedAt:1,attemptedAt:1},notes:{items:[],error:'missing',state:'unavailable',observedAt:null,attemptedAt:1}};
 const route=a0BoardRoute(async()=>{reads++;return data;});const server=http.createServer(async(req,res)=>{if(!await dispatchRoute([route],req,res,new URL(req.url,'http://localhost').pathname)){res.writeHead(404);res.end();}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const url=`http://127.0.0.1:${server.address().port}/api/a0/board`;
 try{const r=await fetch(url);assert.equal(r.status,200);assert.equal(r.headers.get('cache-control'),'no-store');assert.deepEqual(await r.json(),data);assert.equal((await fetch(url,{method:'POST'})).status,404);assert.equal((await fetch(url+'/other')).status,404);assert.equal(reads,1);}finally{await new Promise(r=>server.close(r));}
});
