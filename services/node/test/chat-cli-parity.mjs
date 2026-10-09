// Check (R1.20, Shaan 21:22 + 21:30: "it's not showing all the stuff that the cli shows" ... "a message he types in the
// terminal takes ages to reach the chat through herdr, sometimes never sends"):
//   1. every record kind the CLI shows renders in the chat (fixture session file with one of each);
//   2. a line typed while Claude works shows at once as queued, and exactly once after Claude takes it;
//   3. a chat follows the pane to a new session (resume, /clear, relay);
//   4. a send survives one herdr failure, and its outcome reaches a socket opened after the sender's closed;
//   5. the dev server (the :5420 preview) can open a chat: its proxy presents the node's own origin.
//   node services/node/test/chat-cli-parity.mjs [shots-dir]
// A fake herdr lists one Claude agent whose session file is a fixture in a scratch Claude folder; nothing live is read.
import { spawn } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import net from "node:net";
import path from "node:path";
import { chromium, webkit } from "playwright";

const REPO = path.join(import.meta.dirname, "../../..");
const { default: WebSocket } = await import(path.join(REPO, "services/node/node_modules/ws/index.js"));
const [shots = null] = process.argv.slice(2);
// Free ports, asked of the OS (fixed 5438/5439 collided with other lanes' runs, and vite quietly took the next port).
const freePort = async () => {
  const srv = net.createServer();
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  const p = srv.address().port;
  await new Promise((r) => srv.close(r));
  return p;
};
const PORT = await freePort();
const VITE_PORT = await freePort();
const scratch = mkdtempSync(path.join(process.env.TMPDIR ?? tmpdir(), ".siso-ephemeral-chat-parity."));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, detail = {}) => {
  results.push(!!ok);
  console.log(JSON.stringify({ check: name, ok: !!ok, ...detail }));
};

// ---------------------------------------------------------------- the fixture session
const CWD = "/fake/parity-lab";
const S1 = "parity-session-1";
const S2 = "parity-session-2";
const T0 = Date.now() - 600_000;
let n = 0;
const at = (ms) => new Date(T0 + ms).toISOString();
const rec = (o, ms) => ({ uuid: `r${n++}`, timestamp: at(ms), sessionId: S1, ...o });
const user = (content, ms, extra = {}) => rec({ type: "user", message: { role: "user", content }, ...extra }, ms);
const asst = (content, ms) => rec({ type: "assistant", message: { role: "assistant", content } }, ms);
const att = (attachment, ms) => rec({ type: "attachment", attachment }, ms);
const PNG = { type: "image", source: { type: "base64", media_type: "image/png", data: "iVBORw0KGgo=" } };
const LINES = [
  user("Turn one: show me everything the CLI shows.", 0),
  att({ type: "hook_success", hookName: "SessionStart:startup", content: "PARITY hook said hello", stdout: "", exitCode: 0 }, 500),
  att({ type: "hook_additional_context", hookName: "PostToolUse:Bash", content: ["PARITY context heads-up"] }, 600),
  asst([{ type: "thinking", thinking: "PARITY reasoning about the plan." }], 1_000),
  asst([{ type: "text", text: "PARITY first words." }], 2_000),
  asst([{ type: "tool_use", id: "tb1", name: "Bash", input: { command: "ls", description: "list" } }], 3_000),
  user([{ type: "tool_result", tool_use_id: "tb1", content: "a\nb" }], 4_000),
  att({ type: "hook_blocking_error", hookName: "Stop", blockingError: { blockingError: "PARITY stop hook says no", command: "x" } }, 5_000),
  rec({ type: "system", subtype: "stop_hook_summary", hookCount: 1, hookErrors: ["PARITY stop hook says no"] }, 5_001),
  user("Stop hook feedback: PARITY stop hook says no", 5_002, { isMeta: true }),
  asst([{ type: "text", text: "PARITY last words of turn one." }], 6_000),
  rec({ type: "system", subtype: "turn_duration", durationMs: 95_000, messageCount: 9 }, 95_000),
  rec({ type: "system", subtype: "compact_boundary", content: "Conversation compacted", compactMetadata: { trigger: "manual", preTokens: 262_673, postTokens: 13_664 } }, 96_000),
  att({ type: "silent_turn_reminder", text: "internal only" }, 96_500),
  att({ type: "total_tokens_reminder" }, 96_600),
  rec({ type: "custom-title", customTitle: "x" }, 96_700),
  user("<bash-input>git status</bash-input>", 97_000),
  user("<bash-stdout>PARITY clean tree</bash-stdout><bash-stderr></bash-stderr>", 97_500),
  user([PNG, { type: "text", text: "PARITY look at this picture" }], 98_000),
  user("Turn three: keep going.", 100_000),
  asst([{ type: "text", text: "PARITY working on turn three." }], 101_000),
];
const dir = path.join(scratch, "claude", "projects", CWD.replace(/[^A-Za-z0-9]/g, "-"));
mkdirSync(dir, { recursive: true });
const F1 = path.join(dir, `${S1}.jsonl`);
writeFileSync(F1, LINES.map((l) => JSON.stringify(l)).join("\n") + "\n");
const add = (file, ...ls) => appendFileSync(file, ls.map((l) => JSON.stringify(l)).join("\n") + "\n");

