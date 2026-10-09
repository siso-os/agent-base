// Fake native bridge only: no Tauri, no real pages. Proves web tabs stay alive across switches (TASK.md step 2b).
import { test } from 'node:test';
import assert from 'node:assert/strict';

const calls = [];
const diagnostics = [];
globalThis.fetch = async (_url, options) => { diagnostics.push(JSON.parse(options.body)); return { ok: true }; };
const playing = new Set();
globalThis.innerWidth = 1440;
globalThis.innerHeight = 900;
globalThis.window = {
  __TAURI_INTERNALS__: { invoke: async (command, args = {}) => { calls.push({ command, ...args }); return command === 'browser_audio' ? playing.has(args.tab) : command === 'browser_url' ? '' : undefined; } },
  setTimeout, clearTimeout, setInterval, clearInterval, addEventListener() {}, removeEventListener() {},
};
globalThis.document = { hidden: false, body: {}, querySelectorAll: () => [], addEventListener() {}, removeEventListener() {} };
globalThis.ResizeObserver = class { observe() {} disconnect() {} };
globalThis.MutationObserver = class { observe() {} disconnect() {} };
const { AWAKE, awakePages, closePage, mountPage, pageKey, pickSleepers } = await import('../../web/src/lib/webview.ts');

const slot = { getBoundingClientRect: () => ({ left: 300, top: 40, right: 1440, bottom: 900 }) };
const settle = () => new Promise(resolve => setTimeout(resolve, 20));
const open = async (tab, url = `https://${tab}.invalid/`, profile = 'personal', agent) => { const page = mountPage(slot, url, () => {}, e => assert.fail(e), profile, tab, agent); await settle(); return page; };
const reset = async () => { for (const p of awakePages()) await closePage(p.tab); await settle(); calls.length = 0; playing.clear(); };
const named = (command, tab) => calls.filter(c => c.command === command && (!tab || c.tab === tab));

test('leaving a web tab and coming back keeps the same native page: hidden, never closed or reloaded', async () => {
  await reset();
  const key = pageKey('tab:music', 'personal');
  let page = await open('tab:music');
  page.dispose(); await settle();
  assert.equal(named('browser_close').length, 0);
  assert.deepEqual(named('browser_visible', key).at(-1), { command: 'browser_visible', tab: key, visible: false });
  page = await open('tab:music');
  assert.equal(named('browser_open', key).length, 1, 'opened once, not rebuilt on return');
  assert.equal(named('browser_navigate', key).length, 0, 'no reload on return');
  assert.deepEqual(named('browser_visible', key).at(-1), { command: 'browser_visible', tab: key, visible: true });
  page.dispose(); await settle();
});

test('each space of a tab is its own page, and an explicit tab close destroys them all', async () => {
  await reset();
  (await open('tab:two', 'https://a.invalid/', 'personal')).dispose();
  (await open('tab:two', 'https://b.invalid/', 'HALO')).dispose();
  await settle();
  assert.equal(named('browser_open').length, 2);
  assert.equal(named('browser_close').length, 0);
  await closePage('tab:two'); await settle();
  assert.deepEqual(named('browser_close').map(c => c.tab).sort(), [pageKey('tab:two', 'HALO'), pageKey('tab:two', 'personal')].sort());
  assert.equal(awakePages().length, 0);
});

test(`the ${AWAKE + 1}th awake tab puts the least recently used one to sleep`, async () => {
  await reset();
  for (let i = 1; i <= AWAKE + 1; i++) (await open(`tab:lru${i}`)).dispose();
  await settle();
  assert.deepEqual(named('browser_close').map(c => c.tab), [pageKey('tab:lru1', 'personal')]);
  assert.equal(awakePages().length, AWAKE);
  // A slept tab rebuilds from its URL when opened again.
  (await open('tab:lru1')).dispose(); await settle();
  assert.equal(named('browser_open', pageKey('tab:lru1', 'personal')).length, 2);
});

