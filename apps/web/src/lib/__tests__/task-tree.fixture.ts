// Run through services/node/test/task-tree-fixture.mjs; all inputs are synthetic.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { taskAncestorContext, validTaskRegistry, workspaceTaskGroups, taskWorkspace, taskOwner } from '../task-workspaces';
import { planPhases, turnAction } from '../task-plan';
import { TaskWorkspaceGroups } from '../../components/TaskWorkspaceGroups';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createA0TasksHandler } from '../../../../../services/node/src/a0-tasks';
import type { TaskSummary } from '../../components/widgets/TasksWidget';
const t = (id: string, extra = {}): TaskSummary => ({id, title: id, project: 'Project', priority: 'P1', stage: 'building', owner: 'OWNER', model: null, updated: '2026-10-06T00:00:00Z', ...extra});
const registry = {workspaces: [{id:'project',name:'Project',color:'#6aaeff',order:0,nav:true,owner:'OWNER'}],taskAliases:{WORKER:'OWNER'}};

test('filters retain complete ancestor chain, exclude unrelated siblings and never mutate records', () => {
 const root=t('root',{stage:'live'}), middle=t('middle',{parent:'root'}), child=t('child',{parent:'middle',needs:true});
 const all=[root,middle,child,t('sibling',{parent:'root'})]; const before=JSON.stringify(all);
 const view=taskAncestorContext([child],all);
 assert.deepEqual(view.map(t=>t.id),['root','middle','child']);
 assert.deepEqual(workspaceTaskGroups(view,registry,all)[0].tasks.map(t=>t.id),['root']);
 assert.equal(JSON.stringify(all),before);
});
test('cycles and missing parents remain reachable, without a guessed workspace',()=>{
 const all=[t('a',{parent:'b'}),t('b',{parent:'a'}),t('orphan',{parent:'missing',project:'Unknown',owner:null})];
 assert.equal(taskAncestorContext([all[0]],all).length,2);
 const groups=workspaceTaskGroups(all,registry);
 assert.equal(groups[0].tasks.length,1);
 assert.deepEqual(groups[1].tasks.map(t=>t.id),['orphan']);
 assert.equal(taskWorkspace(all[2],registry,all),null);
});
test('preserves TASK-LANES affinity, alias spelling and index-independent ancestry',()=>{
 const r={...registry,taskIdentities:{'TASK-LANES':{workspace:'project'}}};
 const parent=t('root',{owner:'TASK-LANES',project:'Other'}),child=t('step',{parent:'root',owner:null,project:'Unknown'});
 assert.equal(taskWorkspace(parent,r), 'project');
 assert.equal(taskWorkspace(child,r,[parent,child]),'project');
 assert.equal(taskOwner(t('alias',{owner:'WORKER'}),r),'OWNER');
});
test('valid empty registry differs from missing, malformed, or duplicate registry',()=>{
 assert.equal(validTaskRegistry({workspaces:[]}),true);
 for (const r of [null,{}, {workspaces:[null]}, {workspaces:[registry.workspaces[0],registry.workspaces[0]]}, {...registry,taskAliases:{x:4}}, {...registry,taskIdentities:{x:null}}]) assert.equal(validTaskRegistry(r),false);
 assert.equal(validTaskRegistry(registry),true);
});
test('registry loading, loaded-empty and failed render distinct truth with reachable Unsorted',()=>{
 const props={tasks:[t('unknown')],all:[t('unknown')],registry:{workspaces:[]},renderTask:(t:TaskSummary)=>t.title};
 assert.match(renderToStaticMarkup(createElement(TaskWorkspaceGroups,props)),/Reading workspaces/);
 const empty=renderToStaticMarkup(createElement(TaskWorkspaceGroups,{...props,loaded:true,reveal:true}));
 assert.match(empty,/Unsorted/);assert.match(empty,/unknown/);assert.doesNotMatch(empty,/Reading workspaces/);
 const failed=renderToStaticMarkup(createElement(TaskWorkspaceGroups,{...props,failed:true}));
 assert.match(failed,/unknown/);assert.doesNotMatch(failed,/Reading workspaces/);
});
test('plan does not tick future outcomes and recognises NEXT user actions',()=>{
 const now=Date.parse('2026-10-06T12:00:00Z');
 const phases=planPhases([t('future',{stage:'happy',updated:'2026-10-07T12:00:00Z'}),t('recent',{stage:'live',updated:'2026-10-06T11:00:00Z'}),t('preview',{stage:'preview',needs:true}),t('built',{stage:'built'})],()=>false,now);
 assert.equal(phases[0].done,0);assert.equal(phases[1].done,1);
 assert.equal(phases[1].steps.find(s=>s.t.id==='built')?.mark,'todo');
 assert.equal(turnAction(t('next',{next:'NEXT: Shaan tries the fixture'})),'Try the fixture');
});
test('task source unavailable survives index projection, recovers, and invalid index returns 503',async()=>{
 const base=process.env.AB_TASK_TREE_FIXTURE!; assert.ok(base);
 const root=base+'/tasks';mkdirSync(root,{recursive:true});
 const row=t('t-fixture'); const index={updated:row.updated,counts:{},tasks:[row]};
 writeFileSync(root+'/INDEX.json',JSON.stringify(index));
 const read=createA0TasksHandler(root);
 const readRow=async()=>((await read('/api/a0/tasks'))!.body as {tasks:({source:string}&TaskSummary)[]}).tasks[0];
 assert.equal((await readRow()).source,'unavailable');
 assert.equal((await read('/api/a0/tasks/t-fixture'))!.status,503);
 writeFileSync(root+'/t-fixture.json','{"id":"different","title":"wrong","stage":"building"}');
 assert.equal((await readRow()).source,'unavailable');
 writeFileSync(root+'/t-fixture.json',JSON.stringify({...row,next:'NEEDS HIM: inspect fixture',parent:'parent',workspace:'project'}));
 const restored=await readRow();assert.equal(restored.source,'available');assert.equal(restored.needs,true);assert.equal(restored.parent,'parent');
 assert.equal((await read('/api/a0/tasks/t-fixture'))!.status,200);
 writeFileSync(root+'/t-fixture.json','invalid');
 const unavailable=await readRow();assert.equal(unavailable.source,'unavailable');assert.equal(unavailable.parent,'parent');assert.equal(unavailable.workspace,'project');
 writeFileSync(root+'/t-fixture.json',JSON.stringify(row));
 const cleared=await readRow();assert.equal(cleared.parent,null);assert.equal(cleared.workspace,null);
 writeFileSync(root+'/INDEX.json',JSON.stringify({...index,tasks:[null]}));
 assert.equal((await read('/api/a0/tasks'))!.status,503);
 assert.equal((await read('/api/a0/tasks/t-fixture'))!.status,503);
});
