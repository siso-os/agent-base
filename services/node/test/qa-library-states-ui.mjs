// Synthetic UI checks for Library unavailable, empty, success and stale-refresh states.
// Usage: PLAYWRIGHT_BROWSERS_PATH=.qa-runtime/playwright node services/node/test/qa-library-states-ui.mjs
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { webkit } from "playwright";
import { qaFixtureEnv } from "./qa-fixture-env.mjs";

const REPO = path.join(import.meta.dirname, "../../..");
const portProbe = createServer();
await new Promise((resolve) => portProbe.listen(0, "127.0.0.1", resolve));
const PORT = portProbe.address().port;
await new Promise((resolve) => portProbe.close(resolve));
const BASE = `http://127.0.0.1:${PORT}`;
const scratch = mkdtempSync(path.join(process.env.TMPDIR ?? tmpdir(), ".siso-ephemeral-qa-library-states."));
const results = [];
const check = (name, ok, detail = {}) => { results.push(!!ok); console.log(JSON.stringify({ check: name, ok: !!ok, ...detail })); };
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const until = async (fn, ms = 8000) => {
  for (let t = 0; t < ms; t += 100) {
    if (await fn().catch(() => false)) return true;
    await sleep(100);
  }
  return false;
};

const repo = path.join(scratch, "SISO_Workspace/SISO_Agents/qa-library");
mkdirSync(path.join(repo, ".agents"), { recursive: true });
const sessionDir = path.join(scratch, "claude/projects", repo.replace(/[^A-Za-z0-9]/g, "-"));
mkdirSync(sessionDir, { recursive: true });
writeFileSync(path.join(sessionDir, "qa-library.jsonl"), `${JSON.stringify({ type: "user", uuid: "u-qa", timestamp: new Date().toISOString(), message: { role: "user", content: "QA" } })}\n`);
const agents = [{ agent: "claude", agent_status: "idle", cwd: repo, pane_id: "w1:p1", terminal_id: "term_qa_library", terminal_title_stripped: "QA Library", agent_session: { value: "qa-library" } }];
writeFileSync(path.join(scratch, "registry.json"), JSON.stringify({ projects: [{ id: "labs", name: "Labs", group: "labs", shown: true, order: 0 }], agents: {}, domains: [] }));
writeFileSync(path.join(scratch, "seat.json"), JSON.stringify({ session: "qa-library", pane: "w1:p1" }));

const row = { id: "qa-live", name: "QA live page", group: "labs", project: "labs", url: "http://127.0.0.1:9/", host: "local", status: "up", code: 200, checkedAt: Date.now() };
const good = { at: Date.now(), counts: { built: 0, live: 1, works: 0, templates: 0, lifecycle: {}, islands: {}, vps: 0 }, built: { rows: [], source: "register", error: null }, live: { rows: [row], source: "seed" }, works: { rows: [], templates: [], site: "http://127.0.0.1:9", shell: "http://127.0.0.1:9", generated: null, fetchedAt: null, stale: false, error: null, templatesError: null } };
const empty = { ...good, counts: { ...good.counts, live: 0 }, live: { rows: [], source: "seed" } };
let libraryMode = "good";
const node = spawn(process.execPath, ["--experimental-strip-types", "--no-warnings", "src/server.ts"], {
  cwd: path.join(REPO, "services/node"),
  env: { ...qaFixtureEnv(scratch), HOME: scratch, AB_PORT: String(PORT), AB_WEB_DIST: path.resolve(process.env.AB_QA_WEB_DIST ?? path.join(REPO, "apps/web/dist")), AB_HERDR: `${process.execPath} ${path.join(REPO, "services/node/test/fake-herdr.mjs")}`, FAKE_HERDR_AGENTS: JSON.stringify(agents), AB_REGISTRY: path.join(scratch, "registry.json"), AB_A0_SEAT: path.join(scratch, "seat.json"), AB_CLAUDE_DIRS: path.join(scratch, "claude"), AB_STATE: path.join(scratch, "rows.json"), AB_RESURRECT_DIR: path.join(scratch, "none"), AB_HOSTS_DIR: path.join(scratch, "hosts"), AB_CONSOLE_EVENTS: path.join(scratch, "none.jsonl"), AB_CTX_DIR: path.join(scratch, "ctx") },
  stdio: process.env.DEBUG_NODE ? "inherit" : "ignore",
});

