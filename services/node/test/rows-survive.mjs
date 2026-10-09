// Check: what Shaan did to his rows (settled, snoozed, seen, his drag order) survives a herdr restart.
//   node test/rows-survive.mjs [lab-script]
// It provisions its own herdr lab session (never the live one), starts three named fake agents, starts this node on a
// scratch port with scratch state, acts on the rows, restarts herdr (every terminal gets a new id, as on 2 Oct), then
// restarts the node and checks the rows came back. Then it checks the two other ways a row keeps its place: an old
// rows.json keyed by terminal ids is moved to names from a herdr-resurrect snapshot, and a row follows its Claude
// session when the agent's title changes. Prints one JSON line per check; exits 1 if any failed. Tears the lab down.
import { execFileSync, spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const LAB =
  process.argv[2] ??
  path.join(process.env.HOME, "SISO_Workspace/SISO_Agency/apps/siso-internal-labs/siso-internal-labs-agents/.agents/research/2026-10-01-agent-app/tests/1-clean-terminal/lab");
const PORT = 5403;
const NODE_DIR = path.join(import.meta.dirname, "..");
const scratch = mkdtempSync(path.join(process.env.TMPDIR ?? tmpdir(), ".siso-ephemeral-rows-survive."));
const lab = (...a) => execFileSync(LAB, a, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
const SESSION = lab("name", "rowsurvive").trim();
const herdr = (...a) => JSON.parse(lab("run", SESSION, ...a) || "{}");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, detail) => {
  results.push(ok);
  console.log(JSON.stringify({ check: name, ok, ...detail }));
};

const AGENTS = [
  { name: "ALPHA", pane: "w1:p1", state: "working" },
  { name: "BRAVO", pane: "w1:p2", state: "idle" },
  { name: "CHARLIE", pane: "w1:p3", state: "blocked" },
];
/**
 * Each pane shows its name as the terminal title (what herdr reports for a Claude chat) and reports as an agent. Each
 * line typed into it afterwards becomes its new title (retitle).
 */
async function startAgents() {
  for (const a of AGENTS) {
    herdr("pane", "run", a.pane, `t='${a.name}'; while :; do printf '\\033]2;%s\\007' "$t"; read -r t || break; done`);
  }
  await sleep(800);
  for (const a of AGENTS) {
    herdr("pane", "report-agent", "--source", "lab", "--agent", "fake", "--state", a.state, a.pane);
  }
}

let node = null;
async function startNode(extraEnv = {}) {
  node = spawn(process.execPath, ["--experimental-strip-types", "--no-warnings", "src/server.ts"], {
    cwd: NODE_DIR,
    env: {
      ...process.env,
      AB_PORT: String(PORT),
      AB_HERDR: `${LAB} run ${SESSION}`,
      AB_STATE: path.join(scratch, "rows.json"),
      AB_REGISTRY: path.join(scratch, "registry.json"),
      AB_HOSTS_DIR: path.join(scratch, "hosts"),
      AB_CTX_DIR: path.join(scratch, "ctx"),
      AB_CONSOLE_EVENTS: path.join(scratch, "none.jsonl"),
      AB_RESURRECT_DIR: path.join(scratch, "no-snapshots"),
      AB_WEB_DIST: path.join(scratch, "no-web"),
      ...extraEnv,
    },
    stdio: ["ignore", "ignore", "pipe"],
  });
  node.stderr.on("data", (d) => process.stderr.write(`[node] ${d}`));
  for (let i = 0; i < 50; i++) {
    try {
      if ((await fetch(`http://127.0.0.1:${PORT}/api/health`)).ok) return;
    } catch {}
    await sleep(200);
  }
  throw new Error("node did not start");
}
async function stopNode() {
  if (!node) return;
  const n = node;
  node = null;
  n.kill();
  await new Promise((r) => n.once("exit", r));
}
const api = (p, body) =>
  fetch(`http://127.0.0.1:${PORT}${p}`, body === undefined ? {} : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).then((r) => r.json());
const byName = async () => Object.fromEntries((await api("/api/agents")).agents.map((a) => [a.name, a]));
const view = (a) => a && { id: a.id, key: a.key, row: a.row, seen: !!a.seenAt, order: a.order };

async function restartHerdr() {
  lab("stop", SESSION);
  lab("provision", SESSION);
  await startAgents();
}

try {
  lab("provision", SESSION);
  herdr("workspace", "create", "--label", "lab", "--no-focus");
  herdr("pane", "split", "w1:p1", "--direction", "right");
  herdr("pane", "split", "w1:p2", "--direction", "down");
  await startAgents();
  await startNode();

  // 1. Act on the rows the way he does in the side nav.
  let a = await byName();
  const before = Object.fromEntries(AGENTS.map((x) => [x.name, a[x.name]?.id]));
  await api(`/api/agents/${a.ALPHA.id}/settle`, {});
  await api(`/api/agents/${a.BRAVO.id}/seen`, {});
  await api(`/api/agents/${a.CHARLIE.id}/snooze?until=${Date.now() + 3600_000}`, {});
  await api("/api/order", { ids: [a.CHARLIE.id, a.ALPHA.id, a.BRAVO.id] });
  const snapshot = { captured_at: new Date().toISOString(), live_pane_list: herdr("pane", "list") }; // herdr-resurrect's shape

  // 2. Restart herdr (new terminal ids) and the node; the rows must come back by name.
  await stopNode();
  await restartHerdr();
  await startNode();
  a = await byName();
  const after = Object.fromEntries(AGENTS.map((x) => [x.name, a[x.name]?.id]));
  check("terminal ids changed on the herdr restart", AGENTS.every((x) => before[x.name] && after[x.name] && before[x.name] !== after[x.name]), { before, after });
  check(
    "rows survived the herdr restart",
    a.ALPHA?.row === "settled" && !!a.BRAVO?.seenAt && a.CHARLIE?.row === "snoozed" && a.CHARLIE.order === 0 && a.ALPHA.order === 1 && a.BRAVO.order === 2,
    { ALPHA: view(a.ALPHA), BRAVO: view(a.BRAVO), CHARLIE: view(a.CHARLIE) },
  );
  check("rows.json is keyed by machine + name", Object.keys(JSON.parse(readFileSync(path.join(scratch, "rows.json"), "utf8")).settled).join() === "laptop/ALPHA", {});

  // 3. An old rows.json keyed by terminal ids that no longer exist: moved to names from a resurrect snapshot.
  await stopNode();
  const snaps = path.join(scratch, "snapshots");
  mkdirSync(snaps);
  writeFileSync(path.join(snaps, "snapshot-2026-10-02_00-00-00.json"), JSON.stringify(snapshot));
  writeFileSync(
    path.join(scratch, "rows.json"),
    JSON.stringify({ settled: { [before.BRAVO]: Date.now() }, snoozed: {}, seen: { [before.CHARLIE]: Date.now() }, order: [before.BRAVO, before.CHARLIE, before.ALPHA, "term_gone"] }),
  );
  // herdr reports a session only for chats it detects itself; siso-host's file gives BRAVO one, as for a hosted chat.
  mkdirSync(path.join(scratch, "hosts"));
  writeFileSync(path.join(scratch, "hosts", "bravo.json"), JSON.stringify({ pid: process.pid, port: 1, token: "x", session: "sess-bravo", pane: "w1:p2", name: "", cwd: "/" }));
  await startNode({ AB_RESURRECT_DIR: snaps });
  a = await byName();
  const file = JSON.parse(readFileSync(path.join(scratch, "rows.json"), "utf8"));
  check(
    "an old terminal-id rows.json is migrated to names",
    a.BRAVO?.row === "settled" && !!a.CHARLIE?.seenAt && a.BRAVO.order === 0 && a.CHARLIE.order === 1 && a.ALPHA.order === 2 && !JSON.stringify(file).includes("term_"),
    { BRAVO: view(a.BRAVO), CHARLIE: view(a.CHARLIE), ALPHA: view(a.ALPHA), order: file.order },
  );

  // 4. An agent whose title changes mid-session keeps its row (it follows its Claude session).
  herdr("pane", "run", "w1:p2", "BRAVO renamed");
  await sleep(800);
  a = await byName();
  check("a row follows its session when the title changes", a["BRAVO renamed"]?.row === "settled" && a["BRAVO renamed"].order === 0, { "BRAVO renamed": view(a["BRAVO renamed"]) });

  // 5. A bad id is refused, not stored.
  const bad = await fetch(`http://127.0.0.1:${PORT}/api/agents/term_nope/settle`, { method: "POST" });
  check("an unknown agent id gets a 404", bad.status === 404, { status: bad.status });

  // 6. Another writer (a second node, a check, a seed script) changes the files while this node runs: its change survives
  //    this node's next save instead of being overwritten from memory.
  const regFile = path.join(scratch, "registry.json");
  const rowFile = path.join(scratch, "rows.json");
  await api("/api/registry", { op: "register", name: "ALPHA", domain: "Lab" }); // the node writes registry.json first
  const reg = JSON.parse(readFileSync(regFile, "utf8"));
  reg.pinnedPages = [{ url: "http://example.test/pinned", title: "Pinned elsewhere" }];
  writeFileSync(regFile, JSON.stringify(reg));
  const rw = JSON.parse(readFileSync(rowFile, "utf8"));
  rw.settled["laptop/CHARLIE"] = Date.now();
  writeFileSync(rowFile, JSON.stringify(rw));
  await api("/api/registry", { op: "pin", name: "ALPHA" });
  await api(`/api/agents/${a.ALPHA.id}/seen`, {});
  const reg2 = JSON.parse(readFileSync(regFile, "utf8"));
  const rw2 = JSON.parse(readFileSync(rowFile, "utf8"));
  check(
    "another writer's change survives this node's next save",
    reg2.pinnedPages?.[0]?.title === "Pinned elsewhere" && reg2.pinRefs?.some(pin => pin.name === "ALPHA") && !!rw2.settled["laptop/CHARLIE"] && !!rw2.seen["laptop/ALPHA"],
    { pinnedPages: reg2.pinnedPages?.length, pinRefs: reg2.pinRefs, settled: Object.keys(rw2.settled) },
  );

  // 7. A file that does not parse is kept aside, not wiped by the next save; the node keeps working.
  await stopNode();
  writeFileSync(regFile, '{"pinnedPages": [ {"url": "http://example.test/half"');
  await startNode({ AB_RESURRECT_DIR: snaps });
  await api("/api/registry", { op: "pin", name: "BRAVO" });
  const aside = (await import("node:fs")).readdirSync(scratch).filter((f) => f.startsWith("registry.json.bad-"));
  const kept = aside.length === 1 && readFileSync(path.join(scratch, aside[0]), "utf8").includes("example.test/half");
  check("a corrupt file is kept aside and the node carries on", kept && JSON.parse(readFileSync(regFile, "utf8")).pinRefs?.some(pin => pin.name === "BRAVO"), { aside });

  // 8. The first save of the day leaves a backup beside the file.
  const backups = (await import("node:fs")).readdirSync(path.join(scratch, "backups"));
  check("daily backups are written", backups.some((f) => f.startsWith("rows-")) && backups.some((f) => f.startsWith("registry-")), { backups });
} catch (e) {
  check("ran to the end", false, { error: String(e?.stack ?? e).slice(0, 600) });
} finally {
  await stopNode();
  try {
    lab("teardown", SESSION);
  } catch (e) {
    console.error(`teardown ${SESSION} failed: ${e}`);
  }
  rmSync(scratch, { recursive: true, force: true });
}
const passed = results.filter(Boolean).length;
console.log(JSON.stringify({ passed, of: results.length }));
process.exit(passed === results.length ? 0 : 1);
