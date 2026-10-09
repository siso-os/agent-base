// The web app's frame check (9 Oct): which pages cannot show in an iframe, so the browser offers a new tab instead.
import assert from 'node:assert/strict';
import test from 'node:test';
import { frameOf, frameable } from '../src/browser-reach.ts';

const h = (o) => new Headers(o);
test('a 401 asks for a password a frame never shows', () => assert.deepEqual(frameOf(401, h({ 'www-authenticate': 'Basic realm="x"' })), { frame: false, why: 'password' }));
test('X-Frame-Options deny or sameorigin refuses frames', () => {
  assert.deepEqual(frameOf(200, h({ 'x-frame-options': 'deny' })), { frame: false, why: 'frames' });
  assert.deepEqual(frameOf(200, h({ 'x-frame-options': 'SAMEORIGIN' })), { frame: false, why: 'frames' });
});
test('CSP frame-ancestors refuses unless it allows any origin', () => {
  assert.deepEqual(frameOf(200, h({ 'content-security-policy': "default-src 'self'; frame-ancestors 'none'" })), { frame: false, why: 'frames' });
  assert.deepEqual(frameOf(200, h({ 'content-security-policy': "frame-ancestors https://a.example" })), { frame: false, why: 'frames' });
  assert.deepEqual(frameOf(200, h({ 'content-security-policy': "frame-ancestors *" })), { frame: true });
  assert.deepEqual(frameOf(200, h({ 'content-security-policy': "default-src 'self'" })), { frame: true });
});
test('a plain page frames', () => assert.deepEqual(frameOf(200, h({})), { frame: true }));
test('no answer, a bad address or another scheme means try the frame', async () => {
  assert.deepEqual(await frameable('https://x.example', async () => { throw new TypeError('fetch failed'); }), { frame: true });
  assert.deepEqual(await frameable('not a url'), { frame: true });
  assert.deepEqual(await frameable('file:///etc/hosts'), { frame: true });
});
test('frameable reads the answer without credentials', async () => {
  let seen;
  const r = await frameable('https://github.com/', async (url, init) => { seen = init; return new Response('', { status: 200, headers: { 'x-frame-options': 'deny' } }); });
  assert.deepEqual(r, { frame: false, why: 'frames' });
  assert.equal(seen.credentials, 'omit');
});
