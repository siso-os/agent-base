// Rolodex UI round, 9 Oct 2026 (lane rolodex). Shaan, 7 Oct: "a nice side nav ... clients partners friends family ... our 800 chats
// how they fit into the rolodex ... Redesign the page for each of the people a bit nicer ... just like a proper Rolodex".
// Full app, sealed API, never the live node. Every person here is invented: names from two made-up lists, phones in the
// 07700 900xxx drama range. The book answers from memory with a node-like delay (GET 60 ms, POST 120 ms).
// BEFORE=1 takes shots and timings only (run against the old files).   heavy -- node services/node/test/rolodex-20261009-ui.mjs
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { webkit } from './suite-runtime.mjs';
import { fixtureResponse } from '../../../tools/ab-qa-fixtures.mjs';

const root = path.resolve(import.meta.dirname, '../../..');
const { createServer } = createRequire(path.join(root, 'apps/web/package.json'))('vite');
const shots = path.join(root, 'ui-hub/rolodex-20261009');
mkdirSync(shots, { recursive: true });
const BEFORE = !!process.env.BEFORE, TAG = BEFORE ? 'before' : 'after';
const NOW = Date.now(), DAY = 86_400_000, iso = (ms) => new Date(ms).toISOString();

// --- Synthetic people ---------------------------------------------------------------------------------------------------
let seed = 7;
const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const pick = (xs) => xs[Math.floor(rnd() * xs.length)];
const FIRST = ['Mara', 'Tobin', 'Ilsa', 'Corin', 'Juno', 'Aldo', 'Nessa', 'Pip', 'Rafe', 'Odile', 'Bram', 'Calla', 'Dov', 'Esme', 'Fenn', 'Greer', 'Hale', 'Ines', 'Jory', 'Kit', 'Lark', 'Mabry', 'Nico', 'Orla', 'Pell', 'Quin', 'Rue', 'Sable', 'Tamsin', 'Ulla', 'Vale', 'Wren', 'Yara', 'Zev', 'Marlo', 'Maren', 'Marisol', 'Arlo', 'Bex', 'Cato'];
const LAST = ['Quillfeather', 'Marrowby', 'Thistledown', 'Brightwater', 'Ashgrove', 'Fernhollow', 'Copperfield', 'Wickstead', 'Larkspur', 'Hollowell', 'Stonebridge', 'Ravensdale', 'Mosswood', 'Kettleby', 'Underhay', 'Pennywhistle', 'Saltmarsh', 'Oakhurst', 'Dunmore', 'Glimmerton'];
const TOWNS = ['Fixture Town', 'Port Example', 'Sampleford', 'Mockbridge', 'Testhaven', 'Lorem Bay', 'Placeholder-on-Sea'];
const FIRMS = ['Synthetic Studio', 'Example Works', 'Fixture Labs', 'Mock & Co', 'Sample Partners', 'Placeholder Group'];
const ROLES = ['founder', 'designer', 'producer', 'engineer', 'buyer', 'agent'];
const LEVELS = ['client', 'partner', 'friend', 'family', 'network', 'want'];
const STEPS = ['send the proposal', 'book a coffee', 'reply about the launch', 'intro to the studio', 'send birthday card'];
function person(i) {
  const level = i < 40 ? 'client' : i < 70 ? 'partner' : i < 220 ? 'friend' : i < 260 ? 'family' : i < 470 ? 'network' : 'want';
  const name = `${pick(FIRST)} ${pick(LAST)}`, last = NOW - Math.floor(rnd() * 200) * DAY - 3600_000;
  const p = { id: `p-${i}`, name, level, added: iso(NOW - 120 * DAY), updated: iso(NOW - 2 * DAY), keys: level === 'want' ? [] : [`wa:4477009${String(i).padStart(5, '0')}`], gaps: [],
    talk: level === 'want' ? undefined : { messages: 1 + Math.floor(rnd() * 900), sent: Math.floor(rnd() * 300), last: Math.floor(last / 1000) } };
  if (rnd() > .3) p.from = pick(TOWNS);
  if (level === 'client' || level === 'partner' || rnd() > .7) { p.company = pick(FIRMS); p.role = pick(ROLES); }
  if (level === 'want') { p.why = 'their synthetic launch looked sharp'; p.links = { x: `https://x.com/fixture${i}` }; }
  if (rnd() > .8) p.nextStep = pick(STEPS), p.nextStepAt = iso(NOW + Math.floor(rnd() * 20 - 6) * DAY).slice(0, 10);
  if (rnd() > .85) p.birthday = `19${80 + Math.floor(rnd() * 19)}-${String(1 + Math.floor(rnd() * 12)).padStart(2, '0')}-${String(1 + Math.floor(rnd() * 28)).padStart(2, '0')}`;
  for (const g of ['fullName', 'from', 'birthday']) if (!p[g === 'fullName' ? 'fullName' : g] && level !== 'want' && level !== 'network') p.gaps.push(g);
  p.history = [{ at: iso(NOW - 90 * DAY), from: 'inbox', to: level }];
  return p;
}
const RICH = { id: 'p-rich', name: 'Mara Quillfeather', fullName: 'Mara Elspeth Quillfeather', level: 'client', from: 'Port Example', lives: 'Sampleford', company: 'Synthetic Studio', role: 'founder',
  howMet: 'through the fixture meetup', birthday: '1991-03-03', nextStep: 'send the proposal', nextStepAt: iso(NOW - 2 * DAY).slice(0, 10), notes: 'Likes short calls. Two kids (invented).',
  added: iso(NOW - 300 * DAY), updated: iso(NOW - DAY), keys: ['wa:447700900001'], phone: '447700900001', gaps: [], talk: { messages: 412, sent: 190, last: Math.floor((NOW - 41 * DAY) / 1000) },
  touches: [{ at: iso(NOW - 41 * DAY), note: 'Call about the synthetic launch' }, { at: iso(NOW - 70 * DAY), note: 'Coffee in Sampleford' }],
  history: [{ at: iso(NOW - 300 * DAY), from: 'inbox', to: 'network' }, { at: iso(NOW - 200 * DAY), from: 'network', to: 'client' }],
  work: { projects: [{ id: 'fx', name: 'Fixture Launch', folder: 'fixture', kind: 'client-project', available: false, stage: 'build' }], note: 'One synthetic project.', relation: 'client' } };
