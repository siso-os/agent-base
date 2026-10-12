// Check (t-0216, Shaan 21:5x: "where is my chat dock"): Agent Zero's face bottom-right docks his chat over the page
// he is on, in the halo rim; the page beside it keeps taking clicks; a message and a voice note from the dock reach his
// pane; Esc and the face close it. A fake herdr that only records, a fake Groq, the fixture recording; headless WebKit.
//   node services/node/test/dock-ui.mjs [shots-dir]
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import net from "node:net";
import path from "node:path";
import { webkit } from './suite-runtime.mjs';

const REPO = path.resolve(import.meta.dirname, "../../..");
const [shots = null] = process.argv.slice(2);
const FIXTURE = readFileSync(path.join(import.meta.dirname, "fixtures/voice/hello-a0.m4a"));
const SAID = "Agent Zero, what is on my list today?";
const LAB_KEY = "lab-fake-key-not-real";
const scratch = mkdtempSync(path.join(process.env.TMPDIR ?? tmpdir(), ".siso-ephemeral-dock-ui."));
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
const groq = createServer((req, res) => {
  req.resume();
  req.on("end", () => res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ text: ` ${SAID} ` })));
});
await new Promise((r) => groq.listen(0, "127.0.0.1", r));

const trace = path.join(scratch, "sends.jsonl");
writeFileSync(trace, "");
const claudeDir = path.join(scratch, "claude");
const project = path.join(claudeDir, "projects", "/tmp".replace(/[^A-Za-z0-9]/g, "-"));
mkdirSync(project, { recursive: true });
const line = (type, text, i) => JSON.stringify(type === "user" ? { type, uuid: `u${i}`, timestamp: new Date(Date.now() - 60000 + i * 1000).toISOString(), message: { role: "user", content: text } } : { type, uuid: `a${i}`, timestamp: new Date(Date.now() - 60000 + i * 1000).toISOString(), message: { role: "assistant", id: `m${i}`, content: [{ type: "text", text }] } });
writeFileSync(path.join(project, "a0-dock.jsonl"), [line("user", "Morning. What needs me?", 0), line("assistant", "DOCKFIX two things need you.", 1)].join("\n") + "\n");
writeFileSync(path.join(project, "ab-dock.jsonl"), [line("user", "Ship the dock.", 0), line("assistant", "DOCKFIX AB on it.", 1)].join("\n") + "\n");
const AGENTS = [
  { agent: "claude", agent_status: "idle", cwd: "/tmp", pane_id: "w1:p1", terminal_id: "term_a0dock", terminal_title_stripped: "A0", agent_session: { value: "a0-dock" } },
  { agent: "claude", agent_status: "idle", cwd: "/tmp", pane_id: "w1:p2", terminal_id: "term_abdock", terminal_title_stripped: "AGENT-BASE", agent_session: { value: "ab-dock" } },
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
writeFileSync(settings, JSON.stringify({ groq_api_key: LAB_KEY }), { mode: 0o600 });
const PORT = await freePort();
const ORIGIN = `http://127.0.0.1:${PORT}`;
const env = { ...process.env, AB_PORT: String(PORT), AB_HERDR: `${process.execPath} ${wrapper}`, AB_CLAUDE_DIRS: claudeDir, AB_VOICE_SETTINGS: settings, AB_GROQ_URL: `http://127.0.0.1:${groq.address().port}/openai/v1/audio/transcriptions`, AB_UPLOADS: path.join(scratch, "uploads"), AB_HOSTS_DIR: path.join(scratch, "hosts"), AB_STATE: path.join(scratch, "rows.json"), AB_REGISTRY: path.join(scratch, "registry.json"), AB_CTX_DIR: path.join(scratch, "ctx"), AB_CONSOLE_EVENTS: path.join(scratch, "none.jsonl"), AB_RESURRECT_DIR: path.join(scratch, "none"), AB_HUB_HOME: scratch, AB_A0_SEAT: path.join(scratch, "seat.json") };
delete env.GROQ_API_KEY;
const node = spawn(process.execPath, ["--experimental-strip-types", "--no-warnings", "src/server.ts"], { cwd: path.join(REPO, "services/node"), env, stdio: "ignore" });
const until = async (fn, ms = 8000) => {
  for (let t = 0; t < ms; t += 100) {
    if (await fn()) return true;
    await sleep(100);
  }
  return false;
};
let browser = null;
try {
  await until(async () => (await fetch(`${ORIGIN}/api/health`).catch(() => null))?.ok, 30000);
  browser = await webkit.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
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
          this.ondataavailable?.({ data: new Blob([bytes], { type: "audio/mp4" }) });
          this.onstop?.();
        }, 20);
      }
    };
  }, { b64: FIXTURE.toString("base64") });
  await page.goto(`${ORIGIN}/`);
  const face = page.locator("[data-testid=zero-face]");
  await face.waitFor({ timeout: 20000 });
  await face.click();
  const dock = page.locator("[data-testid=zero-dock]");
  const opened = await until(async () => (await dock.innerText().catch(() => "")).includes("DOCKFIX two things need you."), 10000);
  const parts = await dock.evaluate((el) => ({ rim: !!el.querySelector("[data-testid=halo-rim]"), hud: !!el.querySelector("[data-testid=hud]"), mic: !!el.querySelector("[data-testid=mic]"), w: Math.round(el.getBoundingClientRect().width), left: Math.round(el.getBoundingClientRect().left) }));
  check("the face opens Agent Zero in a phone-sized popup: his chat in the halo rim, HUD and mic", opened && parts.rim && parts.hud && parts.mic && parts.w >= 320 && parts.w <= 400, parts);
  check("the standalone voice orb is removed", (await page.locator(".siso-zero-mic").count()) === 0);
  const frame = await page.locator(".siso-app__frame").evaluate((el) => ({ right: el.getBoundingClientRect().right, margin: getComputedStyle(el).marginRight }));
  check("the desktop frame sits flush at the right edge", frame.right === 1440 && frame.margin === "0px", frame);

  // The page beside it keeps taking clicks: a side-nav row opens that chat underneath; the dock stays.
  const row = page.locator('[data-testid=rail-row][aria-label^="AGENT-BASE"], [data-testid=zero-strip] [data-name="AGENT-BASE"]').first();
  const rb = await row.boundingBox();
  const free = await page.evaluate(({ x, y }) => !document.elementFromPoint(x, y)?.closest("[data-testid=zero-dock]"), { x: rb.x + rb.width / 2, y: rb.y + rb.height / 2 });
  await row.click();
  const under = await until(async () => (await page.locator("[data-testid=chat-view]:visible", { hasText: "DOCKFIX AB on it." }).count()) > 0, 10000);
  check("a side-nav row beside the dock still takes the click and opens its chat; the dock stays", free && under && (await dock.isVisible()), { free, under });
  if (shots) await page.screenshot({ path: path.join(shots, "t0216-dock-1440.png") });

  // A message from the dock goes to Agent Zero's pane (w1:p1), not the chat underneath.
  writeFileSync(trace, "");
  const box = dock.getByRole("textbox", { name: "Message" });
  await box.fill("DOCKFIX hello from the dock");
  await box.press("Enter");
  const typed = await until(() => sends().some((s) => s[1] === "send-text" && s[2] === "w1:p1" && s[3].includes("DOCKFIX hello from the dock")), 8000);
  check("sending from the dock types into Agent Zero's pane", typed, { sends: sends().map((s) => s.slice(1, 3)) });

  // A voice note from the dock's mic: the fixture recording, through the node and the fake Groq, into his pane.
  writeFileSync(trace, "");
  const mic = dock.locator("[data-testid=mic]");
  await mic.click();
  await until(async () => (await mic.getAttribute("aria-pressed")) === "true", 5000);
  const violet = await dock.locator("[data-testid=halo-rim]").evaluate((el) => getComputedStyle(el, "::before").animationDuration);
  await page.waitForTimeout(600);
  await mic.click();
  const spoke = await until(() => sends().some((s) => s[1] === "send-text" && s[2] === "w1:p1" && s[3].includes(SAID)), 10000);
  check("a voice note from the dock's mic reaches Agent Zero's pane (fixture → node → fake Groq), the rim speeding up while it listens", spoke && violet === "3s", { spoke, violet });

  // Esc (outside the box) closes it; the face opens and closes it.
  await page.mouse.click(700, 120);
  await page.keyboard.press("Escape");
  const escClosed = await until(async () => (await dock.count()) === 0, 3000);
  await face.click();
  const again = await until(async () => (await dock.count()) === 1, 3000);
  await face.click();
  const faceClosed = await until(async () => (await dock.count()) === 0, 3000);
  check("Esc closes the dock; the face opens it and closes it", escClosed && again && faceClosed, { escClosed, again, faceClosed });
  check("no page errors", errors.length === 0, { errors });
} catch (e) {
  check("ran without throwing", false, { error: String(e?.stack ?? e).slice(0, 600) });
} finally {
  await browser?.close();
  node.kill();
  groq.close();
  rmSync(scratch, { recursive: true, force: true });
}
const passed = results.filter(Boolean).length;
console.log(`${passed}/${results.length} passed`);
process.exit(passed === results.length ? 0 : 1);
