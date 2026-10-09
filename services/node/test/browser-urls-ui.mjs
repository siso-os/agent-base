// 9 Oct, Shaan: "I can't open up URLs in the browser on my agent base". (1) A typed address landed after the old one
// ("example.comhttps://…"): focusing selects it and typing or pasting replaces it. (2) Sites that refuse frames (GitHub) or
// ask for a password (the siso-ui-hub worker) showed nothing: in a plain browser they get "Open in a new tab"; in the app a
// password site gets a sign-in sheet (a fake desktop bridge stands in for WebKit here; test/browser-site-auth.py in
// apps/desktop proves the native side). Synthetic full app, sealed API, never the live node. Run with heavy.
//   node services/node/test/browser-urls-ui.mjs [--before]   (--before serves origin/main's Browser.tsx; shots only)
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { webkit } from './suite-runtime.mjs';
import { fixtureResponse } from '../../../tools/ab-qa-fixtures.mjs';

const root = path.resolve(import.meta.dirname, '../../..');
const { createServer } = createRequire(path.join(root, 'apps/web/package.json'))('vite');
const before = process.argv.includes('--before');
const shots = path.join(root, 'ui-hub/browser');
const old = new Map(before ? ['apps/web/src/components/Browser.tsx'].map(f => [path.join(root, f), execFileSync('git', ['show', `origin/main:${f}`], { cwd: root, encoding: 'utf8', maxBuffer: 8 << 20 })]) : []);
const FRAMES = { 'github.com': { frame: false, why: 'frames' }, 'siso-ui-hub.example.workers.dev': { frame: false, why: 'password' } };

// A stand-in for the desktop app's bridge: records commands, lets the test emit native events.
const fakeBridge = () => {
  const handlers = new Map(), listeners = new Map(); let next = 1;
  window.__calls = [];
  window.__emit = (event, payload) => { for (const h of listeners.get(event) ?? []) handlers.get(h)?.({ event, payload }); };
  window.__TAURI_INTERNALS__ = {
    transformCallback: (cb) => { const id = next++; handlers.set(id, cb); return id; },
    invoke: async (cmd, args = {}) => {
      window.__calls.push({ cmd, args });
      if (cmd === 'plugin:event|listen') { listeners.set(args.event, [...(listeners.get(args.event) ?? []), args.handler]); return next++; }
      if (cmd === 'browser_auth_pending') return [];
      if (cmd === 'browser_url' || cmd === 'browser_title') return '';
      if (cmd === 'browser_audio') return false;
      return null;
    },
  };
};

