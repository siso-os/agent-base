// Browser speed, React side (t-0494): the production browser (BrowserWindow, the same tab model Agent Base uses) in
// headless WebKit against an in-memory API. Times click → the row lit and painted, for a warm switch between open tabs,
// 12 times, and the first render of the browser. No native pages, live node, accounts or sockets.
import { createRequire } from 'node:module';
import { writeFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
const root = path.resolve(import.meta.dirname, '../../..');
const requireWeb = createRequire(path.join(root, 'apps/web/package.json'));
const { createServer } = requireWeb('vite');
const { webkit } = createRequire(path.join(root, 'services/node/package.json'))('playwright');
const tailwind = (await import(requireWeb.resolve('@tailwindcss/vite'))).default;
const scratch = await mkdtemp(path.join(tmpdir(), '.siso-ephemeral-browser-speed-'));
const fixturePath = path.join(root, 'apps/web/src/browser-speed-fixture.tsx');
const fixture = `import React from 'react';import{createRoot}from'react-dom/client';import{BrowserWindow}from'./components/browser/BrowserWindow';import './index.css';
performance.mark('boot');createRoot(document.getElementById('root')).render(<BrowserWindow/>);`;
let state;
const server = await createServer({ configFile: false, cacheDir: path.join(scratch, 'vite'), root: path.join(root, 'apps/web'), resolve: { dedupe: ['react', 'react-dom'] }, esbuild: { jsx: 'automatic' }, logLevel: 'error',
  optimizeDeps: { noDiscovery: true, entries: [], include: ['react', 'react/jsx-runtime', 'react/jsx-dev-runtime', 'react-dom/client', 'lucide-react', 'react-dom'] }, server: { host: '127.0.0.1', port: 0, watch: null }, plugins: [tailwind(), { name: 'browser-speed-fixture',
    resolveId(id) { if (id === '/src/browser-speed-fixture.tsx') return fixturePath; },
    load(id) { if (id === fixturePath) return fixture; },
    configureServer(vite) { vite.middlewares.use(async (req, res, next) => {
      const url = new URL(req.url, 'http://localhost');
      if (url.pathname === '/') { res.setHeader('Content-Type', 'text/html'); return res.end('<!doctype html><meta charset="utf-8"><style>html,body,#root{height:100%;margin:0;background:#111}</style><div id="root"></div><script type="module" src="/src/browser-speed-fixture.tsx"></script>'); }
      if (url.pathname.startsWith('/synthetic/')) { res.setHeader('Content-Type', 'text/html'); return res.end('<meta charset="utf-8"><h1>' + url.pathname + '</h1>'); }
      if (url.pathname === '/api/browser/state') {
        res.setHeader('Content-Type', 'application/json');
        if (['PUT', 'PATCH'].includes(req.method)) { let text = ''; for await (const c of req) text += c; const body = JSON.parse(text); state = req.method === 'PUT' ? body : { ...state, ...body }; return res.end('{"ok":true}'); }
        return res.end(JSON.stringify(state));
      }
      if (url.pathname.startsWith('/api/')) { res.setHeader('Content-Type', 'application/json'); return res.end('{}'); }
      next();
    }); } }] });
let browser;
const result = {};
try {
  await server.listen(); const base = `http://127.0.0.1:${server.httpServer.address().port}`;
  const pin = (name) => ({ url: base + '/synthetic/' + name.toLowerCase().replaceAll(' ', '-'), title: name, pinned: true, origin: 'user' });
  // A realistic sidebar: 30 pins (Shaan: "there's like 30 pinned stuff"), six favourites, a few Today tabs.
  const names = Array.from({ length: 30 }, (_, i) => `Pinned ${i + 1}`);
  state = { migratedAt: 1, spaces: [{ id: 'personal', name: 'Personal', account: 'personal', pinVersion: 2, pins: names.map(pin) },
    { id: 'arc-favorites', name: 'Favourites', pinVersion: 2, pins: ['ChatGPT', 'YouTube', 'Mail', 'GitHub', 'Calendar', 'SISO'].map(pin) }],
    accounts: [{ id: 'personal', name: 'Personal', store: 'personal' }], today: { personal: ['Today one', 'Today two', 'Today three'].map((n) => ({ ...pin(n), at: Date.now() })) },
    setup: { closedAt: Date.now(), doneAt: Date.now() }, folders: [] };
  browser = await webkit.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.route('**/*', (r) => new URL(r.request().url()).origin === base ? r.continue() : r.abort());
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  const first = pin('Pinned 1');
  await page.goto(`${base}/?window=browser&tab=speed-1&url=${encodeURIComponent(first.url)}&title=Pinned%201`);
  await page.locator('.ab-browser__row').first().waitFor({ timeout: 30000 }).catch(async (e) => { console.log(JSON.stringify({ errors, html: (await page.content()).slice(0, 1500) })); throw e; });
  result.firstRenderMs = Math.round(await page.evaluate(() => performance.now() - performance.getEntriesByName('boot')[0].startTime));
  // Click a row and wait until it is the lit row and a frame has painted.
  const click = (title) => page.evaluate(async (title) => {
    const row = () => [...document.querySelectorAll('.ab-browser__sidebar button')].find((b) => [...b.querySelectorAll('span')].some((s) => s.textContent.trim() === title));
    if (!row()) throw Error('no row ' + title + ' among ' + [...document.querySelectorAll('.ab-browser__sidebar button')].map((b) => b.textContent.trim()).filter(Boolean).slice(0, 40).join(' | '));
    const t = performance.now(); row().click();
    await new Promise((done) => { const check = () => { if (document.querySelector('.ab-browser[aria-busy]')) window.__blank = (window.__blank || 0) + 1; row()?.getAttribute('aria-current') === 'page' ? done() : requestAnimationFrame(check); }; check(); });
    await new Promise((done) => requestAnimationFrame(() => setTimeout(done, 0)));
    return performance.now() - t;
  }, title);
  await click('Pinned 2'); await click('Pinned 1'); // both open as tabs now; from here every click is a warm switch
  await page.evaluate(() => { window.__blank = 0; });
  const warm = [];
  for (let i = 0; i < 12; i++) warm.push(await click(i % 2 ? 'Pinned 1' : 'Pinned 2'));
  warm.sort((a, b) => a - b);
  result.warmSwitchMedianMs = Math.round(warm[6]); result.warmSwitchWorstMs = Math.round(warm[11]);
  result.blankFramesIn12Switches = await page.evaluate(() => window.__blank || 0);
  result.errors = errors;
  result.ok = errors.length === 0;
} catch (e) { result.ok = false; result.error = String(e); process.exitCode = 1; }
finally {
  await browser?.close(); await server.close();
  if (process.env.AB_SPEED_OUT) await writeFile(process.env.AB_SPEED_OUT, JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result));
}