// ---------------------------------------------------------------- 6. the side-by-side fixture (t-0245)
// A second agent (FULLCLI) whose session holds one of each event kind, in the shapes lineToEvents parses, written by
// hand (no real transcript). CLI_EXPECT is what the Claude Code CLI prints for it, top to bottom; `chat` is how the app
// says the same line. The check in section 6 opens every fold and asserts each line is there, once, in this order.
const CWD2 = "/fake/parity-full";
const S3 = "parity-full-1";
const F0 = 200_000;
const full = (o, ms) => ({ ...rec(o, F0 + ms), sessionId: S3, cwd: CWD2 });
const fUser = (content, ms, extra = {}) => full({ type: "user", message: { role: "user", content }, ...extra }, ms);
const fAsst = (content, ms, extra = {}) => full({ type: "assistant", message: { role: "assistant", id: `m${n}`, content, ...(extra.usage ? { usage: extra.usage } : {}) }, ...extra }, ms);
const NOTIFY = (status) =>
  `<task-notification>\n<task-id>bgx1</task-id>\n<tool-use-id>fa_bg</tool-use-id>\n<status>${status}</status>\n<summary>Agent "FULL background audit" ${status}</summary>\n</task-notification>`;
const FULL = [
  // Turn 1: prose, thinking, a run of quiet calls, an edit, a failed call, a sub-agent (its own lines are a sidechain).
  fUser("FULL turn one: look around and fix it.", 0),
  fAsst([{ type: "thinking", thinking: "FULL plan the fix." }], 1_000),
  fAsst([{ type: "text", text: "FULL looking around first." }], 2_000),
  fAsst([{ type: "tool_use", id: "fg1", name: "Grep", input: { pattern: "fullNeedle" } }], 3_000),
  fUser([{ type: "tool_result", tool_use_id: "fg1", content: "a.ts:1" }], 3_100),
  fAsst([{ type: "tool_use", id: "fr1", name: "Read", input: { file_path: "/fake/parity-full/src/a.ts" } }], 3_200),
  fUser([{ type: "tool_result", tool_use_id: "fr1", content: "1\tconst a = 1;" }], 3_300),
  fAsst([{ type: "tool_use", id: "fe1", name: "Edit", input: { file_path: "/fake/parity-full/src/a.ts", old_string: "const a = 1;", new_string: "const a = 2;" } }], 4_000),
  fUser([{ type: "tool_result", tool_use_id: "fe1", content: "The file has been updated." }], 4_100),
  fAsst([{ type: "tool_use", id: "fb1", name: "Bash", input: { command: "npm test", description: "Run the tests" } }], 5_000),
  fUser([{ type: "tool_result", tool_use_id: "fb1", content: "FULL 3 tests failed", is_error: true }], 5_100),
  fAsst([{ type: "tool_use", id: "fa1", name: "Agent", input: { description: "FULL scout the repo", subagent_type: "Explore", prompt: "scout" } }], 6_000),
  full({ type: "assistant", isSidechain: true, message: { role: "assistant", content: [{ type: "text", text: "FULL sidechain words" }] } }, 6_100),
  fUser([{ type: "tool_result", tool_use_id: "fa1", content: [{ type: "text", text: "FULL scout found 2 files" }, { type: "text", text: "agentId: fga1 (for resuming to continue this agent's work if needed)" }] }], 7_000),
  fAsst([{ type: "tool_use", id: "fa_bg", name: "Agent", input: { description: "FULL background audit", subagent_type: "general-purpose", prompt: "audit", run_in_background: true } }], 7_500),
  fUser([{ type: "tool_result", tool_use_id: "fa_bg", content: [{ type: "text", text: "Async agent launched successfully.\nagentId: bgx1 (This is an internal ID for your use.)\nThe agent is currently working in the background." }] }], 7_600),
  fAsst([{ type: "text", text: "FULL turn one answer." }], 8_000),
  full({ type: "system", subtype: "turn_duration", durationMs: 65_000 }, 65_000),
  // A background sub-agent's end arrives as its own turn.
  fUser(NOTIFY("completed"), 66_000),
  fAsst([{ type: "text", text: "FULL the audit is back." }], 66_500),
  // Turn 2: a call he rejects, then the CLI's interrupt marker.
  fUser("FULL turn two: clean the build.", 70_000),
  fAsst([{ type: "tool_use", id: "fb2", name: "Bash", input: { command: "rm -rf build" } }], 71_000),
  fUser([{ type: "tool_result", tool_use_id: "fb2", is_error: true, content: "The user doesn't want to proceed with this tool use. The tool use was rejected (eg. if it was a file edit, the new_string was NOT written to the file). STOP what you are doing and wait for the user to tell you how to proceed." }], 72_000),
  fUser([{ type: "text", text: "[Request interrupted by user for tool use]" }], 72_001),
  // Turn 3: words, Esc, then an API error on the retry.
  fUser("FULL turn three: try again.", 80_000),
  fAsst([{ type: "text", text: "FULL partial reply before Esc." }], 81_000),
  fUser([{ type: "text", text: "[Request interrupted by user]" }], 82_000),
  fUser("FULL turn four: once more.", 85_000),
  full({ type: "assistant", isApiErrorMessage: true, apiErrorStatus: 529, message: { role: "assistant", model: "<synthetic>", content: [{ type: "text", text: "API Error: 529 FULL overloaded" }] } }, 86_000),
  // A slash command: its echo, the caveat (meta), its output and an error output.
  fUser("<local-command-caveat>Caveat: the messages below were generated by the user while running local commands.</local-command-caveat>", 90_000, { isMeta: true }),
  fUser("<command-name>/model</command-name>\n            <command-message>model</command-message>\n            <command-args>opus</command-args>", 90_001),
  fUser("<local-command-stdout>Set model to FULL opus</local-command-stdout>", 90_002),
  fUser("<command-name>/nosuch</command-name>\n            <command-message>nosuch</command-message>\n            <command-args></command-args>", 91_000),
  fUser("<local-command-stderr>FULL unknown command</local-command-stderr>", 91_001),
  // A ! command whose output is an error.
  fUser("<bash-input>cat missing.txt</bash-input>", 92_000),
  fUser("<bash-stdout></bash-stdout><bash-stderr>FULL no such file</bash-stderr>", 92_500),
  // Compaction: the /compact echo, the boundary, then the summary Claude carries on from.
  fUser("<command-name>/compact</command-name>\n            <command-message>compact</command-message>\n            <command-args></command-args>", 95_000),
  full({ type: "system", subtype: "compact_boundary", content: "Conversation compacted", compactMetadata: { trigger: "manual", preTokens: 150_000, postTokens: 9_000 } }, 96_000),
  fUser("This session is being continued from a previous conversation that ran out of context. FULL summary.", 96_001, { isCompactSummary: true, isVisibleInTranscriptOnly: true }),
  // Another agent's message, and a picture.
  fUser("<cross-session-message from=\"FULLPEER\">FULL hello from a peer</cross-session-message>", 97_000, { isMeta: true, origin: { kind: "peer", name: "FULLPEER" } }),
  fUser([PNG, { type: "text", text: "FULL what is in this picture" }], 98_000),
  fAsst([{ type: "text", text: "FULL a picture of a cat." }], 98_500),
  // The live turn: words, then a call still running (the agent is working), with its tokens so far.
  fUser("FULL turn last: build it.", 100_000),
  fAsst([{ type: "text", text: "FULL building now." }], 101_000, { usage: { output_tokens: 1_234 } }),
  fAsst([{ type: "tool_use", id: "fb3", name: "Bash", input: { command: "npm run build", description: "Build the app" } }], 102_000),
];
const CLI_EXPECT = [
  { kind: "prompt", cli: "> FULL turn one: look around and fix it.", chat: "FULL turn one: look around and fix it." },
  // The CLI prints "✻ Worked for 1m 5s" under the turn; the chat puts the same time on the fold over the turn's work.
  { kind: "turn time", cli: "✻ Worked for 1m 5s", chat: "Worked for 1m 5s" },
  { kind: "thinking", cli: "✻ Thinking…", chat: "Thought", folded: true },
  { kind: "text", cli: "⏺ FULL looking around first.", chat: "FULL looking around first." },
  { kind: "quiet calls", cli: "⏺ Searched for 1 pattern, read 1 file (ctrl+o to expand)", chat: "Searched for 1 pattern, read 1 file", folded: true },
  { kind: "edit", cli: "⏺ Update(src/a.ts) ⎿ Updated src/a.ts with 1 addition and 1 removal", chat: "Edited src/a.ts", folded: true },
  { kind: "failed call", cli: "⏺ Bash(npm test) ⎿ Error: FULL 3 tests failed", chat: "Bash(npm test)", folded: true },
  { kind: "failed call output", cli: "⎿ Error: FULL 3 tests failed", chat: "FULL 3 tests failed", folded: true },
  { kind: "sub-agent", cli: "⏺ Explore(FULL scout the repo) ⎿ Done", chat: "FULL scout the repo", folded: true },
  { kind: "background sub-agent", cli: "⏺ Agent(FULL background audit) ⎿ Backgrounded agent", chat: "FULL background audit", folded: true },
  { kind: "answer", cli: "⏺ FULL turn one answer.", chat: "FULL turn one answer." },
  { kind: "task notification", cli: "⏺ Agent \"FULL background audit\" completed", chat: "FULL background audit", folded: true },
  { kind: "reply to it", cli: "⏺ FULL the audit is back.", chat: "FULL the audit is back." },
  { kind: "prompt", cli: "> FULL turn two: clean the build.", chat: "FULL turn two: clean the build." },
  { kind: "rejected call", cli: "⏺ Bash(rm -rf build)", chat: "Bash(rm -rf build)", folded: true },
  { kind: "interrupted", cli: "⎿ Interrupted · What should Claude do instead?", chat: "Interrupted" },
  { kind: "prompt", cli: "> FULL turn three: try again.", chat: "FULL turn three: try again." },
  { kind: "text", cli: "⏺ FULL partial reply before Esc.", chat: "FULL partial reply before Esc." },
  { kind: "interrupted", cli: "⎿ Interrupted · What should Claude do instead?", chat: "Interrupted" },
  { kind: "prompt", cli: "> FULL turn four: once more.", chat: "FULL turn four: once more." },
  { kind: "api error", cli: "⎿ API Error: 529 FULL overloaded", chat: "API error · 529 FULL overloaded" },
  { kind: "slash command", cli: "> /model opus", chat: "/model opus" },
  { kind: "command output", cli: "⎿ Set model to FULL opus", chat: "Set model to FULL opus" },
  { kind: "slash command", cli: "> /nosuch", chat: "/nosuch" },
  { kind: "command error", cli: "⎿ FULL unknown command", chat: "FULL unknown command" },
  { kind: "! command", cli: "! cat missing.txt", chat: "! cat missing.txt" },
  { kind: "! output", cli: "⎿ FULL no such file", chat: "Ran cat missing.txt · 1 line" },
  { kind: "/compact", cli: "> /compact", chat: "Checkpoint" },
  { kind: "compacted", cli: "✻ Conversation compacted (ctrl+o for history)", chat: "Compacted" },
  { kind: "summary", cli: "⎿ Compacted. ctrl+o to see full summary", chat: "Earlier conversation, summarized" },
  { kind: "peer", cli: "> FULLPEER: FULL hello from a peer", chat: "FULL hello from a peer" },
  { kind: "image", cli: "> [Image #1] FULL what is in this picture", chat: "Image 1" },
  { kind: "image words", cli: "  FULL what is in this picture", chat: "FULL what is in this picture" },
  { kind: "reply", cli: "⏺ FULL a picture of a cat.", chat: "FULL a picture of a cat." },
  { kind: "prompt", cli: "> FULL turn last: build it.", chat: "FULL turn last: build it." },
  { kind: "text", cli: "⏺ FULL building now.", chat: "FULL building now." },
  { kind: "running call", cli: "⏺ Bash(npm run build) ⎿ Running…", chat: "npm run build" },
  { kind: "live line", cli: "✻ Mulling… (1m 40s · ↓ 1.2k tokens · esc to interrupt)", chat: "1.2k tokens" },
];
/** Each expected line found in `text` after the one before it: the misses, and the lines found out of order. */
function inOrder(text, expect) {
  const missing = [], reordered = [];
  let at = 0;
  for (const e of expect) {
    const i = text.indexOf(e.chat, at);
    if (i >= 0) at = i + e.chat.length;
    else if (text.includes(e.chat)) reordered.push(`${e.kind}: ${e.chat}`);
    else missing.push(`${e.kind}: ${e.chat}`);
  }
  return { missing, reordered };
}
const dir2 = path.join(scratch, "claude", "projects", CWD2.replace(/[^A-Za-z0-9]/g, "-"));
mkdirSync(dir2, { recursive: true });
writeFileSync(path.join(dir2, `${S3}.jsonl`), FULL.map((l) => JSON.stringify(l)).join("\n") + "\n");

