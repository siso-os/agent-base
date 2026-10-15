// People hub's latest pulls: one tracker read is kept for 5 minutes, a failed read keeps the last good one marked stale,
// and with nothing to keep it says why.
//   heavy -- node --experimental-strip-types --no-warnings --test services/node/test/people-watch-route.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { peopleWatchRoute, SCRIPT } from '../src/routes/people-watch.route.ts';

const call = async (route, p = '/api/people-watch') => {
  const out = { status: 0, body: null };
  const res = { writeHead(s) { out.status = s; }, end(b = '') { out.body = JSON.parse(String(b)); } };
  const url = new URL(`http://127.0.0.1:5401${p}`);
  await route.handle({ headers: {} }, res, route.path.exec(url.pathname), url);
  return out;
};
const good = JSON.stringify({ people: { theo: { name: 'Theo', feeds: {} } }, counts: [{ person: 'theo', source: 'x', n: 2 }], items: [], polled: 1 });

test('reads once, serves the copy for 5 minutes, then reads again', async () => {
  let reads = 0, t = 0;
  const route = peopleWatchRoute(async () => (reads++, good), () => t);
  assert.equal((await call(route)).body.people.theo.name, 'Theo');
  t = 4 * 60_000; await call(route);
  assert.equal(reads, 1);
  t = 6 * 60_000; await call(route);
  assert.equal(reads, 2);
  await call(route, '/api/people-watch?fresh=1');
  assert.equal(reads, 3);
});

test('a failed read keeps the last good one, marked stale with the reason', async () => {
  let fail = false, t = 0;
  const route = peopleWatchRoute(async () => { if (fail) throw new Error('ssh: connect: Connection timed out'); return good; }, () => t);
  await call(route);
  fail = true; t = 10 * 60_000;
  const out = await call(route);
  assert.equal(out.status, 200);
  assert.equal(out.body.stale, true);
  assert.equal(out.body.error, 'the Mac mini did not answer');
  assert.equal(out.body.counts[0].n, 2);
});

test('nothing read yet and the read fails: 502 with why', async () => {
  const out = await call(peopleWatchRoute(async () => { throw new Error('exit 1'); }));
  assert.equal(out.status, 502);
  assert.equal(out.body.error, 'the tracker could not be read');
});

test('the tracker script opens the index read only', () => {
  assert.match(SCRIPT, /mode=ro/);
});
