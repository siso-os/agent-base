// Startup recovery for every JSON storage family; all node state and browser requests are synthetic.
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { webkit } from './suite-runtime.mjs';

const REPO = path.join(import.meta.dirname, "../../.."); const reserve = createServer();
await new Promise((resolve, reject) => reserve.once("error", reject).listen(0, "127.0.0.1", resolve)); const PORT = reserve.address().port; await new Promise((resolve) => reserve.close(resolve)); const BASE = `http://127.0.0.1:${PORT}`;
mkdirSync(path.join(REPO, ".lab-pair/tmp"), { recursive: true });
const scratch = mkdtempSync(path.join(REPO, ".lab-pair/tmp", ".siso-ephemeral-persist.")); const claude = path.join(scratch, "claude"); const project = path.join(claude, "projects", "fixture"); mkdirSync(project, { recursive: true });
const sessions = { alpha: "stream-alpha", beta: "stream-beta" }; for (const [name, session] of Object.entries(sessions)) writeFileSync(path.join(project, `${session}.jsonl`), JSON.stringify({ type: "user", uuid: `${name}-ready`, timestamp: new Date().toISOString(), message: { role: "user", content: `${name} ready` } }) + "\n");
const agentsFile = path.join(scratch, "agents.json"); const rec = (name, pane, terminal_id, session) => ({ agent: "claude", agent_status: "working", cwd: "/tmp", pane_id: pane, terminal_id, terminal_title_stripped: name, agent_session: { value: session } });
writeFileSync(agentsFile, JSON.stringify([rec("ALPHA", "w1:p2", "term-stream-alpha", sessions.alpha), rec("BETA", "w1:p3", "term-stream-beta", sessions.beta)])); writeFileSync(path.join(scratch, "registry.json"), JSON.stringify({ projects: [], agents: { ALPHA: { project: "Fixture", kind: "owner", domain: "Fixture" }, BETA: { project: "Fixture", kind: "owner", domain: "Fixture" } }, domains: [] }));
const env = { PATH: process.env.PATH, TMPDIR: process.env.TMPDIR, LANG: process.env.LANG, SHELL: process.env.SHELL, HOME: scratch, AB_HOME: scratch, CODEX_HOME: path.join(scratch, ".codex"), AB_CODEX_HOME: path.join(scratch, ".codex"), CLAUDE_CONFIG_DIR: path.join(scratch, ".claude"), XDG_CONFIG_HOME: path.join(scratch, ".config"), XDG_CACHE_HOME: path.join(scratch, ".cache"), XDG_DATA_HOME: path.join(scratch, ".local/share"), XDG_STATE_HOME: path.join(scratch, ".local/state"), AB_PORT: String(PORT), AB_HUB_HOME: scratch, AB_ORG_HOME: scratch, AB_ROLODEX_HOME: scratch, AB_CLAUDE_DIRS: claude, AB_CTX_DIR: path.join(scratch, "ctx"), AB_HUD_DIR: path.join(scratch, "ctx"), AB_HERDR: `${process.execPath} ${path.join(REPO, "services/node/test/fake-herdr.mjs")}`, FAKE_HERDR_AGENTS_FILE: agentsFile, AB_HOSTS_DIR: path.join(scratch, "hosts"), AB_STATE: path.join(scratch, "rows.json"), AB_REGISTRY: path.join(scratch, "registry.json"), AB_RESURRECT_DIR: path.join(scratch, "none"), AB_CONSOLE_EVENTS: path.join(scratch, "none.jsonl"), AB_OPEN_DRY: "1", AB_CONSOLE_URL: BASE, AB_BURN_CMD: "true", AB_VOICE_DB: path.join(scratch, "voice.db"), AB_VOICE_PREFS: path.join(scratch, "voice.plist"), AB_VOICE_WATCH: "0" };

