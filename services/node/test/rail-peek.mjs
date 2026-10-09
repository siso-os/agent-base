/** Fixture-only WebKit proof. Run with heavy; closes its own browser and Vite in finally. */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { webkit } from './suite-runtime.mjs';
import { fixtureResponse } from '../../../tools/ab-qa-fixtures.mjs';
const root = path.resolve(import.meta.dirname, '../../..');
const { createServer } = createRequire(path.join(root, 'apps/web/package.json'))('vite');
const before = process.argv.includes('--before');
const baseline = execFileSync('git', ['rev-parse', 'origin/main'], { cwd: root, encoding: 'utf8' }).trim();
const receipts = [];
// Load baseline source directly from git, without touching any checkout or duplicating the repository.
const baselineSource = { name: 'rail-baseline-source', enforce: 'pre', load(id) {
  if (!before) return;
  const relative = path.relative(root, id.split('?')[0]);
  if (relative === 'apps/web/preview/rail-peek.tsx') return readFileSync(path.join(root, relative), 'utf8').replace(/^import .*HomePeek.*\n/m, '').replace(/ peek=\{\(\{ close \}\) => <HomePeek .*?\/>\}/, '');
  if (!/^(apps\/web\/src|packages)\//.test(relative) || /node_modules/.test(relative) || !/\.(tsx?|css)$/.test(relative)) return;
  return execFileSync('git', ['show', `${baseline}:${relative}`], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
} };
let server, browser;
async function inside(page, locator) {
  const box = await locator.boundingBox(); assert(box, 'peek has a rendered box');
  const { width, height } = page.viewportSize();
  assert(box.x >= 7 && box.y >= 7 && box.x + box.width <= width - 7 && box.y + box.height <= height - 7, `viewport bounds: ${JSON.stringify(box)}`);
}
try {
  server = await createServer({ configFile: path.join(root, 'apps/web/vite.config.ts'), root: path.join(root, 'apps/web'), plugins: [baselineSource], optimizeDeps: { entries: ['preview/rail-peek.html'] }, server: { host: '127.0.0.1', port: 0, strictPort: false, watch: { ignored: ['**/*'] }, hmr: false, proxy: {} } });
  await server.listen();
  const base = `http://127.0.0.1:${server.httpServer.address().port}`;
  browser = await webkit.launch({ headless: true });
  for (const width of [1440, 390]) {
    const page = await browser.newPage({ viewport: { width, height: 900 }, reducedMotion: 'reduce' });
    const errors = [], apiRequests = [];
    page.on('request', request => { if (new URL(request.url()).pathname.startsWith('/api/')) apiRequests.push(new URL(request.url()).pathname); });
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => new URL(route.request().url()).origin === base ? route.fallback() : route.abort());
    await page.route(`${base}/api/**`, route => route.fulfill({ json: fixtureResponse(new URL(route.request().url()).pathname, 'fixture') ?? {} }));
    await page.goto(`${base}/preview/rail-peek.html`);
    const home = page.getByRole('button', { name: 'Home: Projects, agents and activity', exact: true });
    const peek = page.getByTestId(before ? 'hovercard' : 'rail-peek');
    if (!before) {
      assert.equal(await peek.count(), 0, 'initially closed');
      await home.evaluate(el => {
        el.addEventListener('pointerenter', () => {
          window.hoverStart = performance.now();
          const observer = new MutationObserver(() => {
            const panel = document.querySelector('[data-testid="rail-peek"]');
            if (panel && getComputedStyle(panel).visibility === 'visible') { window.hoverElapsed = performance.now() - window.hoverStart; observer.disconnect(); }
          });
          observer.observe(document.body, { subtree: true, childList: true, attributes: true });
        }, { once: true });
      });
    }
    await home.hover(); await peek.waitFor();
    if (!before) {
      const elapsed = await page.evaluate(() => window.hoverElapsed);
      assert(elapsed >= 45 && elapsed < 200, `60ms hover with scheduler tolerance: ${elapsed}ms`);
      receipts.push({ width, hoverMs: elapsed });
      await inside(page, peek);
      assert(await page.evaluate(() => {
        const peek = document.querySelector('[data-testid="rail-peek"]');
        const p = peek.getBoundingClientRect(), t = document.querySelector('[data-testid="top-strip"]').getBoundingClientRect();
        const x = (Math.max(p.left, t.left) + Math.min(p.right, t.right)) / 2, y = (Math.max(p.top, t.top) + Math.min(p.bottom, t.bottom)) / 2;
        return x < Math.min(p.right, t.right) && y < Math.min(p.bottom, t.bottom) && peek.contains(document.elementFromPoint(x, y));
      }), 'peek is above top strip at overlap');
      await home.click(); assert.equal(await peek.getAttribute('data-pinned'), 'true');
      await page.mouse.move(width - 5, 890); await page.waitForTimeout(350); assert(await peek.isVisible(), 'click pins beyond pointer leave');
    }
    await page.screenshot({ path: path.join(root, `ui-hub/side-nav/rail-peek-20261008-${before ? 'before' : 'after'}-${width}.png`) });
    if (!before) {
      await peek.getByRole('button', { name: /Agent Base/ }).click();
      await peek.getByRole('button', { name: /Open project/ }).waitFor(); await inside(page, peek);
      assert(await peek.getByRole('button', { name: 'All projects' }).evaluate(el => el === document.activeElement), 'drill retains keyboard focus');
      await page.keyboard.press('Enter'); assert(await peek.getByRole('button', { name: /Agent Base/ }).evaluate(el => el === document.activeElement), 'back restores project row focus');
      await page.keyboard.press('Enter'); await peek.getByRole('button', { name: /Open project/ }).waitFor();
      await page.keyboard.press('Escape'); await peek.waitFor({ state: 'detached' }); assert(await home.evaluate(el => el === document.activeElement), 'Esc returns focus');
      await page.keyboard.press('Enter'); await peek.waitFor(); assert.equal(await peek.getAttribute('data-pinned'), 'true');
      await page.keyboard.press('Tab'); assert(await peek.evaluate(el => el.contains(document.activeElement)), 'keyboard enters peek controls');
      await peek.getByRole('tab', { name: 'Agents', exact: true }).click(); assert(await peek.getByText('Needs you', { exact: true }).isVisible());
      await peek.getByRole('tab', { name: 'Activity', exact: true }).click(); assert(await peek.getByText('Latest observed agent states').isVisible());
      await page.keyboard.press('Escape');
      for (const state of ['empty', 'loading', 'many', 'unavailable']) {
        await page.getByLabel('Fixture state').selectOption(state); await home.click(); await peek.waitFor(); await inside(page, peek);
        if (state === 'empty') assert(await peek.getByText('No projects yet.').isVisible());
        if (state === 'loading') assert(await peek.getByText('Loading projects and agents…').isVisible());
        if (state === 'many') {
          assert.equal(await peek.locator('.hp-row').count(), 40);
          assert(await peek.locator('.hp-body').evaluate(el => el.scrollHeight > el.clientHeight), '40 projects scroll internally');
          await page.setViewportSize({ width, height: 500 }); await page.waitForTimeout(50); await inside(page, peek);
          await page.setViewportSize({ width, height: 900 });
        }
        if (state === 'unavailable') assert(await peek.getByText('Source unavailable.', { exact: false }).isVisible());
        await page.keyboard.press('Escape');
      }
      for (const name of ['Today spend: open supplied snapshot', 'Versions: Current version confirmed']) {
        const trigger = page.getByRole('button', { name, exact: true });
        await trigger.hover(); const panel = page.getByTestId('peek');
        // Versions opens only when asked (t-0556): hover leaves it closed, a click opens it pinned.
        if (name.startsWith('Versions')) { await page.waitForTimeout(300); assert.equal(await panel.count(), 0, 'hover does not open Versions'); await trigger.click(); await panel.waitFor(); await inside(page, panel); }
        else { await panel.waitFor(); await inside(page, panel); await trigger.click(); }
        assert.equal(await panel.getAttribute('data-pinned'), 'true');
        await panel.locator('.siso-peek__head strong').click(); assert.equal(await panel.getAttribute('data-pinned'), 'true', 'click inside portaled panel preserves controlled pin');
        await page.keyboard.press('Escape'); await panel.waitFor({ state: 'detached' }); assert(await trigger.evaluate(el => el === document.activeElement));
        if (name.startsWith('Versions')) { await trigger.click(); await panel.getByRole('button', { name: 'Dismiss notice' }).click(); await panel.waitFor({ state: 'detached' }); }
      }
      // Actual mountPage code with deliberately slow synthetic IPC: paint must await hide acknowledgement.
      await page.goto(`${base}/preview/rail-peek.html?native`);
      const native = page.getByTitle('Synthetic native surface'); await native.waitFor();
      await home.hover(); await page.waitForSelector('[data-testid="rail-peek"]', { state: 'attached' });
      assert.equal(await peek.evaluate(el => getComputedStyle(el).visibility), 'hidden', 'waits for native hide');
      await peek.waitFor(); assert(await native.isHidden(), 'native acknowledged hidden before peek paint');
      await page.keyboard.press('Escape'); await native.waitFor({ state: 'visible' });
      const browserRail = page.getByRole('button', { name: 'Browser: Web pages beside your agents', exact: true });
      await browserRail.hover(); await page.getByTestId('hovercard').waitFor(); assert(await native.isHidden(), 'label also hides native child');
      await page.keyboard.press('Escape'); await native.waitFor({ state: 'visible' });
      receipts.push({ width, pinEscape: true, keyboard: true, states: true, viewport: true, topStrip: true, nativeIpcFixture: true });
    }
    assert.deepEqual(errors, []); assert.deepEqual(apiRequests, [], 'standalone preview resolves fixtures before network'); await page.close();
  }
  await writeFile(path.join(root, `ui-hub/side-nav/rail-peek-20261008-${before ? 'before' : 'checks'}.json`), JSON.stringify({ baseline: before ? baseline : undefined, engine: 'WebKit', nativeProof: 'IPC fixture only, not installed Tauri runtime', receipts }, null, 2) + '\n');
  console.log(`PASS rail peek ${before ? `origin/main ${baseline} baseline captures` : JSON.stringify(receipts)} at 1440 and 390`);
} finally { await browser?.close(); await server?.close(); }
