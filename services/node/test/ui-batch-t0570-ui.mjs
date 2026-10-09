// t-0570, Shaan's UI batch (9 Oct ~02:10): the usage pop-up shows every account's 5-hour window at a glance; the composer's
// footer is tidy and the floating Version pill is gone; the model selector lists models; the Today chip is black, shows a
// number and opens a wider black pop-up; Recorded vNNN opens a pop-up, not a page; the bell sits right of +, the three dots
// at the far right; HEALTH, EFFICIENCY and ESTATE are back at the bottom of the side nav.
// Synthetic full app, sealed API (vite answers 410 for /api, /chat, /term; WebSockets closed), never the live node.
//   heavy -- node services/node/test/ui-batch-t0570-ui.mjs            the assertions, after shots
//   heavy -- node services/node/test/ui-batch-t0570-ui.mjs --before   main's source (a8491153) served instead, before shots
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { webkit } from './suite-runtime.mjs';
import { fixtureResponse } from '../../../tools/ab-qa-fixtures.mjs';

const root = path.resolve(import.meta.dirname, '../../..');
const { createServer } = createRequire(path.join(root, 'apps/web/package.json'))('vite');
const before = process.argv.includes('--before');
const baseline = 'a8491153e9389dd6104a73454b48303a59198285';
const shots = path.join(root, 'ui-hub/ui-batch-t0570');
mkdirSync(shots, { recursive: true });
const tag = before ? 'before' : 'after';
// --before serves main's web source through vite (the papercuts-ui pattern), so the before shots stay reproducible.
const source = { name: 't0570-baseline', enforce: 'pre', load(id) {
  if (!before) return;
  const rel = path.relative(root, id.split('?')[0]);
  if (!/^(apps\/web\/src|packages)\//.test(rel) || rel.includes('node_modules') || !/\.(tsx?|css)$/.test(rel)) return;
  try { return execFileSync('git', ['show', `${baseline}:${rel}`], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }); } catch { return; }
} };