const BARE = { id: 'p-bare', name: 'Rowan', level: 'network', added: iso(NOW - 3 * DAY), updated: iso(NOW - 3 * DAY), keys: [], gaps: ['fullName', 'from', 'company', 'role'] };
const LONG = { id: 'p-long', name: 'Maximiliana Alexandrovna Featherstonehaugh-Quillfeather-Brightwater de la Montagne', fullName: 'Maximiliana Alexandrovna Featherstonehaugh-Quillfeather-Brightwater de la Montagne-Ravensdale',
  level: 'friend', company: 'The Extremely Long Synthetic Company Name For Overflow Testing Limited', role: 'principal synthetic overflow consultant', from: 'Placeholder-on-Sea-under-Lyme-by-the-Fixture',
  added: iso(NOW - 50 * DAY), updated: iso(NOW - 5 * DAY), keys: ['wa:447700900777'], gaps: [], talk: { messages: 30, sent: 12, last: Math.floor((NOW - 9 * DAY) / 1000) } };
const inboxRow = (i) => ({ key: `wa:4477009${String(80000 + i)}`, name: i === 1 ? 'Featherstonehaugh-Quillfeather Overflow-Testing Family Group Chat' : `${pick(FIRST)} ${pick(LAST)}`, named: true, phone: `4477009${String(80000 + i)}`,
  talk: { messages: 400 - i * 5, sent: 150 - i * 2, last: Math.floor((NOW - i * DAY) / 1000) }, proposal: { level: pick(['friend', 'network', 'client']), confidence: pick(['high', 'medium', 'low']), reason: `${400 - i * 5} messages both ways this year` } });
function fullBook(inbox = 40) {
  seed = 7;
  const people = [RICH, BARE, LONG, ...Array.from({ length: 497 }, (_, i) => person(i))];
  return { people: structuredClone(people), inbox: Array.from({ length: inbox }, (_, i) => inboxRow(i)), offCount: 0, whatsapp: { state: 'live', chats: 800, named: 640 } };
}
const emptyBook = () => ({ people: [], inbox: [], offCount: 0, whatsapp: { state: 'live', chats: 0, named: 0 } });

