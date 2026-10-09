import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseArcSidebar, importArcSidebar, loadArcProfiles, createBrowserProfile } from '../../web/src/lib/webview.ts';
const fixture = readFileSync(new URL('./fixtures/StorableSidebar.json', import.meta.url), 'utf8');
test('fake Arc spaces become separate profiles, only pinned descendants survive, cycles terminate', () => {
  const profiles = parseArcSidebar(fixture);
  assert.equal(profiles.length, 2);
  assert.notEqual(profiles[0].id, profiles[1].id);
  assert.deepEqual(profiles.map(p => p.pins.map(t => [t.url,t.pinned])), [[['https://personal.invalid/',true]],[['https://company.invalid/',true]]]);
});
test('explicit import is idempotent and pin state survives store reload', () => {
  const values = new Map();
  const store = { getItem: k => values.get(k) ?? null, setItem: (k,v) => values.set(k,v) };
  const once = importArcSidebar(fixture,store);
  assert.deepEqual(importArcSidebar(fixture,store),once);
  assert.deepEqual(loadArcProfiles(store),once);
  assert.ok(loadArcProfiles(store).every(p => p.pins.every(t => t.pinned)));
});
test('malformed sidebar is rejected without leaking its payload', () => {
  assert.throws(() => parseArcSidebar('{'), SyntaxError);
  assert.throws(() => parseArcSidebar('{}'), /Not an Arc/);
});

test('named profiles survive reload and stay distinct from Arc and built-in accounts', () => {
  const values = new Map();
  const store = { getItem: k => values.get(k) ?? null, setItem: (k,v) => values.set(k,v) };
  const arc = importArcSidebar(fixture, store);
  const first = createBrowserProfile('  Gmail work  ', store);
  const second = createBrowserProfile('YouTube', store);
  assert.equal(first.name, 'Gmail work');
  assert.match(first.id, /^profile:/);
  assert.notEqual(first.id, second.id);
  assert.deepEqual(loadArcProfiles(store), [...arc, first, second]);
  for (const name of ['', '  ', 'x'.repeat(81), 'bad\nname', 'Personal', 'halo', 'gmail WORK']) {
    assert.throws(() => createBrowserProfile(name, store));
  }
  assert.deepEqual(loadArcProfiles(store), [...arc, first, second]);
});

// Entirely invented Favorites roots/tabs: never use a real Arc sidebar as a fixture.
test('global Arc Favorites include nested folders, deduplicate, reject unsafe URLs and reimport as one group', () => {
  const sidebar = JSON.parse(fixture);
  const source = sidebar.sidebar.containers[1];
  source.topAppsContainerIDs = [{ default: true }, 'favorites-root', { custom: {} }, 'other-favorites'];
  source.items.push(
    'favorites-root', { id: 'favorites-root', childrenIds: ['favorite-folder', 'favorite-http', 'favorite-file', 'favorite-credentials', 'favorite-malformed'] },
    'favorite-folder', { id: 'favorite-folder', parentID: 'favorites-root', childrenIds: ['favorite-https', 'favorite-folder'] },
    'favorite-https', { id: 'favorite-https', parentID: 'favorite-folder', data: { tab: { savedURL: 'https://favorite.invalid/', savedTitle: 'Fake Favorite' } } },
    'favorite-http', { id: 'favorite-http', parentID: 'favorites-root', data: { tab: { savedURL: 'http://favorite-http.invalid/' } } },
    'favorite-file', { id: 'favorite-file', parentID: 'favorites-root', data: { tab: { savedURL: 'file:///fake/private' } } },
    'favorite-credentials', { id: 'favorite-credentials', parentID: 'favorites-root', data: { tab: { savedURL: 'https://fake:fake@favorite.invalid/' } } },
    'favorite-malformed', { id: 'favorite-malformed', parentID: 'favorites-root', data: { tab: { savedURL: 'not a URL' } } },
    'other-favorites', { id: 'other-favorites', childrenIds: ['favorite-duplicate', 'favorite-script'] },
    'favorite-duplicate', { id: 'favorite-duplicate', parentID: 'other-favorites', data: { tab: { savedURL: 'https://favorite.invalid/' } } },
    'favorite-script', { id: 'favorite-script', parentID: 'other-favorites', data: { tab: { savedURL: 'javascript:alert(1)' } } },
  );
  const raw = JSON.stringify(sidebar);
  const profiles = parseArcSidebar(raw);
  const favorites = profiles.find(p => p.name === 'Arc Favorites');
  assert.deepEqual(favorites.pins.map(p => [p.url, p.pinned]), [['https://favorite.invalid/', true], ['http://favorite-http.invalid/', true]]);
  assert.deepEqual(profiles.filter(p => p.id !== favorites.id), parseArcSidebar(fixture));
  const values = new Map();
  const store = { getItem: k => values.get(k) ?? null, setItem: (k,v) => values.set(k,v) };
  const once = importArcSidebar(raw, store);
  assert.deepEqual(importArcSidebar(raw, store), once);
  assert.equal(loadArcProfiles(store).filter(p => p.name === 'Arc Favorites').length, 1);
  const staged = loadArcProfiles(store).find(p => p.id === favorites.id);
  assert.deepEqual(staged.pins, []);
  assert.deepEqual(staged.imported, favorites.pins);
  assert.deepEqual(staged.importedFolders, favorites.importedFolders);
  // Favorites still import when this container has no spaces, and through Arc's sync-only representation.
  assert.deepEqual(parseArcSidebar(JSON.stringify({ sidebar: { containers: [{ ...source, spaces: [] }] } })), [favorites]);
  assert.deepEqual(parseArcSidebar(JSON.stringify({ sidebarSyncState: { container: { value: { topAppsContainerIDs: source.topAppsContainerIDs } }, spaceModels: source.spaces, items: source.items } })), profiles);
});