const now = Date.now(), H = 3600_000, D = 24 * H;
const localDay = (t = now) => { const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const catalog = [{ id: 'claude-opus-5-5[1m]', label: 'Opus', description: 'Deep work and long sessions', efforts: ['low', 'medium', 'high', 'max'] }, { id: 'claude-sonnet-5-5', label: 'Sonnet', description: 'Fast everyday work', efforts: ['low', 'medium', 'high'] }];
const agentsBody = (models) => {
  const body = structuredClone(fixtureResponse('/api/agents', 'fixture'));
  const zero = body.agents[0];
  zero.hud = { accountId: 'claude-siso', context: 42, model: 'claude-opus-5-5[1m]', tokensIn: 120_000, tokensOut: 30_000, cachePct: 90, costUsd: 3.2, fiveHour: { pct: 38, resetsAt: now + 2 * H + 12 * 60_000 }, week: { pct: 61, resetsAt: now + 3 * D }, at: now - 30_000, limitsAt: now - 30_000, limitsStale: false, effort: 'high', models };
  // The three infrastructure agents, live, as the node lists them.
  for (const [i, name] of ['HEALTH', 'EFFICIENCY', 'ESTATE'].entries()) body.agents.push({ ...zero, id: `infra-${i}`, key: `fixture/${name}`, name, title: name, zero: false, a0: false, host: false, chat: true, status: i === 1 ? 'working' : 'idle', hud: null, main: true, kind: 'owner', infrastructureRole: name, project: 'Agent Infrastructure' });
  return body;
};
// Usage: three Claude accounts with their own 5-hour and week windows (one stale), Codex with its week only.
const lim = (five, week, at = now - 60_000, extra = {}) => ({ at, source: 'fixture', fiveHour: five === null ? null : { usedPct: five[0], resetsAt: now + five[1] }, weekly: { usedPct: week[0], resetsAt: now + week[1] }, ...extra });
const acct = (id, kind, label, limits) => ({ id, name: id, kind, folder: id, person: { email: null, label, mine: true }, today: { total: 1, cost: 1, messages: 1 }, limits });
const tokens = { ...fixtureResponse('/api/tokens', 'fixture'), accounts: [
  acct('claude:claude-siso', 'claude', 'Fixture main', lim([38, 2 * H + 12 * 60_000], [61, 3 * D])),
  acct('claude:claude-siso-3', 'claude', 'Fixture second', lim([82, 47 * 60_000], [68, 5 * D])),
  acct('claude:claude-fahmy', 'claude', 'Fixture partner', lim([0, -2 * H], [34, 4 * D], now - 5 * D, { stale: true })),
  acct('codex', 'codex', 'Fixture Codex', lim(null, [77, 2 * D])),
] };
const claudeAccounts = { refreshing: false, accounts: [
  { id: 'claude-siso-3', name: 'lordsisodia', readOnly: false, week: { pct: 68, resetsAt: now + 5 * D }, usageAt: now, usageStale: false, renewsAt: now + 9 * D, renewalStatus: 'active', credits: [{ left: 82.4, endsAt: now + 7 * D }], billingAt: now, billingStale: false },
  { id: 'claude-siso', name: 'fuzeheritage', readOnly: false, week: { pct: 61, resetsAt: now + 3 * D }, usageAt: now, usageStale: false, renewsAt: now + 30 * D, renewalStatus: 'active', credits: [{ left: 210.6, endsAt: now + 14 * D }], billingAt: now, billingStale: false },
  { id: 'claude-fahmy', name: 'Fahmy’s', readOnly: true, week: null, usageAt: null, usageStale: true, renewsAt: null, renewalStatus: null, credits: null, billingAt: null, billingStale: true },
] };
// Today's spend as the fixed node answers: yesterday's STACK-OPT attribution (stale after midnight) and today's Tokens figure.
const report = { day: localDay(now - D), claude_usd_equiv: 81.6, codex_credits: [140, 175], attributed_to_plan_items: 40, plan_items: [], projects: [
  { project: 'Agent Base', claude_usd_equiv: 42.1, codex_credits: [80, 100], owners: [] }, { project: 'HALO', claude_usd_equiv: 25.5, codex_credits: [40, 50], owners: [] }, { project: 'Agent Zero', claude_usd_equiv: 14, codex_credits: [20, 25], owners: [] }], note: 'Fixture attribution' };
const spend = (today) => ({ source: 'stack-opt', data: report, attribution: { source: 'stack-opt', scope: 'report-day', state: 'stale', observedAt: now - 7 * H, attemptedAt: now - 60_000, day: report.day, reason: 'day-mismatch' }, ...(today ? { today: { usd: 78.83, from: 'tokens', day: localDay(), observedAt: now - 30_000 } } : {}) });
const releases = { releases: [145, 144, 143].map((v, i) => ({ version: v, at: new Date(now - (i * 5 + 1) * H).toISOString(), sha: `${v}`.padEnd(40, 'a'), kinds: ['feat'], note: { sha: `${v}`, title: `Release ${v}: synthetic notes`, why: 'Synthetic why for the fixture.', what: ['One thing changed', 'Another thing changed'] }, commits: [{ sha: `${v}`.padEnd(40, 'b'), subject: `Synthetic change in v${v}`, line: `Synthetic change in v${v}`, author: 'QA fixture', tag: null, at: new Date(now - H).toISOString() }], evidence: { state: 'unavailable', pairs: [], reason: 'Synthetic' } })), pending: { ref: 'main', commits: [] } };
const org = () => ({ ...fixtureResponse('/api/org', 'fixture'), bottom: ['HEALTH', 'EFFICIENCY', 'ESTATE'].map((name, i) => ({ name, domain: { HEALTH: 'Machines', EFFICIENCY: 'The agent stack', ESTATE: 'Where everything lives' }[name], icon: 'bot', state: 'live', working: i === 1 ? 1 : 0, plan: { checked: 0, total: 0, asked: 0 }, status: i === 1 ? 'working' : 'idle', ledger: null })) });

let server, browser;
const results = [];
const step = async (name, fn) => {
  try { await fn(); results.push({ name, ok: true }); console.log(`PASS ${name}`); }
  catch (e) { if (before) { results.push({ name, ok: false, note: String(e.message).split('\n')[0] }); console.log(`NOTE ${name}: ${String(e.message).split('\n')[0]}`); } else throw e; }
};
try {
  server = await createServer({ root: path.join(root, 'apps/web'), configFile: path.join(root, 'apps/web/vite.config.ts'), logLevel: 'error', plugins: [source,
    { name: 'sealed-api', configureServer(v) { v.middlewares.use((req, res, next) => { if (/^\/(api|chat|term)\b/.test(req.url ?? '')) { res.statusCode = 410; res.end('Fixture only'); return; } next(); }); } }],
    server: { host: '127.0.0.1', port: 0, strictPort: false, hmr: false, watch: { ignored: ['**/*'] } } });
  await server.listen();
  const base = `http://127.0.0.1:${server.httpServer.address().port}`;
  browser = await webkit.launch({ headless: true });
  for (const width of [1440, 390]) {
    const phone = width < 700, errors = [];
    const page = await browser.newPage({ viewport: { width, height: phone ? 844 : 1000 }, reducedMotion: 'reduce' });
    page.on('pageerror', e => errors.push(e.message));
    await page.addInitScript(phone => { window.EventSource = undefined; localStorage.setItem('agent-base:space', '"agents"'); localStorage.setItem('agent-base:whats-new.seen', '143'.padEnd(40, 'a')); if (phone) localStorage.setItem('agent-base:sidebar-open', 'false'); }, phone);
    await page.routeWebSocket('**/*', socket => socket.close());
    await page.route('**/*', route => new URL(route.request().url()).origin === base ? route.fallback() : route.abort());
    // Before: the node's answer as he saw it (the browser gave up on a slow /api/spend, so no Tokens figure); after: the fixed node's.
    let models = [], withToday = !before;
    await page.route(`${base}/api/**`, route => {
      const p = new URL(route.request().url()).pathname;
      const body = p === '/api/agents' ? agentsBody(models) : p === '/api/tokens' ? tokens : p === '/api/claude-accounts' ? claudeAccounts : p === '/api/spend' ? spend(withToday)
        : p === '/api/releases' ? releases : p === '/api/org' ? org() : p === '/api/version' ? { web: '0.8.5', node: '0.8.2', desktop: '0.6.1', sha: 'f'.repeat(40), assets: ['/fixture-new.js'] }
        : p === '/api/version/changes' ? { subjects: ['Synthetic release'], changes: [], sha: 'f'.repeat(40) } : fixtureResponse(p, 'fixture');
      return body === undefined ? route.fulfill({ status: 404, json: {} }) : route.fulfill({ json: body });
    });
    await page.goto(base);
    if (phone) { await page.getByTestId('zero-pill-open').click(); }
    await page.getByTestId('provider-usage').first().waitFor();
    await page.waitForTimeout(1200);
    const shot = (item, clip) => page.screenshot({ path: path.join(shots, `${item}-${tag}-${width}.png`), ...(clip ? { clip } : {}) });
    const around = async (loc, pad = 16) => { const b = await loc.boundingBox(); return { x: Math.max(0, b.x - pad), y: Math.max(0, b.y - pad), width: Math.min(width - Math.max(0, b.x - pad), b.width + pad * 2), height: b.height + pad * 2 }; };
    const top = page.locator('[data-ab-comp="top-strip"]');

    // 6. The top bar: + then the bell; the three dots at the far right.
    await step(`${width}: 6 top bar order`, async () => {
      await shot('6-topbar', { x: 0, y: 0, width, height: 56 });
      const labels = await top.locator('button').evaluateAll(bs => bs.filter(b => b.getClientRects().length).map(b => b.getAttribute('aria-label') ?? ''));
      if (before) return;
      const i = (re) => labels.findIndex(l => re.test(l));
      assert.ok(i(/^New tab/) >= 0 && i(/^Agent notifications/) > i(/^New tab/), `the bell sits right of +: ${labels.join(' | ')}`);
      assert.equal(i(/^More views/), labels.length - 1, `the three dots are the last control: ${labels.join(' | ')}`);
    });

    // 4. Today's spend: black chip with a number; a wider black pop-up.
    await step(`${width}: 4 spend chip`, async () => {
      const chip = page.getByTestId('today-spend');
      await chip.waitFor();
      await shot('4-spend-chip', await around(chip, 10));
      const trigger = chip.locator('.td-trigger');
      const look = await trigger.evaluate(el => { const s = getComputedStyle(el); return { bg: s.backgroundColor, image: s.backgroundImage, text: el.innerText }; });
      await trigger.click();
      const panel = page.locator('.td-panel');
      await panel.waitFor();
      await page.waitForTimeout(250);
      await shot('4-spend', phone ? undefined : { x: Math.max(0, width - 720), y: 0, width: Math.min(720, width), height: 760 });
      const pop = await panel.evaluate(el => { const s = getComputedStyle(el.closest('[role=dialog]') ?? el); return { width: el.getBoundingClientRect().width, bg: s.backgroundColor, text: el.innerText }; });
      await page.keyboard.press('Escape');
      if (before) return;
      assert.match(look.text, /\$78\.83/, `the chip shows today's number: ${look.text}`);
      assert.doesNotMatch(look.text, /Unknown/);
      const rgb = (s) => (s.match(/\d+(\.\d+)?/g) ?? []).slice(0, 3).map(Number);
      assert.ok(rgb(look.bg).every(c => c < 40) && !/gradient/.test(look.image), `the chip is black, not blue: ${look.bg} ${look.image}`);
      assert.ok(pop.width >= (phone ? 340 : 440), `the pop-up is wider: ${pop.width}`);
      assert.ok(rgb(pop.bg).every(c => c < 30), `the pop-up is black: ${pop.bg}`);
      assert.match(pop.text, /\$78\.83/);
    });

    // 1. Usage: every account's 5-hour window visible at once with its reset, no collapsed row.
    await step(`${width}: 1 usage pop-up`, async () => {
      const meter = page.getByTestId('provider-usage').first();
      await meter.focus();
      await page.keyboard.press('ArrowDown');
      const card = page.getByRole('dialog', { name: 'Usage accounts' });
      await card.waitFor();
      await page.waitForTimeout(400);
      await shot('1-usage', phone ? undefined : await around(card, 24));
      const text = await card.innerText();
      const closeCard = async () => { await page.keyboard.press('Escape'); await card.waitFor({ state: 'detached', timeout: 3000 }).catch(() => page.mouse.click(width / 2, 300)); await card.waitFor({ state: 'detached' }); };
      if (before) return closeCard();
      assert.equal(await card.locator('details').count(), 0, 'no collapsed "5-hour and weekly windows" row');
      const rows = card.getByTestId('usage-account');
      assert.ok(await rows.count() >= 3, 'a row per Claude account');
      for (const name of ['fuzeheritage', 'lordsisodia', 'Fahmy’s']) assert.ok(text.includes(name), `${name} shown`);
      const fives = card.locator('[data-window="five-hour"]');
      assert.ok(await fives.count() >= 3, 'each account shows its 5-hour window');
      for (let n = 0; n < await fives.count(); n++) assert.ok(await fives.nth(n).isVisible(), '5h visible without expanding');
      assert.match(text, /2h 12m/, 'the main account resets in 2h 12m');
      assert.match(text, /47m/, 'the second resets in 47m');
      assert.match(text, /Codex/);
      assert.match(text, /Codex reports its weekly window only/i, 'Codex 5h explained');
      assert.match(text, /\$82\.40|\$210\.60/, 'cloud credit shown');
      const box = await card.boundingBox();
      assert.ok(box.x >= 0 && box.x + box.width <= width + 1 && box.y >= 0, 'inside the window');
      await closeCard();
    });

    // 2. Below the composer: the footer is tidy, and no floating version pill over it.
    await step(`${width}: 2 composer footer`, async () => {
      const composer = page.locator('.siso-composer, [data-testid="composer"]').first();
      const target = await composer.count() ? composer : page.getByTestId('provider-usage').first().locator('xpath=ancestor::*[contains(@class,"halo") or contains(@class,"composer")][1]');
      await shot('2-composer', phone ? undefined : await around(target, 60));
      // The compact (context) card the ctx ring opens.
      await page.locator('.ab-context-trigger').first().click();
      const ctx = page.getByRole('dialog', { name: 'Context breakdown' });
      await ctx.waitFor();
      await page.waitForTimeout(250);
      await shot('2-compact', phone ? undefined : await around(ctx, 24));
      const ctxText = await ctx.innerText();
      await page.keyboard.press('Escape');
      await ctx.waitFor({ state: 'detached' });
      if (before) return;
      assert.doesNotMatch(ctxText, /\bToday\b/, 'the compact card does not repeat the top bar\'s Today figure');
      assert.match(ctxText, /Compacts at 35%/);
      const row = page.getByTestId('hud').first();
      if (!phone) assert.match(await row.getByTestId('model-chip').innerText().then(t => t.trim()), /^Opus 5\.5/, 'the chip says Opus 5.5, not Claude Opus 5.5');
      const pills = await row.locator('.ab-hud__model, .ab-provider-meter, .ab-subagents__trigger').evaluateAll(xs => xs.map(x => getComputedStyle(x).borderTopColor));
      assert.ok(pills.length >= 2 && pills.every(c => /rgba\(0, 0, 0, 0\)|transparent/.test(c)), `no pill borders in the row: ${pills.join(' ')}`);
      assert.equal(await page.getByTestId('ready-pill').count(), 0, 'no floating Version pill');
      assert.equal(await page.getByTestId('version-notice').count(), 0);
      assert.equal(await page.locator('.vp-trigger').count(), 0, 'no Versions trigger over the composer');
    });

    // 3. The model selector: the hosted chat's menu lists models (an empty host catalog no longer leaves it blank).
    await step(`${width}: 3 model selector`, async () => {
      const chip = page.getByTestId('model-chip').first();
      await chip.click();
      const menu = page.getByTestId('model-menu');
      await menu.waitFor();
      await page.waitForTimeout(300);
      await shot('3-model', phone ? undefined : await around(menu, 24));
      const text = await menu.innerText();
      await page.keyboard.press('Escape');
      if (before) return;
      assert.doesNotMatch(text, /Waiting for the host’s model catalog/, 'not blank');
      assert.match(text, /Opus/); assert.match(text, /Sonnet/);
    });

    // 5. Recorded vNNN opens a pop-up over the page; the page does not change.
    // t-0532 item 8: the bar says the number alone.
    assert.equal((await page.getByTestId('version-pill').locator('b').textContent())?.trim(), 'v145', 'just the version number');
    await step(`${width}: 5 version pop-up`, async () => {
      const pill = page.getByTestId('version-pill');
      if (!(await pill.isVisible())) { assert.ok(phone, 'the pill shows on a wide window'); return; }
      const hash = await page.evaluate(() => location.hash);
      await pill.click();
      await page.waitForTimeout(500);
      await shot('5-version');
      if (before) { await page.keyboard.press('Escape'); return; }
      const pop = page.getByRole('dialog', { name: /What’s new|^v145$/ });
      await pop.waitFor();
      assert.equal(await page.evaluate(() => location.hash), hash, 'no navigation');
      assert.equal(await page.getByTestId('whats-new').count(), 0, 'not the What’s new page');
      const text = await pop.innerText();
      assert.match(text, /v145/); assert.match(text, /Release 145: synthetic notes/);
      assert.match(text, /New build ready/, 'a waiting build is offered here instead of the floating pill');
      const box = await pop.boundingBox();
      assert.ok(box.x >= 0 && box.x + box.width <= width + 1, 'inside the window');
      await page.keyboard.press('Escape');
      await pop.waitFor({ state: 'detached' });
    });

    // 7. HEALTH, EFFICIENCY and ESTATE at the bottom of the side nav, each opening its chat.
    await step(`${width}: 7 side nav bottom`, async () => {
      if (phone) { const toggle = page.getByRole('button', { name: 'Show or hide the side nav' }); await toggle.click(); await page.waitForTimeout(400); }
      const foot = page.locator('.siso-nav-footer').first();
      await foot.waitFor();
      const b = await foot.boundingBox();
      await shot('7-sidenav', { x: 0, y: Math.max(0, b.y - 220), width: Math.min(width, b.x + b.width + 40), height: Math.min(260 + b.height, (phone ? 844 : 1000) - Math.max(0, b.y - 220)) });
      if (before) return;
      const infra = page.getByTestId('nav-infra');
      await infra.waitFor();
      const names = await infra.locator('[data-role]').evaluateAll(xs => xs.map(x => x.getAttribute('data-role')));
      assert.deepEqual(names, ['HEALTH', 'EFFICIENCY', 'ESTATE']);
      for (const n of names) assert.ok(await infra.locator(`[data-role="${n}"]`).isVisible(), `${n} visible`);
      assert.deepEqual(await infra.locator('[data-role]').evaluateAll(xs => xs.map(x => x.getAttribute('aria-label'))), ["Open HEALTH's chat: idle", "Open EFFICIENCY's chat: working", "Open ESTATE's chat: idle"]);
      await infra.locator('[data-role="ESTATE"]').click();
      await page.waitForFunction(() => [...document.querySelectorAll('[data-testid="chat-head"] *')].some(el => el.children.length === 0 && el.getClientRects().length && el.textContent?.trim() === 'ESTATE'), null, { timeout: 8000 });
    });

    if (!before) {
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'no sideways scroll');
      assert.deepEqual(errors, []);
    }
    await page.close();
  }
  writeFileSync(path.join(shots, `checks-${tag}.json`), JSON.stringify({ baseline: before ? baseline : 'worktree', results }, null, 2) + '\n');
  console.log(`${before ? 'BEFORE' : 'PASS'} ui batch t-0570`, JSON.stringify(results.filter(r => !r.ok)));
} finally { await browser?.close(); await server?.close(); }
