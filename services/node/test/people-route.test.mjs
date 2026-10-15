// People graph's door: the library site is fetched with the credential added server-side, its root links are moved under
// /api/people, and a missing credential or a dead site says so.
//   heavy -- node --experimental-strip-types --no-warnings --test services/node/test/people-route.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { peopleRoute, rebase } from '../src/routes/people.route.ts';

const call = async (route, p) => {
  const out = { status: 0, headers: {}, body: '' };
  const res = { writeHead(s, h) { out.status = s; out.headers = h; }, end(b = '') { out.body = String(b); } };
  const url = new URL(`http://127.0.0.1:5401${p}`);
  await route.handle({ headers: {} }, res, route.path.exec(url.pathname), url);
  return out;
};

test('adds the credential server-side and moves root links under /api/people', async () => {
  const asked = [];
  const site = async (u, init) => (asked.push([u, init.headers.Authorization]),
    new Response('<a href="/graph/">g</a><a href="//cdn.x/y">c</a><script src="/x.js"></script>', { headers: { 'content-type': 'text/html' } }));
  const out = await call(peopleRoute(async () => 'INVENTED', 'https://lib.test', site), '/api/people/david-ondrej/?q=1');
  assert.equal(out.status, 200);
  assert.deepEqual(asked, [['https://lib.test/david-ondrej/?q=1', `Basic ${Buffer.from('siso:INVENTED').toString('base64')}`]]);
  assert.equal(out.body, '<a href="/api/people/graph/">g</a><a href="//cdn.x/y">c</a><script src="/api/people/x.js"></script>');
  assert.ok(!out.body.includes('INVENTED') && !JSON.stringify(out.headers).includes('INVENTED'), 'the password never reaches the page');
});

test('bare /api/people redirects to the slash; JSON passes through untouched', async () => {
  assert.equal((await call(peopleRoute(async () => 'x', 'https://lib.test', async () => { throw new Error(); }), '/api/people')).headers.Location, '/api/people/');
  const out = await call(peopleRoute(async () => 'x', 'https://lib.test', async () => new Response('{"nodes":[]}', { headers: { 'content-type': 'application/json' } })), '/api/people/graph.json');
  assert.equal(out.body, '{"nodes":[]}');
});

test('no credential or no site: a page that says so', async () => {
  assert.equal((await call(peopleRoute(async () => null, 'https://lib.test', fetch), '/api/people/')).status, 503);
  assert.equal((await call(peopleRoute(async () => 'x', 'https://lib.test', async () => { throw new Error('down'); }), '/api/people/')).status, 502);
});

test('rebase leaves absolute and protocol-relative links alone', () => {
  assert.equal(rebase('<a href="https://x/">a</a><a href="//x">b</a><a href=\'/c/\'>c</a>'), '<a href="https://x/">a</a><a href="//x">b</a><a href=\'/api/people/c/\'>c</a>');
});
