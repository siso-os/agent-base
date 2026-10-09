// t-0532 item 5 only. Synthetic full app; sealed API/WebSockets, never a live agent.
// Parent runs through heavy --. BEFORE=1 captures the baseline; MOCK=1 previews the
// proposed shell slot on the baseline without changing application source.
// Default checks the implementation. All modes write 1440x900 and 390x844 shots.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { webkit } from './suite-runtime.mjs';
import { fixtureResponse } from '../../../tools/ab-qa-fixtures.mjs';

const root = path.resolve(import.meta.dirname, '../../..');
const { createServer } = createRequire(path.join(root, 'apps/web/package.json'))('vite');
const mode = process.env.MOCK ? 'mock' : process.env.BEFORE ? 'before' : 'after';
const shots = path.join(root, '.astra/t0532-panel-top');
mkdirSync(shots, { recursive: true });
const results = [];
let server, browser, latestPage;

// A design preview only. Reparent the existing fixture panel into a shell column;
// do not interact after reparenting React-owned DOM. Phone uses its existing sheet.
async function mockSlot(page, width) {
  if (width < 640) return;
  await page.evaluate(() => {
    const app = document.querySelector('.siso-app');
    const panel = document.querySelector('[data-testid="agent-panel"]');
    const slot = document.createElement('div');
    slot.className = 'siso-app__side';
    app.append(slot);
    slot.append(panel);
  });
  await page.addStyleTag({ content: `
    .siso-app { grid-template-columns: 64px minmax(0, 1fr) auto; }
    .siso-app__top { grid-column: 1 / 3; grid-row: 1; overflow-x: auto; scrollbar-width: none; }
    .siso-app__rail { grid-column: 1; grid-row: 2; }
    .siso-app__frame { grid-column: 2; grid-row: 2; }
    .siso-app__side { grid-column: 3; grid-row: 1 / -1; display: flex; min-width: 0; min-height: 0; }
  ` });
}

async function boxes(page) {
  return page.evaluate(() => {
    const rect = selector => {
      const el = [...document.querySelectorAll(selector)].find(el => el.getClientRects().length);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height, right: r.right, bottom: r.bottom };
    };
    return { top: rect('.siso-app__top'), frame: rect('.siso-app__frame'), panel: rect('[data-testid="agent-panel"]'), card: rect('[data-testid="panel-card"]'), chat: rect('section[aria-label="Chat"]'), side: rect('.siso-side') };
  });
}

async function topControls(page) {
  for (const name of ['New tab · ⌘T', 'More views']) {
    const button = page.getByRole('button', { name, exact: true });
    await button.scrollIntoViewIfNeeded();
    const visible = await button.evaluate(el => {
      const r = el.getBoundingClientRect();
      const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
      return r.width > 0 && r.left >= 0 && r.right <= innerWidth && (el === hit || el.contains(hit));
    });
    assert.equal(visible, true, `${name} remains unobscured`);
  }
}

function desktopGeometry(r) {
  assert.ok(r.panel && r.card, 'one panel is visible');
  assert.ok(Math.abs(r.panel.y - r.top.y) <= 1, 'panel reaches the window top line');
  assert.ok(r.card.y < r.top.bottom, 'card gains the bar height');
  assert.ok(r.top.right <= r.panel.x + 1, 'top controls have a separate column');
  assert.ok(r.frame.right <= r.panel.x + 1, 'panel squeezes the content instead of covering it');
  assert.ok(r.card.bottom <= 900 && r.card.height > 840, 'panel keeps bottom gutter and gains height');
  assert.ok(r.chat.width > 200, 'chat remains readable');
}

