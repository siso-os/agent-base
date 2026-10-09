// Usage lane, 9 Oct (Shaan: the account he is on "is about to run out, resets in like an hour"): the Usage page answers
// "am I about to run out, on which login, and when does it reset" at the top. Synthetic full app, sealed API, never the
// live node. States: near (one login over 85%), fine, cached (from the last run), loading, missing (sources not
// reporting), many (12 burners, two of them the same owner under two keys).
// BEFORE=1 takes shots and timings only (run it against the old files).   heavy -- node services/node/test/usage-20261009-ui.mjs
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { webkit } from './suite-runtime.mjs';
import { fixtureResponse } from '../../../tools/ab-qa-fixtures.mjs';

const root = path.resolve(import.meta.dirname, '../../..');
const { createServer } = createRequire(path.join(root, 'apps/web/package.json'))('vite');
const shots = path.join(root, 'ui-hub/usage-20261009');
mkdirSync(shots, { recursive: true });
const BEFORE = !!process.env.BEFORE;
const tag = BEFORE ? 'before' : 'after';

// ---------------------------------------------------------------- fixture, relative to the real clock (the page reads Date.now)
let now = Date.now(); const H = 3_600_000, D = 24 * H; // re-read per request, so resets stay relative to the page's clock
const day = (t = now) => { const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const sum = (total, cost) => ({ input: total * 0.7, output: total * 0.2, cacheRead: total * 0.1, cacheWrite: 0, total, cost, unpricedTokens: 0, messages: 40 });
const limit = (usedPct, resetsAt) => ({ usedPct, resetsAt, expired: false });
const claudeAccount = (id, label, folder, five, week, today, at = now - 60_000, extra = {}) => ({
  id, name: label, folder, kind: 'claude', person: { email: null, label, mine: true },
  today: sum(today, today / 2e6), week: sum(today * 5, today * 5 / 2e6), month: sum(today * 20, today * 20 / 2e6), allTime: sum(today * 60, today * 60 / 2e6),
  firstAt: now - 30 * D, lastAt: now - 120_000, models: [{ model: 'claude-opus-5-5', total: today, cost: today / 2e6 }], modelsToday: [{ model: 'claude-opus-5-5', total: today, cost: today / 2e6 }],
  limits: five || week ? { fiveHour: five, weekly: week, at, source: 'live Claude OAuth usage', stale: false } : null, ...extra,
});
function tokens(s) {
  const base = structuredClone(fixtureResponse('/api/tokens', 'fixture'));
  const lordFive = s === 'fine' ? 41 : 92;
  const accounts = [
    claudeAccount('claude:claude-siso-3', 'lordsisodia', 'claude-siso-3', limit(lordFive, now + 58 * 60_000), limit(61, now + 4 * D + 3 * H), 851e6),
    claudeAccount('claude:.claude-siso', 'fuzeheritage', '.claude-siso', limit(22, now + 3 * H + 12 * 60_000), limit(27, now + 6 * D), 465e6,
      s === 'missing' ? now - 3 * H : now - 60_000, s === 'missing' ? { limits: { fiveHour: limit(22, now + 3 * H), weekly: limit(27, now + 6 * D), at: now - 3 * H, source: 'newest status-line HUD file for this profile', stale: true } } : {}),
    { ...claudeAccount('claude:.claude', 'Fahmy', '~/.claude', null, null, 37e6), person: { email: null, label: 'Fahmy', mine: false } },
    { ...base.accounts[0], name: 'Codex · ChatGPT Pro', limits: { fiveHour: null, weekly: limit(9, now + 4 * D), at: now - 120_000, source: 'newest Codex token_count event', credits: { balance: 56603.55, hasCredits: true, unlimited: false } } },
  ];
  if (s === 'missing') accounts.splice(0, 1, claudeAccount('claude:claude-siso-3', 'lordsisodia', 'claude-siso-3', null, null, 851e6));
  const mineToday = accounts.filter(a => a.person?.mine !== false).reduce((n, a) => n + a.today.total, 0);
  const overall = { today: sum(mineToday, mineToday / 2e6), week: sum(mineToday * 5, mineToday * 5 / 2e6), month: sum(mineToday * 20, mineToday * 20 / 2e6), allTime: sum(mineToday * 60, mineToday * 60 / 2e6) };
  return { ...base, at: now - 30_000, cached: s === 'cached' ? true : undefined, accounts, overall, notes: ['Synthetic usage lane fixture'] };
}
const money = () => ({ at: now, pending: false, grants: [{ login: 'fuzeheritage', profile: 'claude-siso', limit: 250, used: 41.15, left: 208.85, ends: now + 33 * D, perHour: 2.4, perDayToSpend: 6.24 }],
  codex: { balance: 56603.55, balanceAt: now - 120_000, balanceSource: 'newest Codex token_count event', eventCredits: null, budget: 60000, plan: 'pro', todaySpent: 842, yesterdaySpent: 2449.6, byDay: {}, reset: now + 4 * D, resetNote: null }, other: [], notes: [] });
const OWNERS = [['STREAMING-CLAUDE', 'HALO', 14.2], ['Agent Zero', 'Agent Stack', 8.4], ['agent-zero', 'Agent Stack', 7.2], ['AGENT-BASE', 'Agent Base', 6.1], ['EFFICIENCY', 'Agent Stack', 3.3], ['A-VERY-LONG-OWNER-NAME-FOR-THE-OVERFLOW-CASE-IN-THE-LIST', 'Great Library', 2.9], ['ESTATE', 'Agent Stack', 2.2], ['HEALTH', 'Agent Stack', 1.4], ['LIBRARY', 'Great Library', 1.1], ['VOICE', 'Agent Base', 0.9], ['ROLODEX', 'Agent Base', 0.6], ['LIFE', 'Agent Base', 0.3]];
function spend(s) {
  const owners = s === 'many' ? OWNERS : OWNERS.slice(0, 4);
  const projects = [...new Set(owners.map(o => o[1]))].map(project => {
    const list = owners.filter(o => o[1] === project).map(([owner, , usd]) => ({ owner, claude_usd_equiv: usd, codex_credits: [usd * 10, usd * 12], finished: 1, agents: [] }));
    return { project, claude_usd_equiv: list.reduce((n, o) => n + o.claude_usd_equiv, 0), codex_credits: [0, 0], finished: list.length, owners: list };
  });
  const total = projects.reduce((n, p) => n + p.claude_usd_equiv, 0);
  return { source: 'stack-opt', data: { day: day(), claude_usd_equiv: total, codex_credits: [400, 480], attributed_to_plan_items: 0.6, projects, plan_items: [] },
    attribution: { source: 'stack-opt', scope: 'report-day', state: 'fresh', observedAt: now - 60_000, attemptedAt: now - 60_000, day: day(), reason: null }, today: { usd: 41.37, from: 'tokens', day: day(), observedAt: now - 30_000 } };
}
function respond(p, s) {
  now = Date.now();
  if (p === '/api/tokens') return s === 'loading' ? 'hang' : tokens(s);
  if (p === '/api/tokens/money') return s === 'missing' ? 'fail' : money();
  if (p === '/api/spend') return s === 'missing' ? { source: 'pending', attribution: { source: 'stack-opt', scope: 'report-day', state: 'unavailable', observedAt: null, attemptedAt: now, day: null, reason: 'unavailable' } } : spend(s);
  return fixtureResponse(p, 'fixture');
}

// ---------------------------------------------------------------- run
const LOC = '#at=' + encodeURIComponent(JSON.stringify({ s: 'tokens', v: { kind: 'chat' }, a: null, o: null }));
let server, browser;
const timings = {}, done = [];
try {
  server = await createServer({ root: path.join(root, 'apps/web'), configFile: path.join(root, 'apps/web/vite.config.ts'), logLevel: 'error',
    plugins: [{ name: 'sealed-api', configureServer(v) { v.middlewares.use((req, res, next) => { if (/^\/(api|chat|term)\b/.test(req.url ?? '')) { res.statusCode = 410; res.end('Fixture only'); return; } next(); }); } }],
    server: { host: '127.0.0.1', port: 0, strictPort: false, hmr: false, watch: { ignored: ['**/*'] } } });
  await server.listen();
  const base = `http://127.0.0.1:${server.httpServer.address().port}`;
  browser = await webkit.launch({ headless: true });
  // The first visit warms vite's module graph so the measured visits time the page, not the dev server's transforms.
  const open = async (s, width, { motion = 'reduce', warm = false } = {}) => {
    const height = width < 700 ? 844 : 900, errors = [];
    const page = await browser.newPage({ viewport: { width, height }, reducedMotion: motion });
    page.on('pageerror', e => errors.push(e.message));
    await page.addInitScript(() => {
      window.EventSource = undefined;
      localStorage.setItem('agent-base:browser-setup', JSON.stringify({ step: 4, doneAt: 1 }));
      localStorage.setItem('agent-base:sidebar-open', 'false');
      // First render of the answer: when the limits (old: the money band's account cards; new: the login meters) first show.
      window.__usageTimes = {};
      new MutationObserver(() => {
        const t = window.__usageTimes;
        if (!t.page && document.querySelector('[data-testid=usage-page]')) t.page = performance.now();
        if (!t.limits && document.querySelector('[data-testid=usage-login], [data-testid=money-account]')) t.limits = performance.now();
      }).observe(document, { childList: true, subtree: true });
    });
    await page.routeWebSocket('**/*', socket => socket.close());
    await page.route('**/*', route => new URL(route.request().url()).origin === base ? route.fallback() : route.abort());
    await page.route(`${base}/api/**`, route => {
      const body = respond(new URL(route.request().url()).pathname, s);
      if (body === 'hang') return; // never answers: the loading state
      if (body === 'fail') return route.fulfill({ status: 502, json: {} });
      return body === undefined ? route.fulfill({ status: 404, json: {} }) : route.fulfill({ json: body });
    });
    await page.goto(base + '/' + LOC);
    await page.getByTestId('usage-page').waitFor({ timeout: 20000 });
    if (s !== 'loading') await page.locator('[data-testid=usage-login], [data-testid=money-account]').first().waitFor({ timeout: 20000 }).catch(() => {});
    await page.waitForTimeout(warm ? 200 : 700);
    return { page, errors };
  };
  { const { page } = await open('near', 1440, { warm: true }); await page.close(); }
  const states = BEFORE ? ['near'] : ['near', 'fine', 'cached', 'loading', 'missing', 'many'];
  for (const s of states) for (const width of [1440, 390]) {
    const { page, errors } = await open(s, width);
    const t = await page.evaluate(() => window.__usageTimes);
    if (s === 'near') (timings[width] ??= []).push(t);
    await page.screenshot({ path: path.join(shots, `${tag}-${s}-${width}.png`) });
    if (s === 'near') { // where the accounts are on the page today: scrolled to them
      await page.locator('[data-testid=money-band]').first().scrollIntoViewIfNeeded().catch(() => {});
      await page.waitForTimeout(200);
      await page.screenshot({ path: path.join(shots, `${tag}-${s}-${width}-accounts.png`) });
    }
    if (!BEFORE) await checks(page, s, width);
    assert.deepEqual(errors, [], `${s} ${width}: no page errors`);
    done.push(`${s}@${width}`);
    await page.close();
  }
  // Repeat the measured visit to get a median, not one noisy sample.
  for (let i = 0; i < 4; i++) for (const width of [1440, 390]) { const { page } = await open('near', width); timings[width].push(await page.evaluate(() => window.__usageTimes)); await page.close(); }
  if (!BEFORE) {
    // Motion: with motion allowed the meters fill (a transform transition), and nothing animates while idle.
    const { page } = await open('near', 1440, { motion: 'no-preference' });
    const motion = await page.evaluate(() => {
      const fill = document.querySelector('[data-testid=usage-login] .ul-meter__fill');
      const cs = fill && getComputedStyle(fill);
      return { property: cs?.transitionProperty, duration: cs?.transitionDuration, loops: document.getAnimations().filter(a => a.playState === 'running' && a.effect?.getTiming().iterations === Infinity).map(a => { const t = a.effect?.target; return `${a.animationName ?? a.constructor.name} ${t?.className?.baseVal ?? t?.className ?? ''} ${t?.closest?.('[data-testid=usage-page]') ? 'IN-USAGE' : ''}`; }) };
    });
    assert.match(motion.property ?? '', /transform/, 'the meter fill moves by transform');
    const ms = parseFloat(motion.duration) * (/ms$/.test(motion.duration ?? '') ? 1 : 1000);
    assert.ok(ms >= 120 && ms <= 240, `120-240 ms fill, got ${motion.duration}`);
    console.log('idle loops on the whole app:', JSON.stringify(motion.loops));
    assert.equal(motion.loops.filter(l => l.includes('IN-USAGE')).length, 0, 'nothing on the Usage page loops while idle');
    await page.close();
  }
  const median = xs => xs.sort((a, b) => a - b)[Math.floor(xs.length / 2)];
  const summary = Object.fromEntries(Object.entries(timings).map(([w, xs]) => [w, { page: Math.round(median(xs.map(x => x.page ?? NaN))), limits: Math.round(median(xs.map(x => x.limits ?? NaN))), samples: xs.length }]));
  writeFileSync(path.join(shots, `${tag}-timings.json`), JSON.stringify(summary, null, 1));
  console.log(BEFORE ? 'before shots taken' : 'PASS usage 20261009', JSON.stringify({ done, timings: summary }));
} finally { await browser?.close(); await server?.close(); }

async function checks(page, s, width) {
  const answer = page.getByTestId('usage-answer');
  await answer.waitFor({ timeout: 5000 });
  const state = await answer.getAttribute('data-state');
  const say = (await answer.getByTestId('usage-headline').innerText()).replace(/\s+/g, ' ');
  const logins = page.getByTestId('usage-login');
  const quiet = page.getByTestId('usage-quiet');
  if (s === 'loading') {
    assert.equal(state, 'loading', 'loading: the answer says it is reading');
    assert.match(say, /Reading/, 'loading words');
    assert.equal(await logins.count(), 0, 'loading: no made-up meters');
    return;
  }
  // Answer above the fold: its top is inside the first screen on both sizes.
  const box = await answer.boundingBox();
  assert.ok(box && box.y < (width < 700 ? 300 : 200), `${s} ${width}: the answer is at the top (y=${box?.y})`);
  const names = await logins.evaluateAll(xs => xs.map(x => x.getAttribute('data-login')));
  if (s === 'near' || s === 'many' || s === 'cached') {
    assert.equal(state, 'near', `${s}: one login near its limit`);
    assert.match(say, /lordsisodia/, 'names the login');
    assert.match(say, /92%/, 'how much is used');
    assert.match(say, /resets in (57|58)m/, 'when it resets, in words');
    assert.deepEqual(names, ['lordsisodia', 'fuzeheritage'], 'the near login comes first; Fahmy is not a card');
    const hot = logins.first();
    assert.equal(await hot.getAttribute('data-near'), 'true', 'the near login stands out');
    assert.equal(await logins.nth(1).getAttribute('data-near'), 'false', 'only one stands out');
    const meter = hot.locator('[data-window=five-hour]');
    assert.equal(await meter.getAttribute('aria-valuenow'), '92', 'meter is a real meter');
    assert.match(await meter.innerText(), /resets in (57|58)m/, '5-hour reset on the meter');
    assert.match(await hot.locator('[data-window=week]').innerText(), /61%[\s\S]*resets in 4d (2|3)h/, 'week window and its reset');
  }
  if (s === 'fine') {
    assert.equal(state, 'fine', 'fine: every login has room');
    assert.match(say, /room/i, 'fine words');
    assert.match(say, /lordsisodia[\s\S]*in (57|58)m/, 'fine still says the next reset');
    assert.equal(await page.locator('[data-testid=usage-login][data-near=true]').count(), 0, 'nothing stands out when fine');
  }
  if (s === 'cached') {
    assert.match(await answer.innerText(), /from the last run/i, 'cached says so');
  }
  if (s !== 'missing') {
    const codex = (await page.getByTestId('usage-codex').innerText()).replace(/\s+/g, ' ');
    assert.match(codex, /56,604/, 'Codex credits left');
    assert.match(codex, /60,000/, 'of the weekly budget');
    assert.match((await page.getByTestId('usage-today').innerText()), /\$41\.37/, "today's spend");
    assert.equal(await quiet.count(), s === 'cached' ? 1 : 0, `${s}: no quiet line when every source reports`);
  }
  if (s === 'missing') {
    assert.equal(state, 'unknown', 'missing: a silent login is no all-clear');
    assert.match(say, /lordsisodia is not reporting its limits/, 'the headline names the silent login');
    const text = (await quiet.innerText()).replace(/\s+/g, ' ');
    assert.equal(await quiet.count(), 1, 'one quiet line');
    assert.match(text, /lordsisodia not reporting/, 'the silent login is named');
    assert.match(text, /fuzeheritage read 3h ago/, 'the stale login says how old');
    assert.match(text, /spend report/i, 'spend report missing');
    assert.match(text, /Codex/, 'Codex credits missing');
    assert.match(await page.locator('[data-testid=usage-login][data-login=lordsisodia]').innerText(), /not reported/, 'the silent login shows not reported, not 0%');
  }
  const burners = page.getByTestId('usage-burner');
  if (s === 'many') {
    assert.equal(await burners.count(), 7, '7 burners shown');
    const owners = await burners.evaluateAll(xs => xs.map(x => x.getAttribute('data-owner')));
    assert.equal(owners.filter(o => /agent.?zero/i.test(o)).length, 1, 'Agent Zero and agent-zero are one owner');
    assert.equal(owners[0], 'Agent Zero', 'merged owner sums to the top ($15.60)');
    const more = page.getByTestId('usage-burners-more');
    assert.match(await more.innerText(), /4 more/, '11 owners: 4 more');
    await more.click();
    assert.equal(await burners.count(), 11, 'all owners after more');
    const long = burners.filter({ hasText: 'A-VERY-LONG' });
    const lb = await long.boundingBox(), list = await page.getByTestId('usage-burners').boundingBox();
    assert.ok(lb.x + lb.width <= list.x + list.width + 1, 'a long owner name stays inside the list');
  }
}
