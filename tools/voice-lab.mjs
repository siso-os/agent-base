// Voice lab (VOICE step 3, 9 Oct): boots a node from any checkout with an invented history, a fake helper heartbeat and a
// fake Groq key, then shoots every Voice page at 1440 and 390 wide, the full height of the page. Used to put "ours
// today" next to "the upgrade" (ui-hub/voice/v3). Nothing real is read: HOME is a scratch folder, the words are made up,
// the voice watch is off and no launchctl is ever called. Never attaches to a live agent.
//
//   heavy -- node tools/voice-lab.mjs <checkout root> <out dir> [tag] [--inject <dir>] [--pages Home,Stats]
//
// The checkout's apps/web/dist must be built. Shots: <out>/<tag>-<page>-<width>.png
// --inject: <dir>/<page>.js (home.js, stats.js, ...) runs in the page before its shot, with the width as `width`, so a
// proposed upgrade is drawn into the real app with the app's own CSS. An exported value is ignored; await is allowed.
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import net from "node:net";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const args = process.argv.slice(2), flag = (name) => { const i = args.indexOf(name); return i < 0 ? null : args.splice(i, 2)[1]; };
const injectDir = flag("--inject"), onlyPages = flag("--pages");
const [rootArg, outArg, tag = "lab"] = args;
if (!rootArg || !outArg) { console.error("usage: voice-lab.mjs <checkout root> <out dir> [tag]"); process.exit(2); }
const root = path.resolve(rootArg), out = path.resolve(outArg);
mkdirSync(out, { recursive: true });
const scratch = mkdtempSync(path.join(tmpdir(), ".siso-ephemeral-voice-lab."));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── an invented month and a half of dictation, shaped like heavy daily use ──
let seed = 7;
const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const pick = (a) => a[Math.floor(rand() * a.length)];
const APPS = [["Agent Base", "com.siso.agent-base", 9], ["Messages", "com.apple.MobileSMS", 4], ["Cursor", "com.todesktop.cursor", 3], ["Safari", "com.apple.Safari", 2], ["Notes", "com.apple.Notes", 2], ["Slack", "com.tinyspeck.slackmacgap", 2], ["Mail", "com.apple.mail", 1]];
const weighted = APPS.flatMap((a) => Array(a[2]).fill(a));
const LINES = [
  "Can you take the top three items off the board and ship them in one sprint, then send me the link to look at",
  "Make the side panel go all the way up to the top line, it looks cramped where it stops right now",
  "Remind me tomorrow morning to call the accountant about the quarterly numbers",
  "The bar should stay where I dragged it, even after a restart",
  "Let's push the launch to Thursday so the landing page has a proper hero shot",
  "Okay so the plan is research first, then a mock I can point at, then build what I pick",
  "Running ten minutes late, start without me and I'll catch up",
  "Write the release note in plain words, one line per change, and put the before and after shots under it",
  "Check whether the export still breaks on files bigger than a hundred megabytes",
  "Send the invoice to the new client and copy in the project lead",
  "I like the stats page, keep it exactly as it is and add the speed underneath",
  "Can we get the voice app to show the raw words next to the cleaned up ones",
];
const FILLERS = ["um ", "uh ", "like ", "so ", "you know "];
const rawOf = (t) => t.split(" ").map((w, i) => (i % 7 === 3 && rand() < 0.5 ? pick(FILLERS) : "") + w).join(" ");
const dictation = path.join(scratch, "dictation");
mkdirSync(dictation, { recursive: true, mode: 0o700 });
writeFileSync(path.join(dictation, "owner.json"), JSON.stringify({ owner: "agent-base", jobs: [] }), { mode: 0o600 });
const db = new DatabaseSync(path.join(dictation, "history.sqlite"));
db.exec("CREATE TABLE dictations (id TEXT PRIMARY KEY, timestamp TEXT NOT NULL, app TEXT NOT NULL, bundleId TEXT NOT NULL, text TEXT NOT NULL, cleanup TEXT NOT NULL, raw TEXT, seconds REAL, ms INTEGER, model TEXT)");
const insert = db.prepare("INSERT INTO dictations VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
const now = Date.now();
let n = 0;
for (let day = 44; day >= 0; day--) {
  if (rand() < 0.08 && day > 3) continue; // a few days off
  const takes = day === 0 ? 14 : 8 + Math.floor(rand() * 28);
  for (let k = 0; k < takes; k++) {
    const hour = pick([9, 10, 10, 11, 11, 12, 14, 15, 15, 16, 17, 20, 21, 22, 23, 0, 1]);
    const at = new Date(now - day * 86_400_000);
    at.setHours(hour, Math.floor(rand() * 60), Math.floor(rand() * 60), 0);
    if (at.getTime() > now) at.setTime(now - (k + 1) * 7 * 60_000);
    const [app, bundle] = pick(weighted);
    const text = Array.from({ length: 1 + Math.floor(rand() * 3) }, () => pick(LINES)).join(". ") + ".";
    const words = text.split(/\s+/).length;
    insert.run(`00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`, at.toISOString(), app, bundle, text, "complete", rawOf(text), Math.round((words / 148) * 60 * (0.9 + rand() * 0.4) * 10) / 10, 600 + Math.floor(rand() * 900), "whisper-large-v3-turbo");
  }
}
db.close();
// The last takes, as the branch's take log keeps them (a checkout without it ignores the file).
const takeLines = [
  { outcome: "written", app: "Agent Base", seconds: 11.4, peakDb: -9, ms: 840 },
  { outcome: "written", app: "Messages", seconds: 4.2, peakDb: -12, ms: 610 },
  { outcome: "silent", app: "Safari", seconds: 1.6, peakDb: -61, ms: 4 },
  { outcome: "written", app: "Cursor", seconds: 23.9, peakDb: -7, ms: 1320, retry: true },
  { outcome: "queued", app: "Cursor", seconds: 23.9, peakDb: -7, ms: 30_200, error: "Groq did not answer" },
  { outcome: "written", app: "Agent Base", seconds: 186.0, peakDb: -6, ms: 4100 },
].reverse().map((t, i) => ({ at: new Date(now - (6 - i) * 9 * 60_000).toISOString(), id: `lab-${i}`, retry: false, ...t }));
writeFileSync(path.join(dictation, "takes.jsonl"), takeLines.map((l) => JSON.stringify(l)).join("\n") + "\n");
const log = path.join(scratch, "voice.log");
writeFileSync(log, [
  "09 Oct 09:12:03 voice helper up · pid 4121",
  "09 Oct 09:41:17 start toggle · MacBook Pro Microphone · authorized",
  "09 Oct 09:41:29 stop · 11.4 s · peak -9 dB · 1 part · Agent Base",
  "09 Oct 09:41:30 part 0 → 200 in 840 ms · 356 kB",
  "09 Oct 09:41:30 take done · 1 part · Agent Base",
  "09 Oct 10:02:44 tap re-enabled (wake)",
].join("\n") + "\n");
const prefs = path.join(scratch, "voice.plist");
const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
const terms = ["Agent Base", "herdr", "Groq", "SISO", "Convex", "Tauri", "Opus", "Codex"].map((text, i) => ({ id: `t${i}`, text, addedAt: now - i * 86_400_000 }));
const rules = [{ id: "r1", from: "agent bass", to: "Agent Base", enabled: true }, { id: "r2", from: "siso", to: "SISO", enabled: true }, { id: "r3", from: "her dr", to: "herdr", enabled: false }];
writeFileSync(prefs, `<?xml version="1.0"?><plist version="1.0"><dict><key>post_processing_enabled</key><true/><key>custom_system_prompt</key><string>Clean up filler words, keep my meaning and my tone.</string><key>custom_vocabulary</key><string>SISO, herdr, Groq</string><key>siso.dictionary.terms</key><string>${esc(JSON.stringify(terms))}</string><key>siso.replacements.rules</key><string>${esc(JSON.stringify(rules))}</string></dict></plist>`);
const settings = path.join(scratch, ".settings");
writeFileSync(settings, JSON.stringify({ groq_api_key: "lab-not-a-real-key" }), { mode: 0o600 });

// ── the node ──
const freePort = () => new Promise((resolve) => { const s = net.createServer(); s.listen(0, "127.0.0.1", () => { const { port } = s.address(); s.close(() => resolve(port)); }); });
const port = await freePort(), base = `http://127.0.0.1:${port}`;
const env = { ...process.env, HOME: scratch, AB_PORT: String(port), AB_HERDR: `${process.execPath} ${path.join(root, "services/node/test/fake-herdr.mjs")}`, FAKE_HERDR_AGENTS: "[]", AB_STATE: path.join(scratch, "rows.json"), AB_REGISTRY: path.join(scratch, "registry.json"), AB_CTX_DIR: path.join(scratch, "ctx"), AB_HOSTS_DIR: path.join(scratch, "hosts"), AB_RESURRECT_DIR: path.join(scratch, "none"), AB_CONSOLE_EVENTS: path.join(scratch, "none.jsonl"), AB_HUB_HOME: scratch, AB_VOICE_SETTINGS: settings, AB_VOICE_PREFS: prefs, AB_VOICE_DB: path.join(scratch, "absent.sqlite"), AB_DICTATION_DIR: dictation, AB_VOICE_WATCH: "0", AB_LAUNCHCTL: "/usr/bin/false", AB_VOICE_LAUNCH_AGENTS: path.join(scratch, "none"), AB_DICTATION_RETRY: "0", AB_VOICE_LOG: log, AB_GROQ_URL: "http://127.0.0.1:9/never", AB_VOICE_OUTBOX: path.join(scratch, "outbox.ndjson") };
delete env.GROQ_API_KEY;
const node = spawn(process.execPath, ["--experimental-strip-types", "--no-warnings", "src/server.ts"], { cwd: path.join(root, "services/node"), env, stdio: ["ignore", "ignore", "pipe"] });
let stderr = ""; node.stderr.on("data", (c) => (stderr += c));
const beat = () => fetch(`${base}/api/dictation/native`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ registered: true, permission: true, tap: true, mic: "authorized", device: "MacBook Pro Microphone" }) }).catch(() => {});
let browser, timer, code = 0;
try {
  for (let i = 0; i < 100; i++) { try { if ((await fetch(`${base}/api/dictation/status`)).ok) break; } catch {} await sleep(150); }
  await beat(); timer = setInterval(beat, 4000);
  const { webkit } = createRequire(path.join(import.meta.dirname, "../services/node/package.json"))("playwright");
  browser = await webkit.launch({ headless: true });
  const PAGES = ["Home", "History", "Stats", "Dictionary", "Settings"].filter((p) => !onlyPages || onlyPages.split(",").includes(p));
  const report = [];
  for (const name of PAGES) for (const width of [1440, 390]) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const errors = []; page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(base); await page.locator('.siso-app__rail-btn[aria-label^="Voice"]').first().click();
    await page.getByRole("navigation", { name: "Voice pages" }).getByRole("button", { name: new RegExp(`^${name}`) }).click();
    await sleep(1800);
    if (width === 390) { await page.setViewportSize({ width: 390, height: 844 }); await page.getByRole("button", { name: "Show or hide the side nav" }).click().catch(() => {}); await sleep(600); }
    const script = injectDir && path.join(path.resolve(injectDir), `${name.toLowerCase()}.js`);
    if (script && existsSync(script)) {
      await page.evaluate(`(async (width) => { ${readFileSync(script, "utf8")} })(${width})`).catch((e) => errors.push(`inject: ${e.message}`));
      await sleep(400);
    }
    // The whole page, not just the first screen: grow the window to the scrolled height of the Voice pane.
    const tall = Math.min(1500, await page.locator("[data-testid=voice-main]").evaluate((e) => e.scrollHeight - e.clientHeight).catch(() => 0));
    if (tall > 0) { await page.setViewportSize({ width, height: (width === 390 ? 844 : 900) + tall }); await sleep(500); }
    const file = path.join(out, `${tag}-${name.toLowerCase()}-${width}.png`);
    await page.screenshot({ path: file });
    report.push({ page: name, width, file: path.basename(file), height: (width === 390 ? 844 : 900) + Math.max(0, tall), errors });
    await page.close();
  }
  writeFileSync(path.join(out, `${tag}-shots.json`), JSON.stringify({ root, at: new Date().toISOString(), shots: report }, null, 2));
  console.log(JSON.stringify({ ok: report.every((r) => !r.errors.length), shots: report.length, errors: report.flatMap((r) => r.errors).slice(0, 5) }));
} catch (e) { code = 1; console.error(`voice-lab: ${e.message}\n${stderr.slice(-2000)}`); }
finally {
  clearInterval(timer); await browser?.close();
  const exited = node.exitCode === null ? new Promise((r) => { node.once("exit", r); setTimeout(r, 20_000); }) : null;
  node.kill("SIGTERM"); await exited;
  rmSync(scratch, { recursive: true, force: true, maxRetries: 5 });
}
process.exit(code);
