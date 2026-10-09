#!/usr/bin/env node
// t-0534: the window's idle CPU. Runs the sealed app (synthetic fixtures, a fleet of N agents, some working) in headless
// WebKit, lets it settle, then measures the browser's own CPU-seconds over a window under each condition:
//   asis       the app as shipped
//   noanim     + every CSS animation and transition off
//   hidden     + the page reports itself hidden (what a covered window does)
//   reduced    prefers-reduced-motion: the face engine's frame loop stops (t-0571 uses it to split faces from CSS)
// Prints one JSON line: {agents, seconds, results:[{condition, cpuPct}]}. Never the live node. Run with heavy.
// --attribute adds a run that wraps requestAnimationFrame/setInterval/setTimeout and totals callback time by the
// source line that registered it (top 12).
// Usage: node tools/ab-idle-cpu.mjs [--agents=40] [--seconds=30] [--width=1440] [--attribute] [--only=asis,reduced]
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { webkit } from '../services/node/test/suite-runtime.mjs';
import { fixtureResponse } from './ab-qa-fixtures.mjs';

const arg = (k, d) => Number(process.argv.find(a => a.startsWith(`--${k}=`))?.split('=')[1] ?? d);
const ATTRIBUTE = process.argv.includes('--attribute');
const N = arg('agents', 40), SECONDS = arg('seconds', 30), WIDTH = arg('width', 1440);
const root = path.resolve(import.meta.dirname, '..');
const { createServer } = createRequire(path.join(root, 'apps/web/package.json'))('vite');

// CPU-seconds of every process whose command line names Playwright's WebKit build.
const cpuSeconds = () => execFileSync('ps', ['-A', '-o', 'time=,command='], { encoding: 'utf8' }).split('\n')
  .filter(l => /ms-playwright\/webkit/.test(l)).reduce((sum, l) => {
    const [t] = l.trim().split(/\s+/, 1); const parts = t.split(/[:.]/).map(Number);
    // ps time: [[dd-]hh:]mm:ss.cc
    const [cc, ss, mm, hh = 0] = parts.reverse(); return sum + hh * 3600 + mm * 60 + ss + cc / 100;
  }, 0);

const agentsBody = () => {
  const base = fixtureResponse('/api/agents', 'fixture');
  const template = base.agents.at(-1);
  const agents = [...base.agents, ...Array.from({ length: N }, (_, i) => ({ ...template, id: `fleet-${i}`, key: `fleet-${i}`, name: `FLEET-${i}`, pane: `p-${i}`, status: i % 3 === 0 ? 'working' : 'idle', project: 'agent-base' }))];
  return { ...base, agents };
};

