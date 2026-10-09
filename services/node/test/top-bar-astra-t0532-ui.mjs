// t-0532 item 1: actual top-bar + dismissal. Sealed full app, no live node or agent sockets.
// heavy -- node services/node/test/top-bar-astra-t0532-ui.mjs
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { webkit } from './suite-runtime.mjs';
import { fixtureResponse } from '../../../tools/ab-qa-fixtures.mjs';

const root = path.resolve(import.meta.dirname, '../../..');
const { createServer } = createRequire(path.join(root, 'apps/web/package.json'))('vite');
const shots = path.join(root, '.astra/t0532');
mkdirSync(shots, { recursive: true });
let server, browser;
const results = [];
try {
  server = await createServer({ root: path.join(root, 'apps/web'), configFile: path.join(root, 'apps/web/vite.config.ts'), logLevel: 'error',
    plugins: [{ name: 'sealed-api', configureServer(v) { v.middlewares.use((req, res, next) => { if (/^\/(api|chat|term)\b/.test(req.url ?? '')) { res.statusCode = 410; res.end('Fixture only'); return; } next(); }); } }],
    server: { host: '127.0.0.1', port: 0, strictPort: false, hmr: false, watch: { ignored: ['**/*'] } } });
  await server.listen();
  const base = `http://127.0.0.1:${server.httpServer.address().port}`;
  browser = await webkit.launch({ headless: true });
  for (const width of [1440, 390]) {
    const height = width < 700 ? 844 : 900, errors = [];
    const page = await browser.newPage({ viewport: { width, height }, reducedMotion: 'reduce' });
    page.on('pageerror', e => errors.push(e.message));
    await page.addInitScript(() => { window.EventSource = undefined; });
    await page.routeWebSocket('**/*', socket => socket.close());
    await page.route('**/*', route => new URL(route.request().url()).origin === base ? route.fallback() : route.abort());
    await page.route(`${base}/api/**`, route => {
      const p = new URL(route.request().url()).pathname;
      const body = fixtureResponse(p, 'fixture');
      return body === undefined ? route.fulfill({ status: 404, json: {} }) : route.fulfill({ json: body });
    });
    await page.goto(base);
    const head = page.locator('[data-testid="chat-head"]:visible').first();
    if (width >= 700) await head.waitFor();
    await page.waitForTimeout(800);
    // The actual top-bar + opens Spotlight, not a separate new-tab modal.
    const plus = page.getByRole('button', { name: 'New tab · ⌘T', exact: true });
    await plus.click();
    const dialog = page.getByRole('dialog', { name: 'Spotlight' });
    await dialog.waitFor();
    await page.screenshot({ path: path.join(shots, `palette-${width}.png`) });
    const r = await dialog.boundingBox();
    const outside = r.y > 5 ? { x: width / 2, y: 2 } : { x: 2, y: height - 2 };
    await page.mouse.click(outside.x, outside.y);
    await dialog.waitFor({ state: 'hidden' });
    assert.equal(await page.locator('.wp-dialog [role="option"]').count(), 0, 'closed palette has no result rows');
    await plus.focus();
    await page.keyboard.press('Enter');
    await dialog.waitFor();
    await page.keyboard.press('Escape');
    await dialog.waitFor({ state: 'hidden' });
    assert.equal(await plus.evaluate(el => document.activeElement === el), true, 'dismissal restores the + button');
    await page.screenshot({ path: path.join(shots, `dismissed-${width}.png`) });
    assert.deepEqual(errors, []);
    results.push({ width });
    await page.close();
  }
  console.log('PASS t-0532 + dismissal at desktop and phone sizes', JSON.stringify(results));
} finally { await browser?.close(); await server?.close(); }