try {
  server = await createServer({ root: path.join(root, 'apps/web'), configFile: path.join(root, 'apps/web/vite.config.ts'), logLevel: 'error',
    plugins: [{ name: 'baseline-panel-source', enforce: 'pre', load(id) { if(mode === 'after') return; const file=path.relative(root,id.split('?')[0]); if(['apps/web/src/App.tsx','packages/siso-shell/src/AppFrame.tsx','packages/siso-shell/shell.css'].includes(file)) return execFileSync('git',['show',`77f96fbb:${file}`],{cwd:root,encoding:'utf8'}); } }, { name: 'sealed-panel-fixture', configureServer(v) { v.middlewares.use((req, res, next) => {
      if (/^\/(api|chat|term)\b/.test(req.url ?? '')) { res.statusCode = 410; res.end('Fixture only'); return; }
      next();
    }); } }],
    server: { host: '127.0.0.1', port: 0, strictPort: false, hmr: false, watch: { ignored: ['**/*'] } } });
  await server.listen();
  const base = `http://127.0.0.1:${server.httpServer.address().port}`;
  browser = await webkit.launch({ headless: true });
  for (const width of [1440, 390]) {
    const height = width === 390 ? 844 : 900;
    const errors = [];
    const page = await browser.newPage({ viewport: { width, height }, reducedMotion: 'reduce' });
    latestPage=page; page.setDefaultTimeout(8000);
    page.on('pageerror', e => errors.push(e.message));
    await page.addInitScript(() => {
      window.EventSource = undefined;
      localStorage.setItem('agent-base:active', JSON.stringify('fixture-zero'));
      localStorage.setItem('agent-base:sidebar-open', matchMedia('(max-width: 639px)').matches ? 'false' : 'true');
      localStorage.setItem('agent-base:panel.open.zero', 'true');
      localStorage.setItem('agent-base:panel.w.zero', '360');
    });
    await page.routeWebSocket('**/*', socket => socket.close());
    await page.route('**/*', route => new URL(route.request().url()).origin === base ? route.fallback() : route.abort());
    await page.route(`${base}/api/**`, route => {
      const p = new URL(route.request().url()).pathname;
      const body = fixtureResponse(p, 'fixture');
      return body === undefined ? route.fulfill({ status: 404, json: {} }) : route.fulfill({ json: body });
    });
    await page.goto(base);
    const panel = page.locator('[data-testid="agent-panel"]:visible');
    await panel.waitFor();
    await page.waitForTimeout(500);
    if (mode === 'mock') await mockSlot(page, width);
    const initial = await boxes(page);
    await page.screenshot({ path: path.join(shots, `${mode}-${width}x${height}.png`) });
    results.push({ mode, width, height, initial });
    if (mode !== 'after') { await page.close(); continue; }

    assert.equal(await panel.count(), 1, 'only one visible agent panel');
    if (width === 1440) {
      desktopGeometry(initial);
      await topControls(page);
      // The width handle still drives the grid track, persists the width and resets.
      const grip = panel.getByRole('separator', { name: 'Resize the panel' });
      const g = await grip.boundingBox();
      await page.mouse.move(g.x + g.width / 2, g.y + g.height / 2);
      await page.mouse.down();
      await page.mouse.move(g.x + g.width / 2 - 120, g.y + g.height / 2, { steps: 8 });
      await page.mouse.up();
      await page.waitForTimeout(250);
      const resized = await boxes(page);
      assert.ok(Math.abs(resized.panel.width - 480) <= 2, 'drag grows panel to 480px');
      assert.ok(resized.top.width < initial.top.width - 100, 'grid reserves the resized panel width');
      assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('agent-base:panel.w.zero'))), 480);
      desktopGeometry(resized);
      await topControls(page);
      await page.screenshot({ path: path.join(shots, `after-resized-${width}.png`) });
      await grip.dblclick();
      await page.waitForTimeout(250);
      assert.ok(Math.abs((await boxes(page)).panel.width - 360) <= 2);

      const toggle = page.getByTestId('chat-panel-toggle');
      await toggle.click();
      await panel.waitFor({ state: 'hidden' });
      const closed = await boxes(page);
      assert.ok(closed.top.width > initial.top.width + 300, 'close returns the top-bar width');
      assert.ok(closed.frame.width > initial.frame.width + 300, 'close returns the content width');
      assert.equal(await toggle.getAttribute('aria-pressed'), 'false');
      await topControls(page);
      await page.screenshot({ path: path.join(shots, `after-closed-${width}.png`) });
      await toggle.click();
      await panel.waitFor();

      // Existing split-page drop still replaces the panel and stays in the frame.
      await page.locator('section[aria-label="Chat"]').dispatchEvent('drop', {
        dataTransfer: await page.evaluateHandle(() => {
          const d = new DataTransfer();
          d.setData('application/x-siso-page', JSON.stringify({ url: 'https://example.test/panel-top', title: 'Panel top fixture' }));
          return d;
        }),
      });
      await panel.waitFor({ state: 'hidden' });
      await page.locator('.siso-side').waitFor();
      const split = await boxes(page);
      assert.ok(split.side.x >= split.frame.x && split.side.right <= split.frame.right + 1, 'page split stays inside the content frame');
      assert.ok(split.top.width > initial.top.width + 300, 'split releases the shell side slot');
      await page.screenshot({ path: path.join(shots, `after-split-${width}.png`) });
      await page.keyboard.press('Escape');
      await page.locator('.siso-side').waitFor({ state: 'hidden' });
      await panel.waitFor();

      await page.setViewportSize({ width: 1100, height: 900 });
      await page.waitForTimeout(250);
      assert.equal(await page.locator('.siso-sidenav:visible').count(), 0, 'panel still folds the left nav below 1200px');
      await topControls(page);
      await page.getByTestId('chat-panel-toggle').click();
      await panel.waitFor({ state: 'hidden' });
      await page.locator('.siso-sidenav:visible').waitFor();
      // Page-kind panels use the same shell slot and remember their own close.
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.getByRole('button', { name: 'More views', exact: true }).click();
      await page.getByRole('menuitem', { name: 'What’s new', exact: true }).click();
      await page.locator('section[aria-label="What’s new"]').waitFor();
      await page.waitForTimeout(100);
      await page.keyboard.press('Meta+Shift+KeyB');
      await panel.waitFor();
      const pagePanel = await boxes(page);
      assert.ok(Math.abs(pagePanel.panel.y - pagePanel.top.y) <= 1, 'page panel also reaches the top line');
      await topControls(page);
      await page.screenshot({ path: path.join(shots, `after-page-panel-${width}.png`) });
      await page.keyboard.press('Escape');
      await panel.waitFor({ state: 'hidden' });
      results.at(-1).resized = resized;
      results.at(-1).closed = closed;
      results.at(-1).split = split;
      results.at(-1).pagePanel = pagePanel;
    } else {
      assert.equal(await panel.getAttribute('role'), 'dialog', 'phone retains modal sheet');
      assert.ok(initial.panel.y > 140 && Math.abs(initial.panel.bottom - height) <= 1, 'phone sheet stays at the bottom');
      assert.ok(Math.abs(initial.panel.width - width) <= 1, 'phone sheet fills width');
      assert.equal(await panel.getByRole('separator').isVisible(), false, 'desktop width grip stays hidden on phone');
      await page.getByTestId('sheet-handle').click();
      await panel.waitFor({ state: 'hidden' });
      assert.equal(await page.getByTestId('chat-panel-toggle').getAttribute('aria-pressed'), 'false', 'sheet close restores the phone chat');
      await page.screenshot({ path: path.join(shots, `after-closed-${width}.png`) });
    }
    assert.deepEqual(errors, [], 'no page errors');
    await page.close();
  }
  writeFileSync(path.join(shots, `${mode}-geometry.json`), JSON.stringify(results, null, 2));
  console.log(mode === 'after' ? 'PASS t-0532 panel top, resize, close, split and phone sheet' : `${mode} screenshots captured`, JSON.stringify(results));
} catch(error) {
  if(latestPage && !latestPage.isClosed()) { await latestPage.screenshot({path:path.join(shots,'failure.png')}); console.log('Failure context',await latestPage.evaluate(()=>({page:document.querySelector('section[aria-label="What’s new"]')?.textContent?.slice(0,80),panels:[...document.querySelectorAll('[data-testid="agent-panel"]')].map(e=>({hidden:e.getAttribute('aria-hidden'),box:e.getBoundingClientRect().toJSON()})),openKeys:Object.keys(localStorage).filter(k=>k.includes('panel.open')).map(k=>[k,localStorage.getItem(k)])}))); }
  throw error;
} finally { await browser?.close(); await server?.close(); }