let server, browser;
try {
  server = await createServer({ root: path.join(root, 'apps/web'), configFile: path.join(root, 'apps/web/vite.config.ts'), logLevel: 'error',
    plugins: [{ name: 'sealed-api', configureServer(v) { v.middlewares.use((req, res, next) => { if (/^\/(api|chat|term)\b/.test(req.url ?? '')) { res.statusCode = 410; res.end('Fixture only'); return; } next(); }); } },
      { name: 'origin-main', enforce: 'pre', load(id) { return old.get(id.split('?')[0]) ?? null; } }],
    server: { host: '127.0.0.1', port: 0, strictPort: false, hmr: false, watch: { ignored: ['**/*'] } } });
  await server.listen();
  const base = `http://127.0.0.1:${server.httpServer.address().port}`;
  browser = await webkit.launch({ headless: true });
  const open = async (width, native) => {
    const errors = [];
    const page = await browser.newPage({ viewport: { width, height: 900 }, reducedMotion: 'reduce' });
    page.on('pageerror', e => errors.push(e.message));
    await page.addInitScript(() => { localStorage.setItem('agent-base:space', '"web"'); window.EventSource = undefined; });
    if (native) await page.addInitScript(fakeBridge);
    await page.routeWebSocket('**/*', socket => socket.close());
    await page.route('**/*', route => new URL(route.request().url()).origin === base ? route.fallback() : route.abort());
    await page.route(`${base}/api/**`, route => {
      const req = route.request(), p = new URL(req.url()).pathname;
      if (p === '/api/browser/state' && req.method() !== 'GET') return route.fulfill({ json: { ok: true } });
      if (p === '/api/browser/frame') { const host = new URL(JSON.parse(req.postData() ?? '{}').url).host; return route.fulfill({ json: FRAMES[host] ?? { frame: true } }); }
      const body = fixtureResponse(p, 'fixture');
      return body === undefined ? route.fulfill({ status: 404, json: {} }) : route.fulfill({ json: body });
    });
    await page.goto(base);
    const bar = page.getByRole('combobox', { name: 'Search or enter a URL' }).first();
    await bar.waitFor();
    return { page, bar, errors };
  };
  const results = [];
  for (const width of [1440, 390]) {
    const { page, bar, errors } = await open(width, false);
    const iframeSrc = () => page.locator('iframe').first().getAttribute('src', { timeout: 3000 }).catch(() => null);
    // First address from a blank tab.
    await bar.click(); await page.keyboard.type('example.com'); await page.keyboard.press('Enter');
    await page.waitForFunction(() => document.querySelector('iframe')?.getAttribute('src') === 'https://example.com/' || document.querySelector('iframe')?.getAttribute('src') === 'https://example.com');
    // The bug: a second address typed straight after clicking the bar, and one pasted.
    await bar.click(); await page.keyboard.type('wikipedia.org'); await page.keyboard.press('Enter');
    await page.waitForTimeout(300);
    const typed = await iframeSrc();
    // insertText lands the whole string in one input event, as a paste does.
    await bar.click(); await page.keyboard.insertText('https://example.org/'); await page.keyboard.press('Enter');
    await page.waitForTimeout(300);
    const pasted = await iframeSrc();
    if (before) { await page.screenshot({ path: path.join(shots, `urls-before-${width}.png`) }); results.push({ width, typed, pasted }); await page.close(); continue; }
    assert.match(typed ?? '', /^https:\/\/wikipedia\.org\/?$/, `typing replaces the address (got ${typed})`);
    assert.match(pasted ?? '', /^https:\/\/example\.org\/?$/, `pasting replaces the address (got ${pasted})`);
    // Placing the caret edits in place.
    await bar.click(); await page.keyboard.press('ArrowRight'); await page.keyboard.type('wiki'); await page.keyboard.press('Enter');
    await page.waitForTimeout(300);
    assert.equal(await iframeSrc(), 'https://example.org/wiki', 'ArrowRight then typing appends');
    // A site that refuses frames gets a way out, not a blank frame.
    await bar.click(); await page.keyboard.type('github.com/sisodia'); await page.keyboard.press('Enter');
    const blocked = page.getByTestId('frame-blocked');
    await blocked.getByText("github.com won't open inside Agent Base").waitFor();
    assert.equal(await page.locator('iframe').count(), 0, 'no dead frame');
    await blocked.getByRole('button', { name: 'Open in a new tab' }).waitFor();
    await page.screenshot({ path: path.join(shots, `urls-frame-blocked-${width}.png`) });
    await bar.click(); await page.keyboard.type('siso-ui-hub.example.workers.dev'); await page.keyboard.press('Enter');
    await blocked.getByText('siso-ui-hub.example.workers.dev asks for a password').waitFor();
    assert.deepEqual(errors, []);
    await page.close();

    // In the app: a password site's question becomes a sign-in sheet, and his answer goes back to the desktop side.
    const app = await open(width, true);
    await app.bar.click(); await app.page.keyboard.type('siso-ui-hub.example.workers.dev'); await app.page.keyboard.press('Enter');
    const tab = await app.page.waitForFunction(() => window.__calls.find(c => c.cmd === 'browser_open')?.args.tab).then(h => h.jsonValue());
    const ask = (id, retry) => app.page.evaluate(([id, tab, retry]) => window.__emit('browser-auth', { id, tab, host: 'siso-ui-hub.example.workers.dev', realm: 'SISO UI Hub', retry }), [id, tab, retry]);
    await ask(7, false);
    const sheet = app.page.getByRole('dialog', { name: 'Sign in to siso-ui-hub.example.workers.dev' });
    await sheet.waitFor();
    assert.equal(await sheet.getByRole('button', { name: 'Sign in' }).isDisabled(), true, 'no sign-in without a user');
    await sheet.getByLabel('User').fill('shaan'); await sheet.getByLabel('Password').fill('fixture-pw');
    await app.page.screenshot({ path: path.join(shots, `urls-sign-in-${width}.png`) });
    await sheet.getByRole('button', { name: 'Sign in' }).click();
    await sheet.waitFor({ state: 'detached' });
    await ask(8, true);
    await sheet.getByRole('alert').filter({ hasText: 'did not work' }).waitFor();
    await app.page.keyboard.press('Escape');
    await app.page.getByText('Not signed in to siso-ui-hub.example.workers.dev').waitFor();
    const answers = await app.page.evaluate(() => window.__calls.filter(c => c.cmd === 'browser_auth').map(c => c.args));
    assert.deepEqual(answers, [{ id: 7, user: 'shaan', password: 'fixture-pw' }, { id: 8, user: null, password: null }]);
    await app.page.screenshot({ path: path.join(shots, `urls-sign-in-cancelled-${width}.png`) });
    assert.deepEqual(app.errors, []);
    await app.page.close();
    results.push({ width, typed, pasted, frames: 'github blocked, password site blocked', signIn: 'answered, retried, cancelled' });
  }
  console.log(before ? 'BEFORE' : 'PASS browser urls', JSON.stringify(results));
} finally { await browser?.close(); await server?.close(); }
