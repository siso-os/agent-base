// Hermetic: the browser favicon route fetches a site's own icon (its /favicon.ico, else its declared <link rel=icon>),
// caches it on disk, answers 404 for a site with none, and serves SVG sandboxed so it cannot run as a page.
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
const dir = mkdtempSync(path.join(tmpdir(), '.siso-ephemeral-favicons.'));
process.env.AB_FAVICONS = dir;
const { browserRoutes } = await import('../src/routes/browser.area.ts');
let hits = 0;
const site = http.createServer((req, res) => {
  hits++;
  if (req.headers.host?.startsWith('127.0.0.1') && req.url === '/favicon.ico') { res.writeHead(200, { 'content-type': 'image/x-icon' }); return res.end(Buffer.from([0, 0, 1, 0])); }
  if (req.url === '/') { res.writeHead(200, { 'content-type': 'text/html' }); return res.end('<html><head><link rel="icon" href="/brand.svg"></head></html>'); }
  if (req.url === '/brand.svg') { res.writeHead(200, { 'content-type': 'image/svg+xml' }); return res.end('<svg xmlns="http://www.w3.org/2000/svg"/>'); }
  res.writeHead(404); res.end();
});
await new Promise(r => site.listen(0, '127.0.0.1', r));
const port = site.address().port;
const route = browserRoutes({ ALLOWED_ORIGINS: new Set(), BROWSER_HISTORY: '', BROWSER_STATE: '', json: () => true, readBody: async () => '', run: async () => '' });
const call = async (target) => { let status = 0, headers = {}, body = Buffer.alloc(0); const res = { writeHead: (s, h) => { status = s; headers = h ?? {}; }, end: b => { body = b ? Buffer.from(b) : Buffer.alloc(0); } }; await route.handle({ method: 'GET', url: `/api/browser/favicon?url=${encodeURIComponent(target)}`, headers: {} }, res, null, new URL(`http://node/api/browser/favicon?url=${encodeURIComponent(target)}`)); return { status, headers, body }; };
try {
  const ico = await call(`http://127.0.0.1:${port}/some/page`);
  assert.equal(ico.status, 200); assert.equal(ico.headers['content-type'], 'image/x-icon'); assert.equal(ico.body.length, 4);
  const before = hits; assert.equal((await call(`http://127.0.0.1:${port}/other`)).status, 200); assert.equal(hits, before, 'second read comes from the disk cache');
  const svg = await call(`http://localhost:${port}/`);
  assert.equal(svg.status, 200); assert.equal(svg.headers['content-type'], 'image/svg+xml'); assert.match(svg.headers['content-security-policy'], /sandbox/);
  assert.equal((await call('javascript:alert(1)')).status, 404);
  assert.equal((await call(`http://127.0.0.1:1/`)).status, 404, 'unreachable site: no icon');
  console.log('PASS: own icon fetched and cached; declared icon followed; SVG sandboxed; non-web and unreachable addresses get none');
} finally { site.close(); rmSync(dir, { recursive: true }); }
