// Life lane, 9 Oct (Shaan, 7 Oct: "bring those primitives over to redo the nightly ... the calorie trackers ... weekly monthly
// yearly ... look nice work function well"). Synthetic Life API in the browser (page.route), sealed vite, headless WebKit;
// never the live node, never the real siso-life. States: first day (empty), a full day, a missed day, a long note.
// BEFORE=1 takes shots and the check-off timing only.   heavy -- node services/node/test/life-20261009-ui.mjs
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { webkit } from './suite-runtime.mjs';

const root = path.resolve(import.meta.dirname, '../../..');
const { createServer } = createRequire(path.join(root, 'apps/web/package.json'))('vite');
const shots = path.join(root, 'ui-hub/life-20261009');
mkdirSync(shots, { recursive: true });
const BEFORE = !!process.env.BEFORE, tag = BEFORE ? 'before' : 'after';
const SHOTS = process.env.SHOTS !== '0';

// ---- the synthetic Life API (the same fold siso-life does; scoring is invented, not Rust parity) ----
const CONFIG = {
  version: 2, levelSize: 1000, streakMin: 200, dailyTarget: 1000,
  morning: ['wake', 'pushups', 'teeth', 'shower', 'cold_shower', 'supplements', 'meditation', 'plan'].map(key => ({ key, label: key })),
  counters: [
    { key: 'water', label: 'Water', unit: 'ml', inc: 250, goal: 2000, good: 'up' },
    { key: 'cigarettes', label: 'Cigarettes', unit: '', inc: 1, goal: 0, good: 'down' },
    { key: 'cravings', label: 'Cravings resisted', unit: '', inc: 1, good: 'up' },
    { key: 'alcohol', label: 'Drinks', unit: '', inc: 1, goal: 0, good: 'down' },
    { key: 'coffee', label: 'Coffee', unit: 'cups', inc: 1, good: 'neutral' },
  ], checkout: [], food: { kcalTarget: 2400, proteinTarget: 150, mealXp: 10, mealXpMax: 40, proteinXp: 30 },
};
const dayKey = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const today = dayKey(new Date());
const shift = (day, n) => { const d = new Date(day + 'T12:00:00'); d.setDate(d.getDate() + n); return dayKey(d); };
const yesterday = shift(today, -1);
const LONG = 'Shipped the Life pages after a long morning of going back and forth on the nightly layout, then walked for an hour, called home, cooked properly for once and still had energy for a second deep-work block in the evening. '.repeat(3).trim();

