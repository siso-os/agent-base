import { suitePort } from './suite-runtime.mjs';
// Check t-0265 (Shaan 3 Oct 01:1x: "I click on the Agent zero and sometimes it takes me to the efficiency agent"): every way
// to Agent Zero in the side nav opens Agent Zero's chat, and nothing else takes him away from it afterwards.
// A fake herdr with A0's seat, EFFICIENCY (an Agent Infrastructure owner, as live) and a pinned owner; Claude session files
// in a fixture folder; no live agent. Covered: the zero row, its card's Open chat, each face in the strip under it, A0
// leaving herdr's list for a few polls and coming back (00:51), and a hidden chat whose terminal was replaced reconnecting
// (as after the laptop sleeps) while he is on Agent Zero: it must not pull him to that agent.
// Usage: node services/node/test/zero-click-ui.mjs [shots dir]
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { webkit } from './suite-runtime.mjs';

const REPO = path.join(import.meta.dirname, "../../..");
const PORT = await suitePort();
const SHOTS = process.argv[2] ?? path.join(import.meta.dirname, ".shots-zero-click");
mkdirSync(SHOTS, { recursive: true });
const scratch = mkdtempSync(path.join(process.env.TMPDIR ?? tmpdir(), ".siso-ephemeral-zero-click."));
const S = { zero: "0b5e5510-0000-4000-8000-0000000000a0", eff: "0b5e5510-0000-4000-8000-0000000000e1", base: "0b5e5510-0000-4000-8000-0000000000b1" };
const proj = path.join(scratch, "claude/projects/-tmp");
mkdirSync(proj, { recursive: true });
for (const [who, id] of Object.entries(S)) writeFileSync(path.join(proj, `${id}.jsonl`), JSON.stringify({ type: "user", uuid: `u-${who}`, timestamp: new Date().toISOString(), message: { role: "user", content: `${who.toUpperCase()}-WORDS` } }) + "\n");
writeFileSync(path.join(scratch, "seat.json"), JSON.stringify({ session: S.zero, pane: "w1:p1", name: "A0" }));
writeFileSync(path.join(scratch, "registry.json"), JSON.stringify({ projects: ["SISO Internal Labs", "Agent Base"], pinned: ["Agent Zero", "AGENT-BASE"], agents: { EFFICIENCY: { project: "SISO Internal Labs", kind: "owner", domain: "Efficiency", role: "Agent Infrastructure: agent-stack efficiency" }, "AGENT-BASE": { project: "Agent Base", kind: "owner", domain: "Agent Base" } }, domains: [] }));
const claude = (title, n, session, term = `term_zc${n}`) => ({ agent: "claude", agent_status: "working", cwd: "/tmp", pane_id: `w1:p${n}`, terminal_id: term, terminal_title_stripped: title, agent_session: { value: session } });
const ZERO = claude("A0", 1, S.zero), EFF = claude("EFFICIENCY", 2, S.eff), BASE = claude("AGENT-BASE", 3, S.base);
const agentsFile = path.join(scratch, "agents.json");
const setAgents = (list) => writeFileSync(agentsFile, JSON.stringify(list));
setAgents([ZERO, EFF, BASE]);
const results = [];
const check = (name, ok, detail = {}) => {
  results.push(!!ok);
  console.log(JSON.stringify({ check: name, ok: !!ok, ...detail }));
};
const node = spawn(process.execPath, ["--experimental-strip-types", "--no-warnings", "src/server.ts"], {
  cwd: path.join(REPO, "services/node"),
  env: { ...process.env, HOME: scratch, AB_HUB_HOME: scratch, AB_PORT: String(PORT), AB_CLAUDE_DIRS: path.join(scratch, "claude"), FAKE_HERDR_AGENTS_FILE: agentsFile, AB_HERDR: `${process.execPath} ${path.join(REPO, "services/node/test/fake-herdr.mjs")}`, AB_HOSTS_DIR: path.join(scratch, "hosts"), AB_STATE: path.join(scratch, "rows.json"), AB_REGISTRY: path.join(scratch, "registry.json"), AB_A0_SEAT: path.join(scratch, "seat.json"), AB_RESURRECT_DIR: path.join(scratch, "none"), AB_CONSOLE_EVENTS: path.join(scratch, "none.jsonl") },
  stdio: "ignore",
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 6000) => {
  for (const end = Date.now() + ms; Date.now() < end; await sleep(100)) if (await fn()) return true;
  return false;
};
const api = async () => (await (await fetch(`http://127.0.0.1:${PORT}/api/agents`)).json()).agents;
let browser = null;
try {
  for (let i = 0; i < 100 && !(await fetch(`http://127.0.0.1:${PORT}/api/health`).then((r) => r.ok, () => false)); i++) await sleep(200);
  browser = await webkit.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  // Every chat socket goes through here, so a check can drop one as a sleeping laptop does.
  const sockets = new Map();
  const moved = [];
  await page.routeWebSocket(/\/chat\/[^/]+\/ws/, (ws) => {
    const id = decodeURIComponent(new URL(ws.url()).pathname.split("/")[2]);
    const server = ws.connectToServer();
    // Pass every message through, noting the "moved" ones (a chat told its row lives in another terminal now).
    server.onMessage((m) => {
      if (typeof m === "string" && m.includes('"t":"moved"')) moved.push(id);
      ws.send(m);
    });
    sockets.set(id, ws);
  });
  await page.goto(`http://127.0.0.1:${PORT}/`);
  const head = page.locator("[data-testid=chat-head] .ab-head__name");
  const openName = async () => ((await head.first().textContent({ timeout: 1500 }).catch(() => "")) ?? "").trim();
  const zeroRow = page.locator('[data-testid=rail-row][aria-label^="Agent Zero"]').first();
  await zeroRow.waitFor({ timeout: 15000 });
  const away = async () => (await page.mouse.move(900, 700), await sleep(450));
  // EFFICIENCY is Agent Infrastructure: it opens from the side nav's footer entry, not the strip.
  const openEff = async () => {
    await away();
    await page.locator(".siso-infra__entry").click();
    await page.locator(".siso-infra__pop [role=menuitem]", { hasText: "EFFICIENCY" }).click();
    await page.mouse.click(900, 700); // the popover was pinned open by the click: close it
    return until(async () => (await openName()) === "EFFICIENCY", 4000);
  };


  // 1. The zero row.
  await zeroRow.click();
  const byRow = await until(async () => (await openName()) === "Agent Zero");
  check("clicking Agent Zero's row opens Agent Zero", byRow, { open: await openName() });

  // 2. Each face in the strip under it opens the agent it names; then the row again is Agent Zero.
  const faces = await page.locator("[data-testid=zero-strip] .ab-zero-strip__face").evaluateAll((els) => els.map((e) => e.getAttribute("data-name")));
  const faceResults = [];
  for (const n of faces) {
    await away();
    await page.locator(`[data-testid=zero-strip] .ab-zero-strip__face[data-name="${n}"]`).click();
    await until(async () => (await openName()) === n, 4000);
    faceResults.push([n, await openName()]);
  }
  await away();
  await zeroRow.click();
  const backToZero = await until(async () => (await openName()) === "Agent Zero");
  check("each face under it opens the agent it names, and the row then opens Agent Zero again", faces.length >= 1 && faceResults.every(([n, got]) => n === got) && backToZero, { faceResults, backToZero });

  // 3. The row's card: Open chat is Agent Zero's.
  await openEff();
  await away();
  await zeroRow.hover();
  const card = page.locator(".ab-hover-card");
  await card.waitFor({ timeout: 4000 });
  const cardName = await card.locator(".ab-hover-identity strong").textContent();
  await card.getByRole("button", { name: "Open chat" }).click();
  const byCard = await until(async () => (await openName()) === "Agent Zero");
  check("Agent Zero's card is Agent Zero's, and its Open chat opens Agent Zero", byCard && /Agent Zero|A0/.test(cardName ?? ""), { cardName, open: await openName() });

  // 4. 00:51: A0 drops out of herdr's list for a few polls and comes back; the row still opens Agent Zero.
  setAgents([EFF, BASE]);
  await until(async () => !(await api()).some((a) => a.zero), 6000);
  await sleep(2500);
  setAgents([ZERO, EFF, BASE]);
  await until(async () => (await api()).some((a) => a.zero), 6000);
  const effOpened = await openEff();
  await away();
  await zeroRow.click({ timeout: 8000 });
  const afterGap = await until(async () => (await openName()) === "Agent Zero");
  check("after A0 leaves herdr's list and comes back, the row opens Agent Zero", effOpened && afterGap, { effOpened, open: await openName() });

  // 5. He is on Agent Zero; EFFICIENCY's terminal is replaced (a relay) and its hidden chat's socket drops and reconnects
  // before the app's next read of the agents (a laptop waking): he must stay on Agent Zero.
  await page.route("**/api/agents", (r) => r.abort()); // the app's agent list is stale for this moment, as on wake
  setAgents([ZERO, { ...EFF, terminal_id: "term_zc2b" }, BASE]);
  await until(async () => (await api()).some((a) => a.id === "term_zc2b"), 6000);
  const hidden = sockets.get(EFF.terminal_id);
  await hidden?.close().catch(() => {});
  await sleep(4000);
  const stayed = await openName();
  await page.screenshot({ path: path.join(SHOTS, "zero-after-hidden-move-1440.png") });
  await page.unroute("**/api/agents");
  await sleep(2500);
  const still = await openName();
  check("a hidden chat that moved to a new terminal (told so by the node) does not pull him off Agent Zero", !!hidden && moved.includes(EFF.terminal_id) && stayed === "Agent Zero" && still === "Agent Zero", { hadSocket: !!hidden, moved, stayed, still });

  // 6. And EFFICIENCY, opened again, is its new terminal's chat.
  const effAgain = await openEff();
  check("EFFICIENCY opened again is its own chat", effAgain, { open: await openName() });
  check("no page errors", errors.length === 0, { errors: errors.slice(0, 3) });
} catch (e) {
  check("ran to the end", false, { error: String(e?.stack ?? e).slice(0, 400) });
} finally {
  await browser?.close();
  node.kill();
  rmSync(scratch, { recursive: true, force: true });
}
console.log(JSON.stringify({ passed: results.filter(Boolean).length, of: results.length }));
process.exit(results.every(Boolean) ? 0 : 1);
