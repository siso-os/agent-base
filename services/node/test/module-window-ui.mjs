// A module in its own window (Shaan, 10 Oct: "right click ... open it in a new window ... a condensed version ... just with
// no icons ... voice, estate, app factory ... even whatsapp") and App Factory's ↻ ("the app factory doesn't have a refresh
// button"). Sealed vite + fixture API in headless webkit; never a live agent. Without the desktop bridge the menu opens a
// popup of the same page; with a stand-in bridge it asks the desktop for module_window (browser_window for Browser).
//   heavy -- node --experimental-strip-types --no-warnings services/node/test/module-window-ui.mjs
import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "../../..");
const { webkit } = createRequire(path.join(root, "services/node/package.json"))("playwright");
const { createServer } = createRequire(path.join(root, "apps/web/package.json"))("vite");
const { fixtureResponse } = await import(path.join(root, "tools/ab-qa-fixtures.mjs"));
const out = "/tmp/module-window-ui";
mkdirSync(out, { recursive: true });
const fail = (m) => { console.error(`FAIL: ${m}`); process.exit(1); };

const server = await createServer({ root: path.join(root, "apps/web"), configFile: path.join(root, "apps/web/vite.config.ts"), logLevel: "error",
  plugins: [{ name: "sealed-api", configureServer(v) { v.middlewares.use((q, s, next) => { if (/^\/(api|chat|term)\b/.test(q.url ?? "")) { s.statusCode = 410; s.end("Fixture only"); return; } next(); }); } }],
  server: { host: "127.0.0.1", port: 0, strictPort: false, hmr: false, watch: { ignored: ["**/*"] } } });
