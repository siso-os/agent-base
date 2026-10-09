// The ctx ring's card (Opus UI wave, 9 Oct; Shaan 4 Oct on ideas round 2: "the context one really good"). Synthetic full app,
// sealed API, never the live node. One page per state: normal (long file label), loading, 404, very full, just compacted.
// BEFORE=1 takes shots and timings only (run against the old files).   heavy -- node services/node/test/context-20261009-ui.mjs
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { webkit } from './suite-runtime.mjs';
import { fixtureResponse } from '../../../tools/ab-qa-fixtures.mjs';

const root = path.resolve(import.meta.dirname, '../../..');
const { createServer } = createRequire(path.join(root, 'apps/web/package.json'))('vite');
const shots = path.join(root, 'ui-hub/context-20261009');
mkdirSync(shots, { recursive: true });
const BEFORE = !!process.env.BEFORE, tag = BEFORE ? 'before' : 'after';
const LONG = 'packages/siso-composer/src/a-very-long-generated-file-name-that-never-ends-for-overflow-checks.generated.tsx';
const MIX = {
  kinds: { files: 38200, talk: 21400, subagents: 14100, shell: 9300, tools: 4100 },
  top: [{ label: `Read ${LONG}`, tokens: 18200 }, { label: 'Agent Survey the context-mix route and every caller across services/node', tokens: 9100 }, { label: 'Bash heavy -- node services/node/test/stuck-messages.mjs', tokens: 4800 }],
  turns: ['make the ctx card answer how full am I at a glance', 'run the sealed test again', 'why is the ring amber', 'add the long-label state', 'check it at 390', 'push the branch'].map((text, back) => ({ back, text })),
  files: [{ label: path.basename(LONG), state: 'changed' }, { label: 'Hud.tsx', state: 'changed' }, { label: 'ComposerHud.tsx', state: 'unchanged' }, { label: 'context-mix.ts', state: 'unchanged' }, { label: 'hud.css', state: 'unchanged' }, { label: 'poll.ts', state: 'unknown' }, { label: 'agents.ts', state: 'unchanged' }, { label: 'SPEC.md', state: 'unchanged' }],
  at: 1791244800000,
};
const EMPTY = { kinds: { files: 0, shell: 0, subagents: 0, talk: 0, tools: 0 }, top: [], turns: MIX.turns.slice(0, 2), files: [], at: 1791244800000 };
// state -> [context % per /api/agents read, the /context answer]
const STATES = {
  normal: { ctx: [46], mix: MIX },
  loading: { ctx: [46], mix: 'hold' },
  missing: { ctx: [31], mix: 404 },
  full: { ctx: [93], mix: MIX },
  compacted: { ctx: [82, 9], mix: EMPTY },
};
const withHud = (pct) => {
  const body = structuredClone(fixtureResponse('/api/agents', 'fixture')), zero = body.agents[0];
  zero.tool = 'claude'; zero.compactAt = 60;
  zero.hud = { context: pct, model: 'claude-opus-5-5[1m]', tokensIn: 412000, tokensOut: 18300, cachePct: 91, costUsd: 3.42, fiveHour: { pct: 34, resetsAt: null }, week: { pct: 58, resetsAt: null }, at: Date.now(), accountId: null };
  return body;
};
let server, browser;
const timings = {}, results = [];
try {
  server = await createServer({ root: path.join(root, 'apps/web'), configFile: path.join(root, 'apps/web/vite.config.ts'), logLevel: 'error',
    plugins: [{ name: 'sealed-api', configureServer(v) { v.middlewares.use((req, res, next) => { if (/^\/(api|chat|term)\b/.test(req.url ?? '')) { res.statusCode = 410; res.end('Fixture only'); return; } next(); }); } }],
    server: { host: '127.0.0.1', port: 0, strictPort: false, hmr: false, watch: { ignored: ['**/*'] } } });
  await server.listen();
  const base = `http://127.0.0.1:${server.httpServer.address().port}`;
  browser = await webkit.launch({ headless: true });
  for (const width of [1440, 390]) for (const [name, st] of Object.entries(STATES)) {
    const height = width < 700 ? 844 : 900, errors = [];
    const page = await browser.newPage({ viewport: { width, height }, reducedMotion: 'reduce' });
    page.on('pageerror', e => errors.push(e.message));
    await page.addInitScript(() => { window.EventSource = undefined; });
    await page.routeWebSocket('**/*', socket => socket.close());
    await page.route('**/*', route => new URL(route.request().url()).origin === base ? route.fallback() : route.abort());
    let reads = 0, release;
    const held = new Promise(r => { release = r; });
    await page.route(`${base}/api/**`, async route => {
      const p = new URL(route.request().url()).pathname;
      if (p === '/api/agents') return route.fulfill({ json: withHud(st.ctx[Math.min(reads, st.ctx.length - 1)]) });
      if (/\/context$/.test(p)) {
        if (st.mix === 404) return route.fulfill({ status: 404, json: { error: 'no Claude session file for this chat' } });
        if (st.mix === 'hold') await held;
        return route.fulfill({ json: st.mix === 'hold' ? MIX : st.mix });
      }
      const body = fixtureResponse(p, 'fixture');
      return body === undefined ? route.fulfill({ status: 404, json: {} }) : route.fulfill({ json: body });
    });
    await page.goto(base);
    if (width < 700) await page.locator(':text-is("Agent Zero"):visible').first().click(); // the phone opens on the nav
    const trigger = page.locator('.ab-hud.is-rim .ab-context-trigger:visible').first();
    await trigger.waitFor({ timeout: 15000 }).catch(async e => { await page.screenshot({ path: path.join(shots, "debug.png") }); console.log(await page.evaluate(() => [...document.querySelectorAll(".ab-hud")].map(h => h.className + " " + h.getBoundingClientRect().width + " " + h.innerText.slice(0,80)))); throw e; });
    // Just compacted: the next agents read (the app polls every 5 s) brings the drop from 82 % to 9 %.
    if (st.ctx.length > 1) {
      await page.waitForFunction(() => document.querySelector('.ab-hud.is-rim [role=meter]')?.getAttribute('aria-valuenow') === '82', null, { timeout: 12000 });
      reads = 1;
    }
    if (st.ctx.length > 1) await page.waitForFunction(() => document.querySelector('.ab-hud.is-rim [role=meter]')?.getAttribute('aria-valuenow') === '9', null, { timeout: 12000 });
    await page.waitForTimeout(700);
    const hud = await trigger.evaluate(el => { const r = el.closest('.ab-hud').getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; });
    // Click to visible, measured in the page: the click, then the frame after the card is in the DOM and painted at opacity > 0.
    if (name === 'normal') {
      const runs = [];
      for (const motion of ['reduce', 'no-preference']) {
        await page.emulateMedia({ reducedMotion: motion });
        const ms = [];
        for (let i = 0; i < 8; i++) {
          ms.push(await trigger.evaluate(el => new Promise(done => {
            const t0 = performance.now();
            el.click();
            const look = () => { const p = document.querySelector('.ab-context-panel'); if (p && Number(getComputedStyle(p).opacity) > 0) requestAnimationFrame(() => done({ visible: performance.now() - t0, settled: null })); else requestAnimationFrame(look); };
            look();
          })));
          ms[ms.length - 1].settled = await page.evaluate(() => new Promise(done => { const t0 = performance.now(); const p = document.querySelector('.ab-context-panel'); const a = p?.getAnimations?.() ?? []; Promise.all(a.map(x => x.finished)).then(() => done(performance.now() - t0)); }));
          await page.keyboard.press('Escape');
          await page.waitForTimeout(250);
        }
        const med = (k) => { const v = ms.map(m => m[k]).sort((a, b) => a - b); return Math.round(v[v.length >> 1] * 10) / 10; };
        runs.push({ motion, clickToVisibleMs: med('visible'), animationTailMs: med('settled') });
      }
      timings[width] = runs;
      await page.emulateMedia({ reducedMotion: 'reduce' });
    }
    await trigger.click();
    const panel = page.locator('.ab-context-panel');
    await panel.waitFor();
    await page.waitForTimeout(st.mix === 'hold' ? 150 : 500);
    const box = await panel.boundingBox();
    const clip = { x: Math.max(0, Math.min(box.x, hud.x) - 12), y: Math.max(0, box.y - 12) };
    clip.width = Math.min(width - clip.x, Math.max(box.x + box.width, hud.x + Math.min(hud.width, 520)) - clip.x + 12);
    clip.height = Math.min(height - clip.y, hud.y + hud.height + 12 - clip.y);
    await page.screenshot({ path: path.join(shots, `${tag}-${name}-${width}.png`), clip });
    if (!BEFORE) {
      const card = page.getByTestId('ctx-card');
      assert.equal(await card.count(), 1, `${name}: the card body is ours`);
      const overflow = await panel.evaluate(p => p.scrollWidth - p.clientWidth);
      assert.ok(overflow <= 0, `${name} @${width}: nothing pushes the card sideways (${overflow}px)`);
      assert.ok(box.x >= 0 && box.x + box.width <= width, `${name} @${width}: the card is inside the window`);
      const gauge = page.getByTestId('ctx-gauge');
      if (name === 'normal') {
        assert.equal(await gauge.getAttribute('data-level'), 'ok');
        assert.match(await gauge.innerText(), /46%/);
        assert.match(await page.getByTestId('ctx-headroom').innerText(), /^14 points to go before it compacts$/);
        const rows = page.getByTestId('ctx-top').locator('li');
        assert.equal(await rows.count(), 3, 'the three biggest, one row each');
        const long = rows.first().locator('.ab-ctx__top-label');
        assert.equal(await long.getAttribute('title'), `Read ${LONG}`, 'the full label is one hover away');
        assert.ok(await long.evaluate(el => el.scrollWidth > el.clientWidth), 'the long label is cut with an ellipsis, not wrapped');
        assert.match(await page.getByTestId('ctx-files').locator('h4').innerText(), /2 changed of 8/);
        assert.equal(await page.getByTestId('ctx-files').locator('b[data-state=changed]:visible').count(), 2, 'changed files stay in view; the rest fold');
        assert.equal(await page.getByTestId('hud-compact').count(), 0, 'no compact button below the mark');
        assert.equal(await page.locator('.ab-fork summary').count(), 1, 'fork from a turn is still there');
      } else if (name === 'loading') {
        assert.equal(await page.getByTestId('ctx-loading').getAttribute('aria-busy'), 'true');
        assert.match(await page.getByTestId('ctx-headroom').innerText(), /14 points to go/, 'the gauge does not wait for the breakdown');
        release();
        await page.getByTestId('ctx-top').waitFor({ timeout: 5000 });
        assert.equal(await page.getByTestId('ctx-loading').count(), 0, 'loading gives way to the breakdown');
      } else if (name === 'missing') {
        const note = page.getByTestId('ctx-none');
        assert.match(await note.innerText(), /no Claude session file/i, 'the honest one-liner');
        assert.equal(await card.locator('[role=alert]').count(), 0, 'a missing file is not an error');
        assert.match(await gauge.innerText(), /31%/, 'the ring\'s own figure still shows');
      } else if (name === 'full') {
        assert.equal(await gauge.getAttribute('data-level'), 'full');
        assert.match(await page.getByTestId('ctx-headroom').innerText(), /nearly full/i);
        const actions = page.getByTestId('ctx-actions');
        assert.equal(await actions.locator('button').first().getAttribute('data-testid'), 'hud-compact', 'compact leads the actions');
      } else if (name === 'compacted') {
        assert.match(await page.getByTestId('ctx-compacted').innerText(), /Compacted .* was 82%/);
        assert.match(await page.getByTestId('ctx-none').innerText(), /nothing carried yet/i, 'an empty mix after compaction says so instead of a blank');
      }
      // Opening is a transform/opacity animation unless reduced motion is asked for.
      await page.keyboard.press('Escape');
      await page.emulateMedia({ reducedMotion: 'no-preference' });
      await trigger.evaluate(el => el.click());
      await panel.waitFor();
      assert.notEqual(await panel.evaluate(p => getComputedStyle(p).animationName), 'none', 'the card opens with motion');
      await page.keyboard.press('Escape');
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await trigger.evaluate(el => el.click());
      await panel.waitFor();
      assert.equal(await panel.evaluate(p => getComputedStyle(p).animationName), 'none', 'reduced motion opens it still');
    }
    release();
    assert.deepEqual(errors, []);
    results.push(`${name}@${width}`);
    await page.close();
  }
  writeFileSync(path.join(shots, `timings-${tag}.json`), JSON.stringify(timings, null, 1));
  console.log(BEFORE ? 'before shots taken' : 'PASS context card', results.length, 'states', JSON.stringify(timings));
} finally { await browser?.close(); await server?.close(); }
