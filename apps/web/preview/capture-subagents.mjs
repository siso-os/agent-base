import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { webkit } from "/tmp/ab-hub3-tools/node_modules/playwright/index.mjs";

const server = spawn("pnpm", ["--filter", "@agent-base/web", "exec", "vite", "--host", "127.0.0.1", "--port", "5412", "--strictPort"], { detached: true, stdio: "ignore" });
const browser = await webkit.launch({ headless: true });
try {
  let ready = false;
  for (let i = 0; i < 80; i++) { try { ready = (await fetch("http://127.0.0.1:5412/preview/subagents.html")).ok; if (ready) break; } catch {} await delay(100); }
  assert.ok(ready, "Vite preview ready");
  const page = await browser.newPage({ viewport: { width: 1280, height: 1000 }, deviceScaleFactor: 1 });
  await page.route("**/api/agents/**/subagents", async (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(await page.evaluate(() => (window).__subagentsFixture)) }));
  await page.goto("http://127.0.0.1:5412/preview/subagents.html", { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /sub-agents/ }).click();
  await page.getByRole("dialog", { name: /Agent Zero/ }).waitFor();
  const panel = page.locator(".ab-subagents__panel"), rows = page.locator(".ab-subagents__row"), finished = page.locator(".ab-subagents__group.is-finished"), header = page.locator(".ab-subagents__head");
  assert.equal(await rows.count(), 13);
  assert.match(await page.locator(".ab-subagents__head").innerText(), /1 running · 12 finished today/);
  assert.equal(await page.getByText("Luna · herdr · a0w-003").count(), 1);
  assert.equal(await panel.evaluate((e) => e.clientHeight <= window.innerHeight * 0.6 + 1), true);
  const top = await header.evaluate((e) => e.getBoundingClientRect().top);
  await finished.evaluate((e) => { e.scrollTop = e.scrollHeight; });
  assert.equal(await header.evaluate((e) => e.getBoundingClientRect().top), top);
  assert.equal(await finished.evaluate((e) => e.scrollHeight > e.clientHeight), true);
  await finished.evaluate((e) => { e.scrollTop = 0; });
  await page.screenshot({ path: "apps/web/preview/shots/subagents.png" });
  console.log("WebKit passed: 13 rows incl. Codex lane, 1 running, fixed header, 60vh cap, Finished scroll");
} finally { await browser.close(); try { process.kill(-server.pid, "SIGTERM"); } catch {} }
