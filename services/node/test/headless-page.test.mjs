import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import http from "node:http";
import { suitePort } from "./suite-runtime.mjs";

const port = await suitePort();
const url = `http://127.0.0.1:${port}`;
// Vite preview inherits the dev proxy. Always route it to a fixture, never the live node on 5401.
const api = http.createServer((request, response) => response.writeHead(503).end());
await new Promise((resolve) => api.listen(0, "127.0.0.1", resolve));
const server = spawn("pnpm", ["--filter", "@agent-base/web", "preview", "--host", "127.0.0.1", "--port", String(port), "--strictPort"], { stdio: "ignore", env: { ...process.env, AB_NODE: String(api.address().port) } });
const scratch = mkdtempSync(path.join(tmpdir(), "agent-base-check-"));
try {
  let response;
  const until = Date.now() + 15_000;
  while (Date.now() < until) {
    try {
      response = await fetch(url);
      if (response.ok) break;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  if (!response?.ok) throw new Error("built web preview did not start");
  const html = await response.text();
  if (!html.includes('<title>Agent Base</title>') || !html.includes('id="root"')) throw new Error("preview did not serve the Agent Base shell");

  const screenshot = path.join(scratch, "page.png");
  const result = spawnSync("pnpm", ["dlx", "playwright@1.55.0", "screenshot", "--browser", "webkit", "--wait-for-selector", "#root", url, screenshot], { stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status ?? 1);
  if (statSync(screenshot).size === 0) throw new Error("WebKit produced an empty screenshot");
  console.log("Headless WebKit loaded the built app shell and captured a non-empty page.");
} finally {
  server.kill("SIGTERM");
  api.close();
  rmSync(scratch, { recursive: true, force: true });
}
