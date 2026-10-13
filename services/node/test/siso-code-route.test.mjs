// SISO Code's door: with a live T3 session the frame goes straight to T3; without one it pairs (a one-time link from the
// mini); a failure says so.
//   heavy -- node --experimental-strip-types --no-warnings --test services/node/test/siso-code-route.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sisoCodeRoute } from '../src/routes/siso-code.route.ts';

const call = async (route, q = '', cookie) => {
  const out = { status: 0, headers: {}, body: '' };
  const res = { writeHead(s, h) { out.status = s; out.headers = h; }, end(b = '') { out.body = String(b); } };
  await route.handle({ headers: cookie ? { cookie } : {} }, res, [], new URL(`http://127.0.0.1:5401/api/code/open${q}`));
  return out;
};

test('no session pairs; a live session goes straight to T3; ?pair=1 pairs again', async () => {
  let asked = 0;
  const seen = [];
  const route = sisoCodeRoute(async () => (asked++, 'INVENTED1'), 'http://127.0.0.1:5490',
    async (cookie) => (seen.push(cookie), cookie === 't3_session_x=live'));
  assert.equal((await call(route)).headers.Location, 'http://127.0.0.1:5490/pair#token=INVENTED1');
  assert.equal((await call(route, '', 't3_session_x=stale')).headers.Location, 'http://127.0.0.1:5490/pair#token=INVENTED1', 'a dead session pairs');
  const live = await call(route, '', 't3_session_x=live');
  assert.equal(live.status, 302);
  assert.equal(live.headers.Location, 'http://127.0.0.1:5490/');
  assert.equal(asked, 2);
  assert.equal((await call(route, '?pair=1', 't3_session_x=live')).headers.Location, 'http://127.0.0.1:5490/pair#token=INVENTED1');
  assert.equal(asked, 3);
  assert.deepEqual(seen, [undefined, 't3_session_x=stale', 't3_session_x=live'], 'the cookie is what decides');
});

test('T3 Code not running: a page that says so', async () => {
  const out = await call(sisoCodeRoute(async () => { throw new Error('T3 Code is not running'); }, 'http://127.0.0.1:5490', async () => false));
  assert.equal(out.status, 503);
  assert.match(out.body, /could not pair: T3 Code is not running/);
});
