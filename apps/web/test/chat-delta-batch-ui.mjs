// Streaming delta batching fixture for the real ChatView component.
// StrictMode + Vite + headless WebKit; all WebSocket data is synthetic.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";

const repo = path.resolve(import.meta.dirname, "../../..");
const require = createRequire(path.join(repo, "apps/web/package.json"));
const { createServer } = require("vite");
const { webkit } = createRequire(path.join(repo, "services/node/package.json"))("playwright");
const scratch = await mkdtemp(path.join(tmpdir(), "ab-chat-delta-batch-ui-"));
const baseline = process.env.CHAT_DELTA_BASELINE === "1";
const historyBaseline = process.env.CHAT_PREPARE_BASELINE === "1";
const nativeFrame = process.env.CHAT_DELTA_NATIVE_RAF === "1";
const historyTurns = Number(process.env.CHAT_DELTA_HISTORY ?? 0);
const burstCount = Number(process.env.CHAT_DELTA_BURST ?? 1000);
const component = path.join(repo, "apps/web/src/components/ChatView.tsx");
const entry = path.join(scratch, "entry.tsx");
await writeFile(entry, `
import React, { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import { ChatView } from ${JSON.stringify(pathToFileURL(component).href)};
class FakeWebSocket {
  static OPEN = 1;
  readyState = 1;
  constructor() { window.socket = this; }
  send() {}
  close() { this.readyState = 3; }
  emit(event) { this.onmessage?.({ data: JSON.stringify(event) }); }
}
window.WebSocket = FakeWebSocket;
window.__rafCount = 0;
${nativeFrame ? "const nativeRaf = window.requestAnimationFrame.bind(window); const nativeCancel = window.cancelAnimationFrame.bind(window); window.requestAnimationFrame = (cb) => { window.__rafCount++; return nativeRaf(cb); }; window.cancelAnimationFrame = (id) => nativeCancel(id); window.flushRaf = () => {};" : "window.__rafCallbacks = new Map(); window.requestAnimationFrame = (cb) => { const id = ++window.__rafCount; window.__rafCallbacks.set(id, cb); return id; }; window.cancelAnimationFrame = (id) => window.__rafCallbacks.delete(id); window.flushRaf = () => { const callbacks = [...window.__rafCallbacks.values()]; window.__rafCallbacks.clear(); callbacks.forEach((cb) => cb(performance.now())); };"}
let root;
function Fixture() {
  const [shown, setShown] = useState(true);
  window.hideChat = () => setShown(false);
  return shown ? <ChatView agentId="fixture" active /> : <p data-testid="gone">gone</p>;
}
root = createRoot(document.getElementById("root"));
root.render(<StrictMode><Fixture /></StrictMode>);
`);

