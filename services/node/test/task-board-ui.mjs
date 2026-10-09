// t-0567: the Agent Base task board in the full app. The rail icon opens it; five lanes with the store's numbers; a typed
// idea lands in Ideas and a typed task at the top of To do; his order holds; a card opens its spec and his words; the dead
// parts (owner cards, face grid, 2 Oct brief, "Crew refresh unavailable", the stats strip) are gone; the peek shows the
// live sprint. A stand-in board answers like services/node/src/board.ts (test/board.test.mjs holds the node to bin/ask).
// Synthetic full app, sealed API, never the live node. Run with heavy:  node services/node/test/task-board-ui.mjs
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import { webkit } from './suite-runtime.mjs';
import { fixtureResponse } from '../../../tools/ab-qa-fixtures.mjs';

const root = path.resolve(import.meta.dirname, '../../..');
const { createServer } = createRequire(path.join(root, 'apps/web/package.json'))('vite');
const shots = path.join(root, 'ui-hub/task-board');
const ago = (h) => new Date(Date.now() - h * 3600_000).toISOString();
const c = (id, title, stage, h, extra = {}) => ({ id, kind: 'task', title, his: `his words for ${id}`, at: ago(h), stage, priority: 'P2', spec: true, link: null, ...extra });
const fresh = () => ({
  updated: new Date().toISOString(), queue: 0, size: 10, days: 7,
  sprint: { status: 'working', summary: 'Live v143: the in-app browser opens URLs; not-landed counts only real work.', next: 'Sprint 1: the task board (t-0567), then the top of Now.', updated: ago(0.5) },
  lanes: {
    ideas: [c('t-0590', 'A thought waiting for a spec', 'thought', 2), { id: 'i-014', kind: 'idea', title: 'Voice notes become ideas', his: 'when I talk it should catch ideas', at: ago(5), stage: 'idea', by: 'Shaan' },
      { id: 'ab-020', kind: 'idea', title: 'Rank ideas by how often he mentions them', his: '', at: ago(30), stage: 'idea', by: 'RESEARCH' }],
    specced: Array.from({ length: 6 }, (_, i) => c(`t-04${50 + i}`, `Specced ask ${i + 1}: a longer title that wraps onto a second line in its column`, 'specced', 48 + i, i === 2 ? { folds: ['t-0448'] } : {})),
    todo: Array.from({ length: 12 }, (_, i) => c(`t-05${String(10 + i)}`, `To do ${i + 1}`, 'specced', 10 + i, { priority: 'P1' })),
    building: [c('t-0567', 'The task board', 'building', 1, { link: { label: 'PR 84', url: 'https://github.com/sisodias/siso-internal-labs-agent-base/pull/84' } })],
    landed: [{ version: 143, at: ago(1), sha: 'cce65eae11f8', cards: [c('t-0565', 'The in-app browser opens URLs', 'live', 30, { live_at: ago(1), link: { label: 'v143', url: 'https://github.com/sisodias/siso-internal-labs-agent-base/commit/cce65eae11f8' } })] },
      { version: 142, at: ago(20), sha: 'aaaaaaa', cards: [c('t-0541', 'Agent Base lanes', 'live', 60, { live_at: ago(20) }), c('t-0534', 'Hot loop', 'live', 70, { live_at: ago(21) })] }],
  },
});
const count = (b) => { b.queue = b.lanes.specced.length + b.lanes.todo.length + b.lanes.building.length; return b; };

