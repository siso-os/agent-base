import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createSpaces, resolveSpace } from '../src/spaces.ts';
import { agencyFolders, migrate } from '../src/org.ts';

// The caller supplies a classified, synthetic evidence directory. Never use a real user's state.
assert.ok(process.argv[2], 'Provide a synthetic evidence directory');
const root = path.join(path.resolve(process.argv[2]), `state-${randomUUID()}`);
mkdirSync(root, { recursive: true });
const projects = [{ id: 'agent-base', name: 'Agent Base', path: 'SISO_Agency/apps/base' }];
const items = [
  { id: 'SISO_Agency/apps/base', name: 'Agent Base', project: 'agent-base' },
  { id: 'SISO_Agency/clients/demo', name: 'Demo client' },
  { id: 'industry:restaurants', name: 'Restaurants' },
];
const identity = id => resolveSpace(id, projects, items);
for (const alias of ['agent-base', 'Agent Base', 'AGENT BASE', 'SISO_Agency/apps/base']) assert.equal(identity(alias).key, 'agent-base');
assert.equal(identity('SISO_Agency/clients/demo').key, 'demo', 'preserve a unique legacy catalog leaf');
assert.equal(identity('Demo client').key, identity('demo').key);
assert.equal(identity('Restaurants').key, identity('industry:restaurants').key);
assert.match(identity('industry:restaurants').key, /^catalog-[a-f0-9]{64}$/);
for (const bad of ['../escape', 'SISO_Agency/../escape', '..', '.', 'unregistered', 'SISO_Agency\\clients\\demo', 'bad\u0000id']) assert.throws(() => identity(bad), TypeError);
const collisions = [{ id: 'SISO_Agency/clients/demo', name: 'First' }, { id: 'SISO_Agency/partners/demo', name: 'Second' }];
const first = resolveSpace(collisions[0].id, [], collisions), second = resolveSpace(collisions[1].id, [], collisions);
assert.notEqual(first.key, second.key);
assert.throws(() => resolveSpace('demo', [], collisions), /Ambiguous/);
assert.throws(() => resolveSpace('Same', [{ id: 'one', name: 'Same' }, { id: 'two', name: 'Same' }], []), /Ambiguous/);
assert.throws(() => resolveSpace(items[2].id, [{ id: identity(items[2].id).key, name: 'Conflicting registry key' }], items), /collision/);
assert.equal(resolveSpace('private', [{ id: 'private', name: 'Private', path: 'personal/demo' }], []).repo, undefined);

const spaces = createSpaces(root);
mkdirSync(path.join(root, 'agent-base', 'pins'), { recursive: true });
writeFileSync(path.join(root, 'agent-base', 'pins', 'existing.md'), '---\ntitle: Existing pin\n---\nSynthetic saved state');
spaces.patch('agent-base', { positions: { 'pin:existing': { x: 120, y: -60 } }, collapsed: { 'pin:existing': true } });
const before = readFileSync(path.join(root, 'agent-base.json'), 'utf8');
for (const alias of ['agent-base', 'Agent Base', 'SISO_Agency/apps/base']) {
  const saved = createSpaces(root).read(identity(alias).key, []);
  assert.equal(saved.pins[0].title, 'Existing pin');
  assert.equal(saved.layout.positions['pin:existing'].x, 120);
  assert.equal(saved.layout.collapsed['pin:existing'], true);
}
assert.equal(readFileSync(path.join(root, 'agent-base.json'), 'utf8'), before);
for (const c of collisions) { const resolved = resolveSpace(c.id, [], collisions); spaces.patch(resolved.key, { positions: { unique: { x: c === collisions[0] ? 1 : 2, y: 0 } } }); }
assert.equal(createSpaces(root).read(first.key, []).layout.positions.unique.x, 1);
assert.equal(createSpaces(root).read(second.key, []).layout.positions.unique.x, 2);

const input = { projects: [{ id: 'siso', name: 'SISO', group: 'labs', shown: true, order: 0 }], agents: {} };
const beforeMigration = JSON.stringify(input), migrated = migrate(input);
assert.equal(JSON.stringify(input), beforeMigration, 'directory projection never rewrites its input');
assert.deepEqual(migrate(migrated), migrated, 'project seats are stable across polls');
for (const name of ['Agent Base', 'Maths Innovations', 'Lifelog', 'Estate', 'Rolodex', 'Great Library of SISO', 'SISO Voice', 'SISO Web']) assert.equal(migrated.projects.filter(p => p.name === name).length, 1);
assert.ok(migrate({projects:['Agent Base'],agents:{}}).projects.some(p=>p.id==='agent-base'), 'legacy empty project is retained');
const removed={...migrated,projects:migrated.projects.filter(p=>p.id!=='siso-web')};
assert.ok(!migrate(removed).projects.some(p=>p.id==='siso-web'),'seeded removal persists');
assert.ok(migrated.projects.some(p => p.id === 'siso'), 'ambiguous older project survives');
const folders = agencyFolders({ clients: [
  { folder: '../partners/halo', kind: 'partner', name: 'HALO' },
  { folder: '../partners/fahmy', kind: 'partner', name: 'Fahmy' },
  { folder: '../partners/fahmy/clients/demo', kind: 'partner-client', name: 'Demo child' },
  { folder: 'demo-client', kind: 'lead', name: 'Independent client' },
] }, [], []);
const clients = folders.find(f => f.id === 'clients').items;
assert.ok(clients.some(c => c.name === 'Fahmy'));
assert.equal(clients.find(c => c.name === 'Demo child').parent, clients.find(c => c.name === 'Fahmy').id);
assert.ok(clients.some(c => c.name === 'Independent client'));
assert.equal(folders.find(f => f.id === 'industries').items.length, 7);
assert.ok(!folders.find(f => f.id === 'agencies').items.some(c => /fahmy/i.test(c.name)));
assert.deepEqual(folders.find(f => f.id === 'agencies').items.filter(c => c.kind === 'partner-project').map(c => c.name), ['HALO Streaming', 'HALO Agency Base']);
console.log('PASS: registered aliases, traversal, ambiguous/colliding catalog IDs, legacy pins/layout reload, private paths, idempotent projection, requested seats and nested clients.');
console.log('Synthetic state receipt: ' + root);
