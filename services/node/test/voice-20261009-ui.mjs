// Voice lane, 9 Oct (ui/voice-20261009): the Voice space and the voice orb show what they are doing at a glance, and fast.
// Sealed: vite from apps/web with every /api, /chat and /term answered from tools/ab-qa-fixtures.mjs or this file; headless
// WebKit; a stand-in microphone that takes 300 ms to open. Never the live node, never a real mic.
//   heavy -- node services/node/test/voice-20261009-ui.mjs          (asserts; SHOTS=1 for after shots)
//   BEFORE=1 heavy -- node services/node/test/voice-20261009-ui.mjs (before shots and timings only, no asserts)
// Shots and timings: ui-hub/voice-20261009/{before,after}-*.png, timings-{before,after}.json
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { webkit } from './suite-runtime.mjs';
import { fixtureResponse } from '../../../tools/ab-qa-fixtures.mjs';

const root = path.resolve(import.meta.dirname, '../../..');
const { createServer } = createRequire(path.join(root, 'apps/web/package.json'))('vite');
const shots = path.join(root, 'ui-hub/voice-20261009');
mkdirSync(shots, { recursive: true });
const BEFORE = !!process.env.BEFORE;
// Shots only on request (SHOTS=1): Shaan, 9 Oct, wants code landed, not screenshots.
const SHOTS = !!process.env.SHOTS;
const tag = BEFORE ? 'before' : 'after';
const results = [];
const check = (name, ok, detail) => { results.push({ name, ok: !!ok, detail }); console.log(JSON.stringify({ check: name, ok: !!ok, ...(detail ? { detail } : {}) })); if (!BEFORE) assert.ok(ok, `${name} ${detail ? JSON.stringify(detail) : ''}`); };

// ── the data ──
const LONG = Array.from({ length: 60 }, (_, i) => ['So the thing I want is', 'the voice bar to stay on', 'until I turn it off,', 'and every agent to keep', 'running when the window', 'reloads, because'][i % 6]).join(' ') + ' that is the whole point.';
const ago = (min) => new Date(Date.now() - min * 60_000).toISOString();
const entry = (id, min, app, text, status = 'gpt-cleanup') => ({ id, timestamp: ago(min), app, bundleId: app === 'Agent Base' ? 'com.siso.agent-base' : null, intent: 'dictation', durationSeconds: 4, hasAudio: false, text, raw: text, words: text.split(/\s+/).length, status, source: 'agent-base' });
const history = () => ({ total: 6, entries: [
  entry('d1', 2, 'Agent Base', 'Ship the voice lane once the orb test passes.'),
  entry('d2', 9, 'Messages', LONG),
  entry('d3', 31, 'Safari', 'Look up the WebKit animation budget for idle windows.', 'fallback'),
  entry('d4', 64, 'Agent Base', 'Tell Agent Zero the mini is free after six.'),
  entry('d5', 180, 'Notes', 'Groceries: rice, limes, coffee.'),
  entry('d6', 1500, 'Mail', 'Thanks, I will send the build tonight.'),
], apps: [] });
const native = (o = {}) => ({ registered: true, permission: true, updatedAt: Date.now(), error: '', ...o });
// Each scene is what /api/dictation/status says: the native helper's state as the node passes it on.
const SCENES = {
  ready: () => ({ phase: 'idle', native: native() }),
  listening: () => ({ phase: 'recording', native: native() }),
  writing: () => ({ phase: 'transcribing', native: native() }),
  down: () => ({ phase: 'idle', native: native({ updatedAt: Date.now() - 4 * 60_000 }) }),
  access: () => ({ phase: 'idle', native: native({ permission: false, error: '' }) }),
  micdenied: () => ({ phase: 'error', error: 'The microphone did not start. Check microphone permission and the input device.', native: native() }),
  empty: () => ({ phase: 'idle', native: native() }),
};
let scene = 'ready';
let transcribe = { mode: 'ok', ms: 700, text: 'Agent Zero, what is on my list today?' };
const status = () => ({ owner: 'agent-base', switching: false, error: '', hotkey: 'Fn / 🌐 hold · Right ⌥ toggle', bar: true, rev: 1, ...SCENES[scene]() });

