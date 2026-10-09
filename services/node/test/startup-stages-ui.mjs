// Actual-App startup-stage fixture. Synthetic fetch/WebSocket/EventSource only;
// no node service, herdr session, profile data, or native process is used.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";

const repo = path.resolve(import.meta.dirname, "../../..");
const require = createRequire(path.join(repo, "apps/web/package.json"));
const { createServer } = require("vite");
const { webkit } = createRequire(path.join(repo, "services/node/package.json"))("playwright");
const scratch = await mkdtemp(path.join(tmpdir(), "ab-startup-stages-ui-"));
const entry = path.join(scratch, "entry.tsx");
const app = path.join(repo, "apps/web/src/App.tsx");
const sidebar = path.join(repo, "apps/web/src/components/Sidebar.tsx");
const sidebarBaseline = process.env.STARTUP_SIDEBAR_BASELINE === "1" ? execFileSync("git", ["show", "3dc9621:apps/web/src/components/Sidebar.tsx"], { encoding: "utf8" }) : null;
const agentCount = Number(process.env.STARTUP_AGENT_COUNT ?? 1);
const agent = { id: "fixture-agent", key: "laptop/fixture-agent", pane: "fixture:pane", name: "FIXTURE", title: "", status: "idle", since: Date.now(), row: "live", snoozedUntil: null, settledAt: null, seenAt: null, order: 0, tool: "claude", cwd: "/synthetic", folder: "synthetic", machine: "fixture", machineKey: "fixture", session: "fixture-session", lastEvent: null, context: null, hud: null, zero: false, host: true, chat: true, project: "Fixture", owner: null, kind: "owner", domain: null, lead: null, role: null, pinned: false, pages: [] };
const agents = Array.from({ length: Math.max(0, agentCount) }, (_, i) => i === 0 ? agent : { ...agent, id: `fixture-agent-${i}`, key: `laptop/fixture-agent-${i}`, name: `FIXTURE-${i}`, pane: `fixture:pane-${i}`, order: i });
await writeFile(entry, `
import React from "react";
import { createRoot } from "react-dom/client";
import { App } from ${JSON.stringify(app)};
globalThis.React = React;
const agent = ${JSON.stringify(agent)};
const agents = ${JSON.stringify(agents)};
const marks = window.__startupMarks = {};
marks.entryStart = performance.now();
// Observe DOM availability in the browser, before Playwright counts/assertions add work.
const observeReady = () => {
  if (document.querySelector(".siso-app")) marks.shellAt ??= performance.now();
  if (document.querySelector('[data-testid="rail-row"][data-item="fixture-agent"]')) marks.railAt ??= performance.now();
  if (document.querySelector('[data-testid="chat-view"]')?.textContent.includes("fixture chat ready")) marks.chatAt ??= performance.now();
  if (!agents.length && marks.agentsResolved !== undefined && document.querySelector(".ab-pick-empty")) marks.emptyAt ??= performance.now();
  if (marks.chatAt !== undefined || marks.emptyAt !== undefined) readyObserver.disconnect();
};
const readyObserver = new MutationObserver(observeReady);
readyObserver.observe(document.getElementById("root"), { childList: true, subtree: true, characterData: true });
const realFetch = window.fetch.bind(window);
window.fetch = (input, init) => {
  const url = String(input);
  if (url === "/api/agents") {
    marks.agentsFetchStart ??= performance.now();
    return new Promise((resolve) => setTimeout(() => { marks.agentsResolved ??= performance.now(); resolve(new Response(JSON.stringify({ agents, domains: ["Fixture"], pinnedPages: [], pinned: [], recentPages: [], at: Date.now() }), { status: 200, headers: { "content-type": "application/json" } })); }, 150));
  }
  if (url.startsWith("/api/agents/") || url === "/api/ended") return Promise.resolve(new Response(JSON.stringify(url === "/api/ended" ? { ended: [] } : {}), { status: 200, headers: { "content-type": "application/json" } }));
  if (url === "/api/org" || url === "/api/hub/org") return Promise.resolve(new Response(JSON.stringify({ groups: [], top: [], bottom: [], zero: null }), { status: 200, headers: { "content-type": "application/json" } }));
  if (url === "/api/hub/agents") return Promise.resolve(new Response(JSON.stringify({ agents: [] }), { status: 200, headers: { "content-type": "application/json" } }));
  if (url === "/api/a0/tasks") return Promise.resolve(new Response(JSON.stringify({ tasks: [], counts: {} }), { status: 200, headers: { "content-type": "application/json" } }));
  if (url === "/api/browser/state") return Promise.resolve(new Response(JSON.stringify({ migratedAt: Date.now() }), { status: 200, headers: { "content-type": "application/json" } }));
  if (url.startsWith("/api/servers")) return Promise.resolve(new Response(JSON.stringify({ servers: [] }), { status: 200, headers: { "content-type": "application/json" } }));
  if (url.startsWith("/api/")) return Promise.resolve(new Response("{}", { status: 200, headers: { "content-type": "application/json" } }));
  return realFetch(input, init);
};
class FakeWebSocket {
  static OPEN = 1; readyState = 1;
  constructor() { window.socket = this; setTimeout(() => { marks.chatSocket = performance.now(); this.onopen?.(); }, 0); setTimeout(() => { marks.chatHello = performance.now(); this.onmessage?.({ data: JSON.stringify({ t: "hello", session: "fixture-session", state: "idle", log: [{ t: "user", id: "u", text: "fixture chat ready", from: "me", at: 1 }, { t: "text", id: "a", text: "fixture chat ready", at: 2 }], partial: {}, thinking: {}, tasks: [], bg: [] }) }); }, 100); }
  send() {}
  close() { this.readyState = 3; }
}
window.WebSocket = FakeWebSocket;
class FakeEventSource { addEventListener() {} close() {} }
window.EventSource = FakeEventSource;
localStorage.setItem("agent-base:active-key", JSON.stringify("laptop/fixture-agent"));
localStorage.setItem("agent-base:active", JSON.stringify("fixture-agent"));
localStorage.setItem("agent-base:open", JSON.stringify(["fixture-agent"]));
location.hash = "#at=" + encodeURIComponent(JSON.stringify({ s: "agents", v: { kind: "chat" }, a: "fixture-agent", o: null }));
createRoot(document.getElementById("root")).render(<App />);
`);