// --- A tiny in-memory node: answers /api/rolodex/book like rolodex-book.ts does ------------------------------------------
function node(book) {
  const gone = new Map(), posts = [];
  const apply = (op) => {
    posts.push(op);
    if (op.op === 'place' || op.op === 'dismiss') {
      const i = book.inbox.findIndex((r) => r.key === op.key); if (i < 0) return { status: 404, json: { error: 'That chat is already sorted' } };
      const [row] = book.inbox.splice(i, 1); gone.set(op.key, row);
      if (op.op === 'dismiss') { book.offCount++; return { json: { ok: true } }; }
      const id = `p-${op.key}`;
      book.people.push({ id, name: row.name, level: op.level, ...op.fields, added: iso(NOW), updated: iso(NOW), keys: [op.key], talk: row.talk, gaps: [], history: [{ at: iso(NOW), from: 'inbox', to: op.level }] });
      return { json: { ok: true, id } };
    }
    if (op.op === 'unplace' || op.op === 'undismiss') {
      const key = op.op === 'unplace' ? book.people.find((p) => p.id === op.id)?.keys[0] : op.key;
      if (op.op === 'unplace') book.people = book.people.filter((p) => p.id !== op.id); else book.offCount--;
      const row = gone.get(key); if (row) book.inbox.unshift(row);
      return { json: { ok: true } };
    }
    if (op.op === 'update') { const p = book.people.find((x) => x.id === op.id); Object.assign(p, op.fields); return { json: { ok: true, id: p.id } }; }
    if (op.op === 'touch') { const p = book.people.find((x) => x.id === op.id); (p.touches ??= []).unshift({ at: iso(NOW), note: op.note }); return { json: { ok: true } }; }
    return { status: 400, json: { error: 'unknown op' } };
  };
  return { book, posts, apply };
}

let server, browser;
const timings = {}, results = [];
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function open(base, { width, book, sel = 'all', motion = 'reduce' }) {
  const height = width < 700 ? 844 : 900, errors = [];
  const ctx = await browser.newContext({ viewport: { width, height }, reducedMotion: motion });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript((sel) => { window.EventSource = undefined; localStorage.setItem('agent-base:space', '"rolodex"'); localStorage.setItem('agent-base:rolodex-sel', JSON.stringify(sel)); }, sel);
  await page.routeWebSocket('**/*', (socket) => socket.close());
  await page.route('**/*', (route) => (new URL(route.request().url()).origin === base ? route.fallback() : route.abort()));
  const n = node(book);
  await page.route(`${base}/api/**`, async (route) => {
    const p = new URL(route.request().url()).pathname;
    if (p === '/api/rolodex/book') {
      if (route.request().method() === 'POST') { await wait(120); const r = n.apply(route.request().postDataJSON()); return route.fulfill({ status: r.status ?? 200, json: r.json }); }
      await wait(60); return route.fulfill({ json: structuredClone(n.book) });
    }
    const body = fixtureResponse(p, 'fixture');
    return body === undefined ? route.fulfill({ status: 404, json: {} }) : route.fulfill({ json: body });
  });
  await page.goto(base);
  await page.locator('.rolodex-space').first().waitFor({ timeout: 20000 });
  return { page, ctx, errors, node: n, height };
}
const shot = (page, name) => page.screenshot({ path: path.join(shots, `${TAG}-${name}.png`) });
const space = (page) => page.locator('.rolodex-space:visible').first();
const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return +s[Math.floor(s.length / 2)].toFixed(1); };
const max = (xs) => +Math.max(...xs).toFixed(1);