let server;
let browser;
try {
  server = await createServer({
    configFile: false,
    root: path.join(repo, "apps/web"),
    plugins: [{ name: "baseline-chat", enforce: "pre", load(id) {
      if ((baseline || historyBaseline) && id.split("?")[0] === component) return execFileSync("git", ["show", `${historyBaseline ? "90c41fd" : "ad99fd8"}:apps/web/src/components/ChatView.tsx`], { encoding: "utf8" });
    } }, { name: "count-build-chat", transform(code, id) {
      if (!id.split("?")[0].endsWith("/src/lib/chat.ts")) return;
      const target = code.includes("export function projectChat(") ? "projectChat" : "buildChat";
      assert.ok(code.includes(`export function ${target}(`), "actual chat derivation seam exists");
      let original = code.replace(`export function ${target}(`, `function ${target}Original(`);
      const hasPreparation = code.includes("export function prepareChat(");
      if (hasPreparation) original = original.replace("export function prepareChat(", "function prepareChatOriginal(");
      const preparation = hasPreparation ? `export function prepareChat(events) { if (typeof window !== 'undefined') window.__prepareChatCalls = (window.__prepareChatCalls ?? 0) + 1; return prepareChatOriginal(events); }` : "";
      return `if (typeof window !== 'undefined') { window.__chatInstrumentation = true; window.__chatDerivationSeam = '${target}'; }\n${original}\n${preparation}\nexport function ${target}(base, partial, working, thinking = {}) { if (typeof window !== 'undefined') window.__buildChatCalls = (window.__buildChatCalls ?? 0) + 1; return ${target}Original(base, partial, working, thinking); }`;
    } }],
    server: { host: "127.0.0.1", port: 0, watch: null, fs: { allow: [repo, scratch] } },
  });
  await new Promise((resolve, reject) => { server.httpServer.once("error", reject); server.httpServer.listen(0, "127.0.0.1", resolve); });
  const port = server.httpServer.address().port;
  browser = await webkit.launch({ headless: true });
  const page = await browser.newPage();
  page.setDefaultTimeout(5_000);
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/*", (route) => new URL(route.request().url()).origin === `http://127.0.0.1:${port}` ? route.fallback() : route.abort());
  await page.route(`http://127.0.0.1:${port}/`, (route) => route.fulfill({ contentType: "text/html", body: `<div id="root"></div><script type="module" src="/@fs${entry}"></script>` }));
  await page.goto(`http://127.0.0.1:${port}/`);
  await page.waitForFunction(() => window.socket);
  await page.evaluate(({ historyTurns }) => {
    const log = [{ t: "user", id: "u1", text: "go", from: "me", at: 1 }, { t: "text", id: "a1", text: "history seed", at: 2 }];
    for (let i = 0; i < historyTurns; i++) log.push({ t: "user", id: `hu${i}`, text: `history ${i}`, from: "me", at: i * 3 + 10 }, { t: "text", id: `ha${i}`, text: `answer ${i}`, at: i * 3 + 11 });
    window.socket.emit({ t: "hello", session: "s1", state: "working", log, partial: {}, thinking: {}, tasks: [], bg: [] });
  }, { historyTurns });
  if (historyTurns < 60) await page.getByText("go", { exact: true }).waitFor();
  else await page.getByText(`answer ${historyTurns - 1}`, { exact: true }).waitFor();
  assert.equal(await page.evaluate(() => window.__chatInstrumentation), true, "buildChat instrumentation must hit the actual module");
  await page.evaluate(() => { window.__buildChatCalls = 0; window.__prepareChatCalls = 0; window.__rafCount = 0; });

  const burst = "x".repeat(burstCount);
  const burstStarted = performance.now();
  await page.evaluate(async ({ burst, burstCount }) => { for (let i = 0; i < burstCount; i++) { window.socket.emit({ t: "delta", id: "live", text: burst[i] }); await new Promise((resolve) => setTimeout(resolve, 0)); } }, { burst, burstCount });
  const burstElapsedMs = Number((performance.now() - burstStarted).toFixed(2));
  if (baseline) {
    const baselineBuilds = await page.evaluate(() => window.__buildChatCalls ?? 0);
    assert.ok(baselineBuilds > 2, "separate transport tasks must exercise repeated baseline rebuilds");
    await page.getByText(burst, { exact: true }).waitFor();
    console.log(JSON.stringify({ ok: true, baseline: true, nativeFrame, historyTurns, burst: burstCount, baselineBuilds, burstElapsedMs }));
  } else {
    if (!nativeFrame) {
      assert.equal(await page.evaluate(() => window.__rafCount ?? 0), 1, "a burst should schedule one animation frame");
      assert.equal(await page.evaluate(() => window.__buildChatCalls ?? 0), 0, "held RAF should defer all live rebuilds");
      await page.evaluate(() => window.flushRaf());
    }
    await page.getByText(burst, { exact: true }).waitFor();
    const prototypeBuilds = await page.evaluate(() => window.__buildChatCalls ?? 0);
    assert.ok(prototypeBuilds > 0, "the held frame must invoke the actual live derivation");
    const streamPreparations = await page.evaluate(() => window.__prepareChatCalls ?? 0);
    if (historyBaseline) assert.ok(streamPreparations > 0, "pinned ChatView reparses history on live updates");
    else assert.equal(streamPreparations, 0, "pure deltas reuse the event-derived history base");
    await page.evaluate(() => window.socket.emit({ t: "text", id: "live", text: "final answer", at: 2 }));
    await page.getByText("final answer", { exact: true }).waitFor();
    assert.equal(await page.getByText(burst, { exact: true }).count(), 0, "completion must replace the live partial");

    await page.evaluate(() => {
      window.socket.emit({ t: "delta", id: "early", text: "pending before completion" });
      window.socket.emit({ t: "text", id: "early", text: "completion before frame", at: 3 });
      window.flushRaf();
    });
    await page.getByText("completion before frame", { exact: true }).waitFor();
    assert.equal(await page.getByText("pending before completion", { exact: true }).count(), 0);

    await page.evaluate(() => window.socket.emit({ t: "delta", id: "old", text: "discard me" }));
    await page.evaluate(() => window.socket.emit({ t: "hello", session: "s2", replaced: true, state: "idle", log: [{ t: "user", id: "u2", text: "replacement", from: "me", at: 3 }], partial: {}, thinking: {}, tasks: [], bg: [] }));
    await page.getByText("replacement", { exact: true }).waitFor();
    assert.equal(await page.getByText("discard me", { exact: true }).count(), 0, "replacement hello must discard pending old deltas");

    await page.evaluate(() => window.socket.emit({ t: "state", state: "working" }));
    await page.evaluate(() => window.socket.emit({ t: "tdelta", id: "think", text: "thought" }));
    await page.evaluate(() => window.flushRaf());
    await page.getByText("thought", { exact: true }).waitFor();
    await page.evaluate(() => window.socket.emit({ t: "text", id: "done", text: "done", at: 4 }));
    await page.getByText("done", { exact: true }).waitFor();
    await page.evaluate(() => window.socket.emit({ t: "delta", id: "late", text: "should disappear" }));
    await page.evaluate(() => window.hideChat());
    await page.getByTestId("gone").waitFor();
    const framesBeforeLateEvent = await page.evaluate(() => window.__rafCount);
    await page.evaluate(() => {
      window.socket.emit({ t: "delta", id: "after-unmount", text: "late socket callback" });
      window.flushRaf();
    });
    assert.equal(await page.evaluate(() => window.__rafCount), framesBeforeLateEvent);
    if (!nativeFrame) assert.equal(await page.evaluate(() => window.__rafCallbacks.size), 0);
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ ok: true, nativeFrame, historyBaseline, historyTurns, burst: burstCount, oneFrame: !nativeFrame, prototypeBuilds, streamPreparations, thinking: true, completionFlush: true, replacementDiscard: true, unmountCleanup: true, burstElapsedMs }));
  }
} finally {
  await browser?.close();
  await server?.close();
  await rm(scratch, { recursive: true, force: true });
}
