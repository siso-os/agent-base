// 9 Oct (Agent Zero, after Shaan saw "20 not landed" with 2 real): the count is work someone means to land, and the rest
// folds as Parked with its reason. Synthetic full app, sealed API, never the live node. Run with heavy.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import { webkit } from './suite-runtime.mjs';
import { fixtureResponse } from '../../../tools/ab-qa-fixtures.mjs';

const root = path.resolve(import.meta.dirname, '../../..');
const { createServer } = createRequire(path.join(root, 'apps/web/package.json'))('vite');
const at = new Date().toISOString(), sha = 'a'.repeat(40);
const b = (branch, why, commits = 1) => ({ branch, lane: branch.includes('/') ? branch.split('/')[0] : null, commits, at, author: 'fixture', subject: `work on ${branch}`, sha, why });
const landing = { branches: [b('library/estate-switch', 'PR #82 open', 3)], parked: [b('harvest/2026-10-06/mini-hub-2', 'harvest evidence'), b('codex/creative-sprint-20261008', 'no open PR, and no live CODEX', 3)], live: { sha, main: sha, behind: 0 }, fetchedAt: at };

let server, browser;
try {
  server = await createServer({ root: path.join(root, 'apps/web'), configFile: path.join(root, 'apps/web/vite.config.ts'), logLevel: 'error',
    plugins: [{ name: 'sealed-api', configureServer(v) { v.middlewares.use((req, res, next) => { if (/^\/(api|chat|term)\b/.test(req.url ?? '')) { res.statusCode = 410; res.end('Fixture only'); return; } next(); }); } }],
    server: { host: '127.0.0.1', port: 0, strictPort: false, hmr: false, watch: { ignored: ['**/*'] } } });
  await server.listen();
  const base = `http://127.0.0.1:${server.httpServer.address().port}`;
  browser = await webkit.launch({ headless: true });
  const results = [];
  for (const width of [1440, 390]) {
    const errors = [];
    const page = await browser.newPage({ viewport: { width, height: 900 }, reducedMotion: 'reduce' });
    page.on('pageerror', e => errors.push(e.message));
    await page.addInitScript(phone => { localStorage.setItem('agent-base:space', '"agents"'); if (phone) localStorage.setItem('agent-base:sidebar-open', 'false'); window.EventSource = undefined; }, width < 600);
    await page.routeWebSocket('**/*', socket => socket.close());
    await page.route('**/*', route => new URL(route.request().url()).origin === base ? route.fallback() : route.abort());
    await page.route(`${base}/api/**`, route => {
      const p = new URL(route.request().url()).pathname;
      if (p === '/api/not-landed') return route.fulfill({ json: landing });
      const body = fixtureResponse(p, 'fixture');
      return body === undefined ? route.fulfill({ status: 404, json: {} }) : route.fulfill({ json: body });
    });
    const read = page.waitForResponse(r => new URL(r.url()).pathname === '/api/not-landed');
    await page.goto(base); await read;
    await page.evaluate(() => window.dispatchEvent(new Event('ab:whats-new')));
    const card = page.getByTestId('wn-not-landed'); await card.waitFor();
    assert.equal((await card.locator('.ab-wn__badge').textContent()).trim(), '1', 'only the branch someone means to land counts');
    assert.equal(await card.getByTestId('wn-branch-why').first().textContent(), 'PR #82 open');
    assert.equal(await page.getByTestId('wn-parked').count(), 0, 'parked starts folded');
    await card.getByRole('button', { name: 'Parked (2)' }).click();
    const parked = page.getByTestId('wn-parked');
    assert.deepEqual(await parked.locator('li').evaluateAll(ls => ls.map(l => [l.dataset.branch, l.querySelector('.ab-wn__subject').textContent])), [['harvest/2026-10-06/mini-hub-2', 'harvest evidence'], ['codex/creative-sprint-20261008', 'no open PR, and no live CODEX']]);
    await card.scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(root, `ui-hub/dashboard/not-landed-parked-${width}.png`) });
    assert.deepEqual(errors, []);
    results.push({ width, counted: 1, parked: 2 });
    await page.close();
  }
  console.log('PASS not landed', JSON.stringify(results));
} finally { await browser?.close(); await server?.close(); }