// 1a. The parser, record by record.
const { lineToEvents, queueId } = await import("../src/transcript.ts");
const kinds = (r) => lineToEvents(r).map((e) => `${e.t}${e.label ? `:${e.label}` : ""}`);
const parsed = {
  hook_success: kinds(LINES[1]),
  hook_additional_context: kinds(LINES[2]),
  thinking: kinds(LINES[3]),
  hook_blocking_error: kinds(LINES[7]),
  stop_hook_summary: kinds(LINES[8]),
  meta: kinds(LINES[9]),
  turn_duration: kinds(LINES[11]),
  compact_boundary: kinds(LINES[12]),
  internal: [...kinds(LINES[13]), ...kinds(LINES[14]), ...kinds(LINES[15])],
  bash_input: lineToEvents(LINES[16]).map((e) => e.text),
  bash_stdout: kinds(LINES[17]),
  image: lineToEvents(LINES[18]).map((e) => e.text),
};
check(
  "parser: each CLI record kind maps to its chat event",
  parsed.hook_success.join() === "note:SessionStart:startup hook" &&
    parsed.hook_additional_context.join() === "note:PostToolUse:Bash hook" &&
    parsed.thinking.join() === "thinking" &&
    parsed.hook_blocking_error.join() === "note:Stop hook error" &&
    parsed.stop_hook_summary.length === 0 &&
    parsed.meta.length === 0 &&
    parsed.turn_duration.join() === "result" &&
    parsed.compact_boundary.join() === "note:Compacted" &&
    parsed.internal.length === 0 &&
    parsed.bash_input.join() === "! git status" &&
    parsed.bash_stdout.join() === "note:Shell" &&
    parsed.image[0] === "[Image #1]\nPARITY look at this picture",
  parsed,
);
// t-0245: the side-by-side fixture's new shapes, record by record.
const fk = (pred) => lineToEvents(FULL.find(pred));
const cmdEcho = fk((r) => String(r.message?.content).startsWith("<command-name>/model"));
const cmdErr = fk((r) => String(r.message?.content).includes("<local-command-stderr>"));
const rejected = fk((r) => r.message?.content?.[0]?.tool_use_id === "fb2");
const bashErr = fk((r) => String(r.message?.content).includes("<bash-stderr>FULL"));
check(
  "parser: a slash command echoes as his line, its stderr and a ! stderr are errors, a rejected call drops the boilerplate",
  cmdEcho[0]?.t === "user" && cmdEcho[0].text === "/model opus" && cmdErr[0]?.label === "Error" && cmdErr[0].bad === true &&
    bashErr[0]?.bad === true && rejected[0]?.ok === false && rejected[0].out === "" &&
    fk((r) => r.isSidechain).length === 0 && fk((r) => String(r.message?.content).includes("local-command-caveat")).length === 0,
  { cmdEcho, cmdErr, rejected, bashErr },
);
const q = { type: "queue-operation", timestamp: at(0), sessionId: S1 };
check(
  "parser: queue enqueue → queued (fixed), remove → unqueued, a dequeue or a notification adds nothing",
  JSON.stringify(lineToEvents({ ...q, operation: "enqueue", content: "hi there" })) === JSON.stringify([{ t: "queued", id: queueId("hi there"), text: "hi there", at: T0, fixed: true }]) &&
    lineToEvents({ ...q, operation: "remove", content: "hi  there" })[0]?.id === queueId("hi there") &&
    lineToEvents({ ...q, operation: "dequeue" }).length === 0 &&
    lineToEvents({ ...q, operation: "enqueue", content: "<task-notification>x</task-notification>" }).length === 0 &&
    lineToEvents({ ...q, operation: "enqueue" }).length === 0,
);

