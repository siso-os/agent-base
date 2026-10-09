/** t-0463: synthetic APIs + fake native IPC; never starts a node or attaches an agent. Run through heavy --. */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import { homedir } from 'node:os';
import { webkit } from './suite-runtime.mjs';
const root = path.resolve(import.meta.dirname, '../../..');
const { createServer } = createRequire(path.join(root, 'apps/web/package.json'))('vite');
const before = process.argv.includes('--before');
const baseline = process.env.AB_SHEETS_BASELINE ?? '77f96fbb473651c74d5b21f68d3cd19dea9f5257';
const sourcePaths = new Set(['apps/web/src/components/browser/SignInSheet.tsx', 'apps/web/src/components/phone/TasksSheet.tsx', 'apps/web/src/components/Browser.css', 'apps/web/src/components/Phone.css']);
const baselineSource = { name: 'phone-sheets-baseline', enforce: 'pre', load(id) {
  const relative = path.relative(root, id.split('?')[0]);
  if (before && sourcePaths.has(relative)) return execFileSync('git', ['show', `${baseline}:${relative}`], { cwd: root, encoding: 'utf8' });
} };
const index = { updated: '2026-10-08T12:00:00Z', counts: {}, tasks: Array.from({ length: 24 }, (_, i) => ({ id: `fixture-${i}`, title: `Synthetic task ${i + 1}`, short: `Synthetic task ${i + 1}`, project: 'Synthetic project', priority: 'P1', stage: 'building', owner: 'SHEET-FIXTURE', model: null, updated: '2026-10-08T12:00:00Z', next: 'NOW: Check the preview' })) };
let server, browser;
const receipts = [];
async function drag(page, grabber, delta) {
  const box = await grabber.boundingBox(); assert(box);
  const x = box.x + box.width / 2, y = box.y + box.height / 2;
  await page.mouse.move(x, y); await page.mouse.down();
  await page.mouse.move(x, y + delta, { steps: 8 });
  return { release: () => page.mouse.up() };
}
try {
  await mkdir(path.join(root, '.astra'), { recursive: true });
  server = await createServer({ configFile: path.join(root, 'apps/web/vite.config.ts'), root: path.join(root, 'apps/web'), plugins: [baselineSource], optimizeDeps: { entries: ['preview/phone-sheets.html'] }, server: { host: '127.0.0.1', port: 0, strictPort: false, watch: { ignored: ['**/*'] }, hmr: false, proxy: {} } });
  await server.listen();
  const base = `http://127.0.0.1:${server.httpServer.address().port}`;
  browser = await webkit.launch({ headless: true });
  for (const [width, height] of [[1440, 900], [390, 844]]) {
    for (const kind of ['tasks', 'signin']) {
      const page = await browser.newPage({ viewport: { width, height }, reducedMotion: 'reduce' });
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.route('**/*', route => new URL(route.request().url()).origin === base ? route.fallback() : route.abort());
      await page.route(`${base}/api/**`, route => {
        const url = new URL(route.request().url());
        if (url.pathname.endsWith('/events')) return route.fulfill({ contentType: 'text/event-stream', body: ': synthetic\n\n' });
        return route.fulfill({ json: url.pathname === '/api/a0/tasks' ? index : url.pathname === '/api/workspace-registry' ? { workspaces: [] } : {} });
      });
      // Exercise the real mountPage visibility/bounds code, without a native window or network sign-in.
      await page.addInitScript(() => {
        window.EventSource = undefined; window.nativeCalls = []; window.nativeUrl = ''; window.nativeAccount = null;
        window.__TAURI_INTERNALS__ = { invoke: async (command, args) => {
          window.nativeCalls.push({ command, args });
          if (command === 'browser_open') window.nativeUrl = args.rawUrl;
          if (command === 'browser_url') return window.nativeUrl;
          if (command === 'browser_google_account') return window.nativeAccount;
        } };
      });
      await page.goto(`${base}/preview/phone-sheets.html?sheet=${kind}`);
      const sheet = kind === 'tasks' ? page.getByTestId('tasks-sheet') : page.getByRole('region', { name: 'Signing in as demo@example.test' });
      await sheet.waitFor();
      if (kind === 'tasks') await sheet.getByText('Synthetic task 1', { exact: true }).first().waitFor();
      if (kind === 'signin') await page.waitForFunction(() => window.nativeCalls.some(x => x.command === 'browser_open'));
      await page.screenshot({ path: path.join(root, `.astra/t0463-${before ? 'before' : 'after'}-${kind}-${width}x${height}-peek.png`) });
      const checker = await readFile(path.join(homedir(), 'SISO_Workspace/Great_Library_of_SISO/banks/siso-ui-hub/bin/pagecheck.js'), 'utf8');
      const report = JSON.parse(await page.evaluate(checker));
      const checkFile = `.astra/t0463-${before ? 'before' : 'after'}-${kind}-${width}-pagecheck.json`;
      await writeFile(path.join(root, checkFile), JSON.stringify(report, null, 2));
      if (!before) {
        const baseReport = JSON.parse(await readFile(path.join(root, `.astra/t0463-before-${kind}-${width}-pagecheck.json`), 'utf8'));
        for (const [rule, value] of Object.entries(report)) if (value && typeof value === 'object' && 'n' in value) assert(value.n <= baseReport[rule].n, `new UI-Hub dashboard failure: ${rule}`);
      }
      if (!before) {
        assert.equal(await sheet.getAttribute('role'), 'region');
        assert.equal(await page.locator('[role="dialog"], dialog[open], [aria-modal="true"]').count(), 0, 'non-modal');
        assert.equal(await sheet.getAttribute('data-detent'), 'peek');
        const peek = await sheet.boundingBox(); assert(peek && peek.height > 100);
        const grabber = sheet.locator('.siso-bottom-sheet__grab');
        const movement = await drag(page, grabber, -70);
        const moving = await sheet.boundingBox();
        assert(Math.abs(moving.height - peek.height - 70) < 3, 'grabber follows pointer 1:1 before release');
        await movement.release();
        await grabber.focus(); await page.keyboard.press('Home');
        assert.equal(await sheet.getAttribute('data-detent'), 'expanded');
        const expanded = await sheet.boundingBox(); assert(expanded.height > peek.height * 1.5);
        assert(expanded.x >= -1 && expanded.y >= -1 && expanded.x + expanded.width <= width + 1 && expanded.y + expanded.height <= height + 1, 'inside viewport');
        if (kind === 'tasks') {
          const composer = await page.locator('.siso-chat__composer').boundingBox();
          assert(expanded.y + expanded.height <= composer.y + 1, 'composer uncovered');
          for (let i = 0; i < 4; i++) await sheet.getByTestId('tasks-more').evaluate(el => el.click());
          assert(await sheet.locator('.ab-tsheet__body').evaluate(el => [el,...el.querySelectorAll('*')].some(node => { if(node.scrollHeight <= node.clientHeight) return false; node.scrollTop = 20; return node.scrollTop > 0; })), 'long list has a working scroll container');
          await page.getByLabel('Message the fixture agent').fill('Still talking');
          await page.getByRole('button', { name: 'Grow composer' }).evaluate(el => el.click());
          await page.waitForTimeout(60);
          const fitted = await sheet.boundingBox(), grown = await page.locator('.siso-chat__composer').boundingBox();
          assert(fitted.y + fitted.height <= grown.y + 1, 'growing composer remains uncovered');
        } else {
          const bounds = await page.evaluate(() => window.nativeCalls.filter(x => x.command === 'browser_open' || x.command === 'browser_bounds'));
          assert(bounds.every(x => x.args.width > 0 && x.args.height > 0), 'native slot has positive bounds');
          assert.equal(await page.evaluate(() => window.nativeCalls.some(x => x.command === 'browser_visible' && x.args.visible === false)), false, 'native sign-in stays visible while dragging');
        }
        await page.screenshot({ path: path.join(root, `.astra/t0463-after-${kind}-${width}x${height}-expanded.png`) });
        const handle = sheet.locator('.siso-bottom-sheet__grab');
        await handle.focus(); await page.keyboard.press('End');
        assert.equal(await sheet.getAttribute('data-detent'), 'peek');
        // Cancellation snaps back and never closes the sheet.
        const cancelled = await drag(page, handle, 40);
        await handle.evaluate(el => el.dispatchEvent(new PointerEvent('pointercancel', { pointerId: 1, bubbles: true })));
        await cancelled.release();
        assert.equal(await sheet.getAttribute('data-detent'), 'peek');
        await handle.focus(); await page.keyboard.press('Escape'); await sheet.waitFor({ state: 'detached' });
        if (kind === 'signin') assert.match(await page.getByTestId('fixture-action').textContent(), /stopped:/, 'early close retains sign-in stop action');
        await page.getByRole('button', { name: 'Reopen sheet' }).click(); await sheet.waitFor();
        const reopened = await sheet.boundingBox();
        const closing = await drag(page, sheet.locator('.siso-bottom-sheet__grab'), Math.min(reopened.height * 0.8, height - reopened.y - 25));
        await closing.release(); await sheet.waitFor({ state: 'detached' });
      }
      assert.deepEqual(errors, [], 'no browser runtime errors');
      receipts.push({ width, height, kind, before, status: 'pass', proof: 'synthetic API and fake native IPC only' });
      await page.close();
    }
  }
  await writeFile(path.join(root, `.astra/t0463-${before ? 'before' : 'after'}-results.json`), JSON.stringify(receipts, null, 2) + '\n');
  console.log(JSON.stringify(receipts));
} finally { await browser?.close(); await server?.close(); }
