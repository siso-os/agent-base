import { suitePort } from './suite-runtime.mjs';
// Check (R1.20c, A0's chat edge-case gallery, specs/2026-10-02-chat-edges §5): the six ranked fixes beyond R1.20/R1.20b.
//   A2  his long one-line memo shows whole; only a message past 40 lines folds, under "Show all N lines";
//   C10/H3/E4  wordless tools say what they did (SendMessage, ScheduleWakeup, TaskStop, Monitor, ToolSearch), never
//       "used N tools"; a message the agent sent (SendMessage, a0-tell) is a → peer row;
//   H1  another agent's message (meta line, origin.kind "peer") is a ← peer row, in the node's chat and siso-host's history;
//   F4/F5  a usage limit and an API error are cards, not the agent's words;
//   D5  a terminal agent's background sub-agent runs until its task-notification, not "Done" at launch;
//   D8  ■ Stop on it asks the agent, in its pane, to TaskStop that id.
//   node services/node/test/chat-edges.mjs [shots-dir]
// A fake herdr lists one Claude agent whose session file is a fixture in a scratch Claude folder; nothing live is read.
import { spawn } from "node:child_process";
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { webkit } from './suite-runtime.mjs';

const REPO = path.join(import.meta.dirname, "../../..");
const [shots = null] = process.argv.slice(2);
const PORT = await suitePort(); // its own (it shared 5437 with sidenav-r12)
const scratch = mkdtempSync(path.join(process.env.TMPDIR ?? tmpdir(), ".siso-ephemeral-chat-edges."));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, detail = {}) => {
  results.push(!!ok);
  console.log(JSON.stringify({ check: name, ok: !!ok, ...detail }));
};

// ---------------------------------------------------------------- the fixture session
const CWD = "/fake/edges-lab";
const S = "edges-session-1";
const T0 = Date.now() - 900_000;
let n = 0;
const at = (ms) => new Date(T0 + ms).toISOString();
const rec = (o, ms) => ({ uuid: `e${n++}`, timestamp: at(ms), sessionId: S, ...o });
const user = (content, ms, extra = {}) => rec({ type: "user", message: { role: "user", content }, ...extra }, ms);
const asst = (content, ms, extra = {}) => rec({ type: "assistant", message: { role: "assistant", content }, ...extra }, ms);
const tool = (id, name, input, ms) => asst([{ type: "tool_use", id, name, input }], ms);
const result = (id, content, ms) => user([{ type: "tool_result", tool_use_id: id, content }], ms);
const MEMO = `EDGES memo ${"and then the side nav should keep the faces in view while the chat scrolls ".repeat(32)}END-OF-MEMO`;
const LONG = Array.from({ length: 62 }, (_, i) => `EDGES line ${i + 1}`).join("\n");
const AGENT_ID = "a1b2c3d4e5f6";
const RESETS = Math.floor(Date.now() / 1000) + 2 * 3600 + 900;
const PEER = rec(
  {
    type: "user",
    isMeta: true,
    message: { role: "user", content: 'Another Claude session sent a message:\n<cross-session-message from="uds:/tmp/x.sock" from-name="HALO-UI">\nEDGES peer says hi. The rest of it.\n</cross-session-message>\n\nThis came from another Claude session.' },
    origin: { kind: "peer", from: "uds:/tmp/x.sock", name: "HALO-UI", body: "EDGES peer says hi. The rest of it." },
  },
  60_000,
);
const LIMIT = asst([{ type: "text", text: "You've hit your session limit · resets 1:50pm (Asia/Saigon)" }], 70_000, {
  isApiErrorMessage: true,
  error: "rate_limit",
  apiErrorStatus: 429,
  quotaLimits: { status: "rejected", resetsAt: RESETS, rateLimitType: "five_hour" },
});
const APIERR = asst([{ type: "text", text: "API Error: Connection refused (ConnectionRefused)" }], 81_000, { isApiErrorMessage: true, error: "unknown" });
const LINES = [
  user("EDGES start", 0),
  asst([{ type: "text", text: "EDGES ready." }], 500),
  user(MEMO, 1_000),
  asst([{ type: "text", text: "EDGES heard the memo." }], 1_500),
  user(LONG, 2_000),
  tool("tu_agent1", "Agent", { description: "Design side nav", prompt: "x", subagent_type: "general-purpose", run_in_background: true }, 3_000),
  result("tu_agent1", `Async agent launched successfully. (internal)\nagentId: ${AGENT_ID} (internal ID)\nThe agent is working in the background.`, 3_100),
  tool("tu_bash1", "Bash", { command: "pnpm build", description: "build", run_in_background: true }, 4_000),
  result("tu_bash1", "Command running in background with ID: bshell123. Output is being written to: /tmp/x", 4_100),
  tool("tu_send", "SendMessage", { to: "HALO-UI", message: "EDGES hello from the lab. Second sentence here.", summary: "hello" }, 5_000),
  result("tu_send", "Message sent.", 5_100),
  tool("tu_wake", "ScheduleWakeup", { delaySeconds: 1200, reason: "EDGES check back", prompt: "x" }, 6_000),
  result("tu_wake", "Scheduled.", 6_100),
  tool("tu_mon", "Monitor", { description: "EDGES build log", command: "tail -F /tmp/x" }, 7_000),
  result("tu_mon", "Monitor started.", 7_100),
  tool("tu_ts", "ToolSearch", { query: "select:WebSearch,WebFetch" }, 8_000),
  result("tu_ts", "Loaded.", 8_100),
  tool("tu_stop", "TaskStop", { task_id: "bshell123" }, 9_000),
  result("tu_stop", "Stopped.", 9_100),
  tool("tu_tell", "Bash", { command: 'a0-tell --queue w7:p3 "EDGES: DONE R1.20c abc123"', description: "report" }, 10_000),
  result("tu_tell", "queued", 10_100),
  asst([{ type: "text", text: "EDGES turn done." }], 11_000),
  rec({ type: "system", subtype: "turn_duration", durationMs: 11_000 }, 11_000),
  PEER,
  asst([{ type: "text", text: "EDGES answered the peer." }], 61_000),
  user("EDGES limit turn", 69_000),
  LIMIT,
  user("EDGES again", 80_000),
  APIERR,
  user("EDGES final", 90_000),
  asst([{ type: "text", text: "EDGES last words." }], 91_000),
];
const dir = path.join(scratch, "claude", "projects", CWD.replace(/[^A-Za-z0-9]/g, "-"));
mkdirSync(dir, { recursive: true });
const FILE = path.join(dir, `${S}.jsonl`);
writeFileSync(FILE, LINES.map((l) => JSON.stringify(l)).join("\n") + "\n");

