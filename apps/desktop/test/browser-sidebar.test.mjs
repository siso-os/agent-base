// FAKE data only. Sidebar polish (A0 browser-UX spec §1, §6): Today rows awake/asleep/playing, the downloads list, and the
// account groups behind the address bar's "Open as" list.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { sleepState } = await import('../../web/src/lib/webview.ts');
const { noteDownload, KEEP, fileSize } = await import('../../web/src/lib/browser-downloads.ts');
const { accountGroups } = await import('../../web/src/lib/browser-setup.ts');

test('Today rows: awake when a live page has the address (or it is on screen), asleep otherwise; playing names the page to mute', () => {
  const urls = ['https://a.example.invalid', 'https://b.example.invalid/x', 'https://c.example.invalid/', 'https://d.example.invalid/'];
  const pages = [{ key: 't1#personal', url: 'https://a.example.invalid/' }, { key: 't2#personal', url: 'https://b.example.invalid/x' }];
  const s = sleepState(urls, pages, ['t2#personal'], 'https://c.example.invalid/');
  assert.deepEqual([...s.awake], urls.slice(0, 3), 'a matches with or without the trailing slash; c is on screen');
  assert.equal(s.asleep, 1);
  assert.deepEqual([...s.playing], [['https://b.example.invalid/x', 't2#personal']]);
  // Nothing live and a blank tab: every row asleep, nothing playing; a page playing at an address with no row is not shown.
  const none = sleepState(urls, [{ key: 'x', url: 'https://elsewhere.invalid/' }], ['x'], '');
  assert.equal(none.awake.size, 0); assert.equal(none.asleep, 4); assert.equal(none.playing.size, 0);
  assert.deepEqual(sleepState([], pages, [], '').asleep, 0);
});

test('downloads: a start is a running row on top; a finish settles that row (or adds one); only the last 10 are kept', () => {
  let rows = noteDownload([], { phase: 'started', name: 'fake.pdf', ok: true, agent: null }, 1);
  rows = noteDownload(rows, { phase: 'started', name: 'fake.pdf', ok: true, agent: 'WIDGET' }, 2);
  assert.deepEqual(rows.map(r => [r.name, r.agent, r.state]), [['fake.pdf', 'WIDGET', 'running'], ['fake.pdf', null, 'running']]);
  rows = noteDownload(rows, { phase: 'finished', name: 'fake.pdf', ok: true, agent: null }, 3);
  assert.deepEqual(rows.map(r => [r.agent, r.state, r.at]), [[null, 'done', 3], ['WIDGET', 'running', 2]], 'the agent\'s file of the same name is a different row');
  rows = noteDownload(rows, { phase: 'finished', name: 'fake.pdf', ok: false, agent: 'WIDGET' }, 4);
  assert.deepEqual(rows.map(r => r.state), ['failed', 'done']);
  assert.equal(new Set(rows.map(r => r.id)).size, 2);
  const lone = noteDownload([], { phase: 'finished', name: 'heard-late.zip', ok: true, agent: null }, 5);
  assert.deepEqual(lone.map(r => [r.name, r.state]), [['heard-late.zip', 'done']], 'a finish with no start heard still shows');
  for (let i = 0; i < 15; i++) rows = noteDownload(rows, { phase: 'started', name: `f${i}`, ok: true, agent: null }, 10 + i);
  assert.equal(rows.length, KEEP); assert.equal(rows[0].name, 'f14');
});

test('"Open as" groups: the space he sorted an account into, else the space using it, else Unsorted', () => {
  const spaces = [{ id: 'personal', name: 'Personal', pins: [], account: 'personal' }, { id: 'HALO', name: 'HALO', pins: [], account: 'google:h' }];
  const accounts = [{ id: 'personal', name: 'Default' }, { id: 'google:h', name: 'h', email: 'h@example.invalid' }, { id: 'chrome:1', name: 'c', email: 'c@example.invalid', space: 'personal' }, { id: 'chrome:2', name: 'loose', email: 'l@example.invalid' }, { id: 'chrome:3', name: 'gone', space: 'deleted-space' }];
  const g = accountGroups(accounts, spaces);
  assert.deepEqual([...g].map(([k, v]) => [k, v.map(a => a.id)]), [['Personal', ['personal', 'chrome:1']], ['HALO', ['google:h']], ['Unsorted', ['chrome:2', 'chrome:3']]]);
});

test('the download toast says a size in short units', () => {
  assert.deepEqual([0, 820, 1000, 14_200, 999_499, 3_400_000, 12_000_000, 1_200_000_000].map(fileSize), ['0 B', '820 B', '1 KB', '14 KB', '999 KB', '3.4 MB', '12 MB', '1.2 GB']);
});

test('the mini player shows a page playing off screen, with its space, account and whether it is in this tab', async () => {
  const { nowPlaying } = await import('../../web/src/lib/browser-player.ts');
  const spaces = [{ id: 'personal', name: 'Personal', pins: [], account: 'acct-a' }, { id: 'HALO', name: 'HALO', pins: [{ url: 'https://music.fake.invalid/', title: 'Fake radio', pinned: true }], account: 'acct-b' }];
  const accounts = [{ id: 'acct-a', name: 'A', email: 'a@example.invalid' }, { id: 'acct-b', name: 'B', email: 'b@example.invalid', store: 'store-b' }];
  const today = { personal: [{ url: 'https://video.fake.invalid/watch', title: 'Fake video' }] };
  const pages = [
    { key: 'page#acct-a', tab: 'page', url: 'https://video.fake.invalid/watch', mounted: false },
    { key: 'page#store-b', tab: 'page', url: 'https://music.fake.invalid/', mounted: true },
    { key: 'other#store-b', tab: 'other', url: 'https://music.fake.invalid/', mounted: false },
  ];
  const base = { pages, spaces, today, accounts, tab: 'page', paused: [] };
  assert.deepEqual(nowPlaying({ ...base, playing: ['page#acct-a'] }), { key: 'page#acct-a', url: 'https://video.fake.invalid/watch', title: 'Fake video', host: 'video.fake.invalid', space: { id: 'personal', name: 'Personal' }, account: 'acct-a', here: true, paused: false });
  assert.equal(nowPlaying({ ...base, playing: ['page#store-b'] }), null, 'the page on screen has no mini player');
  const other = nowPlaying({ ...base, playing: ['other#store-b'] });
  assert.deepEqual([other.title, other.space.name, other.account, other.here], ['Fake radio', 'HALO', 'acct-b', false], 'a store maps back to its account');
  assert.equal(nowPlaying({ ...base, playing: [], paused: ['page#acct-a'] }).paused, true, 'paused from the player, it stays');
  assert.equal(nowPlaying({ ...base, playing: [] }), null);
});