function scenario(name) {
  const events = new Map();
  const add = (day, kind, key, value, text) => { const id = `fx-${events.size}`; events.set(id, { id, day, kind, key, value, text, at: events.size }); };
  const meal = (day, n, m) => add(day, 'set', `meal.fx${n}`, undefined, JSON.stringify({ ...m, at: 1000 + n }));
  const fullDay = (day, i = 0) => {
    for (const key of ['wake', 'pushups', 'teeth', 'shower', 'supplements', 'meditation', 'plan']) add(day, 'check', key, 1);
    add(day, 'set', 'wake_time', undefined, i % 2 ? '07:15' : '06:50'); add(day, 'set', 'pushup_reps', 30 + (i % 7));
    add(day, 'set', 'meditation_min', 12); add(day, 'add', 'water', 1500 + (i % 4) * 250); add(day, 'add', 'coffee', 2);
    add(day, 'set', 'bed_time', undefined, i % 2 ? '23:30' : '00:15'); add(day, 'set', 'deep_hours', 5 + (i % 3));
    add(day, 'set', 'rating', 6 + (i % 4)); add(day, 'check', 'checkout', 1);
    add(day, 'set', 'tomorrow', undefined, 'Finish the Life review pages\nGym at 7\nCall the accountant');
    meal(day, 1, { name: 'Oats, berries and whey', kcal: 520, protein: 38, carbs: 70, fat: 9 });
    meal(day, 2, { name: 'Chicken rice bowl', kcal: 780, protein: 52, carbs: 90, fat: 18 });
  };
  if (name !== 'empty') for (let i = name === 'missed' ? 2 : 1; i <= 40; i++) if (i % 6) fullDay(shift(today, -i), i);
  if (name === 'full' || name === 'long') {
    fullDay(today);
    add(today, 'add', 'cravings', 1);
    add(today, 'set', 'priorities', undefined, 'Ship the Life pages\nGym\nPlan the week');
    add(today, 'set', 'went_well', undefined, name === 'long' ? LONG : 'Shipped the Life pages and still made the gym.');
    add(today, 'set', 'even_better', undefined, 'Start deep work before 9.');
    meal(today, 3, { name: name === 'long' ? 'Leftover slow-cooked lamb shoulder with roasted root vegetables, a big spoon of yoghurt and flatbread from the corner shop' : 'Salmon, potatoes, greens', kcal: 690, protein: 45, carbs: 55, fat: 28 });
  }
  return events;
}
function fold(events, day) {
  const state = { checks: {}, sets: {}, counters: {} };
  for (const e of [...events.values()].filter(e => e.day === day).sort((a, b) => a.at - b.at || (a.id < b.id ? -1 : 1))) {
    if (e.kind === 'check') state.checks[e.key] = (e.value ?? 1) !== 0;
    else if (e.kind === 'set') { const v = e.text ?? e.value; if (v === undefined || v === '') delete state.sets[e.key]; else state.sets[e.key] = v; }
    else state.counters[e.key] = Math.max(0, (state.counters[e.key] ?? 0) + (e.value ?? 0));
  }
  const items = Object.entries(state.checks).filter(([, v]) => v).map(([id]) => ({ id, label: id, xp: 50 }));
  if (state.counters.water) items.push({ id: 'water', label: 'Water', xp: Math.min(40, Math.floor(state.counters.water / 250) * 5) });
  const meals = Object.keys(state.sets).filter(k => k.startsWith('meal.')).length;
  if (meals) items.push({ id: 'food', label: 'Meals', xp: Math.min(40, meals * 10) });
  return { day, state, xp: { total: items.reduce((n, i) => n + i.xp, 0), items, target: 1000 } };
}
function lifeApi(events, url, method, body) {
  const sub = url.pathname.slice('/api/life'.length);
  if (sub === '/status') return { configured: true };
  if (sub === '/config') return CONFIG;
  if (sub.startsWith('/day/')) return fold(events, sub.slice(5));
  const logged = () => [...new Set([...events.values()].map(e => e.day))].sort();
  if (sub === '/days') return { days: logged().filter(d => d >= (url.searchParams.get('from') || '') && d <= (url.searchParams.get('to') || '')).map(d => fold(events, d)), target: 1000, streakMin: 200 };
  if (sub === '/xp') {
    const n = Math.max(1, Math.min(366, Number(url.searchParams.get('days') || 30)));
    const days = Array.from({ length: n }, (_, i) => { const day = shift(today, i - n + 1); return { day, xp: fold(events, day).xp.total }; });
    const all = logged().filter(d => d <= today).map(d => fold(events, d)), total = all.reduce((s, d) => s + d.xp.total, 0);
    return { total, level: Math.floor(total / 1000) + 1, intoLevel: total % 1000, levelSize: 1000, streak: all.length ? 4 : 0, streakMin: 200, today: fold(events, today).xp.total, target: 1000, best: Math.max(0, ...all.map(d => d.xp.total)), daysLogged: all.length, days };
  }
  if (sub === '/events' && method === 'POST') { const q = JSON.parse(body).events; for (const e of q) events.set(e.id, e); return { accepted: q.length, duplicate: 0 }; }
  return undefined;
}

