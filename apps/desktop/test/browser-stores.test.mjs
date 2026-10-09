// FAKE data only. A0 arc-edges §2.2/§3.4: a sign-in that landed in the no-account store moves to its account by repointing
// that account's store (no cookie copied), and a space still on the no-account store asks which account it uses.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { checkSessions, DEFAULT_ACCOUNT, favoritesOf, loadAccounts, loadArcProfiles, moveSignIn, needsAccount, restoreFavorites, saveAccounts, saveArcProfiles, storeOf } = await import('../../web/src/lib/webview.ts');
const memory = () => { const m = new Map(); return { getItem: k => m.get(k) ?? null, setItem: (k, v) => m.set(k, v) }; };

test('Move it: the account takes the store the sign-in is in; the no-account row gets a fresh empty store', () => {
  const store = memory();
  saveAccounts([{ id: 'personal', name: 'Default', signedIn: true }, { id: 'chrome:Default', name: 'P1', email: 'Fake.User@example.invalid', signedIn: false }], store);
  const r = moveSignIn(store, 'personal', 'fake.user@example.invalid');
  assert.equal(r.to, 'chrome:Default', 'matched by address, any case');
  const [def, acct] = [r.accounts.find(a => a.id === 'personal'), r.accounts.find(a => a.id === 'chrome:Default')];
  assert.equal(storeOf(acct), 'personal', 'its pages and checks now use the store holding the sign-in');
  assert.match(storeOf(def), /^store:[0-9a-f-]{36}$/);
  assert.equal(acct.signedIn, undefined, 'status is re-checked, not assumed');
  assert.deepEqual(loadAccounts(store), r.accounts, 'saved');
  // A second stray later moves from the fresh store, never back into the first account's.
  saveAccounts(loadAccounts(store).map(a => a.id === 'personal' ? { ...a } : a), store);
  const again = moveSignIn(store, 'personal', 'new@example.invalid');
  const made = again.accounts.find(a => a.id === again.to);
  assert.deepEqual([made.email, made.source, storeOf(made)], ['new@example.invalid', 'google', storeOf(def)], 'no row yet: one is made for that address');
  assert.equal(storeOf(again.accounts.find(a => a.id === 'chrome:Default')), 'personal');
});

test('Move it is refused from an account that has an address, or without one', () => {
  const store = memory();
  saveAccounts([{ id: 'chrome:1', name: 'a', email: 'a@example.invalid' }], store);
  assert.equal(moveSignIn(store, 'chrome:1', 'b@example.invalid'), null);
  assert.equal(moveSignIn(store, 'personal', ''), null);
  assert.equal(moveSignIn(store, 'missing', 'b@example.invalid'), null);
});

test('the sign-in check reads each account\'s own store', async () => {
  const store = memory();
  saveAccounts([{ id: 'personal', name: 'Default', store: 'store:fresh' }, { id: 'chrome:Default', name: 'P1', email: 'a@example.invalid', store: 'personal' }], store);
  const asked = [];
  globalThis.window = { __TAURI_INTERNALS__: { invoke: async (cmd, args) => { asked.push(args.account); return args.account === 'personal'; } } };
  try {
    const out = await checkSessions(store);
    assert.deepEqual(asked, ['store:fresh', 'personal']);
    assert.equal(out.find(a => a.id === 'chrome:Default').signedIn, true);
    assert.equal(out.find(a => a.id === 'personal').signedIn, false);
  } finally { delete globalThis.window; }
});

test('a space on the no-account store asks which account, unless he chose No account or has no Google account', () => {
  const accounts = [{ id: DEFAULT_ACCOUNT, name: 'Default' }, { id: 'chrome:1', name: 'a', email: 'a@example.invalid' }];
  assert.equal(needsAccount({ id: 'HALO', name: 'HALO', pins: [], account: DEFAULT_ACCOUNT }, accounts), true);
  assert.equal(needsAccount({ id: 'HALO', name: 'HALO', pins: [] }, accounts), true);
  assert.equal(needsAccount({ id: 'HALO', name: 'HALO', pins: [], account: 'gone' }, accounts), true, 'its account was removed');
  assert.equal(needsAccount({ id: 'HALO', name: 'HALO', pins: [], account: 'chrome:1' }, accounts), false);
  assert.equal(needsAccount({ id: 'HALO', name: 'HALO', pins: [], account: DEFAULT_ACCOUNT, noAccount: true }, accounts), false);
  assert.equal(needsAccount({ id: 'HALO', name: 'HALO', pins: [] }, [accounts[0]]), false);
});

