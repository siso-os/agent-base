// t-0584: a project's own owners sit above its sub-projects in the side nav (Shaan, 9 Oct ~23:20: "Why does AgentBase own
// the SISO landing?": SISO-LANDING drew under Agent Base's rows). Sealed vite, fixture API; never a live agent.
//   heavy -- node --experimental-strip-types --no-warnings services/node/test/nav-owners-first-ui.mjs
import { createRequire } from 'node:module';
import path from 'node:path';
import { webkit } from './suite-runtime.mjs';
import { fixtureResponse } from '../../../tools/ab-qa-fixtures.mjs';
import { seedWorkspaces } from '../src/workspace-registry.ts';

const root = path.resolve(import.meta.dirname, '../../..');
const { createServer } = createRequire(path.join(root, 'apps/web/package.json'))('vite');
// Owners across projects (side-nav-v4-ui's fixture), with SISO Agency holding its own owners and the Agent Base and UI Hub sub-projects.
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
  const agency = page.locator('[data-workspace="siso-agency"]').first();
  await agency.waitFor({ timeout: 15000 });
  const order = await agency.evaluate(el => {
    const kids = el.querySelector(':scope > .ab-workspace__kids');
    return [...kids.children].map(c => c.matches('.ab-workspace') ? `project:${c.dataset.workspace}` : c.querySelector('[data-owner]') ? `owners:${[...c.querySelectorAll('[data-owner]')].map(b => b.textContent.trim()).join('|')}` : c.matches('[data-owner]') ? `owner:${c.textContent.trim()}` : 'other');
  });
  const firstProject = order.findIndex(x => x.startsWith('project:')), landing = order.findIndex(x => x.includes('SISO-LANDING'));
  check('SISO-LANDING sits under the SISO Agency header, above its sub-projects', landing >= 0 && firstProject >= 0 && landing < firstProject, { order });
  check('the sub-projects still follow, Agent Base among them', order.includes('project:agent-base'), { order });
  const agentBase = await page.locator('[data-workspace="agent-base"] [data-owner]').allTextContents();
  check('Agent Base keeps only its own owners', agentBase.some(t => t.includes('AGENT-BASE')) && !agentBase.some(t => t.includes('SISO-LANDING')), { agentBase });
} catch (error) {
  check('nav-owners-first suite completes', false, { error: String(error?.stack ?? error).slice(0, 600) });
} finally {
  await browser?.close();
  await server?.close();
}
console.log(JSON.stringify({ passed: results.filter(Boolean).length, of: results.length }));
process.exitCode = results.length && results.every(Boolean) ? 0 : 1;