let server, browser;
const report = { tag, timings: {}, checks: [] };
const ok = (name, cond, detail) => { report.checks.push({ name, ok: !!cond }); assert.ok(cond, `${name}${detail ? `: ${detail}` : ''}`); };
try {
  server = await createServer({ root: path.join(root, 'apps/web'), configFile: path.join(root, 'apps/web/vite.config.ts'), logLevel: 'error',
    plugins: [{ name: 'sealed-api', configureServer(v) { v.middlewares.use((req, res, next) => { if (/^\/(api|chat|term)\b/.test(req.url ?? '')) { res.statusCode = 410; res.end('Fixture only'); return; } next(); }); } }],
    server: { host: '127.0.0.1', port: 0, strictPort: false, hmr: false, watch: { ignored: ['**/*'] } } });
  await server.listen();
  const base = `http://127.0.0.1:${server.httpServer.address().port}`;
  browser = await webkit.launch({ headless: true });

  const open = async (name, width, sel, { motion = 'reduce' } = {}) => {
    const events = scenario(name), errors = [], hits = { GET: 0, POST: 0 };
    const page = await browser.newPage({ viewport: { width, height: width < 700 ? 844 : 900 }, reducedMotion: motion });
    page.setDefaultTimeout(15000);
    page.on('pageerror', e => errors.push(e.message));
    await page.routeWebSocket('**/*', socket => socket.close());
    await page.route('**/*', route => new URL(route.request().url()).origin === base ? route.fallback() : route.abort());
    await page.route(`${base}/api/**`, route => {
      const req = route.request(), url = new URL(req.url());
      hits[req.method()] = (hits[req.method()] ?? 0) + 1;
      const body = url.pathname.startsWith('/api/life/') ? lifeApi(events, url, req.method(), req.postData()) : undefined;
      return body === undefined ? route.fulfill({ status: 404, json: {} }) : route.fulfill({ json: body });
    });
    await page.goto(`${base}/preview/life.html?sel=${encodeURIComponent(sel)}`);
    await page.getByTestId('life-main').waitFor();
    await page.waitForFunction(() => !/Loading/.test(document.querySelector('[data-testid=life-main]')?.textContent ?? 'Loading'));
    await page.waitForTimeout(250);
    return { page, errors, events, hits };
  };
  // A whole-page capture: the Life column scrolls inside a fixed-height root, so let it grow for the shot.
  const shoot = async (page, file) => {
    if (!SHOTS) return;
    await page.addStyleTag({ content: '#root{height:auto!important}.life-v2{height:auto!important;overflow:visible!important}' });
    await page.waitForTimeout(60);
    await page.screenshot({ path: path.join(shots, file), fullPage: true });
  };
  const plan = [
    ['full', 'today'], ['full', 'morning'], ['full', 'nightly'], ['full', 'food'], ['full', 'week'], ['full', 'month'],
    ['empty', 'today'], ['empty', 'morning'], ['empty', 'nightly'], ['empty', 'food'],
    ['missed', `today@${yesterday}`], ['long', 'nightly'], ['long', 'food'],
  ];
  for (const width of [1440, 390]) for (const [name, sel] of plan) {
    const { page, errors } = await open(name, width, sel);
    if (!BEFORE) ok(`${name}/${sel} fits ${width}`, await page.evaluate(w => document.documentElement.scrollWidth <= w && document.querySelector('[data-testid=life-main]').scrollWidth <= w, width));
    await shoot(page, `${tag}-${name}-${sel.split('@')[0]}-${width}.png`);
    assert.deepEqual(errors, [], `${name}/${sel} at ${width}: no runtime errors`);
    await page.close();
  }

  // ---- check-off latency: click "Brush teeth" to the row reading checked, and to the next painted frame ----
  {
    const { page, hits } = await open('empty', 1440, 'morning', { motion: 'no-preference' });
    await page.getByTestId('life-step-freshen').getByRole('button').first().click();
    await page.getByTestId('life-row-teeth').waitFor();
    await page.waitForTimeout(500);
    const runs = [];
    hits.GET = 0; hits.POST = 0;
    for (let i = 0; i < 12; i++) {
      runs.push(await page.evaluate(() => new Promise(resolve => {
        const el = document.querySelector('[data-testid=life-row-teeth]'), want = el.getAttribute('aria-checked') === 'true' ? 'false' : 'true';
        const t0 = performance.now();
        const done = () => { const attr = performance.now() - t0; requestAnimationFrame(() => requestAnimationFrame(() => resolve({ attr, frame: performance.now() - t0 }))); };
        const mo = new MutationObserver(() => { const cur = document.querySelector('[data-testid=life-row-teeth]'); if (cur?.getAttribute('aria-checked') === want) { mo.disconnect(); done(); } });
        mo.observe(document.querySelector('[data-testid=life-morning]'), { attributes: true, subtree: true, childList: true });
        el.click();
      })));
      await page.waitForTimeout(120);
    }
    await page.waitForFunction(() => JSON.parse(localStorage.getItem('life-queue-v1') || '[]').length === 0);
    await page.waitForTimeout(800);
    // After one tap, watch the row through the sync and the re-read: it must never flip back (a blink).
    const blink = await page.evaluate(() => new Promise(resolve => {
      const el = document.querySelector('[data-testid=life-row-teeth]'), want = el.getAttribute('aria-checked') === 'true' ? 'false' : 'true', seen = [];
      const t0 = performance.now();
      const mo = new MutationObserver(() => { const v = document.querySelector('[data-testid=life-row-teeth]')?.getAttribute('aria-checked'); if (v && v !== seen.at(-1)?.v) seen.push({ v, t: Math.round(performance.now() - t0) }); });
      mo.observe(document.querySelector('[data-testid=life-morning]'), { attributes: true, subtree: true, childList: true });
      el.click();
      setTimeout(() => { mo.disconnect(); const back = seen.findIndex((x, i) => i > 0 && x.v !== want); resolve({ want, seen, blinkMs: back < 0 ? 0 : (seen[back + 1]?.t ?? 1500) - seen[back].t }); }, 1500);
    }));
    console.log('blink', JSON.stringify(blink));
    const med = k => { const xs = runs.map(r => r[k]).sort((a, b) => a - b); return Math.round(xs[xs.length >> 1] * 10) / 10; };
    report.timings.checkOff = { attrMedianMs: med('attr'), frameMedianMs: med('frame'), runs: runs.length, blinkMs: blink.blinkMs, flips: blink.seen.length, getsPerTap: Math.round(hits.GET / (runs.length + 1) * 10) / 10, postsPerTap: Math.round(hits.POST / (runs.length + 1) * 10) / 10 };
    console.log('check-off', JSON.stringify(report.timings.checkOff));
    await page.close();
  }

  if (!BEFORE) {
    ok('a synced tick never blinks off while the day is re-read', report.timings.checkOff.flips === 1 && report.timings.checkOff.blinkMs === 0, JSON.stringify(report.timings.checkOff));
    ok('a check-off asks the API for at most half the reads it did (six on origin/main)', report.timings.checkOff.getsPerTap <= 3, JSON.stringify(report.timings.checkOff));
    // Motion: transform and opacity only, nothing animating while idle, none at all under reduced motion.
    {
      const { page } = await open('full', 1440, 'morning', { motion: 'no-preference' });
      await page.waitForTimeout(600);
      const bad = await page.evaluate(() => [...document.querySelectorAll('.life-v2 *')].map(el => { const c = getComputedStyle(el); return { el: el.className.toString().slice(0, 60), p: c.transitionProperty, d: c.transitionDuration }; })
        .filter(x => x.d.split(',').some(t => parseFloat(t) > 0) && x.p.split(',').map(t => t.trim()).some(t => t !== 'transform' && t !== 'opacity')));
      ok('every Life transition is transform or opacity', bad.length === 0, JSON.stringify(bad.slice(0, 3)));
      ok('nothing animates while idle', await page.evaluate(() => document.getAnimations().length) === 0);
      await page.close();
      const r = await open('empty', 1440, 'morning', { motion: 'reduce' });
      await r.page.getByTestId('life-step-freshen').getByRole('button').first().click();
      await r.page.getByTestId('life-row-teeth').click();
      await r.page.locator('[data-testid=life-row-teeth][aria-checked=true]').waitFor();
      ok('reduced motion: the check-off does not animate', await r.page.evaluate(() => getComputedStyle(document.querySelector('[data-testid=life-row-teeth] .life-dot')).animationName === 'none' && document.getAnimations().length === 0));
      await r.page.close();
    }
    // First day: a welcome, no empty XP strip, the morning tile points at the first step.
    {
      const { page } = await open('empty', 390, 'today');
      ok('first day shows the welcome', await page.getByTestId('life-first-day').isVisible());
      ok('first day hides the zero XP strip', await page.getByTestId('life-xpbar').count() === 0);
      ok('morning tile names the next step', /0\/6[\s\S]*Next: Wake up/.test(await page.getByTestId('life-tile-morning').innerText()));
      const rows = await page.locator('[data-testid^=life-counter-]').evaluateAll(els => els.map(el => { const h = el.querySelector('h3').getBoundingClientRect(), b = el.querySelector('[aria-label^="plus"]').getBoundingClientRect(); return Math.abs((h.top + h.bottom) / 2 - (b.top + b.bottom) / 2) < 24 && b.right <= innerWidth; }));
      ok('every counter keeps its stepper beside its label at 390', rows.length >= 4 && rows.every(Boolean), JSON.stringify(rows));
      await page.getByRole('button', { name: 'Start the morning' }).click();
      await page.getByTestId('life-step-wake').waitFor();
      ok('welcome opens the morning routine', await page.getByTestId('life-wake-now').isVisible());
      await page.close();
    }
    // A missed day: said plainly, with a way to fill it in; the day stepper moves between days.
    {
      const { page } = await open('missed', 1440, 'today');
      ok('today is not "missed"', await page.getByTestId('life-missed').count() === 0);
      ok('next day is disabled on today', await page.getByRole('button', { name: 'Next day' }).isDisabled());
      await page.getByRole('button', { name: 'Previous day' }).click();
      await page.getByTestId('life-missed').waitFor();
      ok('the missed day says so', /Nothing was logged/.test(await page.getByTestId('life-missed').innerText()));
      ok('the strip shows that day\'s XP, not today\'s', /Day XP\s*0/i.test(await page.getByTestId('life-xpbar').innerText()));
      await page.getByRole('button', { name: 'Fill in the morning' }).click();
      await page.getByTestId('life-morning').waitFor();
      ok('filling in keeps the missed day', (await page.getByTestId('life-day-title').innerText()) === 'Yesterday');
      await page.getByTestId('life-back-today').click();
      await page.waitForFunction(() => document.querySelector('[data-testid=life-day-title]')?.textContent === 'Today');
      ok('back to today', true);
      await page.close();
    }
    // Nightly: the morning's step cards; reflection leads; yesterday's plan as accountability; done steps collapse.
    {
      const { page } = await open('full', 1440, 'nightly');
      const ids = await page.locator('[data-testid^=life-night-]:not([data-testid$=-label])').evaluateAll(els => els.map(e => e.dataset.testid));
      ok('four nightly step cards in order', JSON.stringify(ids) === JSON.stringify(['life-night-reflect', 'life-night-stock', 'life-night-tomorrow', 'life-night-rest']), JSON.stringify(ids));
      ok('yesterday\'s plan is shown', /you planned[\s\S]*Finish the Life review pages/.test(await page.getByTestId('life-nightly-yesterday').innerText()));
      ok('a finished night has every card collapsed', await page.locator('[data-testid^=life-night-] [aria-expanded=true]').count() === 0);
      ok('collapsed reflection previews the note', /Shipped the Life pages/.test(await page.getByTestId('life-night-reflect-label').innerText()));
      ok('the closed day says so', /Day closed/.test(await page.getByTestId('life-close-card').innerText()));
      await page.close();
      const e = await open('empty', 390, 'nightly');
      ok('an empty night opens on reflection', await e.page.getByTestId('life-note-went_well').isVisible());
      await e.page.getByTestId('life-note-went_well').fill('Walked to the river');
      await e.page.getByTestId('life-note-even_better').fill('Earlier night');
      await e.page.getByTestId('life-note-even_better').blur();
      await e.page.getByTestId('life-deep-hours').waitFor();
      const reflectDone = await e.page.getByTestId('life-night-reflect').getAttribute('data-complete');
      ok('finishing reflection moves to Take stock', reflectDone === 'true' && await e.page.locator('[data-testid=life-night-stock] [aria-expanded=true]').count() === 1, String(reflectDone));
      await e.page.getByTestId('life-close-day').click();
      await e.page.getByRole('button', { name: 'Day closed · reopen' }).waitFor();
      ok('close the day works with steps still open', true);
      await e.page.close();
    }
    // A long note: the collapsed preview truncates inside the card; opened, the box grows to show it.
    {
      const { page } = await open('long', 390, 'nightly');
      const label = page.getByTestId('life-night-reflect-label');
      ok('long preview is cut to one line', await label.evaluate(el => el.scrollWidth > el.clientWidth && el.getBoundingClientRect().right <= innerWidth));
      await page.getByTestId('life-night-reflect').getByRole('button').first().click();
      ok('the long note box grows to show all of it', await page.getByTestId('life-note-went_well').evaluate(el => el.clientHeight > 200 && el.scrollHeight <= el.clientHeight + 2));
      await shoot(page, 'after-long-nightly-open-390.png');
      await page.close();
    }
    // Food: what is left, the week of calories, one-tap repeats of this week's meals; a long meal name stays inside.
    {
      const { page } = await open('full', 1440, 'food');
      ok('calories left reads 410', /Left today\s*410\s*kcal/i.test(await page.getByTestId('life-food-left').innerText()));
      ok('seven bars in the week', await page.locator('[data-testid=life-food-week] .life-kcal__bar').count() === 7);
      ok('protein against its target', /135\s*\/\s*150\s*g/.test(await page.getByTestId('life-macro-protein').innerText()));
      await page.close();
      const m = await open('missed', 390, 'food');
      ok('empty food day says so', await m.page.getByTestId('life-food-empty').isVisible());
      const chips = m.page.getByTestId('life-food-recent').getByRole('button');
      ok('this week\'s meals are offered again', await chips.count() === 2);
      await chips.first().click();
      await m.page.getByTestId('life-food-meals').locator('li').first().waitFor();
      ok('one tap logs a recent meal', /Left today\s*1,620/i.test(await m.page.getByTestId('life-food-left').innerText()) || /Left today\s*1,880/i.test(await m.page.getByTestId('life-food-left').innerText()));
      ok('a logged meal leaves the repeat list', await chips.count() === 1);
      await m.page.close();
      const l = await open('long', 390, 'food');
      ok('a long meal name stays inside the row', await l.page.getByTestId('life-food-meals').locator('li').last().evaluate(li => li.scrollWidth <= li.clientWidth + 1 && li.getBoundingClientRect().right <= innerWidth));
      await l.page.close();
    }
  }
  writeFileSync(path.join(shots, `${tag}-report.json`), JSON.stringify(report, null, 2) + '\n');
  console.log(BEFORE ? 'before shots taken' : `PASS life 20261009 (${report.checks.length} checks)`, JSON.stringify(report.timings));
} finally { await browser?.close(); await server?.close(); }