let server, browser;
try {
  server = await createServer({ root: path.join(root, 'apps/web'), configFile: path.join(root, 'apps/web/vite.config.ts'), logLevel: 'error',
    plugins: [{ name: 'sealed-api', configureServer(v) { v.middlewares.use((req, res, next) => { if (/^\/(api|chat|term)\b/.test(req.url ?? '')) { res.statusCode = 410; res.end('Fixture only'); return; } next(); }); } }],
    server: { host: '127.0.0.1', port: 0, strictPort: false, hmr: false, watch: { ignored: ['**/*'] } } });
  await server.listen();
  const base = `http://127.0.0.1:${server.httpServer.address().port}`;
  browser = await webkit.launch({ headless: true });
  const results = [];
  const only = process.argv.find(a => a.startsWith('--only='))?.slice(7).split(',');
  for (const condition of ATTRIBUTE ? ['attribute'] : only ?? ['asis', 'noanim', 'hidden']) {
    const page = await browser.newPage({ viewport: { width: WIDTH, height: 900 }, ...(condition === 'reduced' ? { reducedMotion: 'reduce' } : {}) });
    if (condition === 'attribute') await page.addInitScript(() => { window.__abAttribute = true; });
    await page.addInitScript(hidden => {
      localStorage.setItem('agent-base:space', '"agents"');
      if (hidden) { Object.defineProperty(document, 'hidden', { get: () => true }); Object.defineProperty(document, 'visibilityState', { get: () => 'hidden' }); }
      if (window.__abAttribute) {
        const cost = window.__abCost = new Map();
        const site = () => (new Error().stack ?? '').split('\n').slice(2).find(l => /\/src\/|\/packages\//.test(l))?.replace(/^.*?(\/(src|packages)\/)/, '$1').replace(/\?[^:]*/, '') ?? 'unknown';
        const wrap = (fn, where, kind) => function (...args) { const t = performance.now(); try { return fn.apply(this, args); } finally { const k = `${kind} ${where}`, c = cost.get(k) ?? { ms: 0, n: 0 }; c.ms += performance.now() - t; c.n++; cost.set(k, c); } };
        const raf = window.requestAnimationFrame.bind(window), si = window.setInterval.bind(window), st = window.setTimeout.bind(window);
        window.requestAnimationFrame = fn => raf(wrap(fn, site(), 'raf'));
        window.setInterval = (fn, ms, ...a) => typeof fn === 'function' ? si(wrap(fn, site(), `interval${ms ?? 0}`), ms, ...a) : si(fn, ms, ...a);
        window.setTimeout = (fn, ms, ...a) => typeof fn === 'function' ? st(wrap(fn, site(), 'timeout'), ms, ...a) : st(fn, ms, ...a);
      }
    }, condition === 'hidden');
    await page.routeWebSocket('**/*', socket => socket.close());
    await page.route('**/*', route => new URL(route.request().url()).origin === base ? route.fallback() : route.abort());
    await page.route(`${base}/api/**`, route => {
      const req = route.request(), p = new URL(req.url()).pathname;
      if (req.headers().accept?.includes('text/event-stream')) return route.fulfill({ contentType: 'text/event-stream', body: ': synthetic\n\n' });
      const body = p === '/api/agents' ? agentsBody() : fixtureResponse(p, 'fixture');
      return body === undefined ? route.fulfill({ status: 404, json: {} }) : route.fulfill({ json: body });
    });
    await page.goto(base);
    if (condition === 'noanim' || condition === 'hidden') await page.addStyleTag({ content: '*,*::before,*::after{animation:none!important;transition:none!important}' });
    await page.waitForTimeout(15000); // settle: first reads, layout, fonts
    const a = cpuSeconds(), t0 = Date.now();
    await page.waitForTimeout(SECONDS * 1000);
    const used = cpuSeconds() - a, wall = (Date.now() - t0) / 1000;
    // Liveness: faces whose gaze or blink actually changed over 4 s (a "fix" that freezes them must not pass as a win).
    const moving = condition === 'hidden' ? undefined : await page.evaluate(async () => {
      const faces = [...document.querySelectorAll('[data-motion="on"]')], read = () => faces.map(f => { const g = f.querySelector('.pf-gaze') ?? f; return g.style.transform + (f.querySelector('.pf-eye')?.style.getPropertyValue('--blink') ?? '') + ['--gx', '--gy', '--blink'].map(k => g.style.getPropertyValue(k) || f.style.getPropertyValue(k)).join(); });
      const first = read(), changed = new Set();
      for (let i = 0; i < 8; i++) { await new Promise(r => setTimeout(r, 500)); read().forEach((v, j) => { if (v !== first[j]) changed.add(j); }); }
      return { faces: faces.length, moved: changed.size };
    });
    const top = condition === 'attribute' ? await page.evaluate(() => [...window.__abCost].sort((x, y) => y[1].ms - x[1].ms).slice(0, 12).map(([k, v]) => ({ site: k, ms: Math.round(v.ms), n: v.n }))) : undefined;
    results.push({ condition, cpuPct: Math.round(1000 * used / wall) / 10, ...(moving ? { moving } : {}), ...(top ? { top } : {}) });
    if (top) await page.evaluate(() => window.__abCost.clear());
    await page.close();
  }
  console.log(JSON.stringify({ agents: N, seconds: SECONDS, width: WIDTH, results }));
} finally { await browser?.close(); await server?.close(); }
