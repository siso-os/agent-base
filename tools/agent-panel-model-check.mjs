import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const root = path.resolve(import.meta.dirname, '..'), deps = process.env.AB_DEPENDENCY_ROOT ?? root;
const require = createRequire(path.join(deps, 'apps/web/package.json'));
const { transformSync } = createRequire(require.resolve('vite'))('esbuild');
const source = fs.readFileSync(path.join(root, 'apps/web/src/lib/panel-team.ts'), 'utf8');
const { code } = transformSync(source, { loader: 'ts', format: 'esm' });
const { panelTeam, flattenPanelTeam } = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
const agent = (id, extra = {}) => ({ id, name: id.toUpperCase(), row: 'live', status: 'idle', project: 'Example', ...extra });
const zero = agent('zero', { zero: true }), owner = agent('owner', { kind: 'owner' });
const registry = names => ({ groups: [{ projects: [{ name: 'Registered workspace', owners: names.map(name => ({ name, state: 'planned' })) }] }], bottom: [] });
const result = [];
const check = (name, action) => { action(); result.push(name); };

check('Recorded parent wins over a conflicting lead', () => {
  const roots = panelTeam(zero, [owner, agent('other', { kind: 'owner' }), agent('worker', { kind: 'worker', parentId: owner.id, lead: 'OTHER' })], null);
  assert.equal(roots.find(n => n.id === owner.id).children[0].id, 'worker');
  assert.equal(roots.find(n => n.id === 'other').children.length, 0);
});
check('A missing explicit parent cannot invent a reporting line', () => {
  const roots = panelTeam(zero, [owner, agent('worker', { kind: 'worker', parentId: 'missing', lead: 'OWNER' })], null);
  assert.equal(roots.find(n => n.id === 'worker').group, 'Unassigned');
  assert.equal(roots.find(n => n.id === owner.id).children.length, 0);
});
check('Ambiguous owner names leave the worker unassigned', () => {
  const roots = panelTeam(zero, [agent('one', { name: 'OWNER' }), agent('two', { name: 'OWNER' }), agent('worker', { kind: 'worker', lead: 'OWNER' })], registry(['OWNER']));
  assert.equal(roots.find(n => n.id === 'worker').group, 'Unassigned');
  assert.equal(roots.find(n => n.id === 'seat:OWNER').state, 'unresolved');
});
check('Offline and planned registry owners stay visible', () => {
  const roots = panelTeam(zero, [], registry(['FUTURE OWNER']));
  assert.equal(roots[0].state, 'planned'); assert.equal(roots[0].agent, null);
  const org = registry(['OFFLINE OWNER']); org.groups[0].projects[0].owners[0].state = 'active';
  assert.equal(panelTeam(zero, [], org)[0].state, 'offline');
});
check('A unique offline owner can own a connected worker', () => {
  const roots = panelTeam(zero, [agent('worker', { kind: 'worker', lead: 'OWNER' })], registry(['OWNER']));
  assert.equal(roots.length, 1); assert.equal(roots[0].children[0].id, 'worker');
});
check('Cycles retain every identity without recursion', () => {
  const agents = [agent('one', { parentId: 'two' }), agent('two', { parentId: 'three' }), agent('three', { parentId: 'one' })];
  const flat = flattenPanelTeam(panelTeam(zero, agents, null));
  assert.deepEqual(flat.map(n => n.id).sort(), ['one', 'three', 'two']);
});
check('Duplicate IDs produce one row and the selected agent is current', () => {
  const roots = panelTeam(owner, [agent('owner', { title: 'old' }), agent('worker', { parentId: owner.id }), agent('worker', { parentId: owner.id })], null);
  assert.equal(flattenPanelTeam(roots).length, 2); assert.equal(roots[0].agent, owner);
});
check('An owner panel contains only that owner and its descendants', () => {
  const roots = panelTeam(owner, [owner, agent('worker', { navParentId: owner.id }), agent('other')], null);
  assert.deepEqual(flattenPanelTeam(roots).map(n => n.id).sort(), ['owner', 'worker']);
});
check('Attention comes first while completed workers remain recorded', () => {
  const roots = panelTeam(zero, [agent('idle'), agent('work', { status: 'working' }), agent('failed', { status: 'failed' }), agent('done', { kind: 'worker', parentId: 'work', status: 'done' })], null);
  assert.deepEqual(roots.map(n => n.id), ['failed', 'work', 'idle']);
  assert.equal(roots[1].children[0].state, 'done');
});
check('Settled sessions do not masquerade as connected owners', () => {
  const roots = panelTeam(zero, [agent('owner', { row: 'settled' })], registry(['OWNER']));
  assert.equal(roots[0].agent, null);
});
const report = { passed: result.length, checks: result };
if (process.env.AB_PANEL_OUTPUT) fs.writeFileSync(path.join(process.env.AB_PANEL_OUTPUT, 'model-checks.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report));
