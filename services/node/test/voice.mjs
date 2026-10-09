// Check (t-0100): talk to Agent Zero by voice. A recorded fixture (say -o, m4a) goes through the node's
// /api/voice/transcribe to a fake Groq and back as text, lands in A0's composer and is typed into his pane; the same
// mic is in every chat and beside his face. Malformed audio, a missing key and a refused key give clear errors, and no
// reply ever carries the key. A fake herdr, a lab .settings with a fake key, headless WebKit; never a live agent.
//   pnpm --filter @agent-base/web build && node services/node/test/voice.mjs
// Shots: .shots/voice-{1-idle,2-listening,3-sent,4-nokey,5-face}.png (AB_SHOTS=1: apps/web/preview/)
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync, existsSync } from "node:fs";
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
const scratch = mkdtempSync(path.join(process.env.TMPDIR ?? tmpdir(), ".siso-ephemeral-voice."));
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

// The fake Groq: records what arrived (never prints the key), answers like Groq's transcription endpoint.
let groqMode = "ok";
const seen = [];
const groq = createServer((req, res) => {
  const chunks = [];
  req.on("data", (c) => chunks.push(c));
  req.on("end", () => {
    const body = Buffer.concat(chunks);
    seen.push({ path: req.url, auth: req.headers.authorization === `Bearer ${LAB_KEY}`, type: String(req.headers["content-type"]), hasFixture: body.includes(FIXTURE), model: /name="model"\r\n\r\n([^\r]+)/.exec(body.toString("latin1"))?.[1], file: /filename="([^"]+)"/.exec(body.toString("latin1"))?.[1] });
    if (groqMode === "drop") return req.socket.destroy(); // Groq unreachable: the connection just dies
    if (groqMode === "401") return res.writeHead(401, { "content-type": "application/json" }).end(JSON.stringify({ error: { message: "Invalid API Key", type: "invalid_request_error" } }));
    res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ text: ` ${SAID} `, x_groq: { id: "req_fake" } }));
  });
});
await new Promise((r) => groq.listen(0, "127.0.0.1", r));
const GROQ_PORT = groq.address().port;

