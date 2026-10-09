// t-0570 item 7 (Shaan, 9 Oct ~02:30: "we got rid of the agent infrastructure and the side now ... So I can't see Health and
// these other guys"): HEALTH, EFFICIENCY and ESTATE are back at the bottom of the side nav, a face each, and a click opens the
// chat. t-0573 (9 Oct ~04:00, the third ask: "I don't see this efficiency agent"): each is a row with its name, its live dot and
// one line of its goal, all visible without hovering. t-0562: Agent Zero's helpers are a +N on its face. Synthetic full app, sealed API, WebSockets closed, never the live node.
//   heavy -- node services/node/test/nav-infra-ui.mjs
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { webkit } from './suite-runtime.mjs';
import { fixtureResponse } from '../../../tools/ab-qa-fixtures.mjs';

const root = path.resolve(import.meta.dirname, '../../..');
const { createServer } = createRequire(path.join(root, 'apps/web/package.json'))('vite');
const shots = path.join(root, 'ui-hub/t0573-infra-names');
mkdirSync(shots, { recursive: true });
const ROLES = ['HEALTH', 'EFFICIENCY', 'ESTATE'];
const agents = () => {
  const body = structuredClone(fixtureResponse('/api/agents', 'fixture')), zero = body.agents[0];
  zero.navHelpers = 2;
  for (const [i, name] of ROLES.entries()) body.agents.push({ ...zero, id: `infra-${i}`, key: `fixture/${name}`, name, title: name, zero: false, a0: false, host: false, chat: true, status: i === 1 ? 'working' : 'idle', hud: null, main: true, kind: 'owner', infrastructureRole: name, project: 'Agent Infrastructure' });
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
    const height = width < 700 ? 844 : 1000, errors = [];
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
    const infra = page.getByTestId('nav-infra');
    await infra.waitFor();
    assert.deepEqual(await infra.locator('[data-role]').evaluateAll(xs => xs.map(x => x.getAttribute('data-role'))), ROLES, 'the three, in order');
    assert.deepEqual(await infra.locator('[data-role]').evaluateAll(xs => xs.map(x => x.getAttribute('aria-label'))), ["Open HEALTH's chat: idle", "Open EFFICIENCY's chat: working", "Open ESTATE's chat: idle"]);
    for (const role of ROLES) assert.ok(await infra.locator(`[data-role="${role}"]`).isVisible(), `${role} visible`);
    // t-0573: the names, dots and goals are on screen, whole, without a hover.
    const names = infra.getByTestId('infra-name');
    assert.deepEqual(await names.allTextContents(), ROLES, 'each role by name');
    for (const n of await names.all()) assert.ok(await n.isVisible() && await n.evaluate(el => el.scrollWidth <= el.clientWidth + 1), 'a name is visible and not cut off');
    assert.deepEqual(await infra.getByTestId('infra-dot').evaluateAll(xs => xs.map(x => x.dataset.status)), ['idle', 'working', 'idle'], 'an honest dot each');
    assert.deepEqual(await infra.getByTestId('infra-goal').allTextContents(), ['Machines', 'The agent stack', 'Where everything lives'], 'one line of each goal');
    for (const g of await infra.getByTestId('infra-goal').all()) assert.ok(await g.isVisible(), 'a goal is visible');
    const plus = page.locator('.ab-zero__row [data-testid="nav-helpers"]');
    assert.equal(await plus.textContent(), '+2', "Agent Zero's two helpers are a +2 on its face");
    // t-0457 (AB-10): no Unsorted group; the fixture's stray projects used to sit in one.
    assert.equal(await page.getByTestId('nav-rows').getByText('Unsorted', { exact: true }).count(), 0, 'no Unsorted group');
    // The label is not cut off: the trio has the footer's first line to itself.
    const label = infra.locator('.siso-infra__label');
    assert.equal(await label.evaluate(el => el.scrollWidth <= el.clientWidth + 1), true, '"Agent Infrastructure" fits');
    const foot = page.locator('.siso-nav-footer').first(), b = await foot.boundingBox();
    const top = Math.max(0, b.y - 200);
    await page.screenshot({ path: path.join(shots, `after-${width}.png`), clip: { x: 0, y: top, width: Math.min(width, b.x + b.width + 24), height: Math.min(height - top, b.y + b.height - top + 12) } });
    await infra.locator('[data-role="ESTATE"]').click();
    await page.waitForFunction(() => [...document.querySelectorAll('[data-testid="chat-head"] *')].some(el => el.children.length === 0 && el.getClientRects().length && el.textContent?.trim() === 'ESTATE'), null, { timeout: 8000 });
    assert.deepEqual(errors, []);
    results.push({ width, roles: ROLES.length, opens: 'ESTATE chat' });
    await page.close();
  }
  console.log('PASS nav infra', JSON.stringify(results));
} finally { await browser?.close(); await server?.close(); }
