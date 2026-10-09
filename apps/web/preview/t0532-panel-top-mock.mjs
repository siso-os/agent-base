// t-0532 item 5 mock (Shaan, 8 Oct ~10:15): "the side panel ... actually goes up to the top line and it removes that gives it more
// space, that's how codex does it". Before: the panel sits inside the frame under the 48px top bar. After (mock, DOM moved in the
// page, nothing in src changed): the panel is its own full-height column and the top bar stops at its left edge.
// Synthetic full app, sealed API, never the live node.   heavy -- node apps/web/preview/t0532-panel-top-mock.mjs
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { webkit } from '../../../services/node/test/suite-runtime.mjs';
import { fixtureResponse } from '../../../tools/ab-qa-fixtures.mjs';

const root = path.resolve(import.meta.dirname, '../../..');
const { createServer } = createRequire(path.join(root, 'apps/web/package.json'))('vite');
const shots = path.join(root, 'ui-hub/t0532-panel-top');
mkdirSync(shots, { recursive: true });
let server, browser;
try {
  server = await createServer({ root: path.join(root, 'apps/web'), configFile: path.join(root, 'apps/web/vite.config.ts'), logLevel: 'error',
    plugins: [{ name: 'sealed-api', configureServer(v) { v.middlewares.use((req, res, next) => { if (/^\/(api|chat|term)\b/.test(req.url ?? '')) { res.statusCode = 410; res.end('Fixture only'); return; } next(); }); } }],
    server: { host: '127.0.0.1', port: 0, strictPort: false, hmr: false, watch: { ignored: ['**/*'] } } });
  await server.listen();
  const base = `http://127.0.0.1:${server.httpServer.address().port}`;
  browser = await webkit.launch({ headless: true });
  for (const width of [1440, 1180]) {
    const page = await browser.newPage({ viewport: { width, height: 900 }, reducedMotion: 'reduce' });
    await page.addInitScript(() => { window.EventSource = undefined; localStorage.setItem('panel.open.zero', 'true'); });
    await page.routeWebSocket('**/*', socket => socket.close());
    await page.route('**/*', route => new URL(route.request().url()).origin === base ? route.fallback() : route.abort());
    await page.route(`${base}/api/**`, route => {
      const body = fixtureResponse(new URL(route.request().url()).pathname, 'fixture');
      return body === undefined ? route.fulfill({ status: 404, json: {} }) : route.fulfill({ json: body });
    });
    await page.goto(base);
    await page.locator('[data-testid="chat-head"]:visible').first().waitFor();
    await page.waitForTimeout(800);
    await page.screenshot({ path: path.join(shots, `before-${width}.png`) });
    const moved = await page.evaluate(() => {
      const app = document.querySelector('.siso-app'), top = document.querySelector('.siso-app__top'), frame = document.querySelector('.siso-app__frame');
      // The right panel: walk up from a point inside it until the parent reaches further left (the chat column).
      let card = document.elementFromPoint(innerWidth - 180, 500);
      while (card?.parentElement && card.parentElement.getBoundingClientRect().left >= card.getBoundingClientRect().left - 40) card = card.parentElement;
      if (!app || !top || !frame || !card) return 'missing';
      const w = Math.round(card.getBoundingClientRect().width);
      app.style.gridTemplateColumns = `64px minmax(0, 1fr) ${w}px`;
      top.style.gridColumn = '1 / 3';
      frame.style.marginRight = '6px';
      Object.assign(card.style, { gridColumn: '3', gridRow: '1 / 3', margin: '8px 8px 8px 0', minHeight: '0' });
      app.appendChild(card);
      return w;
    });
    if (moved === 'missing') throw new Error('panel not found');
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(shots, `after-${width}.png`) });
    console.log(`${width}: panel ${moved}px moved to the top line`);
    await page.close();
  }
} finally {
  await browser?.close();
  await server?.close();
}
