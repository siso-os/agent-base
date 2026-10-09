// Request ownership only: all fetch responses and catalogue bodies are synthetic.
import assert from "node:assert/strict";
import test from "node:test";
import { libraryReader } from "../src/lib/library-read.ts";

const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const data = (revision) => ({ revision, counts: {}, built: { rows: [] }, live: { rows: [] }, works: { rows: [], templates: [] }, documents: { rows: [] } });
const response = (value) => ({ ok: true, json: async () => value });
const flush = () => new Promise((resolve) => setImmediate(resolve));
async function fixture(run) {
  const previous = globalThis.fetch;
  const calls = [], values = [], errors = [], loading = [];
  globalThis.fetch = (url, options) => {
    assert.equal(url, "/api/library");
    assert.equal(options.cache, "no-store");
    assert.equal(options.method, undefined);
    assert.ok(options.signal instanceof AbortSignal);
    const request = { ...deferred(), options };
    calls.push(request);
    return request.promise;
  };
  const reader = libraryReader((value) => values.push(value), (error) => errors.push(error), (value) => loading.push(value));
  try { await run({ reader, calls, values, errors, loading }); }
  finally { reader.close(); globalThis.fetch = previous; }
}

test("successful read publishes the catalogue unchanged", () => fixture(async ({ reader, calls, values, errors }) => {
  const pending = reader.read(), value = data("first");
  calls[0].resolve(response(value)); await pending;
  assert.equal(values[0], value); assert.deepEqual(errors, []);
}));
test("new read aborts the prior request, whose late success cannot replace it", () => fixture(async ({ reader, calls, values, errors }) => {
  const old = reader.read(), newest = reader.read();
  assert.equal(calls[0].options.signal.aborted, true);
  calls[1].resolve(response(data("newest"))); await newest;
  calls[0].resolve(response(data("old"))); await old;
  assert.deepEqual(values.map(v => v.revision), ["newest"]); assert.deepEqual(errors, []);
}));
test("superseded response does not even parse its body", () => fixture(async ({ reader, calls, values }) => {
  const old = reader.read(); const newest = reader.read();
  calls[0].resolve({ ok: true, json() { throw new Error("obsolete body parsed"); } }); await old;
  calls[1].resolve(response(data("newest"))); await newest;
  assert.deepEqual(values.map(v => v.revision), ["newest"]);
}));
test("older body parsing completion cannot overwrite the newest catalogue", () => fixture(async ({ reader, calls, values }) => {
  const body = deferred(), old = reader.read();
  calls[0].resolve({ ok: true, json: () => body.promise }); await flush();
  const newest = reader.read(); calls[1].resolve(response(data("newest"))); await newest;
  body.resolve(data("old")); await old;
  assert.deepEqual(values.map(v => v.revision), ["newest"]);
}));
test("older fetch failure does not mark the current view failed", () => fixture(async ({ reader, calls, values, errors }) => {
  const old = reader.read(), newest = reader.read();
  calls[1].resolve(response(data("newest"))); await newest;
  calls[0].reject(new Error("obsolete failure")); await old;
  assert.equal(values[0].revision, "newest"); assert.deepEqual(errors, []);
}));
test("older body failure does not mark the current view failed", () => fixture(async ({ reader, calls, values, errors }) => {
  const body = deferred(), old = reader.read(); calls[0].resolve({ ok: true, json: () => body.promise }); await flush();
  const newest = reader.read(); calls[1].resolve(response(data("newest"))); await newest;
  body.reject(new SyntaxError("old body")); await old;
  assert.equal(values[0].revision, "newest"); assert.deepEqual(errors, []);
}));
test("an older success cannot clear the current read's failure", () => fixture(async ({ reader, calls, values, errors }) => {
  const old = reader.read(), newest = reader.read();
  calls[1].reject(new Error("current failure")); await newest;
  calls[0].resolve(response(data("obsolete"))); await old;
  assert.deepEqual(values, []); assert.deepEqual(errors, ["current failure"]);
}));
test("older finally cannot release ownership of a still-pending newer read", () => fixture(async ({ reader, calls, values, errors }) => {
  const first = reader.read(), second = reader.read();
  calls[0].reject(new Error("old failure")); await first;
  const third = reader.read(); assert.equal(calls[1].options.signal.aborted, true);
  calls[1].resolve(response(data("second"))); await second;
  calls[2].resolve(response(data("third"))); await third;
  assert.deepEqual(values.map(v => v.revision), ["third"]); assert.deepEqual(errors, []);
}));
test("close aborts its active request and suppresses its rejection", () => fixture(async ({ reader, calls, values, errors }) => {
  const pending = reader.read();
  calls[0].options.signal.addEventListener("abort", () => calls[0].reject(new DOMException("Aborted", "AbortError")));
  reader.close(); await pending;
  assert.equal(calls[0].options.signal.aborted, true); assert.deepEqual(values, []); assert.deepEqual(errors, []);
}));
test("close prevents late uncooperative success and future reads", () => fixture(async ({ reader, calls, values, errors }) => {
  const pending = reader.read(); reader.close(); reader.close();
  calls[0].resolve(response(data("late"))); await pending; await reader.read();
  assert.equal(calls.length, 1); assert.deepEqual(values, []); assert.deepEqual(errors, []);
}));
test("close during body parsing suppresses a late catalogue", () => fixture(async ({ reader, calls, values, errors }) => {
  const body = deferred(), pending = reader.read(); calls[0].resolve({ ok: true, json: () => body.promise }); await flush();
  reader.close(); assert.equal(calls[0].options.signal.aborted, true); body.resolve(data("late")); await pending;
  assert.deepEqual(values, []); assert.deepEqual(errors, []);
}));
test("HTTP and parsing failures report accurately without publishing a replacement", () => fixture(async ({ reader, calls, values, errors }) => {
  let pending = reader.read(); calls[0].resolve(response(data("last good"))); await pending;
  pending = reader.read(); calls[1].resolve({ ok: false, status: 503 }); await pending;
  pending = reader.read(); calls[2].resolve({ ok: true, json: async () => { throw new SyntaxError("invalid JSON"); } }); await pending;
  assert.deepEqual(values.map(v => v.revision), ["last good"]); assert.deepEqual(errors, ["503", "invalid JSON"]);
}));
test("malformed structural responses preserve the last accepted catalogue", () => fixture(async ({ reader, calls, values, errors }) => {
  const bad = [null, {}, { counts: {} }, { ...data("bad"), built: { rows: null } }, { ...data("bad"), works: { rows: [], templates: null } }, { ...data("bad"), documents: { rows: "wrong" } }];
  for (const value of bad) { const pending = reader.read(); calls.at(-1).resolve(response(value)); await pending; }
  assert.equal(errors.length, bad.length); assert.ok(errors.every(e => e === "Invalid Library response")); assert.deepEqual(values, []);
}));
test("legacy catalogue without documents remains supported", () => fixture(async ({ reader, calls, values, errors }) => {
  const value = data("legacy"); delete value.documents;
  const pending = reader.read(); calls[0].resolve(response(value)); await pending;
  assert.equal(values[0], value); assert.deepEqual(errors, []);
}));
test("recovery after failure publishes only the subsequent success", () => fixture(async ({ reader, calls, values, errors }) => {
  let pending = reader.read(); calls[0].reject("offline"); await pending;
  pending = reader.read(); calls[1].resolve(response(data("recovered"))); await pending;
  assert.deepEqual(errors, ["offline"]); assert.deepEqual(values.map(v => v.revision), ["recovered"]);
}));
test("two view instances have separate read ownership", () => fixture(async ({ reader, calls, values, errors }) => {
  const otherValues = [], other = libraryReader(v => otherValues.push(v), e => errors.push(e));
  const one = reader.read(), two = other.read(); reader.close();
  assert.equal(calls[0].options.signal.aborted, true); assert.equal(calls[1].options.signal.aborted, false);
  calls[0].resolve(response(data("closed"))); calls[1].resolve(response(data("other"))); await Promise.all([one, two]); other.close();
  assert.deepEqual(values, []); assert.deepEqual(otherValues.map(v => v.revision), ["other"]); assert.deepEqual(errors, []);
}));

