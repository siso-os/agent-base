import assert from "node:assert/strict";
import { libraryRoute } from "../src/routes/library.route.ts";
import { dispatchRoute } from "../src/routes/registry.ts";

const calls = [];
const route = libraryRoute(async () => ({ docs: [{ id: "known", title: "Known document" }] }), async code => {
  calls.push(code);
  return code === "known" ? { postcode: code } : null;
});
async function request(url, method = "GET") {
  const response = { status: 0, body: null, headers: null, writeHead(status, headers) { this.status = status; this.headers = headers; }, end(body) { this.body = JSON.parse(body); } };
  const matched = await dispatchRoute([route], { method, url }, response, new URL(url, "http://localhost").pathname);
  return { matched, ...response };
}
const library = await request("/api/library");
assert.equal(library.status, 200);
assert.equal(library.headers["cache-control"], "no-store");
assert.deepEqual(library.body.docs, [{ id: "known", title: "Known document" }]);
assert.deepEqual((await request("/api/library/building?postcode=known")).body, { postcode: "known" });
assert.equal((await request("/api/library/building?postcode=unknown")).status, 404);
assert.deepEqual((await request("/api/library/building")).body, { error: "not a building on this machine" });
assert.deepEqual(calls, ["known", "unknown", null]);
assert.equal((await request("/api/library", "POST")).matched, false);
assert.equal((await request("/api/library/reveal")).matched, false);
assert.equal((await request("/api/library/building/extra")).matched, false);
console.log("Library route: existing GET responses, missing-building 404, query identity and mutation boundaries pass");
