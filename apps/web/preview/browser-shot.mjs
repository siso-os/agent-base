// Production bundle (laptop via heavy, or the mini), isolated WebKit storage, fake accounts, no live node or agents.
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';
const { webkit } = createRequire(process.env.AB_PLAYWRIGHT ?? '/tmp/ab-hub3-tools/package.json')('playwright');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const preview = path.join(root, 'preview');
const server = createServer(async (req, res) => {
  const pathname = new URL(req.url, 'http://localhost').pathname;
  if (pathname.startsWith('/fixture/')) {
    res.setHeader('content-type', 'text/html');
    return res.end('<body style="background:#171715;color:#eee;font:16px system-ui;padding:48px"><small>Fake browser fixture · no signed-in account</small><h1>One window for your pages</h1><p>Spaces, favourite icons, pinned pages and Today tabs.</p></body>');
  }
  const target = pathname.startsWith('/preview/') ? path.join(root, pathname) : path.join(root, 'dist', pathname === '/' ? 'index.html' : pathname);
  if (!target.startsWith(root + '/')) { res.writeHead(403); return res.end(); }
  try {
    res.setHeader('content-type', target.endsWith('.js') ? 'text/javascript' : target.endsWith('.css') ? 'text/css' : target.endsWith('.png') ? 'image/png' : 'text/html');
    res.end(await readFile(target));
  } catch { res.writeHead(404); res.end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
let browser;
const checks = [];
try {
  browser = await webkit.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/api/**', route => /\/events(\?|$)/.test(route.request().url()) ? route.fulfill({ contentType: 'text/event-stream', body: '' }) : route.fulfill({ json: { agents: [], domains: [], projects: [], pinnedPages: [], recentPages: [], notifications: [], announcements: [], groups: [], top: [], bottom: [], hidden: [], at: Date.now() } }));
  await page.addInitScript(({ origin }) => {
    if (localStorage.getItem("browser-proof-seeded")) return;
    localStorage.clear();
    localStorage.setItem("browser-proof-seeded", "1");
    const favorite = (space, title) => ({ url: origin + '/fixture/' + space + '/' + title.toLowerCase(), title, pinned: true });
    localStorage.setItem('agent-base:arc-profiles', JSON.stringify([
      { id: 'personal', name: 'Personal', pins: ['Design docs', 'GitHub docs', 'Project brief'].map(t => favorite('pins', t)) },
      { id: 'HALO', name: 'HALO', pins: ['HALO workspace', 'HALO docs', 'HALO brief'].map(t => favorite('halo-pins', t)) },
      // Arc's favourites are one global set (arc-edges §3 row 3); 11 like his, so the 9th+ fold into "+4".
      { id: 'arc-favorites', name: 'Arc Favorites', pins: ['Perplexity', 'ChatGPT', 'YouTube', 'X', 'Cloudflare', 'SISO', 'Mail', 'GitHub', 'Tasks', 'Docs', 'Calendar'].map(t => favorite('fav', t)) },
    ]));
    localStorage.setItem('agent-base:browser-today', JSON.stringify({ personal: ['Inbox · fake', 'Today docs', 'Today project', 'Today video'].map((title, i) => ({ url: origin + '/fixture/personal-today/' + i, title, at: Date.now() - i * 1000 })), HALO: ['HALO Today', 'HALO Today docs', 'HALO Today project', 'HALO Today video'].map((title, i) => ({ url: origin + '/fixture/halo-today/' + i, title, at: Date.now() - i * 1000 })) }));
  }, { origin });
  // The node's browser state (GET, PUT, and PATCH of the changed fields: /api/browser/state), FAKE and in memory: the
  // first load migrates localStorage into it.
  let nodeState = {};
  const nodePuts = [];
  await page.route('**/api/browser/state', async route => {
    const method = route.request().method();
    if (method === 'PUT' || method === 'PATCH') { const body = JSON.parse(route.request().postData() || '{}'); nodeState = method === 'PUT' ? body : { ...nodeState, ...body }; nodePuts.push(Date.now()); return route.fulfill({ json: { ok: true } }); }
    return route.fulfill({ json: nodeState });
  });
  const until = async (ok, what) => { for (let i = 0; i < 100; i++) { if (ok()) return; await new Promise(r => setTimeout(r, 100)); } throw new Error(`timed out: ${what}`); };
  await page.goto(origin);
  await page.getByRole('button', { name: /^Browser: / }).click();
  const sidebar = page.getByRole('complementary', { name: 'Browser sidebar' });
  await sidebar.waitFor();
  assert.equal(await sidebar.getByRole('button', { name: /^Favourite:/ }).count(), 7);
  await sidebar.getByRole('button', { name: '4 more favourites', exact: true }).click();
  assert.equal(await sidebar.getByRole('button', { name: /^Favourite:/ }).count(), 11);
  await sidebar.getByRole('button', { name: 'Fewer favourites', exact: true }).click();
  assert.equal(await sidebar.getByRole('button', { name: /^Favourite:/ }).count(), 7);
  assert.equal(await sidebar.getByRole('button', { name: 'Favourite: Design docs', exact: true }).count(), 0, 'favourites are never the space pins');
  checks.push('Favourites: Arc\'s 11 as one global set, 2 rows of 4 with "+4" that opens the rest; never the space\'s pins');
  await until(() => nodeState.migratedAt && nodeState.spaces?.length === 3 && nodeState.today?.personal?.length === 4, 'localStorage migrated into the node');
  checks.push('First load migrates the browser state from localStorage into the node (spaces, Today) once');
  // First run (spec §3): no Google account yet, so the import sheet opens by itself; closing it stays closed (in the node).
  const sheet = page.getByRole('dialog', { name: 'Import from Arc and Chrome' });
  await sheet.waitFor();
  assert.match(await sheet.locator('[aria-current="step"]').innerText(), /What's on this Mac/);
  await sheet.getByText('Could not look at Arc and Chrome on this Mac.', { exact: true }).waitFor(); // the catch-all fake is not a counts answer
  await sheet.getByRole('button', { name: 'Do the rest whenever', exact: true }).click();
  await sheet.waitFor({ state: 'detached' });
  await until(() => nodeState.setup?.closedAt, 'closing the sheet is kept by the node');
  checks.push('First run with no Google account opens the import sheet by itself; "Do the rest whenever" closes it and the node keeps that');
  checks.push('Actual App rail opens the browser; eight favourite tiles span two rows in the four-column grid; bottom space chips render');
  await sidebar.getByRole('button', { name: 'Inbox · fake', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.siso-page__address')?.dataset.url.endsWith('/fixture/personal-today/0'));
  await page.getByRole('button', { name: /^Browser: / }).click();
  await page.waitForTimeout(300);
  assert.ok(await page.evaluate(() => document.querySelector('.siso-page__address')?.dataset.url.endsWith('/fixture/personal-today/0')));
  checks.push('Clicking the rail again keeps the same browser tab instead of opening a blank one');
  const order = await sidebar.evaluate(el => {
    const y = sel => el.querySelector(sel)?.getBoundingClientRect().top ?? -1;
    const newTab = [...el.querySelectorAll('.ab-browser__tabs > .ab-browser__row')].find(b => b.textContent === 'New tab');
    return [y('.ab-browser__top'), y('.ab-browser__address'), y('.ab-browser__favorites'), y('.ab-browser__pinned'), newTab?.getBoundingClientRect().top ?? -1, y('.ab-browser__tabs .ab-browser__tab'), y('.ab-browser__spaces')];
  });
  assert.ok(order.every((v, i) => v >= 0 && (i === 0 || v > order[i - 1])), `sidebar block order ${order}`);
  assert.deepEqual(await sidebar.locator('h3').allInnerTexts().then(t => t.map(x => x.toUpperCase())), ['TODAY'], 'arc-edges §1: the only section headings are PINNED (a fold button) and TODAY');
  assert.equal(await sidebar.locator('.ab-browser__pinned .ab-browser__site').count(), 3);
  checks.push('Sidebar order matches v0.5 #s7: top row, URL, favourites, pinned, divider, New tab, Today tabs, spaces; rows carry site marks');
  await page.getByRole('button', { name: 'Pin', exact: true }).click();
  await page.getByRole('button', { name: 'Unpin', exact: true }).waitFor();
  await sidebar.locator('.ab-browser__pinned').getByRole('button', { name: 'Inbox · fake', exact: true }).waitFor();
  await page.reload();
  await page.getByRole('button', { name: /^Browser: / }).click();
  await sidebar.locator('.ab-browser__pinned').getByRole('button', { name: 'Inbox · fake', exact: true }).click();
  await page.getByRole('button', { name: 'Unpin', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Unpin', exact: true }).click();
  await page.getByRole('button', { name: 'Pin', exact: true }).waitFor();
  checks.push('Pin and unpin update the per-space sidebar');
  await page.screenshot({ path: path.join(preview, 'browser-arc-webkit.png') });
  const colourBefore = await sidebar.evaluate(el => getComputedStyle(el).backgroundImage);
  assert.equal(await page.locator('select[aria-label="Browser profile"]').count(), 0);
  assert.equal(await page.locator('.siso-page__bar, .siso-page__note').count(), 0);
  const grid = await sidebar.locator('.ab-browser__favorites').evaluate(el => ({ columns: getComputedStyle(el).gridTemplateColumns.split(' ').length, rows: getComputedStyle(el).gridTemplateRows.split(' ').length, top: el.getBoundingClientRect().top }));
  assert.equal(grid.columns, 4); assert.equal(grid.rows, 2);
  const spaces = sidebar.getByRole('navigation', { name: 'Browser spaces' });
  await spaces.getByRole('button', { name: 'HALO', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.siso-page__address')?.dataset.url.endsWith('/fixture/halo-today/0'));
  assert.equal(await sidebar.getByRole('button', { name: 'Inbox · fake', exact: true }).count(), 0);
  assert.equal(await sidebar.getByRole('button', { name: 'HALO workspace', exact: true }).count(), 1);
  assert.notEqual(await sidebar.evaluate(el => getComputedStyle(el).backgroundImage), colourBefore);
  assert.equal(await sidebar.getByRole('button', { name: 'Favourite: Perplexity', exact: true }).count(), 1, 'the same favourites in every space');
  const chipStyle = await spaces.getByRole('button', { name: 'HALO', exact: true }).evaluate(el => ({ radius: getComputedStyle(el).borderRadius, outline: getComputedStyle(el).outlineStyle }));
  assert.equal(chipStyle.radius, '50%'); assert.equal(chipStyle.outline, 'solid');
  assert.ok(await spaces.evaluate(el => el.getBoundingClientRect().top > innerHeight - 100));
  await spaces.getByRole('button', { name: 'Personal', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.siso-page__address')?.dataset.url.endsWith('/fixture/personal-today/0'));
  checks.push('Switching spaces restores each profile URL and keeps pinned/Today rows isolated');
  await sidebar.getByRole('button', { name: 'Close Inbox · fake', exact: true }).click();
  assert.equal(await sidebar.getByRole('button', { name: 'Inbox · fake', exact: true }).count(), 0);
  await page.reload();
  await page.getByRole('button', { name: /^Browser: / }).click();
  await sidebar.waitFor();
  assert.equal(await sidebar.getByRole('button', { name: 'Inbox · fake', exact: true }).count(), 0);
  checks.push('Closing a Today tab survives reload; favourite and pinned rows remain');
  await sidebar.getByRole('button', { name: 'Browser options', exact: true }).click();
  await sidebar.getByRole('menuitem', { name: 'New space', exact: true }).click();
  await page.getByRole('textbox', { name: 'New space name' }).fill('Personal');
  await page.getByRole('button', { name: 'Create space', exact: true }).click();
  assert.match(await page.getByRole('complementary', { name: 'Browser sidebar' }).getByRole('alert').innerText(), /already exists/);
  await page.getByRole('textbox', { name: 'New space name' }).fill('Fake second account');
  await page.getByRole('button', { name: 'Create space', exact: true }).click();
  await spaces.getByRole('button', { name: 'Fake second account', exact: true }).waitFor();
  checks.push('Duplicate space name is rejected; a new space appears as a chip');
  await page.setViewportSize({ width: 1100, height: 800 });
  await page.screenshot({ path: path.join(preview, 'browser-arc-webkit-1100.png') });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  checks.push('1100px viewport has no horizontal document overflow');
  // arc-edges §1: the sidebar never scrolls; on a short window Today scrolls in its own box and the space bar stays put.
  await spaces.getByRole('button', { name: 'Personal', exact: true }).click();
  await sidebar.locator('.ab-browser__pinned .ab-browser__row').first().waitFor();
  await page.setViewportSize({ width: 1100, height: 520 });
  const box = () => sidebar.evaluate(el => { const tabs = el.querySelector('.ab-browser__tabs'), bar = el.querySelector('.ab-browser__spaces'); return { side: el.scrollHeight - el.clientHeight, tabs: tabs.scrollHeight - tabs.clientHeight, barBottom: bar.getBoundingClientRect().bottom, sideBottom: el.getBoundingClientRect().bottom }; });
  await page.screenshot({ path: path.join(preview, 'browser-short-webkit.png') });
  const short = await box();
  assert.equal(short.side, 0, `the sidebar itself does not scroll (${JSON.stringify(short)})`);
  assert.ok(short.tabs > 0, `Today scrolls in its own box (${JSON.stringify(short)})`);
  assert.ok(short.barBottom <= short.sideBottom + 1, 'the space bar is on screen');
  await page.screenshot({ path: path.join(preview, 'browser-short-webkit.png') });
  // Pinned folds to its header and stays folded for this space.
  const pinsHead = sidebar.locator('.ab-browser__pinned .ab-browser__head');
  assert.equal(await pinsHead.innerText().then(t => t.replace(/\s+/g, ' ').trim().toUpperCase()), 'PINNED 3');
  await pinsHead.click();
  assert.equal(await sidebar.locator('.ab-browser__pinned .ab-browser__row').count(), 0);
  await pinsHead.click();
  assert.equal(await sidebar.locator('.ab-browser__pinned .ab-browser__row').count(), 3);
  await page.setViewportSize({ width: 1100, height: 800 });
  await spaces.getByRole('button', { name: 'Fake second account', exact: true }).click();
  checks.push('Sidebar never scrolls: at 1100×520 Today scrolls in its own box, the space bar stays on screen; Pinned folds to "PINNED 3"');
  // Fake sign-in HTML is served at Google's origin by Playwright; no provider request or real account.
  const accountScript = await readFile(path.join(root, '../desktop/src/browser-google-account.js'), 'utf8');
  let fakeAccount = 0;
  await page.route('https://accounts.google.com/**', route => {
    const number = ++fakeAccount;
    return route.fulfill({ contentType: 'text/html', body: `<body style="background:#171715;color:#eee;font:16px system-ui;padding:32px"><h1>Fake Google sign-in fixture</h1><button onclick="const a=document.createElement('button');a.setAttribute('aria-label','Google Account: Fake User (fake${number}@example.invalid)');a.textContent='Fake signed-in avatar';document.body.append(a);this.remove()">Sign in with fake account</button></body>` });
  });
  await page.exposeBinding('__readFakeGoogleAccount', async (_source, tab) => {
    for (const frame of page.frames().filter(frame => /^https:\/\/[a-z.]*google\.com\//.test(frame.url()))) {
      const owner = await frame.frameElement().then(el => el.getAttribute('data-tab'), () => null); // a detached (hidden) page has no element
      if (owner === tab) return JSON.stringify(await frame.evaluate(accountScript));
    }
    return '';
  });
  await page.evaluate(() => {
    window.__fakeBrowserOpens = [];
    // Events (browser-download) as Tauri delivers them: a callback id per listener, fired by __fakeEmit.
    const callbacks = [];
    window.__fakeEmit = (event, payload) => { for (const id of window.__fakeListeners?.[event] ?? []) callbacks[id]({ payload }); };
    window.__TAURI_INTERNALS__ = { transformCallback: cb => callbacks.push(cb) - 1, invoke: async (command, args) => {
      if (command === 'plugin:event|listen') { ((window.__fakeListeners ??= {})[args.event] ??= []).push(args.handler); return args.handler; }
      if (command === 'browser_audio') return (window.__fakeAudio ?? []).includes(args.tab);
      if (command === 'browser_action') { (window.__fakeActions ??= []).push(args); if (args.action === 'mute' || args.action === 'pause') window.__fakeAudio = (window.__fakeAudio ?? []).filter(k => k !== args.tab); if (args.action === 'play') window.__fakeAudio = [...(window.__fakeAudio ?? []), args.tab]; }
      // One fake page per tab key, as the native side keeps them: hidden on leave, removed only on close.
      const frames = window.__fakeFrames ??= new Map();
      if (command === 'browser_open') {
        window.__fakeBrowserOpens.push(args);
        let frame = frames.get(args.tab);
        if (!frame) {
          frame = document.createElement('iframe');
          frame.dataset.fakeGoogle = 'true'; frame.dataset.tab = args.tab; frame.src = args.rawUrl;
          frame.style.cssText = 'width:100%;height:100%;border:0';
          frames.set(args.tab, frame);
        }
        const slot = document.querySelector('[data-native-browser]');
        if (frame.parentNode !== slot) slot.replaceChildren(frame); // re-inserting an iframe reloads it
      }
      if (command === 'browser_visible') { const frame = frames.get(args.tab); if (frame) { frame.style.display = args.visible ? '' : 'none'; const slot = document.querySelector('[data-native-browser]'); if (args.visible && slot && frame.parentNode !== slot) slot.replaceChildren(frame); } }
      if (command === 'browser_close') { frames.get(args.tab)?.remove(); frames.delete(args.tab); }
      if (command === 'browser_google_account') return window.__readFakeGoogleAccount(args.tab);
      // The native side answers no address while a page loads; only the fake stuck site never finishes.
      if (command === 'browser_url') { const f = frames.get(args.tab); try { return f && new URL(f.src).hostname === 'stuck.invalid' ? '' : undefined; } catch { return undefined; } }
      if (command === 'browser_navigate') { (window.__fakeNavs ??= []).push(args); const frame = frames.get(args.tab); if (frame) frame.src = args.rawUrl; }
      // Signed in or not, per account store; unset = no answer (as outside the desktop app).
      // The store read answers [signed in, session cookie names, Google cookie count] (t-0242): FAKE names and counts only.
      if (command === 'browser_session_state') { (window.__fakeChecks ??= []).push(args.account); const v = window.__fakeSessions?.[args.account]; return typeof v === 'boolean' ? [v, v ? ['SID', '__Secure-1PSID'] : [], v ? 23 : 2] : v; }
    } };
  });
  await sidebar.getByRole('button', { name: 'Browser options', exact: true }).click();
  await sidebar.getByRole('menuitem', { name: '+ Google account', exact: true }).click();
  await page.frameLocator('iframe[data-fake-google]').getByRole('button', { name: 'Sign in with fake account' }).click();
  await until(() => nodeState.accounts?.some(a => a.email === 'fake1@example.invalid' && !a.pendingGoogle), 'fake1 account named from its sign-in');
  await sidebar.getByRole('button', { name: 'Browser options', exact: true }).click();
  await sidebar.getByRole('menuitem', { name: '+ Google account', exact: true }).click();
  await page.frameLocator('iframe[data-fake-google]').getByRole('button', { name: 'Sign in with fake account' }).click();
  await until(() => nodeState.accounts?.some(a => a.email === 'fake2@example.invalid'), 'fake2 account named from its sign-in');
  assert.equal(await spaces.getByRole('button', { name: /fake\d@example/ }).count(), 0, 'a Google account is not a space');
  const opens = await page.evaluate(() => window.__fakeBrowserOpens);
  assert.equal(opens.length, 2);
  assert.notEqual(opens[0].profile, opens[1].profile);
  assert.ok(opens.every(p => p.rawUrl === 'https://accounts.google.com/?hl=en'));
  checks.push('Fake sign-in DOM: two quick-add Google ACCOUNTS use distinct stores, rename through the production avatar selector, and are not space chips');
  await page.screenshot({ path: path.join(preview, 'browser-google-ui-webkit.png') });
  await sidebar.getByRole('button', { name: 'Browser options', exact: true }).click();
  await sidebar.getByRole('menuitem', { name: 'Accounts', exact: true }).click();
  await page.getByRole('heading', { name: 'Accounts', exact: true }).waitFor();
  // Accounts not signed in yet are folded under "Add accounts"; this opens it when it is there and shut.
  const openAdd = async () => { const b = page.getByRole('button', { name: /^Add accounts/ }); if (await b.count() && await b.getAttribute('aria-expanded') !== 'true') await b.click(); };
  await openAdd();
  assert.equal(await page.locator('.ab-hub__tile').filter({ hasText: 'fake2@example.invalid' }).count(), 1);
  assert.equal(await page.locator('.ab-hub__tile').filter({ hasText: 'fake2@example.invalid' }).getByText('Not used yet').count(), 0);
  await page.waitForFunction(() => ![...document.querySelectorAll('iframe[data-fake-google]')].some(f => f.isConnected && f.style.display !== 'none'));
  assert.equal(await page.evaluate(() => window.__fakeFrames.size), 2, 'both Google sign-in pages stay alive while Accounts is open');
  await page.locator('.ab-hub__tile').first().waitFor();
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await page.screenshot({ path: path.join(preview, 'browser-accounts-webkit.png') });
  checks.push('Accounts shows fake account address, space and last-used time; no password or cookie fields exist; both sign-in pages stay alive behind it');

  // Import from Arc and Chrome, from a FAKE node payload: counts first (GET), then spaces, Today tabs and one account per
  // Chrome Google profile (POST), walked through the 4-step sheet.
  let passwordPage = 0;
  await page.route('**/api/browser/chrome-passwords', route => { passwordPage++; return route.fulfill({ json: { ok: true } }); });
  await page.route('**/api/browser/import', route => route.request().method() === 'GET' ? route.fulfill({ json: { arc: { found: true, spaces: 1, favourites: 0, pinned: 1, today: 1 }, chrome: { found: true, profiles: 2, signedIn: 1, bookmarks: 1 } } }) : route.fulfill({ json: {
    arc: { found: true, spaces: [{ id: 'arc:fake-halo', name: 'HALO', pins: [{ url: origin + '/fixture/arc/halo-pin', title: 'Fake Arc HALO pin', pinned: true }] }, { id: 'arc:fake-space', name: 'Fake Arc space', pins: [{ url: origin + '/fixture/arc/pin', title: 'Fake Arc pin', pinned: true }], today: [{ url: origin + '/fixture/arc/today', title: 'Fake Arc today' }] }] },
    chrome: { found: true, accounts: [{ dir: 'Default', name: 'Person 1', email: 'fake.chrome@example.invalid', bookmarks: [{ url: origin + '/fixture/chrome/bookmark', title: 'Fake bookmark' }] }, { dir: 'Profile 3', name: 'Spare', bookmarks: [] }] },
  } }));
  await page.getByRole('button', { name: 'Back to browser', exact: true }).click();
  await sidebar.getByRole('button', { name: 'Browser options', exact: true }).click();
  await sidebar.getByRole('menuitem', { name: 'Import from Arc and Chrome', exact: true }).click();
  // Step 1: what is on this Mac (counts), and what is not coming across and why.
  await sheet.getByText('1 Google accounts', { exact: true }).waitFor();
  await sheet.getByText('Google treats moved cookies as theft; you sign in once per account.').waitFor();
  assert.equal(await sheet.locator('input[type=password]').count(), 0);
  await page.screenshot({ path: path.join(preview, 'browser-setup-1-webkit.png') });
  await sheet.getByRole('button', { name: 'Bring it across', exact: true }).click();
  await sidebar.getByRole('status').filter({ hasText: 'Imported 2 Arc spaces and 1 Google accounts from Chrome. 3 new.' }).waitFor();
  // Step 2: sorted into spaces. example.invalid names no space, so it starts in Personal; he moves it to HALO, where it
  // is the only (so default) account. Accounts with no address are not sorted.
  const sortStep = sheet.getByRole('region', { name: 'Sort accounts into spaces' });
  await sortStep.waitFor();
  const column = name => sortStep.getByRole('group', { name, exact: true });
  await column('Personal').getByRole('button', { name: 'fake.chrome@example.invalid', exact: true }).waitFor();
  assert.equal(await sortStep.getByText('Spare', { exact: true }).count(), 0);
  await sortStep.getByRole('button', { name: 'fake.chrome@example.invalid', exact: true }).click();
  await column('HALO').getByRole('button', { name: 'Move here: HALO', exact: true }).click();
  await column('HALO').getByRole('button', { name: 'fake.chrome@example.invalid', exact: true }).waitFor();
  assert.equal(await column('HALO').getByRole('button', { name: 'Default for HALO', exact: true }).getAttribute('aria-pressed'), 'true');
  await page.screenshot({ path: path.join(preview, 'browser-setup-2-webkit.png') });
  await sortStep.getByRole('button', { name: 'Looks right', exact: true }).click();
  await until(() => nodeState.spaces.find(x => x.id === 'HALO')?.account === 'chrome:Default' && nodeState.accounts.find(a => a.id === 'chrome:Default')?.space === 'HALO' && nodeState.setup?.step === 3, 'HALO defaults to the account sorted into it');
  assert.equal(nodeState.spaces.find(x => x.id === 'arc-favorites')?.pins.length, 11, '"Looks right" keeps the favourites it did not show (the 3 Oct loss)');
  // Step 3: only his main account (the rest wait under "Add accounts"); signing in leaves the sheet, a chip brings him back.
  const signStep = sheet.getByRole('region', { name: 'Sign in' });
  await signStep.getByText('Start with your main account (about 1 minute: password, then a prompt on your phone).').waitFor();
  const main = await signStep.locator('.ab-setup__main b').innerText();
  assert.match(main, /^fake\d@example\.invalid$/, "Personal's account is the main one");
  assert.equal(await signStep.locator('.ab-setup__queue').count(), 0, 'no list of the other accounts');
  await signStep.getByText(/in Accounts under “Add accounts”/).waitFor();
  await signStep.getByRole('button', { name: `Sign in to ${main}`, exact: true }).click();
  await sheet.waitFor({ state: 'detached' });
  await page.waitForFunction((m) => document.querySelector('.siso-page__address')?.dataset.url.startsWith('https://accounts.google.com/AccountChooser?Email=' + encodeURIComponent(m)), main);
  const chip = sidebar.getByRole('button', { name: 'Finish import · 2 of 4 done', exact: true });
  await chip.click();
  await signStep.waitFor();
  await page.screenshot({ path: path.join(preview, 'browser-setup-3-webkit.png') });
  // A link always shows the page (P0, 3 Oct): the sheet is an overlay a navigation closes; Esc closes it and the chip stays.
  await page.getByRole('combobox', { name: 'Search or enter a URL' }).fill(origin + '/fixture/link/from-chat');
  await page.getByRole('combobox', { name: 'Search or enter a URL' }).press('Enter');
  await sheet.waitFor({ state: 'detached' });
  await page.waitForFunction(() => document.querySelector('.siso-page__address')?.dataset.url.endsWith('/fixture/link/from-chat'));
  await page.locator('[data-native-browser]').waitFor();
  assert.equal(await page.locator('iframe[data-fake-google]:visible').count(), 1, 'the page is shown, not the sheet');
  await chip.click();
  await signStep.waitFor();
  await page.keyboard.press('Escape');
  await sheet.waitFor({ state: 'detached' });
  await until(() => nodeState.setup?.closedAt, 'Esc keeps the sheet closed');
  await chip.click();
  await signStep.waitFor();
  checks.push('Link overlay P0: with setup part way through, opening a page closes the import sheet and shows the page; Esc closes it; the "Finish import" chip brings it back');
  // Step 4: the password export opens in Chrome (the node does it; nothing is read here), then Done.
  await signStep.getByRole('button', { name: 'Next: passwords (optional)', exact: true }).click();
  await sheet.getByRole('button', { name: "Open Chrome's password export", exact: true }).click();
  await sheet.getByRole('status').filter({ hasText: 'Opened in Chrome.' }).waitFor();
  assert.equal(passwordPage, 1);
  await page.screenshot({ path: path.join(preview, 'browser-setup-4-webkit.png') });
  await sheet.getByRole('button', { name: 'Done', exact: true }).click();
  await sheet.waitFor({ state: 'detached' });
  await until(() => nodeState.setup?.doneAt, 'setup done is kept by the node');
  assert.equal(await sidebar.getByRole('button', { name: /^Finish import/ }).count(), 0);
  checks.push('First-run sheet (fake counts and payload): step 1 counts + what is not coming across; step 2 sorts accounts into spaces (moved account becomes that space\'s default, kept in the node); step 3 main account first, Sign in leaves the sheet and a chip returns to the same step; step 4 opens Chrome\'s password export through the node; Done is kept');
  assert.equal(await spaces.getByRole('button', { name: 'fake.chrome@example.invalid', exact: true }).count(), 0, 'Chrome accounts are accounts, not space chips');
  assert.ok(nodeState.accounts.some(a => a.id === 'chrome:Default' && a.email === 'fake.chrome@example.invalid'));
  assert.ok(nodeState.spaces.every(s => !s.id.startsWith('chrome:')));
  assert.equal(await spaces.getByRole('button', { name: 'HALO', exact: true }).count(), 1, 'Arc\'s HALO merges into HALO: one chip');
  const halo = nodeState.spaces.find(s => s.id === 'HALO');
  assert.ok(halo.aliases?.includes('arc:fake-halo') && halo.pins.some(p => p.title === 'Fake Arc HALO pin') && halo.pins.some(p => p.title === 'HALO workspace'), 'pins unioned, Arc id kept as an alias');
  assert.ok(!nodeState.spaces.some(s => s.id === 'arc:fake-halo'));
  checks.push('Import: an Arc space named HALO merges into HALO (one chip, pins unioned, Arc id kept as an alias; a re-import adds nothing)');
  await spaces.getByRole('button', { name: 'Fake Arc space', exact: true }).click();
  await sidebar.locator('.ab-browser__pinned').getByRole('button', { name: 'Fake Arc pin', exact: true }).waitFor();
  assert.equal(await sidebar.locator('.ab-browser__tabs').getByRole('button', { name: 'Fake Arc today', exact: true }).count(), 0, "Arc's open tabs are not put in Today");
  await sidebar.getByRole('button', { name: 'Browser options', exact: true }).click();
  await sidebar.getByRole('menuitem', { name: 'Import from Arc and Chrome', exact: true }).click();
  await sheet.getByRole('button', { name: 'Bring it across', exact: true }).click();
  await sidebar.getByRole('status').filter({ hasText: '0 new' }).waitFor();
  await column('HALO').getByRole('button', { name: 'fake.chrome@example.invalid', exact: true }).waitFor();
  await sheet.getByRole('button', { name: 'Do the rest whenever', exact: true }).click();
  await sheet.waitFor({ state: 'detached' });
  await sidebar.getByRole('button', { name: 'Browser options', exact: true }).click();
  await sidebar.getByRole('menuitem', { name: 'Accounts', exact: true }).click();
  const chromeRow = page.locator('.ab-hub__tile').filter({ hasText: 'fake.chrome@example.invalid' });
  assert.equal(await page.locator('.ab-hub__tile').filter({ hasText: 'Spare' }).getByRole('button', { name: /^Sign in/ }).count(), 0);
  // Shaan, 3 Oct 01:00: nothing asks for the other accounts; they wait, folded, under "Add accounts".
  const hubLine = await page.locator('.ab-hub__head p').textContent();
  assert.match(hubLine, /^0 signed in · \d+ to add$/, hubLine);
  assert.equal(await page.getByRole('button', { name: /^Sign in next/ }).count(), 0);
  assert.equal(await page.getByRole('button', { name: 'Needs sign-in', exact: true }).count(), 0);
  assert.equal(await chromeRow.count(), 0, 'not signed in yet: folded under Add accounts');
  await openAdd();
  assert.equal(await chromeRow.count(), 1);
  assert.equal(await page.getByRole('button', { name: /^Add accounts/ }).getAttribute('aria-expanded'), 'true');
  assert.equal(await chromeRow.getByText('Not checked').count(), 1);
  await page.screenshot({ path: path.join(preview, 'browser-import-webkit.png') });
  await chromeRow.getByRole('button', { name: 'YouTube', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.siso-page__address')?.dataset.url === 'https://www.youtube.com/');
  await until(() => nodeState.choice && Object.entries(nodeState.choice).some(([k, v]) => k.startsWith('account:') && v === 'chrome:Default'), 'the tab now uses the Chrome Default account');
  await sidebar.getByRole('button', { name: 'Browser options', exact: true }).click();
  await sidebar.getByRole('menuitem', { name: 'Accounts', exact: true }).click();
  await openAdd();
  // The sign-in sheet (arc-edges §2.1): the hub's Sign in opens Google's sign-in inset in the hub, on that account's own store.
  await chromeRow.getByRole('button', { name: 'Sign in as fake.chrome@example.invalid', exact: true }).click();
  const signSheet = page.getByRole('region', { name: 'Signing in as fake.chrome@example.invalid' });
  await signSheet.waitFor();
  await page.waitForFunction(() => window.__fakeBrowserOpens.some(a => a.tab === 'signin:chrome:Default#chrome:Default' && a.rawUrl.startsWith('https://accounts.google.com/AccountChooser?Email=fake.chrome%40example.invalid')));
  assert.equal(await signSheet.locator('[aria-current="step"]').innerText(), 'address');
  assert.equal(await page.locator('input[type=password]').count(), 0);
  const sheetBox = await page.evaluate(() => { const s = document.querySelector('.ab-hub__sheet-page').getBoundingClientRect(); const h = document.querySelector('.ab-hub__sheet header').getBoundingClientRect(); return { w: Math.round(s.width), h: Math.round(s.height), bar: Math.round(h.height), right: Math.round(s.right) <= innerWidth }; });
  assert.ok(sheetBox.w === 520 && sheetBox.h >= 240 && sheetBox.h <= 600 && sheetBox.bar === 40 && sheetBox.right, JSON.stringify(sheetBox));
  // Google shows another address (the fake fixture signs in as fakeN@): "Keep it as" that one, or "Try again".
  await page.frameLocator('iframe[data-tab="signin:chrome:Default#chrome:Default"]').getByRole('button', { name: 'Sign in with fake account' }).click();
  const other = signSheet.getByRole('group', { name: 'Signed in as another account' });
  await other.waitFor();
  assert.match(await other.innerText(), /Google signed in as fake\d+@example\.invalid, not fake\.chrome@example\.invalid\./);
  assert.equal(await other.getByRole('button', { name: /^Keep it as fake\d+@example\.invalid$/ }).count(), 1);
  await page.screenshot({ path: path.join(preview, 'browser-signin-other-webkit.png') });
  await signSheet.getByRole('button', { name: 'Close sign-in', exact: true }).click();
  await signSheet.waitFor({ state: 'detached' });
  await page.waitForFunction(() => !window.__fakeFrames.has('signin:chrome:Default#chrome:Default'));
  // Closed early: the tile says where it stopped.
  await openAdd();
  await chromeRow.getByRole('button', { name: 'Sign in as fake.chrome@example.invalid', exact: true }).click();
  await signSheet.waitFor();
  await signSheet.getByRole('button', { name: 'Close sign-in', exact: true }).click();
  await openAdd();
  await chromeRow.getByText("Didn't finish", { exact: false }).waitFor();
  assert.match(await chromeRow.locator('.ab-hub__line').innerText(), /^Didn't finish · stopped at address · \d{1,2}:\d{2}/);
  assert.equal(nodeState.accounts.find(a => a.id === 'chrome:Default').signInStop?.step, 'address');
  // Every sign-in page (sheet and hub) loaded on the chosen account's own page, never the account the tab was on before.
  const signInLoads = await page.evaluate(() => [...window.__fakeBrowserOpens, ...(window.__fakeNavs ?? [])].filter(a => a.rawUrl.includes('AccountChooser')).map(a => ({ tab: a.tab, email: new URL(a.rawUrl).searchParams.get('Email') })));
  assert.ok(signInLoads.length >= 2 && signInLoads.every(l => l.tab.endsWith('#' + nodeState.accounts.find(a => a.email === l.email)?.id)), JSON.stringify(signInLoads));
  // Landing in Gmail after signing in re-checks that account at once (not only when Accounts reopens).
  await page.route('https://mail.google.com/**', route => route.fulfill({ contentType: 'text/html', body: '<h1>Fake Gmail</h1>' }));
  await sidebar.getByRole('button', { name: 'Browser options', exact: true }).click();
  await sidebar.getByRole('menuitem', { name: 'Accounts', exact: true }).click();
  await openAdd();
  await chromeRow.getByRole('button', { name: 'Gmail', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.siso-page__address')?.dataset.url === 'https://mail.google.com/mail/');
  // Signed in from here on; opening Accounts already asked about every account, so count only what Gmail triggers.
  await page.evaluate(() => { window.__fakeSessions = { 'chrome:Default': true }; window.__fakeChecks = []; });
  await until(() => nodeState.accounts.find(a => a.id === 'chrome:Default')?.signedIn === true, 'signed in, noticed on landing in Gmail');
  assert.deepEqual(await page.evaluate(() => window.__fakeChecks), ['chrome:Default']);
  assert.deepEqual(nodeState.accounts.find(a => a.id === 'chrome:Default').proof, { names: ['SID', '__Secure-1PSID'], count: 23 }, 'the store read\'s proof is kept: names and a count only');
  await sidebar.getByRole('button', { name: 'Browser options', exact: true }).click();
  await sidebar.getByRole('menuitem', { name: 'Accounts', exact: true }).click();
  await page.locator('.ab-hub__head p').filter({ hasText: /^1 signed in/ }).waitFor();
  assert.equal(await chromeRow.getByRole('button', { name: 'Open Gmail as fake.chrome@example.invalid', exact: true }).count(), 1, 'signed in: out of Add accounts, in its space');
  checks.push('Every sign-in page (first-run sheet tab and hub sheet) loads only on that account\'s own store; landing in Gmail re-checks that account and the hub shows it signed in');
  // The same address: green at once ("Google showed this address"), and the sheet closes by itself.
  await page.route('https://accounts.google.com/AccountChooser**', route => { const email = new URL(route.request().url()).searchParams.get('Email'); return route.fulfill({ contentType: 'text/html', body: `<body style="background:#171715;color:#eee;font:16px system-ui;padding:32px"><button onclick="const a=document.createElement('button');a.setAttribute('aria-label','Google Account: Fake User (${email})');a.textContent='Fake signed-in avatar';document.body.append(a);this.remove()">Sign in with fake account</button></body>` }); });
  await page.evaluate(() => { window.__fakeSessions = { 'chrome:Default': false }; });
  await page.getByRole('button', { name: 'Check now', exact: true }).click();
  await chromeRow.getByRole('button', { name: 'Sign in again as fake.chrome@example.invalid', exact: true }).waitFor();
  await page.evaluate(() => { window.__fakeSessions = { 'chrome:Default': true }; });
  await chromeRow.getByRole('button', { name: 'Sign in again as fake.chrome@example.invalid', exact: true }).click();
  await signSheet.waitFor();
  await page.frameLocator('iframe[data-tab="signin:chrome:Default#chrome:Default"]').getByRole('button', { name: 'Sign in with fake account' }).click();
  await signSheet.getByRole('status').filter({ hasText: 'Signed in · Google showed fake.chrome@example.invalid' }).waitFor();
  await page.screenshot({ path: path.join(preview, 'browser-signin-webkit.png') });
  await signSheet.waitFor({ state: 'detached' });
  const shownRow = nodeState.accounts.find(a => a.id === 'chrome:Default');
  assert.ok(shownRow.signedIn === true && shownRow.shownAt > 0 && !shownRow.signInStop && !shownRow.lostAt, JSON.stringify(shownRow));
  await until(() => nodeState.accounts.find(a => a.id === 'chrome:Default').proof?.names?.length === 2, 'the store read after the sheet adds the cookie names');
  checks.push('Sign-in sheet (arc-edges §2.1): the hub\'s Sign in opens Google inset in the hub (520 px page under a 40 px bar) on that account\'s own store, steps from the address; another address offers "Keep it as" or "Try again"; closing early shows "Didn\'t finish · stopped at address"; the same address turns it green and the sheet closes by itself');
  await page.route('**/api/browser/suggest**', route => route.fulfill({ json: { pages: [{ url: 'https://fake-history.invalid/inbox', title: 'Fake history page' }] } }));
  await page.getByRole('button', { name: 'Back to browser', exact: true }).click().catch(() => undefined);
  await page.getByRole('combobox', { name: 'Search or enter a URL' }).fill('fake hist');
  await page.waitForFunction(() => document.querySelector('#ab-browser-suggest option')?.getAttribute('value') === 'https://fake-history.invalid/inbox');
  checks.push('Import from Arc and Chrome (fake payload): Arc space with its pin (Arc open tabs not put in Today), each Chrome Google profile an account (not a space), idempotent re-run; Accounts hub: N signed in · N to add, the rest folded under Add accounts (no Sign in next queue), quick open in an account, Sign in opens the account chooser in that account; typing in the address offers history suggestions');
  // A space on the no-account store asks which Google account it uses; a Google sign-in found in that store (its avatar
  // names fake2@, not signed in on its own store) moves to fake2@ in one click by repointing fake2@'s store (A0 arc-edges §2.2).
  await page.route('https://myaccount.google.com/**', route => route.fulfill({ contentType: 'text/html', body: '<h1>Fake Google Account page</h1><a aria-label="Google Account: Fake Two (fake2@example.invalid)" href="#">FT</a>' }));
  await spaces.getByRole('button', { name: 'Fake second account', exact: true }).click();
  const ask = sidebar.getByRole('group', { name: 'Which Google account does Fake second account use?' });
  await ask.waitFor();
  const address = page.getByRole('combobox', { name: 'Search or enter a URL' });
  await address.fill('https://myaccount.google.com/');
  await address.press('Enter');
  await page.waitForFunction(() => document.querySelector('.siso-page__address')?.dataset.url === 'https://myaccount.google.com/');
  const wrong = sidebar.getByRole('status', { name: 'Sign-in in the wrong place' });
  await wrong.waitFor();
  // Status lines (arc-edges §1 #6): worst first, one 30 px row each (a notice wraps), two then "+1 more".
  const lineIds = () => sidebar.locator('.ab-browser__line').evaluateAll(ls => ls.map(l => [l.dataset.line, Math.round(l.getBoundingClientRect().height)]));
  const before2 = await lineIds();
  assert.equal(before2[0][0], 'stray', JSON.stringify(before2));
  assert.equal(before2[0][1], 30, 'a status line is one 30 px row');
  const fits = await sidebar.evaluate(el => { const r = el.getBoundingClientRect(); return [...el.querySelectorAll('.ab-browser__line, .ab-browser__line button')].every(b => { const x = b.getBoundingClientRect(); return x.left >= r.left - 1 && x.right <= r.right + 1; }); });
  assert.ok(fits, 'every status line and its buttons fit inside the sidebar');
  await wrong.getByRole('button', { name: 'Move it to fake2@example.invalid', exact: true }).waitFor();
  await sidebar.locator('input[type="file"]').setInputFiles({ name: 'fake-not-arc.json', mimeType: 'application/json', buffer: Buffer.from('not json') });
  const more = sidebar.getByRole('button', { name: '+1 more', exact: true });
  await more.waitFor();
  assert.deepEqual((await lineIds()).map(([id]) => id), ['stray', 'error'], 'worst first, two shown');
  await page.screenshot({ path: path.join(preview, 'browser-lines-webkit.png') });
  await more.click();
  await page.waitForFunction(() => document.querySelectorAll('.ab-browser__line').length === 3);
  await sidebar.locator('.ab-browser__line[data-line="error"]').getByRole('button', { name: 'Dismiss', exact: true }).click();
  assert.deepEqual((await lineIds()).map(([id]) => id), ['stray', 'notice']);
  checks.push('Status lines: worst first (wrong place before an error before a notice), one 30 px row each, two then "+1 more" that opens the rest; an error dismisses');
  await wrong.getByText('fake2@example.invalid', { exact: true }).waitFor({ timeout: 8000 });
  const defaultStore = nodeState.accounts.find(a => a.id === 'personal')?.store ?? 'personal';
  await page.evaluate(() => { window.__fakeChecks = []; });
  await wrong.getByRole('button', { name: 'Move it to fake2@example.invalid', exact: true }).click();
  const fake2Id = nodeState.accounts.find(a => a.email === 'fake2@example.invalid').id;
  await until(() => nodeState.accounts.find(a => a.id === fake2Id)?.store === defaultStore && /^store:/.test(nodeState.accounts.find(a => a.id === 'personal')?.store ?? ''), 'fake2@ now owns the store the sign-in is in; No account has a fresh one');
  await page.waitForFunction(id => document.querySelector('[data-native-browser]')?.dataset.nativeBrowser === id, fake2Id);
  await page.waitForFunction(store => (window.__fakeChecks ?? []).includes(store), defaultStore);
  assert.deepEqual(await page.evaluate(() => window.__fakeChecks), [defaultStore], 'fake2@ is re-checked on the store it now owns');
  assert.equal(await wrong.count(), 0);
  await ask.getByRole('button', { name: 'No account', exact: true }).click();
  await ask.waitFor({ state: 'detached' });
  await until(() => nodeState.spaces.find(x => x.name === 'Fake second account')?.noAccount === true, 'No account is his choice, kept');
  checks.push('Account stores: a space on No account asks which Google account it uses ("No account" stops it asking); a sign-in found in the No-account store is moved to its account in one click (store repointed, nothing copied, re-checked there)');
  // Sidebar polish (spec §1, §6), all on fake pages and a fake bridge.
  await sidebar.locator('.ab-browser__address input').blur();
  await spaces.getByRole('button', { name: 'Personal', exact: true }).click();
  await page.waitForFunction(() => /\/fixture\/personal-today\/\d$/.test(document.querySelector('.siso-page__address')?.dataset.url ?? ''));
  const footer = sidebar.getByLabel('Today tabs', { exact: true });
  await footer.waitFor();
  const { states, footerText } = await sidebar.evaluate(el => ({ footerText: el.querySelector('.ab-browser__footer').textContent, states: [...el.querySelectorAll('.ab-browser__tabs .ab-browser__tab')].map(t => [t.dataset.state, t.querySelector('[aria-current="page"]') !== null]) }));
  assert.ok(states.some(([st, current]) => current && st === 'awake'), JSON.stringify(states));
  assert.ok(states.some(([st]) => st === 'asleep'), JSON.stringify(states));
  assert.equal(footerText, `${states.length} · ${states.filter(([st]) => st !== 'asleep').length} awake`, 'Today header: count · awake');
  // The page on screen starts playing: its row shows a speaker in place of the mark; the speaker mutes that page.
  const shownKey = await page.evaluate(() => [...window.__fakeFrames].find(([, f]) => f.isConnected && f.style.display !== 'none')?.[0]);
  await page.evaluate(key => { window.__fakeAudio = [key]; }, shownKey);
  const currentTitle = await sidebar.locator('.ab-browser__tabs [aria-current="page"] span').last().innerText();
  const speaker = sidebar.getByRole('button', { name: `Mute ${currentTitle}`, exact: true });
  await speaker.waitFor({ timeout: 5000 });
  assert.equal(await sidebar.locator('.ab-browser__tab[data-state="playing"] .ab-browser__site').count(), 0);
  await speaker.click();
  await speaker.waitFor({ state: 'detached' });
  assert.deepEqual(await page.evaluate(() => window.__fakeActions.filter(a => a.action === 'mute')), [{ tab: shownKey, action: 'mute' }]);
  checks.push('Today rows: the page on screen is awake, rows with no live page are asleep (dimmed), footer "N awake · M asleep"; a playing page shows a speaker that mutes exactly that page');
  // The mini player (arc-edges §5.6): the Personal page keeps playing after switching to HALO; ⏯ pauses and resumes exactly
  // that page; ↩ brings it back in its space; on screen again, the player goes.
  await page.evaluate(key => { window.__fakeAudio = [key]; }, shownKey);
  await sidebar.getByRole('button', { name: `Mute ${currentTitle}`, exact: true }).waitFor({ timeout: 5000 });
  assert.equal(await sidebar.getByRole('region', { name: /^Playing: / }).count(), 0, 'no mini player for the page on screen');
  await spaces.getByRole('button', { name: 'HALO', exact: true }).click();
  const player = sidebar.getByRole('region', { name: `Playing: ${currentTitle}`, exact: true });
  await player.waitFor({ timeout: 5000 });
  assert.match(await player.locator('small').innerText(), /^Personal · /);
  const playerBox = await player.boundingBox(), spaceBarBox = await sidebar.getByRole('navigation', { name: 'Browser spaces' }).boundingBox();
  assert.ok(playerBox.y + playerBox.height <= spaceBarBox.y + 1, 'the mini player sits above the space bar');
  await page.screenshot({ path: path.join(preview, 'browser-miniplayer-webkit.png') });
  await player.getByRole('button', { name: `Pause ${currentTitle}`, exact: true }).click();
  await player.getByRole('button', { name: `Play ${currentTitle}`, exact: true }).click();
  await player.getByRole('button', { name: `Pause ${currentTitle}`, exact: true }).waitFor();
  assert.deepEqual(await page.evaluate(() => window.__fakeActions.filter(a => a.action === 'pause' || a.action === 'play')), [{ tab: shownKey, action: 'pause' }, { tab: shownKey, action: 'play' }]);
  await player.getByRole('button', { name: `Go to ${currentTitle}`, exact: true }).click();
  await spaces.getByRole('button', { name: 'Personal', exact: true, pressed: true }).waitFor();
  await player.waitFor({ state: 'detached', timeout: 5000 });
  assert.equal(await page.evaluate(() => [...window.__fakeFrames].find(([, f]) => f.isConnected && f.style.display !== 'none')?.[0]), shownKey, 'the same page is back on screen, not a new one');
  await page.evaluate(() => { window.__fakeAudio = []; });
  checks.push('Mini player: a page still playing after a space switch shows above the space bar (title · host · space); ⏯ pauses and resumes that page only; ↩ returns to its space with the same page; none for the page on screen');
  // The account dot: "Open as" lists accounts by space; picking one moves this tab only (the space default stays).
  const dot = sidebar.getByRole('button', { name: /^Open as… \(now / });
  const before = await dot.getAttribute('aria-label');
  await dot.click();
  const openAs = sidebar.getByRole('menu', { name: 'Open as' });
  await openAs.getByRole('group', { name: 'HALO', exact: true }).getByRole('menuitemradio', { name: 'fake.chrome@example.invalid', exact: true }).waitFor();
  assert.equal(await openAs.getByRole('menuitemradio', { checked: true }).count(), 1);
  await page.screenshot({ path: path.join(preview, 'browser-openas-webkit.png') });
  const fake2 = nodeState.accounts.find(a => a.email === 'fake2@example.invalid').id;
  await openAs.getByRole('menuitemradio', { name: 'fake2@example.invalid', exact: true }).click();
  await openAs.waitFor({ state: 'detached' });
  await page.waitForFunction(id => document.querySelector('[data-native-browser]')?.dataset.nativeBrowser === id, fake2);
  assert.equal(await dot.getAttribute('aria-label'), 'Open as… (now fake2@example.invalid)');
  await until(() => Object.entries(nodeState.choice ?? {}).some(([k, v]) => k.startsWith('account:') && v === fake2), 'the tab\'s account kept in the node');
  assert.notEqual(nodeState.spaces.find(x => x.id === 'personal')?.account, fake2, "Personal's default is unchanged");
  await dot.click();
  await openAs.getByRole('menuitemradio', { name: before.slice('Open as… (now '.length, -1), exact: true }).click();
  await page.waitForFunction(label => document.querySelector('.ab-browser__dot')?.getAttribute('aria-label') === label, before);
  checks.push('Account dot: "Open as" lists accounts grouped by space with status; choosing one reopens this tab in that account (kept in the node) without changing the space default');
  // No nudge for accounts not signed in yet (they wait under "Add accounts"); only one Google signed out would show one.
  assert.equal(await sidebar.getByRole('button', { name: /need sign-in/ }).count(), 0);
  assert.equal(await sidebar.getByRole('button', { name: /^Google signed out/ }).count(), 0);
  checks.push('No sidebar nudge for accounts not signed in yet; only an account Google signed out gets one');
  // Downloads: the icon spins while one runs; the popover lists them; Show in Finder asks the node by file name only.
  const revealed = [];
  await page.route('**/api/browser/reveal', route => { revealed.push(JSON.parse(route.request().postData() || '{}')); return route.fulfill({ json: { ok: true } }); });
  await sidebar.getByRole('button', { name: 'Downloads', exact: true }).click();
  const downloadsList = sidebar.getByRole('dialog', { name: 'Downloads' });
  await downloadsList.getByText('Nothing downloaded yet.', { exact: true }).waitFor();
  await page.evaluate(() => window.__fakeEmit('browser-download', ['started', 'fake-report.pdf', true, null]));
  await downloadsList.getByRole('progressbar', { name: 'Downloading fake-report.pdf' }).waitFor();
  await sidebar.getByRole('button', { name: 'Downloads (one is running)', exact: true }).waitFor();
  await page.evaluate(() => { window.__fakeEmit('browser-download', ['finished', 'fake-report.pdf', true, null]); window.__fakeEmit('browser-download', ['started', 'fake.csv', true, 'WIDGET']); window.__fakeEmit('browser-download', ['finished', 'fake.csv', false, 'WIDGET']); });
  await downloadsList.getByRole('button', { name: 'Show fake-report.pdf in Finder', exact: true }).click();
  await until(() => revealed.length === 1, 'Show in Finder asked the node');
  assert.deepEqual(revealed, [{ name: 'fake-report.pdf', agent: null }]);
  await downloadsList.getByText('Downloads/Agents/WIDGET · failed', { exact: true }).waitFor();
  assert.equal(await downloadsList.getByRole('button', { name: 'Show fake.csv in Finder' }).count(), 0, 'a failed download has nothing to show');
  await sidebar.getByRole('button', { name: 'Downloads', exact: true }).waitFor();
  await page.screenshot({ path: path.join(preview, 'browser-downloads-webkit.png') });
  await sidebar.getByRole('button', { name: 'Downloads', exact: true }).click();
  await downloadsList.waitFor({ state: 'detached' });
  checks.push('Downloads: icon shows a running download, popover lists the last ones (running bar, agent folder, failed), Show in Finder sends only the file name and agent');
  // The download toast (arc-edges §5.5): 6 s above the space bar, size from the node, Show, and Open only for a document.
  const opened = [];
  await page.route('**/api/browser/download-info', route => { const b = JSON.parse(route.request().postData() || '{}'); return route.fulfill({ json: { size: 3_400_000, canOpen: !b.name.endsWith('.command') } }); });
  await page.route('**/api/browser/open-download', route => { opened.push(JSON.parse(route.request().postData() || '{}')); return route.fulfill({ json: { ok: true } }); });
  await page.evaluate(() => window.__fakeEmit('browser-download', ['finished', 'fake-broken.zip', false, null]));
  const failedToast = sidebar.getByRole('status', { name: 'Download of fake-broken.zip failed', exact: true });
  await failedToast.getByText('Download failed', { exact: true }).waitFor();
  assert.equal(await failedToast.getByRole('button', { name: /^(Show|Open)$/ }).count(), 0, 'a failed download offers nothing to open');
  await page.evaluate(() => window.__fakeEmit('browser-download', ['finished', 'fake-report.pdf', true, null]));
  const toast = sidebar.getByRole('status', { name: 'Downloaded fake-report.pdf', exact: true });
  await toast.getByText('3.4 MB · Downloads', { exact: true }).waitFor();
  assert.equal(await sidebar.locator('.ab-browser__toast').count(), 1, 'one toast at a time');
  const toastBox = await toast.boundingBox(), barBox = await sidebar.getByRole('navigation', { name: 'Browser spaces' }).boundingBox();
  assert.ok(toastBox.y + toastBox.height <= barBox.y + 1, `toast sits above the space bar: ${JSON.stringify({ toastBox, barBox })}`);
  await page.screenshot({ path: path.join(preview, 'browser-download-toast-webkit.png') });
  await toast.getByRole('button', { name: 'Open', exact: true }).click();
  await until(() => opened.length === 1, 'Open asked the node');
  assert.deepEqual(opened, [{ name: 'fake-report.pdf', agent: null }]);
  await toast.waitFor({ state: 'detached' });
  await page.evaluate(() => window.__fakeEmit('browser-download', ['finished', 'fake-tool.command', true, 'WIDGET']));
  const tool = sidebar.getByRole('status', { name: 'Downloaded fake-tool.command', exact: true });
  await tool.getByText('3.4 MB · Downloads/Agents/WIDGET', { exact: true }).waitFor();
  assert.equal(await tool.getByRole('button', { name: 'Open', exact: true }).count(), 0, 'nothing that could run gets Open');
  await tool.getByRole('button', { name: 'Show', exact: true }).waitFor();
  const shownAt = Date.now();
  await tool.waitFor({ state: 'detached', timeout: 9000 });
  assert.ok(Date.now() - shownAt > 4000, 'the toast stays about 6 s');
  checks.push('Download toast: a finished download shows 6 s above the space bar with its size and folder; Open only for a document (asks the node by name), Show for anything; a failed one says so');
  // Shaan 3 Oct 14:1x, item 2: a link in one of his pages that wants a new window (target=_blank) arrives as a Web tab.
  // The app listens from boot (the desktop bridge is there from the start); this fake bridge came after the first render,
  // so one render (⌘T, Esc) lets the app pick it up.
  await page.keyboard.press('Meta+KeyT');
  await page.keyboard.press('Escape');
  await until(() => true, 'render');
  await page.evaluate(url => window.__fakeEmit('browser-new-tab', url), origin + '/fixture/from-a-page');
  await page.waitForFunction(() => document.querySelector('input.siso-page__address')?.dataset.url?.endsWith('/fixture/from-a-page'), null, { timeout: 5000 });
  assert.equal(await page.getByRole('button', { name: /^Browser:/ }).getAttribute('aria-current'), 'page', 'the page\'s new tab is in the Web space');
  checks.push('A page\'s link that asks for a new window (target=_blank) opens as a Web tab, shown in the Web space; no window on his screen');
  // ⌘S: the page goes full width; the left edge peeks the sidebar; ⌘S again keeps it.
  const aside = page.locator('aside.ab-browser__sidebar');
  const pageWidth = () => page.locator('[data-native-browser]').evaluate(el => el.getBoundingClientRect().width);
  const narrow = await pageWidth();
  await page.keyboard.press('Meta+s');
  await aside.waitFor({ state: 'hidden' });
  assert.ok(await pageWidth() > narrow + 200, 'the page takes the sidebar\'s width');
  await page.screenshot({ path: path.join(preview, 'browser-fullwidth-webkit.png') });
  await page.locator('.ab-browser__edge').hover();
  await aside.waitFor({ state: 'visible' });
  await page.mouse.move(1100, 450);
  await aside.waitFor({ state: 'hidden' });
  await page.keyboard.press('Meta+s');
  await aside.waitFor({ state: 'visible' });
  assert.equal(await page.evaluate(() => localStorage.getItem('agent-base:browser-sidebar-hidden')), '0');
  checks.push('⌘S hides the sidebar (page grows by its width), hovering the left edge peeks it and leaving hides it, ⌘S brings it back');
  // Arc-edges §3.2: the space name opens the space menu inside the sidebar (each space, its default account, ⌃N; then
  // Accounts with a count, import, new space); ⌃2 switches to the second space without it.
  await sidebar.getByRole('button', { name: /^Personal/ }).first().click();
  const spaceMenu = sidebar.getByRole('menu', { name: 'Spaces' });
  await spaceMenu.waitFor();
  const radios = spaceMenu.getByRole('menuitemradio');
  assert.equal(await radios.count(), await spaces.locator('button[aria-pressed]').count(), 'one row per space chip');
  assert.equal(await spaceMenu.getByRole('menuitemradio', { checked: true }).textContent().then(t => t.startsWith('PEPersonal')), true);
  assert.match(await spaceMenu.getByRole('menuitem', { name: /^Accounts/ }).textContent(), /^Accounts \d+ of \d+ signed in$/);
  const menuBox = await spaceMenu.boundingBox(), sideBox = await page.locator('.ab-browser__sidebar').boundingBox();
  assert.ok(menuBox.x >= sideBox.x && menuBox.x + menuBox.width <= sideBox.x + sideBox.width, 'inside the sidebar column (R1)');
  await page.screenshot({ path: path.join(preview, 'browser-spacemenu-webkit.png') });
  await spaceMenu.getByRole('menuitemradio', { name: /HALO/ }).click();
  await spaceMenu.waitFor({ state: 'detached' });
  assert.equal(await spaces.getByRole('button', { name: 'HALO', exact: true }).getAttribute('aria-pressed'), 'true');
  await page.keyboard.press('Control+1');
  await page.waitForFunction(() => document.querySelector('.ab-browser__spaces button[aria-label="Personal"]')?.getAttribute('aria-pressed') === 'true');
  checks.push('Space menu (arc-edges §3.2): the space name opens it inside the sidebar column with every space, its account and ⌃N, then Accounts N of M signed in; picking a space switches; ⌃1 switches back');
  // Arc-edges §5.1-5.2: a page that never finishes shows a hairline, then at 8 s "Still loading" while the node says the
  // site answered; once the node says it didn't, the native page is hidden and our error page shows (R1). FAKE site.
  await page.route('https://stuck.invalid/**', route => route.abort());
  let reachAnswer = { ok: true, status: 200 };
  const chromeOpens = [];
  await page.route('**/api/browser/reach', route => route.fulfill({ json: reachAnswer }));
  await page.route('**/api/browser/open-in-chrome', route => { chromeOpens.push(route.request().postDataJSON().url); return route.fulfill({ json: { ok: true } }); });
  const urlBar = page.getByRole('combobox', { name: 'Search or enter a URL' });
  await urlBar.fill(''); await urlBar.fill('https://stuck.invalid/page'); await urlBar.press('Enter');
  await page.getByRole('progressbar', { name: 'Loading stuck.invalid' }).waitFor();
  const strip = page.getByRole('status').filter({ hasText: /^Still loading stuck\.invalid · \d+ s/ });
  await strip.waitFor({ timeout: 12000 });
  const slotTop = await page.locator('[data-native-browser]').boundingBox(), stripBox = await strip.boundingBox();
  assert.ok(stripBox.y + stripBox.height <= slotTop.y + 0.5, 'the strip sits above the page, not over it');
  await page.screenshot({ path: path.join(preview, 'browser-slow-webkit.png') });
  reachAnswer = { ok: false, kind: 'refused', detail: 'could not connect' };
  await strip.getByRole('button', { name: 'Reload' }).click();
  const errorPage = page.getByRole('alert', { name: "stuck.invalid didn't answer" });
  await errorPage.waitFor({ timeout: 14000 });
  assert.match(await errorPage.locator('code').textContent(), /^could not connect · \d\d:\d\d · tried 2 times$/);
  assert.equal(await page.locator('[data-native-browser]').count(), 0, 'the native page is hidden behind our error page');
  await page.screenshot({ path: path.join(preview, 'browser-error-webkit.png') });
  await errorPage.getByRole('button', { name: 'Open in Chrome' }).click();
  await until(() => chromeOpens.includes('https://stuck.invalid/page'), 'Open in Chrome sends the address to the node');
  await page.evaluate(() => { window.__fakeActions = []; });
  await errorPage.getByRole('button', { name: 'Try again' }).click();
  await page.locator('[data-native-browser]').waitFor();
  await page.waitForFunction(() => (window.__fakeActions ?? []).some(a => a.action === 'reload'));
  await urlBar.fill(''); await urlBar.fill('https://fake-after.invalid/'); await urlBar.press('Enter');
  await page.getByRole('progressbar', { name: /^Loading/ }).waitFor({ state: 'detached' });
  checks.push('Page states (arc-edges §5.1-5.2): loading hairline; at 8 s "Still loading <host> · N s · Reload · Open in Chrome" above the page while the site answers; when it does not, our error page replaces the hidden native page ("didn\'t answer", mono detail with tries) with Open in Chrome and Try again (reloads)');
  // Arc-edges §8: 21 accounts as 52 px tiles in groups flowing down three columns fit a 1512 x 945 window with no scroll;
  // a tile opens its details drawer. FAKE accounts only.
  const ids = nodeState.spaces.filter(x => x.id !== 'arc-favorites').map(x => x.id);
  nodeState = { ...nodeState, accounts: [...nodeState.accounts.filter(a => !a.email), ...Array.from({ length: 21 }, (_, i) => ({ id: `chrome:Fake${i}`, name: `Fake ${i}`, email: `fake.tile${i}@example.invalid`, proof: { names: ['SID', '__Secure-1PSID'], count: 23 }, source: 'chrome', chromeDir: `Profile ${i}`, chromeName: `FAKE${i}`, space: ids[i % ids.length], signedIn: true, checkedAt: Date.now() }))] };
  await page.addInitScript((n) => { window.__fakeSessions = Object.fromEntries(Array.from({ length: n }, (_, i) => [`chrome:Fake${i}`, true])); }, 21);
  await page.setViewportSize({ width: 1512, height: 945 });
  await page.reload();
  await page.getByRole('button', { name: /^Browser: / }).click();
  await sidebar.getByRole('button', { name: 'Browser options', exact: true }).click();
  await sidebar.getByRole('menuitem', { name: 'Accounts', exact: true }).click();
  await page.locator('.ab-hub__head p').filter({ hasText: /^21 signed in$/ }).waitFor();
  const fit = await page.evaluate(() => { const m = document.querySelector('.ab-hub__main'); const xs = new Set([...document.querySelectorAll('.ab-hub__group')].map(g => Math.round(g.getBoundingClientRect().left))); return { over: m.scrollHeight - m.clientHeight, tiles: [...document.querySelectorAll('.ab-hub__tile')].filter(t => t.textContent.includes('@example.invalid')).length, cols: xs.size, h: Math.round(document.querySelector('.ab-hub__tile').getBoundingClientRect().height) }; });
  assert.ok(fit.tiles === 21 && fit.over <= 0 && fit.cols === 3 && fit.h === 52, JSON.stringify(fit));
  await page.screenshot({ path: path.join(preview, 'browser-hub-tiles-webkit.png') });
  await page.getByRole('button', { name: 'Details for fake.tile4@example.invalid', exact: true }).click({ position: { x: 20, y: 26 } });
  const drawer = page.getByRole('complementary', { name: 'Account fake.tile4@example.invalid' });
  await drawer.getByText('FAKE4', { exact: false }).waitFor();
  assert.equal(await drawer.getByRole('button', { name: 'Open Gmail as fake.tile4@example.invalid' }).count(), 1);
  // Signed-in proof (t-0242): the tile says when it was checked; the drawer names the session cookies found and counts Google's.
  const tileLine = await page.locator('.ab-hub__tile', { hasText: 'fake.tile4@example.invalid' }).locator('.ab-hub__line').innerText();
  assert.match(tileLine, /^Signed in · checked \d{1,2}:\d{2}/, tileLine);
  await drawer.getByText('SID, __Secure-1PSID · 23 Google cookies', { exact: true }).waitFor();
  checks.push('Signed-in proof: every tile reads "Signed in · checked HH:MM" from its store read; the drawer shows the session cookie names found and how many Google cookies (never a value)');
  await page.screenshot({ path: path.join(preview, 'browser-hub-drawer-webkit.png') });
  // Boundary: a 1100 px window with the drawer open drops columns (tiles stay 220 px or wider), nothing runs off sideways, and a long address
  // keeps its domain (cut in the middle).
  await page.setViewportSize({ width: 1100, height: 800 });
  const narrowHub = await page.evaluate(() => { const m = document.querySelector('.ab-hub__main'); const g = document.querySelector('.ab-hub__groups'); const dom = document.querySelector('.ab-hub__addr span:nth-child(2)'); return { side: m.scrollWidth - m.clientWidth, tile: Math.round(document.querySelector('.ab-hub__tile').getBoundingClientRect().width), domain: dom.scrollWidth - dom.clientWidth }; });
  assert.ok(narrowHub.side <= 0 && narrowHub.tile >= 220 && narrowHub.domain <= 0, JSON.stringify(narrowHub));
  await page.screenshot({ path: path.join(preview, 'browser-hub-narrow-webkit.png') });
  await drawer.getByRole('button', { name: 'Close details' }).click();
  await drawer.waitFor({ state: 'detached' });
  checks.push('Accounts hub (arc-edges §8): 21 accounts as 52 px tiles in three columns of space groups fit 1512 x 945 with no scroll; a tile opens its details drawer (space, Chrome profile, one action) and × closes it; at 1100 px with the drawer open it drops columns (tiles stay 220 px+) with nothing off-screen and addresses keep their domain');
  await page.setViewportSize({ width: 1440, height: 900 });
  // Item 3: 12 imported pins (none he pinned here) in Personal, from the node's copy after a reload.
  nodeState = { ...nodeState, spaces: nodeState.spaces.map(sp => sp.id === 'personal' ? { ...sp, pins: Array.from({ length: 12 }, (_, i) => ({ url: `${origin}/fixture/imported/${i + 1}`, title: `Imported ${i + 1}`, pinned: true })) } : sp) };
  await page.reload();
  await page.getByRole('button', { name: /^Browser:/ }).click();
  const side3 = page.getByRole('complementary', { name: 'Browser sidebar' });
  await side3.waitFor();
  await page.keyboard.press('Control+Digit1');
  const pins = side3.locator('section[aria-label="Pinned"] .ab-browser__tab');
  const nodePins = () => nodeState.spaces.find(sp => sp.id === 'personal')?.pins ?? [];
  await pins.first().waitFor();
  assert.equal(await pins.count(), 12);
  await side3.getByText('12 pinned from your import').waitFor();
  await side3.getByRole('button', { name: 'Unpin them', exact: true }).click();
  await until(() => nodePins().length === 0, 'the imported pins unpinned in the node');
  assert.equal(await pins.count(), 0);
  await side3.getByRole('button', { name: 'Undo', exact: true }).click();
  await until(() => nodePins().length === 12, 'Undo puts them back');
  checks.push('Pinned: past 8 imported pins the sidebar offers "N pinned from your import · Unpin them"; one click unpins them all (in the node) and Undo puts them back');
  const x1 = side3.getByRole('button', { name: 'Unpin Imported 1', exact: true });
  assert.equal(await x1.evaluate(b => getComputedStyle(b).opacity), '0', 'the × waits for hover');
  await pins.first().hover();
  await page.waitForTimeout(150);
  assert.equal(await x1.evaluate(b => getComputedStyle(b).opacity), '1', 'hovering the row shows its ×');
  await x1.click();
  await until(() => nodePins().length === 11 && !nodePins().some(p => p.title === 'Imported 1'), 'the × unpins that one');
  // Drag: a pin onto Today unpins it into Today; a Today row onto Pinned pins it (as his own).
  const dragTo = (from, to) => page.evaluate(([from, to]) => { const a = document.querySelector(from), b = document.querySelector(to); const dt = new DataTransfer(); a.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt })); b.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt })); b.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt })); a.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer: dt })); }, [from, to]);
  await dragTo('section[aria-label="Pinned"] .ab-browser__tab:first-child', '.ab-browser__tabs[aria-label="Today"]');
  await until(() => nodePins().length === 10, 'a pin dragged to Today is unpinned');
  const todayRow = side3.locator('.ab-browser__tabs .ab-browser__tab', { hasText: 'Imported 2' });
  await todayRow.waitFor();
  await dragTo('.ab-browser__tabs .ab-browser__tab:has(.ab-browser__row) ', 'section[aria-label="Pinned"] .ab-browser__list');
  await until(() => nodePins().length === 11 && nodePins().some(p => p.mine), 'a Today row dragged to Pinned is pinned, as his own');
  checks.push('Pinned rows: × on hover unpins one; dragging a pin onto Today unpins it into Today; dragging a Today row onto Pinned pins it');
  await page.screenshot({ path: path.join(preview, 'browser-pins-webkit.png') });
  // Item 4: ⌘T, the top bar's + and the sidebar's + New tab open Arc's command bar; Esc closes it.
  const bar = page.getByRole('dialog', { name: 'New tab' });
  await page.keyboard.press('Meta+KeyT');
  await bar.waitFor();
  await page.keyboard.press('Escape');
  await bar.waitFor({ state: 'detached' });
  await page.getByRole('button', { name: 'New tab · ⌘T', exact: true }).click();
  await bar.waitFor();
  await page.keyboard.press('Escape');
  await side3.getByRole('button', { name: 'New tab', exact: true }).click();
  await bar.waitFor();
  const tabsBefore = await page.locator('.siso-toptabs [role=tab]').count();
  await bar.getByRole('textbox', { name: 'Search or enter a URL' }).fill(origin + '/fixture/from-the-bar');
  assert.equal(await bar.getByRole('option').first().getAttribute('aria-selected'), 'true');
  await page.screenshot({ path: path.join(preview, 'browser-commandbar-webkit.png') });
  await page.keyboard.press('Enter');
  await bar.waitFor({ state: 'detached' });
  await page.waitForFunction(() => document.querySelector('input.siso-page__address')?.dataset.url?.endsWith('/fixture/from-the-bar'), null, { timeout: 5000 });
  assert.ok((await page.locator('.siso-toptabs [role=tab]').count()) > tabsBefore || (await page.locator('.siso-toptabs').innerText()).includes('from-the-bar'), 'a new Web tab');
  // Its open tabs are in the bar: typing one's name offers "Switch to tab", and picking it goes there.
  await page.keyboard.press('Meta+KeyT');
  await bar.waitFor();
  const sw = bar.getByRole('option').filter({ hasText: 'Switch to tab' }).filter({ hasNotText: 'from-the-bar' }).first();
  await sw.waitFor();
  const swUrl = await sw.getAttribute('title');
  await bar.getByRole('textbox').fill(await sw.locator('span').innerText());
  assert.equal(await bar.getByRole('option').filter({ hasText: 'Switch to tab' }).count(), 1, 'typing narrows to that tab');
  await bar.getByRole('option').filter({ hasText: 'Switch to tab' }).dispatchEvent('mousedown');
  await bar.waitFor({ state: 'detached' });
  await page.waitForFunction(u => document.querySelector('input.siso-page__address')?.dataset.url === u, swUrl, { timeout: 5000 });
  assert.equal(await page.getByRole('button', { name: /^Browser:/ }).getAttribute('aria-current'), 'page');
  checks.push('⌘T, the top bar\'s + and the sidebar\'s + New tab open a centred command bar (Esc closes it); an address + Enter opens a Web tab; an open tab\'s name offers "Switch to tab" and goes there');
  // Today's Close all.
  const todayTabs = side3.locator('.ab-browser__tabs .ab-browser__tab');
  await todayTabs.first().waitFor();
  await side3.getByRole('button', { name: 'Close all Today tabs', exact: true }).click();
  await until(() => (nodeState.today?.personal ?? []).every(t => nodePins().some(p => p.url === t.url)), 'Close all empties Today in the node');
  assert.equal(await todayTabs.count(), 0);
  checks.push('Today: "Close all" closes every Today tab in the space (pinned pages stay)');
  assert.deepEqual(errors, []);
  const reference = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await reference.goto(origin + '/preview/browser-wireframe.html');
  await reference.locator('.frame').first().screenshot({ path: path.join(preview, 'browser-wireframe-webkit.png') });
  await reference.setViewportSize({ width: 2880, height: 1050 });
  await reference.setContent(`<body style="margin:0;background:#171715;color:#eee;font:16px system-ui"><div style="display:flex"><section><h2>Built · actual App · WebKit · fake fixtures</h2><img width="1440" src="${origin}/preview/browser-arc-webkit.png"></section><section><h2>Approved wireframe v0.5 · Web screen</h2><img width="1440" src="${origin}/preview/browser-wireframe-webkit.png"></section></div></body>`);
  await reference.locator('img').evaluateAll(images => Promise.all(images.map(image => image.decode())));
  await reference.screenshot({ path: path.join(preview, 'browser-comparison.png') });
  await writeFile(path.join(preview, 'browser-proof.json'), JSON.stringify({ status: 'PASS', engine: 'WebKit', fixture: 'fake; no live node or accounts', checks }, null, 2) + '\n');
  console.log(JSON.stringify({ status: 'PASS', checks }));
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