let browser;
try {
  const ready = await until(async () => (await fetch(`${BASE}/api/health`)).ok, 30000);
  if (!ready) throw new Error(`fixture node did not become ready on ${BASE}`);
  browser = await webkit.launch();
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await context.addInitScript(() => {
    localStorage.setItem("agent-base:browser-setup", JSON.stringify({ step: 4, doneAt: 1 }));
    const native = window.setInterval;
    window.setInterval = (fn, ms, ...args) => native(fn, ms >= 120000 ? 100 : ms, ...args);
  });
  const page = await context.newPage();
  await page.route("**/api/library", (route) => {
    if (libraryMode === "error") return route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "fixture unavailable" }) });
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(libraryMode === "empty" ? empty : good) });
  });
  await page.goto(BASE);
  await page.locator("[data-testid=rail-row]").first().waitFor({ timeout: 20000 });
  await page.locator("button[aria-label^='Library']").click();
  const library = page.locator("[data-testid=library]");
  await library.locator("[data-testid=library-built]").waitFor({ timeout: 10000 });
  await library.getByRole("tab", { name: /^Live/ }).click();
  await library.getByText("QA live page", { exact: true }).waitFor();

  libraryMode = "error";
  const refreshError = await library.locator("[data-testid=library-refresh-error]").waitFor({ timeout: 5000 }).then(() => true, () => false);
  const keptRecord = await library.getByText("QA live page", { exact: true }).isVisible();
  check("Library refresh failure keeps the last good record and shows an unavailable status", refreshError && keptRecord, { refreshError, keptRecord });

  await page.reload();
  await library.waitFor({ timeout: 10000 });
  const firstLoadFailure = await until(async () => (await library.innerText()).includes("The Library is not readable right now"));
  check("Library first-load failure is explicit and does not claim an empty list", firstLoadFailure && !(await library.innerText()).includes("Nothing built matches"));

  libraryMode = "empty";
  await page.reload();
  await library.waitFor({ timeout: 10000 });
  await library.getByRole("tab", { name: /^Built/ }).click();
  const emptyState = await page.locator("[data-testid=library-built]").locator(".ab-lib__quiet").innerText().catch(() => "");
  check("A successful empty response is rendered as an empty state, without an unavailable banner", /Nothing built matches/.test(emptyState) && (await page.locator("[data-testid=library-refresh-error]").count()) === 0, { emptyState });

  libraryMode = "error";
  await page.evaluate(() => { location.hash = "#project/labs"; });
  const strip = page.locator("[data-testid=live-strip]");
  const firstFailure = await strip.locator("[data-testid=live-strip-error]").waitFor({ timeout: 8000 }).then(() => true, () => false);
  const falseEmpty = (await strip.innerText()).includes("No live page yet");
  check("LiveStrip distinguishes an unavailable response from a real empty live list", firstFailure && !falseEmpty, { firstFailure, falseEmpty, text: await strip.innerText().catch(() => "") });

  libraryMode = "empty";
  await page.reload();
  await page.evaluate(() => { location.hash = "#project/labs"; });
  const stripEmpty = page.locator("[data-testid=live-strip]");
  const realEmpty = await until(async () => (await stripEmpty.innerText()).includes("No live page yet"));
  check("LiveStrip says no live page only after a successful empty response", realEmpty && (await stripEmpty.locator("[data-testid=live-strip-error]").count()) === 0, { realEmpty, text: await stripEmpty.innerText().catch(() => "") });
} catch (e) {
  check("ran to the end", false, { error: String(e?.stack ?? e).slice(0, 600) });
} finally {
  await browser?.close();
  node.kill();
  rmSync(scratch, { recursive: true, force: true });
}
console.log(JSON.stringify({ passed: results.filter(Boolean).length, of: results.length }));
process.exit(results.every(Boolean) ? 0 : 1);
