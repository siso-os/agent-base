// Sealed actual-component contract. Bundle in memory, intercept EVERY browser request.
// No server, real config, contacts, messages, pairing or gateway APIs are used.
// In a dependency-free worktree, AB_DEPENDENCY_ROOT may point to installed canonical dependencies (read only).
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";

const repo = path.resolve(import.meta.dirname, "../../..");
const deps = process.env.AB_DEPENDENCY_ROOT || repo;
const webRequire = createRequire(path.join(deps, "apps/web/package.json"));
const { build } = createRequire(webRequire.resolve("vite"))("esbuild");
const { webkit } = createRequire(path.join(deps, "services/node/package.json"))("playwright");
const component = path.join(repo, "apps/web/src/components/WhatsAppSpace.tsx");
const bundle = await build({
  stdin: { contents: `
    import React from "react";
    import { createRoot } from "react-dom/client";
    import { WhatsAppSpace, apiClient } from ${JSON.stringify(component)};
    let requestCount = 0;
    window.fetch = async () => { requestCount++; throw new Error("Network forbidden in fixture"); };
    window.EventSource = class { constructor() { throw new Error("EventSource forbidden in fixture"); } };
    const chats = [
      { jid: "fixture-pinned", name: "Fixture Pinned", isGroup: false, pinned: true, lastTs: 1, unread: 0 },
      { jid: "fixture-recent", name: "Fixture Recent", isGroup: false, lastTs: 3, unread: 0 },
      { jid: "fixture-group", name: "Fixture Group", isGroup: true, lastTs: 2, unread: 0 },
    ];
    const counts = { chats: 3, groups: 1, messages: 0, unreadChats: 0 };
    let mode = { sendEnabled: true }, event, releaseInitial, rejectSend, resolveSend;
    let initial = true, healthCalls = 0, sendCalls = 0;
    const sends = [];
    const health = () => ({ link: { state: "connected", loggedIn: true, connected: true, since: 1 }, counts, readReceipts: false, ...mode });
    const client = {
      health: async () => {
        healthCalls++;
        if (initial) { initial = false; await new Promise(r => releaseInitial = r); }
        if (mode.error) throw new Error("Synthetic health unavailable");
        return mode.malformed ? null : health();
      },
      chats: async () => ({ chats, counts }),
      messages: async jid => ({ chat: chats.find(c => c.jid === jid), messages: [] }),
      search: async q => ({ chats: chats.filter(c => c.name.toLowerCase().includes(q.toLowerCase())), messages: [] }),
      read: async () => {},
      send: async (jid, text, requestId) => { sendCalls++; sends.push({ jid, text, requestId, stored: JSON.parse(localStorage.getItem("ab:whatsapp:draft:fixture:" + jid)) }); await new Promise((resolve, reject) => { resolveSend = resolve; rejectSend = reject; }); },
      pair: async () => { throw new Error("Pairing forbidden in fixture"); },
      qr: async () => { throw new Error("QR forbidden in fixture"); },
      thumbUrl: () => { throw new Error("Media forbidden in fixture"); },
      mediaUrl: () => { throw new Error("Media forbidden in fixture"); },
      subscribe: on => { event = on; return () => { event = undefined; }; },
    };
    window.fixture = {
      apiClient, get requests() { return requestCount; }, get healthCalls() { return healthCalls; },
      get sends() { return sendCalls; }, get sendRecords() { return sends; }, ready: () => releaseInitial(),
      refresh: next => { mode = next; event({ type: "state" }); },
      reject: status => rejectSend(Object.assign(new Error(status === 429 ? "Synthetic 429: try again" : "Synthetic send failure"), { status })),
      resolve: () => resolveSend(),
    };
    createRoot(document.getElementById("root")).render(<WhatsAppSpace client={client} now={1000000} />);
  `, resolveDir: path.join(repo, "apps/web"), loader: "tsx" },
  bundle: true, write: false, format: "iife", jsx: "automatic",
  nodePaths: [path.join(deps, "apps/web/node_modules"), path.join(deps, "node_modules")],
  plugins: [{ name: "no-css-artifacts", setup(build) { build.onLoad({ filter: /\.css$/ }, () => ({ contents: "", loader: "js" })); } }],
  logLevel: "silent",
});
let browser;
try {
  browser = await webkit.launch({ headless: true });
  const page = await browser.newPage();
  page.setDefaultTimeout(5000);
  const errors = [];
  page.on("pageerror", e => errors.push(e.message));
  const origin = "https://whatsapp-capability-fixture.invalid";
  await page.route("**/*", route => {
    const url = route.request().url();
    if (url === origin + "/") return route.fulfill({ contentType: "text/html", body: '<div id="root"></div><script src="/fixture.js"></script>' });
    if (url === origin + "/fixture.js") return route.fulfill({ contentType: "text/javascript", body: bundle.outputFiles[0].text });
    errors.push("Unexpected fixture request");
    return route.abort();
  });
  await page.goto(origin);
  await page.waitForFunction(() => window.fixture?.healthCalls === 1);
  assert.equal(await page.getByRole("button", { name: "Send message" }).count(), 0, "initial unknown cannot authorize sending");
  await page.evaluate(() => window.fixture.ready());
  await page.getByRole("button").filter({ hasText: "Fixture Pinned" }).click();
  const draft = page.getByRole("textbox", { name: "Message", exact: true });
  await draft.waitFor();
  await page.waitForFunction(() => !document.querySelector('textarea').disabled);
  assert.equal(await draft.isEnabled(), true, "gateway-only capability still permits private drafting");
  const send = page.getByRole("button", { name: "Send message" });
  assert.equal(await send.isDisabled(), true, "older gateway-only payload cannot authorize sending");
  assert.match(await page.locator(".wa-compose-bar").innerText(), /Gateway sending is off/);
  await draft.fill("synthetic retained draft");
  const readDraft = () => page.evaluate(() => JSON.parse(localStorage.getItem("ab:whatsapp:draft:fixture:fixture-pinned")));
  const initialDraft = await readDraft();
  assert.equal(initialDraft.text, "synthetic retained draft");
  assert.match(initialDraft.requestId, /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i);
  const settle = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  async function refresh(mode) {
    const count = await page.evaluate(() => window.fixture.healthCalls);
    await page.evaluate(mode => window.fixture.refresh(mode), mode);
    await page.waitForFunction(count => window.fixture.healthCalls > count, count);
    await settle();
  }
  const denied = [
    { sendEnabled: true }, { sendEnabled: true, appSendEnabled: false },
    { sendEnabled: false, appSendEnabled: true }, { appSendEnabled: true },
    { sendEnabled: "true", appSendEnabled: true }, { sendEnabled: true, appSendEnabled: "true" },
    { sendEnabled: null, appSendEnabled: true }, { malformed: true }, { error: true },
  ];
  for (const mode of denied) {
    await refresh({ sendEnabled: true, appSendEnabled: true });
    await refresh(mode);
    assert.equal(await draft.isEnabled(), true, "disabled delivery must not disable private drafting");
    assert.equal(await send.isDisabled(), true);
    assert.deepEqual(await readDraft(), initialDraft);
    await page.locator(".wa-compose-box").evaluate(form => { for (let i = 0; i < 3; i++) form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
  }
  assert.equal(await page.evaluate(() => window.fixture.sends), 0);

  // Enable only this in-memory injected client to exercise the existing generic composer.
  await refresh({ sendEnabled: true, appSendEnabled: true });
  assert.equal(await draft.isEnabled(), true);
  await draft.fill("synthetic retained draft");
  await refresh({ error: true });
  assert.equal(await draft.isEnabled(), true, "failed refresh retains editable draft");
  assert.equal(await send.isDisabled(), true, "failed refresh revokes earlier enabled capability");
  assert.equal(await draft.inputValue(), "synthetic retained draft");
  await page.locator(".wa-compose-box").dispatchEvent("submit");
  assert.equal(await page.evaluate(() => window.fixture.sends), 0);
  await refresh({ sendEnabled: true, appSendEnabled: true });

  // Invoke the same actual React handler twice before React commits state, the source race under test.
  await page.locator(".wa-compose-box").evaluate(form => {
    const props = form[Object.keys(form).find(k => k.startsWith("__reactProps$"))];
    props.onSubmit({ preventDefault() {} });
    props.onSubmit({ preventDefault() {} });
  });
  assert.equal(await page.evaluate(() => window.fixture.sends), 1, "synchronous duplicate must be refused");
  const firstSend = await page.evaluate(() => window.fixture.sendRecords[0]);
  assert.equal(firstSend.jid, "fixture-pinned");
  assert.equal(firstSend.text, "synthetic retained draft");
  assert.equal(firstSend.stored.requestId, firstSend.requestId);
  assert.equal(firstSend.stored.uncertain, true, "uncertainty is persisted before IO");
  await page.evaluate(() => window.fixture.reject(429));
  await page.getByRole("alert").filter({ hasText: "Synthetic 429" }).waitFor();
  assert.equal(await draft.inputValue(), "synthetic retained draft");
  const retryDraft = await readDraft();
  assert.notEqual(retryDraft.requestId, firstSend.requestId, "known rejection needs a new explicit request ID");
  assert.equal(retryDraft.uncertain, false);
  await send.click();
  assert.equal((await page.evaluate(() => window.fixture.sendRecords[1])).requestId, retryDraft.requestId);
  await page.evaluate(() => window.fixture.reject(500));
  await page.getByRole("alert").filter({ hasText: "Delivery is uncertain" }).waitFor();
  assert.equal(await draft.inputValue(), "synthetic retained draft");
  assert.deepEqual(await readDraft(), { ...retryDraft, uncertain: true });
  assert.equal(await send.isDisabled(), true, "unknown outcome must not allow a blind retry");
  await page.locator(".wa-compose-box").dispatchEvent("submit");
  assert.equal(await page.evaluate(() => window.fixture.sends), 2);

  // Changing chats remounts the actual composer; each private draft keeps its own request ID.
  await page.getByRole("button").filter({ hasText: "Fixture Recent" }).click();
  await page.getByRole("heading", { name: "Fixture Recent" }).waitFor();
  await draft.fill("another synthetic chat draft");
  await page.getByRole("button").filter({ hasText: "Fixture Pinned" }).click();
  await page.getByRole("heading", { name: "Fixture Pinned" }).waitFor();
  await page.waitForFunction(() => document.querySelector("textarea").value === "synthetic retained draft");
  assert.equal((await readDraft()).requestId, retryDraft.requestId);
  assert.equal((await readDraft()).uncertain, true);
  assert.equal(await send.isDisabled(), true, "remount preserves uncertain-send protection");

  await draft.fill("synthetic newly composed message");
  const freshDraft = await readDraft();
  assert.notEqual(freshDraft.requestId, retryDraft.requestId);
  assert.equal(freshDraft.uncertain, undefined);
  await send.click();
  assert.equal((await page.evaluate(() => window.fixture.sendRecords[2])).requestId, freshDraft.requestId);
  await page.evaluate(() => window.fixture.resolve());
  await page.waitForFunction(() => document.querySelector("textarea").value === "");
  assert.equal((await readDraft()).text, "");
  assert.notEqual((await readDraft()).requestId, freshDraft.requestId);
  await page.getByRole("status").filter({ hasText: "Accepted by WhatsApp gateway" }).waitFor();

  // Sidebar behavior still runs through the actual component with synthetic chats only.
  assert.deepEqual(await page.locator(".wa-row .wa-name").allTextContents(), ["Fixture Pinned", "Fixture Recent", "Fixture Group"]);
  await page.getByRole("button", { name: "Groups", exact: true }).click();
  assert.deepEqual(await page.locator(".wa-row .wa-name").allTextContents(), ["Fixture Group"]);
  assert.equal(await page.getByRole("heading", { name: "Fixture Pinned" }).count(), 1, "filter preserves selection");
  await page.getByRole("button", { name: "All chats", exact: true }).click();
  await page.getByRole("searchbox").fill("Fixture Recent");
  await page.waitForFunction(() => document.querySelectorAll(".wa-row").length === 1);
  await page.getByRole("button").filter({ hasText: "Fixture Recent" }).click();
  await page.getByRole("heading", { name: "Fixture Recent" }).waitFor();

  assert.equal(await draft.inputValue(), "another synthetic chat draft", "navigation restores the other chat draft");
  const apiRequest = await page.evaluate(async () => {
    const original = window.fetch;
    let captured;
    window.fetch = async (url, init) => {
      captured = { url, method: init.method, headers: init.headers, body: JSON.parse(init.body) };
      return new Response(JSON.stringify({ accepted: true, id: "synthetic-accepted" }), { headers: { "content-type": "application/json" } });
    };
    try { await window.fixture.apiClient.send("fixture@s.whatsapp.net", "synthetic API draft", "f8d0eae4-11a9-47b4-a651-6e1ceeaac6bb"); }
    finally { window.fetch = original; }
    return captured;
  });
  assert.deepEqual(apiRequest, {
    url: "/api/whatsapp/chats/fixture%40s.whatsapp.net/send", method: "POST", headers: { "content-type": "application/json" },
    body: { text: "synthetic API draft", requestId: "f8d0eae4-11a9-47b4-a651-6e1ceeaac6bb", explicit: true },
  });
  assert.equal(await page.evaluate(() => window.fixture.requests), 0);
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ ok: true, deniedCapabilityCases: denied.length, networkRequests: 0, mockedApiSends: 1, syntheticComponentSends: 3, duplicateInFlight: "refused", uncertainRetry: "refused across remount", draftRetention: ["disabled capability", "health refresh failure", "synthetic 429", "synthetic 500", "chat navigation"], requestIds: "persisted before IO; new on known rejection and new composition; unchanged on uncertainty", actualRateLimitsExercised: false, liveProof: false }));
} finally {
  await browser?.close();
}
