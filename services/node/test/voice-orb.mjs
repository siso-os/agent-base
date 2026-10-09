// Check (t-0271 part 2, t-0270): the voice orb and the speaker toggle. The node's /api/voice/speak turns one sentence
// into a WAV through a fake Groq (Orpheus, the lab key) and falls back to a fake `say`. In the app: the orb opens the
// mic once and keeps it warm, so the second press starts listening in under 100 ms (measured in the page, from the
// press to the orb's listening state, with a mic that takes 300 ms to open); hovering the orb warms it before the first
// press; the orb follows the level; Agent Zero's face listens while his mic records; the speaker toggle sits beside
// the orb and reads a new reply aloud, and the mic stops it; reduced motion stops the orb's turning and swelling.
// A fake herdr, fake Groq and say, a lab session file, headless WebKit at 1440 and 390; never a live agent or the mic.
//   pnpm --filter @agent-base/web build && node services/node/test/voice-orb.mjs
// Shots: .shots/voice-orb-{1-idle,2-listening,3-face,4-speaking,5-phone}.png (AB_SHOTS=1: apps/web/preview/)
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { appendFileSync, chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import net from "node:net";
import path from "node:path";

const REPO = path.resolve(import.meta.dirname, "../../..");
import { launchBrowser } from "./voice-browser.mjs";
// Shots go to the untracked .shots/ (a run never dirties another lane's tree); AB_SHOTS=1 refreshes apps/web/preview.
const SHOTS = process.env.AB_SHOTS === "1" ? path.join(REPO, "apps/web/preview") : path.join(REPO, ".shots");
mkdirSync(SHOTS, { recursive: true });
const FIXTURE = readFileSync(path.join(import.meta.dirname, "fixtures/voice/hello-a0.m4a"));
const SAID = "Agent Zero, what is on my list today?";
const LAB_KEY = "lab-fake-key-not-real";
const scratch = mkdtempSync(path.join(process.env.TMPDIR ?? tmpdir(), ".siso-ephemeral-voice-orb."));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, detail = {}) => {
  results.push(!!ok);
  console.log(JSON.stringify({ check: name, ok: !!ok, ...detail }));
};
const freePort = async () => {
  const s = net.createServer();
  await new Promise((r) => s.listen(0, "127.0.0.1", r));
  const p = s.address().port;
  await new Promise((r) => s.close(r));
  return p;
};
// A tiny valid WAV (16-bit mono, 8 kHz, 0.1 s of silence).
const wav = (() => {
  const n = 800, b = Buffer.alloc(44 + n * 2);
  b.write("RIFF", 0); b.writeUInt32LE(36 + n * 2, 4); b.write("WAVE", 8); b.write("fmt ", 12); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(8000, 24); b.writeUInt32LE(16000, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write("data", 36); b.writeUInt32LE(n * 2, 40);
  return b;
})();

// The fake Groq: speech to text and text to speech; records what arrived (never prints the key).
let ttsMode = "ok";
const tts = [];
const groq = createServer((req, res) => {
  const chunks = [];
  req.on("data", (c) => chunks.push(c));
  req.on("end", () => {
    const body = Buffer.concat(chunks);
    if (req.url.endsWith("/audio/speech")) {
      let j = {};
      try { j = JSON.parse(body.toString()); } catch {}
      tts.push({ auth: req.headers.authorization === `Bearer ${LAB_KEY}`, ...j });
      if (ttsMode === "500") return res.writeHead(500, { "content-type": "application/json" }).end('{"error":{"message":"down"}}');
      return res.writeHead(200, { "content-type": "audio/wav" }).end(wav);
    }
    res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ text: ` ${SAID} ` }));
  });
});
await new Promise((r) => groq.listen(0, "127.0.0.1", r));
const G = `http://127.0.0.1:${groq.address().port}/openai/v1/audio`;

