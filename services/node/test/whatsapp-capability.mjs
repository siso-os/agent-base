// Sealed proxy contract: direct invocation, fake token, in-memory fetch/responses only.
// Never starts server.ts or calls whatsappConfig, Rolodex, pairing, read or live APIs.
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { allowed, proxy } from "../src/whatsapp.ts";

const cfg = { url: "https://whatsapp-fixture.invalid", token: "synthetic-token-only" };
const originalFetch = globalThis.fetch;
let requests = 0;
let upstream = () => Response.json({ sendEnabled: true });
globalThis.fetch = async (url, init) => {
  requests++;
  assert.equal(url, cfg.url + "/health");
  assert.equal(init.method, "GET");
  assert.equal(init.headers.authorization, "Bearer synthetic-token-only");
  return upstream();
};
async function call(sub, method = "GET", config = cfg, fromApp = true, input = '{"text":"synthetic draft"}') {
  const req = Object.assign(new EventEmitter(), { method });
  let status, headers, body;
  const res = {
    writeHead(code, value) { status = code; headers = value; },
    end(value) { body = value; },
    write() { assert.fail("health must be projected, not streamed"); },
  };
  await proxy(req, res, new URL("https://agent-base-fixture.invalid/api/whatsapp" + sub), config, fromApp, method === "POST" ? input : undefined);
  return { status, headers, body: JSON.parse(body) };
}
try {
  const variants = [true, false, undefined, null, "true", "false", 1, {}, []];
  for (const sendEnabled of variants) {
    // Local route support grants app capability; the upstream boolean only grants gateway capability.
    upstream = () => Response.json({ sendEnabled, appSendEnabled: false, link: { state: "connected", connected: true, loggedIn: true } });
    const result = await call("/health");
    assert.equal(result.status, 200);
    assert.equal(result.body.sendEnabled, sendEnabled === true);
    assert.equal(result.body.appSendEnabled, allowed("POST", "/chats/fixture/send"));
    assert.equal(result.body.appSendEnabled, true);
    assert.equal(result.body.link.state, "connected");
    assert.equal(result.headers["cache-control"], "no-store");
  }
  for (const value of [null, [], "invalid", true, {}, { sendEnabled: true }, { sendEnabled: true, link: { connected: "true", loggedIn: true } }, { sendEnabled: true, link: { state: {}, connected: true, loggedIn: true } }]) {
    upstream = () => Response.json(value);
    const result = await call("/health");
    assert.equal(result.status, 502);
    assert.equal(result.body.appSendEnabled, false);
    assert.equal(result.body.sendEnabled, false);
  }
  upstream = () => new Response("not json", { headers: { "content-type": "application/json" } });
  assert.equal((await call("/health")).status, 502);
  for (const status of [429, 500, 503]) {
    upstream = () => Response.json({ sendEnabled: true, appSendEnabled: true }, { status });
    const result = await call("/health");
    assert.equal(result.status, status);
    assert.equal(result.body.appSendEnabled, false);
  }
  upstream = () => { throw new Error("synthetic unreachable"); };
  const failed = await call("/health");
  assert.equal(failed.status, 502);


  const before = requests;
  const route = "/chats/fixture%40s.whatsapp.net/send";
  const valid = { text: "synthetic draft", requestId: "f8d0eae4-11a9-47b4-a651-6e1ceeaac6bb", explicit: true };
  assert.equal(allowed("POST", route), true, "explicit local sending route is supported");
  for (let repeat = 0; repeat < 3; repeat++)
    assert.equal((await call(route, "POST", cfg, false, JSON.stringify(valid))).status, 403);
  const malformed = [
    undefined, "not json", "null", "[]", "{}",
    JSON.stringify({ ...valid, explicit: false }), JSON.stringify({ ...valid, explicit: "true" }),
    JSON.stringify({ ...valid, text: "   " }), JSON.stringify({ ...valid, text: 5 }),
    JSON.stringify({ ...valid, text: "😀".repeat(1001) }),
    JSON.stringify({ ...valid, requestId: "../../bad" }), JSON.stringify({ ...valid, requestId: null }),
    JSON.stringify({ ...valid, requestId: "f8d0eae4-11a9-17b4-a651-6e1ceeaac6bb" }),
  ];
  for (const input of malformed) for (let repeat = 0; repeat < 3; repeat++)
    assert.equal((await call(route, "POST", cfg, true, input)).status, 400);
  const unsupported = ["/send", "/chats//send", "/chats/../send", "/chats/fixture/%73end", "/chats/fixture/send/"];
  for (const sub of unsupported) for (const method of ["GET", "POST", "PUT"]) {
    assert.equal(allowed(method, new URL(sub, "https://fixture.invalid").pathname), false);
    assert.equal((await call(sub, method)).status, 404);
  }
  for (const method of ["GET", "PUT"]) {
    assert.equal(allowed(method, route), false);
    assert.equal((await call(route, method)).status, 404);
  }
  assert.equal((await call(route, "POST", null)).status, 503);
  assert.equal((await call("/health", "GET", null)).status, 503);
  assert.equal(requests, before, "unauthorized and malformed sends must make zero upstream requests");
  assert.equal(failed.body.appSendEnabled, false, "unreachable health explicitly revokes local capability");
  assert.equal(failed.body.sendEnabled, false, "unreachable health explicitly revokes gateway capability");
  console.log(JSON.stringify({ ok: true, healthCases: 22, malformedPayloadCases: malformed.length, unauthorizedAttempts: 3, forbiddenUpstreamRequests: 0, sendSuccessCoverage: "whatsapp-comms.mjs", rateLimitsExercised: false }));
} finally {
  globalThis.fetch = originalFetch;
}
