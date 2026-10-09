import { suitePort } from './suite-runtime.mjs';
// Check t-0139 (Shaan: "I don't like selecting projects I should be able to just tell the agent and he knows what project
// is in"): a + under Agent Zero's strip takes his words alone; the node names the agent, finds its project from the
// words (a project's name, or a domain one of its agents owns), starts it in its own herdr tab under siso-host with his
// words as its first message, and the app opens its chat once herdr lists it. Or the words go to Agent Zero instead.
// No real agent and no real Claude: a fake herdr (it runs what the node types into a pane with /bin/sh) and a fake
// siso-host that records its argv and cwd. WebKit at 1440 and 390. Usage: node services/node/test/say-start-ui.mjs
import { spawn } from "node:child_process";
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { webkit } from './suite-runtime.mjs';
import { fromWords } from "../src/say-start.ts";

const REPO = path.join(import.meta.dirname, "../../..");
const PORT = await suitePort();
const BASE = `http://127.0.0.1:${PORT}`;
const SHOTS = process.argv[2] ?? path.join(import.meta.dirname, ".shots-say-start");
mkdirSync(SHOTS, { recursive: true });
const scratch = realpathSync(mkdtempSync(path.join(process.env.TMPDIR ?? tmpdir(), ".siso-ephemeral-say-start.")));
const results = [];
const check = (name, ok, detail = {}) => {
  results.push(!!ok);
  console.log(JSON.stringify({ check: name, ok: !!ok, ...detail }));
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const lines = (f) => (existsSync(f) ? readFileSync(f, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []);
const after = (argv, f) => argv[argv.indexOf(f) + 1];

// 0. The rule itself, on a table like his.
const PROJECTS = [{ id: "halo", name: "HALO" }, { id: "agent-base", name: "Agent Base" }, { id: "estate", name: "Estate" }, { id: "efficiency", name: "Efficiency" }];
const AGENTS = { "STREAMING-CLAUDE": { project: "HALO", domain: "Streaming go-live" }, "HALO-UI": { project: "HALO", domain: "CRM UI" }, "AGENT-BASE": { project: "Agent Base", domain: "Agent Base" }, ESTATE: { project: "Estate", domain: "Estate" } };
const pick = (w, taken = []) => fromWords(w, { projects: PROJECTS, agents: AGENTS, taken: new Set(taken) });
const cases = [
  [pick("fix the CRM login bug"), { name: "CRM-LOGIN", project: "HALO" }],
  [pick("make the Agent Base side nav faster"), { name: "SIDE-NAV", project: "Agent Base" }],
  [pick("check the HALO stream overnight"), { name: "STREAM-OVERNIGHT", project: "HALO" }],
  [pick("write a poem about tea"), { name: "POEM-TEA", project: null }],
  [pick("fix the CRM login bug", ["CRM-LOGIN"]), { name: "CRM-LOGIN-2", project: "HALO" }],
  [pick("tidy the estate and the agent base docs"), { name: "ESTATE-BASE", project: null }],
];
check("the rule: the project from his words (name or an owner's domain), a name from what it is for, unique; none or a tie is no project", cases.every(([got, want]) => got.name === want.name && got.project === want.project), { got: cases.map(([g]) => `${g.name}@${g.project}`) });

// The fake siso-host and herdr (as sdk-start.mjs): a tab create answers with its root pane; pane run runs the command.
const hostLog = path.join(scratch, "host.jsonl");
const HOST_BIN = path.join(scratch, "fake-siso-host");
writeFileSync(HOST_BIN, `#!${process.execPath}
require("node:fs").appendFileSync(${JSON.stringify(hostLog)}, JSON.stringify({ argv: process.argv.slice(2), cwd: process.cwd() }) + "\\n");
`);
chmodSync(HOST_BIN, 0o755);
const herdrLog = path.join(scratch, "herdr.jsonl");
const agentsFile = path.join(scratch, "agents.json");
const tabs = path.join(scratch, "tabs.json");
const HERDR = path.join(scratch, "fake-herdr.mjs");
writeFileSync(HERDR, `import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";
const a = process.argv.slice(2);
appendFileSync(${JSON.stringify(herdrLog)}, JSON.stringify(a) + "\\n");
const out = (v) => console.log(JSON.stringify(v));
const tabs = existsSync(${JSON.stringify(tabs)}) ? JSON.parse(readFileSync(${JSON.stringify(tabs)}, "utf8")) : {};
if (a[0] === "agent" && a[1] === "list") out({ result: { agents: JSON.parse(readFileSync(${JSON.stringify(agentsFile)}, "utf8")) } });
else if (a[0] === "tab" && a[1] === "create") {
  const n = Object.keys(tabs).length + 9;
  tabs["w7:p" + n] = a[a.indexOf("--cwd") + 1];
  writeFileSync(${JSON.stringify(tabs)}, JSON.stringify(tabs));
  out({ result: { tab: { tab_id: "w7:t" + n }, root_pane: { pane_id: "w7:p" + n } } });
} else if (a[0] === "pane" && a[1] === "run") {
  execSync(a[3], { shell: "/bin/sh", cwd: tabs[a[2]] ?? ${JSON.stringify(scratch)} });
  out({});
} else out({});
`);
const halo = path.join(scratch, "halo"), base = path.join(scratch, "agent-base");
for (const d of [halo, base]) mkdirSync(d, { recursive: true });
const ZERO = { agent: "claude", agent_status: "idle", cwd: "/tmp", pane_id: "w7:p1", terminal_id: "term_ss1", terminal_title_stripped: "A0" };
writeFileSync(agentsFile, JSON.stringify([ZERO]));
writeFileSync(path.join(scratch, "seat.json"), JSON.stringify({ pane: "w7:p1" }));
const registryFile = path.join(scratch, "registry.json");
writeFileSync(registryFile, JSON.stringify({
  projects: [{ id: "halo", name: "HALO", group: "agency", shown: true, order: 0, path: halo }, { id: "agent-base", name: "Agent Base", group: "labs", shown: true, order: 1, path: base }],
  agents: { "HALO-UI": { project: "HALO", kind: "owner", domain: "CRM UI" }, "AGENT-BASE": { project: "Agent Base", kind: "owner", domain: "Agent Base" } },
  domains: [],
}));
const a0Tasks = path.join(scratch, "a0/tasks");
mkdirSync(a0Tasks, { recursive: true });
writeFileSync(path.join(a0Tasks, "INDEX.json"), JSON.stringify({ tasks: [] }));
const CLI = path.join(scratch, "a0/bin/a0-task");
mkdirSync(path.dirname(CLI), { recursive: true });
copyFileSync(path.join(process.env.HOME, "SISO_Workspace/SISO_Agents/agent-zero/siso-agent-zero/bin/a0-task"), CLI);
const node = spawn(process.execPath, ["--experimental-strip-types", "--no-warnings", "src/server.ts"], {
  cwd: path.join(REPO, "services/node"),
  env: {
    ...process.env, HOME: scratch, AB_PORT: String(PORT), AB_HERDR: `${process.execPath} ${HERDR}`, AB_HOST_BIN: HOST_BIN, AB_AGENT_BOOT: path.join(scratch, "none.json"),
    AB_NEW_AGENT_CLAUDE_DIR: path.join(scratch, "claude"), AB_CLAUDE_DIRS: path.join(scratch, "claude"), AB_HOSTS_DIR: path.join(scratch, "hosts"), AB_STATE: path.join(scratch, "rows.json"),
    AB_REGISTRY: registryFile, AB_A0_SEAT: path.join(scratch, "seat.json"), AB_A0_TASKS: a0Tasks, AB_A0_TASK_CMD: CLI, AB_RESURRECT_DIR: path.join(scratch, "none"), AB_CONSOLE_EVENTS: path.join(scratch, "none.jsonl"), AB_ORG_HOME: scratch, AB_HUB_HOME: scratch,
  },
  stdio: ["ignore", "ignore", "pipe"],
});
let nodeErr = "";
node.stderr.on("data", (d) => (nodeErr += d));
let browser = null;
try {
  for (let i = 0; i < 150 && !(await fetch(`${BASE}/api/health`).then((r) => r.ok, () => false)); i++) await sleep(200);

  // 1. The route: empty words are refused and start nothing.
  const empty = await fetch(`${BASE}/api/agents/start`, { method: "POST", body: JSON.stringify({ say: "   " }) });
  check("empty words are refused (400) and start nothing", empty.status === 400 && lines(hostLog).length === 0, { status: empty.status });

  browser = await webkit.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(BASE);
  const plus = page.locator("[data-testid=zero-new-agent]");
  await plus.waitFor({ timeout: 25000 }).catch(async (error) => {
    await page.screenshot({ path: path.join(SHOTS, "say-new-fixture-failure.png") });
    console.log(JSON.stringify({ fixtureAgents: await fetch(`${BASE}/api/agents`).then((r) => r.json()), body: (await page.locator("body").innerText()).slice(0, 500) }));
    throw error;
  });

  // 2. The + opens the box under Agent Zero's strip; his words and Enter start it, no project picked.
  await plus.click();
  const input = page.locator("[data-testid=say-new-input]");
  await input.fill("fix the CRM login bug on the staff page");
  await page.screenshot({ path: path.join(SHOTS, "say-new-1440.png") });
  await input.press("Enter");
  for (let i = 0; i < 60 && !lines(hostLog).length; i++) await sleep(100);
  const [first] = lines(hostLog);
  const created = lines(herdrLog).find((a) => a[0] === "tab" && a[1] === "create") ?? [];
  check("his words start CRM-LOGIN in HALO's folder, in its own tab, under siso-host, his words its first message",
    after(first?.argv ?? [], "--name") === "CRM-LOGIN" && first?.cwd === halo && after(created, "--label") === "CRM-LOGIN" && after(first.argv, "--prompt") === "fix the CRM login bug on the staff page",
    { argv: first?.argv?.slice(0, 6), cwd: first?.cwd, created: created.slice(0, 6) });
  const note = page.locator("[data-testid=say-new-note]");
  await note.waitFor({ timeout: 5000 });
  const noteText = await note.innerText();
  const reg = JSON.parse(readFileSync(registryFile, "utf8"));
  check("the box says what started and where; the table files it under HALO", noteText === "Starting CRM-LOGIN in HALO." && reg.agents?.["CRM-LOGIN"]?.project === "HALO", { noteText, row: reg.agents?.["CRM-LOGIN"] });
  await page.screenshot({ path: path.join(SHOTS, "say-new-started-1440.png") });

  // 3. Once herdr lists it, its chat opens.
  writeFileSync(agentsFile, JSON.stringify([ZERO, { agent: "claude", agent_status: "working", cwd: halo, pane_id: "w7:p9", terminal_id: "term_ss9", terminal_title_stripped: "CRM-LOGIN" }]));
  const opened = await page.waitForFunction(() => document.querySelector("[data-testid=chat-head] .ab-head__name")?.textContent?.trim() === "CRM-LOGIN", null, { timeout: 10000 }).then(() => true, () => false);
  check("its chat opens once herdr lists it", opened, {});

  // 4. Words that name no project: it still starts, unplaced, and the box says Agent Zero places it.
  await input.fill("write a poem about tea");
  await page.locator("[data-testid=say-new-start]").click();
  for (let i = 0; i < 60 && lines(hostLog).length < 2; i++) await sleep(100);
  const second = lines(hostLog)[1];
  await page.waitForFunction(() => /POEM-TEA/.test(document.querySelector("[data-testid=say-new-note]")?.textContent ?? ""), null, { timeout: 5000 }).catch(() => {});
  const note2 = await note.innerText();
  check("no project in his words: it starts unplaced, and the box says Agent Zero places it", after(second?.argv ?? [], "--name") === "POEM-TEA" && second?.cwd === scratch && /Agent Zero places it/.test(note2) && !JSON.parse(readFileSync(registryFile, "utf8")).agents?.["WRITE-POEM"]?.project, { note2, cwd: second?.cwd });

  // 5. Ask Agent Zero: the words become a task, without starting another agent here.
  await input.fill("someone to sort out the property paperwork");
  await page.locator("[data-testid=say-new-ask]").click();
  await page.waitForFunction(() => /Agent Zero has it/.test(document.querySelector("[data-testid=say-new-note]")?.textContent ?? ""), null, { timeout: 5000 });
  const index = JSON.parse(readFileSync(path.join(a0Tasks, "INDEX.json"), "utf8"));
  const task = JSON.parse(readFileSync(path.join(a0Tasks, `${index.tasks[0].id}.json`), "utf8"));
  check("Ask Agent Zero creates a thought task with his words and starts nothing", task.his === "Start a new agent for this, in the project it belongs to: someone to sort out the property paperwork" && task.owner === "A0" && task.stage === "thought" && task.project === "Agent Zero" && lines(hostLog).length === 2 && await note.innerText() === "Agent Zero has it: it's on the task list.", { id: task.id, his: task.his });
  await page.screenshot({ path: path.join(SHOTS, "say-new-asked-1440.png") });


  // 6. Esc closes the box; at 390 it fits the screen.
  await input.press("Escape");
  const closed = (await page.locator("[data-testid=say-new]").count()) === 0;
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(BASE);
  // On a phone the side nav is the overlay from the nav button.
  if (!(await plus.isVisible().catch(() => false))) await page.locator("button[aria-label='Show or hide the side nav']").click().catch(() => {});
  await plus.click({ timeout: 8000 });
  const box = await page.locator("[data-testid=say-new]").boundingBox();
  await page.screenshot({ path: path.join(SHOTS, "say-new-390.png") });
  check("Esc closes it; at 390 the box fits the screen", closed && !!box && box.x >= 0 && box.x + box.width <= 390, { closed, box });
  check("no page errors", errors.length === 0, { errors: errors.slice(0, 3) });
} catch (e) {
  check("ran to the end", false, { error: String(e?.stack ?? e).slice(0, 500), node: nodeErr.slice(-400) });
} finally {
  await browser?.close();
  node.kill();
  rmSync(scratch, { recursive: true, force: true });
}
console.log(JSON.stringify({ passed: results.filter(Boolean).length, of: results.length }));
process.exit(results.every(Boolean) ? 0 : 1);
