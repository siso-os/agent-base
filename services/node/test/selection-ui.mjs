import { suitePort } from './suite-runtime.mjs';
// Check t-0265 (Shaan 3 Oct: "sometimes I keep auto switching to the efficiency agent"): every change of the open agent
// is recorded with its cause, in the app (localStorage, last 200) and by the node (selection.jsonl beside the row state,
// names only); the app never switches on its own while he types or within 10 s of his own pick; ⌘⇧← in a text box
// selects text instead of going back. A fake herdr (tab create and pane run, as sdk-start) and a fake siso-host; no
// live agent. Usage: node services/node/test/selection-ui.mjs
import { spawn } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { webkit } from './suite-runtime.mjs';

const REPO = path.join(import.meta.dirname, "../../..");
const PORT = await suitePort();
const BASE = `http://127.0.0.1:${PORT}`;
const scratch = realpathSync(mkdtempSync(path.join(process.env.TMPDIR ?? tmpdir(), ".siso-ephemeral-selection.")));
const results = [];
const check = (name, ok, detail = {}) => {
  results.push(!!ok);
  console.log(JSON.stringify({ check: name, ok: !!ok, ...detail }));
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const lines = (f) => (existsSync(f) ? readFileSync(f, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []);
const LOG = path.join(scratch, "state/selection.jsonl");

const hostLog = path.join(scratch, "host.jsonl");
const HOST_BIN = path.join(scratch, "fake-siso-host");
writeFileSync(HOST_BIN, `#!${process.execPath}\nrequire("node:fs").appendFileSync(${JSON.stringify(hostLog)}, JSON.stringify({ argv: process.argv.slice(2) }) + "\\n");\n`);
chmodSync(HOST_BIN, 0o755);
const agentsFile = path.join(scratch, "agents.json");
const tabs = path.join(scratch, "tabs.json");
const HERDR = path.join(scratch, "fake-herdr.mjs");
writeFileSync(HERDR, `import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";
const a = process.argv.slice(2);
const out = (v) => console.log(JSON.stringify(v));
const tabs = existsSync(${JSON.stringify(tabs)}) ? JSON.parse(readFileSync(${JSON.stringify(tabs)}, "utf8")) : {};
if (a[0] === "agent" && a[1] === "list") out({ result: { agents: JSON.parse(readFileSync(${JSON.stringify(agentsFile)}, "utf8")) } });
else if (a[0] === "tab" && a[1] === "create") {
  const n = Object.keys(tabs).length + 9;
  tabs["w7:p" + n] = a[a.indexOf("--cwd") + 1];
  writeFileSync(${JSON.stringify(tabs)}, JSON.stringify(tabs));
  out({ result: { tab: { tab_id: "w7:t" + n }, root_pane: { pane_id: "w7:p" + n } } });
} else if (a[0] === "pane" && a[1] === "run") (execSync(a[3], { shell: "/bin/sh" }), out({}));
else out({});
`);
const ag = (title, n, status = "idle") => ({ agent: "claude", agent_status: status, cwd: "/tmp", pane_id: `w7:p${n}`, terminal_id: `term_sel${n}`, terminal_title_stripped: title });
const ZERO = ag("A0", 1), EFF = ag("EFFICIENCY", 2, "working"), BASE_A = ag("AGENT-BASE", 3);
writeFileSync(agentsFile, JSON.stringify([ZERO, EFF, BASE_A]));
writeFileSync(path.join(scratch, "seat.json"), JSON.stringify({ pane: "w7:p1" }));
const halo = path.join(scratch, "halo");
mkdirSync(halo, { recursive: true });
mkdirSync(path.join(scratch, "state"), { recursive: true });
writeFileSync(path.join(scratch, "registry.json"), JSON.stringify({
  projects: [{ id: "halo", name: "HALO", group: "agency", shown: true, order: 0, path: halo }, { id: "agent-base", name: "Agent Base", group: "labs", shown: true, order: 1, path: scratch }],
  pinned: ["AGENT-BASE"],
  agents: { "HALO-UI": { project: "HALO", kind: "owner", domain: "CRM UI" }, "AGENT-BASE": { project: "Agent Base", kind: "owner", domain: "Agent Base" }, EFFICIENCY: { project: "Agent Base", kind: "owner", domain: "Efficiency" } },
  domains: [],
}));
const node = spawn(process.execPath, ["--experimental-strip-types", "--no-warnings", "src/server.ts"], {
  cwd: path.join(REPO, "services/node"),
  env: {
    ...process.env, HOME: scratch, AB_PORT: String(PORT), AB_HERDR: `${process.execPath} ${HERDR}`, AB_HOST_BIN: HOST_BIN, AB_AGENT_BOOT: path.join(scratch, "none.json"), AB_NEW_AGENT_CLAUDE_DIR: path.join(scratch, "claude"),
    AB_CLAUDE_DIRS: path.join(scratch, "claude"), AB_HOSTS_DIR: path.join(scratch, "hosts"), AB_STATE: path.join(scratch, "state/rows.json"), AB_REGISTRY: path.join(scratch, "registry.json"), AB_A0_SEAT: path.join(scratch, "seat.json"),
    AB_A0_TASKS: path.join(scratch, "a0/tasks"), AB_RESURRECT_DIR: path.join(scratch, "none"), AB_CONSOLE_EVENTS: path.join(scratch, "none.jsonl"), AB_ORG_HOME: scratch, AB_HUB_HOME: scratch, AB_SERVERS_FILE: path.join(scratch, "none-servers.json"),
  },
  stdio: ["ignore", "ignore", "pipe"],
});
let nodeErr = "";
node.stderr.on("data", (d) => (nodeErr += d));
let browser = null;
try {
  for (let i = 0; i < 150 && !(await fetch(`${BASE}/api/health`).then((r) => r.ok, () => false)); i++) await sleep(200);
  // The route: a cause is required; another site is refused.
  const bad = await fetch(`${BASE}/api/selection`, { method: "POST", body: JSON.stringify({ from: "X" }) });
  const foreign = await fetch(`${BASE}/api/selection`, { method: "POST", headers: { origin: "https://evil.example" }, body: JSON.stringify({ cause: "click" }) });
  check("POST /api/selection needs a cause (400) and refuses another site (403)", bad.status === 400 && foreign.status === 403 && lines(LOG).length === 0, { bad: bad.status, foreign: foreign.status });

  browser = await webkit.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const head = async () => ((await page.locator("[data-testid=chat-head] .ab-head__name").first().textContent({ timeout: 1500 }).catch(() => "")) ?? "").trim();
  const away = async () => (await page.mouse.move(900, 700), await sleep(400));
  // 1. A relaunch restores the last open agent by its key: recorded as restore-key.
  await page.goto(BASE);
  await page.evaluate(() => (localStorage.setItem("agent-base:active", JSON.stringify("term_gone")), localStorage.setItem("agent-base:active-key", JSON.stringify("laptop/EFFICIENCY"))));
  await page.reload();
  const restored = await page.waitForFunction(() => document.querySelector("[data-testid=chat-head] .ab-head__name")?.textContent?.trim() === "EFFICIENCY", null, { timeout: 10000 }).then(() => true, () => false);
  await sleep(500);
  const r1 = lines(LOG).find((e) => e.cause === "restore-key");
  check("a relaunch restores the last agent by its key, recorded as restore-key", restored && r1?.to === "EFFICIENCY", { restored, r1 });

  // 2. His click on Agent Zero: recorded as a click, in the node's file and the app's own last 200.
  await page.locator('[data-testid=rail-row][aria-label^="Agent Zero"]').first().click();
  await page.waitForFunction(() => document.querySelector("[data-testid=chat-head] .ab-head__name")?.textContent?.trim() === "Agent Zero", null, { timeout: 6000 });
  await sleep(400);
  const r2 = lines(LOG).at(-1);
  const local = await page.evaluate(() => JSON.parse(localStorage.getItem("agent-base:selection-log") ?? "[]"));
  check("his click is recorded (from, to, cause, at) by the node and in the app's own log", r2?.cause === "click" && r2.from === "EFFICIENCY" && r2.to === "Agent Zero" && typeof r2.at === "string" && local.at(-1)?.cause === "click" && local.at(-1)?.to === "Agent Zero", { r2, local: local.slice(-2) });

  // 3. A back while he types is held: he stays, and the held switch is on record.
  await away();
  await page.getByRole("button", { name: "Projects ›", exact: true }).click();
  await page.locator("[data-testid=zero-strip] .ab-zero-strip__face[data-name=AGENT-BASE]").click();
  await page.waitForFunction(() => document.querySelector("[data-testid=chat-head] .ab-head__name")?.textContent?.trim() === "AGENT-BASE", null, { timeout: 6000 });
  await away(); // the face's hover card would cover the +
  await page.locator("[data-testid=zero-new-agent]").click();
  const input = page.locator("[data-testid=say-new-input]");
  await input.click();
  await page.keyboard.type("half a sentence");
  await page.keyboard.press("Meta+Shift+ArrowLeft");
  await sleep(600);
  const afterArrow = await head();
  // QA #11: picking an agent is no longer a history entry, so there is no agent switch for a back to hold; a back here would
  // leave the app. What stays checked is the key: ⌘⇧← in a text box does not move him.
  check("⌘⇧← in a text box does not go back", afterArrow === "AGENT-BASE", { afterArrow });

  // 4. Within 10 s of his own pick, the app does not switch on its own: the agent his words started appears in herdr's
  // list just after he clicked another agent; he stays where he clicked.
  await input.fill("fix the CRM login bug");
  await input.press("Enter");
  for (let i = 0; i < 60 && !lines(hostLog).length; i++) await sleep(100);
  await page.locator("[data-testid=say-new] button[aria-label=Close]").click();
  await away();
  await page.locator('[data-testid=rail-row][aria-label^="Agent Zero"]').first().click();
  await sleep(300);
  writeFileSync(agentsFile, JSON.stringify([ZERO, EFF, BASE_A, ag("CRM-LOGIN", 9, "working")]));
  // The app reads the list every 5 s: the new agent lands well inside the 10 s.
  for (let i = 0; i < 70 && !lines(LOG).some((e) => e.cause === "say-start"); i++) await sleep(100);
  await sleep(500);
  const stayed = await head();
  const ownClick = lines(LOG).filter((e) => e.blocked === "own-click");
  check("within 10 s of his click an automatic switch (the started agent opening) is held and recorded", lines(hostLog).length === 1 && stayed === "Agent Zero" && ownClick.some((e) => e.cause === "say-start" && e.to === "CRM-LOGIN"), { stayed, ownClick, host: lines(hostLog).length, log: lines(LOG).slice(-4), listed: (await (await fetch(`${BASE}/api/agents`)).json()).agents.map((a) => a.name + ":" + a.row) });

  // 5. Shaan 3 Oct 18:35 ("I click on agent zero ... says click agent on the left"): Agent Zero's last tab was a web page
  // he owns, so a click reopened that tab, the history entry it pushed found no owner for it and dropped him on "Pick an
  // agent". Clicking an agent whose last tab is its chat, from a page, did the same. A click keeps the agent it opened.
  await page.evaluate(() => {
    localStorage.setItem("agent-base:open-tabs", JSON.stringify([{ id: "tab:a0web", kind: "web", title: "A0 card", owner: "Agent Zero", by: "him" }]));
    localStorage.setItem("agent-base:last-tab", JSON.stringify({ "Agent Zero": "tab:a0web", "AGENT-BASE": "chat" }));
    localStorage.setItem("agent-base:active", "null");
    localStorage.setItem("agent-base:active-key", JSON.stringify("laptop/AGENT-BASE"));
  });
  await page.reload();
  await page.waitForFunction(() => document.querySelector("[data-testid=chat-head] .ab-head__name")?.textContent?.trim() === "AGENT-BASE", null, { timeout: 10000 });
  const picked = async () => (await sleep(800), { empty: await page.locator(".ab-pick-empty").isVisible(), last: lines(LOG).at(-1) });
  await page.locator('[data-testid=rail-row][aria-label^="Agent Zero"]').first().click();
  const toZero = await picked();
  check("a click on Agent Zero whose last tab is a page he owns keeps Agent Zero open", !toZero.empty && toZero.last?.cause === "click" && toZero.last.to === "Agent Zero", toZero);
  await page.locator("[data-testid=dock-face][data-name=AGENT-BASE]").first().click();
  const toChat = await picked();
  check("a click from that page on an agent whose last tab is its chat keeps that agent open", !toChat.empty && toChat.last?.cause === "dock" && toChat.last.to === "AGENT-BASE" && (await head()) === "AGENT-BASE", toChat);

  // 6. The open agent leaving herdr's list is on record too.
  writeFileSync(agentsFile, JSON.stringify([EFF, BASE_A, ag("CRM-LOGIN", 9, "working")]));
  const gone = await (async () => { for (let i = 0; i < 60; i++) { if (lines(LOG).some((e) => e.cause === "active-gone")) return true; await sleep(200); } return false; })();
  const all = lines(LOG);
  const keys = [...new Set(all.flatMap((e) => Object.keys(e)))].sort();
  check("the open agent leaving the list is recorded; every line carries only at, from, to, cause (and blocked)", gone && keys.every((k) => ["at", "blocked", "cause", "from", "to"].includes(k)), { keys, n: all.length });
  // WebKit reports the polls a reload cancels ("… due to access control checks") as page errors; those are not the app's.
  const real = errors.filter((m) => !/due to access control checks/.test(m));
  check("no page errors", real.length === 0, { errors: real.slice(0, 3) });
} catch (e) {
  check("ran to the end", false, { error: String(e?.stack ?? e).slice(0, 500), node: nodeErr.slice(-300), log: lines(LOG).slice(-5) });
} finally {
  await browser?.close();
  node.kill();
  rmSync(scratch, { recursive: true, force: true });
}
console.log(JSON.stringify({ passed: results.filter(Boolean).length, of: results.length }));
process.exit(results.every(Boolean) ? 0 : 1);
