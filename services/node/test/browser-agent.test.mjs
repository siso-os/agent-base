// Agents driving the globe's browser in the background (siso-browser, 16 Oct): requests the node passes to the window.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { agentOp } from '../src/routes/browser-agent.area.ts';
import { pickIdle } from '../../../apps/web/src/lib/webview.ts';

test('an agent may open, navigate, read, list and close its pages, http(s) only', () => {
  const open = agentOp({ op: 'open', agent: 'BROWSER', url: 'https://example.com' });
  assert.equal(open.op, 'open'); assert.equal(open.url, 'https://example.com/'); assert.ok(open.id);
  assert.match(agentOp({ op: 'open', agent: 'BROWSER', url: 'file:///etc/passwd' }), /http/);
  assert.match(agentOp({ op: 'open', agent: 'BROWSER', url: 'javascript:alert(1)' }), /http/);
  assert.match(agentOp({ op: 'eval', agent: 'BROWSER' }), /op is/);
  assert.match(agentOp({ op: 'read', agent: 'BROWSER' }), /tab/);
  assert.match(agentOp({ op: 'list', agent: '../x' }), /agent/);
  assert.equal(agentOp({ op: 'list', agent: 'agent-zero' }).op, 'list');
  assert.equal(agentOp({ op: 'open', agent: 'A', url: 'https://x.dev', signedIn: 'yes' }).signedIn, undefined);
});

test('a tab he has not looked at for 30 minutes sleeps; on screen, playing and agents\' pages never', () => {
  const now = 10_000_000, old = now - 31 * 60_000, recent = now - 60_000;
  const pages = [
    { key: 'old', mounted: false, seen: old },
    { key: 'recent', mounted: false, seen: recent },
    { key: 'shown', mounted: true, seen: old },
    { key: 'music', mounted: false, seen: old },
    { key: 'agent', mounted: false, seen: old, agent: 'BROWSER' },
  ];
  assert.deepEqual(pickIdle(pages, new Set(['music']), now), ['old']);
  assert.deepEqual(pickIdle(pages, new Set(['music']), Infinity, 0), ['old', 'recent']);
});

test('the window polls same-origin (no Origin header); a web page and an agent posing as the window are refused', async () => {
  const { browserAgentRoutes } = await import('../src/routes/browser-agent.area.ts');
  const route = browserAgentRoutes({ ALLOWED_ORIGINS: new Set(['http://127.0.0.1:5401']), readBody: async () => '{}',
    json: (res, status, body) => { res.status = status; res.body = body; return true; } });
  const get = async (headers) => { const res = {}; const req = { method: 'GET', url: '/api/browser/agent/next?wait=0', headers, on() {} }; await route.handle(req, res, null); return res.status; };
  assert.equal(await get({ 'sec-fetch-site': 'same-origin' }), 200);
  assert.equal(await get({ referer: 'http://127.0.0.1:5401/?window' }), 200);
  assert.equal(await get({ origin: 'http://127.0.0.1:5401' }), 200);
  assert.equal(await get({ origin: 'https://evil.example' }), 403);
  assert.equal(await get({ 'sec-fetch-site': 'cross-site', referer: 'https://evil.example/' }), 403);
});
