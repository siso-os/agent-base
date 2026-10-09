// Lane popups (9 Oct; Shaan 7 Oct 07:55: "when you hover over the icons ... it'd be nice if it was more reactive, just feels
// too sluggish ... the layering's kind of weird"). The agent card opens after a 120 ms rest, swaps at once between agents
// with one card at a time and no blink, does not steal while the pointer aims at the open card, keeps a grace period on
// leave, closes on Esc, and paints only after the native browser view hides. Also: 5 notifications at once, 5 toasts.
// Sealed: a vite fixture page (apps/web/preview/popups.html), fetch refused, synthetic native IPC. Never the live node.
//   heavy -- node services/node/test/popups-20261009-ui.mjs            (asserts, after shots, timings)
//   heavy -- node services/node/test/popups-20261009-ui.mjs --before   (origin/main's sources: shots and timings only)
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { webkit } from './suite-runtime.mjs';

const root = path.resolve(import.meta.dirname, '../../..');
const { createServer } = createRequire(path.join(root, 'apps/web/package.json'))('vite');
const BEFORE = process.argv.includes('--before');
const tag = BEFORE ? 'before' : 'after';
const shots = path.join(root, 'ui-hub/popups-20261009');
mkdirSync(shots, { recursive: true });
const baseline = execFileSync('git', ['rev-parse', 'origin/main'], { cwd: root, encoding: 'utf8' }).trim();
// --before serves origin/main's app sources (git show), so one checkout measures both sides with the same fixture.
const baselineSource = { name: 'popups-baseline', enforce: 'pre', load(id) {
  if (!BEFORE) return;
  const rel = path.relative(root, id.split('?')[0]);
  if (!/^(apps\/web\/src|packages)\//.test(rel) || /node_modules/.test(rel) || !/\.(tsx?|css)$/.test(rel)) return;
  try { return execFileSync('git', ['show', `${baseline}:${rel}`], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }); } catch { return; }
} };
const NAMES = ['Agent Zero', 'STREAMING', 'FRESH-WORKER', 'LONG-REPORT-OWNER-WITH-A-VERY-LONG-NAME', 'AGENT-BASE', 'OPERATOR-UI', 'EFFICIENCY', 'ESTATE', 'ROLODEX', 'HEALTH'];
const ROW = { x: 140, y0: 56 + 17, h: 34 };
const rowY = i => ROW.y0 + i * ROW.h;

// In the page: every pointerover on a row, every frame (how many cards are visible, whose), and the instant each agent's
// card first turns visible (a MutationObserver, so not frame-quantised).
const instrument = () => {
  const m = window.__m = { enters: [], frames: [], shown: [], native: [] };
  const visible = () => [...document.querySelectorAll('.ab-hover-card:not(.is-preview)')].filter(c => getComputedStyle(c).visibility === 'visible');
  const name = c => c.querySelector('.ab-hover-identity strong')?.textContent ?? '';
  let last = '';
  document.addEventListener('DOMContentLoaded', () => new MutationObserver(() => { const v = visible(); const n = v.map(name).join('|'); if (n !== last) { last = n; m.shown.push({ t: performance.now(), names: n }); } })
    .observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ['style', 'hidden'] }));
  document.addEventListener('pointerover', e => { const row = e.target.closest?.('[data-testid=agent-row]'); if (row && m.enters.at(-1)?.i !== row.dataset.i) m.enters.push({ i: row.dataset.i, t: performance.now() }); }, true);
  const loop = t => { const v = visible(); const s = document.querySelector('[data-testid=native-surface]'); m.frames.push({ t, n: v.length, name: v.map(name).join('|'), under: !!(v.length && s && !s.hidden) }); requestAnimationFrame(loop); };
  requestAnimationFrame(loop);
};
const reset = page => page.evaluate(() => { const m = window.__m; m.enters.length = 0; m.frames.length = 0; m.shown.length = 0; });
const read = page => page.evaluate(() => window.__m);
/** For each row entered: ms from the pointer arriving to that agent's card being visible (null: it never showed). */
function latencies(m) {
  return m.enters.map(e => { const s = m.shown.find(x => x.t >= e.t && x.names.split('|').includes(NAMES[e.i])); return { i: Number(e.i), ms: s ? Math.round(s.t - e.t) : null }; });
}
function frameStats(m, from, to) {
  const f = m.frames.filter(x => x.t >= from && x.t <= to);
  const deltas = f.slice(1).map((x, i) => x.t - f[i].t).sort((a, b) => a - b);
  const median = deltas[Math.floor(deltas.length / 2)] ?? 16.7;
  return { frames: f.length, median: Math.round(median * 10) / 10, dropped: deltas.filter(d => d > median * 1.5 + 2).length, maxCards: Math.max(0, ...f.map(x => x.n)), blankFrames: f.filter(x => x.n === 0).length, coveredByNative: f.filter(x => x.under).length };
}
const away = async page => { await page.mouse.move(900, 860, { steps: 2 }); await page.keyboard.press('Escape'); await page.waitForTimeout(700); };

