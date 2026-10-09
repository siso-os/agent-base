// t-0460 (arc:toast-stack): the owner note and the shipped card, which used to sit in two corners, land in one stack at the
// bottom right, one above the other, clear of each other, at 1440 and 390. Synthetic full app, sealed API, never the live node.
//   heavy -- node services/node/test/toast-stack-ui.mjs
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { webkit } from './suite-runtime.mjs';
import { fixtureResponse } from '../../../tools/ab-qa-fixtures.mjs';

const root = path.resolve(import.meta.dirname, '../../..');
const { createServer } = createRequire(path.join(root, 'apps/web/package.json'))('vite');
const shots = path.join(root, 'ui-hub/t0460-toast-stack');
mkdirSync(shots, { recursive: true });
const owner = { name: 'LANDING', workspace: 'siso-agency', title: 'SISO site', subtitle: 'Hero shipped, page ready to look at', status: 'ready', started: null, updated: new Date().toISOString(), page: 'https://example.com/landing', summary: '', findings: [], subagents: [], next: '', asks: [], pick: null, parent: '', model: '', machine: '', fleet: '', job: '', branch: '', report: '', locks: [] };
const shipped = { sha: 'fixture', changes: [{ subject: 'One stack for every pop-up', sha: 'fixture' }] };

let server, browser;
const results = [], BEFORE = !!process.env.BEFORE; // BEFORE=1: shots of the old layout only, run against the old files
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
    await page.addInitScript(([o, s]) => {
      window.EventSource = undefined;
      sessionStorage.setItem('ab.owners-seen', JSON.stringify({ owners: [o], warnings: [] }));
      sessionStorage.setItem('agent-base:update-reload', JSON.stringify({ shipped: s }));
    }, [owner, shipped]);
    await page.routeWebSocket('**/*', socket => socket.close());
    await page.route('**/*', route => new URL(route.request().url()).origin === base ? route.fallback() : route.abort());
    await page.route(`${base}/api/**`, async route => {
      const p = new URL(route.request().url()).pathname;
      // The shipped card shows once the running version's assets are the ones loaded: report the page's own.
      if (p === '/api/version') {
        const assets = await page.evaluate(() => [...document.querySelectorAll('script[src], link[rel=stylesheet][href]')].map(e => new URL(e.src || e.href).pathname)).catch(() => []);
        return route.fulfill({ json: { web: '1', node: '1', desktop: '1', sha: 'fixture', assets: assets.length ? assets : ['/src/main.tsx'] } });
      }
      const body = fixtureResponse(p, 'fixture');
      return body === undefined ? route.fulfill({ status: 404, json: {} }) : route.fulfill({ json: body });
    });
    await page.goto(base);
    if (BEFORE) {
      // Before: the note is in the page but drawn 0 x 0 (the orb's hidden menu hid it), so wait for it to exist, not show.
      await page.getByTestId('owner-toasts').waitFor({ state: 'attached', timeout: 10000 });
      console.log('before: owner note box', JSON.stringify(await page.getByTestId('owner-toasts').boundingBox()));
      await page.getByTestId('shipped-card').waitFor({ timeout: 15000 });
      await page.waitForTimeout(300); await page.screenshot({ path: path.join(shots, `before-${width}-full.png`) }); await page.close(); continue;
    }
    const stack = page.getByTestId('toast-stack');
    await page.locator('#ab-toast-stack [data-toast="owner"]').waitFor({ timeout: 10000 });
    await page.getByTestId('owner-toasts').hover({ force: true }); // hovering holds the owner's 4 s glimpse
    await page.locator('#ab-toast-stack [data-toast="shipped"]').waitFor({ timeout: 15000 });
    await page.getByTestId('owner-toasts').hover({ force: true });
    await page.waitForTimeout(300);
    assert.deepEqual(await stack.locator(':scope > li').evaluateAll(xs => xs.map(x => x.dataset.toast).sort()), ['owner', 'shipped'], 'both pop-ups in the one stack');
    assert.equal(await page.locator('[data-testid="owner-toasts"]').count(), 1, 'the owner note is not drawn anywhere else');
    const boxes = await stack.locator(':scope > li').evaluateAll(xs => xs.map(x => { const r = x.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, left: r.left, right: r.right }; }));
    const [a, b] = boxes.sort((x, y) => x.top - y.top);
    assert.ok(a.bottom <= b.top + 0.5, `stacked, not overlapping: ${JSON.stringify(boxes)}`);
    for (const r of boxes) assert.ok(r.bottom - r.top > 20 && r.right <= width && r.left >= 0 && r.bottom <= height, `drawn and on screen: ${JSON.stringify(r)}`);
    // Drawn, not just present: the voice orb's hidden menu used to hide every owner note (0 x 0 before t-0460).
    assert.ok(Math.abs(boxes[0].right - boxes[1].right) < 1 || width < 700, 'one right edge');
    await page.screenshot({ path: path.join(shots, `after-${width}-full.png`) });
    assert.deepEqual(errors, []);
    results.push({ width, toasts: boxes.length });
    await page.close();
  }
  console.log(BEFORE ? 'before shots taken' : 'PASS toast stack', JSON.stringify(results));
} finally { await browser?.close(); await server?.close(); }