// The parsers, record by record (shared by the node and siso-host's history).
const { lineToEvents } = await import("../src/transcript.ts");
const { apiError, peerMessage } = await import("../../host/src/events.ts");
const peerEv = lineToEvents(PEER);
const limitEv = lineToEvents(LIMIT);
const apiEv = lineToEvents(APIERR);
check(
  "parser: a peer's meta line is a peer message (node), and the host's history reads it the same way",
  peerEv.length === 1 && peerEv[0].from === "peer" && peerEv[0].name === "HALO-UI" && peerEv[0].text === "EDGES peer says hi. The rest of it." &&
    peerMessage({ ...PEER, origin: { kind: "peer", name: "X" } })?.text === "EDGES peer says hi. The rest of it." &&
    lineToEvents({ ...PEER, origin: undefined }).length === 0,
  { peerEv },
);
check(
  "parser: a limit is an error card with its reset and window; an API error is one too; neither is text",
  limitEv.length === 1 && limitEv[0].t === "error" && limitEv[0].kind === "limit" && limitEv[0].resetsAt === RESETS * 1000 && limitEv[0].window === "five_hour" &&
    apiEv.length === 1 && apiEv[0].kind === "api" && apiError(APIERR, 0).text.startsWith("API Error"),
  { limitEv, apiEv },
);