// ── the page's stand-ins (headless WebKit has no mic): a mic that opens in 300 ms (or is refused), a moving level, a
// recorder that hands over a few bytes; and the in-page clock of a press: pointerdown to the first frame that changed, and
// to the first frame where the orb's state ring is plainly lit (opacity >= .6). ──
const stub = () => {
  window.__gum = 0; window.__deny = false; window.__press = [];
  const open = async () => {
    window.__gum += 1;
    await new Promise((r) => setTimeout(r, 300));
    if (window.__deny) throw new DOMException('denied', 'NotAllowedError');
    const ac = new AudioContext(); const osc = ac.createOscillator(); const dest = ac.createMediaStreamDestination(); osc.connect(dest); osc.start();
    return dest.stream;
  };
  if (!navigator.mediaDevices) Object.defineProperty(navigator, 'mediaDevices', { value: {}, configurable: true });
  try { Object.defineProperty(Object.getPrototypeOf(navigator.mediaDevices), 'getUserMedia', { value: open, configurable: true, writable: true }); } catch {}
  Object.defineProperty(navigator.mediaDevices, 'getUserMedia', { value: open, configurable: true, writable: true });
  Object.defineProperty(navigator, 'permissions', { value: { query: async () => ({ state: 'prompt' }) }, configurable: true });
  const real = AudioContext.prototype.createMediaStreamSource;
  AudioContext.prototype.createMediaStreamSource = function (s) { try { return real.call(this, s); } catch { return this.createOscillator(); } };
  let t = 0;
  AnalyserNode.prototype.getByteTimeDomainData = function (buf) { t += 1; const amp = 40 + 30 * Math.sin(t / 7); for (let i = 0; i < buf.length; i++) buf[i] = 128 + amp * Math.sin(i / 3); };
  window.MediaRecorder = class {
    static isTypeSupported(x) { return x === 'audio/mp4'; }
    constructor(stream, o) { this.stream = stream; this.mimeType = o?.mimeType ?? 'audio/mp4'; this.state = 'inactive'; }
    start() { this.state = 'recording'; }
    stop() { this.state = 'inactive'; setTimeout(() => { this.ondataavailable?.({ data: new Blob([new Uint8Array(64)], { type: 'audio/mp4' }) }); this.onstop?.(); }, 20); }
  };
  addEventListener('pointerdown', (e) => {
    const mic = e.target.closest?.('.siso-mic');
    if (!mic || !e.target.closest('[data-testid=mic]')) return;
    const t0 = performance.now();
    const before = mic.getAttribute('data-phase');
    const sig = () => `${mic.getAttribute('data-phase')}|${mic.getAttribute('data-press') ?? ''}`;
    const s0 = `${before}|`;
    const lit = () => { const o = mic.querySelector('.to-orbit'); return o ? Number(getComputedStyle(o).opacity) : 0; };
    let first = null, distinct = null;
    const tick = () => {
      const dt = performance.now() - t0;
      if (first === null && sig() !== s0) first = dt;
      if (distinct === null && mic.getAttribute('data-phase') !== before && lit() >= 0.6) distinct = dt;
      if ((first === null || distinct === null) && dt < 3000) requestAnimationFrame(tick);
      else window.__press.push({ from: before, first: first && Math.round(first), distinct: distinct && Math.round(distinct), phase: mic.getAttribute('data-phase') });
    };
    requestAnimationFrame(tick);
  }, true);
};