let server, browser;
const out = { baseline: BEFORE ? baseline : undefined, engine: 'WebKit (headless)', ipc: 'synthetic native IPC, browser_visible(false) takes 30 ms', sizes: {} };
try {
  server = await createServer({ configFile: path.join(root, 'apps/web/vite.config.ts'), root: path.join(root, 'apps/web'), logLevel: 'error', plugins: [baselineSource],
    optimizeDeps: { entries: ['preview/popups.html'] }, server: { host: '127.0.0.1', port: 0, strictPort: false, watch: { ignored: ['**/*'] }, hmr: false, proxy: {} } });
  await server.listen();
  const base = `http://127.0.0.1:${server.httpServer.address().port}`;
  browser = await webkit.launch({ headless: true });
  for (const [width, height] of [[1440, 900], [390, 844]]) {
    const r = out.sizes[width] = {};
    const page = await browser.newPage({ viewport: { width, height } });
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.addInitScript(instrument);
    await page.route('**/*', route => new URL(route.request().url()).origin === base ? route.fallback() : route.abort());
    const open = async (q = '') => { await page.goto(`${base}/preview/popups.html${q}`); await page.getByTestId('agent-row').nth(9).waitFor(); await page.waitForTimeout(400); };
    const card = page.locator('.ab-hover-card:not(.is-preview)');
    await open();

    if (width === 1440) {
      // 1. Cold: rest on Agent Zero's row.
      await page.mouse.move(900, 860); await page.waitForTimeout(500); await reset(page);
      await page.mouse.move(ROW.x, rowY(0), { steps: 3 }); await page.waitForTimeout(600);
      r.cold = latencies(await read(page))[0]?.ms;
      // 2. The sweep: from that open card, rest 450 ms on each of the next 9 agents (moving 34 px each time).
      await reset(page);
      const t0 = await page.evaluate(() => performance.now());
      for (let i = 1; i < 10; i++) { await page.mouse.move(ROW.x, rowY(i), { steps: 4 }); await page.waitForTimeout(450); }
      let m = await read(page);
      const t1 = await page.evaluate(() => performance.now());
      r.sweep = { perRow: latencies(m), ...frameStats(m, (m.shown[0]?.t ?? t0), t1) };
      const swaps = r.sweep.perRow.map(x => x.ms).filter(x => x !== null);
      r.sweep.medianSwapMs = swaps.sort((a, b) => a - b)[Math.floor(swaps.length / 2)] ?? null;
      // 3. A quick pass: crossing all ten rows at 40 ms a row opens nothing (intent), then a rest opens the last.
      // A trial counts only if the pointer really kept moving (every in-page dwell under 100 ms): a busy machine can stall
      // Playwright past the intent delay, which is a rest, not a crossing. Up to three trials.
      r.quickPass = { trials: [] };
      for (let trial = 0; trial < 3 && r.quickPass.valid === undefined; trial++) {
        await away(page); await reset(page);
        for (let i = 0; i < 10; i++) { await page.mouse.move(ROW.x, rowY(i), { steps: 2 }); await page.waitForTimeout(40); }
        const q = await page.evaluate(() => ({ opened: window.__m.shown.filter(s => s.names).length, dwell: window.__m.enters.slice(1).map((e, i) => Math.round(e.t - window.__m.enters[i].t)) }));
        r.quickPass.trials.push(q);
        if (q.dwell.length === 9 && Math.max(...q.dwell) < 100) r.quickPass.valid = q;
      }
      r.quickPass.cardsOpenedWhileCrossing = r.quickPass.valid?.opened ?? null;
      await page.waitForTimeout(500);
      r.quickPass.restOpened = await card.count() === 1;
      // 4. Aiming: from Agent Zero's open card, a diagonal toward it crossing two rows keeps Agent Zero's card.
      await away(page);
      await page.mouse.move(ROW.x, rowY(0), { steps: 2 }); await card.waitFor(); await page.waitForTimeout(250);
      await reset(page);
      const box = await card.boundingBox();
      await page.mouse.move(ROW.x + 60, rowY(0) + 20, { steps: 2 });
      await page.mouse.move(ROW.x + 120, rowY(2), { steps: 3 });
      await page.mouse.move(box.x + 30, rowY(2) + 10, { steps: 3 });
      await page.waitForTimeout(350);
      m = await read(page);
      r.aim = { stolenBy: [...new Set(m.frames.map(f => f.name).filter(n => n && n !== NAMES[0]))], kept: (await card.locator('.ab-hover-identity strong').textContent()) === NAMES[0] };
      // 5. Grace: leaving the card for empty space closes it after the grace period, not at once.
      await reset(page);
      const left = await page.evaluate(() => performance.now());
      await page.mouse.move(900, 860, { steps: 1 });
      await card.waitFor({ state: 'detached', timeout: 3000 });
      m = await read(page);
      r.graceMs = Math.round((m.shown.find(s => !s.names)?.t ?? left) - left);
      // 6. Esc closes it.
      await page.mouse.move(ROW.x, rowY(0), { steps: 2 }); await card.waitFor();
      await page.keyboard.press('Escape'); await page.waitForTimeout(80);
      r.escCloses = await card.count() === 0;
      // 7. A working agent's report updates while its card is open: same card, new words.
      await page.mouse.move(900, 860); await page.waitForTimeout(600);
      await page.mouse.move(ROW.x, rowY(1), { steps: 2 }); await card.waitFor(); await page.waitForTimeout(300);
      await page.evaluate(() => window.__tick()); await page.waitForTimeout(250);
      await page.evaluate(() => window.__tick()); await page.waitForTimeout(250);
      r.live = { text: (await card.locator('.ab-hover-report p').textContent())?.slice(0, 60), cards: await card.count() };
      await page.screenshot({ path: path.join(shots, `${tag}-live-${width}.png`) });
    }

    // States at both sizes: no chat yet, the very long message.
    const rest = async i => { await page.mouse.move(width - 10, height - 10); await page.keyboard.press('Escape'); await page.waitForTimeout(600); const row = page.getByTestId('agent-row').nth(i); const b = await row.boundingBox(); await page.mouse.move(b.x + 40, b.y + b.height / 2, { steps: 2 }); await card.waitFor(); await page.waitForTimeout(350); };
    await rest(2);
    r.noChat = (await card.innerText()).replace(/\s+/g, ' ').slice(0, 200);
    await page.screenshot({ path: path.join(shots, `${tag}-nochat-${width}.png`) });
    await rest(3);
    const long = await card.evaluate(c => { const b = c.getBoundingClientRect(), p = c.querySelector('.ab-hover-report p'); return { top: b.top, bottom: b.bottom, left: b.left, right: b.right, clamped: !!p && p.scrollHeight > p.clientHeight + 1, cardScrolls: c.scrollHeight > c.clientHeight + 1 }; });
    r.long = { ...long, inside: long.top >= 7 && long.left >= 7 && long.bottom <= height - 7 && long.right <= width - 7 };
    await page.screenshot({ path: path.join(shots, `${tag}-long-${width}.png`) });

    // The native browser view: the card never paints under it; a swap between agents does not wait on it again.
    if (width === 1440) {
      await open('?native&ipc=30');
      await page.getByTestId('native-surface').waitFor();
      await page.mouse.move(900, 860); await page.waitForTimeout(500); await reset(page);
      await page.mouse.move(ROW.x, rowY(0), { steps: 3 }); await page.waitForTimeout(600);
      for (let i = 1; i < 5; i++) { await page.mouse.move(ROW.x, rowY(i), { steps: 4 }); await page.waitForTimeout(450); }
      const m = await read(page);
      const lat = latencies(m);
      r.native = { cold: lat[0]?.ms, swaps: lat.slice(1).map(x => x.ms), ...frameStats(m, m.shown[0]?.t ?? 0, Infinity) };
      await page.screenshot({ path: path.join(shots, `${tag}-native-${width}.png`) });
    }

    // Five notifications at once, and five toasts.
    await open('?notes=5&toasts=5');
    await page.getByRole('button', { name: /Agents notifications/ }).click();
    const panel = page.locator('.an-panel');
    await panel.waitFor();
    await page.waitForTimeout(400);
    r.notes = { items: await panel.locator('.an-item').count(), overlay: await panel.getAttribute('data-native-overlay') };
    r.toasts = { visible: await page.locator('#ab-toast-stack .ab-toast:visible').count(), more: await page.locator('#ab-toast-stack').getAttribute('data-more') };
    await page.screenshot({ path: path.join(shots, `${tag}-five-${width}.png`) });
    if (!BEFORE) { await page.locator('#ab-toast-stack .ab-toast:visible').last().hover(); await page.waitForTimeout(250); r.toasts.onHover = await page.locator('#ab-toast-stack .ab-toast:visible').count(); await page.screenshot({ path: path.join(shots, `${tag}-toasts-open-${width}.png`) }); }
    r.errors = errors;
    await page.close();
  }
  writeFileSync(path.join(shots, `timings-${tag}.json`), JSON.stringify(out, null, 2) + '\n');
  const s = out.sizes[1440];
  console.log(JSON.stringify({ cold: s.cold, swapMedian: s.sweep.medianSwapMs, swaps: s.sweep.perRow.map(x => x.ms), dropped: s.sweep.dropped, frames: s.sweep.frames, blank: s.sweep.blankFrames, maxCards: s.sweep.maxCards, quick: { opened: s.quickPass.cardsOpenedWhileCrossing, trials: s.quickPass.trials.length, rest: s.quickPass.restOpened }, aim: s.aim, grace: s.graceMs, native: { cold: s.native.cold, swaps: s.native.swaps, dropped: s.native.dropped, frames: s.native.frames, blank: s.native.blankFrames } }));

  if (!BEFORE) {
    const d = out.sizes[1440], p = out.sizes[390];
    assert.deepEqual([...d.errors, ...p.errors], [], 'no page errors');
    assert(d.cold >= 100 && d.cold <= 200, `cold open waits for intent (~120 ms): ${d.cold}`);
    // At once = no intent wait: under the 120 ms delay every time, about a frame at the median (the mini is shared, so slack).
    assert(d.sweep.perRow.every(x => x.ms !== null && x.ms < 100) && d.sweep.medianSwapMs <= 50, `every agent's card swaps in at once: ${JSON.stringify(d.sweep.perRow)}`);
    assert.equal(d.sweep.maxCards, 1, 'one card at a time');
    assert.equal(d.sweep.blankFrames, 0, 'no blank frame between agents (no flicker)');
    assert(d.quickPass.valid, `BLOCKED: the machine stalled every quick-pass trial past the intent delay: ${JSON.stringify(d.quickPass.trials)}`);
    assert.equal(d.quickPass.cardsOpenedWhileCrossing, 0, 'crossing rows quickly opens nothing');
    assert(d.quickPass.restOpened, 'a rest at the end opens the card');
    assert(d.aim.kept && d.aim.stolenBy.length === 0, `aiming at the card keeps it: ${JSON.stringify(d.aim)}`);
    assert(d.graceMs >= 250 && d.graceMs <= 500, `grace period on leave: ${d.graceMs}`);
    assert(d.escCloses, 'Esc closes the card');
    assert(d.live.cards === 1 && /minute 10/.test(d.live.text), `the open card follows the working agent: ${JSON.stringify(d.live)}`);
    for (const s of [d, p]) {
      assert.match(s.noChat, /No chat yet/, 'an agent with no chat says so');
      assert(s.long.inside && s.long.clamped, `the long message is clamped inside the window: ${JSON.stringify(s.long)}`);
      assert.equal(s.notes.items, 5, 'five notifications render');
      assert.equal(s.notes.overlay, 'true', 'the open notification panel hides the native view');
      assert.equal(s.toasts.visible, 3, 'five toasts: the newest three show');
      assert.equal(s.toasts.more, '2', 'and say how many more (+2 more)');
      assert.equal(s.toasts.onHover, 5, 'hovering the stack shows all five');
    }
    assert.equal(d.native.coveredByNative, 0, 'a card never paints while the native view is up');
    assert(d.native.swaps.every(x => x !== null && x < 100), `swaps over the browser do not wait on the native view: ${d.native.swaps}`);
    console.log('PASS popups 20261009 at 1440 and 390');
  } else console.log('before captured from origin/main', baseline);
} finally { await browser?.close(); await server?.close(); }
