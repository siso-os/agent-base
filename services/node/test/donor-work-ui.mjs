import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { readFile, writeFile, mkdir, mkdtemp } from 'node:fs/promises';
import { suitePort, webkit } from './suite-runtime.mjs';
import { createHash } from 'node:crypto';
import { createServer } from '../../../apps/web/node_modules/vite/dist/node/index.js';
import react from '../../../apps/web/node_modules/@vitejs/plugin-react/dist/index.js';
import { donorFixture } from './donor-work-fixture.mjs';
import { donorWorkRoute } from '../src/routes/donor-work.route.ts';
import { dispatchRoute } from '../src/routes/registry.ts';

const repo = path.resolve(import.meta.dirname, '../../..');
// --out retains evidence in a caller-owned directory; normal suite runs never overwrite prior receipts.
const outFlag = process.argv.indexOf('--out');
if (outFlag !== -1 && (!process.argv[outFlag + 1] || process.argv[outFlag + 1].startsWith('--'))) throw Error('--out requires an output directory');
const out = outFlag === -1 ? await mkdtemp(path.join(os.tmpdir(), '.siso-ephemeral-donor-work-ui-output-')) : path.resolve(process.argv[outFlag + 1]);
await mkdir(out, { recursive: true });
console.log(`Evidence: ${out}`);
const port = await suitePort();
const f = await donorFixture(), checks = [], errors = [], requests = [], sockets = [];
const files = ['services/node/src/donor-work.ts', 'services/node/src/routes/donor-work.route.ts', 'apps/web/src/components/DonorWork.tsx', 'apps/web/src/components/DonorWork.css'];
const hashes = async () => Object.fromEntries(await Promise.all(files.map(async name => [name, createHash('sha256').update(await readFile(path.join(repo, name))).digest('hex')])));
const before = await hashes();
let browser, server, page;
const record = (name, details = {}) => { checks.push({ name, ...details }); console.log(`PASS ${name}`); };
try {
  await writeFile(path.join(f.root, 'index.html'), '<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="root"></div><script type="module" src="/entry.tsx"></script></body></html>');
  await writeFile(path.join(f.root, 'entry.tsx'), `
    import React, {useEffect,useState} from 'react'; import {createRoot} from 'react-dom/client';
    import {DonorWork} from ${JSON.stringify(path.join(repo, 'apps/web/src/components/DonorWork.tsx'))};
    document.body.style.cssText='margin:0;background:#14161c;color:#e5e7eb;font-family:system-ui';
    window.__opened=[]; window.__ready=0;
    function Fixture(){const[data,setData]=useState(null),[error,setError]=useState(null);
      const read=()=>fetch('/api/donor/work').then(r=>r.json()).then(d=>{setData(d);setError(null);window.__ready++});
      useEffect(()=>{void read()},[]);
      return <><nav aria-label="Synthetic fixture controls" style={{padding:10}}><button onClick={read}>Refresh fixture</button><button onClick={()=>setError('synthetic transport unavailable')}>Fail transport</button></nav>
        <DonorWork data={data} error={error} onOpenProject={id=>window.__opened.push({kind:'project',id})} onOpenTask={id=>window.__opened.push({kind:'task',id})}/></>}
    createRoot(document.getElementById('root')).render(<Fixture/>);
  `);
  const routes = [donorWorkRoute(f.reader)];
  server = await createServer({
    configFile: false, root: f.root, cacheDir: path.join(f.root, 'vite'),
    plugins: [react(), { name: 'synthetic-donor-work-api', configureServer(vite) {
      vite.middlewares.use(async (req, res, next) => {
        const url = new URL(req.url, 'http://fixture');
        if (!url.pathname.startsWith('/api/')) return next();
        requests.push({ method: req.method, path: url.pathname });
        if (await dispatchRoute(routes, req, res, url.pathname)) return;
        res.writeHead(403); res.end('No synthetic source');
      });
    } }],
    resolve: { alias: { react: path.join(repo, 'apps/web/node_modules/react'), 'react-dom': path.join(repo, 'apps/web/node_modules/react-dom') }, dedupe: ['react', 'react-dom'] },
    optimizeDeps: { entries: ['index.html'] },
    server: { host: '127.0.0.1', port, strictPort: true, hmr: false, fs: { allow: [repo, f.root] } },
  });
  await server.listen();
  const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
  browser = await webkit.launch({ headless: true });
  for (const width of [1440, 390]) {
    page = await browser.newPage({ viewport: { width, height: 1000 } });
    page.on('pageerror', error => errors.push(error.message)); page.on('websocket', socket => sockets.push(socket.url()));
    await page.route('**/*', route => route.request().url().startsWith(origin + '/') ? route.continue() : route.abort());
    await page.goto(origin); await page.waitForFunction(() => window.__ready === 1);
    const alpha = page.locator('[data-donor-project="alpha"]'), beta = page.locator('[data-donor-project="beta"]');
    assert.equal(await page.getByText('Same project title', { exact: true }).count(), 2);
    await alpha.getByRole('button', { name: 'Open project', exact: true }).click();
    await alpha.locator('[data-donor-task="shared"]').getByRole('button', { name: 'Open task' }).click();
    await beta.locator('[data-donor-task="shared"]').getByRole('button', { name: 'Open task' }).click();
    assert.deepEqual(await page.evaluate(() => window.__opened), [{ kind: 'project', id: 'project-A' }, { kind: 'task', id: 't-alpha' }, { kind: 'task', id: 't-beta' }]);
    record(`exact-destination-navigation-${width}`);
    assert.equal(await alpha.locator('[data-donor-task="unmapped"] button').isDisabled(), true);
    await alpha.getByText('Original workspace: doing · Owner: donor-owner', { exact: true }).waitFor();
    await alpha.getByText('Linked · Agent Base: live', { exact: true }).waitFor();
    assert.equal(await alpha.locator('[data-donor-task="complete"]').count(), 1);
    record(`unmapped-and-distinct-state-owner-${width}`);
    await alpha.locator('button[aria-expanded]').click();
    assert.equal(await alpha.locator('.ab-task-fold').getAttribute('aria-hidden'), 'true');
    await alpha.locator('button[aria-expanded]').click();
    await alpha.locator('.ab-task-fold').evaluate(async el => {
      getComputedStyle(el).opacity;
      await Promise.all(el.getAnimations({ subtree: true }).map(animation => animation.finished.catch(() => {})));
    });
    await alpha.getByText('Source and links', { exact: true }).click();
    await alpha.getByText('shared → t-alpha', { exact: true }).waitFor();
    assert.ok(await alpha.evaluate(el => {
      const fold = el.querySelector('.ab-task-fold'), body = el.querySelector('.ab-donor-work__body');
      const top = fold.getBoundingClientRect().top, bottom = fold.getBoundingClientRect().bottom;
      return [...body.querySelectorAll('p, li strong')].every(child => child.getBoundingClientRect().top >= top && child.getBoundingClientRect().bottom <= bottom + 1);
    }));
    record(`existing-task-fold-and-provenance-${width}`);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.screenshot({ path: path.join(out, `donor-work-${width}.png`), fullPage: true });
    record(`readable-without-horizontal-overflow-${width}`);
    await page.close();
  }
  page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => route.request().url().startsWith(origin + '/') ? route.continue() : route.abort());
  await page.goto(origin); await page.waitForFunction(() => window.__ready === 1);
  const refresh = async () => { const count = await page.evaluate(() => window.__ready); await page.getByRole('button', { name: 'Refresh fixture' }).click(); await page.waitForFunction(n => window.__ready === n + 1, count); };
  f.targets = { projects: null, tasks: null }; await refresh();
  assert.equal(await page.locator('.ab-donor-work button:not(:disabled)').filter({ hasText: /^Open / }).count(), 0);
  assert.ok((await page.locator('.ab-donor-work').innerText()).includes('Destination unavailable'));
  record('canonical-outage-disables-navigation');
  f.snapshot.capturedAt = new Date(f.now - 2 * 86_400_000).toISOString(); await f.save(); await refresh();
  assert.ok((await page.locator('.ab-donor-work').innerText()).includes('Older snapshot'));
  record('capture-time-staleness-visible');
  await page.getByRole('button', { name: 'Fail transport' }).click();
  await page.getByText('Work could not be refreshed. Destination links are paused.').waitFor();
  assert.equal(await page.locator('[data-donor-project]').count(), 0);
  record('failed-refresh-removes-old-navigation');
  await writeFile(f.configFile, 'invalid synthetic mapping'); await refresh();
  await page.getByText('Work mapping is unavailable or invalid.').waitFor();
  assert.equal(await page.locator('[data-donor-project]').count(), 0);
  await page.screenshot({ path: path.join(out, 'donor-work-unavailable-390.png'), fullPage: true });
  record('revoked-or-invalid-mapping-removes-source-rows');
  assert.deepEqual(errors, []);
  // Vite may still inject its development client with hmr:false. Only its exact
  // origin/root socket is permitted; no chat, provider, agent or remote socket.
  assert.ok(sockets.every(value => { const url = new URL(value); return url.host === new URL(origin).host && url.pathname === '/'; }));
  assert.ok(requests.every(r => r.method === 'GET' && r.path === '/api/donor/work'));
  const after = await hashes(); assert.deepEqual(after, before);
  record('GET-only-source-no-chat-sockets-source-unchanged');
  await writeFile(path.join(out, 'donor-work-ui.json'), JSON.stringify({ at: new Date().toISOString(), result: 'PASS', checks, errors, requests, sockets: sockets.map(value => ({ kind: 'vite-fixture-development-client', path: new URL(value).pathname })), sourceHashes: after, screenshots: ['donor-work-1440.png', 'donor-work-390.png', 'donor-work-unavailable-390.png'], scope: 'Real DonorWork component, reader and HTTP route; synthetic records and callback navigation only. Parent App mount and installed/live mapping remain unverified.', cleanup: 'Owned browser/server and temporary fixture closed in finally.' }, null, 2) + '\n');
} catch (error) {
  if (page && !page.isClosed()) await page.screenshot({ path: path.join(out, 'donor-work-ui-failure.png'), fullPage: true });
  await writeFile(path.join(out, 'donor-work-ui.json'), JSON.stringify({ result: 'FAIL', error: String(error), checks, errors, requests }, null, 2) + '\n');
  throw error;
} finally { await browser?.close(); await server?.close(); await f.close(); }
