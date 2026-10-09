import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { webkit } from "/tmp/ab-hub3-tools/node_modules/playwright/index.mjs";

const repo = new URL("../../..", import.meta.url).pathname;
const server = spawn("pnpm", ["--filter", "@agent-base/web", "exec", "vite", "--host", "127.0.0.1", "--port", "5417", "--strictPort"], { cwd: repo, stdio: "ignore" });
let browser;
try {
  let ready = false;
  for (let i = 0; i < 60; i++) {
    try { ready = (await fetch("http://127.0.0.1:5417/preview/org-tour.html")).ok; } catch {}
    if (ready) break;
    await delay(500);
  }
  if (!ready) throw new Error("Vite preview did not start");
  browser = await webkit.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 });
  await page.goto("http://127.0.0.1:5417/preview/org-tour.html");
  await page.getByRole("button", { name: "Walk me through" }).click();
  await page.getByRole("button", { name: "Go to step 3" }).click();
  await page.getByText("AGENT-BASE is working.").waitFor();
  await page.screenshot({ path: new URL("./org-tour.png", import.meta.url).pathname, fullPage: true });
  if (await page.locator('[data-tour-node="AGENT-BASE"]').evaluate((el) => !el.classList.contains("is-tour-current"))) throw new Error("AGENT-BASE is not highlighted at step 3");
  const total = await page.locator(".org-tour__progress button").count();
  for (let i = 3; i <= total; i++) await page.getByRole("button", { name: i === total ? "Done" : "Next", exact: true }).click();
  if (await page.locator(".org-tour").count()) throw new Error("tour remained open after Done");
  if (await page.locator(".hub-org.is-tour-active").count()) throw new Error("chart remained dimmed after Done");
  process.stdout.write("PASS: step 3 highlight screenshot saved; Done closes and clears chart dimming\n");
} finally {
  await browser?.close();
  server.kill("SIGTERM");
}