test("scheduled reads coalesce a pending request through fetch and body parsing", () => fixture(async ({ reader, calls, values, errors }) => {
  const body = deferred(), pending = reader.read(true);
  for (let tick = 0; tick < 4; tick++) void reader.read(true);
  assert.equal(calls.length, 1); assert.equal(calls[0].options.signal.aborted, false);
  calls[0].resolve({ ok: true, json: () => body.promise }); await flush();
  void reader.read(true); assert.equal(calls.length, 1);
  body.resolve(data("slow")); await pending;
  assert.deepEqual(values.map(v => v.revision), ["slow"]); assert.deepEqual(errors, []);
  const next = reader.read(true); assert.equal(calls.length, 2);
  calls[1].resolve(response(data("next"))); await next;
  assert.deepEqual(values.map(v => v.revision), ["slow", "next"]);
}));
test("explicit refresh supersedes a scheduled read without late-error or ownership regression", () => fixture(async ({ reader, calls, values, errors }) => {
  const old = reader.read(true), fresh = reader.read();
  assert.equal(calls[0].options.signal.aborted, true);
  calls[0].reject(new Error("obsolete")); await old;
  void reader.read(true); assert.equal(calls.length, 2);
  calls[1].resolve(response(data("explicit"))); await fresh;
  assert.deepEqual(values.map(v => v.revision), ["explicit"]); assert.deepEqual(errors, []);
}));
test("a failed scheduled read releases its slot for recovery and close still aborts it", () => fixture(async ({ reader, calls, values, errors }) => {
  const failed = reader.read(true); calls[0].reject(Error("offline")); await failed;
  const recovered = reader.read(true); calls[1].resolve(response(data("recovered"))); await recovered;
  const abandoned = reader.read(true); reader.close();
  calls[2].resolve(response(data("closed"))); await abandoned; await reader.read(true);
  assert.equal(calls.length, 3); assert.equal(calls[2].options.signal.aborted, true);
  assert.deepEqual(values.map(v => v.revision), ["recovered"]); assert.deepEqual(errors, ["offline"]);
}));

