// Cold start with and without the App Factory manifest (t-0599 step 7, siso-os.md §10, §11): App Factory is one URL
// manifest, so the app must start as fast with it as without it (median within 5%). Two real production builds (the
// "without" build has modules/app-factory/manifest.ts moved aside for the build and put back after), served from disk
// with the fixture API, opened cold in headless webkit, runs interleaved so drift hits both alike. The time is from
// navigation start to the first agent row drawn ([data-owner]), not DOMContentLoaded. Never a live agent: /api is
// answered here, /chat and /term are refused, every socket is closed, nothing outside the page's origin is fetched.
//   heavy -- node --experimental-strip-types --no-warnings tools/cold-start.mjs [--root <checkout>] [--runs 15]
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync } from 'node:fs';
import path from 'node:path';

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const root = path.resolve(arg('root', path.resolve(import.meta.dirname, '..'))), runs = Number(arg('runs', '15'));
const out = path.resolve(arg('out', '/tmp/siso-os-cold-start'));
mkdirSync(out, { recursive: true });
const { webkit } = createRequire(path.join(root, 'services/node/package.json'))('playwright');
const { build } = createRequire(path.join(root, 'apps/web/package.json'))('vite');
const { fixtureResponse } = await import(path.join(root, 'tools/ab-qa-fixtures.mjs'));
const { seedWorkspaces } = await import(path.join(root, 'services/node/src/workspace-registry.ts'));

const MANIFEST = path.join(root, 'apps/web/src/modules/app-factory/manifest.ts'), ASIDE = path.join(out, 'app-factory-manifest.ts');
const buildTo = (name) => build({ root: path.join(root, 'apps/web'), configFile: path.join(root, 'apps/web/vite.config.ts'), logLevel: 'error', build: { outDir: path.join(out, name), emptyOutDir: true } });
await buildTo('with');
renameSync(MANIFEST, ASIDE);
try { await buildTo('without'); } finally { renameSync(ASIDE, MANIFEST); }
// Proof the two builds differ by exactly that: only the "with" build carries App Factory's URL.
const hasFactory = (name) => readdirSync(path.join(out, name, 'assets')).some((f) => f.endsWith('.js') && readFileSync(path.join(out, name, 'assets', f), 'utf8').includes('127.0.0.1:8850/app'));
if (!hasFactory('with') || hasFactory('without')) { console.error(`FAIL: the builds don't differ by App Factory (with: ${hasFactory('with')}, without: ${hasFactory('without')})`); process.exit(1); }

const base0 = fixtureResponse('/api/agents', 'fixture');
const template = base0.agents.find((a) => !a.zero && a.status === 'working') ?? base0.agents.at(-1);
const owner = (name, workspace, project) => ({ ...template, id: `own-${name}`, key: `own-${name}`, pane: `p-${name}`, name, workspace, status: 'working', project, navOwner: true, row: 'live', zero: false, a0: false, main: false, kind: 'owner', navParentId: undefined, parentId: undefined });
const agents = [...base0.agents.filter((a) => a.zero || ['working', 'idle'].includes(a.status)), owner('OPERATOR-UI', 'halo', 'HALO'), owner('AGENT-BASE', 'agent-base', 'Agent Base')];
const api = (p) => p === '/api/agents' ? { ...base0, agents, workspaces: seedWorkspaces() } : p === '/api/workspace-registry' ? { workspaces: seedWorkspaces(), taskIdentities: {}, taskAliases: {} } : fixtureResponse(p, 'fixture');
const types = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2' };
const serve = (dir) => new Promise((resolve) => {
  const server = createServer((q, s) => {
    const p = new URL(q.url, 'http://x').pathname;
    if (p.startsWith('/api/')) { const body = api(p); s.statusCode = body === undefined ? 404 : 200; s.setHeader('content-type', 'application/json'); return s.end(JSON.stringify(body ?? {})); }
    if (/^\/(chat|term)\b/.test(p)) { s.statusCode = 410; return s.end(); }
    let file = path.join(dir, p === '/' ? 'index.html' : p);
    if (!file.startsWith(dir) || !existsSync(file) || statSync(file).isDirectory()) file = path.join(dir, 'index.html');
    s.setHeader('content-type', types[path.extname(file)] ?? 'application/octet-stream');
    s.setHeader('cache-control', 'no-store');
    s.end(readFileSync(file));
  });
  server.listen(0, '127.0.0.1', () => resolve({ server, base: `http://127.0.0.1:${server.address().port}` }));
});

const sites = { with: await serve(path.join(out, 'with')), without: await serve(path.join(out, 'without')) };
const browser = await webkit.launch({ headless: true });
const times = { with: [], without: [] }, errors = [];
const once = async (name) => {
  const { base } = sites[name];
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`${name}: ${String(e).slice(0, 160)}`));
  await page.addInitScript(() => {
    for (const [k, v] of Object.entries({ 'agent-base:space': '"agents"', 'agent-base:sidebar-open': 'true' })) localStorage.setItem(k, v);
    window.EventSource = undefined;
    // The first agent row, timed the moment it is in the DOM, then the frame it paints in.
    new MutationObserver((_, mo) => { if (document.querySelector('[data-owner]')) { mo.disconnect(); requestAnimationFrame(() => { window.__firstRow = performance.now(); }); } }).observe(document, { childList: true, subtree: true });
  });
  await page.route('**/*', (r) => (new URL(r.request().url()).origin === base ? r.fallback() : r.abort()));
  await page.routeWebSocket('**/*', (ws) => ws.close());
  await page.goto(base);
  const ms = await page.waitForFunction(() => window.__firstRow, null, { timeout: 30000 }).then((h) => h.jsonValue()).catch(() => null);
  await ctx.close();
  if (ms == null) throw new Error(`${name}: no agent row within 30 s (${errors.join(' | ')})`);
  times[name].push(Math.round(ms));
};
try {
  await once('with'); await once('without');   // warm the browser and the OS file cache; not counted
  times.with.length = 0; times.without.length = 0;
  for (let i = 0; i < runs; i++) for (const name of i % 2 ? ['without', 'with'] : ['with', 'without']) await once(name);
} finally { await browser.close(); for (const { server } of Object.values(sites)) server.close(); }

const median = (xs) => { const s = [...xs].sort((a, b) => a - b), m = s.length >> 1; return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2); };
const result = { runs, with: { median: median(times.with), all: times.with }, without: { median: median(times.without), all: times.without } };
result.deltaPct = Math.round(((result.with.median - result.without.median) / result.without.median) * 1000) / 10;
result.pageErrors = errors.length;
console.log(JSON.stringify(result));
if (result.deltaPct > 5) { console.error(`FAIL: with App Factory the first agent row draws ${result.deltaPct}% later than without (limit 5%)`); process.exit(1); }
console.log(`PASS cold start: first agent row at ${result.with.median} ms with App Factory, ${result.without.median} ms without (${result.deltaPct}%, limit 5%), ${runs} interleaved cold runs each`);
