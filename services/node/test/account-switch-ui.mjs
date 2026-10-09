// t-0577: switch this chat's Claude login from the model dropdown. Synthetic full app, sealed API (vite answers 410 for
// /api, /chat, /term; WebSockets closed), never the live node, never a real account.
//   heavy -- node services/node/test/account-switch-ui.mjs            the assertions, after shot
//   heavy -- node services/node/test/account-switch-ui.mjs --before   origin/main's web source served instead, before shot
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { webkit } from './suite-runtime.mjs';
import { fixtureResponse } from '../../../tools/ab-qa-fixtures.mjs';

const root = path.resolve(import.meta.dirname, '../../..');
const { createServer } = createRequire(path.join(root, 'apps/web/package.json'))('vite');
const before = process.argv.includes('--before');
const baseline = execFileSync('git', ['merge-base', 'HEAD', 'origin/main'], { cwd: root, encoding: 'utf8' }).trim();
const shots = path.join(root, 'ui-hub/t0577');
mkdirSync(shots, { recursive: true });
const source = { name: 't0577-baseline', enforce: 'pre', load(id) {
  if (!before) return;
  const rel = path.relative(root, id.split('?')[0]);
  if (!/^(apps\/web\/src|packages)\//.test(rel) || rel.includes('node_modules') || !/\.(tsx?|css)$/.test(rel)) return;
  try { return execFileSync('git', ['show', `${baseline}:${rel}`], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }); } catch { return; }
} };

const now = Date.now(), H = 3600_000;
const agentsBody = () => {
  const body = structuredClone(fixtureResponse('/api/agents', 'fixture'));
  const zero = body.agents.find(a => a.zero);
  zero.hud = { accountId: 'claude-siso', context: 42, model: 'claude-opus-5-5[1m]', tokensIn: 1000, tokensOut: 300, cachePct: 90, costUsd: 1, fiveHour: { pct: 100, resetsAt: now + H }, week: { pct: 62, resetsAt: now + 72 * H }, at: now, limitsAt: now, limitsStale: false, effort: 'high', models: [] };
  return body;
};
const row = (id, name, extra) => ({ id, name, readOnly: false, fiveHour: null, week: null, usageAt: now, usageStale: false, renewsAt: null, renewalStatus: null, credits: null, billingAt: null, billingStale: true, ...extra });
const claudeAccounts = { refreshing: false, accounts: [
  row('claude-siso-3', 'lordsisodia', { fiveHour: { pct: 12, resetsAt: now + 2 * H }, week: { pct: 40, resetsAt: now + 96 * H } }),
  row('claude-siso', 'fuzeheritage', { fiveHour: { pct: 100, resetsAt: now + H }, week: { pct: 62, resetsAt: now + 72 * H } }),
  { ...row('claude-fahmy', 'Fahmy’s', { usageAt: null, usageStale: true }), readOnly: true },
] };
const RUN = [
  { state: 'waiting-idle', message: 'Waiting for idle', stages: ['Queued', 'Waiting for idle'] },
  { state: 'moving', message: 'Moving the conversation', stages: ['Queued', 'Waiting for idle', 'Moving the conversation'] },
  { state: 'confirming', message: 'Confirming on lordsisodia', stages: ['Queued', 'Waiting for idle', 'Moving the conversation', 'Confirming on lordsisodia'] },
  { state: 'done', message: 'On lordsisodia now, same conversation', stages: ['Queued', 'Waiting for idle', 'Moving the conversation', 'Confirming on lordsisodia'] },
].map(s => ({ ...s, to: 'claude-siso-3', blocked: null }));
const FAILED = { state: 'failed', message: 'OWNER: no sess-1.jsonl under ~/.claude-siso/projects', to: 'claude-siso-3', stages: ['Queued', 'Waiting for idle'], blocked: null };