test('a tab playing sound is never put to sleep; the next least recently used one sleeps instead', async () => {
  await reset();
  playing.add(pageKey('tab:play1', 'personal'));
  for (let i = 1; i <= AWAKE + 1; i++) (await open(`tab:play${i}`)).dispose();
  await settle();
  assert.deepEqual(named('browser_close').map(c => c.tab), [pageKey('tab:play2', 'personal')]);
  assert.ok(awakePages().some(p => p.key === pageKey('tab:play1', 'personal')));
});

test('a tab an agent drives is never slept and is opened marked as the agent\'s (no throttling natively)', async () => {
  await reset();
  (await open('tab:agent1', undefined, 'personal', 'WIDGET-MAP')).dispose();
  for (let i = 2; i <= AWAKE + 1; i++) (await open(`tab:agent${i}`)).dispose();
  await settle();
  assert.equal(named('browser_open', pageKey('tab:agent1', 'personal'))[0].agent, 'WIDGET-MAP');
  assert.equal(named('browser_open', pageKey('tab:agent2', 'personal'))[0].agent, null);
  assert.deepEqual(named('browser_close').map(c => c.tab), [pageKey('tab:agent2', 'personal')]);
  assert.equal(named('browser_audio', pageKey('tab:agent1', 'personal')).length, 0, 'no need to ask an agent tab about sound');
});

test('the store is the account: two spaces on one account open the same page and store', async () => {
  await reset();
  (await open('tab:shared', 'https://a.invalid/', 'chrome:Default')).dispose(); // from space "Personal"
  (await open('tab:shared', 'https://a.invalid/', 'chrome:Default')).dispose(); // from space "SISO", same account
  await settle();
  assert.equal(named('browser_open').length, 1);
  assert.equal(named('browser_open')[0].profile, 'chrome:Default');
});

test('the page on screen is never slept, and pickSleepers takes only the excess', () => {
  const pages = [1, 2, 3, 4, 5, 6].map(n => ({ key: `k${n}`, used: n, mounted: n === 1 }));
  assert.deepEqual(pickSleepers(pages, new Set(['k2'])), ['k3', 'k4']);
  assert.deepEqual(pickSleepers(pages.map(p => p.key === 'k3' ? { ...p, agent: 'ESTATE' } : p), new Set()), ['k2', 'k4']);
  assert.deepEqual(pickSleepers(pages.slice(0, 4), new Set()), []);
});


test('Web tab opens with viewport-clipped positive native bounds and reports command results without URLs', async () => {
  await reset(); diagnostics.length = 0;
  const page = await open('tab:bounds', 'https://example.invalid/?token=PRIVATE');
  const key = pageKey('tab:bounds', 'personal');
  assert.deepEqual(named('browser_open', key)[0], { command: 'browser_open', tab: key,
    rawUrl: 'https://example.invalid/?token=PRIVATE', profile: 'personal', x: 300, y: 40, width: 1140, height: 860, agent: null });
  assert.deepEqual(diagnostics.map(d => [d.command, d.status]), [['browser_open', 'started'], ['browser_open', 'ok']]);
  assert.ok(!JSON.stringify(diagnostics).includes('PRIVATE'));
  page.dispose(); await settle();
  assert.equal(diagnostics.at(-1).visible, false);
  assert.equal(diagnostics.at(-1).status, 'ok');
});

test('zero-sized slot waits for layout before creating a visible native page', async () => {
  await reset();
  let rect = { left: 300, top: 40, right: 300, bottom: 40 };
  const observed = [];
  globalThis.ResizeObserver = class { constructor(cb) { observed.push(cb); } observe() {} disconnect() {} };
  const page = mountPage({ getBoundingClientRect: () => rect }, 'https://layout.invalid/', () => {}, assert.fail, 'personal', 'tab:layout');
  await settle();
  assert.equal(named('browser_open').length, 0);
  rect = { left: 300, top: 40, right: 1600, bottom: 1000 };
  observed[0](); await settle();
  assert.equal(named('browser_open')[0].width, 1140);
  assert.equal(named('browser_open')[0].height, 860);
  page.dispose(); await settle();
});