// Shared-shell keys and direct JSON readers, including dynamic agent/group/page keys.
const keys = [
  "open", "active", "view", "open-tabs", "last-tab", "strip-seen", "tab-nav", "as-terminal", "space",
  "sidebar-open", "panel.open.zero", "panel.open.agent", "panel.open.page.stats", "life-sel", "voice-sel",
  "split-width", "side-panel-width", "panel-page-width", "chat-beside-width", "group-open:fixture",
  "card-open:fixture", "mini-lane:fixture", "browser-pins-folded", "browser-setup", "browser-today",
  "browser-accounts", "arc-profiles", "selection-log", "org-last", "draft:term-stream-alpha",
  "future-json-key",
].map((key) => `agent-base:${key}`).concat(["ab.fold.ALPHA", "ab.tokens.v1", "life-queue-v1", "life-config-v1"]);
const rawValues = {
  "agent-base:whats-new.seen": "fixture-sha",
  "agent-base:browser-profile:last": "personal",
  "agent-base:browser-profile:fixture-tab": "work",
  "agent-base:browser-account:fixture-tab": "fake-account",
  "agent-base:browser-sidebar-hidden": "1",
  "ab.popped": "tasks", "ab-org-view": "tree", "agent-base.dock.width": "400", "unrelated-app:key": "not JSON",
};
const malformed = "{private-fixture-draft";
const results = [];
const evidence = path.join(REPO, ".lab-pair/persist-malformed-results.jsonl");
writeFileSync(evidence, "");
const check = (name, ok, detail = {}) => {
  results.push(!!ok);
  const result = JSON.stringify({ check: name, ok: !!ok, ...detail });
  writeFileSync(evidence, result + "\n", { flag: "a" }); console.log(result);
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const until = async (fn, ms = 5000) => {
  for (const end = Date.now() + ms; Date.now() < end; await sleep(50)) if (await fn()) return true;
  return false;
};
let node, browser;
try {
  node = spawn(process.execPath, ["--experimental-strip-types", "--no-warnings", "src/server.ts"], { cwd: path.join(REPO, "services/node"), env, stdio: "ignore" });
  if (!await until(async () => (await fetch(`${BASE}/api/health`).catch(() => null))?.ok, 15000)) throw new Error("fixture node failed health check");
  browser = await webkit.launch();
  const cases = [
    { name: "every JSON key", values: Object.fromEntries(keys.map((key) => [key, malformed])), bad: keys },
    { name: "open tabs alone", values: { "agent-base:open-tabs": "[broken" }, bad: ["agent-base:open-tabs"] },
    { name: "mounted list alone", values: { "agent-base:open": "[broken" }, bad: ["agent-base:open"] },
    { name: "wrong list shapes", values: { "agent-base:open-tabs": "{}", "agent-base:open": "null" }, bad: [] },
    { name: "valid draft preserved", values: { "agent-base:draft:term-stream-alpha": JSON.stringify({ text: "valid fixture draft", images: [] }) }, bad: [] },
    { name: "storage denied", values: {}, bad: [], denied: true },
    { name: "storage read denied", values: {}, bad: [], deniedReads: true },
    { name: "corrupt readonly storage", values: { "agent-base:open": malformed, "agent-base:open-tabs": malformed }, bad: ["agent-base:open", "agent-base:open-tabs"], readonly: true },
  ];
  for (const fixture of cases) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const external = [], errors = [], warnings = [];
    await context.route("**/*", (route) => {
      if (new URL(route.request().url()).origin === BASE) return route.continue();
      external.push(route.request().url()); return route.abort();
    });
    await context.addInitScript(({ fixture, rawValues }) => {
      Object.entries({ ...rawValues, ...fixture.values }).forEach(([key, value]) => localStorage.setItem(key, value));
      if (fixture.denied) Object.defineProperty(window, "localStorage", { get() { throw new DOMException("fixture storage denied", "SecurityError"); } });
      if (fixture.deniedReads) Storage.prototype.getItem = () => { throw new DOMException("fixture reads denied", "SecurityError"); };
      if (fixture.readonly) Storage.prototype.removeItem = () => { throw new DOMException("fixture writes denied", "SecurityError"); };
    }, { fixture, rawValues });
    const page = await context.newPage();
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (msg) => { if (msg.type() === "warning") warnings.push(msg.text()); });
    await page.routeWebSocket(/\/chat\/[^/]+\/ws/, (ws) => ws.send(JSON.stringify({ t: "hello", session: "fixture", log: [], before: 0, more: false, state: "idle", thinking: {}, partial: {}, tasks: [], bg: [] })));
    await page.goto(BASE);
    const shell = page.getByRole("button", { name: "Show or hide the side nav", exact: true });
    await shell.waitFor({ timeout: 8000 });
    check(`${fixture.name}: shell starts without page errors`, errors.length === 0, { errors });
    if (fixture.bad.length) {
      check(`${fixture.name}: each corrupt key warns without exposing its value`, fixture.bad.every((key) => warnings.some((warning) => warning.includes(key))) && !warnings.some((warning) => warning.includes(malformed)), { warnings: warnings.length, keys: fixture.bad.length });
      if (!fixture.readonly) {
        const keptBad = await page.evaluate(({ bad, values }) => bad.filter((key) => localStorage.getItem(key) === values[key]), { bad: fixture.bad, values: fixture.values });
        check(`${fixture.name}: corrupt values dropped`, keptBad.length === 0, { keptBad });
      }
    }
    if (!fixture.denied && !fixture.deniedReads) {
      const kept = await page.evaluate((values) => Object.entries(values).every(([key, value]) => localStorage.getItem(key) === value), rawValues);
      check(`${fixture.name}: raw preferences and unrelated storage preserved`, kept);
    }
    if (fixture.name === "valid draft preserved") {
      await page.locator('[data-testid=rail-row][data-item="term-stream-alpha"]').click();
      const editor = page.locator('[data-testid="chat-view"]:visible').getByRole("textbox", { name: "Message", exact: true });
      check("valid JSON: saved draft restores", await editor.inputValue() === "valid fixture draft");
    }
    await shell.click();
    check(`${fixture.name}: sidebar control works`, await shell.getAttribute("aria-pressed") === "false" && external.length === 0, { external });
    await context.close();
  }
} catch (error) {
  check("persist recovery suite completes", false, { error: String(error?.stack ?? error).slice(0, 900) });
} finally {
  await browser?.close();
  if (node) { node.kill(); if (node.exitCode === null) await new Promise((resolve) => node.once("exit", resolve)); }
  rmSync(scratch, { recursive: true, force: true });
}
console.log(JSON.stringify({ passed: results.filter(Boolean).length, of: results.length }));
process.exitCode = results.every(Boolean) ? 0 : 1;