// ---------------------------------------------------------------- the node and the app
const agentsFile = path.join(scratch, "agents.json");
const herdrLog = path.join(scratch, "herdr.log");
writeFileSync(
  agentsFile,
  JSON.stringify([
    { agent: "claude", agent_status: "idle", cwd: CWD, pane_id: "w1:p1", terminal_id: "term_edges1", terminal_title_stripped: "EDGES", agent_session: { value: S } },
    // The agent in the pane a0-tell names: the → row says its name, never "w7:p3".
    { agent: "claude", agent_status: "working", cwd: "/fake/agent-base", pane_id: "w7:p3", terminal_id: "term_edges_ab", terminal_title_stripped: "AGENT-BASE" },
  ]),
);
const env = {
  ...process.env,
  AB_PORT: String(PORT),
  AB_HERDR: `${process.execPath} ${path.join(REPO, "services/node/test/fake-herdr.mjs")}`,
  FAKE_HERDR_AGENTS_FILE: agentsFile,
  FAKE_HERDR_LOG: herdrLog,
  AB_CLAUDE_DIRS: path.join(scratch, "claude"),
  AB_HOSTS_DIR: path.join(scratch, "hosts"),
  AB_STATE: path.join(scratch, "rows.json"),
  AB_REGISTRY: path.join(scratch, "registry.json"),
  AB_RESURRECT_DIR: path.join(scratch, "none"),
  AB_CONSOLE_EVENTS: path.join(scratch, "none.jsonl"),
  AB_A0_SEAT: path.join(scratch, "seat.json"),
  AB_SESSION_RESCAN_MS: "500",
};
const node = spawn(process.execPath, ["--experimental-strip-types", "--no-warnings", "src/server.ts"], { cwd: path.join(REPO, "services/node"), env, stdio: "ignore" });
let browser = null;
const until = async (fn, ms = 15000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await fn()) return true;
    await sleep(100);
  }
  return false;
};
try {
  await until(async () => (await fetch(`http://127.0.0.1:${PORT}/api/health`).catch(() => null))?.ok);
  browser = await webkit.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`http://127.0.0.1:${PORT}/`);
  await page.locator('[data-testid=rail-row][aria-label^="EDGES"]').first().click({ timeout: 15000 });
  const view = page.locator("[data-testid=chat-view]:visible");
  await view.getByText("EDGES last words.").waitFor({ timeout: 15000 });

  // A2: the 2,400-character memo whole; the 62-line message folded, then whole.
  const memo = view.locator(".siso-chat__metext", { hasText: "EDGES memo" });
  const memoText = await memo.innerText();
  const memoFold = await memo.evaluate((el) => el.classList.contains("is-fold"));
  check("A2: a 2,400-char one-line memo renders whole, not folded", memoText.includes("END-OF-MEMO") && memoText.length >= MEMO.length - 5 && !memoFold, { chars: memoText.length });
  const long = view.locator(".siso-chat__metext", { hasText: "EDGES line 1" });
  const folded = await long.evaluate((el) => el.classList.contains("is-fold") && el.scrollHeight > el.clientHeight);
  const showAll = view.getByRole("button", { name: "Show all 62 lines" });
  const hasShow = await showAll.isVisible();
  await showAll.click();
  const opened = await long.evaluate((el) => !el.classList.contains("is-fold") && el.scrollHeight <= el.clientHeight + 1);
  check("A2: a 62-line message folds under \"Show all 62 lines\" and opens whole", folded && hasShow && opened, { folded, hasShow, opened });

  // D5: the background sub-agent is still running (its result came at once), in sight with ■ Stop, outside the fold.
  const card = view.locator("[data-testid=agent-card]", { hasText: "Design side nav" });
  const running = (await card.getAttribute("data-running")) === "1";
  const cardText = await card.innerText();
  check("D5: a terminal agent's background sub-agent is running after its launch result, not Done", running && /Working/.test(cardText) && !/Done/.test(cardText), { cardText });

  // H3: the messages this agent sent are → rows in sight even with the turn folded.
  const outRows = await view.locator("[data-testid=peer-row].is-out").allInnerTexts();
  const faces = await view.locator("[data-testid=peer-row] .siso-chat__peerface").count();
  check(
    "H3: SendMessage and a0-tell show as → peer rows (folded turn); the pane id resolves to its agent's name, each with an AgentFace",
    outRows.some((t) => /HALO-UI/.test(t) && /EDGES hello from the lab…/.test(t) && !/lab\.…/.test(t)) &&
      outRows.some((t) => /AGENT-BASE/.test(t) && /EDGES: DONE R1\.20c/.test(t)) &&
      !outRows.some((t) => /w7:p3/i.test(t)) &&
      faces === (await view.locator("[data-testid=peer-row]").count()),
    { outRows, faces },
  );
  // C10/E4: open the fold; each wordless tool says what it did.
  await view.locator(".siso-chat__foldhead").first().click();
  await page.waitForTimeout(200);
  for (const run of await view.locator(".siso-chat__runhead[aria-expanded=false]").all()) await run.click().catch(() => {});
  const body = await view.innerText();
  const want = [/Sleeping until \d\d:\d\d · EDGES check back/, /Watching EDGES build log/, /Loaded WebSearch, WebFetch/, /Stopped “build”/];
  check(
    "C10/E4: ScheduleWakeup, Monitor, ToolSearch and TaskStop (by the id's own call) each say what they did; no \"used N tool\"",
    want.every((r) => r.test(body)) && !/used \d+ tools?/i.test(body),
    { missing: want.filter((r) => !r.test(body)).map(String), used: body.match(/used \d+ tools?/gi) },
  );
  if (shots) {
    mkdirSync(shots, { recursive: true });
    await view.locator(".siso-chat__foldbody").first().screenshot({ path: path.join(shots, "r1.20c-tools-1440.png") });
  }

  // H1: the peer's message is a ← row.
  const inRow = view.locator("[data-testid=peer-row]:not(.is-out)", { hasText: "EDGES peer says hi" });
  check("H1: another agent's message shows as a ← peer row with its name", (await inRow.count()) === 1 && /HALO-UI/.test(await inRow.innerText()));

  // F4/F5: the cards; the limit's words are not the agent's.
  const limit = view.locator("[data-testid=chat-error][data-kind=limit]");
  const api = view.locator("[data-testid=chat-error][data-kind=api]");
  const limitText = await limit.innerText();
  const saidLimit = await view.locator(".siso-chat__said", { hasText: "hit your session limit" }).count();
  const amber = (await limit.locator(".siso-chat__dot").evaluate((el) => getComputedStyle(el).backgroundColor)) === "rgb(240, 176, 63)";
  check(
    "F4: a session limit is one amber card with one reset time (local, 24 h) and the countdown, not .siso-chat__said; Continue waits for the reset",
    (await limit.count()) === 1 && /^Session limit · resets \d\d:\d\d · in 2h 1\dm\n/.test(limitText) && !/1:50pm|resets.*resets/s.test(limitText) && amber && saidLimit === 0 && (await limit.getByRole("button", { name: "Continue" }).count()) === 0,
    { limitText, saidLimit, amber },
  );
  check("F5: an API error is its own card with Continue", (await api.count()) === 1 && /API error · Connection refused/.test(await api.innerText()) && (await api.getByRole("button", { name: "Continue" }).count()) === 1);
  if (shots) {
    await limit.scrollIntoViewIfNeeded();
    await view.screenshot({ path: path.join(shots, "r1.20c-cards-1440.png") });
  }

  // D8: Stop types the TaskStop request into the agent's pane (fake herdr), with the sub-agent's id.
  writeFileSync(herdrLog, "");
  await card.hover();
  await card.locator("[data-testid=agent-stop]").click();
  const typed = await until(() => readFileSync(herdrLog, "utf8").split("\n").some((l) => l.includes("send-text") && l.includes("TaskStop") && l.includes(AGENT_ID) && l.includes("Design side nav")), 8000);
  const stopping = /Stopping…/.test(await card.innerText());
  check("D8: ■ Stop asks the agent in its pane to TaskStop the sub-agent's id, and the card says Stopping…", typed && stopping, { typed, stopping });

  // D5: the task-notification ends it.
  appendFileSync(
    FILE,
    JSON.stringify(user(`<task-notification>\n<task-id>${AGENT_ID}</task-id>\n<tool-use-id>tu_agent1</tool-use-id>\n<status>killed</status>\n<summary>Agent "Design side nav" was stopped</summary>\n</task-notification>`, 120_000)) + "\n",
  );
  const ended = await until(async () => (await view.locator("[data-testid=agent-card]", { hasText: "Design side nav" }).first().getAttribute("data-running").catch(() => null)) === "0", 8000);
  const endText = ended ? await view.locator("[data-testid=agent-card]", { hasText: "Design side nav" }).first().innerText() : "";
  check("D5: its task-notification ends it (Stopped, with its run time)", ended && /Stopped \(\d+m/.test(endText), { endText });

  check("no page errors", errors.length === 0, { errors });
} catch (e) {
  check("ran without throwing", false, { error: String(e?.stack ?? e) });
} finally {
  await browser?.close();
  node.kill();
  rmSync(scratch, { recursive: true, force: true });
}
const passed = results.filter(Boolean).length;
console.log(`${passed}/${results.length} passed`);
process.exit(passed === results.length ? 0 : 1);
