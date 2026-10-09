// Real record/build fixture plus the rendered account card; no live sessions or API calls.
import assert from "node:assert/strict";
import { test } from "node:test";
import { registerHooks } from "node:module";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import path from "node:path";
import { webkit } from './suite-runtime.mjs';

const repo = path.resolve(import.meta.dirname, "../../..");
const evidence = path.join(repo, ".lab-pair");
mkdirSync(path.join(evidence, "tmp"), { recursive: true });
const scratch = mkdtempSync(path.join(evidence, "tmp/tokens-models-"));
Object.assign(process.env, { AB_HOME: scratch, AB_CODEX_HOME: path.join(scratch, ".codex"), AB_HUD_DIR: path.join(scratch, "hud"), AB_PRICES: path.join(scratch, "no-prices.json"), AB_TOKENS_CACHE: path.join(scratch, "tokens.json") });
const moduleUrl = new URL("../src/tokens.ts", import.meta.url).href;
const hooks = registerHooks({
  load(url, context, nextLoad) {
    const loaded = nextLoad(url, context);
    if (url !== moduleUrl || loaded.source == null) return loaded;
    const source = typeof loaded.source === "string" ? loaded.source : Buffer.from(loaded.source).toString("utf8");
    return { ...loaded, source: source.replace(/^setTimeout\(warmTokens.*$/m, "").replace(/^setInterval\(warmTokens.*$/m, "") + "\nexport const __testModels = { record, build };\n" };
  },
});
const { __testModels: tokens } = await import("../src/tokens.ts");
hooks.deregister();
const realNow = Date.now;
let now = new Date(2026, 9, 3, 12).getTime();
Date.now = () => now;
const record = (account, model, at, total, cost = 0) => tokens.record(account, model, at, { input: total, output: 0, cacheRead: 0, cacheWrite: 0, total, cost, unpricedTokens: 0, messages: 1 }, null, "fixture");
const account = (body, id = "claude:fixture") => body.accounts.find((a) => a.id === id);
const old = new Date(2026, 8, 22, 12).getTime();
const monday = new Date(2026, 8, 28).getTime();
const midnight = new Date(2026, 9, 3).getTime();
record("claude:fixture", "claude-opus-5", old, 10_000, 10);
record("claude:fixture", "claude-sonnet-5", monday - 1, 400);
record("claude:fixture", "claude-sonnet-5", monday, 200, 2);
record("claude:fixture", "claude-sonnet-5", midnight - 1, 100, 1);
record("claude:fixture", "claude-opus-5-5", midnight, 20, 0.2);
record("claude:fixture", "claude-opus-5-5", now, 30, 0.3);
const names = ["gpt-6-luna", "gpt-6.1-sol", "gpt-6-astra", "gpt-5.6-luna"];
for (const model of names) record(`claude:${model}`, model, now, 5);
for (let i = 0; i < 8; i++) record("codex", `fixture-model-${i}`, now, i + 1, (i + 1) / 10);
const fixture = tokens.build();

test("per-account today/week models use the same boundaries and sums as token totals", () => {
  const a = account(fixture);
  assert.equal(a.models[0].model, "claude-opus-5");
  assert.deepEqual(a.modelsToday, [{ model: "claude-opus-5-5", total: 50, cost: 0.5 }]);
  assert.deepEqual(a.modelsWeek, [{ model: "claude-sonnet-5", total: 300, cost: 3 }, { model: "claude-opus-5-5", total: 50, cost: 0.5 }]);
  assert.equal(a.today.total, a.modelsToday.reduce((sum, m) => sum + m.total, 0));
  assert.equal(a.week.total, a.modelsWeek.reduce((sum, m) => sum + m.total, 0));
  assert.equal(account(fixture, "codex").modelsToday.length, 6);
  assert.deepEqual(account(fixture, "codex").modelsToday.map((m) => m.total), [8, 7, 6, 5, 4, 3]);
});

test("model ranges expire at local midnight and next Monday without re-recording", () => {
  now = new Date(2026, 9, 4, 0).getTime();
  assert.deepEqual(account(tokens.build()).modelsToday, []);
  assert.equal(account(tokens.build()).modelsWeek[0].model, "claude-sonnet-5");
  now = new Date(2026, 9, 5, 0).getTime();
  assert.deepEqual(account(tokens.build()).modelsWeek, []);
  assert.equal(account(tokens.build()).models[0].model, "claude-opus-5");
  now = new Date(2026, 9, 3, 12).getTime();
});

test("rendered card names today's model; all-time list appears only in its tooltip", async () => {
  const dist = path.join(repo, "apps/web/dist");
  const server = createServer((request, response) => {
    const pathname = new URL(request.url, "http://fixture").pathname;
    if (pathname === "/api/tokens") return response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(fixture));
    if (pathname.startsWith("/api/")) return response.writeHead(503).end();
    const file = path.resolve(dist, `.${pathname === "/" ? "/index.html" : pathname}`);
    if (!file.startsWith(dist + path.sep)) return response.writeHead(404).end();
    try {
      const mime = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml" }[path.extname(file)] ?? "application/octet-stream";
      response.writeHead(200, { "content-type": mime }).end(readFileSync(file));
    } catch { response.writeHead(404).end(); }
  });
  let browser;
  try {
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    browser = await webkit.launch();
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const errors = [], external = [];
    await context.route("**/*", (route) => {
      if (new URL(route.request().url()).origin === base) return route.continue();
      external.push(route.request().url()); return route.abort();
    });
    await context.addInitScript(() => localStorage.setItem("agent-base:space", JSON.stringify("tokens")));
    const page = await context.newPage();
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(base);
    const cards = page.getByTestId("token-account");
    await cards.first().waitFor();
    const card = cards.filter({ hasText: "today mostly Opus 5.5" });
    assert.equal(await card.count(), 1);
    assert.doesNotMatch(await card.innerText(), /mostly Opus 5(?:\s|$)|all time/);
    const tooltip = await card.locator('[title^="all time since"]').getAttribute("title");
    assert.match(tooltip, /all time since .+ · .*Opus 5 /);
    for (const name of ["Luna 6", "Sol 6.1", "Astra 6", "Luna 5.6 (old)"]) assert.equal(await cards.filter({ hasText: `today mostly ${name}` }).count(), 1);
    await card.screenshot({ path: path.join(evidence, "tokens-models-card.png") });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(100);
    assert.equal(await card.isVisible(), true);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
    assert.deepEqual(errors, []); assert.deepEqual(external, []);
  } finally {
    await browser?.close();
    await new Promise((resolve) => server.close(resolve));
  }
});

process.on("exit", () => { Date.now = realNow; rmSync(scratch, { recursive: true, force: true }); });
