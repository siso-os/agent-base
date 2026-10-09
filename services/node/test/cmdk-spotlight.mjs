import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { webkit, suitePort } from './suite-runtime.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const webRoot = path.join(root, 'apps/web');
const args = process.argv.slice(2);
const before = args.includes('--before');
const outIndex = args.indexOf('--out');
if (outIndex >= 0 && (!args[outIndex + 1] || args[outIndex + 1].startsWith('--'))) {
  throw new Error('--out requires a directory');
}
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--out') { i++; continue; }
  if (args[i] !== '--before') throw new Error(`Unknown argument: ${args[i]}`);
}
const out = outIndex >= 0
  ? path.resolve(root, args[outIndex + 1])
  : before ? path.join(root, 'ui-hub/None') : null;
const { createServer, searchForWorkspaceRoot } = await import(
  path.join(webRoot, 'node_modules/vite/dist/node/index.js')
);
const historical = new Map();
if (before) {
  for (const relative of [
    'apps/web/src/components/WorkspaceCommandPalette.tsx',
    'apps/web/src/components/WorkspaceCommandPalette.css',
  ]) {
    historical.set(path.join(root, relative), execFileSync(
      'git', ['show', `origin/main:${relative}`],
      { cwd: root, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 },
    ));
  }
}

const checks = [];
const errors = [];
const forbidden = [];
let server;
let browser;

