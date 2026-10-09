// Check: an agent running in the plain terminal (not under siso-host) gets the app's chat, read from its session file,
// and what is typed in the chat reaches its pane (backlog 2a).
//   node services/node/test/terminal-chat.mjs [shots-dir]
// Runs a real `claude --model haiku` in its own herdr lab session (never the live one), a node on :5406 pointed at
// the lab, and headless WebKit. Also times reading a live agent's session file (read-only). Exits 1 on any failure.
import { execFileSync, spawn } from "node:child_process";
import { mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import zlib from "node:zlib";
import { tmpdir } from "node:os";
import path from "node:path";

const RESEARCH = path.join(process.env.HOME, "SISO_Workspace/SISO_Agency/apps/siso-internal-labs/siso-internal-labs-agents/.agents/research/2026-10-01-agent-app");
const { webkit } = await import(path.join(RESEARCH, "ui-rob/t3code/node_modules/playwright/index.mjs"));
const LAB = path.join(RESEARCH, "tests/1-clean-terminal/lab");
const REPO = path.join(import.meta.dirname, "../../..");
const [shots = path.join(RESEARCH, "chat-study/shots")] = process.argv.slice(2);
const PORT = 5406;
const scratch = mkdtempSync(path.join(process.env.TMPDIR ?? tmpdir(), ".siso-ephemeral-term-chat."));
const lab = (...a) => execFileSync(LAB, a, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
const SESSION = lab("name", "termchat").trim();
const herdr = (...a) => JSON.parse(lab("run", SESSION, ...a) || "{}");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, detail = {}) => {
  results.push(!!ok);
  console.log(JSON.stringify({ check: name, ok: !!ok, ...detail }));
};
const api = (p) => fetch(`http://127.0.0.1:${PORT}${p}`).then((r) => r.json());

let node = null;
let browser = null;
try {
  // 0. Reading a live agent's session file is fast (read-only; the transcript code, no socket, no typing).
  const { Transcript, sessionFile } = await import(path.join(REPO, "services/node/src/transcript.ts"));
  const live = JSON.parse(execFileSync("herdr", ["agent", "list"], { encoding: "utf8" })).result.agents.filter((a) => a.agent === "claude" && a.agent_session?.value);
  const files = live.map((a) => sessionFile(a.agent_session.value, a.cwd)).filter(Boolean).sort((a, b) => statSync(b).size - statSync(a).size);
  if (files[0]) {
    const t0 = performance.now();
    const t = new Transcript(files[0]);
    check("a live agent's session reads into chat events quickly (read-only)", t.log.length > 0 && performance.now() - t0 < 1500, { mb: +(statSync(files[0]).size / 1e6).toFixed(1), events: t.log.length, ms: Math.round(performance.now() - t0), found: `${files.length} of ${live.length}` });
  }

  lab("provision", SESSION);
  herdr("workspace", "create", "--label", "lab", "--no-focus", "--cwd", REPO);
  // The pane's shell keeps AB_HOSTS_DIR, so siso-host started there later (Move to the app's chat) reports to this node.
  herdr("pane", "run", "w1:p1", `export AB_HOSTS_DIR='${path.join(scratch, "hosts")}'; claude --model haiku`);
  // First words typed in the pane itself, so the session file exists (Claude Code writes it on the first message).
  await sleep(9000);
  // A fresh worktree has not been trusted yet. Confirm only this isolated lab's
  // known checkout before typing the first test prompt (Enter defaults to Exit).
  const startup = lab("run", SESSION, "pane", "read", "w1:p1", "--lines", "30");
  if (startup.includes("Yes, I trust this folder")) {
    herdr("pane", "send-keys", "w1:p1", "Down");
    herdr("pane", "send-keys", "w1:p1", "Enter");
    await sleep(9000);
  }
  herdr("pane", "send-text", "w1:p1", "Reply with exactly: READY");
  await sleep(250); // bootstrap follows the same text-before-Enter rule as the node
  herdr("pane", "send-keys", "w1:p1", "Enter");

  node = spawn(process.execPath, ["--experimental-strip-types", "--no-warnings", "src/server.ts"], {
    cwd: path.join(REPO, "services/node"),
    env: {
      ...process.env,
      AB_PORT: String(PORT),
      AB_HERDR: `${LAB} run ${SESSION}`,
      AB_HOSTS_DIR: path.join(scratch, "hosts"),
      AB_STATE: path.join(scratch, "rows.json"),
      AB_REGISTRY: path.join(scratch, "registry.json"),
      AB_CTX_DIR: path.join(scratch, "ctx"),
      AB_CONSOLE_EVENTS: path.join(scratch, "none.jsonl"),
      AB_RESURRECT_DIR: path.join(scratch, "none"),
    },
    stdio: "ignore",
  });
  let agent = null;
  const labId = herdr("agent", "list").result.agents.find((a) => a.pane_id === "w1:p1")?.terminal_id;
  for (let i = 0; i < 60 && !agent?.chat; i++) {
    await sleep(1000);
    if (node.exitCode !== null) throw new Error("lab node failed to start; refusing to use another node's port");
    try {
      agent = (await api("/api/agents")).agents.find((a) => a.tool === "claude" && a.id === labId);
    } catch {}
  }
  check("a terminal Claude agent is offered a chat once its session file exists", !!agent?.chat && !agent.host, { name: agent?.name, session: agent?.session });

  browser = await webkit.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`http://127.0.0.1:${PORT}/`);
  const view = () => page.locator("[data-testid=chat-view]:visible");
  await page.locator("[data-testid=rail-row]").first().click();
  await view().waitFor({ timeout: 15000 });
  await view().locator(".siso-chat__said", { hasText: /READY|hit your.*limit/i }).waitFor({ timeout: 60000 });
  const limit = await view().locator(".siso-chat__said", { hasText: /hit your.*limit/i }).first().innerText().catch(() => "");
  if (limit) throw new Error(`BLOCKED: ${limit}`);
  check("its chat shows what was said in the terminal, read from the file", true, {});

  const box = view().getByRole("textbox", { name: "Message" });
  const t0 = Date.now();
  await box.fill("Reply with exactly: TERMINAL-CHAT-OK");
  await box.press("Enter");
  await view().locator(".siso-chat__said", { hasText: "TERMINAL-CHAT-OK" }).waitFor({ timeout: 60000 });
  const ms = Date.now() - t0;
  const typed = await view().locator(".siso-chat__me", { hasText: "TERMINAL-CHAT-OK" }).count();
  const pane = lab("run", SESSION, "pane", "read", "w1:p1", "--lines", "60");
  check("typing in the chat reaches the pane, and the reply comes back into the chat", typed >= 1 && pane.includes("TERMINAL-CHAT-OK"), { ms });
  await page.screenshot({ path: `${shots}/terminal-chat-1-reply.png` });

  await box.fill("Line one of a two-line message.\nLine two: reply with exactly TWO-LINES-OK");
  await box.press("Enter");
  await view().locator(".siso-chat__said", { hasText: "TWO-LINES-OK" }).waitFor({ timeout: 60000 });
  const meTexts = await view().locator(".siso-chat__me").allInnerTexts();
  check("a two-line message arrives as one message", meTexts.some((t) => t.includes("Line one") && t.includes("Line two")), {});

  // A long dictated message (6,000 characters on one line) arrives whole, not cut off.
  const long = `Here is a long message. ${"word ".repeat(1190)}End: reply with exactly LONG-OK and the number of characters is not needed.`;
  await box.fill(long);
  await box.press("Enter");
  await view().locator(".siso-chat__said", { hasText: "LONG-OK" }).waitFor({ timeout: 90000 });
  const got = await view().locator(".siso-chat__me").last().innerText();
  check("a 6,000-character message arrives whole (bracketed paste, Enter after it settles)", got.includes("End: reply with exactly LONG-OK"), { sent: long.length, shownChars: got.length });

  // An image goes in as its path; Claude Code reads it (a red square: it should say red).
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(zlib.crc32(td) >>> 0);
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(32, 0);
  ihdr.writeUInt32BE(32, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(96, Buffer.from([220, 20, 30]))]);
  writeFileSync(path.join(scratch, "red.png"), Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(Buffer.concat(Array(32).fill(row)))), chunk("IEND", Buffer.alloc(0))]));
  await view().locator("input[type=file]").setInputFiles(path.join(scratch, "red.png"));
  await view().locator(".siso-chat__attach img").waitFor({ timeout: 10000 });
  await box.fill("What single colour fills this image? Reply in one word.");
  await box.press("Enter");
  await view().locator(".siso-chat__said", { hasText: /red/i }).waitFor({ timeout: 90000 });
  check("an image added to the box reaches a terminal agent (pasted as its path) and shows as a thumbnail", (await view().locator(".siso-chat__me .siso-chat__thumb").count()) >= 1, {});

  await box.fill("Count slowly from 1 to 300 in words, one per line.");
  await box.press("Enter");
  await view().getByRole("button", { name: "Stop" }).waitFor({ timeout: 20000 });
  await page.waitForTimeout(2500);
  await view().getByRole("button", { name: "Stop" }).click();
  await view().getByRole("button", { name: "Stop" }).waitFor({ state: "detached", timeout: 20000 });
  check("Stop interrupts the terminal agent (Escape into its pane)", true, {});
  await page.screenshot({ path: `${shots}/terminal-chat-2-stopped.png` });
  // Move to the app's chat: the same pane and session, now under siso-host (earlier messages still there).
  await page.waitForTimeout(2000);
  const warns = [];
  page.on("console", (m) => m.type() === "warning" && warns.push(m.text()));
  const moveBtn = page.getByRole("button", { name: "Move to the app's chat" });
  const disabled = await moveBtn.isDisabled();
  await moveBtn.click({ timeout: 5000 }).catch(() => {});
  await sleep(3000);
  if (warns.length) console.log(JSON.stringify({ moveRefused: warns, disabled }));
  let moved = null;
  for (let i = 0; i < 40 && !moved?.host; i++) {
    await sleep(1000);
    moved = (await api("/api/agents")).agents.find((a) => a.pane === "w1:p1");
  }
  await page.waitForTimeout(2500);
  const history = await view().locator(".siso-chat__me", { hasText: "TERMINAL-CHAT-OK" }).count();
  await view().getByRole("textbox", { name: "Message" }).fill("Reply with exactly: MOVED-OK");
  await view().getByRole("textbox", { name: "Message" }).press("Enter");
  const replied = await view().locator(".siso-chat__said", { hasText: "MOVED-OK" }).waitFor({ timeout: 60000 }).then(() => true, () => false);
  check("'Move to the app's chat' restarts it under siso-host in the same pane and session, history kept", !!moved?.host && moved.session === agent.session && history >= 1 && replied, { host: moved?.host, sameSession: moved?.session === agent?.session, history, replied });
  await page.screenshot({ path: `${shots}/terminal-chat-3-moved.png` });
  check("no page errors", errors.length === 0, { errors: errors.slice(0, 3) });
} catch (e) {
  check("ran to the end", false, { error: String(e?.stack ?? e).slice(0, 700) });
} finally {
  await browser?.close();
  node?.kill();
  try {
    herdr("pane", "send-keys", "w1:p1", "ctrl+c");
    herdr("pane", "send-keys", "w1:p1", "ctrl+c");
  } catch {}
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