// The fake say: writes the WAV to -o and logs the words.
const sayLog = path.join(scratch, "say.jsonl");
writeFileSync(sayLog, "");
const sayJs = path.join(scratch, "say.mjs");
writeFileSync(sayJs, `import { appendFileSync, writeFileSync } from 'node:fs';
import { existsSync } from 'node:fs';
const a = process.argv.slice(2); const out = a[a.indexOf('-o') + 1];
appendFileSync(${JSON.stringify(sayLog)}, JSON.stringify(a) + '\\n');
if (existsSync(${JSON.stringify(path.join(scratch, "say-fails"))})) { console.error('say: no voice'); process.exit(1); }
writeFileSync(out, Buffer.from(${JSON.stringify(wav.toString("base64"))}, 'base64'));
`);
const say = path.join(scratch, "say");
writeFileSync(say, `#!/bin/sh\nexec ${JSON.stringify(process.execPath)} ${JSON.stringify(sayJs)} "$@"\n`);
chmodSync(say, 0o755);

// Agent Zero (a Claude agent with a session file) behind a herdr that only records.
const trace = path.join(scratch, "sends.jsonl");
writeFileSync(trace, "");
const claudeDir = path.join(scratch, "claude");
const project = path.join(claudeDir, "projects", "/tmp".replace(/[^A-Za-z0-9]/g, "-"));
mkdirSync(project, { recursive: true });
const line = (type, text, i) => JSON.stringify(type === "user" ? { type, uuid: `u${i}`, timestamp: new Date(Date.now() - 60000 + i * 1000).toISOString(), message: { role: "user", content: text } } : { type, uuid: `a${i}`, timestamp: new Date(Date.now() - 60000 + i * 1000).toISOString(), message: { role: "assistant", id: `m${i}`, content: [{ type: "text", text }] } });
const session = path.join(project, "a0-orb.jsonl");
writeFileSync(session, [line("user", "Morning. What needs me?", 0), line("assistant", "Two things need you: the model sign-in and the HALO stream check.", 1)].join("\n") + "\n");
const AGENTS = [{ agent: "claude", agent_status: "idle", cwd: "/tmp", pane_id: "w1:p1", terminal_id: "term_a0orb", terminal_title_stripped: "A0", agent_session: { value: "a0-orb" } }];
const herdr = path.join(scratch, "herdr.mjs");
writeFileSync(herdr, `import { appendFileSync } from 'node:fs';
const args = process.argv.slice(2);
if (args[0] === 'agent' && args[1] === 'list') console.log(JSON.stringify({ result: { agents: ${JSON.stringify(AGENTS)} } }));
else { if (args[0] === 'pane' && ['send-text', 'send-keys'].includes(args[1])) appendFileSync(${JSON.stringify(trace)}, JSON.stringify(args) + '\\n'); console.log('{}'); }
`);
const settings = path.join(scratch, "SISO Voice", ".settings");
mkdirSync(path.dirname(settings), { recursive: true });
writeFileSync(settings, JSON.stringify({ groq_api_key: LAB_KEY }), { mode: 0o600 });

const PORT = await freePort();
const ORIGIN = `http://127.0.0.1:${PORT}`;
const env = { ...process.env, AB_PORT: String(PORT), AB_HERDR: `${process.execPath} ${herdr}`, AB_CLAUDE_DIRS: claudeDir, AB_VOICE_SETTINGS: settings, AB_GROQ_URL: `${G}/transcriptions`, AB_GROQ_TTS_URL: `${G}/speech`, AB_SAY: say, AB_UPLOADS: path.join(scratch, "uploads"), AB_HOSTS_DIR: path.join(scratch, "hosts"), AB_STATE: path.join(scratch, "rows.json"), AB_REGISTRY: path.join(scratch, "registry.json"), AB_CTX_DIR: path.join(scratch, "ctx"), AB_CONSOLE_EVENTS: path.join(scratch, "none.jsonl"), AB_RESURRECT_DIR: path.join(scratch, "none"), AB_HUB_HOME: scratch, AB_VOICE_WATCH: "0" };
delete env.GROQ_API_KEY;
const node = spawn(process.execPath, ["--experimental-strip-types", "--no-warnings", "src/server.ts"], { cwd: path.join(REPO, "services/node"), env, stdio: ["ignore", "ignore", "pipe"] });
let nodeErr = "";
node.stderr.on("data", (d) => (nodeErr += d));