let server, browser;
const timings = {};
try {
  server = await createServer({ root: path.join(root, 'apps/web'), configFile: path.join(root, 'apps/web/vite.config.ts'), logLevel: 'error',
    plugins: [{ name: 'sealed-api', configureServer(v) { v.middlewares.use((req, res, next) => { if (/^\/(api|chat|term)\b/.test(req.url ?? '')) { res.statusCode = 410; res.end('Fixture only'); return; } next(); }); } }],
    server: { host: '127.0.0.1', port: 0, strictPort: false, hmr: false, watch: { ignored: ['**/*'] } } });
  await server.listen();
  const base = `http://127.0.0.1:${server.httpServer.address().port}`;
  browser = await webkit.launch({ headless: true });

  const open = async ({ width, motion = 'reduce', space, query = '' }) => {
    const height = width < 700 ? 844 : 900, errors = [];
    const page = await browser.newPage({ viewport: { width, height }, reducedMotion: motion });
    page.on('pageerror', (e) => errors.push(e.message));
    await page.addInitScript(stub);
    await page.addInitScript((s) => { window.EventSource = undefined; if (s) { localStorage.setItem('agent-base:space', JSON.stringify(s)); localStorage.setItem('agent-base:voice-sel', JSON.stringify('home')); } }, space ?? null);
    await page.routeWebSocket('**/*', (socket) => socket.close());
    await page.route('**/*', (route) => (new URL(route.request().url()).origin === base ? route.fallback() : route.abort()));
    await page.route(`${base}/api/**`, async (route) => {
      const p = new URL(route.request().url()).pathname;
      if (p === '/api/dictation/status') return route.fulfill({ json: status() });
      if (p === '/api/voice/history') return route.fulfill({ json: scene === 'empty' ? { total: 0, entries: [], apps: [] } : history() });
      if (p === '/api/voice/transcribe') {
        await new Promise((r) => setTimeout(r, transcribe.ms));
        if (transcribe.mode === 'down') return route.abort('connectionrefused');
        return route.fulfill({ json: { text: transcribe.text } });
      }
      const body = fixtureResponse(p, 'fixture');
      return body === undefined ? route.fulfill({ status: 404, json: {} }) : route.fulfill({ json: body });
    });
    await page.goto(base + query);
    return { page, errors, height };
  };

  // ── 1. the Voice space, every state, at both sizes ──
  for (const width of [1440, 390]) {
    for (const s of ['ready', 'listening', 'writing', 'down', 'access', 'micdenied', 'empty']) {
      if (width === 390 && !['ready', 'down', 'listening', 'micdenied'].includes(s)) continue;
      scene = s;
      const { page, errors, height } = await open({ width, space: 'voice' });
      const main = page.getByTestId('voice-main');
      await main.waitFor({ timeout: 15000 });
      await page.waitForTimeout(700);
      SHOTS && await page.screenshot({ path: path.join(shots, `${tag}-space-${s}-${width}.png`), clip: { x: 0, y: 0, width, height: Math.min(height, 900) } });
      if (!BEFORE) {
        const hero = page.getByTestId('voice-hero');
        const key = await hero.getAttribute('data-state');
        const want = { ready: 'ready', listening: 'listening', writing: 'writing', down: 'down', access: 'access', micdenied: 'error', empty: 'ready' }[s];
        check(`space ${s} @${width}: the hero says ${want}`, key === want, { key });
        if (s === 'down') {
          const t = await hero.innerText();
          check(`space down @${width}: says the engine is not running and that it restarts by itself`, /not running/i.test(t) && /restarts by itself/i.test(t), { t: t.slice(0, 200) });
          check(`space down @${width}: says when it last checked in`, /last checked in .*ago/i.test(t));
        }
        if (s === 'access') check(`space access @${width}: names the setting to open`, /Accessibility/.test(await hero.innerText()));
        if (s === 'micdenied') { const t = await hero.innerText(); check(`space micdenied @${width}: says what failed and where to allow it`, /microphone did not start/i.test(t) && /Privacy & Security/.test(t), { t: t.slice(0, 240) }); }
        if (s === 'ready' && width === 1440) {
          const rows = page.getByTestId('dictation-entry');
          check('ready: six recent dictations', (await rows.count()) === 6);
          const long = rows.nth(1);
          const h = await long.evaluate((el) => el.getBoundingClientRect().height);
          check('a very long transcript stays one compact row until opened', h < 90, { h: Math.round(h) });
          check('the long row offers the whole text', /Show all · \d+ words/.test(await long.innerText()));
          await long.getByRole('button', { name: /Show all/ }).click();
          const h2 = await long.evaluate((el) => el.getBoundingClientRect().height);
          check('opened, the long row shows all of it', h2 > h * 2, { h2: Math.round(h2) });
          check('each row says how it went (written, or original words kept)', (await page.locator('[data-testid=dictation-entry][data-health=raw]').count()) === 1 && (await page.locator('[data-testid=dictation-entry][data-health=ok]').count()) === 5);
          const sum = await page.getByTestId('voice-recent-summary').innerText();
          check('one line sums up the recent ones', /6 recent/.test(sum) && /1 kept as said/.test(sum), { sum });
          SHOTS && await page.screenshot({ path: path.join(shots, `${tag}-space-long-open-${width}.png`), clip: { x: 0, y: 0, width, height } });
        }
        if (s === 'empty') check('empty: says how to start', /right ⌥/.test(await page.locator('.vx-latest').innerText()));
      }
      check(`space ${s} @${width}: no page errors`, errors.length === 0, { errors });
      await page.close();
    }
  }

  // ── 2. nothing moves while voice is idle (full motion on): the Voice space and the chat orb ──
  scene = 'ready';
  {
    const { page } = await open({ width: 1440, motion: 'no-preference', space: 'voice' });
    await page.getByTestId('voice-main').waitFor({ timeout: 15000 });
    await page.waitForTimeout(900);
    const running = await page.evaluate(() => document.getAnimations().filter((a) => a.playState === 'running' && a.effect?.target?.closest?.('.vx-space')).length);
    timings.idleAnimationsVoiceSpace = running;
    check('the Voice space runs no animation while idle', running === 0, { running });
    scene = 'listening';
    await page.evaluate(async () => { const { refresh } = await import('/src/lib/poll.ts'); await refresh('/api/dictation/status'); });
    await page.waitForTimeout(400);
    const live = await page.evaluate(() => document.getAnimations().filter((a) => a.playState === 'running' && a.effect?.target?.closest?.('.vx-space')).length);
    timings.listeningAnimationsVoiceSpace = live;
    if (!BEFORE) check('listening, the live bar moves', live > 0, { live });
    await page.close();
  }

  // ── 3. the chat orb: press to feedback, every state, at both sizes ──
  for (const width of [1440, 390]) {
    scene = 'ready';
    transcribe = { mode: 'ok', ms: 700, text: 'Agent Zero, what is on my list today?' };
    const motion = width === 1440 ? 'no-preference' : 'reduce';
    const { page, errors } = await open({ width, motion, query: width < 700 ? '/?agent=Agent%20Zero' : '' });
    const view = page.locator('[data-testid=chat-view]:visible').first();
    await view.waitFor({ timeout: 15000 });
    const mic = view.locator('.siso-chat__inputrow .siso-mic').first();
    await mic.waitFor({ timeout: 15000 });
    await page.waitForTimeout(500);
    const box = page.locator('[data-testid=chat-view]:visible .siso-chat__composer').first();
    const clip = async (name) => { if (!SHOTS) return; const b = await box.boundingBox(); SHOTS && await page.screenshot({ path: path.join(shots, `${tag}-orb-${name}-${width}.png`), clip: { x: Math.max(0, b.x - 10), y: Math.max(0, b.y - 70), width: Math.min(width, b.width + 20), height: b.height + 80 } }); };
    const anims = () => mic.evaluate((el) => el.getAnimations({ subtree: true }).filter((a) => a.playState === 'running').length);
    await clip('1-idle');
    const idleAnims = await anims();
    timings[`orbIdleAnimations${width}`] = idleAnims;
    check(`orb @${width}: nothing animates while idle`, idleAnims === 0, { idleAnims });
    const orb = mic.getByTestId('mic');
    const tap = async () => { const o = await orb.boundingBox(); await page.mouse.move(o.x + o.width / 2, o.y + o.height / 2); await page.mouse.down(); await page.mouse.up(); };
    // Take 1, cold: the mic takes 300 ms to open. Esc throws it away.
    await tap(); // the mic is still opening
    await page.waitForTimeout(60); await clip('2-opening');
    await mic.and(page.locator('[data-phase=listening]')).waitFor({ timeout: 5000 });
    await page.waitForTimeout(250); await clip('3-listening');
    // Esc throws it away, even with the agent's panel open (its own Esc listener closes the panel).
    await page.keyboard.press('Escape');
    await page.waitForTimeout(400);
    const escDropped = (await mic.getAttribute('data-phase')) === 'idle';
    timings[`escDropsTake${width}`] = escDropped;
    check(`orb @${width}: Esc throws the take away (not the panel)`, escDropped);
    if (!escDropped) await mic.getByRole('button', { name: 'Throw away' }).click();
    await mic.and(page.locator('[data-phase=idle]')).waitFor({ timeout: 5000 });
    // Take 2, warm (the mic is already open), and the node down: writing fails, the pill says so and keeps the take.
    transcribe = { mode: 'down', ms: 600, text: '' };
    await tap();
    await mic.and(page.locator('[data-phase=listening]')).waitFor({ timeout: 5000 });
    await page.waitForTimeout(150);
    await tap(); // tap again to send
    await mic.and(page.locator('[data-phase=writing]')).waitFor({ timeout: 5000 });
    await page.waitForTimeout(150); await clip('4-writing');
    await mic.locator('[data-testid=mic-status][role=alert]').waitFor({ timeout: 5000 });
    await clip('6-node-down');
    if (!BEFORE) check(`orb @${width}: node down says so and offers Try again`, /not answering/.test(await mic.innerText()) && (await mic.getByTestId('mic-retry').count()) === 1);
    await mic.getByRole('button', { name: 'Dismiss' }).click();
    // The mic refused (macOS said no): the pill says where to allow it; the orb is red and still.
    await page.evaluate(async () => { window.__deny = true; const { closeMic } = await import('/src/lib/voice.ts'); closeMic(); });
    await tap();
    await mic.locator('[data-testid=mic-status][role=alert]').waitFor({ timeout: 5000 });
    await page.waitForTimeout(150);
    await clip('7-mic-denied');
    if (!BEFORE) {
      check(`orb @${width}: mic denied names the setting`, /Privacy & Security/.test(await mic.innerText()));
      check(`orb @${width}: red never moves (no animation while in error)`, (await anims()) === 0);
    }
    const press = await page.evaluate(() => window.__press);
    timings[`press${width}`] = press;
    console.log(JSON.stringify({ width, press }));
    const cold = press[0], warm = press[1];
    if (!BEFORE) {
      check(`orb @${width}: cold press shows feedback on the next frame (< 100 ms)`, cold?.first !== null && cold.first < 100, cold);
      check(`orb @${width}: cold press is plainly lit within 100 ms, while the mic is still opening`, cold?.distinct !== null && cold.distinct < 100, cold);
      check(`orb @${width}: warm press is listening within 100 ms`, warm?.distinct !== null && warm.distinct < 100, warm);
    }
    check(`orb @${width}: no page errors`, errors.length === 0, { errors });
    await page.close();
  }

  writeFileSync(path.join(shots, `timings-${tag}.json`), JSON.stringify(timings, null, 2));
  const failed = results.filter((r) => !r.ok);
  console.log(BEFORE ? `before shots taken (${failed.length} of ${results.length} would fail)` : `PASS voice 20261009 ${results.length} checks`, JSON.stringify(timings));
} finally { await browser?.close(); await server?.close(); }
