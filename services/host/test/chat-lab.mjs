// Check: the app's chat for siso-host agents reads as cleanly as the CLI, takes messages while Claude works, shows
// sub-agents as cards, and asks for approval when the permission mode asks.
//   node services/host/test/chat-lab.mjs [session-to-replay] [shots-dir]
// Everything runs in its own herdr lab session (never the live one): three hosts in lab panes (REPLAY shows a real
// long session read-only; LAB-SDK runs haiku in bypass mode; LAB-ASK runs haiku in default mode), a node on :5405
// pointed at the lab with scratch state, and headless WebKit against the built app. Prints one JSON line per check and
// exits 1 if any failed. Tears the lab down.
import { execFileSync, spawn } from "node:child_process";
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import zlib from "node:zlib";
import { tmpdir } from "node:os";
import path from "node:path";

const RESEARCH = path.join(process.env.HOME, "SISO_Workspace/SISO_Agency/apps/siso-internal-labs/siso-internal-labs-agents/.agents/research/2026-10-01-agent-app");
const { webkit } = await import(path.join(RESEARCH, "ui-rob/t3code/node_modules/playwright/index.mjs"));
const LAB = path.join(RESEARCH, "tests/1-clean-terminal/lab");
const REPO = path.join(import.meta.dirname, "../../..");
const HOST = path.join(REPO, "services/host/bin/siso-host");
const [replay = "3ecfcc00-95ac-4fd5-8416-baede2bfb131", shots = path.join(RESEARCH, "chat-study/shots")] = process.argv.slice(2);
const PORT = 5405;
const scratch = mkdtempSync(path.join(process.env.TMPDIR ?? tmpdir(), ".siso-ephemeral-chat-lab."));
const HOSTS = path.join(scratch, "hosts");
const lab = (...a) => execFileSync(LAB, a, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
const SESSION = lab("name", "chatlab").trim();
const herdr = (...a) => JSON.parse(lab("run", SESSION, ...a) || "{}");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, detail = {}) => {
  results.push(!!ok);
  console.log(JSON.stringify({ check: name, ok: !!ok, ...detail }));
};
const q = (s) => `'${s.replace(/'/g, `'\\''`)}'`;

let node = null;
let browser = null;
try {
  lab("provision", SESSION);
  herdr("workspace", "create", "--label", "lab", "--no-focus", "--cwd", REPO);
  herdr("pane", "split", "w1:p1", "--direction", "right");
  herdr("pane", "split", "w1:p2", "--direction", "down");
  const env = `AB_HOSTS_DIR=${q(HOSTS)}`;
  herdr("pane", "run", "w1:p1", `cd ${q(REPO)} && ${env} ${q(HOST)} --replay ${replay} --name REPLAY`);
  herdr("pane", "run", "w1:p2", `cd ${q(scratch)} && ${env} ${q(HOST)} --name LAB-SDK --model opus --effort high --permission-mode bypassPermissions`);
  herdr("pane", "run", "w1:p3", `cd ${q(scratch)} && ${env} ${q(HOST)} --name LAB-ASK --model haiku --permission-mode default`);
  for (let i = 0; i < 60 && (() => { try { return readdirSync(HOSTS).length; } catch { return 0; } })() < 3; i++) await sleep(500);

  node = spawn(process.execPath, ["--experimental-strip-types", "--no-warnings", "src/server.ts"], {
    cwd: path.join(REPO, "services/node"),
    env: {
      ...process.env,
      AB_PORT: String(PORT),
      AB_HERDR: `${LAB} run ${SESSION}`,
      AB_HOSTS_DIR: HOSTS,
      AB_STATE: path.join(scratch, "rows.json"),
      AB_REGISTRY: path.join(scratch, "registry.json"),
      AB_CTX_DIR: path.join(scratch, "ctx"),
      AB_CONSOLE_EVENTS: path.join(scratch, "none.jsonl"),
      AB_RESURRECT_DIR: path.join(scratch, "none"),
    },
    stdio: "ignore",
  });
  for (let i = 0; i < 50; i++) {
    if (node.exitCode !== null) throw new Error("lab node failed to start; refusing to use another node's port");
    try {
      if ((await fetch(`http://127.0.0.1:${PORT}/api/health`)).ok) break;
    } catch {}
    await sleep(200);
  }

  browser = await webkit.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`http://127.0.0.1:${PORT}/`);
  // The app keeps every opened chat mounted (hidden): look only inside the one on screen.
  const view = () => page.locator("[data-testid=chat-view]:visible");
  const open = async (name) => {
    const row = page.locator(`[data-testid=rail-row][aria-label^="${name},"]`);
    await row.waitFor({ timeout: 20000 });
    await row.click();
    await view().waitFor({ timeout: 10000 });
    await page.waitForTimeout(1500);
  };

  // 1. A real long session, replayed: finished turns fold, runs collapse, markdown renders, edits show as diffs.
  await open("REPLAY");
  const folds = await view().locator(".siso-chat__foldhead").count();
  const foldText = (await view().locator(".siso-chat__foldhead").first().innerText().catch(() => "")).replace(/\s+/g, " ");
  const me = await view().locator(".siso-chat__me").count();
  const looseTools = await view().locator(".siso-chat__col > .siso-chat__turn > .siso-chat__call").count();
  check("a long session's finished turns fold to 'Worked for …'", folds > 3 && /^(✻ )?Worked/.test(foldText), { folds, first: foldText, prompts: me, looseTools });
  await page.screenshot({ path: `${shots}/ours-after-1-folded.png` });
  const peers = await view().locator(".siso-chat__peer").count();
  const peerRow = view().locator(".siso-chat__peerrow").first();
  const peerLine = (await peerRow.innerText().catch(() => "")).replace(/\s+/g, " ");
  await peerRow.click().catch(() => {});
  const peerFull = await view().locator(".siso-chat__peerfull").first().innerText().catch(() => "");
  check("other agents' messages are one coloured row (name, first sentence, › opens the rest); his stay ❯", peers > 0 && me > 0 && peerFull.length > peerLine.length - 20, { peers, his: me, row: peerLine.slice(0, 90) });
  const bars = view().locator(".siso-chat__minimap button");
  const nBars = await bars.count();
  const list = view().locator(".siso-chat__list");
  await list.evaluate((el) => (el.scrollTop = el.scrollHeight));
  await page.waitForTimeout(500);
  const before = await list.evaluate((el) => el.scrollTop);
  await bars.first().click();
  await page.waitForTimeout(900);
  const after = await list.evaluate((el) => el.scrollTop);
  check("the minimap has a bar per turn and a click jumps there", nBars >= 3 && after < before, { bars: nBars, before, after });
  await page.screenshot({ path: `${shots}/ours-after-0-minimap.png` });
  await view().locator(".siso-chat__foldhead").nth(Math.max(0, folds - 2)).click();
  await page.waitForTimeout(400);
  const runs = await view().locator(".siso-chat__runhead").allInnerTexts();
  check("inside a fold, tool runs read as one counted line", runs.some((r) => /^(Read|Ran|Searched|Used|Fetched|Listed|Updated)\b.*\d/.test(r.trim())), { sample: runs.slice(0, 4) });
  await view().locator(".siso-chat__foldhead").nth(Math.max(0, folds - 2)).scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${shots}/ours-after-2-fold-open.png` });
  // Open every fold so edits and markdown anywhere in the session can be counted.
  for (let n = 0; n < 200 && (await view().locator('.siso-chat__foldhead[aria-expanded="false"]').count()); n++) await view().locator('.siso-chat__foldhead[aria-expanded="false"]').first().click();
  await page.waitForTimeout(500);
  const pageText = await view().innerText();
  const notices = await view().locator(".siso-chat__notice").count();
  check("no raw XML: task notifications are one quiet line", !/<task-notification>|<system-reminder>|<task-id>/.test(pageText), { notices });
  const answers = await view().locator(".siso-chat__said.is-answer").count();
  check("a turn that ends on words shows them as a document", answers >= 1, { answers });
  const diffs = await view().locator(".siso-chat__diff").count();
  const md = await page.locator(".siso-md li, .siso-md strong, .siso-md code").count();
  check("edits show as red/green diffs and words as real markdown", diffs > 0 && md > 0, { diffs, markdownBits: md });
  const diff = view().locator(".siso-chat__edit").first();
  if (await diff.count()) {
    await diff.scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${shots}/ours-after-3-edit.png` });
  }

  // 2. Typing while Claude works: the message waits under the box (Queued), then Claude takes it in the same turn.
  await open("LAB-SDK");
  const box = view().getByRole("textbox", { name: "Message" });
  await box.fill("Use the Bash tool to run `sleep 6; echo one`. Then, as a separate Bash call, run `sleep 6; echo two`. Then reply with one short line.");
  await box.press("Enter");
  await view().getByRole("button", { name: "Stop" }).waitFor({ timeout: 20000 });
  const step = view().locator(".siso-chat__step");
  await step.first().waitFor({ timeout: 20000 }).catch(() => {});
  const stepText = await step.first().innerText().catch(() => "");
  const limit = await view().locator(".siso-chat__said", { hasText: /hit your.*limit/i }).first().innerText().catch(() => "");
  if (limit) throw new Error(`BLOCKED: ${limit}`);
  check("the running step sits under its line as '⎿ $ command'", /\$ sleep/.test(stepText), { step: stepText.replace(/\s+/g, " ") });
  await page.screenshot({ path: `${shots}/ours-after-4a-running-step.png` });
  await page.waitForTimeout(2500);
  await box.fill("Also: end your final reply with the word PINEAPPLE.");
  const sendVisible = await view().getByRole("button", { name: "Send" }).isEnabled();
  await box.press("Enter");
  await page.waitForTimeout(500);
  const queuedShown = await view().locator(".siso-chat__queued").isVisible().catch(() => false);
  await page.screenshot({ path: `${shots}/ours-after-4-queued.png` });
  check("while working, Stop sits beside Send and Enter still sends", sendVisible && (await view().getByRole("button", { name: "Stop" }).isVisible()), {});
  check("a message sent mid-turn shows as Queued under the box", queuedShown, {});
  await view().locator(".siso-chat__said", { hasText: "PINEAPPLE" }).waitFor({ timeout: 90000 });
  await view().getByRole("button", { name: "Stop" }).waitFor({ state: "detached", timeout: 30000 });
  const turns = await view().locator(".siso-chat__turn").count();
  const steers = await view().locator(".siso-chat__steer").count();
  const answerLive = await view().locator(".siso-chat__said.is-answer", { hasText: "PINEAPPLE" }).count();
  check("the final reply is the document, not a step", answerLive === 1, { answerLive });
  check("Claude takes the queued message in the same turn: one turn, his line inline", !(await view().locator(".siso-chat__queued").isVisible().catch(() => false)) && turns === 1 && steers === 1, { turns, steers });
  await page.screenshot({ path: `${shots}/ours-after-5-taken.png` });

  // 2b. Thinking: summarized thinking shows as "Thought for …" and opens to its words.
  await box.fill("Think carefully, step by step, about which is larger: 2^30 or 10^9, and by how much. Then answer in two short lines.");
  await box.press("Enter");
  await view().getByRole("button", { name: "Stop" }).waitFor({ timeout: 20000 });
  await view().getByRole("button", { name: "Stop" }).waitFor({ state: "detached", timeout: 120000 });
  for (let n = 0; n < 50 && (await view().locator('.siso-chat__foldhead[aria-expanded="false"]').count()); n++) await view().locator('.siso-chat__foldhead[aria-expanded="false"]').first().click();
  const thought = view().locator(".siso-chat__thought").last();
  const thoughtHead = await thought.innerText().catch(() => "");
  await thought.locator("button").click().catch(() => {});
  const thoughtText = await view().locator(".siso-chat__thoughttext").last().innerText().catch(() => "");
  check("thinking shows as 'Thought for …' and opens to its words", /Thought/.test(thoughtHead) && thoughtText.length > 20, { head: thoughtHead.replace(/\s+/g, " "), words: thoughtText.slice(0, 80) });
  await page.screenshot({ path: `${shots}/ours-after-5b-thinking.png` });

  // 2c. A formatted answer reads as a document: headings, status lines as callouts, a bordered table, a code block with a header.
  await box.fill("No tools. Write a short status report in markdown: a level-2 heading, three bullet lines starting with ✅, ⏳ and ⛔, a 3-row table with two columns, one blockquote line, and a 2-line bash code block.");
  await box.press("Enter");
  await view().getByRole("button", { name: "Stop" }).waitFor({ timeout: 20000 });
  await view().getByRole("button", { name: "Stop" }).waitFor({ state: "detached", timeout: 120000 });
  const doc = view().locator(".siso-chat__said.is-answer").last();
  const parts = { h2: await doc.locator("h2").count(), status: await doc.locator(".is-ok, .is-wait, .is-stop").count(), table: await doc.locator("table").count(), quote: await doc.locator("blockquote").count(), code: await doc.locator(".siso-md__codehead").count() };
  // Status lines are plain lines since 13:52 ("no coloured status slabs"); the rest of the document must render.
  check("a formatted answer renders as a document (heading, table, quote, code header)", parts.h2 && parts.table && parts.quote && parts.code, parts);
  await doc.scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${shots}/ours-after-5c-document.png` });

  // 2c'. An image pasted into the box reaches Claude (a red square; it should say red) and shows as a thumbnail.
  const png = (() => {
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
    const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(32 * 3, Buffer.from([220, 20, 30]))]);
    const raw = Buffer.concat(Array.from({ length: 32 }, () => row));
    return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
  })();
  const pngPath = path.join(scratch, "red.png");
  writeFileSync(pngPath, png);
  await view().locator('input[type=file]').setInputFiles(pngPath);
  await view().locator(".siso-chat__attach img").waitFor({ timeout: 10000 });
  await box.fill("What single colour fills this image? Reply in one word.");
  await box.press("Enter");
  await view().getByRole("button", { name: "Stop" }).waitFor({ timeout: 20000 });
  await view().getByRole("button", { name: "Stop" }).waitFor({ state: "detached", timeout: 120000 });
  const colour = await view().locator(".siso-chat__said").last().innerText();
  const thumb = await view().locator(".siso-chat__me .siso-chat__thumb").count();
  check("an image added to the box reaches Claude and shows as a thumbnail", /red/i.test(colour) && thumb >= 1, { reply: colour.slice(0, 40), thumb });

  // 2c''. Pasted text shows as a chip, never its raw tags.
  // As Claude Code writes it: the id on both tags.
  await box.fill('Reply with exactly OK. <pasted_content id="2972">first line\nsecond line\nthird line</pasted_content id="2972">');
  await box.press("Enter");
  await view().getByRole("button", { name: "Stop" }).waitFor({ state: "detached", timeout: 120000 }).catch(() => {});
  await page.waitForTimeout(1500);
  const meLast = await view().locator(".siso-chat__me").last().innerText();
  check("pasted text is a chip ('Pasted text · 3 lines'), no raw tags", /Pasted text · 3 lines/.test(meLast) && !meLast.includes("<pasted_content"), { me: meLast.replace(/\s+/g, " ").slice(0, 80) });

  // 2d. No glitch: while Claude works (tools, words streaming, the turn ending) the chat only grows, never jumps back.
  // Start from quiet: the previous turn finished and its fold has animated.
  for (let i = 0; i < 40 && (await view().getByRole("button", { name: "Stop" }).count()); i++) await page.waitForTimeout(500);
  await page.waitForTimeout(800);
  // He watches a live turn from the bottom (the earlier steps may have left the list scrolled up).
  await view().locator(".siso-chat__list").evaluate((el) => el.scrollTo({ top: el.scrollHeight }));
  await page.waitForTimeout(300);
  await view().locator(".siso-chat__col").evaluate((col) => {
    window.__h = [];
    window.__s = [];
    window.__t = setInterval(() => {
      // The working turn only: stop when Stop goes (the finish fold is checked separately, by the answer's place).
      if (window.__started && !document.querySelector('[data-testid=chat-view] [aria-label="Stop"]')) return;
      if (document.querySelector('[data-testid=chat-view] [aria-label="Stop"]')) window.__started = true;
      window.__h.push(col.getBoundingClientRect().height);
      const last = [...col.querySelectorAll(".siso-chat__turn")].at(-1);
      window.__s.push(last ? [...last.querySelectorAll(":scope > *, :scope .siso-chat__fold > *")].map((e) => `${e.className.split(" ")[0].replace("siso-chat__", "")}:${Math.round(e.getBoundingClientRect().height)}`).join(" ") + ` | slot:${Math.round(col.querySelector(".siso-chat__liveslot")?.getBoundingClientRect().height ?? 0)}` : "");
    }, 100);
  });
  await box.fill("Use Bash to run `ls | head -3`, then `sleep 3`, then reply with three short sentences about what you saw.");
  await box.press("Enter");
  await view().getByRole("button", { name: "Stop" }).waitFor({ timeout: 20000 });
  await view().locator(".siso-chat__verb").waitFor({ timeout: 10000 });
  await page.waitForTimeout(2500);
  const liveLine = (await view().locator(".siso-chat__working").innerText()).replace(/\s+/g, " ");
  check("the live line reads the CLI's way: '✻ Verb… (…)'", /✻\s*\S+.*…/.test(liveLine), { line: liveLine.slice(0, 120) });
  await view().getByRole("button", { name: "Stop" }).waitFor({ state: "detached", timeout: 120000 });
  const heights = await page.evaluate(() => (clearInterval(window.__t), window.__h));
  // The fold then animates; the answer must keep its place on screen while it does.
  const answer = view().locator(".siso-chat__turn").last().locator(".siso-chat__said.is-answer").last();
  const tops = [];
  for (let i = 0; i < 8; i++) {
    tops.push(await answer.evaluate((e) => e.getBoundingClientRect().bottom).catch(() => null));
    await page.waitForTimeout(80);
  }
  const spread = Math.max(...tops.filter((x) => x !== null)) - Math.min(...tops.filter((x) => x !== null));
  check("the answer keeps its place while the work folds away", spread <= 4, { spread: Math.round(spread) });
  const drops = heights.slice(1).map((h, i) => h - heights[i]).filter((d) => d < -4);
  const snaps = await page.evaluate(() => window.__s);
  const why = heights.slice(1).flatMap((h, i) => (h - heights[i] < -4 ? [{ drop: Math.round(h - heights[i]), before: snaps[i], after: snaps[i + 1] }] : []));
  check("the chat only grows while Claude works (no jumps back)", drops.length === 0, { samples: heights.length, drops: drops.map(Math.round), why });
  check("a finished turn folds Codex's way: 'Worked for …', a rule, the answer", (await view().locator(".siso-chat__turn").last().locator(".siso-chat__foldhead").count()) === 1 && (await view().locator(".siso-chat__turn").last().locator(".siso-chat__rule").count()) === 1, {});

  // 3. A sub-agent: a live card in the chat that opens its own transcript beside it.
  await box.fill("Use the Agent tool with subagent_type general-purpose to run the shell command `echo hello-from-sub` and report what it printed. Then reply with one line.");
  await box.press("Enter");
  const card = view().locator(".siso-chat__agent").first();
  await card.waitFor({ timeout: 90000 });
  await page.screenshot({ path: `${shots}/ours-after-6-subagent-live.png` });
  await view().getByRole("button", { name: "Stop" }).waitFor({ state: "detached", timeout: 150000 });
  for (let n = 0; n < 200 && (await view().locator('.siso-chat__foldhead[aria-expanded="false"]').count()); n++) await view().locator('.siso-chat__foldhead[aria-expanded="false"]').first().click();
  await view().locator(".siso-chat__agent").first().click();
  await page.waitForTimeout(800);
  await page.waitForTimeout(3000); // let a background sub-agent finish
  const side = await view().locator(".siso-chat__side").innerText().catch(() => "");
  const said = await view().locator(".siso-chat__side .siso-chat__said").allInnerTexts();
  check("the sub-agent panel says each thing once", new Set(said).size === said.length, { said: said.map((x) => x.slice(0, 50)) });
  check("a sub-agent is a card that opens its own transcript with a back arrow", (await view().locator(".siso-chat__side .siso-subhead__back").count()) === 1 && side.length > 20, { side: side.replace(/\s+/g, " ").slice(0, 160) });
  await page.screenshot({ path: `${shots}/ours-after-7-subagent-open.png` });
  await page.locator(".siso-subhead__back").click();

  // 4. A real approval (permission mode default): Allow runs it.
  await open("LAB-ASK");
  const box2 = view().getByRole("textbox", { name: "Message" });
  await box2.fill("Use the Bash tool to run `touch approved.txt && echo made`. Then reply with one line.");
  await box2.press("Enter");
  const ask = view().locator(".siso-chat__ask");
  await ask.waitFor({ timeout: 60000 });
  await page.screenshot({ path: `${shots}/ours-after-8-approval.png` });
  await ask.getByRole("button", { name: "Allow" }).click();
  await view().getByRole("button", { name: "Stop" }).waitFor({ state: "detached", timeout: 90000 });
  const made = readdirSync(scratch).includes("approved.txt");
  check("an approval asks with Allow/Deny and Allow runs the tool", made, {});
  check("no page errors", errors.length === 0, { errors: errors.slice(0, 3) });
} catch (e) {
  check("ran to the end", false, { error: String(e?.stack ?? e).slice(0, 700) });
} finally {
  await browser?.close();
  node?.kill();
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
