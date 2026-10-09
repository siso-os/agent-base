import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { createServer } from "vite";

const require = createRequire(import.meta.url);
const { webkit } = require("/tmp/ab-hub3-tools/node_modules/playwright");
const vite = await createServer({ configFile: resolve("apps/web/vite.config.ts"), root: resolve("apps/web"), server: { host: "127.0.0.1", port: 5419, strictPort: true } });
let browser;
let context;
const sampledAt = Date.now();
try {
  await vite.listen();
  browser = await webkit.launch({ headless: true });
  context = await browser.newContext({ viewport: { width: 1120, height: 760 }, deviceScaleFactor: 1, timezoneId: "Asia/Ho_Chi_Minh" });
  const page = await context.newPage();
  await page.route("**/api/hub/agents", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([
    { name: "AGENT-BASE", kind: "owner", project: "Agent Base", accent: "#66C7D2", state: "working", harness: "claude", model: "Opus", machine: "laptop", spunUp: true, holding: { id: "hub-11", title: "Finish navigation", status: "building" }, lastReport: null, plan: { checked: 4, total: 9, counts: {} }, workers: { total: 2, working: 1 } },
  ]) }));
  await page.route("**/api/servers", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ fleetAt: sampledAt, servers: [
    { key: "laptop", name: "MacBook Pro", status: "Healthy", health: { source: "live", at: sampledAt, cpus: 10, load: [2.14, 1.82, 1.44], memTotalGb: 36, memAvailGb: 12 } },
  ] }) }));
  await page.route("**/api/health", (route) => route.fulfill({ status: 200, contentType: "application/json", body: "{}" }));
  await page.route("**/api/agents", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ agents: [], domains: [], pinnedPages: [], recentPages: [] }) }));
  await page.route("**/api/agents/**", (route) => route.fulfill({ status: 204, body: "" }));
  await page.goto("http://127.0.0.1:5419/preview/nav.html", { waitUntil: "domcontentloaded" });
  await page.screenshot({ path: "apps/web/preview/nav-a0.png" });
  await page.getByRole("button", { name: "Agency", exact: true }).click();
  assert.equal(new URL(page.url()).hash, "#agency");
  await page.getByRole("button", { name: "Agent Zero", exact: true }).click();
  assert.equal(new URL(page.url()).hash, "#a0");
  await page.getByRole("button", { name: "Go back" }).click();
  assert.equal(new URL(page.url()).hash, "#agency");
  await page.getByRole("button", { name: "Go back" }).click();
  assert.equal(new URL(page.url()).hash, "#a0");
  await page.getByRole("button", { name: "Go forward" }).click();
  assert.equal(new URL(page.url()).hash, "#agency");
  await page.getByRole("button", { name: "Go forward" }).click();
  assert.equal(new URL(page.url()).hash, "#a0");
  await page.getByRole("button", { name: "Stats", exact: true }).click();
  await page.getByRole("heading", { name: "Stats" }).waitFor();
  await page.getByText("Machine load", { exact: true }).waitFor();
  await page.screenshot({ path: "apps/web/preview/nav-stats.png" });
  await page.keyboard.press("Meta+[");
  assert.equal(new URL(page.url()).hash, "#a0");
  const homeFill = await page.getByRole("button", { name: "Home", exact: true }).evaluate((node) => getComputedStyle(node).backgroundColor);
  const statsFill = await page.getByRole("button", { name: "Stats", exact: true }).evaluate((node) => getComputedStyle(node).backgroundColor);
  assert.notEqual(homeFill, statsFill, "only the current page should have an active fill");
  await page.screenshot({ path: "apps/web/preview/nav-topbar.png" });
  await page.getByRole("button", { name: "Starred", exact: true }).click();
  await page.getByRole("heading", { name: "Starred" }).waitFor();
  await page.getByRole("button", { name: "Unstar AGENT-BASE" }).waitFor();
  await page.screenshot({ path: "apps/web/preview/nav-starred.png" });
  await page.getByRole("button", { name: "Unstar AGENT-BASE" }).click();
  await page.getByText("Star an agent from its card").waitFor();
  console.log("WebKit navigation preview passed: back/forward hashes, Meta+[.");
} finally {
  await browser?.close();
  await context?.close();
  await vite.close();
}
