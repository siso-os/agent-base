// t-0563: the side nav v4 Shaan approved (8 Oct 23:52). Sub-projects inside SISO Agency, folder rows, no state words, 2 x 2
// stacks, one SVG line layer that touches both ends, an owner card on every name (Fahmy's), Playground folded.
// Synthetic full app, sealed API; run with heavy. Never the live node.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import { webkit } from './suite-runtime.mjs';
import { fixtureResponse } from '../../../tools/ab-qa-fixtures.mjs';
import { seedWorkspaces } from '../src/workspace-registry.ts';

const root = path.resolve(import.meta.dirname, '../../..');
const { createServer } = createRequire(path.join(root, 'apps/web/package.json'))('vite');
const before = process.argv.includes('--before');
const base0 = fixtureResponse('/api/agents', 'fixture');
const template = base0.agents.find(a => !a.zero) ?? base0.agents.at(-1);
const owner = (name, workspace, status, project = 'SISO Agency') => ({ ...template, id: `own-${name}`, key: `own-${name}`, pane: `p-${name}`, name, workspace, status, project, navOwner: true, row: 'live', zero: false, main: false, kind: 'owner', navParentId: undefined });
const agents = [
  ...base0.agents.filter(a => a.zero),
  owner('STREAMING', 'halo', 'idle', 'HALO'), owner('OPERATOR-UI', 'halo', 'idle', 'HALO'),
  owner('SISO-LANDING', 'siso-agency', 'working'), owner('SISO-AGENCY', 'siso-agency', 'idle'), owner('IMAGE-BRAIN', 'siso-agency', 'idle'),
  owner('AGENT-BASE', 'agent-base', 'working', 'Agent Base'),
  owner('FAHMY', 'clients', 'idle', 'Clients'), owner('KIKAS', 'clients', 'idle', 'Clients'),
  owner('RESEARCH', 'research', 'working', 'Great Library of SISO'),
  owner('BROWSER', null, 'idle', 'Somewhere'), owner('MODEL-APP', 'unassigned', 'idle', 'Somewhere'), owner('STRAY', 'no-such-place', 'idle', 'Somewhere'),
];

