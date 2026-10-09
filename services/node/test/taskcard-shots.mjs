// Isolated reader contract: no live tasks, panes or CLI mutations.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {mkdtemp, mkdir, writeFile, readFile, utimes, chmod} from 'node:fs/promises';
import {EventEmitter} from 'node:events';
import {syncBuiltinESMExports} from 'node:module';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createA0TasksHandler, createA0TasksEvents, createA0TaskWriter, stageAt} from '../src/a0-tasks.ts';

const scratch=await mkdtemp(path.join(tmpdir(),'.siso-ephemeral-taskcard-test.'));
const tasks=path.join(scratch,'tasks'),hub=path.join(scratch,'ui-hub'),folder=path.join(hub,'panel/rounds/example');
await mkdir(tasks,{recursive:true});await mkdir(folder,{recursive:true});
process.env.AB_TIMELINE_GALLERIES=hub;
const at='2026-10-04T20:00:00Z';
const make=(id,evidence)=>({id,title:'Fleet tab: what every soul is doing',stage:'preview',priority:'P1',project:'Agent Base',owner:'AGENT-BASE',updated:at,evidence:[evidence],history:[{at,stage:'preview'},{at:'2026-10-04T21:00:00Z',stage:'preview',note:'set next'}]});
const rows=[make('t-1','proof: gallery ui-hub/panel/rounds/example/index.html'),make('t-2','ui-hub/panel/rounds/missing'),make('t-3','ui-hub/../rounds/escape'),make('t-4','no gallery recorded')];
for(const t of rows)await writeFile(path.join(tasks,t.id+'.json'),JSON.stringify(t));
await writeFile(path.join(tasks,'INDEX.json'),JSON.stringify({updated:at,counts:{},tasks:rows}));
await writeFile(path.join(folder,'01-before-card-360.png'),'fixture');
await writeFile(path.join(folder,'07-after-card-360.png'),'fixture');
await writeFile(path.join(folder,'02-after-pass1-card-360.png'),'fixture');
const read=createA0TasksHandler(tasks);
const originals=new Map(['readFileSync','statSync','readdirSync','realpathSync'].map(k=>[k,fs[k]]));
let syncCalls=0;
for(const k of originals.keys())fs[k]=()=>{syncCalls++;throw Error('sync fs on request path: '+k);};
syncBuiltinESMExports();
let checks=0;
try {
 const first=await read('/api/a0/tasks');assert.equal(first.status,200);checks++;
 const pair=first.body.tasks[0].shots;
 assert.deepEqual(pair,{before:'/api/timeline/gallery/panel/rounds/example/01-before-card-360.png',after:'/api/timeline/gallery/panel/rounds/example/07-after-card-360.png'});checks++;
 for(const t of first.body.tasks.slice(1)){assert.equal(t.shots,null);checks++;}
 assert.equal(first.body.tasks[0].stage_at,at);checks++;
 const second=await read('/api/a0/tasks');assert.deepEqual(second.body.tasks[0].shots,pair);checks++;
 // Folder-only change must invalidate shots even while INDEX and task files remain unchanged.
 await writeFile(path.join(folder,'00-before-other-360.png'),'fixture');
 await writeFile(path.join(folder,'00-after-other-360.png'),'fixture');
 await utimes(folder,new Date(),new Date(Date.now()+2000));
 assert.ok((await read('/api/a0/tasks')).body.tasks[0].shots.before.endsWith('/00-before-other-360.png'));checks++;
 assert.equal((await read('/api/a0/tasks/t-1')).body.shots.before.endsWith('/00-before-other-360.png'),true);checks++;
 assert.equal((await read('/api/a0/tasks/%2Fbad')).status,400);checks++;
 assert.equal((await read('/api/a0/tasks/t-absent')).status,404);checks++;
 assert.equal(stageAt([{at,stage:'preview'},{at:'2026-10-04T22:00:00Z',stage:'building'},{at:'2026-10-04T23:00:00Z',stage:'preview'}],'preview'),'2026-10-04T23:00:00Z');checks++;
 assert.equal(stageAt([], 'building'),null);checks++;
 const req=new EventEmitter(), frames=[];
 const res={destroyed:false,writeHead:status=>assert.equal(status,200),write:frame=>frames.push(frame)};
 await createA0TasksEvents(read,tasks)(req,res);
 assert.ok(frames[0].startsWith('event: index\ndata: '));checks++;
 req.emit('close');
 const cli=path.join(scratch,'noop-cli');await writeFile(cli,'#!/bin/sh\nexit 0\n');await chmod(cli,0o700);
 const written=await createA0TaskWriter(read,cli)('t-1',{priority:'P0'});
 assert.equal(written.status,503);assert.equal(written.body.ok,false);assert.match(written.body.error,/did not match/);checks++;
 assert.equal(syncCalls,0);checks++;
 const source=await readFile(new URL('../src/a0-tasks.ts',import.meta.url),'utf8');
 assert.ok(!/\b(?:readFile|stat|readdir|realpath)Sync\b/.test(source));checks++;
 console.log(`PASS taskcard-shots: ${checks} checks; paired evidence, null gaps, folder mtime invalidation, stage entry and zero synchronous request reads`);
}finally{
 for(const [k,v] of originals)fs[k]=v;syncBuiltinESMExports();
}
