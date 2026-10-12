// Budget ↻ (Shaan, 10 Oct: "there should be a refresh button on it ... I don't know what my usages are, 5 hour or weekly"):
// Agent Zero's panel names both Claude windows, says how old the reading is, and ↻ asks the node to read usage now
// (POST /api/claude-usage) then shows the new reading. Sealed vite + fixture API in headless webkit; never a live agent.
//   heavy -- node --experimental-strip-types --no-warnings services/node/test/budget-refresh-ui.mjs
import { createRequire } from "node:module";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "../../..");
const { webkit } = createRequire(path.join(root, "services/node/package.json"))("playwright");
const { createServer } = createRequire(path.join(root, "apps/web/package.json"))("vite");
const { fixtureResponse } = await import(path.join(root, "tools/ab-qa-fixtures.mjs"));
const fail = (m) => { console.error(`FAIL: ${m}`); process.exit(1); };

// The Claude account's reading: 41% / 63% read 4 minutes ago; after ↻ the node has read 47% / 64% now.
let reading = { five: 41, week: 63, at: Date.now() - 4 * 60_000 };
let posts = 0;
const tokens = () => {
  const base = fixtureResponse("/api/tokens", "fixture");
  const claude = { ...base.accounts[0], id: "claude:claude-siso-3", name: "Synthetic Claude", kind: "claude",
    limits: { fiveHour: { usedPct: reading.five, resetsAt: Date.now() + 2 * 3600_000, expired: false }, weekly: { usedPct: reading.week, resetsAt: Date.now() + 3 * 86400_000, expired: false }, at: reading.at, stale: false, source: "live Claude OAuth usage" } };
  return { ...base, accounts: [claude, ...base.accounts] };
};

const server = await createServer({ root: path.join(root, "apps/web"), configFile: path.join(root, "apps/web/vite.config.ts"), logLevel: "error",
  plugins: [{ name: "sealed-api", configureServer(v) { v.middlewares.use((q, s, next) => { if (/^\/(api|chat|term)\b/.test(q.url ?? "")) { s.statusCode = 410; s.end("Fixture only"); return; } next(); }); } }],
  server: { host: "127.0.0.1", port: 0, strictPort: false, hmr: false, watch: { ignored: ["**/*"] } } });
await server.listen();
const base = `http://127.0.0.1:${server.httpServer.address().port}`;
const browser = await webkit.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e).slice(0, 160)));
  await page.addInitScript(() => { localStorage.setItem("agent-base:sidebar-open", "true"); window.EventSource = undefined; });
  await page.route("**/*", (r) => (new URL(r.request().url()).origin === base ? r.fallback() : r.abort()));
  await page.route(`${base}/api/**`, (r) => {
    const p = new URL(r.request().url()).pathname;
    if (p === "/api/claude-usage" && r.request().method() === "POST") { posts++; if (posts === 1) reading = { five: 47, week: 64, at: Date.now() }; return r.fulfill({ json: { fiveHour: { pct: 47 }, week: { pct: 64 }, at: reading.at, stale: false } }); }
    if (p === "/api/tokens") return r.fulfill({ json: tokens() });
    const body = fixtureResponse(p, "fixture");
    return body === undefined ? r.fulfill({ status: 404, json: {} }) : r.fulfill({ json: body });
  });
  await page.routeWebSocket("**/*", (ws) => ws.close());
  await page.goto(base);
  const budget = page.getByTestId("zh-budget");
  await budget.waitFor({ timeout: 20000 }).catch(() => fail(`no Budget block on Agent Zero's panel (${errors.join(" | ")})`));
  await budget.getByText("Claude 5-hour").waitFor({ timeout: 10000 }).catch(() => fail("the 5-hour window is not named"));
  if (!(await budget.getByText("Claude weekly").count())) fail("the weekly window is not named");
  const before = await page.getByTestId("zh-budget-age").innerText();
  if (!/updated 4m ago/.test(before)) fail(`the age line says "${before}", not "updated 4m ago"`);
  const shown = async () => (await budget.innerText()).replace(/\s+/g, " ");
  if (!/41/.test(await shown())) fail("the 41% reading is not shown");
  console.log(`PASS names: "Claude 5-hour" and "Claude weekly" with the age line "${before.trim()}"`);

  await page.getByTestId("zh-budget-refresh").click();
  await page.getByTestId("zh-budget-age").getByText("updated just now").waitFor({ timeout: 10000 }).catch(async () => fail(`after ↻ the age line says "${await page.getByTestId("zh-budget-age").innerText()}"`));
  if (posts !== 1) fail(`↻ sent ${posts} refresh requests, not 1`);
  const after = await shown();
  if (!/47/.test(after) || /41/.test(after)) fail(`after ↻ the card shows "${after.slice(0, 160)}"`);
  await page.screenshot({ path: "/tmp/t0599/budget-refresh.png" });
  console.log("PASS refresh: ↻ asked the node to read usage now (1 POST), the card shows the new 47% and \"updated just now\"");
  // The composer's usage meter: hover opens the card (named windows, how old, ↻).
  await page.getByTestId("provider-usage").first().hover();
  const card = page.locator(".ab-provider-card");
  await card.waitFor({ timeout: 5000 }).catch(() => fail("hovering the composer's usage meter opens no card"));
  await page.waitForTimeout(300);
  const text = (await card.innerText()).replace(/\s+/g, " ");
  for (const want of ["Claude and Codex usage", "5-hour limit", "Weekly limit", "47% used", "64% used", "updated just now"]) if (!text.toLowerCase().includes(want.toLowerCase())) fail(`the usage card does not say "${want}" (${text.slice(0, 200)})`);
  if (await page.getByTestId("tooltip").isVisible().catch(() => false)) fail("a second tooltip shows over the usage card");
  await card.screenshot({ path: "/tmp/t0599/usage-card.png" });
  reading = { five: 52, week: 66, at: Date.now() };
  await card.getByTestId("usage-refresh").click();
  await card.getByText("52% used").waitFor({ timeout: 10000 }).catch(() => fail("↻ on the usage card did not bring the new reading"));
  if (posts !== 2) fail(`the card's ↻ sent ${posts - 1} refresh requests, not 1`);
  console.log("PASS usage card: \"Claude and Codex usage\", 5-hour and weekly limits as \"47% used\" / \"64% used\", no extra tooltip; its ↻ read 52% now");
  if (errors.length) fail(`page errors: ${errors.join(" | ")}`);
} finally { await browser.close(); await server.close(); }