let server, browser;
try {
  server = await createServer({ root: path.join(root, 'apps/web'), configFile: path.join(root, 'apps/web/vite.config.ts'), logLevel: 'error',
    plugins: [{ name: 'sealed-api', configureServer(v) { v.middlewares.use((req, res, next) => { if (/^\/(api|chat|term)\b/.test(req.url ?? '')) { res.statusCode = 410; res.end('Fixture only'); return; } next(); }); } }],
    server: { host: '127.0.0.1', port: 0, strictPort: false, hmr: false, watch: { ignored: ['**/*'] } } });
  await server.listen();
  const base = `http://127.0.0.1:${server.httpServer.address().port}`;
  browser = await webkit.launch({ headless: true });
  const results = [];
  for (const width of [1440, 390]) {
    const errors = [];
    const page = await browser.newPage({ viewport: { width, height: 1000 }, reducedMotion: 'reduce' });
    page.on('pageerror', e => errors.push(e.message));
    await page.addInitScript(() => { localStorage.setItem('agent-base:space', '"agents"'); localStorage.setItem('agent-base:sidebar-open', 'true'); window.EventSource = undefined; });
    await page.routeWebSocket('**/*', socket => socket.close());
    await page.route('**/*', route => new URL(route.request().url()).origin === base ? route.fallback() : route.abort());
    await page.route(`${base}/api/**`, route => {
      const p = new URL(route.request().url()).pathname;
      if (p === '/api/agents') return route.fulfill({ json: { ...base0, agents, workspaces: seedWorkspaces() } });
      if (p === '/api/fleet-board') { const f = fixtureResponse(p, 'fixture') ?? {}; const row = id => ({ ...(f.groups?.[0]?.rows?.[0] ?? {}), id, status: 'working', crewParentId: undefined });
        return route.fulfill({ json: { ...f, groups: [{ ...(f.groups?.[0] ?? {}), id: 'siso-agency', rows: [row('own-SISO-LANDING')] }, { ...(f.groups?.[0] ?? {}), id: 'agent-base', rows: [row('own-AGENT-BASE')] }, { ...(f.groups?.[0] ?? {}), id: 'research', rows: [row('own-RESEARCH')] }] } }); }
      if (p === '/api/workspace-registry') return route.fulfill({ json: { workspaces: seedWorkspaces(), taskIdentities: {}, taskAliases: {} } });
      const body = fixtureResponse(p, 'fixture');
      return body === undefined ? route.fulfill({ status: 404, json: {} }) : route.fulfill({ json: body });
    });
    await page.goto(base);
    const nav = page.getByTestId('nav-workspaces'); await nav.waitFor();
    await page.locator('[data-workspace="siso-agency"] .ab-workspace__kids [data-workspace="agent-base"]').waitFor({ timeout: 8000 }).catch(async e => { console.error('DEBUG', await nav.evaluate(n => n.outerHTML.replace(/<svg[\s\S]*?<\/svg>/g, '').slice(0, 1500))); throw e; });
    if (before) { await page.screenshot({ path: path.join(root, `ui-hub/side-nav/v4-before-${width}.png`) }); results.push({ width }); await page.close(); continue; }

    // Shape: top-level order, sub-projects inside SISO Agency, folders.
    const top = await nav.evaluate(n => [...n.children].map(w => w.dataset.workspace));
    assert.deepEqual(top, ['halo', 'siso-agency', 'clients', 'research', 'playground']);
    assert.deepEqual(await page.locator('[data-workspace="siso-agency"] > .ab-workspace__kids > .ab-workspace').evaluateAll(ws => ws.map(w => w.dataset.workspace)), ['agent-base', 'ui-hub']);
    await page.locator('[data-workspace="research"] [data-owner="own-RESEARCH"]').waitFor();
    // No state words; the green count includes the sub-projects (SISO-LANDING + AGENT-BASE).
    assert.equal(await nav.getByText(/^(working|idle)$/i).count(), 0, 'no state words');
    assert.equal((await page.locator('[data-workspace="siso-agency"] > .ab-workspace__card .ab-workspace__working').textContent()).trim(), '2');
    // Stacks of three or more are 2 x 2.
    assert.equal(await page.locator('[data-workspace="playground"] .ab-workspace__kids').count(), 0, 'Playground starts folded');
    await page.getByRole('button', { name: 'Toggle Playground owners' }).click();
    const stack = page.locator('[data-workspace="playground"] .ab-workspace__idle-faces');
    assert.equal(await stack.evaluate(s => s.classList.contains('is-grid') && getComputedStyle(s).display === 'grid'), true);
    assert.equal((await page.locator('[data-workspace="playground"] .ab-workspace__idle-names').textContent()).replace(/\s/g, ''), 'BROWSER,MODEL-APP,STRAY');

    // Lines: one SVG layer; every child's elbow starts on its parent's bottom edge and ends on its own left edge.
    await page.waitForTimeout(200);
    const lines = await page.evaluate(() => {
      const svg = document.querySelector('[data-testid="nav-tree-lines"]'), R = svg.getBoundingClientRect();
      const ends = [...svg.querySelectorAll('path')].map(p => { const n = p.getAttribute('d').match(/-?\d+(\.\d+)?/g).map(Number); return { x0: n[0], y0: n[1], x1: n.at(-1) }; });
      const ids = new Map([...document.querySelectorAll('[data-tree-id]')].map(e => [e.dataset.treeId, e.getBoundingClientRect()]));
      const misses = [];
      for (const c of document.querySelectorAll('[data-tree-parent]')) {
        const C = c.getBoundingClientRect(), P = ids.get(c.dataset.treeParent); if (!P || !C.width) continue;
        const ok = ends.some(e => Math.abs(e.x1 - (C.left - R.left)) < 0.6 && Math.abs(e.y0 - (P.bottom - R.top)) < 0.6 && Math.abs(e.x0 - ((P.left + P.right) / 2 - R.left)) < 0.6);
        if (!ok) misses.push(c.closest('[data-workspace]')?.dataset.workspace + ':' + (c.dataset.treeId ?? c.className));
      }
      return { paths: ends.length, misses, oldConnectors: getComputedStyle(document.querySelector('.ab-workspace'), '::before').content };
    });
    assert.deepEqual(lines.misses, [], 'every line touches its parent and child');
    assert.ok(lines.paths >= 12, `drew ${lines.paths} lines`);
    assert.ok(lines.oldConnectors === 'none' || lines.oldConnectors === 'normal', 'old ::before connectors are gone');

    // Agent Zero starts the tree: no "N need you"; its chat switcher only on hover.
    assert.equal(await page.getByTestId('zero-needs').count(), 0);
    assert.equal(await page.getByTestId('zero-switch').evaluate(b => getComputedStyle(b).opacity), '0');
    await page.screenshot({ path: path.join(root, `ui-hub/side-nav/v4-after-${width}.png`) });

    // Fahmy's card: hovering his name in Clients opens his owner card.
    if (width > 600) {
      await page.locator('[data-workspace="clients"] [data-owner="own-FAHMY"]').hover();
      await page.locator('[role="dialog"], .siso-hovercard').filter({ hasText: 'FAHMY' }).first().waitFor();
      await page.screenshot({ path: path.join(root, `ui-hub/side-nav/v4-fahmy-card-${width}.png`) });
    }
    assert.deepEqual(errors, []);
    results.push({ width, top, lines: lines.paths });
    await page.close();
  }
  console.log('PASS side nav v4', JSON.stringify(results));
} finally { await browser?.close(); await server?.close(); }
