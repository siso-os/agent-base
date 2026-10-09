// t-0586: the web's changed reader sends the last tag, turns a 304 into null, and keeps tags per reader.
//   node --experimental-strip-types --no-warnings --test services/node/test/fetch-changed.mjs
import assert from "node:assert/strict";
import test from "node:test";
import { changedReader } from "../../../apps/web/src/lib/fetch-changed.ts";

let answer = { status: 200, etag: '"a"' }; const seen = [];
globalThis.fetch = async (url, init) => { seen.push(init.headers.get("if-none-match")); const sent = init.headers.get("if-none-match");
  return sent && sent === answer.etag ? new Response(null, { status: 304 }) : new Response("{}", { status: answer.status, headers: answer.etag ? { etag: answer.etag } : {} }); };

test("first read is full, an unchanged one is null, a changed one is full again", async () => {
  const read = changedReader(); seen.length = 0;
  assert.equal((await read("/api/x")).status, 200);
  assert.equal(await read("/api/x"), null);
  answer = { status: 200, etag: '"b"' };
  assert.equal((await read("/api/x")).status, 200);
  assert.deepEqual(seen, [null, '"a"', '"a"']);
});
test("two readers of one url keep their own tags (the second still gets its first answer)", async () => {
  answer = { status: 200, etag: '"c"' };
  const one = changedReader(), two = changedReader();
  assert.equal((await one("/api/x")).status, 200);
  assert.equal((await two("/api/x")).status, 200);
});
test("a failed answer drops the tag; reset() forces a full read", async () => {
  const read = changedReader(); answer = { status: 200, etag: '"d"' };
  await read("/api/x"); answer = { status: 500, etag: null };
  assert.equal((await read("/api/x")).status, 500);
  answer = { status: 200, etag: '"d"' };
  assert.equal((await read("/api/x")).status, 200, "no tag after a failure, so the answer is full");
  read.reset(); seen.length = 0; await read("/api/x"); assert.deepEqual(seen, [null]);
});
