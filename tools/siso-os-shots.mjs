// SISO OS before/after shots (t-0599, spec ecosystem/specs/siso-os.md §11): one checkout's web app on sealed vite with a
// fixture API (owners, running agents, SISO Family, the infrastructure trio, needs, unread pings), shot at 1440 and 390.
// Never a live agent: every /api, /chat and /term request is answered here or refused.
//   heavy -- node --experimental-strip-types --no-warnings tools/siso-os-shots.mjs --root <checkout> --out <dir>
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const root = path.resolve(arg('root', path.resolve(import.meta.dirname, '..'))), out = path.resolve(arg('out', '/tmp/siso-os-shots'));
mkdirSync(out, { recursive: true });
const req = createRequire(path.join(root, 'services/node/package.json'));
const { webkit } = req('playwright');
const { createServer } = createRequire(path.join(root, 'apps/web/package.json'))('vite');
const { fixtureResponse } = await import(path.join(root, 'tools/ab-qa-fixtures.mjs'));
const { seedWorkspaces } = await import(path.join(root, 'services/node/src/workspace-registry.ts'));

const now = Date.now(), iso = (ms = 0) => new Date(now - ms).toISOString();
const base0 = fixtureResponse('/api/agents', 'fixture');
const template = base0.agents.find(a => !a.zero && a.status === 'working') ?? base0.agents.at(-1);
const owner = (name, workspace, status, project) => ({ ...template, id: `own-${name}`, key: `own-${name}`, pane: `p-${name}`, name, workspace, status, project, navOwner: true, row: 'live', zero: false, a0: false, main: false, kind: 'owner', navParentId: undefined, parentId: undefined });
const agents = [...base0.agents.filter(a => a.zero || ['working', 'idle'].includes(a.status)),
  owner('OPERATOR-UI', 'halo', 'working', 'HALO'), owner('STREAMING', 'halo', 'needs', 'HALO'),
  owner('SISO-LANDING', 'siso-agency', 'working', 'SISO Agency'), owner('AGENT-BASE', 'agent-base', 'working', 'Agent Base'),
  owner('UI-HUB', 'ui-hub', 'idle', 'UI Hub')];
const org = fixtureResponse('/api/org', 'fixture');
org.groups = org.groups.map(g => g.id !== 'family' ? g : { ...g, projects: [{ id: 'family-office', name: 'Family Office', group: 'family', shown: true, order: 0, owners: [] }, { id: 'home', name: 'Home', group: 'family', shown: true, order: 1, owners: [] }] });
org.bottom = ['HEALTH', 'EFFICIENCY', 'ESTATE'].map(name => ({ name, domain: 'Agent Infrastructure', icon: 'bot', state: 'live', working: 0, plan: { checked: 0, total: 0, asked: 0 }, status: name === 'HEALTH' ? 'working' : 'idle', ledger: null }));
const zero = base0.agents.find(a => a.zero);
const attention = ['OPERATOR-UI', 'SISO-LANDING', 'AGENT-BASE'].map((n, i) => ({ id: `att-${i}`, ref: { hostInstanceId: 'fixture', sessionId: 'fixture', runId: 'fixture' }, phase: i === 0 ? 'needs' : 'completed', revision: 1, at: iso(i * 60_000), agentId: `own-${n}`, agentName: n, headline: i === 0 ? 'Which header layout do you want?' : 'Shipped the fix', read: false, buzz: false, delivery: 'off' }));
const pings = [{ id: 1, at: iso(120_000), title: 'Before/after shots are ready', body: 'Synthetic ping', project: 'Agent Base', read: false, react: null }, { id: 2, at: iso(600_000), title: 'Second synthetic ping', body: '', read: false, react: null }];

const server = await createServer({ root: path.join(root, 'apps/web'), configFile: path.join(root, 'apps/web/vite.config.ts'), logLevel: 'error',
  plugins: [{ name: 'sealed-api', configureServer(v) { v.middlewares.use((q, s, next) => { if (/^\/(api|chat|term)\b/.test(q.url ?? '')) { s.statusCode = 410; s.end('Fixture only'); return; } next(); }); } }],
  server: { host: '127.0.0.1', port: 0, strictPort: false, hmr: false, watch: { ignored: ['**/*'] } } });