try {
  server = await createServer({
    root: webRoot,
    configFile: false,
    cacheDir: path.join(webRoot, 'node_modules/.vite-cmdk-spotlight'),
    plugins: before ? [{
      name: 'cmdk-historical-component',
      enforce: 'pre',
      load(id) {
        return historical.get(id.split('?')[0]) ?? null;
      },
    }] : [],
    resolve: { dedupe: ['react', 'react-dom'] },
    esbuild: { jsx: 'automatic' },
    optimizeDeps: {
      entries: ['preview/cmdk-spotlight.html'],
      include: ['react', 'react-dom/client', 'react/jsx-runtime'],
    },
    server: {
      host: '127.0.0.1',
      port: await suitePort(),
      strictPort: true,
      hmr: false,
      fs: { allow: [searchForWorkspaceRoot(webRoot), root] },
    },
  });
  // No app Vite config, proxy, Node API, or existing server is used.
  await server.listen();
  const address = server.httpServer.address();
  assert(address && typeof address !== 'string');
  const origin = `http://127.0.0.1:${address.port}`;
  browser = await webkit.launch({ headless: true });

  if (out) await mkdir(out, { recursive: true });

  for (const width of [1440, 390]) {
    const context = await browser.newContext({
      viewport: { width, height: 1000 },
      reducedMotion: 'reduce',
      serviceWorkers: 'block',
    });
    const page = await context.newPage();
    page.setDefaultTimeout(12000);
    page.on('pageerror', error => errors.push(`${width}: ${error.message}`));
    await context.route('**/*', route => {
      const url = new URL(route.request().url());
      if (url.origin === origin &&
          !/^\/(?:api|term|chat)(?:\/|$)/.test(url.pathname)) {
        return route.continue();
      }
      forbidden.push(route.request().url());
      return route.abort('blockedbyclient');
    });
    await page.addInitScript(() => {
      window.__cmdkSockets = [];
      const NativeSocket = window.WebSocket;
      window.WebSocket = class extends NativeSocket {
        constructor(url) {
          if (/\/(chat|term)(\/|$)/.test(new URL(url).pathname)) { window.__cmdkSockets.push(String(url)); throw new Error('App sockets prohibited in fixture'); }
          super(url);
        }
      };
    });

    const launch = page.getByTestId('launch');
    const dialog = page.getByRole('dialog');
    const search = page.getByRole('combobox', { name: 'Search or enter a URL', exact: true });
    const row = id => page.locator(`.wp-action[data-action-id="${id}"]`);
    const rows = page.locator('.wp-action');
    const ids = () => rows.evaluateAll(nodes => nodes.map(node => node.dataset.actionId));
    const load = async (state = 'blank') => {
      await page.goto(`${origin}/preview/cmdk-spotlight.html?state=${state}`,
        { waitUntil: 'networkidle' });
      await launch.click();
      await dialog.waitFor();
    };
    const focused = locator => locator.evaluate(node => node === document.activeElement);
    const overflow = async label => {
      const bad = await dialog.evaluate(node => {
        const rect = node.getBoundingClientRect();
        return {
          viewport: document.documentElement.scrollWidth > innerWidth + 1,
          dialog: rect.left < -1 || rect.right > innerWidth + 1 ||
            node.scrollWidth > node.clientWidth + 1,
          parts: [...node.querySelectorAll('.wp-action,.wp-preview')]
            .some(part => part.scrollWidth > part.clientWidth + 1),
        };
      });
      assert.deepEqual(bad, { viewport: false, dialog: false, parts: false },
        `${width}: ${label} horizontal overflow`);
    };
    const selected = async id => {
      await page.waitForFunction(expected =>
        document.querySelector('[data-testid="selection"]')?.textContent === expected, id);
    };

    if (before) {
      await load();
      await page.screenshot({ path: path.join(out, `before-${width}.png`), fullPage: true });
      checks.push(`${width}: historical screenshot captured`);
      assert.deepEqual(await page.evaluate(() => window.__cmdkSockets), []);
      await context.close();
      continue;
    }

    await load();
    assert(await focused(search), `${width}: search gets opening focus`);
    assert.match(await dialog.innerText(), /recent/i);
    await search.press('Meta+Shift+s');
    assert.equal(await page.evaluate(() => document.body.dataset.escapedShortcut), undefined, 'global bubble shortcut cannot navigate behind modal');
    assert.equal((await ids())[0], 'page-library', 'initial recent opens first');
    await overflow('blank recents');
    assert(await dialog.evaluate(node => {
      const rect = node.getBoundingClientRect();
      const strip = document.createElement('div');
      strip.style.cssText = `position:fixed;left:0;top:${rect.top}px;width:100vw;height:100px;z-index:2147483647;background:red`;
      const frame = document.createElement('iframe');
      frame.srcdoc = '<p>Synthetic webview layer</p>';
      frame.style.cssText = `position:fixed;inset:0;width:100vw;height:100vh;z-index:2147483646`;
      document.body.append(frame,strip);
      const above = node.contains(document.elementFromPoint(rect.left+40,rect.top+40));
      strip.remove();frame.remove();return above;
    }), 'modal top layer stays above top strip and synthetic DOM webview');
    if (out) {
      await page.screenshot({ path: path.join(out, `after-${width}.png`), fullPage: true });
    }

    // Tab stays inside the modal, Shift+Tab also stays inside.
    for (const key of ['Tab', 'Shift+Tab']) {
      for (let i = 0; i < 14; i++) {
        await page.keyboard.press(key);
        assert(await dialog.evaluate(node => node.contains(document.activeElement)),
          `${width}: ${key} focus escaped dialog`);
      }
    }
    await page.keyboard.press('Escape');
    await dialog.waitFor({ state: 'hidden' });
    assert(await focused(launch), `${width}: Escape returns launch focus`);

    // Exercise ordinary keyboard activation of the launch button.
    await launch.focus();
    await page.keyboard.press('Enter');
    await dialog.waitFor();
    assert(await focused(search));
    await search.fill('Atlas');
    assert.deepEqual(await ids(), ['atlas-agency', 'atlas-labs']);
    assert.match(await row('atlas-agency').innerText(), /Agency/);
    assert.match(await row('atlas-labs').innerText(), /Labs/);
    await page.keyboard.press('ArrowDown');
    assert(await focused(search), 'ArrowDown retains search focus');
    await page.keyboard.type(' ');
    assert.equal(await search.inputValue(), 'Atlas ');
    assert(await focused(search), 'typing after arrow remains in search');
    await row('atlas-labs').hover();
    await page.waitForFunction(() =>
      document.querySelector('.wp-preview')?.textContent?.includes('Labs Atlas'));
    assert.equal(await row('atlas-labs').getAttribute('data-active'), 'true');
    await overflow('duplicate titles');
    await search.press('Enter');
    await selected('atlas-labs');
    await dialog.waitFor({ state: 'hidden' });
    assert(await focused(launch), 'selection returns launch focus');
    assert.equal(await page.getByTestId('remembered').innerText(), 'atlas-labs');
    assert.equal((await page.getByTestId('recents').innerText()).split(',')[0], 'atlas-labs');
    await launch.click();
    await search.fill('');
    assert.equal((await ids())[0], 'atlas-labs', 'reopening reorders recent action');

    for (const [filter, expected] of [
      ['Chats', ['chat-design', 'chat-offline']],
      ['Projects', ['atlas-agency', 'atlas-labs']],
      ['Pages', ['page-library', 'page-long']],
      ['Commands', ['command-theme', 'command-settings']],
    ]) {
      const button = dialog.getByRole('button', { name: filter, exact: true });
      await button.click();
      assert.equal(await button.getAttribute('aria-pressed'), 'true');
      assert.deepEqual((await ids()).sort(), [...expected].sort(), `${filter} filter`);
    }
    const all = dialog.getByRole('button', { name: 'All', exact: true });
    await all.click();
    assert.equal(await all.getAttribute('aria-pressed'), 'true');
    assert.equal(await rows.count(), 8);

    await search.fill('Unavailable chat');
    assert.equal(await rows.count(), 1);
    assert(await row('chat-offline').isDisabled(), 'unavailable chat is disabled');
    await search.press('Enter');
    assert.equal(await page.getByTestId('selection').innerText(), 'atlas-labs');
    assert(await dialog.isVisible(), 'unavailable Enter keeps dialog open');
    await page.keyboard.press('Escape');

    // Keyboard-only opener preserves both focus and the draft selection range.
    const draft = page.getByRole('textbox', { name: 'Draft', exact: true });
    await draft.focus();
    await draft.evaluate(node => node.setSelectionRange(6, 12));
    await page.keyboard.press('Control+k');
    await dialog.waitFor();
    await page.keyboard.press('Escape');
    await dialog.waitFor({ state: 'hidden' });
    assert(await focused(draft));
    assert.deepEqual(await draft.evaluate(node => [node.selectionStart, node.selectionEnd]), [6, 12]);

    await load('typing');
    assert.equal(await search.inputValue(), 'Atlas');
    assert.deepEqual(await ids(), ['atlas-agency', 'atlas-labs']);
    await search.press('Enter');
    await selected('atlas-agency'); // null active ID falls back to first result

    await load('empty');
    assert.equal(await rows.count(), 0);
    assert.match(await dialog.innerText(), /no .*?(?:results|match|destinations)/i);
    await search.press('Enter');
    assert.equal(await page.getByTestId('selection').innerText(), 'none');
    assert(await dialog.isVisible());
    await overflow('empty');
    await page.keyboard.press('Escape');

    await load('commands');
    assert.deepEqual((await ids()).sort(), ['command-settings', 'command-theme']);
    await search.press('Enter');
    await selected('command-theme');

    await load('unavailable');
    assert.match(await dialog.innerText(), /Fixture projects source unavailable/);
    await overflow('source unavailable');
    await search.fill('A very long research title');
    assert.deepEqual(await ids(), ['page-long']);
    await row('page-long').hover();
    await overflow('long title and preview');
    await search.press('Enter');
    await selected('page-long');

    // Every available fixture action works with search + Enter, including each scope.
    for (const [id, query, arrow] of [
      ['chat-design', 'Design review', false],
      ['atlas-agency', 'Agency project overview', false],
      ['atlas-labs', 'Labs project overview', false],
      ['page-library', 'Great Library', false],
      ['page-long', 'A very long research title', false],
      ['command-theme', 'Toggle theme', false],
      ['command-settings', 'Open settings', false],
    ]) {
      await launch.click();
      await search.fill(query);
      assert.deepEqual(await ids(), [id]);
      if (arrow) await search.press('ArrowDown');
      await search.press('Enter');
      await selected(id);
      await dialog.waitFor({ state: 'hidden' });
    }

    // Exercise the real adapter, keeping every pre-existing callback and source boundary.
    await page.goto(`${origin}/preview/cmdk-spotlight.html?adapter=1`);
    for (const [query, id, receipt] of [
      ['Atlas','workspace:two','workspace:two'],
      ['Fixture chat','agent:fixture-agent','agent:fixture-agent'],
      ...['agents','tasks','library','estate','voice'].map(id=>['>'+id,`page:${id}`,`page:${id}`]),
      ['Existing tab','browser-tab:new','tab:new'],
      ['Saved reference','browser-page:https://example.test/b','go:https://example.test/b'],
      ['>Terminal','command:terminal','terminal'],
      ['https://example.test/next','command:go','go:https://example.test/next'],
      ['unlikely search phrase','command:go','go:https://www.google.com/search?q=unlikely%20search%20phrase'],
    ]) {
      await launch.click(); await search.fill(query);
      await row(id).hover();
      if (id === 'agent:fixture-agent') assert.match(await page.locator('.wp-preview').innerText(), /already-read synthetic reply/);
      await row(id).click(); await selected(receipt);
    }
    await launch.click(); await search.fill('');
    assert.equal(await row('browser-tab:old').count(),0);
    assert.equal(await row('browser-page:https://example.test/a').count(),0);
    await page.keyboard.press('Escape');
    await page.goto(`${origin}/preview/cmdk-spotlight.html?adapter=1&state=offline`);
    await launch.click(); assert.match(await dialog.innerText(), /Chat source unavailable/);
    assert.equal(await row('agent:fixture-agent').count(),0);
    await search.fill('>tasks'); await row('page:tasks').click(); await selected('page:tasks');
    await page.goto(`${origin}/preview/cmdk-spotlight.html?adapter=1&state=mismatch`);
    await launch.click(); await search.fill('Fixture chat'); await row('agent:fixture-agent').hover();
    assert.doesNotMatch(await page.locator('.wp-preview').innerText(), /already-read synthetic reply/, 'previous session text cannot leak into the current chat preview');
    checks.push(`${width}: adapter dispatch preserved, session-bound excerpt, duplicate URL dedupe, offline boundary`);

    assert.deepEqual(await page.evaluate(() => window.__cmdkSockets), []);
    checks.push(`${width}: focus/caret, typing, preview, filters, recents, disabled, states, Enter, overflow`);
    await context.close();
  }

  assert.deepEqual(forbidden, [], 'fixture attempted forbidden API/external request');
  assert.deepEqual(errors, [], 'fixture browser errors');
  console.log(JSON.stringify({
    status: 'pass',
    mode: before ? 'before screenshots' : 'isolated real-component WebKit',
    screenshots: out,
    checks,
  }, null, 2));
} finally {
  await browser?.close();
  await server?.close();
}
