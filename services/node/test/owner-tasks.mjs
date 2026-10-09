import { suitePort } from './suite-runtime.mjs';
// Check (R1.17, Shaan 19:5x: "i can actually view my tasks list in ... that owner's chat ... a simpler way a list way"):
// an owner's Tasks list beside its chat, from the header and from its side-nav count; edits go through the a0-task CLI.
// Current navigation opens the Tasks dashboard card, then its full list; sorting and mutation contracts are unchanged.
//   node services/node/test/owner-tasks.mjs [shots-dir]
// A fixture task store: the real a0-task CLI copied into a scratch root (it keeps its tasks beside itself), so the live
// store is never read or written. A fake herdr lists the agents; nothing live is attached to.
import { execFileSync, spawn } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import net from "node:net";
import { webkit } from './suite-runtime.mjs';

const REPO = path.join(import.meta.dirname, "../../..");
const [shots = null] = process.argv.slice(2);
const PORT = await suitePort();
const BASE = `http://127.0.0.1:${PORT}`;
const reserve = net.createServer();
await new Promise(r => reserve.listen(0, "127.0.0.1", r));
const WEB_PORT = reserve.address().port;
await new Promise(r => reserve.close(r));
const WEB = process.env.AB_WEB_DIST ? BASE : `http://127.0.0.1:${WEB_PORT}`;
const scratch = mkdtempSync(path.join(process.env.TMPDIR ?? tmpdir(), ".siso-ephemeral-owner-tasks."));
const results = [];
const check = (name, ok, detail = {}) => {
  results.push(!!ok);
  console.log(JSON.stringify({ check: name, ok: !!ok, ...detail }));
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// The store: t-0001 building P1, t-0002 allocated P0 (shared with A0), t-0003 thought P2 with a NOW next step,
// t-0004 another owner's, t-0005 dropped (Done).
const fm = path.join(scratch, "fm");
mkdirSync(path.join(fm, "bin"), { recursive: true });
mkdirSync(path.join(fm, "tasks"), { recursive: true });
const CLI = path.join(fm, "bin/a0-task");
copyFileSync(path.join(process.env.HOME, "SISO_Workspace/SISO_Agents/agent-zero/siso-agent-zero/bin/a0-task"), CLI);
const cli = (...args) => execFileSync(CLI, args, { encoding: "utf8" });
cli("add", "Quiet events in every chat", "--his=fold the pings", "--project=Agent Base", "--priority=P1", "--stage=building", "--owner=AGENT-BASE");
cli("add", "Owner's Tasks list", "--his=a list way", "--project=Agent Base", "--priority=P0", "--stage=allocated", "--owner=AGENT-BASE + A0");
cli("add", "Decide the release order", "--his=order", "--project=Agent Base", "--priority=P2", "--stage=thought", "--owner=AGENT-BASE");
cli("set", "t-0003", "next=NOW: pick R1.15 or R1.2", "--by=A0");
cli("add", "Auto viewer", "--his=viewer", "--project=HALO", "--priority=P1", "--stage=specced", "--owner=STREAMING-CLAUDE (AUTO-VIEWER)");
cli("add", "Old idea", "--his=old", "--project=Agent Base", "--stage=thought", "--owner=AGENT-BASE");
cli("move", "t-0005", "dropped", "--his=superseded", "--by=A0");
const show = (id) => JSON.parse(cli("show", id));
const ownsBase = (o) => String(o ?? "").split(/[+,/]/).map((s) => s.replace(/\([^)]*\)\s*$/, "").trim().toUpperCase()).includes("AGENT-BASE");
const openInCli = () => JSON.parse(cli("list", "--json")).filter((t) => ownsBase(t.owner) && !["live", "happy", "dropped"].includes(t.stage)).length;

