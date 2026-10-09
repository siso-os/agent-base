// t-0562 through the node's HTTP API: a read of /api/agents no longer files anyone under an owner by itself (8 Oct: AB-ZERO
// was filed as AGENT-BASE's worker and vanished from the nav), a new helper is recorded unplaced, and /api/agent-records
// lists each agent once, sets placement and card words, and refuses bad input before writing. A sealed node: fake herdr,
// scratch registry, hosts and owners. Never the live node. Run with heavy:
//   node services/node/test/agent-records-http.mjs
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { suitePort } from "./suite-runtime.mjs";

const REPO = path.join(import.meta.dirname, "../../..");
const PORT = await suitePort();
const BASE = `http://127.0.0.1:${PORT}`;
const scratch = realpathSync(mkdtempSync(path.join(process.env.TMPDIR ?? tmpdir(), ".siso-ephemeral-agent-records.")));
const results = [];
const check = (name, ok, detail = {}) => { results.push(!!ok); console.log(JSON.stringify({ check: name, ok: !!ok, ...detail })); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const tree = path.join(scratch, "_data/worktrees/siso-internal-labs-agent-base");
for (const lane of ["train", "zero", "lane"]) mkdirSync(path.join(tree, lane), { recursive: true });
const row = (name, lane, pane) => ({ agent: "claude", agent_status: "idle", cwd: path.join(tree, lane), pane_id: pane, terminal_id: `term_${pane.replace(":", "")}`, terminal_title_stripped: name, name });
const agentsFile = path.join(scratch, "agents.json");
writeFileSync(agentsFile, JSON.stringify([row("AGENT-BASE", "train", "w7:p2"), row("AB-ZERO", "zero", "w7:p3"), row("NEW-HELPER", "lane", "w7:p4")]));
const registryFile = path.join(scratch, "registry.json");
writeFileSync(registryFile, JSON.stringify({
  projects: [{ id: "agent-base", name: "Agent Base", group: "labs", shown: true, order: 0 }], domains: ["Agent Base"],
  agents: { "AGENT-BASE": { project: "Agent Base", kind: "owner" }, "AB-ZERO": { project: "Agent Base", kind: "owner", role: "Agent Base's Agent Zero" } },
}));
const owners = path.join(scratch, "owners");
mkdirSync(owners, { recursive: true });
mkdirSync(path.join(scratch, "state"), { recursive: true });

let nodeErr = "";
const node = spawn(process.execPath, ["--experimental-strip-types", "--no-warnings", "src/server.ts"], {
  cwd: path.join(REPO, "services/node"),
  env: {
    ...process.env, HOME: scratch, AB_PORT: String(PORT), AB_HERDR: `${process.execPath} ${path.join(REPO, "services/node/test/fake-herdr.mjs")}`,
    FAKE_HERDR_AGENTS_FILE: agentsFile, FAKE_HERDR_LOG: path.join(scratch, "herdr.jsonl"), AB_CLAUDE_DIRS: path.join(scratch, "claude"),
    AB_HOSTS_DIR: path.join(scratch, "hosts"), AB_STATE: path.join(scratch, "state", "rows.json"), AB_REGISTRY: registryFile, AB_OWNERS_DIR: owners,
    AB_RESURRECT_DIR: path.join(scratch, "none"), AB_CONSOLE_EVENTS: path.join(scratch, "none.jsonl"), AB_ORG_HOME: scratch,
  },
  stdio: ["ignore", "ignore", "pipe"],
});
node.stderr.on("data", (d) => (nodeErr += d));
const post = async (body) => { const r = await fetch(`${BASE}/api/agent-records`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }); return { status: r.status, body: await r.json() }; };
try {
  for (let i = 0; i < 150; i++) { try { if ((await fetch(`${BASE}/api/health`)).ok) break; } catch {} await sleep(200); }
  await (await fetch(`${BASE}/api/agents`)).json();
  await sleep(300);
  let reg = JSON.parse(readFileSync(registryFile, "utf8")).agents;
  check("a read of /api/agents files nobody under an owner", reg["AB-ZERO"].kind === "owner" && !reg["AB-ZERO"].owner && !reg["NEW-HELPER"]?.owner,
    { abZero: reg["AB-ZERO"], newHelper: reg["NEW-HELPER"] });
  check("the new helper is recorded unplaced", reg["NEW-HELPER"]?.placed === "unplaced", { newHelper: reg["NEW-HELPER"] });

  const list = await (await fetch(`${BASE}/api/agent-records`)).json();
  const names = list.records.map((r) => r.name);
  check("each agent once, the unplaced one named", names.length === new Set(names.map((n) => n.toUpperCase())).size && ["AGENT-BASE", "AB-ZERO", "NEW-HELPER"].every((n) => names.includes(n)) && list.unplaced.includes("NEW-HELPER"),
    { names, unplaced: list.unplaced });

  const bad = await Promise.all([
    post({ name: "NEW-HELPER", set: { project: "No Such Project" } }),
    post({ name: "NEW-HELPER", set: { colour: "red" } }),
    post({ name: "NEW-HELPER", set: { owner: "NEW-HELPER" } }),
    post({ name: "NOBODY", set: { label: "x" } }),
    post({ name: "NEW-HELPER", card: { links: ["javascript:alert(1)"] } }),
  ]);
  reg = JSON.parse(readFileSync(registryFile, "utf8")).agents;
  check("bad input is refused before anything is written", bad.map((b) => b.status).join() === "400,400,400,404,400" && reg["NEW-HELPER"].placed === "unplaced",
    { statuses: bad.map((b) => b.status), errors: bad.map((b) => b.body.error) });

  const placed = await post({ name: "new-helper", set: { owner: "AGENT-BASE", project: "Agent Base", label: "The t-0562 helper" } });
  reg = JSON.parse(readFileSync(registryFile, "utf8")).agents;
  check("Agent Zero places it: owner, project, label set; no longer unplaced", placed.status === 200 && placed.body.record?.placed === "set" && reg["NEW-HELPER"].owner === "AGENT-BASE" && reg["NEW-HELPER"].kind === "worker" && !("placed" in reg["NEW-HELPER"]),
    { status: placed.status, record: placed.body.record && { owner: placed.body.record.owner, placed: placed.body.record.placed, label: placed.body.record.label } });

  const carded = await post({ name: "AGENT-BASE", card: { summary: "Shipping t-0562", needsYou: ["look at Playground"], links: ["https://example.com/ab"] } });
  const card = JSON.parse(readFileSync(path.join(owners, "AGENT-BASE.json"), "utf8"));
  check("an owner writes its own card words through the API", carded.status === 200 && card.summary === "Shipping t-0562" && carded.body.record?.needsYou?.[0] === "look at Playground",
    { status: carded.status, card: { summary: card.summary, needsYou: card.needsYou } });
} catch (e) {
  check("ran to the end", false, { error: String(e?.stack ?? e).slice(0, 400), nodeErr: nodeErr.slice(-400) });
} finally {
  node.kill("SIGTERM");
  rmSync(scratch, { recursive: true, force: true });
  const passed = results.filter(Boolean).length;
  console.log(JSON.stringify({ passed, of: results.length }));
  process.exitCode = passed === results.length && results.length > 0 ? 0 : 1;
}
