// Actual ChatView regression with a fake WebSocket. No node host, SDK, account, or network data.
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
const baseline = process.env.CHAT_TAKEBACK_BASELINE === "1";
const scratch = await mkdtemp(path.join(tmpdir(), "ab-chat-takeback-ui-"));
const component = path.join(repo, "apps/web/src/components/ChatView.tsx");
const entry = path.join(scratch, "entry.tsx");
await writeFile(entry, `
import React, { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ChatView } from ${JSON.stringify(pathToFileURL(component).href)};
class FakeWebSocket {
  static OPEN = 1;
  readyState = 1;
  constructor() { window.socketGeneration = (window.socketGeneration ?? 0) + 1; window.socket = this; setTimeout(() => this.onopen?.(), 0); }
  send(raw) { (window.sent ??= []).push(JSON.parse(raw)); }
  close() { this.readyState = 3; this.onclose?.(); }
  emit(event) { this.onmessage?.({ data: JSON.stringify(event) }); }
}
window.WebSocket = FakeWebSocket;
createRoot(document.getElementById("root")).render(<StrictMode><ChatView agentId="fixture" active /></StrictMode>);
`);
let server;
let browser;
try {
  server = await createServer({
    configFile: false,
    root: path.join(repo, "apps/web"),
    plugins: baseline ? [{ name: "chat-takeback-baseline", enforce: "pre", load(id) {
      if (id.split("?")[0] !== component) return null;
      return execFileSync("git", ["show", "5d6499e:apps/web/src/components/ChatView.tsx"], { encoding: "utf8" });
    } }] : [],
    server: { host: "127.0.0.1", port: 0, fs: { allow: [repo, scratch] } },
  });
  await new Promise((resolve, reject) => {
    server.httpServer.once("error", reject);
    server.httpServer.listen(0, "127.0.0.1", resolve);
  });
  const port = server.httpServer.address().port;
  browser = await webkit.launch({ headless: true });
  const page = await browser.newPage();
  page.setDefaultTimeout(5_000);
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.route("**/*", (route) => new URL(route.request().url()).origin === `http://127.0.0.1:${port}` ? route.fallback() : route.abort());
  await page.route(`http://127.0.0.1:${port}/`, (route) => route.fulfill({ contentType: "text/html", body: `<div id="root"></div><script type="module" src="/@fs${entry}"></script>` }));
  await page.goto(`http://127.0.0.1:${port}/`);
  await page.waitForFunction(() => window.socket && window.socketGeneration >= 1);
  await page.evaluate(() => window.socket.emit({ t: "hello", session: "fixture", state: "working", log: [{ t: "queued", id: "m1", text: "queued one", at: 1 }], partial: {}, thinking: {}, tasks: [], bg: [] }));
  await page.getByTestId("queued-row").waitFor();
  await page.getByRole("button", { name: "Take back" }).click();
  await page.getByRole("button", { name: "Take back" }).click();
  assert.equal(await page.locator("textarea").inputValue(), "");
  assert.equal(await page.evaluate(() => window.sent.filter((m) => m.t === "unqueue" && m.id === "m1").length), 1);
  await page.evaluate(() => window.socket.emit({ t: "unqueue_failed", id: "m1", text: "Could not confirm removal; the message may still be sent." }));
  assert.equal(await page.getByTestId("queued-row").filter({ hasText: "queued one" }).count(), 1);
  assert.equal(await page.locator("textarea").inputValue(), "");
  await page.evaluate(() => window.socket.emit({ t: "queued", id: "m2", text: "queued two", at: 2 }));
  await page.getByTestId("queued-row").last().waitFor();
  await page.getByRole("button", { name: "Take back" }).last().click();
  await page.evaluate(() => window.socket.emit({ t: "unqueued", id: "m2" }));
  await page.waitForFunction(() => document.querySelector("textarea")?.value === "queued two");
  await page.evaluate(() => window.socket.emit({ t: "queued", id: "m3", text: "queued three", at: 3 }));
  await page.getByTestId("queued-row").last().waitFor();
  await page.locator("textarea").fill("already typed");
  await page.getByRole("button", { name: "Take back" }).last().click();
  await page.evaluate(() => window.socket.emit({ t: "unqueued", id: "m3" }));
  await page.waitForTimeout(20);
  assert.equal(await page.locator("textarea").inputValue(), "already typed");
  await page.locator("textarea").fill("");
  await page.evaluate(() => window.socket.emit({ t: "queued", id: "m4", text: "queued four", at: 4 }));
  await page.getByTestId("queued-row").last().waitFor();
  const generation = await page.evaluate(() => window.socketGeneration);
  await page.getByRole("button", { name: "Take back" }).last().click();
  assert.equal(await page.locator("textarea").inputValue(), "");
  await page.evaluate(() => window.socket.close());
  assert.equal(await page.getByTestId("queued-row").filter({ hasText: "queued four" }).count(), 1);
  assert.equal(await page.locator("textarea").inputValue(), "");
  assert.match(await page.getByRole("status").last().textContent(), /Could not confirm removal; the message may still be sent\./i);
  await page.waitForFunction((before) => window.socketGeneration > before, generation);
  await page.evaluate(() => window.socket.emit({ t: "hello", session: "fixture", state: "working", log: [{ t: "queued", id: "m4", text: "queued four", at: 4 }], partial: {}, thinking: {}, tasks: [], bg: [] }));
  await page.getByTestId("queued-row").waitFor();
  await page.getByRole("button", { name: "Take back" }).click();
  assert.equal(await page.evaluate(() => window.sent.filter((m) => m.t === "unqueue" && m.id === "m4").length), 2);
  assert.deepEqual(pageErrors, []);
  console.log(JSON.stringify({ ok: true, immediateCopy: false, duplicateSuppressed: true, failedStillQueued: true, successCopy: true, preservesNonemptyDraft: true, disconnectRetry: true }));
} catch (error) {
  if (!baseline) throw error;
  console.log(JSON.stringify({ ok: false, regressionObserved: true, baseline: true, error: error.message }));
} finally {
  await browser?.close();
  await server?.close();
  await rm(scratch, { recursive: true, force: true });
}