// One agent with a chat (a fixture session) so the header and panel sit beside a real chat view.
const CWD = "/fake/owner-tasks";
const SESSION = "owner-tasks-1";
const projects = path.join(scratch, "claude/projects", CWD.replace(/[^A-Za-z0-9]/g, "-"));
mkdirSync(projects, { recursive: true });
const at = new Date().toISOString();
writeFileSync(
  path.join(projects, `${SESSION}.jsonl`),
  [
    { type: "user", uuid: "u1", timestamp: at, message: { role: "user", content: "What's on your plate?" } },
    { type: "assistant", uuid: "a1", timestamp: at, message: { role: "assistant", content: [{ type: "text", text: "Three open tasks; the list is beside this chat." }] } },
  ].map((l) => JSON.stringify(l)).join("\n") + "\n",
);
const AGENTS = [
  { agent: "claude", agent_status: "idle", cwd: CWD, pane_id: "w1:p1", terminal_id: "term_ot1", terminal_title_stripped: "AGENT-BASE", agent_session: { value: SESSION } },
  { agent: "claude", agent_status: "idle", cwd: "/tmp", pane_id: "w1:p2", terminal_id: "term_ot2", terminal_title_stripped: "HEALTH" },
];
// t-0008: an agent with no project sits under Agent Zero's card; as the owner of its own project it keeps a rail row.
writeFileSync(path.join(scratch, "registry.json"), JSON.stringify({ projects: ["Agent Base"], agents: { "AGENT-BASE": { project: "Agent Base", workspace: "agent-base", kind: "owner", main: true, domain: "AGENT-BASE" } } }));
const node = spawn(process.execPath, ["--experimental-strip-types", "--no-warnings", "src/server.ts"], {
  cwd: path.join(REPO, "services/node"),
  env: { ...process.env, AB_PORT: String(PORT), AB_HERDR: `${process.execPath} ${path.join(REPO, "services/node/test/fake-herdr.mjs")}`, FAKE_HERDR_AGENTS: JSON.stringify(AGENTS), AB_A0_TASKS: path.join(fm, "tasks"), AB_A0_TASK_CMD: CLI, AB_CLAUDE_DIRS: path.join(scratch, "claude"), AB_HOSTS_DIR: path.join(scratch, "hosts"), AB_STATE: path.join(scratch, "rows.json"), AB_REGISTRY: path.join(scratch, "registry.json"), AB_RESURRECT_DIR: path.join(scratch, "none"), AB_CONSOLE_EVENTS: path.join(scratch, "none.jsonl"), AB_A0_SEAT: path.join(scratch, "seat.json") },
  stdio: process.env.DEBUG_NODE ? "inherit" : "ignore",
});
const post = (id, body) => fetch(`${BASE}/api/a0/tasks/${id}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).then(async (r) => ({ status: r.status, body: await r.json() }));
let browser = null;
let web = null;
try {
  for (let i = 0; i < 50; i++) {
    try {
      if ((await fetch(`${BASE}/api/health`)).ok) break;
    } catch {}
    await sleep(200);
  }

  const tell = (body, origin = BASE) => fetch(`${BASE}/api/a0/tell`, { method: "POST", headers: { "content-type": "application/json", origin }, body: JSON.stringify(body) }).then(async (r) => ({ status: r.status, body: await r.json() }));
  const words = `--literal $(touch ${path.join(scratch, "tell-pwned")})\nkeep the front door open`;
  const told = await tell({ text: words, project: "Agent Base" });
  const task = told.body.id ? show(told.body.id) : {};
  check("tell creates a task file with his normalised words, project, owner A0 and thought stage; no shell", told.status === 200 && told.body.ok && existsSync(path.join(fm, "tasks", `${told.body.id}.json`)) && task.his === words.replace(/\s*\n+\s*/g, " / ").replace(/\s+/g, " ").trim() && task.owner === "A0" && task.stage === "thought" && task.project === "Agent Base" && !existsSync(path.join(scratch, "tell-pwned")), { status: told.status, id: told.body.id, his: task.his });
  const defaulted = await tell({ text: "x".repeat(2000) });
  const defaultTask = defaulted.body.id ? show(defaulted.body.id) : {};
  check("tell accepts 2000 characters, defaults to Agent Zero and cuts title to 120", defaulted.status === 200 && defaultTask.project === "Agent Zero" && defaultTask.his?.length === 2000 && defaultTask.title?.length === 120, { status: defaulted.status, title: defaultTask.title?.length, his: defaultTask.his?.length });
  const badTells = await Promise.all([tell({ text: " " }), tell({ text: "x".repeat(2001) }), tell({ text: "refused" }, "https://another-site.invalid")]);
  check("tell rejects empty, over-limit and foreign-origin requests", badTells.map((r) => r.status).join() === "400,400,403" && badTells.every((r) => r.body.error), { statuses: badTells.map((r) => r.status) });

  // The route: never a shell, only flywheel stages, a drop needs a reason.
  const pwned = path.join(scratch, "pwned");
  const inj = await post("t-0004", { next: `$(touch ${pwned}); \`touch ${pwned}\` --by=A0` });
  await sleep(300);
  check("the route never runs a shell: shell syntax is stored as text", inj.status === 200 && !existsSync(pwned) && show("t-0004").next === `$(touch ${pwned}); \`touch ${pwned}\` --by=A0`, { status: inj.status, next: show("t-0004").next });
  const bogus = await post("t-0004", { stage: "shipped; rm -rf" });
  const noWhy = await post("t-0004", { stage: "dropped" });
  const badId = await post("..%2Fx", { priority: "P1" });
  check("it rejects a stage outside the flywheel, a reasonless drop and a bad id", bogus.status === 400 && noWhy.status === 400 && badId.status === 400 && show("t-0004").stage === "specced", { bogus: bogus.body, noWhy: noWhy.body, badId: badId.status });

  if (!process.env.AB_WEB_DIST) web = spawn("pnpm", ["--filter", "@agent-base/web", "dev", "--host", "127.0.0.1"], { cwd: REPO, env: { ...process.env, AB_WEB_PORT: String(WEB_PORT), AB_NODE: String(PORT) }, stdio: "ignore" });
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(WEB)).ok) break; } catch {}
    await sleep(100);
  }
  if (shots) mkdirSync(shots, { recursive: true });
  console.log('FIXTURE browser launch');
  browser = await webkit.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
  page.setDefaultTimeout(15000);
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const prepare = pg => pg.addInitScript(() => { localStorage.setItem("agent-base:sidebar-open", "true"); localStorage.setItem("agent-base:browser-setup", JSON.stringify({ step: 4, doneAt: 1 })); });
  const openOwner = async pg => {
    const toggle = pg.getByRole("button", { name: "Toggle Agent Base owners", exact: true });
    if (await toggle.getAttribute("aria-expanded") !== "true") await toggle.click();
    await pg.locator('[data-workspace="agent-base"] [data-owner="term_ot1"]').click();
  };
  await prepare(page);
  console.log('FIXTURE navigate owner');
  await page.goto(WEB, { waitUntil: "domcontentloaded", timeout: 60000 });
  console.log('FIXTURE select owner');
  await openOwner(page);
  // The header's Tasks is in the capsule's right-click menu (ui-hub chat-header, 4 Oct: no Tasks pill).
  const openTasks = async (pg) => { await pg.locator(".ab-cap").waitFor({ timeout: 15000 }); await pg.locator(".ab-cap").click({ button: "right", position: { x: 200, y: 20 } }); await pg.locator("[data-testid=chat-tasks]").click(); await pg.getByTestId("fold-tasks").locator(".ab-fold__head").click(); };
  await openTasks(page);
  const panel = page.getByTestId("tasks-page-view");
  await panel.waitFor({ timeout: 5000 });
  await page.waitForTimeout(400);
  const nowSelected = await panel.locator('[data-group="now"]').getAttribute("aria-pressed");
  await panel.locator('[data-group="owner"]').click();
  const openCount = async pg => Number((await pg.locator('.ab-tpage__foot > span').innerText()).match(/(\d+) open/)[1]);
  const tabs = [`Open ${await openCount(panel)}`, await panel.locator('.ab-tpage__foot .ab-more').innerText()];
  const ids = await panel.locator("[data-testid=owner-task]").evaluateAll((els) => els.map((e) => e.getAttribute("data-id")));
  const now = (await panel.locator('[data-id="t-0003"]').count()) && (await panel.locator('[data-id="t-0003"] .owner-panel__now, [data-id="t-0003"] .a0-prio').count()) === 0 ? 1 : 0; // SPEC-PANEL-CARDS §4: NOW and P are the order, not drawn
  check("the header's Tasks opens the Plan list; Open N equals a0-task list's open tasks naming AGENT-BASE", nowSelected === "true" && tabs[0] === `Open ${openInCli()}` && tabs[1] === "Done 1", { nowSelected, tabs, cli: openInCli() });
  check("NOW first, then P0 → P3; another owner's task is not listed", ids.join(",") === "t-0003,t-0002,t-0001" && now === 1, { ids });
  const chatBox = await page.locator("[data-testid=chat-view]:visible").boundingBox();
  const panelBox = await page.locator("[data-testid=agent-panel]").boundingBox();
  check("the panel sits right of the chat, 360 px, and the chat stays in view", Math.round(panelBox.width) === 360 && chatBox.x + chatBox.width <= panelBox.x + 1 && chatBox.width > 500, { chat: chatBox, panel: panelBox });

  await page.locator("[data-testid=chat-panel-toggle]").click();
  await page.locator("[data-testid=agent-panel]").waitFor({ state: "detached", timeout: 3000 });
  // Current workspace navigation: select its owner, then open the panel's Tasks view.
  console.log('FIXTURE select owner');
  await openOwner(page);
  await page.getByTestId("chat-panel-toggle").click();
  await page.getByTestId("panel-tab-tasks").click();
  await page.waitForTimeout(300);
  check("the same owner task list opens after choosing AGENT-BASE in its workspace and the Tasks panel tab", await panel.isVisible() && await openCount(panel) === openInCli());

  // A second window watches the same list while the first moves t-0001 to built.
  const other = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
  other.setDefaultTimeout(15000);
  await prepare(other);
  await other.goto(WEB, { waitUntil: "domcontentloaded", timeout: 60000 });
  await openOwner(other);
  await openTasks(other);
  await other.locator('[data-testid=tasks-page-view] [data-group="owner"]').click();
  await other.locator('[data-testid=tasks-page-view] [data-id="t-0001"]').waitFor({ timeout: 10000 });
  await panel.locator('[data-group="owner"]').click();

  await panel.locator('[data-id="t-0001"] .ab-task__line').click();
  await panel.locator('[data-id="t-0001"] > .ab-task__plan > details > summary').click();
  await panel.locator('[data-id="t-0001"] [aria-label=Stage] button', { hasText: /^built$/ }).click();
  const t0 = Date.now();
  let seen = null;
  while (Date.now() - t0 < 4000) {
    if (((await other.locator('[data-testid=tasks-page-view] [data-id="t-0001"] .ab-task__dot').getAttribute("aria-label")) ?? "").startsWith("built")) {
      seen = Date.now() - t0;
      break;
    }
    await sleep(100);
  }
  const t1 = show("t-0001");
  check("a stage move lands in a0-task: built, with a history line by shaan", t1.stage === "built" && t1.history.at(-1)?.by === "shaan" && t1.history.at(-1)?.stage === "built", { stage: t1.stage, last: t1.history.at(-1) });
  check("a second window shows it within 2 s through the events stream", seen !== null && seen < 2000, { ms: seen });
  await other.close();

  await panel.locator('[data-id="t-0001"] [aria-label=Priority] button', { hasText: "P0" }).click();
  const next = panel.locator('[data-id="t-0001"] .ab-task__nextin');
  await next.fill("NOW: ship it");
  await next.press("Enter");
  await page.waitForTimeout(1500);
  const t1b = show("t-0001");
  const row = (await fetch(`${BASE}/api/a0/tasks`).then((r) => r.json())).tasks.find((t) => t.id === "t-0001");
  const order = await panel.locator("[data-testid=owner-task]").evaluateAll((els) => els.map((e) => e.getAttribute("data-id")));
  check("priority and next save through a0-task set, and the line moves to the top (NOW, P0)", t1b.priority === "P0" && t1b.next === "NOW: ship it" && row?.next === "NOW: ship it" && order[0] === "t-0001", { priority: t1b.priority, next: t1b.next, indexNext: row?.next, order });
  if (shots) await page.screenshot({ path: path.join(shots, "r1.17-panel-1440.png") });

  // Drop t-0002: Enter with no reason does nothing; with one it lands in Done.
  await panel.locator('[data-id="t-0002"] .ab-task__line').click();
  await panel.locator('[data-id="t-0002"] > .ab-task__plan > details > summary').click();
  await panel.locator('[data-id="t-0002"] .owner-panel__drop').click();
  const why = panel.locator('[data-id="t-0002"] .owner-panel__why');
  await why.press("Enter");
  await page.waitForTimeout(500);
  const kept = show("t-0002").stage;
  await why.fill("folded into R1.17");
  await why.press("Enter");
  await page.waitForTimeout(1500);
  await panel.locator('.ab-tpage__foot .ab-more').click();
  const doneIds = await panel.locator("[data-testid=owner-task]").evaluateAll((els) => els.map((e) => e.getAttribute("data-id")));
  check("Drop needs a reason and lands the task in Done", kept === "allocated" && show("t-0002").stage === "dropped" && doneIds.includes("t-0002"), { kept, doneIds });
  if (shots) {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.mouse.move(200, 830);
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(shots, "r1.17-panel-390.png") });
  }
  check("no page errors", errors.length === 0, { errors });
} catch (error) {
  if (browser) for (const [i, page] of browser.contexts().flatMap(c => c.pages()).entries()) {
    console.log('UI FAILURE STATE:', (await page.locator('body').innerText().catch(() => '')).slice(0, 5000));
    if (shots) await page.screenshot({ path: path.join(shots, `failure-${i}.png`), timeout: 5000 }).catch(() => {});
  }
  throw error;
} finally {
  await browser?.close();
  web?.kill();
  node.kill();
  rmSync(scratch, { recursive: true, force: true });
}
const passed = results.filter(Boolean).length;
console.log(JSON.stringify({ passed, of: results.length }));
process.exit(passed === results.length ? 0 : 1);