// Keystroke to painted results: set the value as a keystroke would, then wait until the list shows that query and a frame paints.
const timeSearch = (page, seq) => page.evaluate(async (seq) => {
  const input = document.querySelector('.rolodex-search input');
  const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
  const painted = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
  const out = [];
  for (const v of seq) {
    const t0 = performance.now();
    set.call(input, v); input.dispatchEvent(new Event('input', { bubbles: true }));
    for (let i = 0; i < 60; i++) {
      await painted();
      const l = document.querySelector('[data-rolodex-results]');
      if (!l || l.getAttribute('data-query') === v.trim().toLowerCase()) break;
    }
    out.push(performance.now() - t0);
  }
  return out;
}, seq);
// Script work alone, without waiting for a frame: keystroke to the list committed (frames quantise the paint measure to ~16 ms).
const timeSearchWork = (page, seq) => page.evaluate(async (seq) => {
  const input = document.querySelector('.rolodex-search input');
  const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
  const out = [];
  for (const v of seq) {
    const t0 = performance.now();
    set.call(input, v); input.dispatchEvent(new Event('input', { bubbles: true }));
    let t1 = 0;
    for (let i = 0; i < 400; i++) {
      await new Promise((r) => { const c = new MessageChannel(); c.port1.onmessage = r; c.port2.postMessage(0); });
      const l = document.querySelector('[data-rolodex-results]');
      if (!l || l.getAttribute('data-query') === v.trim().toLowerCase()) { t1 = performance.now(); break; }
    }
    out.push(t1 - t0);
    await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 30)));
  }
  return out;
}, seq);
// One key to the next card painted.
const timeAdvance = (page, key) => page.evaluate(async (key) => {
  const name = () => document.querySelector('.rolodex-sortcard:not(.is-leaving) h2')?.textContent;
  const painted = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
  const before = name(), t0 = performance.now();
  document.body.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
  for (let i = 0; i < 200 && name() === before; i++) await new Promise((r) => requestAnimationFrame(r));
  await painted();
  return performance.now() - t0;
}, key);

