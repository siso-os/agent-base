// FAKE data only. The browser's state lives in the node (a 0600 file) and the web migrates once from localStorage.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { cleanState, readBrowserState, writeBrowserState } from '../src/browser-state.ts';
import { createBrowserStore } from '../../../apps/web/src/lib/browser-store.ts';
import { loadArcProfiles } from '../../../apps/web/src/lib/webview.ts';

const dir = mkdtempSync(path.join(tmpdir(), 'ab-browser-state-'));
test.after(() => rmSync(dir, { recursive: true, force: true }));

test('the node keeps only known fields, in a private file, and refuses junk', () => {
  const file = path.join(dir, 'state/browser.json');
  assert.deepEqual(readBrowserState(file), {});
  writeBrowserState(file, cleanState({ spaces: [{ id: 'personal' }], accounts: [{ id: 'chrome:Default' }], today: {}, choice: { 'space:tab:1': 'HALO', bad: 3 }, setup: { step: 2 }, last: 'HALO', cookie: 'FAKE', migratedAt: 1 }));
  assert.equal(statSync(file).mode & 0o777, 0o600);
  assert.deepEqual(readBrowserState(file), { spaces: [{ id: 'personal' }], accounts: [{ id: 'chrome:Default' }], today: {}, choice: { 'space:tab:1': 'HALO' }, setup: { step: 2 }, last: 'HALO', migratedAt: 1 });
  assert.equal(cleanState([1, 2]), null);
  assert.equal(cleanState('x'), null);
  assert.throws(() => writeBrowserState(file, { spaces: ['x'.repeat(5 * 1024 * 1024)] }), /too large/);
});

const fakeLegacy = (entries) => { const m = new Map(entries); return { getItem: k => m.get(k) ?? null, key: i => [...m.keys()][i] ?? null, get length() { return m.size; } }; };

test('first load migrates localStorage once into the node; later writes go to the node, not localStorage', async () => {
  let node = {};
  const puts = [];
  const io = { get: async () => node, put: async s => { puts.push(s); node = s; } };
  const legacy = fakeLegacy([
    ['agent-base:arc-profiles', JSON.stringify([{ id: 'HALO', name: 'HALO', pins: [] }])],
    ['agent-base:browser-today', JSON.stringify({ HALO: [{ url: 'https://fake.invalid/', title: 'Fake', at: 1 }] })],
    ['agent-base:browser-profile:tab:1', 'HALO'],
    ['agent-base:browser-profile:last', 'HALO'],
    ['unrelated', 'x'],
  ]);
  const store = createBrowserStore(io, legacy);
  await store.load();
  assert.equal(puts.length, 1);
  assert.deepEqual(loadArcProfiles(store).map(p => p.id), ['HALO']);
  assert.equal(store.getItem('agent-base:browser-profile:tab:1'), 'HALO');
  assert.equal(store.getItem('agent-base:browser-profile:last'), 'HALO');
  assert.ok(node.migratedAt && node.choice['space:tab:1'] === 'HALO' && !JSON.stringify(node).includes('unrelated'));
  store.setItem('agent-base:browser-account:tab:1', 'chrome:Default');
  await store.flush();
  assert.equal(node.choice['account:tab:1'], 'chrome:Default');
  // A second window (or a restart) reads the node and does not migrate again, even with different localStorage.
  const again = createBrowserStore(io, fakeLegacy([['agent-base:arc-profiles', JSON.stringify([{ id: 'STALE', name: 'Stale', pins: [] }])]]));
  await again.load();
  assert.deepEqual(loadArcProfiles(again).map(p => p.id), ['HALO']);
  assert.equal(again.getItem('agent-base:browser-account:tab:1'), 'chrome:Default');
});

test('a node that is down or answers junk loads as empty and still works in memory', async () => {
  const store = createBrowserStore({ get: async () => { throw new Error('down'); }, put: async () => { throw new Error('down'); } }, null);
  await store.load();
  assert.equal(store.getItem('agent-base:arc-profiles'), null);
  store.setItem('agent-base:arc-profiles', JSON.stringify([{ id: 'x', name: 'X', pins: [] }]));
  assert.equal(loadArcProfiles(store).length, 1);
  await store.flush();
});
