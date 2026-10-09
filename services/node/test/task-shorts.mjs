// t-0445: an owner's explicit short survives both API projections and cached reads.
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, utimes, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createA0TasksHandler } from '../src/a0-tasks.ts';

const scratch = await mkdtemp(path.join(tmpdir(), 'ab-task-shorts-'));
try {
  const tasks=path.join(scratch,'tasks'), specs=path.join(scratch,'specs');
  await mkdir(tasks); await mkdir(specs);
  const task={id:'t-9001',title:'Raw title from the original request',project:'agent-base',priority:'P2',stage:'specced',owner:'FIXTURE',updated:'2026-10-08T00:00:00Z'};
  await writeFile(path.join(tasks,'INDEX.json'),JSON.stringify({updated:task.updated,counts:{},tasks:[task]}));
  await writeFile(path.join(specs,'t-9001.md'),'# t-9001 · Generated spec fallback\n');
  const file=path.join(tasks,'t-9001.json');
  const read=createA0TasksHandler(tasks);
  let stamp=Date.now(), checks=0;
  async function check(short,expected) {
    await writeFile(file,JSON.stringify({...task,short}));
    await utimes(file,new Date(),new Date(++stamp)); // change record only, leaving INDEX byte-identical
    const list=await read('/api/a0/tasks'), detail=await read('/api/a0/tasks/t-9001');
    assert.equal(list.body.tasks[0].short,expected,'task list');
    assert.equal(detail.body.short,expected,'task detail');
    assert.equal((await read('/api/a0/tasks')).body.tasks[0].short,expected,'cached task list');
    checks++;
  }
  await check('  Keep task names\n easy to read  ','Keep task names easy to read');
  await check('Updated owner wording','Updated owner wording');
  for(const value of ['', ' \n ', null, 123, {}, undefined]) await check(value,'Generated spec fallback');
  await rm(path.join(specs,'t-9001.md'));
  await check(undefined,task.title);
  console.log(`PASS task-shorts: ${checks} cases; explicit short precedence, list/detail parity, cache invalidation and generated fallbacks`);
} finally { await rm(scratch,{recursive:true,force:true}); }