try {
  server = await createServer({ root: path.join(root, 'apps/web'), configFile: path.join(root, 'apps/web/vite.config.ts'), logLevel: 'error',
    plugins: [{ name: 'sealed-api', configureServer(v) { v.middlewares.use((req, res, next) => { if (/^\/(api|chat|term)\b/.test(req.url ?? '')) { res.statusCode = 410; res.end('Fixture only'); return; } next(); }); } }],
    server: { host: '127.0.0.1', port: 0, strictPort: false, hmr: false, watch: { ignored: ['**/*'] } } });
  await server.listen();
  const base = `http://127.0.0.1:${server.httpServer.address().port}`;
  browser = await webkit.launch({ headless: true });

  for (const width of [1440, 390]) {
    // 1. Everyone, 500 people.
    const { page, ctx, errors } = await open(base, { width, book: fullBook() });
    const s = space(page);
    await s.locator('.rolodex-row').first().waitFor({ timeout: 20000 });
    await page.waitForTimeout(400);
    await shot(page, `everyone-${width}`);
    if (!BEFORE) {
      // Grouped the way he described: his six levels in his order, each with its count.
      const groups = await s.locator('[data-group]').evaluateAll((xs) => xs.map((x) => x.getAttribute('data-group')));
      assert.deepEqual(groups, ['client', 'partner', 'friend', 'family', 'network', 'want'], 'Everyone is grouped clients, partners, friends, family, network, want');
      assert.match(await s.locator('[data-group="client"]').innerText(), /Clients\s*·?\s*41/i, 'a group header says its count');
    }
    // 2. Search.
    if (width === 1440) {
      const seq = ['m', 'ma', 'mar', 'mara', 'mar', 'ma', 'm', ''];
      await timeSearch(page, ['q', '']); // warm
      const runs = [...await timeSearch(page, seq), ...await timeSearch(page, seq), ...await timeSearch(page, seq)];
      timings.search = { median: median(runs), max: max(runs), samples: runs.length };
      const work = [...await timeSearchWork(page, seq), ...await timeSearchWork(page, seq), ...await timeSearchWork(page, seq)];
      timings.searchWork = { median: median(work), max: max(work), samples: work.length };
    }
    await s.locator('.rolodex-search input').fill('quill');
    await page.waitForTimeout(300);
    await shot(page, `search-${width}`);
    if (!BEFORE) {
      const list = s.locator('[data-rolodex-results]');
      assert.equal(await list.getAttribute('data-query'), 'quill');
      const first = await s.locator('.rolodex-row').first().locator('.rolodex-row__name').innerText();
      assert.match(first, /^Mara Quillfeather|^\S+ Quillfeather/, 'a name match ranks above a notes or company match');
      assert.ok(await s.locator('.rolodex-row mark').count() > 0, 'the matched letters are marked');
      assert.ok(await s.locator('.rolodex-row .rolodex-row__level').count() > 0, 'search results in Everyone say each level (no group headers)');
      // Enter in the search box opens the top result.
      await s.locator('.rolodex-search input').press('Enter');
      await s.locator('.rolodex-person').waitFor();
      await s.locator('.rolodex-person__close').click();
      // No match in a level points at the rest of the book.
      await s.locator('.rolodex-search input').fill('zzzz-nobody');
      await s.getByText(/No one matches/).waitFor();
    }
    await s.locator('.rolodex-search input').fill('');
    // 3. A rich person, 4. a person with no details, 5. a very long name.
    for (const [id, name, q] of [['p-rich', 'person', 'Mara Quillfeather'], ['p-bare', 'bare', 'Rowan'], ['p-long', 'long', 'Maximiliana']]) {
      await s.locator('.rolodex-search input').fill(q);
      await page.waitForTimeout(150);
      await s.locator(`[data-person="${id}"]`).first().click();
      await s.locator('.rolodex-person').waitFor();
      await page.waitForTimeout(250);
      await shot(page, `${name}-${width}`);
      if (!BEFORE) {
        const glance = s.locator('[data-glance]');
        if (id === 'p-rich') {
          assert.match(await glance.locator('[data-glance-cell="who"]').innerText(), /Client/, 'who they are to him comes first');
          assert.match(await glance.locator('[data-glance-cell="last"]').innerText(), /41 d|1 mo|5 w/, 'last contact is up top');
          assert.match(await glance.locator('[data-glance-cell="last"]').innerText(), /Quiet/i, 'a client silent past 30 days reads quiet');
          assert.match(await glance.locator('[data-glance-cell="open"]').innerText(), /send the proposal/, 'the open thread is up top');
          assert.match(await glance.locator('[data-glance-cell="open"]').innerText(), /late/, 'an overdue step says it is late');
        }
        if (id === 'p-bare') {
          assert.match(await glance.locator('[data-glance-cell="last"]').innerText(), /No contact yet/, 'no details: says so plainly');
          assert.match(await glance.locator('[data-glance-cell="open"]').innerText(), /Nothing open/);
          await s.getByRole('button', { name: /4 to fill in/ }).click();
          assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('aria-label')), 'Full name', 'the gaps chip opens the first gap');
          await page.keyboard.press('Escape');
        }
        if (id === 'p-long') {
          const overflow = await page.evaluate(() => document.scrollingElement.scrollWidth - innerWidth);
          assert.ok(overflow <= 0, `no sideways scroll with a very long name (${overflow}px)`);
          const box = await s.locator('.rolodex-person__name').boundingBox(), pageBox = await s.locator('.rolodex-person').boundingBox();
          assert.ok(box.x + box.width <= pageBox.x + pageBox.width + 1, 'the long name wraps inside the page');
        }
      }
      await s.locator('.rolodex-person__close').click();
    }
    if (!BEFORE && width === 1440) {
      // The long name in the list truncates with its full name on hover.
      await s.locator('.rolodex-search input').fill('Maximiliana');
      await page.waitForTimeout(150);
      await s.locator('[data-person="p-long"]').first().click();
      await s.locator('.rolodex-person').waitFor();
      const nm = s.locator('[data-person="p-long"] .rolodex-row__nm');
      assert.equal(await nm.getAttribute('title'), LONG.name);
      assert.ok(await nm.evaluate((el) => el.scrollWidth > el.clientWidth), 'a very long name ellipses in the narrow list beside a page');
      await shot(page, 'long-list-1440');
      await s.locator('.rolodex-person__close').click();
    }
    assert.deepEqual(errors, [], `page errors at ${width}`);
    await ctx.close();

    // 6. The sort deck.
    {
      const { page, ctx, errors, node } = await open(base, { width, book: fullBook(), sel: 'sort', motion: width === 1440 ? 'no-preference' : 'reduce' });
      const s = space(page);
      await s.locator('.rolodex-sortcard h2').first().waitFor({ timeout: 20000 });
      await page.waitForTimeout(300);
      await shot(page, `deck-${width}`);
      if (width === 1440) {
        const adv = [];
        for (const k of ['3', '5', '1', '3', '5', '1']) { adv.push(await timeAdvance(page, k)); await page.waitForTimeout(500); }
        timings.deck = { median: median(adv), max: max(adv), samples: adv.length };
        if (!BEFORE) { await page.keyboard.press('3'); await page.waitForTimeout(70); await shot(page, 'deck-motion-1440'); await page.waitForTimeout(500); }
        // Rapid triage: eight keys 60 ms apart, faster than the node answers. How many land?
        const before = node.posts.length;
        for (let i = 0; i < 8; i++) { await page.keyboard.press(String((i % 5) + 1)); await page.waitForTimeout(60); }
        await page.waitForTimeout(2500);
        timings.rapid = { pressed: 8, placed: node.posts.length - before };
      }
      if (!BEFORE) {
        const name = () => s.locator('.rolodex-sortcard:not(.is-leaving) h2').first().innerText();
        // → skips without saving.
        const a = await name(), posts = node.posts.length;
        await page.keyboard.press('ArrowRight');
        await page.waitForFunction((a) => document.querySelector('.rolodex-sortcard:not(.is-leaving) h2')?.textContent !== a, a);
        assert.equal(node.posts.length, posts, 'arrow right skips, nothing saved');
        // ↓ moves the choice; Enter places the chosen level.
        const chosen0 = await s.locator('.rolodex-levels [data-chosen]').getAttribute('data-level');
        await page.keyboard.press('ArrowDown');
        const chosen1 = await s.locator('.rolodex-levels [data-chosen]').getAttribute('data-level');
        assert.notEqual(chosen1, chosen0, 'arrow down moves the choice');
        const b = await name();
        await page.keyboard.press('Enter');
        await page.waitForFunction(() => document.querySelector('.rolodex-sortcard'));
        await page.waitForTimeout(400);
        const last = node.posts.at(-1);
        assert.equal(last.op === 'dismiss' ? 'off' : last.level, chosen1, 'Enter places the chosen level');
        // ← takes it back: the card returns.
        await page.keyboard.press('ArrowLeft');
        await page.waitForFunction((b) => document.querySelector('.rolodex-sortcard:not(.is-leaving) h2')?.textContent === b, b, { timeout: 5000 });
        await page.waitForTimeout(400);
        assert.match(node.posts.at(-1).op, /unplace|undismiss/, 'arrow left undoes the last placement');
        if (width === 1440) {
          assert.equal(timings.rapid.placed, 8, 'every key lands: none dropped while the node answers');
          // Motion is on with no-preference: the card enters with a transform animation.
          const anim = await s.locator('.rolodex-sortcard:not(.is-leaving)').first().evaluate((el) => getComputedStyle(el).animationName);
          assert.notEqual(anim, 'none', 'the card advance animates');
        } else {
          const anim = await s.locator('.rolodex-sortcard:not(.is-leaving)').first().evaluate((el) => getComputedStyle(el).animationName);
          assert.ok(/none|rolodex-fade/.test(anim), `reduced motion: no slide (${anim})`);
        }
      }
      assert.deepEqual(errors, [], `deck errors at ${width}`);
      await ctx.close();
    }
    // 7. The end of the deck.
    {
      const { page, ctx, errors } = await open(base, { width, book: fullBook(2), sel: 'sort' });
      const s = space(page);
      await s.locator('.rolodex-sortcard h2').first().waitFor({ timeout: 20000 });
      await page.keyboard.press('3'); await page.waitForTimeout(400);
      await page.keyboard.press('5'); await page.waitForTimeout(1200);
      await s.locator('.rolodex-done').waitFor({ timeout: 8000 });
      await shot(page, `deck-end-${width}`);
      if (!BEFORE) {
        const done = await s.locator('.rolodex-done').innerText();
        assert.match(done, /Everyone's sorted/);
        assert.match(done, /1 Friend/i, 'the end of the deck says what you placed');
        assert.match(done, /1 Network/i);
        assert.ok(await s.getByRole('button', { name: /Fill the gaps/ }).count(), 'the end points at the next deck');
      }
      assert.deepEqual(errors, []);
      await ctx.close();
    }
    // 8. An empty book.
    {
      const { page, ctx, errors } = await open(base, { width, book: emptyBook() });
      await page.waitForTimeout(800);
      await shot(page, `empty-${width}`);
      if (!BEFORE) assert.match(await space(page).locator('.rolodex-empty').innerText(), /Your Rolodex is empty/);
      assert.deepEqual(errors, []);
      await ctx.close();
    }
    results.push(width);
  }
  writeFileSync(path.join(shots, `timings-${TAG}.json`), JSON.stringify(timings, null, 2));
  console.log(BEFORE ? 'before shots taken' : 'PASS rolodex 20261009', JSON.stringify({ widths: results, timings }));
} finally { await browser?.close(); await server?.close(); }