await server.listen();
const base = `http://127.0.0.1:${server.httpServer.address().port}`;
const browser = await webkit.launch({ headless: true });
const shots = [];
const errors = [], checks = [];
try {
  for (const [label, viewport] of [['1440', { width: 1440, height: 900 }], ['390', { width: 390, height: 844 }]]) {
    const ctx = await browser.newContext({ viewport, reducedMotion: 'reduce', deviceScaleFactor: 2, ...(label === '390' ? { isMobile: true, hasTouch: true } : {}) });
    const page = await ctx.newPage();
    page.on('pageerror', e => errors.push(`${label}: ${String(e).slice(0, 200)}`));
    await page.addInitScript(() => {
      for (const [k, v] of Object.entries({ 'agent-base:space': '"agents"', 'agent-base:sidebar-open': 'true', 'agent-base:ab.nav.folder.agents': 'true', 'agent-base:group-open:family': 'false' })) localStorage.setItem(k, v);
      window.EventSource = undefined;
    });
    // App Factory's render service (8850) and what its frame loads are the only other requests let through: a page, not an agent.
    await page.route('**/*', r => new URL(r.request().url()).origin === base || r.request().frame() !== page.mainFrame() || r.request().url().startsWith('http://127.0.0.1:8850/') ? r.fallback() : r.abort());
    await page.route(`${base}/api/**`, r => {
      const p = new URL(r.request().url()).pathname;
      if (p === '/api/agents') return r.fulfill({ json: { ...base0, agents, workspaces: seedWorkspaces() } });
      if (p === '/api/workspace-registry') return r.fulfill({ json: { workspaces: seedWorkspaces(), taskIdentities: {}, taskAliases: {} } });
      if (p === '/api/org') return r.fulfill({ json: org });
      if (p === '/api/attention') return r.fulfill({ json: { ...fixtureResponse(p, 'fixture'), items: attention } });
      if (/^\/api\/agents\/[^/]+\/notifications$/.test(p)) return r.fulfill({ json: { notifications: pings } });
      const body = fixtureResponse(p, 'fixture');
      return body === undefined ? r.fulfill({ status: 404, json: {} }) : r.fulfill({ json: body });
    });
    await page.routeWebSocket('**/*', ws => ws.close());
    await page.goto(base);
    await page.waitForTimeout(2500);
    const shot = async (name) => { const file = path.join(out, `${name}-${label}.png`); await page.screenshot({ path: file }); shots.push(file); };
    if (label === '1440') {
      await shot('nav');
      await page.locator('[data-owner="own-AGENT-BASE"]').first().click().catch(() => page.getByText('AGENT-BASE', { exact: true }).first().click());
      await page.waitForTimeout(2000);
      await page.mouse.move(1150, 300); await page.waitForTimeout(900);
      await shot('chat');
      const zeroCardBtn = page.locator('[data-testid="zero-card-open"]').first();
      if (await zeroCardBtn.count()) { await zeroCardBtn.click(); await page.waitForTimeout(700); await shot('zero-card'); await page.keyboard.press('Escape'); await page.waitForTimeout(300); checks.push(`zero-card closes on Escape: ${await page.locator('[data-testid="zero-card-pop"]').count() === 0}`); await zeroCardBtn.click(); await page.waitForTimeout(300); await page.mouse.click(1100, 500); await page.waitForTimeout(300); checks.push(`zero-card closes on a click outside: ${await page.locator('[data-testid="zero-card-pop"]').count() === 0}`); checks.push(`agent tabs in the top bar: ${await page.locator('[data-testid^="top-tab-owner"], [data-tab-id^="owner:"]').count()}`); }
      const head = page.locator('.siso-headstack__space button').first();
      await page.mouse.move(1150, 300);
      if (await head.count()) { await head.click(); await page.waitForTimeout(500); await shot('header-menu'); await page.keyboard.press('Escape'); }
      const infra = page.locator('[data-testid="nav-infra"]').first();
      if (await infra.count()) { await infra.hover(); await page.waitForTimeout(700); await shot('infra'); }
      await page.mouse.move(1150, 300);
    } else {
      await shot('nav');
      await page.getByText('AGENT-BASE', { exact: true }).first().click().catch(() => {});
      await page.waitForTimeout(2000);
      await shot('chat');
    }
    const factory = page.getByRole('button', { name: 'App Factory' }).first();
    if (await factory.count()) { await factory.click().catch(() => {}); await page.mouse.move(1150, 300); const zeroCardBtn2 = page.locator('[data-testid="zero-card-open"]').first(); if (await zeroCardBtn2.count()) { await zeroCardBtn2.click(); await page.waitForTimeout(700); await shot('zero-card-factory'); await page.keyboard.press('Escape'); } await page.frameLocator('iframe[title="App Factory"]').getByText('App Factory').first().waitFor({ timeout: 20000 }).catch(() => {}); await page.waitForTimeout(1500); await shot('app-factory'); }
    await ctx.close();
  }
} finally { await browser.close(); await server.close(); }
console.log(JSON.stringify({ root, base: zero?.name, shots: shots.map(f => path.basename(f)), checks, errors }));
