// 12 Oct, Shaan: "if I'm on the UI hub agent ... whenever he sends me a URL, I click it and it opens the browser. and it goes
// up top but maybe to the right hand side ... shows that it's connected under UI hub ... any browsers it's got inside if I click
// drop down". A chat link opens a browser tab marked as its agent's; up top on the right that agent's chip goes back to its
// chat in one click and its caret lists its pages. Synthetic full app, sealed API, a fake desktop bridge, never the live node.
//   heavy -- node services/node/test/agent-pages-ui.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { webkit } from './suite-runtime.mjs';
import { fixtureResponse } from '../../../tools/ab-qa-fixtures.mjs';

const root = path.resolve(import.meta.dirname, '../../..');
const { createServer } = createRequire(path.join(root, 'apps/web/package.json'))('vite');
const shots = path.join(root, 'ui-hub/agent-pages');

// The link in a chat names its chat: the one line that hands the agent on (ChatView's Link).
const chat = readFileSync(path.join(root, 'apps/web/src/components/ChatView.tsx'), 'utf8');
assert.match(chat, /openLink\(href, e\.currentTarget\.closest\("\[data-agent-id\]"\)/, 'a chat link passes its chat\'s agent');
assert.match(chat, /data-testid="chat-view" data-agent-id=\{agentId\}/, 'the chat carries its agent id');

const fakeBridge = () => {
  const handlers = new Map(), listeners = new Map(); let next = 1;
  window.__calls = [];
  window.__TAURI_INTERNALS__ = {
    transformCallback: (cb) => { const id = next++; handlers.set(id, cb); return id; },
    invoke: async (cmd, args = {}) => {
      window.__calls.push({ cmd, args });
      if (cmd === 'plugin:event|listen') { listeners.set(args.event, [...(listeners.get(args.event) ?? []), args.handler]); return next++; }
      if (cmd === 'browser_auth_pending') return [];
      if (cmd === 'browser_url' || cmd === 'browser_title') return '';
      if (cmd === 'browser_audio') return false;
      return null;
    },
  };
};

let server, browser;
try {
  server = await createServer({ root: path.join(root, 'apps/web'), configFile: path.join(root, 'apps/web/vite.config.ts'), logLevel: 'error',
    plugins: [{ name: 'sealed-api', configureServer(v) { v.middlewares.use((req, res, next) => { if (/^\/(api|chat|term)\b/.test(req.url ?? '')) { res.statusCode = 410; res.end('Fixture only'); return; } next(); }); } }],
    server: { host: '127.0.0.1', port: 0, strictPort: false, hmr: false, watch: { ignored: ['**/*'] } } });
  await server.listen();
  const base = `http://127.0.0.1:${server.httpServer.address().port}`;
  browser = await webkit.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(() => { localStorage.setItem('agent-base:space', '"agents"'); window.EventSource = undefined; });
  await page.addInitScript(fakeBridge);
  await page.routeWebSocket('**/*', socket => socket.close());
  await page.route('**/*', route => new URL(route.request().url()).origin === base ? route.fallback() : route.abort());
  await page.route(`${base}/api/**`, route => {
    const req = route.request(), p = new URL(req.url()).pathname;
    if (req.method() !== 'GET') return route.fulfill({ json: { ok: true } });
    const body = fixtureResponse(p, 'fixture');
    return body === undefined ? route.fulfill({ status: 404, json: {} }) : route.fulfill({ json: body });
  });
  await page.goto(base);
  const agents = (fixtureResponse('/api/agents', 'fixture')?.agents ?? []).filter(a => !a.zero);
  assert.ok(agents.length, 'the fixture has a non-zero agent');
  const sender = agents[0];
  await page.getByTestId('chat-view').first().waitFor({ state: 'attached', timeout: 15000 }).catch(() => {});

  // A link clicked in the sender's chat: his press, then the page event the Link raises.
  const link = async (url) => {
    await page.mouse.click(720, 450);
    return page.evaluate(([url, agentId]) => !window.dispatchEvent(new CustomEvent('agent-base:open-page', { detail: { url, agentId }, cancelable: true })), [url, sender.id]);
  };
  assert.equal(await link('https://example.com/one'), true, 'the app takes the link');
  const chip = page.locator('[data-testid="live-agent"][data-pages]').filter({ hasText: sender.name });
  await chip.waitFor();
  assert.equal(await chip.getAttribute('data-current'), '1', 'the page on screen is under its agent');
  assert.equal((await chip.locator('.ab-live-agent__count').textContent())?.trim(), '1');
  await page.getByTestId('browser-tab-via').filter({ hasText: sender.name }).first().waitFor();
  await page.screenshot({ path: path.join(shots, 'agent-pages-browser.png') });

  // A second link from the same agent: one chip, two pages.
  await link('https://example.org/two');
  await page.waitForFunction(() => document.querySelector('[data-testid="live-agent"][data-pages] .ab-live-agent__count')?.textContent?.trim() === '2');
  assert.equal(await page.locator(`[data-testid="live-agent"][data-agent="${sender.name}"]`).count(), 1, 'one chip per agent, pages or not');

  // Its name: back to its chat in one click.
  await chip.locator('.ab-live-agent__name').click();
  await page.waitForFunction(() => localStorage.getItem('agent-base:space') === '"agents"');
  await chip.waitFor();
  // Its pages are under its chip only: no "back to the browser" tab repeats them (12 Oct: nothing up top twice).
  assert.equal(await page.locator('[title^="Back to the browser"]').count(), 0, 'no second way to the same page');
  await page.screenshot({ path: path.join(shots, 'agent-pages-chat.png') });

  // Its caret: its chat, its pages, close them.
  await chip.getByRole('button', { name: `${sender.name}'s pages` }).click();
  const menu = page.getByRole('menu');
  await menu.waitFor();
  for (const text of [`${sender.name}'s chat`, 'example.com', 'example.org', 'Close all 2 pages']) await menu.getByText(text, { exact: false }).first().waitFor();
  await page.screenshot({ path: path.join(shots, 'agent-pages-menu.png') });
  await menu.getByText('example.com', { exact: false }).first().click();
  await page.waitForFunction(() => document.querySelector('[data-testid="live-agent"][data-pages]')?.getAttribute('data-current') === '1' && localStorage.getItem('agent-base:space') === '"web"');
  await chip.getByRole('button', { name: `${sender.name}'s pages` }).click();
  await page.getByRole('menu').getByText('Close all 2 pages').click();
  await chip.locator('.ab-live-agent__pages').waitFor({ state: 'detached' });
  assert.deepEqual(errors, []);
  console.log('PASS agent pages', JSON.stringify({ agent: sender.name, chip: 'current in browser, back to chat, menu, close all' }));
} finally { await browser?.close(); await server?.close(); }
