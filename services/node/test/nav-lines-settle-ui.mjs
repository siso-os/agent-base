// t-0586: the side nav's tree lines draw once and then stay still. Their redraw used to count as a change to the nav and
// schedule the next one: every frame, forever, each one measuring every row. Sealed vite, fixture API; never a live agent.
//   heavy -- node --experimental-strip-types --no-warnings services/node/test/nav-lines-settle-ui.mjs
import { createRequire } from 'node:module';
import path from 'node:path';
import { webkit } from './suite-runtime.mjs';
import { fixtureResponse } from '../../../tools/ab-qa-fixtures.mjs';
import { seedWorkspaces } from '../src/workspace-registry.ts';

const root = path.resolve(import.meta.dirname, '../../..');
const { createServer } = createRequire(path.join(root, 'apps/web/package.json'))('vite');
// Owners across projects (side-nav-v4-ui's fixture), so the nav has a tree to draw.
const base0 = fixtureResponse('/api/agents', 'fixture');
const template = base0.agents.find(a => !a.zero) ?? base0.agents.at(-1);
const owner = (name, workspace, status, project = 'SISO Agency') => ({ ...template, id: `own-${name}`, key: `own-${name}`, pane: `p-${name}`, name, workspace, status, project, navOwner: true, row: 'live', zero: false, main: false, kind: 'owner', navParentId: undefined });
const agents = [...base0.agents.filter(a => a.zero), owner('STREAMING', 'halo', 'idle', 'HALO'), owner('OPERATOR-UI', 'halo', 'idle', 'HALO'),
  owner('SISO-LANDING', 'siso-agency', 'working'), owner('IMAGE-BRAIN', 'siso-agency', 'idle'), owner('AGENT-BASE', 'agent-base', 'working', 'Agent Base')];
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
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
  await page.addInitScript(() => { localStorage.setItem('agent-base:space', '"agents"'); localStorage.setItem('agent-base:sidebar-open', 'true'); window.EventSource = undefined; });
  await page.route('**/*', route => new URL(route.request().url()).origin === base ? route.fallback() : route.abort());
  await page.route(`${base}/api/**`, route => {
    const p = new URL(route.request().url()).pathname;
    if (p === '/api/agents') return route.fulfill({ json: { ...base0, agents, workspaces: seedWorkspaces() } });
    if (p === '/api/workspace-registry') return route.fulfill({ json: { workspaces: seedWorkspaces(), taskIdentities: {}, taskAliases: {} } });
    const body = fixtureResponse(p, 'fixture');
    return body === undefined ? route.fulfill({ status: 404, json: {} }) : route.fulfill({ json: body });
  });
  await page.routeWebSocket('**/*', ws => ws.close());
  await page.goto(base);
  const lines = page.locator('[data-testid="nav-tree-lines"]').first();
  await lines.waitFor({ state: 'attached', timeout: 15000 });
  await page.waitForFunction(() => Number(document.querySelector('[data-testid="nav-tree-lines"]')?.dataset.lines ?? 0) > 0, null, { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(1500);
  const drawn = Number(await lines.getAttribute('data-lines'));
  check('the nav draws its tree lines', drawn > 0, { lines: drawn });
  const redraws = await page.evaluate(async () => {
    const svg = document.querySelector('[data-testid="nav-tree-lines"]'); let n = 0;
    const ob = new MutationObserver(list => { n += list.length; }); ob.observe(svg, { childList: true, attributes: true, subtree: true });
    await new Promise(r => setTimeout(r, 2000)); ob.disconnect(); return n;
  });
  check('settled lines do not redraw while nothing changes', redraws === 0, { redrawsIn2s: redraws });
  // A real change to the rows still redraws them: one row's anchor leaves, so its lines go.
  const after = await page.evaluate(async () => {
    const svg = document.querySelector('[data-testid="nav-tree-lines"]'), tree = svg.parentElement;
    tree.querySelector('[data-tree-parent]').remove();
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    return Number(svg.dataset.lines);
  });
  check('a change to the rows still redraws them', after > 0 && after < drawn, { before: drawn, after });
} catch (error) {
  check('nav-lines-settle suite completes', false, { error: String(error?.stack ?? error).slice(0, 600) });
} finally {
  await browser?.close();
  await server?.close();
}
console.log(JSON.stringify({ passed: results.filter(Boolean).length, of: results.length }));
process.exitCode = results.length && results.every(Boolean) ? 0 : 1;
