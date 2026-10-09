import assert from 'node:assert/strict';
import { mkdtemp, writeFile, utimes } from 'node:fs/promises';
import path from 'node:path';
import { createA0TasksHandler } from '../src/a0-tasks.ts';

const root = await mkdtemp(path.resolve('.agents/scratchpads/landing-20261006/task-surface-fixture-'));
const at='2026-10-06T00:00:00Z';
const summary={id:'t-9001',title:'Explicit surface',project:'agent-base',priority:'P2',stage:'specced',owner:null,model:null,updated:at,links:{surface:'forged-index',private:'never-project'}};
await writeFile(path.join(root,'INDEX.json'),JSON.stringify({updated:at,counts:{},tasks:[summary]}));
const file=path.join(root,'t-9001.json');
const read=createA0TasksHandler(root);
let checks=0,stamp=Date.now();
async function check(links,expected) {
  await writeFile(file,JSON.stringify({...summary,links}));
  await utimes(file,new Date(),new Date(++stamp));
  const result=await read('/api/a0/tasks');
  assert.deepEqual(result.body.tasks[0].links,expected);checks++;
}
await check({surface:'right-panel',spec:'/private/file'}, {surface:'right-panel'});
await check({surface:'product_map'}, {surface:'product_map'});
for(const value of ['../escape','https://site','UPPER','a'.repeat(81),' has-spaces','',1,null]) await check({surface:value},undefined);
await check({},undefined);
await check(null,undefined);
await check({surface:'browser'}, {surface:'browser'});
await writeFile(file,'unreadable JSON');await utimes(file,new Date(),new Date(++stamp));
const broken=await read('/api/a0/tasks');assert.equal(broken.body.tasks[0].source,'unavailable');assert.equal(broken.body.tasks[0].links,undefined);checks++;
console.log(`PASS task-surface: ${checks} cases; backing record only, bounded IDs, invalidation and unavailable-source clearing`);
