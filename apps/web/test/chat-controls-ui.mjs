// Real ChatView, synthetic history and uploads. No live host, provider, or websocket connection.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdir, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const repo = path.resolve(import.meta.dirname, "../../..");
const scratch = path.join(repo, "apps/web/.lab-chat-controls");
await mkdir(scratch, { recursive: true });
const { createServer } = createRequire(path.join(repo, "apps/web/package.json"))("vite");
const { webkit } = createRequire(path.join(repo, "services/node/package.json"))("playwright");
const entry = path.join(scratch, "entry.tsx");
const localFile = (file) => JSON.stringify(pathToFileURL(path.join(repo, file)).href);
// Use the production stylesheet (pnpm check builds first), including its reset.
const styles = (await readdir(path.join(repo, "apps/web/dist/assets"))).filter(file => file.endsWith(".css"));
assert.ok(styles.length, "Build apps/web before running the rendered chat check");
await writeFile(entry, `
import React, { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import { ChatView } from ${localFile("apps/web/src/components/ChatView.tsx")};
import ${localFile("packages/siso-tokens/siso.css")};
import ${localFile("packages/siso-tokens/tokens.css")};
import ${localFile("packages/siso-shell/shell.css")};
class FakeWebSocket {
  static OPEN = 1;
  readyState = 1;
  constructor() { window.socket = this; setTimeout(() => this.onopen?.(), 0); }
  send(raw) { (window.sent ??= []).push(JSON.parse(raw)); }
  close() { this.readyState = 3; }
  emit(event) { this.onmessage?.({ data: JSON.stringify(event) }); }
}
window.WebSocket = FakeWebSocket;
Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async text => {
  if (window.failClipboard) throw new Error("Clipboard denied");
  window.copied = text;
} } });
function Fixture() {
  const [agent, setAgent] = useState({ id: "fixture:1", key: "ASTRA" });
  const [terminal, setTerminal] = useState(false);
  window.chooseAgent = (id, key) => setAgent({ id, key });
  window.setTerminalView = setTerminal;
  // Simulate the same ChatView unmount/remount as App's per-agent Terminal mode without attaching a terminal.
  if (terminal) return <div data-testid="terminal-fixture">Synthetic terminal surface</div>;
  return <ChatView key={agent.id} agentId={agent.id} agentKey={agent.key} agentName={agent.key} active />;
}
createRoot(document.getElementById("root")).render(<StrictMode><Fixture /></StrictMode>);
`);

