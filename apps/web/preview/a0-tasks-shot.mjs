// WebKit Tasks page check against a temporary store and a copied a0-task CLI. No live agents or tasks.
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { cp, copyFile, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { suitePort, webkit } from "../../../services/node/test/suite-runtime.mjs";

const repo = resolve(import.meta.dirname, "../../..");
const lab = await mkdtemp(join(tmpdir(), ".siso-ephemeral-a0-tasks-shot-"));
const root = join(lab, "a0/tasks");
const cli = join(lab, "a0/bin/a0-task");
const shots = process.argv[2] ?? join(import.meta.dirname, ".shots-a0-tasks");
await mkdir(shots, { recursive: true });
await mkdir(join(lab, "a0/bin"), { recursive: true });
if (process.env.AB_A0_LAB) await cp(process.env.AB_A0_LAB, join(lab, "a0"), { recursive: true });
await copyFile(join(homedir(), "SISO_Workspace/SISO_Agents/agent-zero/siso-agent-zero/bin/a0-task"), cli);
const run = (...args) => execFileSync(cli, args, { encoding: "utf8" }).trim();
if (!process.env.AB_A0_LAB) {
  run("add", "Keep Agent Zero reachable", "--his=Keep Agent Zero reachable from the app", "--project=Agent Base", "--owner=A0", "--stage=thought", "--priority=P1");
  run("add", "Review the front door", "--his=Let me check the front door", "--project=Agent Base", "--owner=shaan", "--stage=feedback");
}
const port = await suitePort();
const base = `http://127.0.0.1:${port}`;
const node = spawn(process.execPath, ["--experimental-strip-types", "--no-warnings", "src/server.ts"], {
  cwd: join(repo, "services/node"), stdio: "ignore", env: {
    ...process.env, AB_PORT: String(port), AB_A0_TASKS: root, AB_A0_TASK_CMD: cli,
    AB_HERDR: `${process.execPath} ${join(repo, "services/node/test/fake-herdr.mjs")}`,
    FAKE_HERDR_AGENTS: JSON.stringify([{ agent: "claude", agent_status: "idle", cwd: "/tmp", pane_id: "w1:p1", terminal_id: "term_a0_tasks", terminal_title_stripped: "A0" }]),
    AB_HUB_HOME: lab, AB_ORG_HOME: lab, AB_CLAUDE_DIRS: join(lab, "claude"), AB_REGISTRY: join(lab, "registry.json"),
    AB_STATE: join(lab, "rows.json"), AB_HOSTS_DIR: join(lab, "hosts"), AB_RESURRECT_DIR: join(lab, "none"), AB_CONSOLE_EVENTS: join(lab, "none.jsonl"),
  },
});
let browser;
let checks = 0;
try {
  for (let i = 0; i < 100; i++) {
    if (await fetch(`${base}/api/health`).then((r) => r.ok, () => false)) break;
    await new Promise((done) => setTimeout(done, 100));
  }
  browser = await webkit.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(base);
  await page.locator('[data-testid=top-nav] button[aria-label=Tasks]').click();
  await page.locator('[data-testid=task-row]').first().waitFor();
  const tasks = JSON.parse(await readFile(join(root, "INDEX.json"), "utf8")).tasks;
  assert.ok(tasks.length >= 2); checks++;
  await page.locator("[data-testid=a0-tasks-page] [data-tab=now]").click();
  await page.mouse.move(1000, 700);
  await page.screenshot({ path: join(shots, "tasks-restored.png") });

  const input = page.locator('.a0-tell input');
  const words = 'Please keep both ways to talk to Agent Zero working';
  await input.fill(words);
  const response = page.waitForResponse((r) => r.url().endsWith('/api/a0/tell') && r.request().method() === 'POST');
  await page.locator('.a0-tell button').click();
  const told = await response;
  assert.equal(told.status(), 200); checks++;
  const body = await told.json();
  assert.equal(body.ok, true);
  const task = JSON.parse(await readFile(join(root, `${body.id}.json`), "utf8"));
  assert.equal(task.his, words);
  assert.equal(task.owner, 'A0');
  assert.equal(task.stage, 'thought');
  assert.equal(task.project, 'Agent Zero'); checks++;
  await page.getByText("On Agent Zero's task list.", { exact: true }).waitFor();
  assert.equal(await input.inputValue(), ''); checks++;
  await page.locator(`[data-testid=task-row][data-id="${body.id}"]`).waitFor({ timeout: 2000 }); checks++;
  await page.screenshot({ path: join(shots, "tasks-told.png") });

  // The current page opens a task in place; CLI moves reach it through the event stream.
  await page.locator(`[data-id="${body.id}"] .ab-trow__line`).click();
  await page.locator('[data-testid=task-open]').waitFor(); checks++;
  const start = Date.now();
  run('move', body.id, 'building', '--by=A0');
  await page.locator(`[data-id="${body.id}"].is-building`).waitFor({ timeout: 2000 });
  const liveMs = Date.now() - start;
  assert.ok(liveMs < 2000); checks++;
  assert.deepEqual(errors, []); checks++;
  console.log(`a0-tasks-shot: ${checks}/${checks} passed; HTTP ${told.status()}; ${body.id}.json his=${JSON.stringify(task.his)}; move ${liveMs} ms`);
} finally {
  await browser?.close();
  node.kill();
  await rm(lab, { recursive: true, force: true });
}
