// Update in place (t-0599 step 3, siso-os.md §2a.1-2, §11.9): a ship that changes only one module's code swaps that
// module in the open page, with no reload; everything else stays mounted. A module that throws shows its own crash box.
// Three real builds (A; B = A with the Questions text changed; C = A with Questions throwing), served from disk with
// fixture APIs, in headless webkit. Never a live agent: /api is answered here, every socket is closed.
//   heavy -- node --experimental-strip-types --no-warnings services/node/test/module-swap-ui.mjs
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "../../..");
const out = "/tmp/t0599/swap";
mkdirSync(out, { recursive: true });
const { webkit } = createRequire(path.join(root, "services/node/package.json"))("playwright");
const { build } = createRequire(path.join(root, "apps/web/package.json"))("vite");
const { fixtureResponse } = await import(path.join(root, "tools/ab-qa-fixtures.mjs"));

const fail = (m) => { console.error(`FAIL: ${m}`); process.exit(1); };
const QFILE = path.join(root, "apps/web/src/modules/questions/index.tsx");
const original = readFileSync(QFILE, "utf8");
const A_TEXT = "What the agents need you to answer will gather here.";
const B_TEXT = "Swapped in place: build B.";
const builds = {
  A: original,
  B: original.replace(A_TEXT, B_TEXT),
  C: original.replace("export default function QuestionsModule() {", 'export default function QuestionsModule() {\n  throw new Error("fixture: Questions throws");'),
};
if (builds.B === original || builds.C === original) fail("could not make the B/C variants of the Questions module");
try {
  for (const [name, src] of Object.entries(builds)) {
    writeFileSync(QFILE, src);
    await build({ root: path.join(root, "apps/web"), configFile: path.join(root, "apps/web/vite.config.ts"), logLevel: "error", build: { outDir: path.join(out, name), emptyOutDir: true } });
  }
} finally { writeFileSync(QFILE, original); }

const manifest = (n) => JSON.parse(readFileSync(path.join(out, n, "os-modules.json"), "utf8"));
const [mA, mB] = [manifest("A"), manifest("B")];
if (mA.shell !== mB.shell) fail("the shell hash changed when only the Questions module did");
if (mA.modules.questions.hash === mB.modules.questions.hash) fail("the Questions hash did not change");
const strays = mB.modules.questions.imports.filter((f) => !mA.files.includes(f));
if (strays.length) fail(`B's Questions chunk imports files A doesn't have: ${strays}`);
console.log(`PASS manifest: shell same (${mA.shell.slice(0, 8)}), questions ${mA.modules.questions.hash.slice(0, 8)} -> ${mB.modules.questions.hash.slice(0, 8)}, its imports all in A (${mB.modules.questions.imports.join(", ") || "none"})`);

// The release dir as ab-switch leaves it: the new build, with the old build's assets kept beside it (rsync --ignore-existing).
for (const n of ["B", "C"]) for (const f of readdirSync(path.join(out, "A/assets"))) if (!existsSync(path.join(out, n, "assets", f))) cpSync(path.join(out, "A/assets", f), path.join(out, n, "assets", f));
let live = "A";
const assetsOf = (n) => readdirSync(path.join(out, n, "assets")).map((f) => `/assets/${f}`);
const versionOf = (n) => ({ web: n, node: "x", desktop: "x", sha: n.toLowerCase().repeat(7), assets: assetsOf(n).filter((a) => readFileSync(path.join(out, n, "index.html"), "utf8").includes(a)) });
const types = { ".js": "text/javascript", ".css": "text/css", ".html": "text/html", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".woff2": "font/woff2" };
const server = createServer((q, s) => {
  const p = new URL(q.url, "http://x").pathname;
  if (p === "/api/version") { s.setHeader("content-type", "application/json"); return s.end(JSON.stringify(versionOf(live))); }
  if (p.startsWith("/api/")) { const body = fixtureResponse(p, "fixture"); s.statusCode = body === undefined ? 404 : 200; s.setHeader("content-type", "application/json"); return s.end(JSON.stringify(body ?? {})); }
  if (/^\/(chat|term)\b/.test(p)) { s.statusCode = 410; return s.end(); }
  const file = path.join(out, live, p === "/" ? "index.html" : p);
  if (!file.startsWith(path.join(out, live)) || !existsSync(file)) { s.statusCode = 404; return s.end(); }
  s.setHeader("content-type", types[path.extname(file)] ?? "application/octet-stream");
  s.setHeader("cache-control", "no-store");
  s.end(readFileSync(file));
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await webkit.launch({ headless: true });
try {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e).slice(0, 160)));
  await page.addInitScript(() => {
    for (const [k, v] of Object.entries({ "agent-base:space": '"questions"', "agent-base:sidebar-open": "true" })) localStorage.setItem(k, v);
    window.EventSource = undefined;
  });
  await page.route("**/*", (r) => (new URL(r.request().url()).origin === base ? r.fallback() : r.abort()));
  await page.routeWebSocket("**/*", (ws) => ws.close());
  await page.goto(base);
  await page.getByText(A_TEXT).waitFor({ timeout: 20000 });
  await page.waitForTimeout(1500);   // the first version poll sets its baseline
  // Marks that only survive if nothing reloads or remounts: the page itself and the side nav's element.
  const tagged = await page.evaluate(() => { window.__mark = 1; const nav = document.querySelector(".siso-app__rail"); if (nav) nav.__mark = 1; return !!nav; });
  if (!tagged) fail("no rail element to tag");
  await page.screenshot({ path: path.join(out, "before.png") });

  live = "B";
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await page.getByText(B_TEXT).waitFor({ timeout: 10000 }).catch(() => fail(`Questions still shows build A's text after the swap (${errors.join(" | ")})`));
  const kept = await page.evaluate(() => ({ page: window.__mark === 1, rail: document.querySelector(".siso-app__rail")?.__mark === 1, banner: !!document.querySelector('[data-testid="update-banner"], [data-testid="version-pulse"] [data-state="update"]') }));
  await page.screenshot({ path: path.join(out, "after-swap.png") });
  if (!kept.page) fail("the page reloaded");
  if (!kept.rail) fail("the rail was remounted");
  if (kept.banner) fail("a reload was offered");
  console.log("PASS swap: Questions now shows build B's text; no reload (page mark kept), the rail never remounted, no reload offered");

  live = "C";
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await page.locator('[data-testid="boundary"]').first().waitFor({ timeout: 10000 }).catch(() => fail("no crash box after swapping in the throwing build"));
  const after = await page.evaluate(() => ({ page: window.__mark === 1, rail: document.querySelector(".siso-app__rail")?.__mark === 1, name: document.querySelector('[data-testid="boundary"]')?.getAttribute("data-name") }));
  await page.screenshot({ path: path.join(out, "crash-box.png") });
  if (!after.page || !after.rail) fail("the throw took more than its module down");
  console.log(`PASS crash box: the throwing Questions shows its own crash box ("${after.name}"); the page and rail stay up`);
  console.log(JSON.stringify({ shots: ["before.png", "after-swap.png", "crash-box.png"].map((f) => path.join(out, f)), pageErrors: errors.length }));
} finally { await browser.close(); server.close(); }