let server, browser;
try {
  server = await createServer({ root: path.join(root, 'apps/web'), configFile: path.join(root, 'apps/web/vite.config.ts'), logLevel: 'error', plugins: [source,
    { name: 'sealed-api', configureServer(v) { v.middlewares.use((req, res, next) => { if (/^\/(api|chat|term)\b/.test(req.url ?? '')) { res.statusCode = 410; res.end('Fixture only'); return; } next(); }); } }],
    server: { host: '127.0.0.1', port: 0, strictPort: false, hmr: false, watch: { ignored: ['**/*'] } } });
  await server.listen();
  const base = `http://127.0.0.1:${server.httpServer.address().port}`;
  browser = await webkit.launch({ headless: true });

  /** One page; `scenario` decides what the claude-account route answers. Every call is recorded. */
  const open = async (scenario, fold = true) => {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
    const calls = [], errors = [], dialogs = [];
    let gets = 0, posted = false;
    page.on('pageerror', e => errors.push(e.message));
    page.on('dialog', d => { dialogs.push(d.message()); void d.accept(); });
    await page.addInitScript(() => { window.EventSource = undefined; localStorage.setItem('agent-base:space', '"agents"'); localStorage.setItem('agent-base:whats-new.seen', '143'.padEnd(40, 'a')); });
    await page.routeWebSocket('**/*', socket => socket.close());
    await page.route('**/*', route => new URL(route.request().url()).origin === base ? route.fallback() : route.abort());
    await page.route(`${base}/api/**`, route => {
      const req = route.request(), p = new URL(req.url()).pathname;
      if (/\/claude-account$|\/move$/.test(p)) calls.push({ method: req.method(), path: p, body: req.postData() });
      if (p.endsWith('/claude-account')) {
        if (req.method() === 'POST') { posted = true; return route.fulfill({ status: 202, json: { state: 'queued', message: 'Queued', to: JSON.parse(req.postData() ?? '{}').to, stages: ['Queued'] } }); }
        if (scenario === 'failed') return route.fulfill({ json: FAILED });
        return route.fulfill({ json: posted ? RUN[Math.min(gets++, RUN.length - 1)] : { state: 'idle', message: 'No account switch has been requested', blocked: null } });
      }
      const body = p === '/api/agents' ? agentsBody() : p === '/api/claude-accounts' ? claudeAccounts : fixtureResponse(p, 'fixture');
      return body === undefined ? route.fulfill({ status: 404, json: {} }) : route.fulfill({ json: body });
    });
    await page.goto(base);
    await page.getByTestId('model-chip').first().waitFor();
    await page.waitForTimeout(800);
    const menu = page.getByTestId('model-menu');
    await page.getByTestId('model-chip').first().click();
    await menu.waitFor();
    if (fold) await menu.locator('.ab-model-move > summary').click();
    await page.waitForTimeout(400);
    return { page, menu, calls, errors, dialogs };
  };
  const shot = async (page, menu, name) => { const b = await menu.boundingBox(); await page.screenshot({ path: path.join(shots, name), clip: { x: Math.max(0, b.x - 24), y: Math.max(0, b.y - 24), width: b.width + 48, height: Math.min(1000, b.height + 48) } }); };

  if (before) {
    const { page, menu } = await open('run');
    await shot(page, menu, 'dropdown-before-1440.png');
    console.log('BEFORE shot', path.join(shots, 'dropdown-before-1440.png'));
    await page.close();
  } else {
    // The happy path: both of his accounts listed, the true active one checked and disabled, a full window tagged.
    const { page, menu, calls, errors, dialogs } = await open('run', false);
    const group = menu.getByTestId('account-switch');
    await group.waitFor();
    // Beside the account readings, not inside the harness fold: an agent at its limit finds it without opening anything.
    assert.equal(await menu.locator('.ab-model-move').evaluate(d => d.open), false, 'the harness fold is still closed');
    assert.ok(await group.isVisible(), 'the account rows show with the fold closed');
    const rows = group.locator('button[data-account]');
    assert.deepEqual(await rows.evaluateAll(bs => bs.map(b => b.dataset.account)), ['claude-siso-3', 'claude-siso'], 'both of his accounts, Fahmy’s never a target');
    assert.doesNotMatch(await group.innerText(), /Fahmy/, 'Fahmy’s never appears as a target');
    const fuze = group.locator('button[data-account="claude-siso"]'), lord = group.locator('button[data-account="claude-siso-3"]');
    assert.equal(await fuze.isDisabled(), true, 'the active account is disabled');
    assert.equal(await fuze.getAttribute('data-current'), 'true');
    assert.equal(await fuze.getByLabel('Current account').count(), 1, 'a check on the active account');
    assert.equal(await lord.getByLabel('Current account').count(), 0);
    const fuzeText = await fuze.innerText(), lordText = await lord.innerText();
    assert.match(fuzeText, /limited/i, 'a full 5-hour window is tagged');
    assert.match(fuzeText, /5h 100% · resets \d{1,2}:\d{2}/); assert.match(fuzeText, /week 62%/);
    assert.match(lordText, /5h 12%/); assert.match(lordText, /week 40%/); assert.doesNotMatch(lordText, /limited/i);
    assert.equal(await lord.isDisabled(), false);

    // Choosing the other posts {to}; Agent Zero confirms first; the footer walks the stages from GET.
    await lord.click();
    const status = menu.getByTestId('account-switch-status');
    await status.waitFor();
    await page.waitForFunction(() => document.querySelector('[data-testid="account-switch-status"]')?.dataset.state === 'done', null, { timeout: 15_000 });
    const line = await status.innerText();
    assert.equal(line, 'Queued · Waiting for idle · Moving the conversation · Confirming on lordsisodia · On lordsisodia now, same conversation');
    assert.equal(dialogs.length, 1); assert.match(dialogs[0], /Agent Zero.*lordsisodia/);
    const post = calls.filter(c => c.method === 'POST');
    assert.equal(post.length, 1); assert.deepEqual(JSON.parse(post[0].body), { to: 'claude-siso-3' });
    assert.ok(post[0].path.endsWith('/api/agents/Agent%20Zero/claude-account'), post[0].path);
    assert.ok(!calls.some(c => c.path.endsWith('/move')), 'the harness move is never called');
    assert.ok(calls.filter(c => c.method === 'GET').length >= 4, 'GET polled until done');
    await status.scrollIntoViewIfNeeded(); // the footer sits under the harness rows; show it in the shot
    await shot(page, menu, 'dropdown-after-1440.png');
    assert.deepEqual(errors, []);
    await page.close();
    console.log('PASS happy path: rows, active check, limited tag, POST {to}, stages to done');

    // Edge: a failed switch shows its failure text, never a success.
    const failed = await open('failed');
    const failLine = failed.menu.getByTestId('account-switch-status');
    await failLine.waitFor();
    assert.equal(await failLine.getAttribute('data-state'), 'failed');
    assert.equal(await failLine.innerText(), 'Queued · Waiting for idle · OWNER: no sess-1.jsonl under ~/.claude-siso/projects');
    assert.doesNotMatch(await failed.menu.innerText(), /On lordsisodia now/);
    assert.equal(failed.calls.filter(c => c.method === 'POST').length, 0);
    await failed.page.close();
    console.log('PASS failed status renders its failure text');
    console.log('AFTER shot', path.join(shots, 'dropdown-after-1440.png'));
  }
} finally {
  await browser?.close();
  await server?.close();
}