// The page's stand-ins (headless WebKit has no microphone): a mic that takes 300 ms to open and counts its opens, a
// moving level, a recorder that hands over the fixture, microphone permission "granted", and Audio that "plays".
const stub = ({ b64 }) => {
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  window.__gum = 0;
  const open = async () => {
    window.__gum += 1;
    await new Promise((r) => setTimeout(r, 300));
    const ac = new AudioContext();
    const osc = ac.createOscillator();
    const dest = ac.createMediaStreamDestination();
    osc.connect(dest);
    osc.start();
    (window.__streams ??= []).push(dest.stream);
    return dest.stream;
  };
  if (!navigator.mediaDevices) Object.defineProperty(navigator, "mediaDevices", { value: {}, configurable: true });
  try { Object.defineProperty(Object.getPrototypeOf(navigator.mediaDevices), "getUserMedia", { value: open, configurable: true, writable: true }); } catch {}
  Object.defineProperty(navigator.mediaDevices, "getUserMedia", { value: open, configurable: true, writable: true });
  Object.defineProperty(navigator, "permissions", { value: { query: async () => ({ state: "granted" }) }, configurable: true });
  const real = AudioContext.prototype.createMediaStreamSource;
  AudioContext.prototype.createMediaStreamSource = function (s) { try { return real.call(this, s); } catch { return this.createOscillator(); } };
  let t = 0;
  AnalyserNode.prototype.getByteTimeDomainData = function (buf) {
    t += 1;
    const amp = 40 + 30 * Math.sin(t / 7);
    for (let i = 0; i < buf.length; i++) buf[i] = 128 + amp * Math.sin(i / 3);
  };
  window.MediaRecorder = class {
    static isTypeSupported(x) { return x === "audio/mp4"; }
    constructor(stream, o) { window.__recs = (window.__recs ?? 0) + 1; this.stream = stream; this.mimeType = o?.mimeType ?? "audio/mp4"; this.state = "inactive"; }
    start() { this.state = "recording"; }
    stop() { this.state = "inactive"; setTimeout(() => { this.ondataavailable?.({ data: new Blob([bytes], { type: "audio/mp4" }) }); this.onstop?.(); }, 20); }
  };
  // WebKit's rule, played out: an element may play sound only once it has played inside a click or a key (per element,
  // for good). A sentence "plays" for 1.5 s, then ends, unless its src was changed or taken away first.
  window.__played = [];
  window.__refused = 0;
  HTMLMediaElement.prototype.play = function () {
    if (!this.__allowed) {
      if (!navigator.userActivation?.isActive) return (window.__refused += 1), Promise.reject(new DOMException("play() needs a gesture", "NotAllowedError"));
      this.__allowed = true;
    }
    const src = this.src;
    window.__played.push(src);
    setTimeout(() => this.getAttribute("src") && this.src === src && this.onended?.(), 1500);
    return Promise.resolve();
  };
  // From press to listening, measured in the page: the press is the pointerdown's time, listening the orb's attribute.
  window.__lat = [];
  addEventListener("pointerdown", (e) => { if (e.target.closest?.("[data-testid=mic]")) window.__down = performance.now(); }, true);
  new MutationObserver((ms) => {
    for (const m of ms) if (m.target.dataset?.phase === "listening" && m.oldValue !== "listening" && window.__down) window.__lat.push(performance.now() - window.__down), (window.__down = 0);
  }).observe(document, { subtree: true, attributes: true, attributeFilter: ["data-phase"], attributeOldValue: true });
};