let server;
let browser;
try {
  server = await createServer({ configFile: false, resolve: { alias: ["react/jsx-dev-runtime", "react/jsx-runtime", "react-dom/client", "react"].map((name) => ({ find: name, replacement: require.resolve(name) })) }, esbuild: { jsx: "automatic" }, optimizeDeps: { entries: [entry] }, root: path.join(repo, "apps/web"), plugins: sidebarBaseline ? [{ name: "startup-sidebar-baseline", load(id) { return id === sidebar ? sidebarBaseline : null; } }] : [], server: { host: "127.0.0.1", port: 0, watch: null, fs: { allow: [repo, scratch] } } });
  await new Promise((resolve, reject) => { server.httpServer.once("error", reject); server.httpServer.listen(0, "127.0.0.1", resolve); });
  const port = server.httpServer.address().port;
  browser = await webkit.launch({ headless: true });
  const page = await browser.newPage();
  page.setDefaultTimeout(10_000);
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/*", (route) => new URL(route.request().url()).origin === `http://127.0.0.1:${port}` ? route.fallback() : route.abort());
  await page.route(`http://127.0.0.1:${port}/`, (route) => route.fulfill({ contentType: "text/html", body: `<div id="root"></div><script type="module" src="/@fs${entry}"></script>` }));
  await page.goto(`http://127.0.0.1:${port}/`);
  try { await page.locator(".siso-app").waitFor(); } catch (error) { console.log("shell-debug", JSON.stringify({ text: await page.locator("body").innerText(), errors, marks: await page.evaluate(() => window.__startupMarks) })); throw error; }
  if (agentCount > 0) {
    try { await page.locator('[data-testid="rail-row"][data-item="fixture-agent"]').first().waitFor(); } catch (error) { console.log("startup-debug", JSON.stringify({ text: await page.locator("body").innerText(), errors, marks: await page.evaluate(() => window.__startupMarks) })); throw error; }
    const railRows = await page.locator('[data-testid="rail-row"][data-item^="fixture-agent"]').count();
    assert.equal(railRows, sidebarBaseline ? agentCount * 2 : agentCount, "rail row count matches sidebar source variant");
    assert.doesNotMatch(await page.locator("body").innerText(), /No live agents\./, "nonempty stray agents are not an empty state");
    try { await page.locator('[data-testid="chat-view"]').waitFor({ state: "attached" }); } catch (error) { console.log("active-debug", JSON.stringify({ text: await page.locator("body").innerText(), errors, marks: await page.evaluate(() => window.__startupMarks) })); throw error; }
    try { await page.getByText("fixture chat ready", { exact: true }).first().waitFor(); } catch (error) { console.log("chat-debug", JSON.stringify({ text: await page.locator("body").innerText(), errors, marks: await page.evaluate(() => window.__startupMarks) })); throw error; }
  } else {
    await page.waitForFunction(() => window.__startupMarks.agentsResolved > 0);
    await page.getByText("Pick an agent on the left.", { exact: true }).waitFor();
  }
  const marks = await page.evaluate(() => window.__startupMarks);
  assert.ok(marks.agentsFetchStart, "agents fetch must start");
  assert.ok(marks.agentsResolved >= marks.agentsFetchStart, "agents response must resolve after it starts");
  assert.ok(marks.shellAt < marks.agentsResolved, "shell is observable before delayed agent response");
  if (agentCount > 0) {
    assert.ok(typeof marks.railAt === "number" && typeof marks.chatAt === "number", "browser DOM readiness marks must be recorded");
    assert.ok(marks.chatSocket >= marks.agentsResolved, "chat socket follows agent hydration");
    assert.ok(marks.chatHello >= marks.chatSocket, "chat hello follows socket creation");
  }
  if (agentCount === 0) assert.ok(marks.emptyAt >= marks.agentsResolved, "empty readiness follows the completed empty response");
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ ok: true, timingBasis: "browser DOM observer after static imports; not paint/native startup", agentCount, sidebarBaseline: !!sidebarBaseline, shellToAgentsMs: Number((marks.agentsResolved - marks.shellAt).toFixed(2)), agentsFetchToResolveMs: Number((marks.agentsResolved - marks.agentsFetchStart).toFixed(2)), entryToShellMs: Number((marks.shellAt - marks.entryStart).toFixed(2)), entryToRailMs: marks.railAt === undefined ? null : Number((marks.railAt - marks.entryStart).toFixed(2)), railToChatMs: marks.chatAt === undefined ? null : Number((marks.chatAt - marks.railAt).toFixed(2)), agentsToEmptyMs: marks.emptyAt === undefined ? null : Number((marks.emptyAt - marks.agentsResolved).toFixed(2)), chatSocketToHelloMs: marks.chatHello === undefined ? null : Number((marks.chatHello - marks.chatSocket).toFixed(2)) }));
} finally {
  await browser?.close();
  await server?.close();
  await rm(scratch, { recursive: true, force: true });
}
