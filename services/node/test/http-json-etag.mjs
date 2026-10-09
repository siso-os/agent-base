// t-0586: unchanged GET answers are 304s; changed ones, other methods and errors carry the full body.
//   node --experimental-strip-types --no-warnings --test services/node/test/http-json-etag.mjs
import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";
import { sendJson } from "../src/http-json.ts";

let body = { items: [1, 2, 3] }, code = 200;
const server = http.createServer((_req, res) => sendJson(res, code, body));
await new Promise(r => server.listen(0, "127.0.0.1", r));
const url = `http://127.0.0.1:${server.address().port}/api/x`;
test.after(() => server.close());

test("a GET carries a tag; the same tag again is a 304 with no body", async () => {
  const first = await fetch(url, { cache: "no-store" });
  const etag = first.headers.get("etag");
  assert.equal(first.status, 200); assert.deepEqual(await first.json(), body); assert.match(etag, /^"[-_A-Za-z0-9]{20}"$/);
  const again = await fetch(url, { headers: { "if-none-match": etag } });
  assert.equal(again.status, 304); assert.equal(await again.text(), "");
});
test("a changed answer is a 200 with a new tag", async () => {
  const etag = (await fetch(url)).headers.get("etag");
  body = { items: [1, 2, 3, 4] };
  const changed = await fetch(url, { headers: { "if-none-match": etag } });
  assert.equal(changed.status, 200); assert.notEqual(changed.headers.get("etag"), etag); assert.deepEqual(await changed.json(), body);
});
test("a stale or malformed tag gets the full answer", async () => {
  const r = await fetch(url, { headers: { "if-none-match": '"nope"' } });
  assert.equal(r.status, 200); assert.deepEqual(await r.json(), body);
});
test("errors and non-GET answers are never tagged or 304", async () => {
  code = 404; const tag = (await fetch(url)).headers.get("etag");
  assert.equal(tag, null);
  code = 200; const etag = (await fetch(url)).headers.get("etag");
  const post = await fetch(url, { method: "POST", headers: { "if-none-match": etag } });
  assert.equal(post.status, 200); assert.equal(post.headers.get("etag"), null); assert.deepEqual(await post.json(), body);
});
