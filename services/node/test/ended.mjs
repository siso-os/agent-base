import { suitePort } from './suite-runtime.mjs';
// Check (t-0260, R1.25: "when the agent gets spun down it's tracked somewhere"): an agent that leaves herdr gets one line
// in the node's ended record, survives a node restart, shows in the side nav's folded "Ended" group, and its row opens
// its chat read back read-only. No real agents: the fake herdr (its list from a file the check rewrites) and a scratch
// Claude folder. Runs anywhere (the Mac mini):
//   node services/node/test/ended.mjs        Shots: .shots-ended-1440.png, .shots-ended-390.png
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { webkit } from './suite-runtime.mjs';
import WebSocket from "ws";

const REPO = path.join(import.meta.dirname, "../../..");
const PORT = await suitePort();
const BASE = `http://127.0.0.1:${PORT}`;
const scratch = realpathSync(mkdtempSync(path.join(process.env.TMPDIR ?? tmpdir(), ".siso-ephemeral-ended.")));
const results = [];
const check = (name, ok, detail = {}) => {
  results.push(!!ok);
  console.log(JSON.stringify({ check: name, ok: !!ok, ...detail }));
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Two Claude agents with session files; WORKER-X will leave herdr.
const work = path.join(scratch, "work");
mkdirSync(work, { recursive: true });
const claude = path.join(scratch, "claude");
const S1 = "e0de0000-0000-4000-8000-00000000ab01", S2 = "e0de0000-0000-4000-8000-00000000ab02";
const sessionDir = path.join(claude, "projects", work.replace(/[^A-Za-z0-9]/g, "-"));
mkdirSync(sessionDir, { recursive: true });
const at = new Date().toISOString();
const say = (who, text) => JSON.stringify(who === "user" ? { type: "user", uuid: `u-${text.length}`, timestamp: at, message: { role: "user", content: text } } : { type: "assistant", uuid: `a-${text.length}`, timestamp: at, message: { role: "assistant", id: "m1", content: [{ type: "text", text }] } });
writeFileSync(path.join(sessionDir, `${S1}.jsonl`), `${say("user", "hello base")}\n`);
writeFileSync(path.join(sessionDir, `${S2}.jsonl`), `${say("user", "build the ended group")}\n${say("assistant", "WORKER-X SAID HI before it ended")}\n`);
const base = { agent: "claude", agent_status: "idle", cwd: work, pane_id: "w7:p2", terminal_id: "term_base", terminal_title_stripped: "AGENT-BASE", agent_session: { value: S1 } };
const worker = { agent: "claude", agent_status: "working", cwd: work, pane_id: "w7:p5", terminal_id: "term_wx", terminal_title_stripped: "✳ Building the ended group", name: "WORKER-X", agent_session: { value: S2 } };
const agentsFile = path.join(scratch, "agents.json");
const setAgents = (list) => writeFileSync(agentsFile, JSON.stringify(list));
setAgents([base, worker]);
const registryFile = path.join(scratch, "registry.json");
writeFileSync(registryFile, JSON.stringify({ projects: [{ id: "agent-base", name: "Agent Base", group: "labs", shown: true, order: 0 }], agents: { "AGENT-BASE": { project: "Agent Base", kind: "owner" }, "WORKER-X": { project: "Agent Base", kind: "worker", owner: "AGENT-BASE" } }, domains: ["Agent Base"] }));
const herdrLog = path.join(scratch, "herdr.jsonl");
const endedFile = path.join(scratch, "state", "ended.jsonl");

let nodeErr = "";
const startNode = () => {
  const n = spawn(process.execPath, ["--experimental-strip-types", "--no-warnings", "src/server.ts"], {
    cwd: path.join(REPO, "services/node"),
    env: {
      ...process.env, HOME: scratch, AB_PORT: String(PORT), AB_HERDR: `${process.execPath} ${path.join(REPO, "services/node/test/fake-herdr.mjs")}`, FAKE_HERDR_AGENTS_FILE: agentsFile, FAKE_HERDR_LOG: herdrLog,
      AB_CLAUDE_DIRS: claude, AB_HOSTS_DIR: path.join(scratch, "hosts"), AB_STATE: path.join(scratch, "state", "rows.json"), AB_REGISTRY: registryFile,
      AB_RESURRECT_DIR: path.join(scratch, "none"), AB_CONSOLE_EVENTS: path.join(scratch, "none.jsonl"), AB_ORG_HOME: scratch,
    },
    stdio: ["ignore", "ignore", "pipe"],
  });
  n.stderr.on("data", (d) => (nodeErr += d));
  return n;
};
const up = async () => {
  for (let i = 0; i < 150; i++) {
    try {
      if ((await fetch(`${BASE}/api/health`)).ok) return;
    } catch {}
    await sleep(200);
  }
};
const agentsNow = async () => (await sleep(1100), (await (await fetch(`${BASE}/api/agents`)).json()).agents);
const endedNow = async () => (await (await fetch(`${BASE}/api/ended`)).json()).ended;

mkdirSync(path.join(scratch, "state"), { recursive: true });
let node = startNode();
let browser = null;
try {
  await up();
  // 1. Both live: nothing on record. Then WORKER-X leaves herdr: one line, with what it was.
  await agentsNow();
  check("1. while both run, nothing is on record", (await endedNow()).length === 0, {});
  setAgents([base]);
  await agentsNow();
  const [rec] = await endedNow();
  check("1. WORKER-X leaves herdr: one record with its pane, session, cwd, project, last status and task",
    (await endedNow()).length === 1 && rec.name === "WORKER-X" && rec.pane === "w7:p5" && rec.session === S2 && rec.cwd === work && rec.project === "Agent Base" && rec.status === "working" && rec.task === "Building the ended group" && rec.started <= rec.ended,
    { rec });

  // 2. Edge: herdr answering an empty list (it restarting) is not every agent ending at once.
  setAgents([]);
  await agentsNow();
  setAgents([base]);
  await agentsNow();
  check("2. an empty herdr list records nobody", (await endedNow()).length === 1, { n: (await endedNow()).length });

  // 3. A node restart keeps the record (it is a file) and adds nothing for agents still running.
  node.kill();
  await sleep(500);
  node = startNode();
  await up();
  await agentsNow();
  const after = await endedNow();
  check("3. after a node restart the record is still there, unchanged", after.length === 1 && after[0].id === rec.id && existsSync(endedFile), { after: after.map((e) => e.name) });

  // 4. The read-only socket: its chat comes back; anything sent to it is never typed anywhere.
  const sock = new WebSocket(`ws://127.0.0.1:${PORT}/ended/${rec.id}/ws`, { headers: { origin: BASE } });
  const hello = await new Promise((res, rej) => {
    sock.on("message", (d) => res(JSON.parse(String(d))));
    sock.on("error", rej);
    setTimeout(() => rej(new Error("no hello")), 5000);
  });
  sock.send(JSON.stringify({ t: "prompt", text: "are you there?", key: "k1" }));
  await sleep(600);
  sock.close();
  const typed = readFileSync(herdrLog, "utf8").split("\n").filter((l) => /send-text|send-keys|"run"/.test(l));
  check("4. /ended/:id/ws sends its chat (hello, source ended) and types nothing into any pane",
    hello.t === "hello" && hello.source === "ended" && JSON.stringify(hello.log).includes("WORKER-X SAID HI") && typed.length === 0, { t: hello.t, source: hello.source, typed });

  // 5. The side nav footer opens the Ended page; a row opens the chat read-only (no composer).
  browser = await webkit.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(BASE);
  const shelf = page.getByTestId("ended-open");
  await shelf.waitFor({ timeout: 20000 });
  const folded = (await page.locator("[data-testid=ended-row]").count()) === 0;
  await shelf.click();
  const row = page.locator('[data-testid=ended-row][data-name="WORKER-X"]');
  await row.waitFor({ timeout: 5000 });
  check("5. the Ended footer keeps history off the nav and opens to WORKER-X", folded && (await row.count()) === 1, { folded });
  await row.click();
  const chat = page.locator("[data-testid=ended-chat]");
  await chat.getByText("WORKER-X SAID HI").waitFor({ timeout: 8000 });
  const note = await chat.locator("[data-testid=ended-note]").count();
  const inputs = await chat.locator("textarea").count();
  await page.waitForTimeout(600);
  const box = await chat.getByText("WORKER-X SAID HI").boundingBox();
  await page.screenshot({ path: path.join(import.meta.dirname, ".shots-ended-1440.png") });
  check("5. its chat opens read back (on screen), with the read-only note and no message box", note === 1 && inputs === 0 && !!box && box.y > 0 && box.y < 900 && box.height > 0, { note, inputs, box });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(import.meta.dirname, ".shots-ended-390.png") });
  check("no page errors", errors.length === 0, { errors: errors.slice(0, 3) });
} catch (e) {
  check("ran to the end", false, { error: String(e?.stack ?? e).slice(0, 600), node: nodeErr.slice(-600) });
} finally {
  await browser?.close();
  node.kill();
  rmSync(scratch, { recursive: true, force: true });
}
const passed = results.filter(Boolean).length;
console.log(JSON.stringify({ passed, of: results.length }));
process.exit(passed === results.length ? 0 : 1);