let browser = null;
try {
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch(`${ORIGIN}/api/health`)).ok) break; } catch {}
    await sleep(200);
  }

  // 1. The node speaks: Groq first, say when Groq fails or there is no key.
  const speak = (text, headers = { "content-type": "application/json" }) => fetch(`${ORIGIN}/api/voice/speak`, { method: "POST", headers, body: JSON.stringify({ text }) });
  let r = await speak("The orb is in.");
  let body = Buffer.from(await r.arrayBuffer());
  check("one sentence comes back as a WAV in Groq's voice", r.status === 200 && r.headers.get("content-type") === "audio/wav" && r.headers.get("x-voice-provider") === "groq" && body.equals(wav), { status: r.status, provider: r.headers.get("x-voice-provider") });
  const g = tts.at(-1);
  check("Groq got Orpheus, a voice, WAV, the words and the lab key", g?.auth && g.model === "canopylabs/orpheus-v1-english" && !!g.voice && g.response_format === "wav" && g.input === "The orb is in.", { model: g?.model, voice: g?.voice, format: g?.response_format });
  ttsMode = "500";
  r = await speak("Groq is down.");
  check("Groq down: macOS say speaks it instead", r.status === 200 && r.headers.get("x-voice-provider") === "say" && /Groq said 500/.test(r.headers.get("x-voice-fallback") ?? "") && readFileSync(sayLog, "utf8").includes("Groq is down."), { provider: r.headers.get("x-voice-provider"), why: r.headers.get("x-voice-fallback") });
  ttsMode = "ok";
  renameSync(settings, `${settings}.away`);
  const before = tts.length;
  r = await speak("No key.");
  renameSync(`${settings}.away`, settings);
  check("no key: say, and Groq is not called", r.status === 200 && r.headers.get("x-voice-provider") === "say" && tts.length === before, { provider: r.headers.get("x-voice-provider") });
  const long = await speak("x".repeat(401));
  const empty = await speak("   ");
  const notJson = await fetch(`${ORIGIN}/api/voice/speak`, { method: "POST", headers: { "content-type": "text/plain" }, body: "hi" });
  check("over 400 characters, empty or not JSON is refused", long.status === 400 && empty.status === 400 && notJson.status === 400, { long: long.status, empty: empty.status, notJson: notJson.status });

  // 2. The app at 1440: A0's chat, the orb and the speaker toggle beside it.
  browser = await launchBrowser();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.addInitScript(stub, { b64: FIXTURE.toString("base64") });
  await page.goto(`${ORIGIN}/`);
  await page.locator('[data-testid=rail-row][aria-label^="Agent Zero"]').first().click();
  const view = page.locator("[data-testid=chat-view]:visible");
  await view.locator(".siso-chat__turn").first().waitFor({ timeout: 20000 });
  await page.waitForFunction(() => [...document.querySelectorAll("textarea[aria-label=Message]")].some((t) => t.offsetParent && !/Connecting/.test(t.placeholder)), null, { timeout: 15000 });
  const orb = view.locator(".siso-chat__inputrow [data-testid=mic]");
  const toggle = view.locator(".siso-chat__inputrow [data-testid=speak]");
  const beside = await orb.evaluate((el) => !!el.closest(".siso-mic").nextElementSibling?.querySelector("[data-testid=speak]"));
  check("the chat has the orb with the speaker toggle right beside it", (await orb.count()) === 1 && (await toggle.count()) === 1 && beside, { beside });
  check("the orb is a violet sphere", await orb.locator(".siso-orb__ball").evaluate((el) => /radial-gradient/.test(getComputedStyle(el).backgroundImage)));
  await view.locator(".siso-rim").screenshot({ path: path.join(SHOTS, "voice-orb-1-idle.png") });

  // Hovering warms the mic (permission already granted), so even the first press is fast.
  await orb.hover();
  await page.waitForFunction(() => window.__gum === 1, null, { timeout: 3000 }).catch(() => {});
  await page.waitForTimeout(400);
  writeFileSync(trace, "");
  const takes = [];
  for (let i = 0; i < 3; i++) {
    await orb.click();
    await view.locator(".siso-mic[data-phase=listening]").waitFor({ timeout: 5000 });
    await page.waitForTimeout(i === 0 ? 1200 : 300);
    if (i === 0) {
      const lv = await view.locator(".siso-mic").first().evaluate((el) => ({ lvl: Number(el.style.getPropertyValue("--lvl")), ball: getComputedStyle(el.querySelector(".siso-orb__ball")).transform, bars: el.querySelectorAll(".siso-orb__eq i").length, pill: el.querySelector("[data-testid=mic-status]")?.innerText }));
      takes.push(lv);
      check("listening: the orb swells with his level and shows a live equaliser", lv.lvl > 0 && lv.ball !== "none" && lv.bars === 4 && /Listening 0:0\d/.test(lv.pill ?? ""), lv);
      await view.locator(".siso-rim").screenshot({ path: path.join(SHOTS, "voice-orb-2-listening.png") });
    }
    await orb.click();
    await view.locator(".siso-mic[data-phase=idle]").waitFor({ timeout: 8000 });
  }
  const lat = await page.evaluate(() => window.__lat);
  const gum = await page.evaluate(() => window.__gum);
  check("the mic opens once (on hover) and stays warm: one getUserMedia for three takes", gum === 1, { getUserMedia: gum });
  check("press to listening under 100 ms, every take (mic takes 300 ms to open)", lat.length === 3 && lat.every((ms) => ms < 100), { ms: lat.map((x) => Math.round(x)) });
  for (let i = 0; i < 40 && sends().filter((s) => s[1] === "send-keys").length < 3; i++) await sleep(150);
  check("each take's words reach A0's pane", sends().filter((s) => s[1] === "send-text" && s[3] === SAID).length === 3, { sent: sends().length });

  // Agent Zero's face listens while his mic records (⌘⇧Space), then goes back.
  const faceState = () => page.locator("[data-testid=zero-face] [data-state]").first().getAttribute("data-state");
  const restState = await faceState();
  await page.keyboard.press("Meta+Shift+Space");
  await page.locator(".siso-zero-mic .siso-mic[data-phase=listening]").waitFor({ timeout: 5000 });
  await page.waitForTimeout(700);
  const listenState = await faceState();
  const faceLvl = await page.locator("[data-testid=zero-face] [data-state]").first().evaluate((el) => Number(el.style.getPropertyValue("--lvl")));
  await page.screenshot({ path: path.join(SHOTS, "voice-orb-3-face.png"), clip: { x: 1440 - 340, y: 900 - 220, width: 340, height: 220 } });
  check("the face listens while his mic records, its mouth on his level", listenState === "listening" && faceLvl > 0, { rest: restState, listening: listenState, lvl: faceLvl });
  await page.keyboard.press("Meta+Shift+Space");
  await page.locator(".siso-zero-mic [data-testid=mic-status]").filter({ hasText: "Sent to Agent Zero" }).waitFor({ timeout: 10000 });
  await page.waitForTimeout(400);
  check("then it goes back to his state", (await faceState()) === restState, { now: await faceState() });

  // 3. The speaker toggle: on, a new reply is read aloud sentence by sentence; the mic stops it.
  await toggle.click();
  check("the toggle turns on (and says so)", (await toggle.getAttribute("aria-pressed")) === "true");
  const before2 = tts.length;
  const playedBefore = await page.evaluate(() => window.__played.length);
  await page.waitForTimeout(600);
  check("turning it on does not read the reply already on screen", tts.length === before2, { asked: tts.length - before2 });
  // Let the click's permission to play run out (WebKit ~1 s, Chromium ~5 s), as it has by the time a real reply ends.
  await page.waitForTimeout(5500);
  appendFileSync(session, [line("user", "Status?", 50), line("assistant", "The orb is live. The speaker reads this aloud, one sentence at a time. Done.", 51)].join("\n") + "\n");
  for (let i = 0; i < 40 && tts.length - before2 < 1; i++) await sleep(200);
  await page.waitForFunction(() => document.querySelector("[data-testid=speak][data-speaking=true]"), null, { timeout: 8000 }).catch(() => {});
  await view.locator(".siso-rim").screenshot({ path: path.join(SHOTS, "voice-orb-4-speaking.png") });
  const asked = tts.slice(before2).map((t) => t.input);
  check("the new reply goes to Groq as sentences of 200 characters or fewer and plays", asked.length >= 1 && asked.join(" ").startsWith("The orb is live.") && asked.every((s) => s.length <= 200) && (await page.evaluate(() => window.__played.length)) > playedBefore, { asked });
  const refused = await page.evaluate(() => window.__refused);
  check("it plays although the reply finished long after any click (the toggle's click unlocked the one player)", refused === 0, { refused });
  const wasSpeaking = await toggle.getAttribute("data-speaking");
  await orb.click();
  await page.waitForTimeout(300);
  check("pressing the orb stops the voice at once", wasSpeaking === "true" && (await toggle.getAttribute("data-speaking")) === "false", { wasSpeaking });
  await orb.click();
  await view.locator(".siso-mic[data-phase=idle]").waitFor({ timeout: 8000 });
  // Esc while it reads: the voice stops, and the Esc does not reach the chat (no Escape typed into the pane).
  appendFileSync(session, [line("user", "And?", 52), line("assistant", "Esc stops this one. It should never reach the pane.", 53)].join("\n") + "\n");
  await page.waitForFunction(() => document.querySelector("[data-testid=chat-view]:not([hidden]) [data-testid=speak][data-speaking=true]"), null, { timeout: 8000 }).catch(() => {});
  const speakingBeforeEsc = await toggle.getAttribute("data-speaking");
  writeFileSync(trace, "");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(400);
  check("Esc stops the voice, and the Esc is not sent to the agent", speakingBeforeEsc === "true" && (await toggle.getAttribute("data-speaking")) === "false" && !sends().some((x) => x.includes("Escape")), { speakingBeforeEsc, sent: sends() });
  // Neither Groq nor say can speak: a pill says so in plain words (never a silent nothing).
  ttsMode = "500";
  writeFileSync(path.join(scratch, "say-fails"), "");
  appendFileSync(session, [line("user", "Again?", 54), line("assistant", "This one cannot be spoken at all.", 55)].join("\n") + "\n");
  const speakPill = view.locator("[data-testid=speak-status]");
  await speakPill.waitFor({ timeout: 10000 }).catch(() => {});
  const speakErr = (await speakPill.count()) ? await speakPill.innerText() : "";
  await view.locator(".siso-rim").screenshot({ path: path.join(SHOTS, "voice-orb-6-speak-error.png") });
  check("a reply that cannot be spoken says why, in words", /Not read aloud: Could not speak it/.test(speakErr) && (await toggle.getAttribute("data-error")) === "true", { pill: speakErr });
  ttsMode = "ok";
  rmSync(path.join(scratch, "say-fails"));
  await toggle.click();
  check("the toggle turns off", (await toggle.getAttribute("aria-pressed")) === "false" && (await speakPill.count()) === 0);
  check("no page errors", errors.length === 0, { errors });
  await page.close();

  // 3b. The app opening with the speaker already on: the chat's history arriving is not read out as a new reply.
  const reopen = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await reopen.addInitScript(() => localStorage.setItem("ab:voice-speak", "1"));
  await reopen.addInitScript(stub, { b64: FIXTURE.toString("base64") });
  const ttsBefore = tts.length;
  await reopen.goto(`${ORIGIN}/`);
  await reopen.locator('[data-testid=rail-row][aria-label^="Agent Zero"]').first().click();
  await reopen.locator("[data-testid=chat-view]:visible .siso-chat__turn").first().waitFor({ timeout: 20000 });
  await reopen.waitForTimeout(1500);
  check("opening a chat with the speaker on reads nothing old", tts.length === ttsBefore && (await reopen.locator("[data-testid=chat-view]:visible [data-testid=speak]").getAttribute("aria-pressed")) === "true", { asked: tts.slice(ttsBefore).map((t) => t.input) });
  await reopen.close();

  // 4. Reduced motion: while listening nothing turns or swells.
  const rm = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" });
  await rm.addInitScript(stub, { b64: FIXTURE.toString("base64") });
  await rm.goto(`${ORIGIN}/`);
  await rm.locator('[data-testid=rail-row][aria-label^="Agent Zero"]').first().click();
  const rorb = rm.locator("[data-testid=chat-view]:visible .siso-chat__inputrow [data-testid=mic]");
  await rorb.waitFor({ timeout: 15000 });
  // Esc while the mic is still opening (cold, 300 ms): it never starts recording, nothing is sent.
  writeFileSync(trace, "");
  await rorb.click();
  const opening = await rm.locator(".siso-mic[data-phase=starting]").count();
  await rm.keyboard.press("Escape");
  await rm.waitForTimeout(700);
  const afterEsc = { recs: await rm.evaluate(() => window.__recs ?? 0), phase: await rm.locator("[data-testid=chat-view]:visible .siso-chat__inputrow .siso-mic").getAttribute("data-phase") };
  check("Esc while the mic is opening: it never starts, nothing is sent", opening === 1 && afterEsc.recs === 0 && afterEsc.phase === "idle" && sends().length === 0, { opening, ...afterEsc });
  await rm.evaluate(() => (window.__lat = []));
  // the mic is warm now (it opened, then rested): close it so the next press is cold again, as the measure needs
  await rm.evaluate(() => window.__streams.forEach((st) => st.getTracks().forEach((t) => t.stop())));
  await rorb.click(); // a cold page: this press opens the mic (300 ms), so the measure must see it
  await rm.locator(".siso-mic[data-phase=listening]").first().waitFor({ timeout: 5000 });
  const cold = await rm.evaluate(() => window.__lat[0]);
  check("the measure is real: a cold first press (no warm mic) takes the mic's 300 ms", cold >= 250, { ms: Math.round(cold) });
  await rm.waitForTimeout(600);
  const still = await rorb.evaluate((el) => {
    const ball = el.querySelector(".siso-orb__ball");
    return { transform: getComputedStyle(ball).transform, sheen: getComputedStyle(ball, "::after").animationName, aura: getComputedStyle(el.querySelector(".siso-orb__aura")).opacity };
  });
  check("reduced motion: no swelling, no turning; the level still shows as light", still.transform === "none" && (still.sheen === "none" || still.sheen === "") && Number(still.aura) > 0, still);
  await rorb.click();
  await rm.close();

  // 4b. The warm mic lets go after its idle window (2 min in the app, so macOS's orange dot doesn't sit there all
  // day; 1.5 s here) and the next press opens it again.
  const idle = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await idle.addInitScript(() => (window.__abMicWarmMs = 1500));
  await idle.addInitScript(stub, { b64: FIXTURE.toString("base64") });
  await idle.goto(`${ORIGIN}/`);
  await idle.locator('[data-testid=rail-row][aria-label^="Agent Zero"]').first().click();
  const iorb = idle.locator("[data-testid=chat-view]:visible .siso-chat__inputrow [data-testid=mic]");
  await iorb.waitFor({ timeout: 15000 });
  await iorb.click();
  await idle.locator(".siso-mic[data-phase=listening]").first().waitFor({ timeout: 5000 });
  await iorb.click();
  await idle.locator(".siso-mic[data-phase=idle]").first().waitFor({ timeout: 8000 });
  const tracks = () => idle.evaluate(() => window.__streams.map((st) => st.getAudioTracks().map((t) => t.readyState).join(",")));
  await idle.waitForTimeout(500);
  const warmNow = await tracks();
  await idle.waitForTimeout(1800);
  const after = await tracks();
  check("the mic stays open between presses, then lets go after its idle window (the orange dot goes)", warmNow[0] === "live" && after.every((t) => !t.includes("live")), { warm: warmNow, after });
  await iorb.click();
  await idle.locator(".siso-mic[data-phase=listening]").first().waitFor({ timeout: 5000 });
  const re = await idle.evaluate(() => ({ gum: window.__gum, ms: window.__lat.at(-1) }));
  check("the next press opens it again, paying the cold open once", re.gum === 2 && re.ms >= 200, { getUserMedia: re.gum, ms: Math.round(re.ms) });
  await iorb.click();
  await idle.close();

  // 5. Phone: the orb and the toggle fit.
  const phone = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await phone.addInitScript(stub, { b64: FIXTURE.toString("base64") });
  await phone.goto(`${ORIGIN}/`);
  await phone.locator('[data-testid=rail-row][aria-label^="Agent Zero"]').first().click().catch(() => {});
  const porb = phone.locator("[data-testid=chat-view]:visible .siso-chat__inputrow [data-testid=mic]");
  const seen = await porb.waitFor({ timeout: 15000 }).then(() => true, () => false);
  const fit = seen && (await phone.evaluate(() => {
    const row = document.querySelector("[data-testid=chat-view] .siso-chat__inputrow");
    const r = row.getBoundingClientRect();
    const els = [...row.querySelectorAll("[data-testid=mic],[data-testid=speak],.siso-chat__send")];
    const kids = els.map((e) => e.getBoundingClientRect());
    // and nothing covers them (Agent Zero's face orb used to sit on the send button)
    const clear = els.every((e, i) => e.contains(document.elementFromPoint(kids[i].left + kids[i].width / 2, kids[i].top + kids[i].height / 2)));
    return els.length === 3 && clear && kids.every((k) => k.right <= r.right + 1 && k.left >= r.left - 1) && document.documentElement.scrollWidth <= innerWidth + 1;
  }));
  await phone.screenshot({ path: path.join(SHOTS, "voice-orb-5-phone.png") });
  check("390: the orb, the toggle and send fit in the row, no sideways scroll", seen && fit, { seen, fit });
  await phone.close();
} catch (e) {
  check("ran to the end", false, { error: String(e?.stack ?? e).slice(0, 600), node: nodeErr.slice(-400) });
} finally {
  await browser?.close();
  node.kill();
  groq.close();
  rmSync(scratch, { recursive: true, force: true });
}
function sends() {
  return readFileSync(trace, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
}
const failed = results.filter((r) => !r).length;
console.log(JSON.stringify({ "voice-orb": failed ? "FAIL" : "PASS", passed: results.length - failed, failed }));
process.exit(failed ? 1 : 0);
