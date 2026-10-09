import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadBrowserTabs, rememberBrowserTab, saveBrowserTabs } from '../../web/src/lib/browser-tabs.ts';

test('Today tabs retain ordering and profile isolation across reload', () => {
  const values = new Map();
  const store = { getItem: k => values.get(k), setItem: (k, v) => values.set(k, v) };
  let tabs = rememberBrowserTab({}, 'personal', { url: 'https://personal.invalid/', title: 'Personal' });
  tabs = rememberBrowserTab(tabs, 'HALO', { url: 'https://halo.invalid/', title: 'HALO' });
  tabs = rememberBrowserTab(tabs, 'personal', { url: 'https://personal.invalid/', title: 'Renamed' });
  saveBrowserTabs(tabs, store);
  assert.deepEqual(loadBrowserTabs(store).personal.map(p => p.title), ['Renamed']);
  assert.deepEqual(loadBrowserTabs(store).HALO.map(p => p.title), ['HALO']);
  for (let i = 0; i < 60; i++) tabs = rememberBrowserTab(tabs, 'personal', { url: `https://tab${i}.invalid/`, title: `${i}` });
  assert.equal(tabs.personal.length, 50);
});

test('malformed storage and transient authentication URLs are not saved', () => {
  for (const value of ['{', 'null', '[]', '1', '{"personal":false}']) assert.deepEqual(loadBrowserTabs({ getItem: () => value }), {});
  for (const url of ['file:///fake', 'javascript:void(0)', 'https://fake:fake@example.invalid/', 'https://accounts.google.com/', 'https://example.invalid/oauth/authorize', 'https://example.invalid/?access_token=FAKE', 'https://example.invalid/?%74oken=FAKE', 'https://example.invalid/#code=FAKE']) {
    assert.deepEqual(rememberBrowserTab({}, 'personal', { url, title: 'Fake login' }), {});
  }
  const loaded = loadBrowserTabs({ getItem: () => JSON.stringify({ personal: [null, { url: 'javascript:void(0)', title: 'Bad' }, { url: 'https://safe.invalid/', title: 'Good', password: 'FAKE' }] }) });
  assert.equal(loaded.personal.length, 1);
  assert.equal('password' in loaded.personal[0], false);
});

test("agents' console cards (:8891) never go in Today, already-saved ones drop on load; other local pages still can", () => {
  const tabs = rememberBrowserTab({}, 'personal', { url: 'http://127.0.0.1:8891/p/fake-card', title: 'Fleet done', at: 1 });
  assert.deepEqual(tabs, {});
  const loaded = loadBrowserTabs({ getItem: () => JSON.stringify({ personal: [{ url: 'http://localhost:8891/x', title: 'Card' }, { url: 'http://127.0.0.1:5173/', title: 'Dev' }, { url: 'https://mail.google.com/mail/u/0/', title: 'Gmail' }] }) });
  assert.deepEqual(loaded.personal.map(p => p.title), ['Dev', 'Gmail']);
});

test('Today expires at twelve hours while malformed timestamps are discarded', () => {
  const now = 100000000;
  const store = { getItem: () => JSON.stringify({ personal: [
    { url: 'https://old.invalid/', title: 'Old', at: now - 12 * 3600000 },
    { url: 'https://new.invalid/', title: 'New', at: now - 1000 },
    { url: 'https://legacy.invalid/', title: 'Legacy' },
    { url: 'https://bad.invalid/', title: 'Bad', at: 'oops' },
  ] }) };
  assert.deepEqual(loadBrowserTabs(store, now).personal.map(p => p.title), ['New', 'Legacy']);
});

test('a row with no title shows the host and its first meaningful path part, never /u/0/', async () => {
  const { rowTitle } = await import('../../web/src/lib/browser-tabs.ts');
  assert.equal(rowTitle({ url: 'https://mail.google.com/mail/u/0/', title: '' }), 'mail.google.com');
  assert.equal(rowTitle({ url: 'https://www.github.com/sisodias/x', title: '  ' }), 'github.com · sisodias');
  assert.equal(rowTitle({ url: 'https://example.invalid/', title: 'Kept title' }), 'Kept title');
  assert.equal(rowTitle({ url: 'not a url' }), 'not a url');
});

test('same page under one agent: a trailing slash or host case is the same address, another agent or query is not', async () => {
  const { sameUrl, duplicateTabs } = await import('../../web/src/lib/browser-tabs.ts');
  assert.ok(sameUrl('http://127.0.0.1:5410', 'http://127.0.0.1:5410/'));
  assert.ok(sameUrl('https://Example.invalid/a/', 'https://example.invalid/a'));
  assert.ok(sameUrl('https://example.invalid/a#', 'https://example.invalid/a'));
  assert.ok(!sameUrl('https://example.invalid/a?x=1', 'https://example.invalid/a?x=2'));
  assert.ok(!sameUrl('https://mail.google.com/#inbox', 'https://mail.google.com/#sent'));
  assert.ok(!sameUrl('', ''));
  const urls = { a: 'https://card.invalid/1', b: 'https://card.invalid/1/', c: 'https://card.invalid/2', d: 'https://card.invalid/1', e: '', f: '', t: 'https://card.invalid/1' };
  const tabs = [
    { id: 'a', kind: 'web', owner: 'Agent Zero' }, { id: 'b', kind: 'web', owner: 'Agent Zero' }, { id: 'c', kind: 'web', owner: 'Agent Zero' },
    { id: 'd', kind: 'web', owner: 'BROWSER' }, { id: 'e', kind: 'web', owner: 'Agent Zero' }, { id: 'f', kind: 'web', owner: 'Agent Zero' },
    { id: 't', kind: 'term', owner: 'Agent Zero' },
  ];
  assert.deepEqual(duplicateTabs(tabs, (id) => urls[id]), ['b']);
  assert.deepEqual(duplicateTabs(tabs, (id) => urls[id], 'b'), ['a']);
  assert.deepEqual(duplicateTabs([], (id) => urls[id]), []);
});
