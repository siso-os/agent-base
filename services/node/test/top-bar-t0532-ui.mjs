// t-0532 items 2, 3, 4, 7, 8, 9 and 10 (Shaan, 8 Oct ~10:15): the chat header drops "Idle · 7m" (calm says nothing, like Codex) and the
// version on the bar is just its number, not "Recorded v128", with no counts beside it ("9 behind"). Synthetic full app, sealed API, never the live node.
// BEFORE=1 takes shots only (run against the old files).   heavy -- node services/node/test/top-bar-t0532-ui.mjs
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { webkit } from './suite-runtime.mjs';
import { fixtureResponse } from '../../../tools/ab-qa-fixtures.mjs';

const root = path.resolve(import.meta.dirname, '../../..');
const { createServer } = createRequire(path.join(root, 'apps/web/package.json'))('vite');
const shots = path.join(root, 'ui-hub/t0532-top-bar');
mkdirSync(shots, { recursive: true });
const BEFORE = !!process.env.BEFORE;
// Item 3: an owner with two running helpers the node placed under it (STREAMING and its OPERATOR-UI worker, the t-0530 case).
const withFleet = () => {
  const body = structuredClone(fixtureResponse('/api/agents', 'fixture')), zero = body.agents[0];
  const row = (id, name, extra) => ({ ...zero, id, key: `fixture/${name}`, name, title: name, zero: false, a0: false, main: false, host: false, chat: true, status: 'idle', hud: null, row: 'live', ownershipResolved: true, ...extra });
  body.agents.push(row('own-1', 'STREAMING', { kind: 'owner', parentId: zero.id, navOwner: true, workspace: 'halo' }), row('w-1', 'OPERATOR-UI', { kind: 'worker', parentId: 'own-1', status: 'working' }), row('w-2', 'STREAM-QUALITY', { kind: 'worker', parentId: 'own-1' }), row('w-3', 'OLD-JOB', { kind: 'worker', parentId: 'own-1', finished: true, row: 'settled' }));
  return body;
};
let server, browser;
const results = [];
try {
  server = await createServer({ root: path.join(root, 'apps/web'), configFile: path.join(root, 'apps/web/vite.config.ts'), logLevel: 'error',
    plugins: [{ name: 'sealed-api', configureServer(v) { v.middlewares.use((req, res, next) => { if (/^\/(api|chat|term)\b/.test(req.url ?? '')) { res.statusCode = 410; res.end('Fixture only'); return; } next(); }); } }],
    server: { host: '127.0.0.1', port: 0, strictPort: false, hmr: false, watch: { ignored: ['**/*'] } } });
  await server.listen();
  const base = `http://127.0.0.1:${server.httpServer.address().port}`;
  browser = await webkit.launch({ headless: true });
  for (const width of [1440]) { // the phone opens on the nav, not a chat
    const height = width < 700 ? 844 : 900, errors = [];
    const page = await browser.newPage({ viewport: { width, height }, reducedMotion: 'reduce' });
    page.on('pageerror', e => errors.push(e.message));
    await page.addInitScript(() => { window.EventSource = undefined; });
    await page.routeWebSocket('**/*', socket => socket.close());
    await page.route('**/*', route => new URL(route.request().url()).origin === base ? route.fallback() : route.abort());
    await page.route(`${base}/api/**`, route => {
      const p = new URL(route.request().url()).pathname;
      const body = p === '/api/agents' ? withFleet() : fixtureResponse(p, 'fixture');
      return body === undefined ? route.fulfill({ status: 404, json: {} }) : route.fulfill({ json: body });
    });
    await page.goto(base);
    const head = page.locator('[data-testid="chat-head"]:visible').first();
    await head.waitFor();
    await page.waitForTimeout(800);
    await page.screenshot({ path: path.join(shots, `${BEFORE ? 'before' : 'after'}-${width}.png`), clip: { x: 0, y: 0, width, height: Math.min(height, 140) } });
    if (!BEFORE) {
      assert.equal(await head.getAttribute('data-state'), 'idle', 'the fixture chat is idle');
      assert.equal(await page.locator('[data-testid="chat-head"]:visible [data-testid="chat-head-state"]').count(), 0, 'no "Idle · …" in the header');
      if (width >= 700) {
        const pill = page.getByTestId('version-pill');
        assert.equal((await pill.locator('b').textContent())?.trim(), 'v1', 'just the version number (the fixture is release 1)');
        assert.match(await pill.getAttribute('title'), /recorded deployment/i, 'the hover still says what the number is');
        assert.equal(await head.getByRole('button', { name: /Space/ }).count(), 0, 'no Space button in the chat header (item 10)');
        await page.getByRole('button', { name: 'More views' }).click();
        assert.ok(await page.getByRole('menuitem', { name: /Space · ⌘⇧S/ }).isVisible(), 'Space is in the three dots');
        await page.keyboard.press('Escape');
        // Item 3: open STREAMING, its arrow lists the fleet, a click swaps to OPERATOR-UI, whose arrow shows the same fleet.
        // Open STREAMING's chat from its row in the Agents list (folded in this fixture; the click is the row's own handler).
        await page.getByRole('button', { name: 'Open Agents' }).click();
        await page.locator('[data-testid="rail-row"][data-item="own-1"]').first().evaluate(el => el.click());
        const live = page.locator('[data-testid="chat-head"]:visible').first();
        await live.locator('.ab-head__name', { hasText: 'STREAMING' }).waitFor({ timeout: 8000 });
        await live.getByRole('button', { name: /STREAMING's fleet: 3 agents/ }).click();
        const items = page.locator('[role="menu"]:not([hidden]) [role="menuitem"]');
        assert.deepEqual(await items.evaluateAll(xs => xs.map(x => x.querySelector('b')?.textContent)), ['STREAMING', 'OPERATOR-UI', 'STREAM-QUALITY'], 'owner first, its running helpers, not the finished job');
        await page.screenshot({ path: path.join(shots, `fleet-${width}.png`), clip: { x: 300, y: 0, width: 900, height: 360 } });
        const before = await page.evaluate(() => history.length);
        await items.nth(1).click();
        await live.locator('.ab-head__name', { hasText: 'OPERATOR-UI' }).waitFor({ timeout: 8000 });
        assert.equal(await page.locator('[data-testid="chat-head"]:visible').first().getByRole('button', { name: /STREAMING's fleet: 3 agents/ }).count(), 1, "a helper's arrow shows its owner's fleet");
        // Item 4: each agent has its own URL. The address follows the open chat, and a link opens that agent.
        await page.waitForFunction(() => new URLSearchParams(location.search).get('agent') === 'OPERATOR-UI', null, { timeout: 5000 });
        assert.equal(await page.evaluate(() => history.length), before, 'the address is replaced, not pushed: picking an agent is no history entry (QA #11)');
        const url = new URL(page.url()); url.searchParams.set('agent', 'STREAMING');
        await page.goto(url.toString());
        await page.locator('[data-testid="chat-head"]:visible .ab-head__name', { hasText: /^STREAMING$/ }).waitFor({ timeout: 8000 });
        assert.doesNotMatch(await page.getByTestId('today-spend').innerText(), /Today/, 'spend is just the price (item 7)');
        assert.doesNotMatch(await pill.innerText(), /\d+\s*behind|^\s*\d+\s*$/m, 'no counts on the bar (item 9)');
      }
    }
    assert.deepEqual(errors, []);
    results.push({ width });
    await page.close();
  }
  console.log(BEFORE ? 'before shots taken' : 'PASS top bar t-0532', JSON.stringify(results));
} finally { await browser?.close(); await server?.close(); }