// ---------------------------------------------------------------- the node and the app
const agentsFile = path.join(scratch, "agents.json");
const herdrLog = path.join(scratch, "herdr.log");
const failOnce = path.join(scratch, "fail-once");
const agent = (session, status = "working") => [
  { agent: "claude", agent_status: status, cwd: CWD, pane_id: "w1:p1", terminal_id: "term_parity1", terminal_title_stripped: "PARITY", agent_session: { value: session } },
  { agent: "claude", agent_status: "working", cwd: CWD2, pane_id: "w1:p2", terminal_id: "term_full1", terminal_title_stripped: "FULLCLI", agent_session: { value: S3 } },
];
writeFileSync(agentsFile, JSON.stringify(agent(S1)));
const env = {
  ...process.env,
  AB_PORT: String(PORT),
  AB_HERDR: `${process.execPath} ${path.join(REPO, "services/node/test/fake-herdr.mjs")}`,
  FAKE_HERDR_AGENTS_FILE: agentsFile,
  FAKE_HERDR_LOG: herdrLog,
  FAKE_HERDR_FAIL_ONCE: failOnce,
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
let vite = null;
let browser = null;
/** A raw chat socket with the given Origin; collects every message. */
function sock(origin, base = `ws://127.0.0.1:${PORT}`) {
  const ws = new WebSocket(`${base}/chat/term_parity1/ws`, { headers: { origin } });
  const got = [];
  const closed = new Promise((r) => ws.on("close", (code) => r(code)));
  ws.on("message", (d) => got.push(JSON.parse(String(d))));
  ws.on("error", () => {});
  const opened = new Promise((r) => (ws.on("open", () => r(true)), ws.on("close", () => r(false))));
  return { ws, got, closed, opened };
}
const until = async (fn, ms = 8000) => {
  for (let t = 0; t < ms; t += 100) {
    if (await fn()) return true;
    await sleep(100);
  }
  return false;
};
try {
  await until(async () => (await fetch(`http://127.0.0.1:${PORT}/api/health`).catch(() => null))?.ok);
  // WebKit is the app's engine; a machine without it (a cloud box) runs the same page in Chromium.
  browser = await webkit.launch().catch((e) => {
    const exe = process.env.AB_CHROMIUM ?? "/opt/pw-browsers/chromium";
    if (!existsSync(exe)) throw e;
    return chromium.launch({ executablePath: exe });
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`http://127.0.0.1:${PORT}/`);
  await page.locator('[data-testid=rail-row][aria-label^="PARITY"]').first().click({ timeout: 15000 });
  const view = page.locator("[data-testid=chat-view]:visible");
  await view.getByText("PARITY working on turn three.").waitFor({ timeout: 15000 });

  // 1b. Every kind on screen: turn one's fold shows the CLI's own time; inside it, the hook lines and the thinking.
  const fold = view.locator(".siso-chat__foldhead").first();
  const foldText = await fold.innerText();
  await fold.click();
  await page.waitForTimeout(300);
  const body = await view.innerText();
  const quiet = await view.locator(".siso-chat__quiet > button b").allInnerTexts();
  check("turn one folds to the CLI's own turn time", /Worked for 1m 35s/.test(foldText), { foldText });
  check(
    "hook output, hook error, compaction and shell output each show as a labelled line",
    ["SessionStart:startup hook", "PostToolUse:Bash hook", "Stop hook error", "Compacted"].every((l) => quiet.includes(l)) && (await view.locator(".siso-chat__quiet.is-bad").count()) >= 1,
    { quiet },
  );
  check("the thinking, both texts and the tool call are there", /Thought/.test(body) && body.includes("PARITY first words.") && body.includes("PARITY last words of turn one.") && /Listed 1 directory/.test(body));
  check("his ! command and his picture message show as his words (the image as its chip)", body.includes("! git status") && /Image 1/.test(body) && body.includes("PARITY look at this picture"));
  // Review fix 1: a `!` command's output is not folded behind "Worked for": "Ran git status · 1 line", opening to mono text.
  const ran = view.locator(".siso-chat__quiet").filter({ hasText: "Ran git status · 1 line" });
  const ranShown = (await ran.count()) === 1 && (await ran.isVisible());
  await ran.locator("button").first().click().catch(() => {});
  const ranText = await ran.locator(".siso-chat__quiettext.is-mono").innerText().catch(() => "");
  check("a ! command's output shows as 'Ran git status · 1 line', opening to its output in mono", ranShown && ranText.includes("PARITY clean tree"), { ranShown, ranText });
  // Review fix 2: one line between turns: a turn with a timed divider has no border above it and no rule at its end.
  const rules = await view.evaluate((root) =>
    [...root.querySelectorAll(".siso-chat__turn")].map((t) => {
      const prev = t.previousElementSibling;
      const lines = (t.querySelector(":scope > .turn-divider") ? 1 : 0) + (parseFloat(getComputedStyle(t).borderTopWidth) > 0 ? 1 : 0) + (prev?.classList.contains("siso-chat__turn") && prev.querySelector(":scope > .siso-chat__fold:last-child > hr.siso-chat__rule:last-child") ? 1 : 0);
      return lines;
    }),
  );
  check("exactly one line between turns", rules.slice(1).every((n) => n === 1), { rules });
  check("the stop hook shows once (its summary and meta copy stay out), internal records never", (body.match(/PARITY stop hook says no/g) ?? []).length <= 1 && !body.includes("internal only"), {});

  // 2. Typed while busy: queued at once; exactly once after Claude takes it.
  const LINE = "PARITY typed while you work";
  add(F1, { type: "queue-operation", operation: "enqueue", timestamp: new Date().toISOString(), sessionId: S1, content: LINE });
  const t0 = Date.now();
  const shown = await until(async () => (await view.locator("[data-testid=queued-row]").filter({ hasText: LINE }).count()) === 1, 5000);
  check("a line typed while Claude works shows as queued at once", shown && Date.now() - t0 < 3000, { ms: Date.now() - t0, takeBack: await view.locator("[data-testid=queued-row] button").count() });
  if (shots) await page.screenshot({ path: path.join(shots, "r1.20-queued-1440.png") });
  add(
    F1,
    { type: "queue-operation", operation: "remove", timestamp: new Date().toISOString(), sessionId: S1, content: LINE, reason: "absorbed_mid_turn", commandUuid: "c1" },
    rec({ type: "attachment", attachment: { type: "queued_command", prompt: LINE, source_uuid: "c1", commandMode: "prompt" }, timestamp: new Date().toISOString() }, 0),
  );
  await until(async () => (await view.locator("[data-testid=queued-row]").count()) === 0, 5000);
  await page.waitForTimeout(400);
  const after = await view.innerText();
  check("once taken it shows exactly once, inline, and the queued row is gone", (after.match(new RegExp(LINE, "g")) ?? []).length === 1 && (await view.locator("[data-testid=queued-row]").count()) === 0, { count: (after.match(new RegExp(LINE, "g")) ?? []).length });
  // A dequeue (no text) followed by his message as a fresh turn also settles it.
  const LINE2 = "PARITY second queued line";
  add(F1, { type: "queue-operation", operation: "enqueue", timestamp: new Date().toISOString(), sessionId: S1, content: LINE2 });
  await until(async () => (await view.locator("[data-testid=queued-row]").count()) === 1, 5000);
  add(F1, { type: "queue-operation", operation: "dequeue", timestamp: new Date().toISOString(), sessionId: S1 }, user(LINE2, Date.now() - T0));
  await until(async () => (await view.locator("[data-testid=queued-row]").count()) === 0, 5000);
  await page.waitForTimeout(400);
  check("a dequeued line settles when his message lands (shown once)", ((await view.innerText()).match(new RegExp(LINE2, "g")) ?? []).length === 1 && (await view.locator("[data-testid=queued-row]").count()) === 0);

  // 3. The pane moves to a new session: the socket closes with 4002 and the chat reopens on the new file.
  const s = sock(`http://127.0.0.1:${PORT}`);
  await s.opened;
  writeFileSync(path.join(dir, `${S2}.jsonl`), [user("PARITY new session hello", Date.now() - T0 - 1000), asst([{ type: "text", text: "PARITY reply in the new session" }], Date.now() - T0)].map((l) => JSON.stringify({ ...l, sessionId: S2 })).join("\n") + "\n");
  writeFileSync(agentsFile, JSON.stringify(agent(S2, "idle")));
  const code = await Promise.race([s.closed, sleep(10_000).then(() => "timeout")]);
  check("a new session on the pane closes the old chat socket with 4002", code === 4002, { code });
  const followed = await until(async () => (await view.getByText("PARITY reply in the new session").count()) > 0, 10_000);
  const top = await view.innerText();
  check("the open chat reopens on the new session, with one 'New session' line at the top", followed && !top.includes("PARITY working on turn three.") && (top.match(/New session · \d\d:\d\d/g) ?? []).length === 1, {});
  if (shots) await page.screenshot({ path: path.join(shots, "r1.20-followed-1440.png") });
  check("no page errors", errors.length === 0, { errors });

  // 4. A send survives one herdr failure; its outcome reaches a socket opened after the sender closed.
  writeFileSync(herdrLog, "");
  writeFileSync(failOnce, "1");
  const a = sock(`http://127.0.0.1:${PORT}`);
  await a.opened;
  a.ws.send(JSON.stringify({ t: "prompt", text: "PARITY send me", key: "k-retry" }));
  await until(async () => a.got.some((m) => m.key === "k-retry"), 8000);
  const sends = readFileSync(herdrLog, "utf8").split("\n").filter((l) => l.includes('"send-text"')).length;
  check("a herdr failure is tried once more and the send is acked sent", a.got.find((m) => m.key === "k-retry")?.t === "sent" && sends === 2 && !existsSync(failOnce), { ack: a.got.find((m) => m.key === "k-retry"), sends });
  a.ws.send(JSON.stringify({ t: "prompt", text: "PARITY late ack", key: "k-late" }));
  a.ws.close();
  await sleep(600);
  const b = sock(`http://127.0.0.1:${PORT}`);
  await until(async () => b.got.some((m) => m.key === "k-late"), 5000);
  check("an ack the closed socket missed reaches the next socket", b.got.some((m) => m.key === "k-late" && m.t === "sent"), { got: b.got.filter((m) => m.key).map((m) => `${m.t}:${m.key}`) });
  b.ws.close();

  // 5. The dev server's proxy: a chat opened through it (origin = the dev server) gets its hello.
  const direct = sock(`http://localhost:${VITE_PORT}`);
  check("the node itself still refuses a foreign origin", !(await direct.opened));
  vite = spawn("pnpm", ["exec", "vite", "--host", "127.0.0.1"], { cwd: path.join(REPO, "apps/web"), env: { ...process.env, AB_NODE: String(PORT), AB_WEB_PORT: String(VITE_PORT) }, stdio: "ignore", detached: true });
  await until(async () => (await fetch(`http://127.0.0.1:${VITE_PORT}/`).catch(() => null))?.ok, 30_000);
  const viaVite = sock(`http://localhost:${VITE_PORT}`, `ws://127.0.0.1:${VITE_PORT}`);
  const hello = await until(async () => viaVite.got.some((m) => m.t === "hello"), 8000);
  check("through the dev server's proxy the chat opens (hello)", hello, { got: viaVite.got.map((m) => m.t).slice(0, 3) });
  viaVite.ws.close();
  const api = await fetch(`http://127.0.0.1:${VITE_PORT}/api/agents`, { headers: { origin: `http://localhost:${VITE_PORT}` } }).catch(() => null);
  check("and /api answers through it", api?.ok === true, { status: api?.status });

  // 6. Side by side (t-0245): the FULLCLI fixture against what the CLI prints for it. Every fold, quiet run and
  // sub-agent row opened, the chat must hold each CLI line once, in the CLI's order; folded or not, what the CLI never
  // hides (his words, answers, interrupts, errors, command output, compaction) must be on screen as it loads.
  const page2 = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors2 = [];
  page2.on("pageerror", (e) => errors2.push(e.message));
  await page2.goto(`http://127.0.0.1:${PORT}/`);
  await page2.locator('[data-testid=rail-row][aria-label^="FULLCLI"]').first().click({ timeout: 15000 });
  const v2 = page2.locator("[data-testid=chat-view]:visible");
  await v2.getByText("FULL building now.").waitFor({ timeout: 15000 });
  await until(async () => (await v2.locator("[data-testid=live-line]").innerText().catch(() => "")).includes("1.2k"), 5000);
  const shut = await v2.innerText();
  const always = CLI_EXPECT.filter((e) => !e.folded);
  const seen = inOrder(shut, always);
  check("side by side, folded: every line the CLI never hides is on screen, in its order", !seen.missing.length && !seen.reordered.length, seen);
  // One at a time: each click re-renders, so a list of nth() locators would skip folds.
  const shutFolds = v2.locator(".siso-chat__foldhead[aria-expanded=false], .siso-chat__qhead[aria-expanded=false]");
  for (let k = 0; k < 20 && (await shutFolds.count()); k++) await shutFolds.first().click();
  await page2.waitForTimeout(300);
  const opened = await v2.innerText();
  const all = inOrder(opened, CLI_EXPECT);
  check(`side by side, opened: all ${CLI_EXPECT.length} CLI lines are in the chat, none dropped or reordered`, !all.missing.length && !all.reordered.length, all);
  const once = ["FULL turn one answer.", "FULL partial reply before Esc.", "FULL unknown command", "Set model to FULL opus", "FULL hello from a peer"].filter((t) => opened.split(t).length !== 2);
  check("no line shows twice; the sidechain, the caveat and the rejection boilerplate never show", !once.length && !/FULL sidechain words|Caveat:|doesn't want to proceed|<command-|<local-command/.test(opened), { once });
  const cards = await v2.locator("[data-testid=agent-card]").evaluateAll((els) => els.map((e) => `${e.querySelector(".ab-fan__what")?.textContent?.trim()}:${e.getAttribute("data-running")}`));
  check("sub-agent cards: the finished foreground one and the ended background one both read done", cards.length === 2 && cards.every((c) => c.endsWith(":0")), { cards });
  const step = await v2.locator("[data-testid=step-line]").innerText().catch(() => "");
  check("the live line shows the running call and the turn's tokens", step.includes("npm run build") && (await v2.locator("[data-testid=live-line]").innerText()).includes("1.2k tokens"), { step });
  const bad = await v2.locator(".siso-chat__quiet.is-bad").allInnerTexts();
  check("a command's error output and a ! command's stderr read as errors", bad.some((t) => t.includes("Ran cat missing.txt")) && bad.some((t) => /Error|nosuch|unknown/.test(t)), { bad });
  if (shots) await page2.screenshot({ path: path.join(shots, "t0245-side-by-side-1440.png"), fullPage: true });
  check("no page errors on the side-by-side chat", errors2.length === 0, { errors2 });
} finally {
  await browser?.close();
  if (vite) {
    try {
      process.kill(-vite.pid);
    } catch {}
  }
  node.kill();
  rmSync(scratch, { recursive: true, force: true });
}
const passed = results.filter(Boolean).length;
console.log(JSON.stringify({ passed, of: results.length }));
process.exit(passed === results.length ? 0 : 1);