await server.listen();
const base = `http://127.0.0.1:${server.httpServer.address().port}`;
const browser = await webkit.launch({ headless: true });
const errors = [];
const seal = async (ctx) => {
  await ctx.addInitScript(() => { window.EventSource = undefined; localStorage.setItem("agent-base:space", '"agents"'); localStorage.setItem("agent-base:sidebar-open", "true"); });
  await ctx.route("**/*", (r) => (new URL(r.request().url()).origin === base ? r.fallback() : r.abort()));
  await ctx.route(`${base}/api/**`, (r) => { const body = fixtureResponse(new URL(r.request().url()).pathname, "fixture"); return body === undefined ? r.fulfill({ status: 404, json: {} }) : r.fulfill({ json: body }); });
  await ctx.routeWebSocket("**/*", (ws) => ws.close());
};
try {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" });
  await seal(ctx);
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(String(e).slice(0, 200)));
  await page.goto(base);
  const voice = page.locator('.siso-app__rail [data-module="voice"] button').first();
  await voice.waitFor({ timeout: 20000 }).catch(() => fail(`no Voice icon on the rail (${errors.join(" | ")})`));

  // 1. Right-click Voice → "Open Voice in a new window" → a window of Voice alone: no rail, "Voice" in its bar.
  await voice.click({ button: "right" });
  const item = page.getByRole("menuitem", { name: "Open Voice in a new window" });
  await item.waitFor({ timeout: 5000 }).catch(() => fail("right-click on Voice shows no 'Open Voice in a new window'"));
  await page.screenshot({ path: path.join(out, "menu.png") });
  const [popup] = await Promise.all([page.waitForEvent("popup", { timeout: 10000 }), item.click()]);
  popup.on("pageerror", (e) => errors.push(`popup: ${String(e).slice(0, 200)}`));
  if (!/[?&]window=module&m=voice\b/.test(popup.url())) fail(`the new window is at ${popup.url()}`);
  await popup.waitForLoadState();
  await popup.locator('.siso-app__top[data-solo-title="Voice"]').waitFor({ state: "attached", timeout: 20000 }).catch(() => fail("the Voice window's bar does not say Voice"));
  await popup.waitForTimeout(1500);
  if (await popup.locator(".siso-app__rail").isVisible()) fail("the Voice window still shows the rail");
  const solo = await popup.evaluate(() => ({ space: localStorage.getItem("agent-base:space"), voice: !!document.querySelector('[aria-label*="Voice" i], [data-space="voice"], .voice-space, [class*="voice"]') }));
  if (solo.space !== '"agents"') fail(`opening the Voice window moved the main window's saved space to ${solo.space}`);
  if (!solo.voice) fail("the Voice window does not draw Voice");
  await popup.screenshot({ path: path.join(out, "voice-window.png") });
  await popup.close();
  console.log("PASS new window: right-click Voice → 'Open Voice in a new window' opens ?window=module&m=voice: no rail, 'Voice' in the bar, the main window's space untouched");

  // 2. App Factory's head: right-click → Open here; its frame has ↻, which reloads just the frame.
  await page.locator('.siso-app__rail [data-space="app-factory"] .siso-spaces__head button').first().click({ button: "right" });
  await page.getByRole("menuitem", { name: "Open App Factory in a new window" }).waitFor({ timeout: 5000 }).catch(() => fail("right-click on App Factory's head shows no new-window item"));
  await page.getByRole("menuitem", { name: "Open here" }).click();
  const frame = page.locator('section[aria-label="App Factory"] iframe');
  await frame.waitFor({ state: "attached", timeout: 10000 }).catch(() => fail("App Factory did not open"));
  await page.evaluate(() => { document.querySelector('section[aria-label="App Factory"] iframe').__mark = 1; });
  await page.getByTestId("frame-reload").click();
  await page.waitForTimeout(300);
  if (await page.evaluate(() => document.querySelector('section[aria-label="App Factory"] iframe')?.__mark === 1)) fail("↻ did not reload App Factory's frame");
  if (!(await page.locator('section[aria-label="App Factory"] iframe').count())) fail("↻ left App Factory without its frame");
  console.log("PASS App Factory ↻: its head's right-click offers a new window; ↻ on the frame reloads the frame (a fresh iframe), nothing else");
  await ctx.close();

  // 3. In the desktop app (stand-in bridge): Estate asks for module_window, Browser for browser_window; an older desktop says what to do.
  const ctx2 = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" });
  await seal(ctx2);
  await ctx2.addInitScript(() => {
    window.__calls = [];
    window.__TAURI_INTERNALS__ = { invoke: async (cmd, args) => { window.__calls.push([cmd, args]); if (cmd === "module_window" && window.__old) throw new Error("Command module_window not found"); return undefined; } };
  });
  const p2 = await ctx2.newPage();
  p2.on("pageerror", (e) => errors.push(`desktop: ${String(e).slice(0, 200)}`));
  await p2.goto(base);
  const estate = p2.locator('.siso-app__rail [data-module="estate"] button').first();
  await estate.waitFor({ timeout: 20000 }).catch(() => fail("no Estate icon on the rail"));
  await estate.click({ button: "right" });
  await p2.getByRole("menuitem", { name: /in a new window/ }).click({ timeout: 5000 });
  await p2.waitForFunction(() => window.__calls.some(([c]) => c === "module_window"), null, { timeout: 5000 }).catch(() => fail("Estate's new window did not ask the desktop for module_window"));
  const call = await p2.evaluate(() => window.__calls.find(([c]) => c === "module_window"));
  if (call[1].module !== "estate") fail(`module_window was asked for ${JSON.stringify(call[1])}`);
  const web = p2.locator('.siso-app__rail [data-module="browser"] button').first();
  if (await web.count()) {
    await web.click({ button: "right" });
    await p2.getByRole("menuitem", { name: /in a new window/ }).click();
    await p2.waitForFunction(() => window.__calls.some(([c, a]) => c === "browser_window" && a?.open === true), null, { timeout: 5000 }).catch(() => fail("Browser's new window did not open the SISO Browser window"));
  }
  await p2.evaluate(() => { window.__old = true; });
  await estate.click({ button: "right" });
  await p2.getByRole("menuitem", { name: /in a new window/ }).click();
  await p2.getByRole("status").filter({ hasText: "desktop update" }).waitFor({ timeout: 5000 }).catch(() => fail("an older desktop app gave no 'needs the desktop update' note"));
  await p2.screenshot({ path: path.join(out, "desktop-note.png") });
  console.log(`PASS desktop: Estate → module_window {module: "estate"}${(await web.count()) ? ", Browser → browser_window (the SISO Browser window)" : ""}; an older desktop app says it needs the desktop update`);
  await ctx2.close();
  const real = errors.filter((e) => !/__TAURI|browser_|native/i.test(e));
  if (real.length) fail(`page errors: ${real.join(" | ")}`);
} finally { await browser.close(); await server.close(); }