let server, browser;
try {
  server = await createServer({ root: path.join(root, 'apps/web'), configFile: path.join(root, 'apps/web/vite.config.ts'), logLevel: 'error',
    plugins: [{ name: 'sealed-api', configureServer(v) { v.middlewares.use((req, res, next) => { if (/^\/(api|chat|term)\b/.test(req.url ?? '')) { res.statusCode = 410; res.end('Fixture only'); return; } next(); }); } }],
    server: { host: '127.0.0.1', port: 0, strictPort: false, hmr: false, watch: { ignored: ['**/*'] } } });
  await server.listen();
  const base = `http://127.0.0.1:${server.httpServer.address().port}`;
  browser = await webkit.launch({ headless: true });
  const results = [];
  for (const width of [1440, 390]) {
    const board = count(fresh()), posts = [], errors = [];
    let next = 600;
    const page = await browser.newPage({ viewport: { width, height: 1000 }, reducedMotion: 'reduce' });
    page.on('pageerror', e => errors.push(e.message));
    await page.addInitScript(phone => { window.EventSource = undefined; localStorage.setItem('agent-base:space', '"agents"'); if (phone) localStorage.setItem('agent-base:sidebar-open', 'false'); }, width < 700);
    await page.routeWebSocket('**/*', socket => socket.close());
    await page.route('**/*', route => new URL(route.request().url()).origin === base ? route.fallback() : route.abort());
    await page.route(`${base}/api/**`, route => {
      const req = route.request(), p = new URL(req.url()).pathname;
      if (p === '/api/board/agent-base' && req.method() === 'POST') {
        const w = JSON.parse(req.postData() ?? '{}'); posts.push(w);
        if (w.op === 'tell' && w.kind === 'idea') { const id = `i-0${next++}`; board.lanes.ideas.unshift({ id, kind: 'idea', title: w.words, his: w.words, at: new Date().toISOString(), stage: 'idea', by: 'Shaan' }); return route.fulfill({ json: { ok: true, id, lane: 'ideas' } }); }
        if (w.op === 'tell') { const id = `t-0${next++}`; board.lanes.todo.unshift(c(id, w.words, 'specced', 0, { his: w.words, priority: 'P1' })); count(board); return route.fulfill({ json: { ok: true, id, lane: 'todo' } }); }
        if (w.op === 'order') { board.lanes.todo = w.ids.map(id => board.lanes.todo.find(x => x.id === id)); return route.fulfill({ json: { ok: true } }); }
        if (w.op === 'make-task') { board.lanes.ideas = board.lanes.ideas.filter(x => x.id !== w.id); const id = `t-0${next++}`; board.lanes.specced.push(c(id, 'Made from an idea', 'specced', 0)); count(board); return route.fulfill({ json: { ok: true, id, lane: 'specced' } }); }
        return route.fulfill({ status: 400, json: { ok: false, error: 'unknown' } });
      }
      if (p === '/api/board/agent-base') return route.fulfill({ json: board });
      if (p === '/api/org/project/agent-base') return route.fulfill({ json: { id: 'agent-base', name: 'Agent Base', group: 'labs', shown: true, order: 0, owners: [{ name: 'AGENT-BASE', main: true, domain: 'Agent Base', icon: 'box', state: 'planned', working: 0, plan: null }] } });
      const spec = /^\/api\/board\/agent-base\/spec\/(t-\d+)$/.exec(p);
      if (spec) return route.fulfill({ json: { id: spec[1], text: `# ${spec[1]}\n\n## His words (verbatim)\n> his words for ${spec[1]}\n\n## Done when\n- it works` } });
      if (p === '/api/browser/state' && req.method() !== 'GET') return route.fulfill({ json: { ok: true } });
      const body = fixtureResponse(p, 'fixture');
      return body === undefined ? route.fulfill({ status: 404, json: {} }) : route.fulfill({ json: body });
    });
    const orgRead = page.waitForResponse(r => new URL(r.url()).pathname === '/api/org');
    await page.goto(base); await orgRead; await page.waitForTimeout(300);
    // The rail icon opens straight to the board (at 390 the rail is in the closed drawer).
    if (width < 700) await page.evaluate(() => { location.hash = '#project/agent-base'; });
    else {
      const rail = page.getByRole('button', { name: /^Agent Base: /, exact: false });
      await rail.hover();
      const peek = page.getByTestId('agent-base-peek');
      await peek.getByText('t-0567').waitFor();
      const peekText = await peek.innerText();
      assert.ok(peekText.includes('BUILDING') && peekText.includes('The task board'), 'peek shows what is building');
      assert.ok(['To do 1', 'To do 2', 'To do 3'].every(t => peekText.includes(t)) && !peekText.includes('To do 4'), 'and the top three to do');
      assert.ok(!/PRIORITY|in features/.test(peekText), 'never the old stale priority');
      await page.screenshot({ path: path.join(shots, `peek-after-${width}.png`), clip: await peek.boundingBox().then(b => ({ x: Math.max(0, b.x - 70), y: Math.max(0, b.y - 20), width: b.width + 90, height: b.height + 40 })) });
      await peek.getByRole('button', { name: 'Open the board' }).click();
    }
    const tb = page.getByTestId('task-board');
    await tb.waitFor();
    assert.equal(await page.getByRole('tab', { name: 'Tasks', exact: true }).getAttribute('aria-selected'), 'true', 'opens on Tasks');
    assert.equal(await page.getByRole('tab', { name: 'Overview', exact: true }).count(), 0, 'no dead Overview');
    const lanes = await tb.locator('.tb-lane').evaluateAll(ls => ls.map(l => l.getAttribute('aria-label')));
    assert.deepEqual(lanes, ['Ideas', 'Specced', 'To do', 'Building', 'Landed'], 'five lanes, left to right');
    const counts = async () => Object.fromEntries(await Promise.all(lanes.map(async n => [n, Number(await page.getByTestId(`count-${n}`).innerText())])));
    assert.deepEqual(await counts(), { Ideas: 3, Specced: 6, 'To do': 12, Building: 1, Landed: 3 });
    assert.match(await page.getByTestId('board-total').innerText(), /^19 open asks/);
    const pageText = await page.getByTestId('project-page').innerText();
    for (const dead of ['SCOUT', 'MINER', 'Crew refresh unavailable', 'OWNER’S WORKING BRIEF', 'Owner’s working brief', 'No plan yet']) assert.ok(!pageText.includes(dead), `gone: ${dead}`);
    assert.equal(await page.locator('.pp-summary, .pp-crew-band').count(), 0, 'no stats strip, no face grid');
    assert.ok((await page.getByTestId('sprint-line').innerText()).includes('Sprint 1: the task board'), 'the sprint line from its card');
    const todoLane = tb.getByRole('region', { name: 'To do' });
    assert.equal(await todoLane.locator('.tb-drop .tb-card').count(), 10, 'Now is the sprint\'s ten');
    if (width === 1440) await page.screenshot({ path: path.join(shots, `board-after-${width}.png`) });

    // A typed idea lands in Ideas at once.
    const box = page.getByRole('textbox', { name: 'Tell Agent Base' });
    await page.getByRole('radio', { name: 'Idea' }).click();
    await box.fill('Make the board talk back');
    await box.press('Enter');
    await page.getByText(/i-0\d+ is in Ideas\./).waitFor();
    assert.equal(await tb.getByRole('region', { name: 'Ideas' }).locator('.tb-card').first().innerText().then(t => t.includes('Make the board talk back')), true);
    // A typed task lands at the top of To do, his words verbatim.
    await page.getByRole('radio', { name: 'Task' }).click();
    await box.fill('Show me the release notes on the board');
    await page.getByRole('button', { name: 'Tell', exact: true }).click();
    await page.getByText(/is at the top of To do/).waitFor();
    const firstTodo = todoLane.locator('.tb-card').first();
    assert.ok((await firstTodo.innerText()).includes('Show me the release notes on the board'));
    assert.deepEqual(posts.filter(w => w.op === 'tell'), [{ op: 'tell', words: 'Make the board talk back', kind: 'idea' }, { op: 'tell', words: 'Show me the release notes on the board', kind: 'task' }]);
    assert.equal(await page.getByTestId('count-To do').innerText(), '13');
    // His order: Alt+Down moves the top card one place, and the order is saved.
    const firstId = await firstTodo.getAttribute('data-card');
    await firstTodo.locator('.tb-card__open').focus();
    await page.keyboard.press('Alt+ArrowDown');
    await page.waitForFunction(id => document.querySelectorAll('[data-lane="To do"] .tb-card')[1]?.getAttribute('data-card') === id, firstId);
    const order = posts.filter(w => w.op === 'order').at(-1);
    assert.equal(order.ids[1], firstId, 'order saved');
    // Drag: the last card to the top.
    if (width === 1440) {
      const cards = todoLane.locator('.tb-card');
      const last = await cards.last().getAttribute('data-card');
      // Playwright's WebKit does not run HTML drag and drop, so the drag is the browser's own events, in order.
      await page.evaluate(id => {
        const from = document.querySelector(`[data-card="${id}"]`), to = document.querySelector('[data-lane="To do"] .tb-card'), dt = new DataTransfer();
        for (const [el, type] of [[from, 'dragstart'], [to, 'dragover'], [to, 'drop'], [from, 'dragend']]) el.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt }));
      }, last);
      await page.waitForFunction(id => document.querySelector('[data-lane="To do"] .tb-card')?.getAttribute('data-card') === id, last);
      assert.equal(posts.filter(w => w.op === 'order').at(-1).ids[0], last, 'a drag to the top is saved');
      results.push({ width, drag: 'moved to the top and saved' });
    }
    // Make it a task.
    await tb.getByRole('region', { name: 'Ideas' }).locator('[data-card="ab-020"]').getByRole('button', { name: 'Make it a task' }).click();
    await page.waitForFunction(() => !document.querySelector('[data-card="ab-020"]'));
    assert.equal(await page.getByTestId('count-Specced').innerText(), '7');
    // A card opens its spec and his words; Escape closes it.
    await tb.locator('[data-card="t-0452"] .tb-card__open').click();
    const sheet = page.getByRole('dialog');
    await sheet.getByText('his words for t-0452').first().waitFor();
    await sheet.locator('.tb-dialog__spec').getByText('## Done when', { exact: false }).waitFor();
    assert.ok((await sheet.innerText()).includes('Replaces') === false, 'sheet is the card, not its row');
    if (width === 390) await page.screenshot({ path: path.join(shots, `sheet-after-${width}.png`) });
    await page.keyboard.press('Escape');
    await sheet.waitFor({ state: 'hidden' });
    // Building and Landed link to the PR or release.
    assert.equal(await tb.locator('[data-card="t-0567"] a').getAttribute('href'), 'https://github.com/sisodias/siso-internal-labs-agent-base/pull/84');
    assert.ok((await tb.getByRole('region', { name: 'Landed' }).innerText()).includes('v143'));
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'no sideways scroll');
    await page.screenshot({ path: path.join(shots, `board-after-told-${width}.png`), fullPage: width < 700 });
    assert.deepEqual(errors, []);
    results.push({ width, lanes: lanes.length, told: 'idea in Ideas, task top of To do', order: 'saved' });
    await page.close();
  }
  console.log('PASS task board', JSON.stringify(results));
} finally { await browser?.close(); await server?.close(); }
