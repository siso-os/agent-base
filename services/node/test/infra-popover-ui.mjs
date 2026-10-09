// t-0464 (arc:popover, AB-MAP: "the Agent Infrastructure card in place is a text wall"): in Agent workspaces, the
// infrastructure popover gives each server one line: face, name and state, one line of what it is doing, the whole text on
// hover. Synthetic full app, sealed API, never the live node.  BEFORE=1 takes shots only (run against the old files).
//   heavy -- node services/node/test/infra-popover-ui.mjs
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { webkit } from './suite-runtime.mjs';
import { fixtureResponse } from '../../../tools/ab-qa-fixtures.mjs';

const root = path.resolve(import.meta.dirname, '../../..');
const { createServer } = createRequire(path.join(root, 'apps/web/package.json'))('vite');
const shots = path.join(root, 'ui-hub/t0464-infra-popover');
mkdirSync(shots, { recursive: true });
const BEFORE = !!process.env.BEFORE;
const ROLES = ['HEALTH', 'EFFICIENCY', 'ESTATE'];
const LINE = { HEALTH: 'Laptop load 4.1 of 8, 2.7 GB free, the deploy bar held twice tonight; mini fine', EFFICIENCY: 'Landing the transcript cache release and profiling the window GPU cost of the face engine', ESTATE: 'Moved three stray worktrees under _data/worktrees and archived two dead clones' };
const agents = () => {
  const body = structuredClone(fixtureResponse('/api/agents', 'fixture')), zero = body.agents[0];
  for (const [i, name] of ROLES.entries()) body.agents.push({ ...zero, id: `infra-${i}`, key: `fixture/${name}`, name, title: name, zero: false, a0: false, host: false, chat: true, status: i === 1 ? 'working' : 'idle', hud: null, main: true, kind: 'owner', infrastructureRole: name, infrastructureSummary: { line: LINE[name], ledger: 'swept 22:40, 0 findings open' }, project: 'Agent Infrastructure' });
  return body;
};
const org = () => ({ ...fixtureResponse('/api/org', 'fixture'), bottom: ROLES.map((name, i) => ({ name, domain: { HEALTH: 'Machines', EFFICIENCY: 'The agent stack', ESTATE: 'Where everything lives' }[name], icon: 'bot', state: 'live', working: i === 1 ? 1 : 0, plan: { checked: 0, total: 0, asked: 0 }, status: i === 1 ? 'working' : 'idle', ledger: null })) });

let server, browser;
const results = [];
try {
  server = await createServer({ root: path.join(root, 'apps/web'), configFile: path.join(root, 'apps/web/vite.config.ts'), logLevel: 'error',
    plugins: [{ name: 'sealed-api', configureServer(v) { v.middlewares.use((req, res, next) => { if (/^\/(api|chat|term)\b/.test(req.url ?? '')) { res.statusCode = 410; res.end('Fixture only'); return; } next(); }); } }],
    server: { host: '127.0.0.1', port: 0, strictPort: false, hmr: false, watch: { ignored: ['**/*'] } } });
  await server.listen();
  const base = `http://127.0.0.1:${server.httpServer.address().port}`;
  browser = await webkit.launch({ headless: true });
  for (const width of [1440, 390]) {
    const height = width < 700 ? 844 : 900, errors = [];
    const page = await browser.newPage({ viewport: { width, height }, reducedMotion: 'reduce' });
    page.on('pageerror', e => errors.push(e.message));
    await page.addInitScript(() => { window.EventSource = undefined; localStorage.setItem('agent-base:space', '"agents"'); });
    await page.routeWebSocket('**/*', socket => socket.close());
    await page.route('**/*', route => new URL(route.request().url()).origin === base ? route.fallback() : route.abort());
    await page.route(`${base}/api/**`, route => {
      const p = new URL(route.request().url()).pathname;
      const body = p === '/api/agents' ? agents() : p === '/api/org' ? org() : fixtureResponse(p, 'fixture');
      return body === undefined ? route.fulfill({ status: 404, json: {} }) : route.fulfill({ json: body });
    });
    await page.goto(base);
    await page.getByTestId('nav-infra').waitFor();
    await page.getByRole('button', { name: 'More views' }).click();
    await page.getByRole('menuitem', { name: 'Agent workspaces' }).click();
    await page.locator('.ip-trigger').click();
    const rows = page.locator('.ip-rows .ip-row');
    await rows.first().waitFor();
    await page.waitForTimeout(250);
    await page.screenshot({ path: path.join(shots, `${BEFORE ? 'before' : 'after'}-${width}.png`) });
    if (!BEFORE) {
      assert.equal(await rows.count(), 3, 'one row per server');
      for (const r of await rows.all()) {
        const box = await r.boundingBox();
        assert.ok(box.height <= 48, `a row is one line of text under its name, ${box.height}px`);
        const line = r.getByTestId('ip-line');
        assert.ok(await line.isVisible() && await line.evaluate(el => el.getClientRects().length === 1 && el.offsetHeight < 20), 'its line is one line');
        assert.match(await r.getAttribute('title'), /·/, 'the whole text is on hover');
      }
      assert.equal(await page.locator('.ip-observed, .ip-domain').count(), 0, 'no timestamp and domain lines');
    }
    assert.deepEqual(errors, []);
    results.push({ width, rows: await rows.count() });
    await page.close();
  }
  console.log(BEFORE ? 'before shots taken' : 'PASS infra popover', JSON.stringify(results));
} finally { await browser?.close(); await server?.close(); }