test("loading covers the complete fetch and body lifecycle without coalesced notifications", () => fixture(async ({ reader, calls, loading }) => {
  const body = deferred(), pending = reader.read(true);
  await reader.read(true); assert.deepEqual(loading, [true]);
  calls[0].resolve({ ok: true, json: () => body.promise }); await flush();
  await reader.read(true); assert.deepEqual(loading, [true]);
  body.resolve(data("ready")); await pending;
  assert.deepEqual(loading, [true, false]);
}));
test("a superseded failure cannot clear the newer loading indicator", () => fixture(async ({ reader, calls, loading, errors }) => {
  const old = reader.read(true), current = reader.read();
  calls[0].reject(Error("late failure")); await old;
  assert.deepEqual(loading, [true, true]); assert.deepEqual(errors, []);
  calls[1].resolve(response(data("current"))); await current;
  assert.deepEqual(loading, [true, true, false]);
}));
test("a superseded body cannot clear the newer loading indicator", () => fixture(async ({ reader, calls, loading, values }) => {
  const body = deferred(), old = reader.read();
  calls[0].resolve({ ok: true, json: () => body.promise }); await flush();
  const current = reader.read(); body.resolve(data("obsolete")); await old;
  assert.equal(calls[0].options.signal.aborted, true); assert.deepEqual(values, []);
  assert.deepEqual(loading, [true, true]);
  calls[1].resolve(response(data("current"))); await current;
  assert.deepEqual(loading, [true, true, false]);
}));
test("failure ends the loading indicator and a retry restarts it", () => fixture(async ({ reader, calls, loading, errors }) => {
  const failed = reader.read(); calls[0].reject(Error("offline")); await failed;
  assert.deepEqual(loading, [true, false]); assert.deepEqual(errors, ["offline"]);
  const retry = reader.read(); assert.deepEqual(loading, [true, false, true]);
  calls[1].resolve(response(data("recovered"))); await retry;
  assert.deepEqual(loading, [true, false, true, false]);
}));
test("close suppresses late loading callbacks and subsequent attempts", () => fixture(async ({ reader, calls, loading }) => {
  const pending = reader.read(); reader.close();
  calls[0].resolve(response(data("closed"))); await pending; await reader.read();
  assert.deepEqual(loading, [true]); assert.equal(calls.length, 1);
}));