test('legacy Arc favourites are staged once for deliberate selection; an Arc with none stops asking', () => {
  const store = memory();
  const pins = [{ url: 'https://a.example.invalid/', title: 'A', pinned: true }, { url: 'https://b.example.invalid/', title: 'B', pinned: true }];
  saveArcProfiles([{ id: 'personal', name: 'Personal', pins: [{ url: 'https://pin.example.invalid/', title: 'Pin', pinned: true }], account: DEFAULT_ACCOUNT }], store);
  assert.deepEqual(favoritesOf(loadArcProfiles(store)), [], 'none yet is empty, never the space pins');
  const data = { arc: { found: true, spaces: [{ id: 'arc-favorites', name: 'Arc Favorites', pins }, { id: 'arc:x', name: 'X', pins: [] }] }, chrome: { found: false, accounts: [] } };
  const out = restoreFavorites(data, store);
  assert.deepEqual(favoritesOf(out), [], 'legacy imported bookmarks are not auto-favourited');
  assert.deepEqual(out.find(s => s.id === 'arc-favorites').imported, pins);
  assert.deepEqual(loadArcProfiles(store).map(s => s.id), ['personal', 'arc-favorites'], 'only the favourites come back, no other Arc space');
  // Already there: untouched (he may have changed them since).
  assert.deepEqual(restoreFavorites({ ...data, arc: { found: true, spaces: [] } }, store).find(s => s.id === 'arc-favorites').imported, pins);
  const chosen = { ...pins[0], origin: 'user' };
  saveArcProfiles(out.map(s => s.id === 'arc-favorites' ? { ...s, pins: [chosen], imported: [pins[1]] } : s), store);
  assert.deepEqual(favoritesOf(restoreFavorites(data, store)), [chosen], 'a deliberate favourite survives later import checks');
  const empty = memory();
  restoreFavorites({ arc: { found: false, spaces: [] }, chrome: { found: false, accounts: [] } }, empty);
  assert.deepEqual(loadArcProfiles(empty).map(s => [s.id, s.pins.length]), [['arc-favorites', 0]], 'saved empty, so it never refetches');
});

test('one space per name: Arc\'s "HALO" merges into HALO (pins unioned, Arc id an alias, Today and sorted accounts follow); idempotent', async () => {
  const { mergeSameName, migrateAccounts, applyBrowserImport, spaceOf } = await import('../../web/src/lib/webview.ts');
  const { loadBrowserTabs, saveBrowserTabs } = await import('../../web/src/lib/browser-tabs.ts');
  const store = memory();
  const pin = (u) => ({ url: `https://${u}.example.invalid/`, title: u, pinned: true });
  saveArcProfiles([
    { id: 'arc:aaa', name: 'HALO ', pins: [pin('arc-halo'), pin('shared')], account: 'google:h' },
    { id: 'HALO', name: 'HALO', pins: [pin('shared'), pin('mine')], account: DEFAULT_ACCOUNT },
    { id: 'arc:bbb', name: 'Docs', pins: [pin('d1')], account: DEFAULT_ACCOUNT },
    { id: 'arc:ccc', name: 'docs', pins: [pin('d2')], account: DEFAULT_ACCOUNT },
    { id: 'arc-favorites', name: 'Arc Favorites', pins: [pin('fav')] },
  ], store);
  saveAccounts([{ id: 'google:h', name: 'h', email: 'h@example.invalid', space: 'arc:aaa' }], store);
  const now = Date.now();
  saveBrowserTabs({ 'arc:aaa': [{ url: 'https://t1.example.invalid/', title: 'T1', at: now }], HALO: [{ url: 'https://t1.example.invalid/', title: 'T1', at: now }, { url: 'https://t2.example.invalid/', title: 'T2', at: now }] }, store);
  const { spaces, accounts } = migrateAccounts(store);
  assert.deepEqual(spaces.map(s => s.id), ['HALO', 'arc:bbb', 'arc-favorites'], 'one HALO, one Docs; favourites untouched');
  const halo = spaces[0];
  assert.deepEqual(halo.pins, [], 'legacy unauthored pins remain staged');
  assert.deepEqual(halo.imported.map(p => p.title), ['shared', 'mine', 'arc-halo']);
  assert.deepEqual(halo.aliases, ['arc:aaa']);
  assert.equal(halo.account, 'google:h', 'HALO had no account; Arc HALO\'s comes with it');
  assert.equal(accounts.find(a => a.id === 'google:h').space, 'HALO');
  assert.deepEqual(Object.keys(loadBrowserTabs(store)), ['HALO']);
  assert.deepEqual(loadBrowserTabs(store).HALO.map(r => r.title), ['T1', 'T2'], 'Today rows unioned, no duplicate');
  assert.equal(spaceOf(spaces, 'arc:aaa'), 'HALO'); assert.equal(spaceOf(spaces, 'arc:ccc'), 'arc:bbb'); assert.equal(spaceOf(spaces, 'nope'), 'nope');
  // A re-import of the same Arc space lands in HALO, not a second chip; running the merge again changes nothing.
  const again = applyBrowserImport({ arc: { found: true, spaces: [{ id: 'arc:aaa', name: 'HALO', pins: [pin('new')] }] }, chrome: { found: false, accounts: [] } }, store);
  assert.deepEqual(again.profiles.map(s => s.id), ['HALO', 'arc:bbb', 'arc-favorites']);
  assert.ok(again.profiles[0].imported.some(p => p.title === 'new'));
  assert.deepEqual(again.profiles[0].pins, []);
  assert.equal(again.added, 0);
  const before = JSON.stringify(loadArcProfiles(store));
  mergeSameName(store, loadArcProfiles(store), loadAccounts(store));
  assert.equal(JSON.stringify(loadArcProfiles(store)), before);
  // An Arc "HALO" with no built-in HALO saved yet becomes HALO itself.
  const fresh = memory();
  saveArcProfiles([{ id: 'arc:zzz', name: 'halo', pins: [pin('z')], account: DEFAULT_ACCOUNT }], fresh);
  assert.deepEqual(migrateAccounts(fresh).spaces.map(s => [s.id, s.aliases]), [['HALO', ['arc:zzz']]]);
});
