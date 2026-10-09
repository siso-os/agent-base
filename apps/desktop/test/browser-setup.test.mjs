// FAKE data only. First run (A0 browser-UX spec §3): where he is in the 4 steps survives a restart through the node, and
// step 2's sort puts each Google account in a space, with each space's first account as its default.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { applySort, balance, byNeed, spaceChips, tileAction, importDone, loadSetup, mainAccount, toAdd, saveSetup, setupChip, setupDue, sortAccounts, UNSORTED } = await import('../../web/src/lib/browser-setup.ts');
const { createBrowserStore } = await import('../../web/src/lib/browser-store.ts');
const { accountFor, loadAccounts, loadArcProfiles, saveArcProfiles } = await import('../../web/src/lib/webview.ts');
const memory = () => { const m = new Map(); return { getItem: k => m.get(k) ?? null, setItem: (k, v) => m.set(k, v) }; };

const spaces = [
  { id: 'personal', name: 'Personal', pins: [], account: 'personal' },
  { id: 'HALO', name: 'HALO', pins: [], account: 'personal' },
  { id: 'arc:2', name: 'Fahmy Agency', pins: [], account: 'personal' },
];
const accounts = [
  { id: 'personal', name: 'Default', source: 'default' },
  { id: 'chrome:Default', name: 'me@gmail.invalid', email: 'me@gmail.com', chromeName: 'Shaan' },
  { id: 'chrome:Profile 1', name: 'ops@halo.invalid', email: 'ops@halo.invalid', chromeName: 'Work' },
  { id: 'chrome:Profile 2', name: 'side@gmail.com', email: 'side@gmail.com', chromeName: 'Fahmy' },
  { id: 'chrome:Profile 3', name: 'x@gmail.com', email: 'x@gmail.com', chromeName: 'AI' },
  { id: 'google:1', name: 'Google account 1', pendingGoogle: true },
];

test('the sort: work domain → its space, a Chrome profile named like a space → that space, the rest → Personal; Unsorted starts empty', () => {
  const cols = sortAccounts(accounts, spaces);
  assert.deepEqual(cols.HALO, ['chrome:Profile 1']);
  assert.deepEqual(cols['arc:2'], ['chrome:Profile 2']);
  assert.deepEqual(cols.personal, ['chrome:Default', 'chrome:Profile 3'], 'a 2-letter profile name ("AI") matches nothing; no address = not sorted');
  assert.deepEqual(cols[UNSORTED], []);
});

test('"Looks right": each space\'s first account is its default, accounts remember their column, Unsorted clears it; re-sorting keeps it', () => {
  const store = memory();
  const cols = sortAccounts(accounts, spaces);
  cols[UNSORTED] = ['chrome:Profile 3']; cols.personal = ['chrome:Default'];
  const out = applySort(cols, spaces, accounts, store);
  assert.equal(accountFor(out.spaces.find(s => s.id === 'HALO'), out.accounts), 'chrome:Profile 1');
  assert.equal(accountFor(out.spaces.find(s => s.id === 'personal'), out.accounts), 'chrome:Default');
  assert.equal(loadAccounts(store).find(a => a.id === 'chrome:Profile 2').space, 'arc:2');
  assert.equal(loadAccounts(store).find(a => a.id === 'chrome:Profile 3').space, undefined);
  assert.equal(loadArcProfiles(store).find(s => s.id === 'arc:2').account, 'chrome:Profile 2');
  // Run again: what he sorted stays where he put it, and the default leads its column.
  const again = sortAccounts(out.accounts, out.spaces);
  assert.deepEqual(again[UNSORTED], []);
  assert.deepEqual(again.personal, ['chrome:Default', 'chrome:Profile 3'], 'Unsorted is not remembered; it falls back to the guess');
  assert.equal(mainAccount(out.accounts, out.spaces).id, 'chrome:Default');
});

test('the sheet opens by itself only with no Google account yet or while sorting (step 2); from step 3 it waits behind the chip', () => {
  const none = [{ id: 'personal', name: 'Default' }];
  assert.equal(setupDue({ step: 1 }, none), true);
  assert.equal(setupDue({ step: 1 }, accounts), false, 'already has accounts: reachable from + only');
  assert.equal(setupDue({ step: 2 }, accounts), true);
  assert.equal(setupDue({ step: 3 }, accounts), false, 'mid-way: never by itself (it covered the pages he opened)');
  assert.equal(setupDue({ step: 3, closedAt: 1 }, accounts), false);
  assert.equal(setupDue({ step: 4, doneAt: 1 }, none), false);
  assert.deepEqual([{ step: 1 }, { step: 2 }, { step: 3, closedAt: 1 }, { step: 4 }, { step: 4, doneAt: 1 }].map(setupChip), [false, true, true, true, false], 'the chip stays after closing, until done');
  assert.equal(mainAccount(none, spaces), undefined);
});

test('the step is kept by the node: a quit and reopen lands on the same step', async () => {
  let node = {};
  const io = { get: async () => node, put: async s => { node = JSON.parse(JSON.stringify(s)); } };
  const first = createBrowserStore(io, null);
  await first.load();
  assert.deepEqual(loadSetup(first), { step: 1 });
  saveSetup({ step: 3 }, first);
  await first.flush();
  assert.deepEqual(node.setup, { step: 3 });
  const relaunched = createBrowserStore(io, null);
  await relaunched.load();
  assert.equal(loadSetup(relaunched).step, 3);
  const junk = createBrowserStore({ get: async () => ({ setup: { step: 9 } }), put: async () => {} }, null);
  await junk.load();
  assert.equal(loadSetup(junk).step, 1, 'a step out of range starts over');
});

