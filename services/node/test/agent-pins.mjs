/** Synthetic-only pin storage, API and exact identity checks. No server boot, providers or private files. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync, writeFileSync, readdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import ts from '../../../apps/web/node_modules/typescript/lib/typescript.js';
import * as pins from '../src/agent-pins.ts';
import { agentNavigation } from '../src/agent-nav.ts';
import { editWorkspace } from '../src/workspace-registry.ts';
import { jsonStore } from '../src/store.ts';

const clone = value => JSON.parse(JSON.stringify(value));
const workspace = (id = 'client', owner = 'OWNER') => ({ id, owner, name: id, group: 'Clients', color: '#123456', order: 0 });
const row = (id = 'exact-a', extra = {}) => ({ id, name: 'OWNER', machineKey: 'fixture-machine', machine: 'Fixture machine', tool: 'claude', session: `session-${id}`, workspace: 'client', kind: 'owner', row: 'live', cwd: '/fixture/repo', pane: `pane-${id}`, ...extra });
const registry = (extra = {}) => ({ workspaces: [workspace()], pinned: [], agents: {}, aliases: {}, domains: [], projects: [], pages: {}, hiddenPages: {}, pinnedPages: [], recentPages: [], ...extra });
let sequence = 0;
const newId = () => `pin-test-${++sequence}`;
const ownerTarget = { kind: 'owner', workspaceId: 'client' };
const conv = a => pins.conversationTarget(a);
const edit = (r, body, rows) => pins.editAgentPins(r, body, rows, newId);

test('legacy migration preserves order and binds uniquely configured owners while offline', () => {
  const r = registry({ pinned: ['OWNER', 'ABSENT'] });
  assert.equal(pins.migrateAgentPins(r, [], newId), true);
  assert.deepEqual(r.pinRefs.map(p => [p.name, p.target]), [['OWNER', ownerTarget], ['ABSENT', null]]);
  assert.deepEqual(pins.projectAgentPins(r, []).pins.map(p => p.state), ['unavailable', 'unresolved']);
  const before = clone(r.pinRefs);
  assert.equal(pins.migrateAgentPins(r, [row()], newId), false);
  assert.deepEqual(r.pinRefs, before);
});

test('ambiguous legacy runtime names never bind later when a claimant disappears', () => {
  for (const rows of [[row(), row('exact-b')], [row('exact-b'), row()]]) {
    const r = registry({ pinned: ['OWNER'] });
    pins.migrateAgentPins(r, rows, newId);
    assert.equal(r.pinRefs[0].target, null);
    pins.migrateAgentPins(r, [row()], newId);
    assert.equal(r.pinRefs[0].target, null);
    assert.equal(pins.projectAgentPins(r, [row()]).pins[0].state, 'unresolved');
  }
});

test('duplicate configured owners, duplicate workspace IDs, duplicate legacy entries and foreign membership stay unresolved', () => {
  for (const [workspaces, legacy, rows] of [
    [[workspace(), workspace('other')], ['OWNER'], []],
    [[workspace(), workspace('client', '')], ['OWNER'], []],
    [[workspace()], ['OWNER', 'OWNER'], []],
    [[workspace()], ['OWNER'], [row('foreign', { workspace: 'other' })]],
  ]) {
    const r = registry({ workspaces, pinned: legacy });
    pins.migrateAgentPins(r, rows, newId);
    assert.ok(r.pinRefs.every(p => p.target === null));
  }
});

test('a unique observed non-owner conversation never authorizes legacy migration, including partial snapshots', () => {
  for (const rows of [[row('one', { name: 'CHAT', kind: 'worker' })], undefined, []]) {
    const r = registry({ pinned: ['CHAT'] });
    pins.migrateAgentPins(r, rows, newId);
    assert.equal(r.pinRefs[0].target, null);
  }
});

test('durable owner slot survives restarts and configured owner changes without becoming a session pin', () => {
  const r = registry();
  assert.equal(edit(r, { op: 'pin-target', target: ownerTarget, name: 'untrusted label' }, []), null);
  const id = r.pinRefs[0].id;
  assert.equal(r.pinRefs[0].name, 'OWNER');
  assert.equal(pins.projectAgentPins(r, []).pins[0].state, 'unavailable');
  assert.equal(pins.projectAgentPins(r, [row('first')]).pins[0].agentId, 'first');
  assert.equal(pins.projectAgentPins(r, [row('restart')]).pins[0].agentId, 'restart');
  r.workspaces[0].owner = 'NEXT';
  assert.equal(pins.projectAgentPins(r, [row('old')]).pins[0].state, 'unavailable');
  assert.equal(pins.projectAgentPins(r, [row('new', { name: 'NEXT' })]).pins[0].agentId, 'new');
  assert.equal(r.pinRefs[0].id, id);
  assert.deepEqual(r.pinRefs[0].target, ownerTarget);
});

test('owner resolution rejects multiple claimants before row or host availability filtering', () => {
  const pin = { id: 'owner-pin', name: 'OWNER', target: ownerTarget };
  for (const other of [row('other'), row('other', { row: 'settled' }), row('other', { row: 'snoozed' }), row('other', { serviceHost: { state: 'down' } })]) {
    assert.equal(pins.resolveAgentPin(pin, [row(), other], [workspace()]).state, 'ambiguous');
    assert.equal(pins.resolveAgentPin(pin, [other, row()], [workspace()]).state, 'ambiguous');
  }
  assert.equal(pins.resolveAgentPin(pin, [row()], [workspace(), workspace('client', '')]).state, 'ambiguous');
  assert.equal(pins.resolveAgentPin(pin, [row()], []).state, 'unavailable');
  assert.equal(pins.resolveAgentPin(pin, [row('worker', { kind: 'worker' })], [workspace()]).state, 'unavailable');
});

test('configured main, navigation-owner and zero roles retain durable slot identity without kind', () => {
  const pin = { id: 'owner-pin', name: 'OWNER', target: ownerTarget };
  for (const role of [{ main: true }, { navOwner: true }, { zero: true }]) {
    const a = row('configured', { kind: undefined, ...role });
    assert.deepEqual(pins.pinTargetForRow(a, [workspace()]), ownerTarget);
    assert.equal(pins.resolveAgentPin(pin, [a], [workspace()]).state, 'ready');
    const r = registry({ pinned: ['OWNER'] });
    pins.migrateAgentPins(r, [a], newId);
    assert.deepEqual(r.pinRefs[0].target, ownerTarget);
  }
  assert.equal(pins.resolveAgentPin(pin, [row('worker', { kind: 'worker', main: true })], [workspace()]).state, 'unavailable');
});

test('same-name conversations remain independently pinned across reorder, rename and route-ID renewal', () => {
  const a = row('a', { workspace: 'unconfigured' }), b = row('b', { workspace: 'unconfigured' });
  const r = registry();
  for (const selected of [a, b]) assert.equal(edit(r, { op: 'pin-target', target: conv(selected), agentId: selected.id }, [a, b]), null);
  assert.equal(r.pinRefs.length, 2);
  assert.deepEqual(pins.projectAgentPins(r, [b, a]).pins.map(p => p.agentId), ['a', 'b']);
  assert.deepEqual(pins.projectAgentPins(r, [b, a]).pinned, []);
  assert.ok(pins.projectAgentPins(r, [b, a]).agents.every(a => a.pinned && a.pinIds.length === 1));
  const renamed = { ...a, id: 'a-renewed', name: 'RENAMED' };
  assert.equal(pins.projectAgentPins(r, [renamed, b]).pins[0].agentId, 'a-renewed');
  assert.equal(pins.projectAgentPins(r, [renamed, b]).pins[0].name, 'RENAMED');
  assert.equal(pins.projectAgentPins(r, [{ ...a, session: 'replacement' }, b]).pins[0].state, 'unavailable');
});

test('conversation identity seals machine, normalized harness and session, never sessionless or reused IDs', () => {
  const a = row('a', { tool: 'siso' }), pin = { id: 'p', name: 'OWNER', target: conv(a) };
  assert.equal(pin.target.harness, 'claude');
  assert.equal(pins.resolveAgentPin(pin, [{ ...a, tool: 'claude' }], []).state, 'ready');
  for (const extra of [{ machineKey: 'other-machine' }, { tool: 'codex' }, { session: 'new-session' }, { session: null }]) assert.equal(pins.resolveAgentPin(pin, [{ ...a, ...extra }], []).state, 'unavailable');
  assert.equal(pins.conversationTarget({ ...a, session: null }), null);
  assert.equal(pins.resolveAgentPin(pin, [a, { ...a, id: 'same-session' }], []).state, 'ambiguous');
  assert.equal(pins.resolveAgentPin(pin, [a, { ...a, session: 'different' }], []).state, 'ambiguous');
});

test('stale or forged mutations fail atomically; conversation needs exact selected row', () => {
  const a = row(), r = registry({ pinned: ['OWNER'] }), before = clone(r);
  for (const body of [
    { op: 'pin-target', target: conv(a) },
    { op: 'pin-target', target: conv(a), agentId: 'unknown' },
    { op: 'pin-target', target: { ...conv(a), session: 'forged' }, agentId: a.id },
    { op: 'pin-target', target: { kind: 'owner', workspaceId: 'unknown' } },
    { op: 'pin-target', target: { kind: 'conversation', machine: '', harness: 'claude', session: a.session }, agentId: a.id },
  ]) {
    assert.equal(typeof edit(r, body, [a]), 'string');
    assert.deepEqual(r, before);
  }
});

test('explicit binding preserves a legacy pin ID/order; reorder and unpin preserve peers and do not revive legacy projection', () => {
  const r = registry({ pinned: ['UNKNOWN', 'OWNER'] });
  pins.migrateAgentPins(r, [], newId);
  const first = r.pinRefs[0].id, second = r.pinRefs[1].id, a = row('chosen', { name: 'CHOSEN' });
  assert.equal(edit(r, { op: 'bind-pin', pinId: first, expectedTarget: null, target: conv(a), agentId: a.id }, [a]), null);
  assert.equal(r.pinRefs[0].id, first);
  assert.equal(edit(r, { op: 'pin-ref-order', ids: [second] }, []), null);
  assert.deepEqual(r.pinRefs.map(p => p.id), [second, first]);
  assert.equal(edit(r, { op: 'unpin-ref', pinId: second }), null);
  assert.deepEqual(r.pinRefs.map(p => p.id), [first]);
  r.pinned = ['OWNER', 'UNEXPECTED OLD WRITER'];
  assert.equal(pins.migrateAgentPins(r, [row()], newId), false);
  assert.deepEqual(r.pinRefs.map(p => p.id), [first]);
});

test('legacy mutations reject ambiguity without selecting or removing a namesake', () => {
  const a = row('a'), b = row('b'), r = registry();
  assert.match(edit(r, { op: 'pin', name: 'OWNER' }, [a, b]), /ambiguous/);
  assert.equal(r.pinRefs, undefined);
  for (const selected of [a, b]) assert.equal(edit(r, { op: 'pin-target', target: conv(selected), agentId: selected.id }, [a, b]), null);
  const before = clone(r);
  assert.match(edit(r, { op: 'unpin', name: 'OWNER' }), /ambiguous/);
  assert.match(edit(r, { op: 'pin-order', names: ['OWNER'] }), /ambiguous/);
  assert.deepEqual(r, before);
});

test('name-based compatibility projection is emitted only for one ready inventory claimant', () => {
  const r = registry(), a = row();
  assert.equal(edit(r, { op: 'pin-target', target: conv(a), agentId: a.id }, [a]), null);
  assert.deepEqual(pins.projectAgentPins(r, [a]).pinned, ['OWNER']);
  assert.deepEqual(pins.projectAgentPins(r, [a, row('unavailable', { row: 'settled' })]).pinned, []);
  assert.deepEqual(pins.projectAgentPins(r, []).pinned, []);
});

test('malformed saved refs remain visible, unique and unresolved instead of throwing or dropping pins', () => {
  const refs = pins.normalizePinRefs([{ id: 'same', name: 'FIRST', target: { kind: 'future', id: 'future' } }, { id: 'same', name: 'SECOND', target: null }, 'LEGACY', null]);
  assert.deepEqual(refs.map(p => p.name), ['FIRST', 'SECOND', 'LEGACY', 'Saved agent']);
  assert.equal(new Set(refs.map(p => p.id)).size, 4);
  assert.ok(refs.every(p => p.target === null));
  assert.equal(pins.normalizePinRefs({ malformed: true }).length, 1);
  assert.deepEqual(pins.normalizePinRefs(refs), refs);
  const opaque = { id: 'future', name: 'Saved', target: { kind: 'conversation', machine: 'fixture-machine', harness: 'claude', session: row().session, user: 'future-scope' }, futureMetadata: { revision: 2 } };
  const saved = pins.normalizePinRefs([opaque]);
  assert.equal(saved[0].target, null);
  assert.deepEqual(saved[0].unresolvedSource, opaque);
  assert.deepEqual(saved[0].futureMetadata, { revision: 2 });
  assert.equal(pins.resolveAgentPin(saved[0], [row()], [workspace()]).state, 'unresolved');
  assert.equal(pins.resolveAgentPin(saved[0], [row()], [workspace()]).unresolvedSource, undefined);
  assert.equal(pins.readPinTarget(opaque.target), null);
  const reserved = pins.normalizePinRefs([{ ...opaque, unresolvedSource: null }]);
  assert.deepEqual(reserved[0].unresolvedSource, { ...opaque, unresolvedSource: null });
  assert.deepEqual(pins.normalizePinRefs(reserved), reserved);
  const validId = pins.normalizePinRefs([null, { id: 'recovered-pin-0', name: 'Existing', target: null }]);
  assert.equal(validId[1].id, 'recovered-pin-0');
  assert.notEqual(validId[0].id, validId[1].id);
});

test('malformed legacy labels retain every slot and original value while remaining unresolved', () => {
  const r = registry({ pinned: ['OWNER', ' padded legacy ', 'x'.repeat(121), null] });
  pins.migrateAgentPins(r, [row()], newId);
  assert.equal(r.pinRefs.length, 4);
  assert.deepEqual(r.pinRefs.slice(1).map(pin => pin.unresolvedSource), [' padded legacy ', 'x'.repeat(121), null]);
  assert.ok(r.pinRefs.slice(1).every(pin => pin.target === null));
  const malformed = registry({ pinned: { name: 'malformed saved list' } });
  pins.migrateAgentPins(malformed, [], newId);
  assert.deepEqual(malformed.pinRefs[0].unresolvedSource, { name: 'malformed saved list' });
  assert.equal(edit(malformed, { op: 'unpin-ref', pinId: malformed.pinRefs[0].id }), null);
  assert.deepEqual(malformed.pinRefs, []);
});

test('bind requires the observed target and refuses a stale window replacing a newer binding', () => {
  const r = registry({ pinRefs: [{ id: 'saved', name: 'Legacy', target: null }], workspaces: [workspace(), workspace('other', 'OTHER')] });
  const before = clone(r), second = { kind: 'owner', workspaceId: 'other' };
  assert.match(edit(r, { op: 'bind-pin', pinId: 'saved', target: ownerTarget }, []), /previous pin target/);
  assert.deepEqual(r, before);
  assert.equal(edit(r, { op: 'bind-pin', pinId: 'saved', expectedTarget: null, target: ownerTarget }, []), null);
  const after = clone(r);
  assert.match(edit(r, { op: 'bind-pin', pinId: 'saved', expectedTarget: null, target: second }, []), /another window/);
  assert.deepEqual(r, after);
  assert.equal(edit(r, { op: 'bind-pin', pinId: 'saved', expectedTarget: null, target: ownerTarget }, []), null, 'same-target retry remains idempotent');
  assert.equal(edit(r, { op: 'bind-pin', pinId: 'saved', expectedTarget: ownerTarget, target: second }, []), null, 'explicit current-target replacement works');
  assert.deepEqual(r.pinRefs[0].target, second);
});

test('early legacy remove and reorder do not finalize unrelated migration without inventory', () => {
  for (const body of [{ op: 'unpin', name: 'OTHER' }, { op: 'pin-order', names: ['OWNER'] }]) {
    const r = registry({ pinned: ['OTHER', 'OWNER'] });
    assert.equal(edit(r, body), null);
    assert.equal(r.pinRefs, undefined);
    pins.migrateAgentPins(r, [], newId);
    assert.deepEqual(r.pinRefs.find(pin => pin.name === 'OWNER').target, ownerTarget);
  }
  const opaque = { unknown: { keep: 'all bytes' } }, r = registry({ pinned: [opaque, 'OWNER', 'OTHER', ' padded '] });
  assert.equal(edit(r, { op: 'unpin', name: 'OTHER' }), null);
  assert.deepEqual(r.pinned, [opaque, 'OWNER', ' padded ']);
  assert.equal(edit(r, { op: 'pin-order', names: ['OWNER'] }), null);
  assert.deepEqual(r.pinned, ['OWNER', opaque, ' padded ']);
  assert.equal(r.pinRefs, undefined);
});

test('explicit cold-outage owner pin migrates unique configured roles only and later duplicate claimants disable chat', () => {
  const r = registry({ workspaces: [workspace(), workspace('other', 'OTHER')], pinned: ['OWNER', 'CHAT', { future: 'keep' }] });
  assert.equal(edit(r, { op: 'pin-target', target: { kind: 'owner', workspaceId: 'other' } }), null);
  assert.deepEqual(r.pinRefs.map(pin => pin.target), [ownerTarget, null, null, { kind: 'owner', workspaceId: 'other' }]);
  assert.deepEqual(r.pinRefs[2].unresolvedSource, { future: 'keep' });
  const ids = r.pinRefs.map(pin => pin.id);
  assert.equal(pins.projectAgentPins(r, []).pins[0].state, 'unavailable');
  assert.equal(pins.projectAgentPins(r, [row(), row('duplicate')]).pins[0].state, 'ambiguous');
  assert.equal(pins.migrateAgentPins(r, [row()], newId), false);
  assert.deepEqual(r.pinRefs.map(pin => pin.id), ids);
  assert.equal(r.pinRefs[1].target, null);
});

test('migration decisions survive disk reload and owner rename preserves sealed targets', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'agent-pin-fixture-'));
  try {
    const file = path.join(dir, 'registry.json');
    const load = d => registry(d);
    const store = jsonStore(file, load);
    store.data.pinned = ['OWNER'];
    pins.migrateAgentPins(store.data, [row(), row('duplicate')], newId);
    store.save();
    const restored = jsonStore(file, load);
    pins.migrateAgentPins(restored.data, [row()], newId);
    assert.equal(restored.data.pinRefs[0].target, null);
    assert.equal(edit(restored.data, { op: 'bind-pin', pinId: restored.data.pinRefs[0].id, expectedTarget: null, target: ownerTarget }, []), null);
    const target = clone(restored.data.pinRefs[0].target);
    pins.renameAgentPins(restored.data, 'OWNER', 'RENAMED');
    assert.equal(restored.data.workspaces[0].owner, 'RENAMED');
    assert.equal(restored.data.pinRefs[0].name, 'RENAMED');
    assert.deepEqual(restored.data.pinRefs[0].target, target);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('corrupt pin entries recover without quarantining the registry or losing opaque persisted fields', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'agent-pin-recovery-'));
  try {
    const file = path.join(dir, 'registry.json');
    const future = { id: 'future', name: 'Future pin', target: { kind: 'future-owner', tenant: 'retained' }, extra: { revision: 7 } };
    writeFileSync(file, JSON.stringify(registry({ pinRefs: [future, null, { id: 'kept', name: 'Existing', target: ownerTarget }] })));
    const store = jsonStore(file, d => ({ ...registry(d), pinRefs: pins.normalizePinRefs(d.pinRefs) }));
    assert.equal(store.data.pinRefs.length, 3);
    assert.equal(store.data.pinRefs[0].target, null);
    store.save();
    assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')).pinRefs[0].unresolvedSource, future);
    assert.ok(!readdirSync(dir).some(name => name.includes('.bad-')));
    assert.equal(edit(store.data, { op: 'unpin-ref', pinId: store.data.pinRefs[1].id }), null);
    store.save();
    const reloaded = jsonStore(file, d => ({ ...registry(d), pinRefs: pins.normalizePinRefs(d.pinRefs) }));
    assert.deepEqual(reloaded.data.pinRefs.map(pin => pin.id), ['future', 'kept']);
    assert.deepEqual(reloaded.data.pinRefs[0].unresolvedSource, future);
    assert.equal(pins.projectAgentPins(reloaded.data, []).pins[0].unresolvedSource, undefined);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

const root = path.resolve(import.meta.dirname, '../../..');
function transpile(source) { return ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText; }
const serverSource = ts.createSourceFile('server.ts', readFileSync(path.join(root, 'services/node/src/server.ts'), 'utf8'), ts.ScriptTarget.Latest, true);
const editSource = serverSource.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === 'edit').getText(serverSource);
const areaSource = ts.createSourceFile('directory.area.ts', readFileSync(path.join(root, 'services/node/src/routes/directory.area.ts'), 'utf8'), ts.ScriptTarget.Latest, true);
const areaBody = areaSource.statements.filter(n => !ts.isImportDeclaration(n)).map(n => n.getText(areaSource).replace(/^export /, '')).join('\n');
function httpFixture(r, rows, options = {}) {
  const effects = [];
  const context = vm.createContext({ ...pins, console, URL, Set, Map,
    registry: r, registryStore: { fresh() { effects.push('fresh'); options.onFresh?.(r); } },
    randomUUID: newId, saveRegistry: () => effects.push('save'),
    str: (value, max = 300) => typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : undefined,
    editWorkspace, renameRow: () => {}, rowKey: name => name, saveRows: () => {},
    agentNavigation, codexWorkerRows: () => options.workers ?? [], readRunParents: () => [],
  });
  vm.runInContext(transpile(editSource + '\n' + areaBody), context);
  const runtime = { ALLOWED_ORIGINS: new Set(), HERDR: [], MACHINE: 'fixture-machine', registry: r, registryStore: context.registryStore,
    listAgents: async maxAge => { effects.push(`list:${maxAge}`); if (options.unavailable) throw Error('fixture inventory unavailable'); options.onRead?.(r); return rows; },
    placeNew: () => {}, saveRegistry: context.saveRegistry,
    json: (res, status, body) => { res.status = status; res.body = body; return true; }, readBody: async req => JSON.stringify(req.body), edit: context.edit,
  };
  const readRoute = context.directoryRoutes(runtime), writeRoute = context.directoryWritesRoutes(runtime);
  return { effects, async request(body) { const res = {}; const req = { method: body === undefined ? 'GET' : 'POST', url: body === undefined ? '/api/agents' : '/api/registry', body }; await (body === undefined ? readRoute : writeRoute).handle(req, res, null, new URL(req.url, 'http://fixture')); return clone(res); } };
}

test('real directory route projects all pin fields and persists migration exactly once', async () => {
  const r = registry({ pinned: ['OWNER'] }), f = httpFixture(r, []);
  const first = await f.request();
  assert.equal(first.status, 200);
  assert.equal(first.body.pins[0].state, 'unavailable');
  assert.deepEqual(first.body.pins[0].target, ownerTarget);
  assert.deepEqual(first.body.pinned, []);
  assert.equal(f.effects.filter(e => e === 'save').length, 1);
  await f.request();
  assert.equal(f.effects.filter(e => e === 'save').length, 1);
});

test('real directory route retains hidden same-name worker observations for migration and resolution', async () => {
  const a = row(), worker = row('worker', { codexWorker: true, session: null });
  const r = registry({ pinned: ['OWNER'], agents: { OWNER: { workspace: 'client', kind: 'owner' } } });
  const f = httpFixture(r, [a], { workers: [worker] });
  const response = await f.request();
  assert.equal(response.body.agents.length, 1, 'display de-duplication stays unchanged');
  assert.equal(r.pinRefs[0].target, null, 'hidden observed namesake blocks legacy binding');
  assert.equal(response.body.pins[0].state, 'unresolved');
  assert.equal((await f.request({ op: 'bind-pin', pinId: r.pinRefs[0].id, expectedTarget: null, target: ownerTarget })).status, 200);
  assert.equal((await f.request()).body.pins[0].state, 'ambiguous', 'explicit slot still refuses two runtime claimants');
  assert.equal((await f.request({ op: 'pin', name: 'OWNER' })).status, 400, 'legacy mutation also sees the hidden worker');
});

test('real mutation route takes a fresh snapshot, then server edit refreshes registry and rejects a changed conversation', async () => {
  const old = row(), changed = { ...old, session: 'replacement' }, r = registry(), f = httpFixture(r, [changed]);
  const response = await f.request({ op: 'pin-target', target: conv(old), agentId: old.id });
  assert.equal(response.status, 400);
  assert.match(response.body.error, /changed/);
  assert.deepEqual(f.effects, ['list:0', 'fresh']);
  assert.equal(r.pinRefs, undefined);
});

test('real route preserves offline owner pin/bind/unpin and rejects conversation mutation when inventory fails', async () => {
  const r = registry(), f = httpFixture(r, [], { unavailable: true });
  assert.equal((await f.request({ op: 'pin-target', target: ownerTarget })).status, 200);
  const id = r.pinRefs[0].id;
  assert.equal((await f.request({ op: 'bind-pin', pinId: id, expectedTarget: ownerTarget, target: ownerTarget })).status, 200);
  assert.equal((await f.request({ op: 'pin-target', target: conv(row()), agentId: row().id })).status, 409);
  assert.equal((await f.request({ op: 'unpin-ref', pinId: id })).status, 200);
  assert.deepEqual(r.pinRefs, []);
});

test('real rename updates configured owner and saved label without changing target or other slots', async () => {
  const r = registry({ agents: { OWNER: { kind: 'owner', workspace: 'client' } }, workspaces: [workspace(), workspace('other', 'OTHER')] });
  edit(r, { op: 'pin-target', target: ownerTarget }, []);
  const f = httpFixture(r, []);
  assert.equal((await f.request({ op: 'rename', name: 'OWNER', to: 'RENAMED' })).status, 200);
  assert.equal(r.workspaces[0].owner, 'RENAMED');
  assert.equal(r.workspaces[1].owner, 'OTHER');
  assert.equal(r.pinRefs[0].name, 'RENAMED');
  assert.deepEqual(r.pinRefs[0].target, ownerTarget);
  assert.equal((await f.request({ op: 'rename', name: 'RENAMED', to: 'OTHER' })).status, 400);
  assert.equal((await f.request({ op: 'rename', name: 'renamed', to: 'OTHER' })).status, 400);
  assert.equal((await f.request({ op: 'rename', name: 'RENAMED', to: 'other' })).status, 400);
  assert.equal((await f.request({ op: 'rename', name: 'renamed', to: 'Next' })).status, 200);
  assert.equal(r.workspaces[0].owner, 'Next');
  assert.equal(r.agents.Next.workspace, 'client');
  assert.equal(r.agents.RENAMED, undefined);
  assert.equal((await f.request({ op: 'rename', name: 'next', to: 'Next' })).status, 200);
  assert.equal(r.agents.Next.workspace, 'client');
});

test('real fresh mutation uses latest registry main role after awaiting inventory', async () => {
  const a = row('main', { kind: undefined, main: undefined, workspace: undefined });
  const r = registry({ pinned: ['OWNER'] });
  const f = httpFixture(r, [a], { onRead: registry => { registry.agents.OWNER = { workspace: 'client', main: true }; } });
  assert.equal((await f.request({ op: 'pin', name: 'OWNER' })).status, 200);
  assert.deepEqual(r.pinRefs[0].target, ownerTarget);
});
