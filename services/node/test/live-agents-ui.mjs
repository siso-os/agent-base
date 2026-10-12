// 12 Oct, Shaan: "I'm not a fan how other agents don't show also when they're running at least you know or like they're
// waiting on a response from me and I haven't seen it". Beside Agent Zero up top: the agents that need him, then the ones that
// answered and he has not looked at, then the ones working; a quiet or idle agent never shows; past four, "+N" lists the rest.
// Synthetic full app, sealed API, invented agents, never the live node.   heavy -- node services/node/test/live-agents-ui.mjs
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import { webkit } from './suite-runtime.mjs';
import { fixtureResponse } from '../../../tools/ab-qa-fixtures.mjs';

const root = path.resolve(import.meta.dirname, '../../..');
const { createServer } = createRequire(path.join(root, 'apps/web/package.json'))('vite');
const shots = path.join(root, 'ui-hub/live-agents');

const base0 = fixtureResponse('/api/agents', 'fixture');
const zero = base0.agents.find(a => a.zero), like = base0.agents.find(a => !a.zero);
const now = Date.now();
const agent = (id, name, status, extra = {}) => ({ ...like, id, key: id, name, status, row: 'live', since: now - 60_000, lastEvent: now - 5_000, seenAt: now, ...extra });
const agents = [
  { ...zero, since: now, lastEvent: now },
  agent('w1', 'BUILDER', 'working'),
  agent('i1', 'SLEEPY', 'idle'),
  agent('d1', 'UI-HUB', 'done', { seenAt: now - 120_000 }),
  agent('n1', 'ASKER', 'needs'),
  agent('d2', 'SEEN-DONE', 'done', { seenAt: now + 1 }),
  agent('w2', 'QUIET', 'working', { lastEvent: now - 60 * 60_000 }),
  agent('w3', 'TESTER', 'working'),
  agent('w4', 'SHIPPER', 'working'),
  agent('w5', 'EXTRA', 'working'),
];

let server, browser;
try {
  server = await createServer({ root: path.join(root, 'apps/web'), configFile: path.join(root, 'apps/web/vite.config.ts'), logLevel: 'error',
    plugins: [{ name: 'sealed-api', configureServer(v) { v.middlewares.use((req, res, next) => { if (/^\/(api|chat|term)\b/.test(req.url ?? '')) { res.statusCode = 410; res.end('Fixture only'); return; } next(); }); } }],
    server: { host: '127.0.0.1', port: 0, strictPort: false, hmr: false, watch: { ignored: ['**/*'] } } });
  await server.listen();
  const base = `http://127.0.0.1:${server.httpServer.address().port}`;
  browser = await webkit.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(() => { localStorage.setItem('agent-base:space', '"agents"'); window.EventSource = undefined; });
  await page.routeWebSocket('**/*', socket => socket.close());
  await page.route('**/*', route => new URL(route.request().url()).origin === base ? route.fallback() : route.abort());
  await page.route(`${base}/api/**`, route => {
    const req = route.request(), p = new URL(req.url()).pathname;
    if (req.method() !== 'GET') return route.fulfill({ json: { ok: true } });
    if (p === '/api/agents') return route.fulfill({ json: { ...base0, agents } });
    const body = fixtureResponse(p, 'fixture');
    return body === undefined ? route.fulfill({ status: 404, json: {} }) : route.fulfill({ json: body });
  });
  await page.goto(base);
  const row = page.getByTestId('live-agents');
  await row.waitFor();
  const chips = await row.getByTestId('live-agent').evaluateAll(els => els.map(e => [e.dataset.agent, e.dataset.state]));
  // 12 Oct (Shaan: "two agents of the same ones showing up ... it's more important when they're coming back"): a chip each for
  // the one that needs him and the one that came back unseen; the four working fold into one "4 working"; idle, seen, quiet
  // and Agent Zero never show.
  assert.deepEqual(chips, [['ASKER', 'needs'], ['UI-HUB', 'unseen']]);
  const more = row.getByRole('button', { name: '4 working' });
  await more.waitFor();
  assert.equal((await more.textContent())?.trim(), '4 working');
  await page.screenshot({ path: path.join(shots, 'live-agents-top.png'), clip: { x: 0, y: 0, width: 1440, height: 60 } });
  await more.click();
  const menu = page.getByRole('menu');
  await menu.getByText('working', { exact: false }).first().waitFor();
  assert.equal(await menu.getByRole('menuitem').count(), 4);
  for (const n of ['SLEEPY', 'SEEN-DONE', 'QUIET']) assert.equal(await menu.getByText(n, { exact: false }).count(), 0, `${n} stays out`);
  await page.screenshot({ path: path.join(shots, 'live-agents-working.png'), clip: { x: 900, y: 0, width: 540, height: 260 } });
  await page.keyboard.press('Escape');
  // No back or forward buttons in the bar (12 Oct: "the back buttons don't know why they're needed").
  assert.equal(await page.getByRole('button', { name: /^(Back|Forward)$/ }).count(), 0, 'no back or forward');
  // One click opens that agent, and its chip goes: he is looking at it.
  await row.getByRole('button', { name: /^ASKER: needs you/ }).click();
  await page.waitForFunction(() => !document.querySelector('[data-testid="live-agent"][data-agent="ASKER"]'));
  // + is a blank web tab with the address bar focused, not the search palette.
  await page.getByRole('button', { name: 'New tab · ⌘T' }).click();
  await page.waitForFunction(() => document.activeElement?.tagName === 'INPUT' && !document.activeElement.classList.contains('wp-search'), null, { timeout: 8000 });
  assert.equal(await page.evaluate(() => localStorage.getItem('agent-base:space')), '"web"', 'the Web space is up');
  assert.equal(await page.locator('.wp-search').filter({ visible: true }).count(), 0, 'the palette stays shut');
  await page.screenshot({ path: path.join(shots, 'new-tab.png'), clip: { x: 0, y: 0, width: 1440, height: 400 } });
  assert.deepEqual(errors, []);
  console.log('PASS live agents', JSON.stringify({ chips, working: 4, newTab: 'blank web tab, address focused' }));
} finally { await browser?.close(); await server?.close(); }