test('"Looks right" keeps the saved spaces the sheet did not show (Arc\'s favourites were lost this way, 3 Oct)', () => {
  const store = memory();
  const favs = { id: 'arc-favorites', name: 'Arc Favorites', pinVersion: 2, pins: [{ url: 'https://fav.example.invalid/', title: 'Fav', pinned: true, origin: 'user' }] };
  saveArcProfiles([...spaces, favs], store);
  applySort(sortAccounts(accounts, spaces), spaces, accounts, store);
  const saved = loadArcProfiles(store);
  assert.deepEqual(saved.find(s => s.id === 'arc-favorites'), favs);
  assert.equal(saved.length, spaces.length + 1, 'no space twice');
});

test('the import is done once his main account is signed in; the one he signed in to counts as main; the rest wait to be added', () => {
  const s = [{ id: 'personal', name: 'Personal', pins: [], account: 'chrome:Default' }];
  const accs = [{ id: 'personal', name: 'Default' }, { id: 'chrome:Default', name: 'a', email: 'a@example.invalid', signedIn: false }, { id: 'chrome:2', name: 'f', email: 'fuze@example.invalid', signedIn: true }, { id: 'chrome:3', name: 'l', email: 'lost@example.invalid', signedIn: false, lostAt: 1 }, { id: 'chrome:4', name: 'n', email: 'new@example.invalid' }];
  assert.equal(mainAccount(accs, s).id, 'chrome:2', 'Personal\'s account is not signed in; the signed-in one is main');
  assert.equal(mainAccount(accs.map(a => a.id === 'chrome:Default' ? { ...a, signedIn: true } : a), s).id, 'chrome:Default', 'Personal\'s first when both are');
  assert.equal(importDone({ step: 3 }, accs, s), true);
  assert.equal(importDone({ step: 1 }, accs, s), false, 'not before the import ran');
  assert.equal(importDone({ step: 3, doneAt: 5 }, accs, s), false, 'already done');
  assert.equal(importDone({ step: 3 }, accs.filter(a => a.id !== 'chrome:2'), s), false, 'nobody signed in yet');
  assert.deepEqual(toAdd(accs).map(a => a.id), ['chrome:Default', 'chrome:4'], 'signed in, signed out by Google, and the no-address store are not "to add"');
});

test('hub tiles: most in need first (signed out, needs sign-in, not checked, signing in, signed in), one button by state', () => {
  const at = Date.now();
  const list = [
    { id: 'ok', name: 'ok', email: 'ok@example.invalid', signedIn: true },
    { id: 'none', name: 'none', email: 'none@example.invalid' },
    { id: 'busy', name: 'busy', pendingGoogle: true },
    { id: 'lost', name: 'lost', email: 'lost@example.invalid', signedIn: false, lostAt: at },
    { id: 'warn', name: 'warn', email: 'warn@example.invalid', signedIn: false },
    { id: 'ok2', name: 'ok2', email: 'ok2@example.invalid', signedIn: true },
  ];
  assert.deepEqual(byNeed(list).map(a => a.id), ['lost', 'warn', 'none', 'busy', 'ok', 'ok2'], 'stable within a state');
  assert.deepEqual(list.map(tileAction), ['Open', 'Sign in', null, 'Sign in again', 'Sign in', 'Open']);
  // A store with no Google address has no button, even when it holds a session.
  assert.equal(tileAction({ id: 'personal', name: 'Default', source: 'default', signedIn: true }), null);
});

test('hub columns: each group, in order, goes to the shortest column (a header counts as one tile); groups stay whole', () => {
  const g = (name, n) => [name, Array.from({ length: n }, (_, i) => i)];
  const cols = balance([g('Personal', 6), g('HALO', 5), g('Clients', 2), g('Unsorted', 3), g('Lab', 1)]);
  assert.deepEqual(cols.map(c => c.map(([n]) => n)), [['Personal'], ['HALO', 'Lab'], ['Clients', 'Unsorted']]);
  assert.deepEqual(balance([g('Only', 4)]).map(c => c.length), [1, 0, 0], 'one group: the other columns stay empty, not stretched');
});

test('space bar: up to four chips; more spaces show three and "+N", and the space he is in always has a chip', () => {
  const s = (...ids) => ids.map(id => ({ id }));
  assert.deepEqual(spaceChips(s('a', 'b', 'c', 'd'), 'd'), { shown: s('a', 'b', 'c', 'd'), more: 0 });
  assert.deepEqual(spaceChips(s('a', 'b', 'c', 'd', 'e', 'f'), 'b'), { shown: s('a', 'b', 'c'), more: 3 });
  assert.deepEqual(spaceChips(s('a', 'b', 'c', 'd', 'e', 'f'), 'f'), { shown: s('a', 'b', 'f'), more: 3 });
  assert.deepEqual(spaceChips(s('a', 'b', 'c', 'd', 'e'), 'gone'), { shown: s('a', 'b', 'c'), more: 2 });
});

test('status lines: worst first, two then "+N more"', async () => {
  const { statusOrder, foldLines } = await import('../../web/src/lib/browser-setup.ts');
  assert.deepEqual(statusOrder({ notice: true, setup: true, lost: true, stray: true }), ['lost', 'stray', 'setup', 'notice']);
  assert.deepEqual(statusOrder({}), []);
  assert.deepEqual(foldLines(['a', 'b', 'c', 'd'], false), { shown: ['a', 'b'], more: 2 });
  assert.deepEqual(foldLines(['a', 'b', 'c'], false), { shown: ['a', 'b'], more: 1 }, 'the spec: max 2, then "+1 more"');
  assert.deepEqual(foldLines(['a', 'b'], false), { shown: ['a', 'b'], more: 0 });
  assert.deepEqual(foldLines(['a', 'b', 'c', 'd'], true), { shown: ['a', 'b', 'c', 'd'], more: 0 });
});