// Agent Zero (a Claude agent in the terminal with a session file) and another chat, behind a herdr that only records.
const trace = path.join(scratch, "sends.jsonl");
writeFileSync(trace, "");
const claudeDir = path.join(scratch, "claude");
const project = path.join(claudeDir, "projects", "/tmp".replace(/[^A-Za-z0-9]/g, "-"));
mkdirSync(project, { recursive: true });
const line = (type, text, i) => JSON.stringify(type === "user" ? { type, uuid: `u${i}`, timestamp: new Date(Date.now() - 60000 + i * 1000).toISOString(), message: { role: "user", content: text } } : { type, uuid: `a${i}`, timestamp: new Date(Date.now() - 60000 + i * 1000).toISOString(), message: { role: "assistant", id: `m${i}`, content: [{ type: "text", text }] } });
writeFileSync(path.join(project, "a0-voice.jsonl"), [line("user", "Morning. What needs me?", 0), line("assistant", "Two things need you: the model sign-in and the HALO stream check. Everything else is moving.", 1)].join("\n") + "\n");
writeFileSync(path.join(project, "ab-voice.jsonl"), [line("user", "Ship the mic.", 0), line("assistant", "On it.", 1)].join("\n") + "\n");
const AGENTS = [
  { agent: "claude", agent_status: "idle", cwd: "/tmp", pane_id: "w1:p1", terminal_id: "term_a0voice", terminal_title_stripped: "A0", agent_session: { value: "a0-voice" } },
  { agent: "claude", agent_status: "idle", cwd: "/tmp", pane_id: "w1:p2", terminal_id: "term_abvoice", terminal_title_stripped: "AGENT-BASE", agent_session: { value: "ab-voice" } },
];
const wrapper = path.join(scratch, "herdr.mjs");
writeFileSync(wrapper, `import { appendFileSync } from 'node:fs';
const args = process.argv.slice(2);
if (args[0] === 'agent' && args[1] === 'list') console.log(JSON.stringify({ result: { agents: ${JSON.stringify(AGENTS)} } }));
else { if (args[0] === 'pane' && ['send-text', 'send-keys'].includes(args[1])) appendFileSync(${JSON.stringify(trace)}, JSON.stringify(args) + '\\n'); console.log('{}'); }
`);
const sends = () => readFileSync(trace, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
const settings = path.join(scratch, "SISO Voice", ".settings");
mkdirSync(path.dirname(settings), { recursive: true });
writeFileSync(settings, JSON.stringify({ groq_api_key: LAB_KEY, other_setting: "x" }), { mode: 0o600 });
const hideKey = () => renameSync(settings, `${settings}.away`);
const showKey = () => renameSync(`${settings}.away`, settings);

const PORT = await freePort();
const ORIGIN = `http://127.0.0.1:${PORT}`;
const env = { ...process.env, AB_PORT: String(PORT), AB_HERDR: `${process.execPath} ${wrapper}`, AB_CLAUDE_DIRS: claudeDir, AB_VOICE_SETTINGS: settings, AB_GROQ_URL: `http://127.0.0.1:${GROQ_PORT}/openai/v1/audio/transcriptions`, AB_UPLOADS: path.join(scratch, "uploads"), AB_HOSTS_DIR: path.join(scratch, "hosts"), AB_STATE: path.join(scratch, "rows.json"), AB_REGISTRY: path.join(scratch, "registry.json"), AB_CTX_DIR: path.join(scratch, "ctx"), AB_CONSOLE_EVENTS: path.join(scratch, "none.jsonl"), AB_RESURRECT_DIR: path.join(scratch, "none"), AB_HUB_HOME: scratch };
delete env.GROQ_API_KEY; // the lab .settings is the only key this node may see
const node = spawn(process.execPath, ["--experimental-strip-types", "--no-warnings", "src/server.ts"], { cwd: path.join(REPO, "services/node"), env, stdio: ["ignore", "ignore", "pipe"] });
let nodeErr = "";
node.stderr.on("data", (d) => (nodeErr += d));
const replies = [];
const post = async (body, headers = {}) => {
  const r = await fetch(`${ORIGIN}/api/voice/transcribe`, { method: "POST", headers: { "content-type": "audio/mp4", ...headers }, body });
  const text = await r.text();
  replies.push(text);
  return { status: r.status, body: JSON.parse(text) };
};
let browser = null;
try {
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(`${ORIGIN}/api/health`)).ok) break;
    } catch {}
    await sleep(200);
  }

  // 1. The node: fixture in, fake Groq, text out; the key goes to Groq and nowhere else.
  const ready = await (await fetch(`${ORIGIN}/api/voice/transcribe`)).json();
  replies.push(JSON.stringify(ready));
  check("GET says the key is there, without the key", ready.ready === true && ready.provider === "groq", { ready });
  const ok = await post(FIXTURE);
  const g = seen.at(-1);
  check("the fixture recording comes back as its words", ok.status === 200 && ok.body.text === SAID && ok.body.provider === "groq", { status: ok.status, text: ok.body.text, ms: ok.body.ms });
  check("Groq got the recording byte for byte, the model, and the key from SISO Voice's .settings", !!g && g.auth && g.hasFixture && g.model === "whisper-large-v3-turbo" && g.file === "voice.m4a" && g.type.startsWith("multipart/form-data"), { path: g?.path, auth: g?.auth, hasFixture: g?.hasFixture, model: g?.model, file: g?.file });

  const before = seen.length;
  const junk = await post(readFileSync(path.join(import.meta.dirname, "fixtures/voice/not-audio.txt")));
  check("malformed audio is refused with a clear error, and Groq is not called", junk.status === 400 && junk.body.code === "not-audio" && /not audio/.test(junk.body.error) && seen.length === before, junk.body);
  const empty = await post(Buffer.alloc(0));
  check("an empty recording is refused", empty.status === 400 && /No audio/.test(empty.body.error), empty.body);
  const truncated = await post(FIXTURE.subarray(0, 3));
  check("three stray bytes are not audio", truncated.status === 400 && truncated.body.code === "not-audio", truncated.body);

  groqMode = "401";
  const refused = await post(FIXTURE);
  groqMode = "ok";
  check("a key Groq refuses says so", refused.status === 502 && /401/.test(refused.body.error) && /refused/.test(refused.body.error), refused.body);

  hideKey();
  const noKeyGet = await (await fetch(`${ORIGIN}/api/voice/transcribe`)).json();
  replies.push(JSON.stringify(noKeyGet));
  const noKey = await post(FIXTURE);
  showKey();
  check("no key on the machine gives a clear error that says where the key lives", noKeyGet.ready === false && noKey.status === 503 && noKey.body.code === "no-key" && /SISO Voice/.test(noKey.body.error), { get: noKeyGet.code, status: noKey.status, error: noKey.body.error });

  const foreign = await fetch(`${ORIGIN}/api/voice/transcribe`, { method: "POST", headers: { origin: "https://evil.example", "content-type": "audio/mp4" }, body: FIXTURE });
  check("a page from another origin is refused", foreign.status === 403, { status: foreign.status });
  check("no reply ever carries the key", replies.every((r) => !r.includes(LAB_KEY)), { replies: replies.length });

  // 2. The app: A0's chat has the mic; press, (fixture) speech, press: his words reach A0's pane.
  browser = await launchBrowser();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  // The mic and the recorder are stand-ins (headless WebKit has no microphone): a tone for the level, and a recorder
  // that hands over the fixture recording when stopped. Everything after that is the real app and the real node.
  await page.addInitScript(({ b64 }) => {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const fakeStream = async () => {
      try {
        const ac = new AudioContext();
        const osc = ac.createOscillator();
        const dest = ac.createMediaStreamDestination();
        osc.connect(dest);
        osc.start();
        return dest.stream;
      } catch (e) {
        window.__micStub = `tone failed: ${e?.name} ${e?.message}`;
        return new MediaStream();
      }
    };
    if (!navigator.mediaDevices) Object.defineProperty(navigator, "mediaDevices", { value: {}, configurable: true });
    try {
      Object.defineProperty(Object.getPrototypeOf(navigator.mediaDevices), "getUserMedia", { value: fakeStream, configurable: true, writable: true });
    } catch {}
    Object.defineProperty(navigator.mediaDevices, "getUserMedia", { value: fakeStream, configurable: true, writable: true });
    // Level: the analyser reads a moving wave, so the ring and the bars show a voice.
    if (typeof AudioContext !== "undefined") {
      const real = AudioContext.prototype.createMediaStreamSource;
      AudioContext.prototype.createMediaStreamSource = function (stream) {
        try {
          return real.call(this, stream);
        } catch {
          return this.createOscillator();
        }
      };
    }
    let t = 0;
    AnalyserNode.prototype.getByteTimeDomainData = function (buf) {
      t += 1;
      const amp = 40 + 30 * Math.sin(t / 7);
      for (let i = 0; i < buf.length; i++) buf[i] = 128 + amp * Math.sin(i / 3);
    };
    window.MediaRecorder = class {
      static isTypeSupported(t) {
        return t === "audio/mp4";
      }
      constructor(stream, o) {
        window.__recs = (window.__recs ?? 0) + 1;
        this.stream = stream;
        this.mimeType = o?.mimeType ?? "audio/mp4";
        this.state = "inactive";
      }
      start() {
        this.state = "recording";
      }
      stop() {
        this.state = "inactive";
        setTimeout(() => {
          if (!window.__emptyTake) this.ondataavailable?.({ data: new Blob([bytes], { type: "audio/mp4" }) });
          this.onstop?.();
        }, 20);
      }
    };
  }, { b64: FIXTURE.toString("base64") });
  await page.goto(`${ORIGIN}/`);
  await page.locator('[data-testid=rail-row][aria-label^="Agent Zero"]').first().click();
  const view = page.locator("[data-testid=chat-view]:visible");
  await view.locator(".siso-chat__turn").first().waitFor({ timeout: 20000 });
  await page.waitForFunction(() => [...document.querySelectorAll("textarea[aria-label=Message]")].some((t) => t.offsetParent && !/Connecting/.test(t.placeholder)), null, { timeout: 15000 });
  const mic = view.locator(".siso-chat__inputrow [data-testid=mic]");
  check("Agent Zero's chat has the mic in its input row", (await mic.count()) === 1, { label: await mic.getAttribute("aria-label") });
  await page.screenshot({ path: path.join(SHOTS, "voice-1-idle.png") });

  writeFileSync(trace, "");
  await mic.click();
  await view.locator("[data-testid=mic-status]").filter({ hasText: "Listening" }).waitFor({ timeout: 5000 }).catch(async (e) => {
    throw new Error(`no Listening pill; it says: ${await view.locator("[data-testid=mic-status]").innerText().catch(() => "(none)")} · stub: ${await page.evaluate(() => window.__micStub ?? "ok")} · page errors: ${errors.join(" | ")}`);
  });
  await page.waitForTimeout(1300);
  const lvl = await view.locator(".siso-mic").first().evaluate((el) => Number(getComputedStyle(el).getPropertyValue("--lvl")));
  check("pressing it listens: a live pill with the time and his level", (await mic.getAttribute("aria-pressed")) === "true" && lvl > 0, { level: lvl, pill: await view.locator("[data-testid=mic-status]").innerText() });
  await page.screenshot({ path: path.join(SHOTS, "voice-2-listening.png") });
  await mic.click();
  for (let i = 0; i < 40 && !sends().some((s) => s[1] === "send-keys"); i++) await sleep(150);
  const typed = sends();
  check("pressing again sends his words to A0's pane as his message (text, then Enter)", typed[0]?.[1] === "send-text" && typed[0]?.[2] === "w1:p1" && typed[0]?.[3] === SAID && typed[1]?.[1] === "send-keys" && typed[1]?.[3] === "Enter", { typed });
  const box = await view.locator("textarea[aria-label=Message]").inputValue();
  check("the composer is clear once it has gone", box === "", { box });
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(SHOTS, "voice-3-sent.png") });

  // Typed words stay in front of the spoken ones.
  writeFileSync(trace, "");
  await view.locator("textarea[aria-label=Message]").fill("Also,");
  await mic.click();
  await page.waitForTimeout(300);
  await mic.click();
  for (let i = 0; i < 40 && !sends().some((s) => s[1] === "send-keys"); i++) await sleep(150);
  check("words already typed go first, the spoken ones after", sends()[0]?.[3] === `Also, ${SAID}`, { sent: sends()[0]?.[3] });

  const box2 = view.locator("textarea[aria-label=Message]");
  const waitSent = async () => {
    for (let i = 0; i < 40 && !sends().some((s) => s[1] === "send-keys"); i++) await sleep(150);
    return sends().filter((s) => s[1] === "send-text").map((s) => s[3]);
  };
  const alertPill = view.locator(".siso-mic__pill[role=alert]");

  // A double press (two presses inside one frame) starts one recording, not two.
  writeFileSync(trace, "");
  await page.evaluate(() => (window.__recs = 0));
  await mic.evaluate((b) => {
    for (let i = 0; i < 2; i++) b.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0, pointerId: 1, isPrimary: true }));
  });
  await view.locator(".siso-mic[data-phase=listening]").waitFor({ timeout: 5000 });
  await page.waitForTimeout(300);
  const recs = await page.evaluate(() => window.__recs);
  await mic.click();
  let sent = await waitSent();
  check("a double press records once and sends once", recs === 1 && sent.length === 1 && sent[0] === SAID, { recorders: recs, sent });

  // Push-to-talk: hold the pointer, speak, let go: it sends.
  writeFileSync(trace, "");
  await mic.hover();
  await page.mouse.down();
  await view.locator(".siso-mic[data-phase=listening]").waitFor({ timeout: 5000 });
  await page.waitForTimeout(600);
  await page.mouse.up();
  sent = await waitSent();
  check("hold, speak, let go (pointer): his words go", sent.length === 1 && sent[0] === SAID, { sent });

  // The keyboard: Space held on the orb is push-to-talk; Space tapped twice is press-and-press again; Enter toggles.
  writeFileSync(trace, "");
  await mic.focus();
  await page.keyboard.down(" ");
  await view.locator(".siso-mic[data-phase=listening]").waitFor({ timeout: 5000 });
  await page.waitForTimeout(600);
  await page.keyboard.up(" ");
  sent = await waitSent();
  const heldOk = sent.length === 1 && sent[0] === SAID;
  await view.locator(".siso-mic[data-phase=idle]").waitFor({ timeout: 5000 });
  writeFileSync(trace, "");
  await mic.focus();
  await page.keyboard.press(" ");
  await page.waitForTimeout(400);
  const stillListening = await view.locator(".siso-chat__inputrow .siso-mic").getAttribute("data-phase");
  await page.keyboard.press(" ");
  sent = await waitSent();
  const tapOk = stillListening === "listening" && sent.length === 1;
  await view.locator(".siso-mic[data-phase=idle]").waitFor({ timeout: 5000 });
  writeFileSync(trace, "");
  await mic.focus();
  await page.keyboard.press("Enter");
  await view.locator(".siso-mic[data-phase=listening]").waitFor({ timeout: 5000 });
  await page.waitForTimeout(300);
  await page.keyboard.press("Enter");
  sent = await waitSent();
  check("keyboard: Space held is push-to-talk, Space tapped toggles, Enter toggles", heldOk && tapOk && sent.length === 1 && (await box2.inputValue()) === "", { heldOk, tapOk, stillListening, enter: sent.length });

  // Nothing recorded: says so, sends nothing.
  writeFileSync(trace, "");
  await page.evaluate(() => (window.__emptyTake = true));
  await mic.click();
  await page.waitForTimeout(300);
  await mic.click();
  await alertPill.waitFor({ timeout: 5000 });
  const emptyText = await alertPill.innerText();
  await page.evaluate(() => (window.__emptyTake = false));
  check("an empty take says nothing was recorded and sends nothing", /Nothing was recorded/.test(emptyText) && sends().length === 0, { alert: emptyText });
  await alertPill.locator("button[aria-label=Dismiss]").click();

  // Groq out of reach (this Mac offline): plain words, and Try again sends the same take once it is back.
  writeFileSync(trace, "");
  groqMode = "drop";
  await mic.click();
  await page.waitForTimeout(300);
  await mic.click();
  await alertPill.waitFor({ timeout: 8000 });
  const offline = await alertPill.innerText();
  await page.screenshot({ path: path.join(SHOTS, "voice-6-offline.png") });
  groqMode = "ok";
  const retry = view.locator("[data-testid=mic-retry]");
  const hadRetry = (await retry.count()) === 1;
  await retry.click().catch(() => {});
  sent = await waitSent();
  check("Groq unreachable: says the internet may be down, and Try again sends it", /Could not reach Groq.*internet/.test(offline) && hadRetry && sent.length === 1 && sent[0] === SAID, { alert: offline, hadRetry, sent });

  // The node not answering at all: says so; Try again once it is back.
  writeFileSync(trace, "");
  await page.route("**/api/voice/transcribe", (r) => r.abort());
  await mic.click();
  await page.waitForTimeout(300);
  await mic.click();
  await alertPill.waitFor({ timeout: 8000 });
  const nodeDown = await alertPill.innerText();
  await page.unroute("**/api/voice/transcribe");
  await view.locator("[data-testid=mic-retry]").click();
  sent = await waitSent();
  check("the node not answering: says so in words, Try again sends it", /node is not answering/.test(nodeDown) && sent.length === 1 && sent[0] === SAID, { alert: nodeDown, sent });

  // Another agent's tab opened mid-take: the take ends, nothing is sent, the words wait in A0's box, other mics work.
  writeFileSync(trace, "");
  await mic.click();
  await view.locator(".siso-mic[data-phase=listening]").waitFor({ timeout: 5000 });
  await page.waitForTimeout(400);
  await page.locator('[data-testid=rail-row][aria-label^="AGENT-BASE"]').first().click();
  await page.waitForTimeout(1200);
  const abMic = page.locator("[data-testid=chat-view]:visible .siso-chat__inputrow [data-testid=mic]");
  await abMic.click();
  const abListens = await page.locator("[data-testid=chat-view]:visible .siso-chat__inputrow .siso-mic[data-phase=listening]").waitFor({ timeout: 5000 }).then(() => true, () => false);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
  await page.locator('[data-testid=rail-row][aria-label^="Agent Zero"]').first().click();
  await page.waitForTimeout(600);
  const kept = await box2.inputValue();
  check("tab switch mid-take: nothing sent, the words wait in that chat's box, and the other chat's mic listens", sends().length === 0 && kept === SAID && abListens, { sent: sends(), kept, abListens });
  await box2.fill("");

  // No key: the pill says so; nothing is typed.
  hideKey();
  writeFileSync(trace, "");
  await mic.click();
  await page.waitForTimeout(300);
  await mic.click();
  const alert = view.locator(".siso-mic__pill[role=alert]");
  await alert.waitFor({ timeout: 5000 });
  const alertText = await alert.innerText();
  await page.screenshot({ path: path.join(SHOTS, "voice-4-nokey.png") });
  check("without a key the chat shows a clear error and types nothing", /No Groq key/.test(alertText) && sends().length === 0, { alert: alertText });
  showKey();
  await alert.locator("button[aria-label=Dismiss]").click();

  // Every chat (intent 1450): another agent's chat has the same mic.
  await page.locator('[data-testid=rail-row][aria-label^="AGENT-BASE"]').first().click();
  await page.waitForTimeout(800);
  const other = page.locator("[data-testid=chat-view]:visible .siso-chat__inputrow [data-testid=mic]");
  check("every chat has the mic (AGENT-BASE's too)", (await other.count()) === 1);

  // The face: from another agent's page, the mic beside A0's face (and ⌘⇧Space) sends to A0, and the page stays.
  writeFileSync(trace, "");
  const face = page.locator(".siso-zero-mic [data-testid=mic]");
  check("Agent Zero's face has a mic beside it", (await face.count()) === 1 && (await page.locator("[data-testid=zero-face]").count()) === 1);
  await page.keyboard.press("Meta+Shift+Space");
  await page.locator(".siso-zero-mic [data-testid=mic-status]").filter({ hasText: "Listening" }).waitFor({ timeout: 5000 });
  await page.waitForTimeout(600);
  await page.keyboard.press("Meta+Shift+Space");
  await page.locator(".siso-zero-mic [data-testid=mic-status]").filter({ hasText: "Sent to Agent Zero" }).waitFor({ timeout: 10000 });
  for (let i = 0; i < 40 && !sends().some((s) => s[1] === "send-keys"); i++) await sleep(150);
  const stayed = await page.locator("[data-testid=chat-view]:visible .siso-chat__turn").first().innerText();
  check("⌘⇧Space, speak, ⌘⇧Space from another chat: A0 gets it and the page stays", sends()[0]?.[2] === "w1:p1" && sends()[0]?.[3] === SAID && /Ship the mic/.test(stayed), { typed: sends(), page: stayed.slice(0, 40) });
  await page.screenshot({ path: path.join(SHOTS, "voice-5-face.png") });

  // Esc while listening throws it away and does not stop the agent.
  writeFileSync(trace, "");
  await face.click();
  await page.waitForTimeout(300);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(800);
  check("Esc throws the recording away: nothing typed, no Escape sent to a pane", sends().length === 0 && (await face.getAttribute("aria-pressed")) === "false", { typed: sends() });
  check("no page errors", errors.length === 0, { errors });
} catch (e) {
  check("ran to the end", false, { error: String(e?.stack ?? e).slice(0, 600), node: nodeErr.slice(-400) });
} finally {
  await browser?.close();
  node.kill();
  groq.close();
  rmSync(scratch, { recursive: true, force: true });
}
const failed = results.filter((r) => !r).length;
console.log(JSON.stringify({ voice: failed ? "FAIL" : "PASS", passed: results.length - failed, failed }));
process.exit(failed ? 1 : 0);
