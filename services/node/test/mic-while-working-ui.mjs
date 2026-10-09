// The mic stays beside Stop while an agent works (VOICE lane, 9 Oct): a voice note goes into the current turn like a typed
// one. Idle shows the mic alone; a draft shows Send alone. Sealed vite, fixture API, a fake chat socket; never a live agent.
//   heavy -- node services/node/test/mic-while-working-ui.mjs
import { createRequire } from 'node:module';
import path from 'node:path';
import { webkit } from './suite-runtime.mjs';
import { fixtureResponse } from '../../../tools/ab-qa-fixtures.mjs';

const root = path.resolve(import.meta.dirname, '../../..');
const { createServer } = createRequire(path.join(root, 'apps/web/package.json'))('vite');
const results = [];
const check = (name, ok, detail = {}) => { results.push(!!ok); console.log(JSON.stringify({ check: name, ok: !!ok, ...detail })); };
let server, browser;
try {
  server = await createServer({ root: path.join(root, 'apps/web'), configFile: path.join(root, 'apps/web/vite.config.ts'), logLevel: 'error',
    plugins: [{ name: 'sealed-api', configureServer(v) { v.middlewares.use((req, res, next) => { if (/^\/(api|chat|term)\b/.test(req.url ?? '')) { res.statusCode = 410; res.end('Fixture only'); return; } next(); }); } }],
    server: { host: '127.0.0.1', port: 0, strictPort: false, hmr: false, watch: { ignored: ['**/*'] } } });
  await server.listen();
  const base = `http://127.0.0.1:${server.httpServer.address().port}`;
  browser = await webkit.launch({ headless: true });
  for (const state of ['working', 'idle']) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
    await page.addInitScript(() => { window.EventSource = undefined; });
    await page.route('**/*', route => new URL(route.request().url()).origin === base ? route.fallback() : route.abort());
    await page.route(`${base}/api/**`, route => {
      const body = fixtureResponse(new URL(route.request().url()).pathname, 'fixture');
      return body === undefined ? route.fulfill({ status: 404, json: {} }) : route.fulfill({ json: body });
    });
    // The newest WebSocket route wins in Playwright, so the catch-all goes first.
    await page.routeWebSocket('**/*', ws => ws.close());
    await page.routeWebSocket(/\/chat\/[^/]+\/ws/, ws => ws.send(JSON.stringify({ t: 'hello', session: 'fixture', log: [], before: 0, more: false, state, thinking: {}, partial: {}, tasks: [], bg: [] })));
    await page.goto(base);
    const row = page.locator('[data-testid="chat-view"]:visible .siso-chat__inputrow').first();
    await row.waitFor({ timeout: 15000 });
    const stop = row.getByRole('button', { name: 'Stop', exact: true }), mic = row.locator('[data-testid=mic]');
    if (state === 'working') {
      await stop.waitFor({ timeout: 5000 }).catch(() => {});
      check('working: Stop shows', await stop.count() === 1);
      check('working: the mic shows beside it', await mic.count() === 1);
      await row.getByRole('textbox', { name: 'Message', exact: true }).fill('typed note');
      check('working with a draft: Send alone', await row.getByRole('button', { name: 'Send', exact: true }).count() === 1 && await stop.count() === 0 && await mic.count() === 0);
    } else {
      await mic.waitFor({ timeout: 5000 }).catch(() => {});
      check('idle: the mic alone, no Stop', await mic.count() === 1 && await stop.count() === 0);
    }
    await page.close();
  }
} catch (error) {
  check('mic-while-working suite completes', false, { error: String(error?.stack ?? error).slice(0, 600) });
} finally {
  await browser?.close();
  await server?.close();
}
console.log(JSON.stringify({ passed: results.filter(Boolean).length, of: results.length }));
process.exitCode = results.length && results.every(Boolean) ? 0 : 1;
