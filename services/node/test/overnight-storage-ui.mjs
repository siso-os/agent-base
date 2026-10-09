// Recovery from malformed persisted UI conveniences. All browser storage and node files are synthetic.
// Run: heavy -- node services/node/test/overnight-storage-ui.mjs
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { webkit } from './suite-runtime.mjs';

const repo = path.resolve(import.meta.dirname, "../../..");
const scratch = mkdtempSync(path.join(tmpdir(), "ab-overnight-storage-"));
const port = await new Promise((resolve) => {
  const server = createServer().listen(0, "127.0.0.1", () => {
    const port = server.address().port;
    server.close(() => resolve(port));
  });
});
const base = `http://127.0.0.1:${port}`;
const evidence = path.join(tmpdir(), ".siso-ephemeral-overnight-storage");
mkdirSync(evidence, { recursive: true });
const node = spawn(process.execPath, ["--experimental-strip-types", "--no-warnings", "src/server.ts"], {
  cwd: path.join(repo, "services/node"), stdio: "ignore",
  env: {
    PATH: process.env.PATH, TMPDIR: process.env.TMPDIR ?? tmpdir(), LANG: "en_US.UTF-8", SHELL: "/bin/zsh",
    HOME: scratch, AB_HOME: scratch, AB_CODEX_HOME: path.join(scratch, ".codex"), AB_PORT: String(port), AB_HOST: "127.0.0.1",
    AB_HERDR: `${process.execPath} ${path.join(import.meta.dirname, "fake-herdr.mjs")}`, FAKE_HERDR_AGENTS: "[]",
    AB_STATE: path.join(scratch, "rows.json"), AB_REGISTRY: path.join(scratch, "registry.json"),
    AB_HUB_HOME: scratch, AB_ORG_HOME: scratch, AB_ROLODEX_HOME: scratch, AB_CLAUDE_DIRS: path.join(scratch, ".claude"),
    AB_HOSTS_DIR: path.join(scratch, "hosts"), AB_RESURRECT_DIR: path.join(scratch, "resurrect"),
    AB_CONSOLE_EVENTS: path.join(scratch, "events.jsonl"), AB_CONSOLE_URL: base,
    AB_A0_SEAT: path.join(scratch, "seat.json"), AB_BURN_CMD: "true", AB_OPEN_DRY: "1",
    AB_VOICE_PREFS: path.join(scratch, "voice.plist"), AB_VOICE_DB: path.join(scratch, "voice.db"), AB_VOICE_WATCH: "0",
  },
});
const results = [];
const check = (name, ok, detail = {}) => { results.push(!!ok); console.log(JSON.stringify({ check: name, ok: !!ok, ...detail })); };
let browser;
try {
  let ready = false;
  for (let attempt = 0; attempt < 100 && !ready; attempt++) {
    ready = await fetch(`${base}/api/health`).then((r) => r.ok).catch(() => false);
    if (!ready) await new Promise((resolve) => setTimeout(resolve, 100));
  }
  if (!ready) throw new Error("fixture node failed health check");
  browser = await webkit.launch();
  const cases = [
    { name: "empty storage", values: {} },
    { name: "invalid JSON", values: { "open-tabs": "{broken", open: "[broken", active: "not-json" } },
    { name: "open-tabs object", values: { "open-tabs": JSON.stringify({ tab: "fixture" }) } },
    { name: "open-tabs null", values: { "open-tabs": "null" } },
    { name: "open-tabs string", values: { "open-tabs": JSON.stringify("fixture-tab") } },
    { name: "mounted agents object", values: { open: JSON.stringify({ agent: "fixture" }) } },
    { name: "mounted agents null", values: { open: "null" } },
    { name: "last-tab null", values: { "last-tab": "null" } },
    { name: "storage read denied", values: {}, blocked: true },
  ];
  for (const fixture of cases) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    await context.route("**/*", (route) => new URL(route.request().url()).origin === base ? route.continue() : route.abort());
    await context.addInitScript(({ values, blocked }) => {
      for (const [key, value] of Object.entries(values)) localStorage.setItem(`agent-base:${key}`, value);
      if (blocked) {
        Storage.prototype.getItem = () => { throw new DOMException("fixture read denied", "SecurityError"); };
        Storage.prototype.setItem = () => { throw new DOMException("fixture write denied", "SecurityError"); };
      }
    }, fixture);
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    try {
      await page.goto(base);
      const shell = page.getByRole("button", { name: "Show or hide the side nav", exact: true });
      const usable = await shell.isVisible() || await shell.waitFor({ timeout: 5000 }).then(() => true).catch(() => false);
      check(`Storage ${fixture.name}: shell survives`, usable && errors.length === 0, { usable, errors: errors.slice(0, 3), fixtureKeys: Object.keys(fixture.values) });
      if (!usable && fixture.name === "open-tabs object") await page.screenshot({ path: path.join(evidence, "storage-open-tabs-object.png") });
      if (usable) {
        await shell.click();
        check(`Storage ${fixture.name}: sidebar control works`, await shell.getAttribute("aria-pressed") === "false");
      }
    } catch (error) {
      check(`Storage ${fixture.name}: case completed`, false, { error: String(error.message).slice(0, 300) });
    } finally { await context.close(); }
  }
} catch (error) {
  check("Storage suite starts", false, { error: String(error.message).slice(0, 300) });
} finally {
  await browser?.close();
  const exited = new Promise((resolve) => node.once("exit", resolve));
  node.kill();
  if (node.exitCode === null) await exited;
  rmSync(scratch, { recursive: true, force: true });
}
console.log(JSON.stringify({ passed: results.filter(Boolean).length, of: results.length }));
process.exitCode = results.every(Boolean) ? 0 : 1;