let server, browser, page;
const errors = [];
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j4AAAAABJRU5ErkJggg==", "base64");
try {
  server = await createServer({ configFile: false, root: path.join(repo, "apps/web"), cacheDir: path.join(scratch, "vite-cache"), esbuild: { jsx: "automatic" }, resolve: { dedupe: ["react", "react-dom"] }, optimizeDeps: { entries: [entry] }, server: { host: "127.0.0.1", port: 0, watch: null, fs: { allow: [repo] } } });
  await new Promise((resolve, reject) => { server.httpServer.once("error", reject); server.httpServer.listen(0, "127.0.0.1", resolve); });
  const base = `http://127.0.0.1:${server.httpServer.address().port}`;
  browser = await webkit.launch({ headless: true });
  page = await browser.newPage({ viewport: { width: 1024, height: 900 } });
  page.setDefaultTimeout(7_000);
  // Cold Vite dependency optimization can outlast the interaction budget under shared load.
  page.setDefaultNavigationTimeout(30_000);
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/*", route => new URL(route.request().url()).origin === base ? route.fallback() : route.abort());
  await page.route(`${base}/api/**`, route => route.fulfill({ json: {} }));
  await page.route(`${base}/api/uploads`, route => route.fulfill({ json: { name: "fixture.png", path: "/fixture/fixture.png" } }));
  await page.route(`${base}/api/uploads/fixture.png`, route => route.fulfill({ contentType: "image/png", body: png }));
  await page.route(`${base}/`, route => route.fulfill({ contentType: "text/html", body: `${styles.map(file => `<link rel="stylesheet" href="/@fs${path.join(repo, "apps/web/dist/assets", file)}">`).join("")}<style>body{margin:0;background:#121217}#root{height:100vh;max-width:800px;margin:auto}</style><div id="root"></div><script type="module" src="/@fs${entry}"></script>` }));
  // Cold Vite dependency compilation may outlast the interaction timeout on a shared machine.
  await page.goto(base, { timeout: 30_000 });
  await page.waitForFunction(() => window.socket, null, { timeout: 30_000 });
  const answer = "The change is ready.\n\n```js\nconst ready = true;\n```\n\nThe next paragraph stays in the copied reply.";
  const checkpoint = "Status report\n1. ✅ Parser: complete body inside a collapsed checkpoint.\n2. ⏳ Preview: remaining detail must also copy.";
  await page.evaluate(({ answer, checkpoint }) => window.socket.emit({ t: "hello", session: "fixture", state: "idle", partial: {}, thinking: {}, tasks: [], bg: [], log: [
    { t: "user", text: "private user prompt excluded", from: "me", at: 1 },
    { t: "text", id: "work", text: "Commentary excluded", at: 2 },
    { t: "tool", id: "tool", name: "Read", summary: "private tool content excluded", at: 3 },
    { t: "tool_done", id: "tool", ok: true, out: "private tool output excluded", at: 4 },
    { t: "text", id: "answer", text: answer, at: 5 }, { t: "result", ms: 1000, cost: null, at: 6 },
    { t: "user", text: "Status please", from: "me", at: 7 },
    { t: "text", id: "checkpoint", text: checkpoint, at: 8 }, { t: "result", ms: 1000, cost: null, at: 9 },
  ] }), { answer, checkpoint });
  const copyButtons = page.getByRole("button", { name: "Copy reply", exact: true });
  await copyButtons.first().waitFor();
  assert.equal(await copyButtons.count(), 2);
  await copyButtons.first().click();
  assert.equal(await page.evaluate(() => window.copied), answer, "copy includes the full answer and raw code, excluding work and user prompt");
  await copyButtons.last().click();
  assert.equal(await page.evaluate(() => window.copied), checkpoint, "copy includes collapsed checkpoint bodies");
  await page.evaluate(() => { window.failClipboard = true; });
  await copyButtons.last().click();
  await page.getByRole("status").filter({ hasText: "Text selected" }).waitFor();
  assert.match(await page.evaluate(() => window.getSelection().toString()), /complete body inside a collapsed checkpoint/);
  assert.equal(await page.locator(".siso-chat__reply details:not([open])").count(), 0);
  assert.equal(await copyButtons.last().textContent(), "Copy", "clipboard failure must not claim success");
  await page.getByRole("button", { name: "Select text", exact: true }).first().click();
  assert.match(await page.evaluate(() => window.getSelection().toString()), /const ready = true/);
  await page.screenshot({ path: path.join(scratch, "reply-copy-1024.png") });

  const composer = page.locator("textarea").first();
  await composer.fill("My current draft");
  await page.locator('input[type="file"]').setInputFiles({ name: "fixture.png", mimeType: "image/png", buffer: png });
  await page.getByRole("button", { name: "Remove fixture.png", exact: true }).waitFor();
  await page.getByRole("button", { name: "Prompt library", exact: true }).click();
  let library = page.getByRole("dialog", { name: "Prompt library" });
  await library.getByRole("button", { name: "Save current draft" }).click();
  await library.getByLabel("Name", { exact: true }).fill("Shared check");
  assert.equal(await library.getByLabel("Prompt", { exact: true }).inputValue(), "My current draft");
  await library.getByRole("button", { name: "Save prompt", exact: true }).click();
  await library.getByRole("button", { name: "Copy Shared check", exact: true }).click();
  assert.equal(await library.getByLabel("Prompt text for manual copy").inputValue(), "My current draft");
  const sentBefore = await page.evaluate(() => (window.sent ?? []).length);
  await library.getByRole("button", { name: "Use Shared check", exact: true }).click();
  assert.equal(await composer.inputValue(), "My current draft\n\nMy current draft");
  assert.equal(await page.getByRole("button", { name: "Remove fixture.png", exact: true }).count(), 1, "inserting keeps attachments");
  assert.equal(await page.evaluate(() => (window.sent ?? []).length), sentBefore, "inserting must not send to the agent");
  await page.waitForFunction(() => document.activeElement === document.querySelector(".siso-chat textarea"));

  await page.getByRole("button", { name: "Prompt library", exact: true }).click();
  await library.getByRole("button", { name: "This agent", exact: true }).click();
  await library.getByRole("button", { name: "Save current draft" }).click();
  await library.getByLabel("Name", { exact: true }).fill("Astra health");
  await library.getByRole("button", { name: "Save prompt", exact: true }).click();
  await library.getByRole("button", { name: "Archive Astra health", exact: true }).click();
  await library.getByRole("button", { name: "Archived", exact: true }).click();
  await library.getByRole("button", { name: "Restore", exact: true }).click();
  await library.getByRole("button", { name: "Back to library", exact: true }).click();
  await library.getByRole("button", { name: "Use Astra health", exact: true }).waitFor();
  await page.keyboard.press("Escape");
  assert.equal(await page.getByRole("button", { name: "Prompt library", exact: true }).evaluate(el => document.activeElement === el), true);

  // Returning from Terminal mode mounts the same production ChatView again: keep draft and attachments, send nothing.
  const draftBeforeRemount = await composer.inputValue();
  await page.waitForFunction(text => {
    const saved = JSON.parse(localStorage.getItem("agent-base:draft:fixture:1") ?? "null");
    return saved?.text === text && saved?.images?.length === 1;
  }, draftBeforeRemount);
  const sentBeforeRemount = await page.evaluate(() => (window.sent ?? []).length);
  for (let repeat = 0; repeat < 2; repeat++) {
    await page.evaluate(() => window.setTerminalView(true));
    await page.getByTestId("terminal-fixture").waitFor();
    assert.equal(await page.locator(".siso-chat").count(), 0, "terminal mode unmounts the real ChatView");
    await page.evaluate(() => window.setTerminalView(false));
    await page.locator('[data-agent-id="fixture:1"]').waitFor();
    assert.equal(await composer.inputValue(), draftBeforeRemount, "same-agent remount keeps the complete draft");
    assert.equal(await page.getByRole("button", { name: "Remove fixture.png", exact: true }).count(), 1, "same-agent remount keeps the attachment");
    assert.equal(await page.evaluate(() => (window.sent ?? []).length), sentBeforeRemount, "returning to chat must not send a frame");
  }

  // A new terminal id for the same stable agent retains its saved prompts.
  await page.evaluate(() => window.chooseAgent("fixture:2", "ASTRA"));
  await page.locator('[data-agent-id="fixture:2"]').waitFor();
  await page.getByRole("button", { name: "Prompt library", exact: true }).click();
  await library.getByRole("button", { name: "This agent", exact: true }).click();
  await library.getByRole("button", { name: "Use Astra health", exact: true }).waitFor();
  await page.evaluate(() => window.chooseAgent("fixture:3", "OTHER"));
  await page.locator('[data-agent-id="fixture:3"]').waitFor();
  await page.getByRole("button", { name: "Prompt library", exact: true }).click();
  await library.getByRole("button", { name: "This agent", exact: true }).click();
  assert.equal(await library.getByRole("button", { name: "Use Astra health", exact: true }).count(), 0);
  await library.getByRole("button", { name: "Shared", exact: true }).click();
  await library.getByRole("button", { name: "Use Shared check", exact: true }).waitFor();
  await page.reload();
  await page.getByRole("button", { name: "Prompt library", exact: true }).click();
  await library.getByRole("button", { name: "Use Shared check", exact: true }).waitFor();
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ ok: true, replyMarkdown: true, excludesPromptAndTools: true, collapsedCheckpoint: true, clipboardFallback: true, insertsWithoutSending: true, preservesDraftAndAttachment: true, draftAttachmentRemount: true, stableAgentScope: true, archiveRestore: true, reloadPersistence: true, focusReturn: true }));
} catch (error) {
  console.error(JSON.stringify({ errors, ui: await page?.locator("body").innerText() }));
  throw error;
} finally {
  await browser?.close();
  await server?.close();
}
