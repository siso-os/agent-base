// Check (t-0271): the node keeps SISO Voice running. A fake launchctl (AB_LAUNCHCTL) plays launchd: the app's KeepAlive
// service starts stopped and must be kicked on start; the hourly sync between runs must be left alone, and kicked once
// when its last run failed; a second stop inside 5 minutes is not kicked again. /api/voice/status says all of it, with
// the history store's mtime as "last dictation" (a lab store with lab rows; nothing real is read). A node that is not
// the app's (no AB_VOICE_WATCH, not :5401) never calls launchctl. Then the Voice side nav's dot and "last dictation",
// and the rail dot while it is down, in headless WebKit at 1440 and 390. Fake herdr; never a live agent or service.
//   pnpm --filter @agent-base/web build && node services/node/test/voice-watch.mjs
// Shots: .shots/voice-watch-{1440,390,down}.png (AB_SHOTS=1: apps/web/preview/)
import { spawn } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import net from "node:net";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const REPO = path.resolve(import.meta.dirname, "../../..");
import { launchBrowser } from "./voice-browser.mjs";
// Shots go to the untracked .shots/ (a run never dirties another lane's tree); AB_SHOTS=1 refreshes apps/web/preview.
const SHOTS = process.env.AB_SHOTS === "1" ? path.join(REPO, "apps/web/preview") : path.join(REPO, ".shots");
mkdirSync(SHOTS, { recursive: true });
const scratch = mkdtempSync(path.join(process.env.TMPDIR ?? tmpdir(), ".siso-ephemeral-voice-watch."));
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
const UID = process.getuid();
const RUNTIME = "com.siso.voice.runtime";
const SYNC = "com.siso.voice-sync";

// The fake launchctl: services in a JSON file, every call appended to a log, `kickstart` starts the service.
const svcFile = path.join(scratch, "launchd.json");
const callLog = path.join(scratch, "launchctl.jsonl");
const services = (o) => writeFileSync(svcFile, JSON.stringify(o));
services({
  [RUNTIME]: { state: "not running", kind: "keepalive", lastExit: "-9" },
  [SYNC]: { state: "not running", kind: "interval", lastExit: "0" },
});
writeFileSync(callLog, "");
const fake = path.join(scratch, "launchctl.mjs");
writeFileSync(fake, `import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
const [verb, target, plist] = process.argv.slice(2);
appendFileSync(${JSON.stringify(callLog)}, JSON.stringify(plist ? [verb, target, plist] : [verb, target]) + '\\n');
const all = JSON.parse(readFileSync(${JSON.stringify(svcFile)}, 'utf8'));
// bootstrap gui/<uid> <plist>: launchd loads the job from its plist (and starts it, as RunAtLoad/KeepAlive would).
if (verb === 'bootstrap') { const l = plist.split('/').pop().replace(/\\.plist$/, ''); all[l] = { state: 'running', kind: 'keepalive', lastExit: '0', pid: 5151 }; writeFileSync(${JSON.stringify(svcFile)}, JSON.stringify(all)); process.exit(0); }
const label = String(target).split('/').pop();
const s = all[label];
if (!s) { console.error('Could not find service "' + label + '" in domain for user gui: ${UID}'); process.exit(113); }
if (verb === 'kickstart') { s.state = 'running'; s.pid = 4242; writeFileSync(${JSON.stringify(svcFile)}, JSON.stringify(all)); process.exit(0); }
const lines = [target + ' = {', '\\tactive count = 1', '\\tpath = /lab/' + label + '.plist', '\\tstate = ' + s.state, '', '\\tprogram = /lab/bin'];
if (s.state === 'running') lines.push('\\tpid = ' + (s.pid ?? 999));
lines.push('\\tlast exit code = ' + s.lastExit);
if (s.kind === 'interval') lines.push('\\trun interval = 3600 seconds', '\\tproperties = runatload | inferred program');
else lines.push('\\tproperties = keepalive | inferred program');
lines.push('}');
console.log(lines.join('\\n'));
`);
const launchctl = path.join(scratch, "launchctl");
writeFileSync(launchctl, `#!/bin/sh\nexec ${JSON.stringify(process.execPath)} ${JSON.stringify(fake)} "$@"\n`);
chmodSync(launchctl, 0o755);
const calls = () => readFileSync(callLog, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
const kicks = (label) => calls().filter(([v, t]) => v === "kickstart" && t === `gui/${UID}/${label}`).length;

// A lab history store (lab words only), last written 4 minutes ago.
const db = path.join(scratch, "PipelineHistory.sqlite");
{
  const h = new DatabaseSync(db);
  h.exec(`CREATE TABLE ZPIPELINEHISTORYENTRY (Z_PK INTEGER PRIMARY KEY, ZTIMESTAMP REAL, ZCONTEXTAPPNAME TEXT, ZCONTEXTBUNDLEIDENTIFIER TEXT, ZINTENT TEXT,
    ZAUDIODURATIONSECONDS REAL, ZAUDIOFILENAME TEXT, ZPOSTPROCESSEDTRANSCRIPT TEXT, ZRAWTRANSCRIPT TEXT, ZPOSTPROCESSINGSTATUS TEXT, ZCUSTOMVOCABULARY TEXT)`);
  const ins = h.prepare("INSERT INTO ZPIPELINEHISTORYENTRY (ZTIMESTAMP, ZCONTEXTAPPNAME, ZPOSTPROCESSEDTRANSCRIPT, ZRAWTRANSCRIPT) VALUES (?, ?, ?, ?)");
  for (let i = 0; i < 3; i++) ins.run(Date.now() / 1000 - 978307200 - 240 - i * 3600, "Lab", "lab entry one two three", "lab entry one two three");
  h.close();
}
const dictatedAt = new Date(Date.now() - 4 * 60_000);
utimesSync(db, dictatedAt, dictatedAt);

const AGENTS = [{ agent: "claude", agent_status: "idle", cwd: "/tmp", pane_id: "w1:p1", terminal_id: "term_vw", terminal_title_stripped: "A0", agent_session: { value: "vw" } }];
const herdr = path.join(scratch, "herdr.mjs");
writeFileSync(herdr, `const a = process.argv.slice(2); console.log(a[0] === 'agent' && a[1] === 'list' ? JSON.stringify({ result: { agents: ${JSON.stringify(AGENTS)} } }) : '{}');\n`);

// The lab's ~/Library/LaunchAgents: SISO Voice's plist, read by the fake launchd only.
const agentsDir = path.join(scratch, "LaunchAgents");
mkdirSync(agentsDir, { recursive: true });
writeFileSync(path.join(agentsDir, `${RUNTIME}.plist`), "<plist><dict><key>Label</key><string>lab</string></dict></plist>\n");
const base = (port) => ({ ...process.env, AB_PORT: String(port), AB_HERDR: `${process.execPath} ${herdr}`, AB_LAUNCHCTL: launchctl, AB_LAUNCH_AGENTS: agentsDir, AB_VOICE_RECHECK_MS: "300", AB_VOICE_DB: db, AB_CLAUDE_DIRS: path.join(scratch, "claude"), AB_UPLOADS: path.join(scratch, "uploads"), AB_HOSTS_DIR: path.join(scratch, "hosts"), AB_STATE: path.join(scratch, "rows.json"), AB_REGISTRY: path.join(scratch, "registry.json"), AB_CTX_DIR: path.join(scratch, "ctx"), AB_CONSOLE_EVENTS: path.join(scratch, "none.jsonl"), AB_RESURRECT_DIR: path.join(scratch, "none"), AB_HUB_HOME: scratch });
const startNode = (env) => {
  const n = spawn(process.execPath, ["--experimental-strip-types", "--no-warnings", "src/server.ts"], { cwd: path.join(REPO, "services/node"), env, stdio: ["ignore", "pipe", "pipe"] });
  n.out = "";
  n.stdout.on("data", (d) => (n.out += d));
  n.stderr.on("data", (d) => (n.out += d));
  return n;
};
const up = async (origin) => {
  for (let i = 0; i < 75; i++) {
    try {
      if ((await fetch(`${origin}/api/health`)).ok) return true;
    } catch {}
    await sleep(200);
  }
  return false;
};
const status = async (origin) => (await fetch(`${origin}/api/voice/status`)).json();

let node = null;
let other = null;
let browser = null;
try {
  // 0. A node that is not the app's leaves launchd alone.
  const P0 = await freePort();
  const env0 = base(P0);
  delete env0.AB_VOICE_WATCH;
  other = startNode(env0);
  await up(`http://127.0.0.1:${P0}`);
  const s0 = await status(`http://127.0.0.1:${P0}`);
  await sleep(500);
  check("a test node (not :5401, no AB_VOICE_WATCH) never calls launchctl", s0.watching === false && s0.services.length === 0 && calls().length === 0, { watching: s0.watching, calls: calls().length });
  other.kill();
  other = null;

  // 1. The app's node: checks on start and kicks the stopped app service; leaves the hourly sync between runs.
  const PORT = await freePort();
  const ORIGIN = `http://127.0.0.1:${PORT}`;
  node = startNode({ ...base(PORT), AB_VOICE_WATCH: "1", AB_VOICE_WATCH_MS: "700" });
  check("node up", await up(ORIGIN));
  for (let i = 0; i < 30 && kicks(RUNTIME) === 0; i++) await sleep(100);
  await sleep(900); // one more 0.7 s round, so the status reads the service as running
  let s = await status(ORIGIN);
  const rt = s.services.find((x) => x.label === RUNTIME);
  const sy = s.services.find((x) => x.label === SYNC);
  check("on start the stopped SISO Voice service is kickstarted (gui/<uid>/label)", kicks(RUNTIME) === 1 && calls().some(([v, t]) => v === "print" && t === `gui/${UID}/${RUNTIME}`), { kicks: kicks(RUNTIME) });
  check("status: SISO Voice running again, with the kick's time", rt?.running === true && rt.ok && rt.kind === "keepalive" && rt.pid === 4242 && rt.lastKickOk === true && Date.now() - Date.parse(rt.lastKick) < 10_000, rt);
  check("the hourly sync between runs (last exit 0) is OK and not kicked", sy?.ok === true && sy.running === false && sy.kind === "interval" && kicks(SYNC) === 0, sy);
  check("last dictation = the history store's newest write, to the second", Math.abs(Date.parse(s.lastDictationAt) - dictatedAt.getTime()) < 1000, { lastDictationAt: s.lastDictationAt });
  check("the kick is in the node's log", /voice watch: com\.siso\.voice\.runtime not running \(last exit -9\); kickstart ok · kick 1/.test(node.out), { log: node.out.split("\n").filter((l) => l.includes("voice watch")) });
  check("status carries no transcript text", !JSON.stringify(s).includes("lab entry"));

  // 2. Down again inside 5 minutes: not kicked again (rate limit), and the status says it is down.
  const svc = JSON.parse(readFileSync(svcFile, "utf8"));
  svc[RUNTIME].state = "not running";
  svc[SYNC].lastExit = "1"; // and the sync's last run failed
  services(svc);
  await sleep(2500); // three or four 0.7 s rounds
  s = await status(ORIGIN);
  const rt2 = s.services.find((x) => x.label === RUNTIME);
  const prints = calls().filter(([v, t]) => v === "print" && t.endsWith(RUNTIME)).length;
  check("checked every round, but kicked at most once per 5 minutes per label", kicks(RUNTIME) === 1 && prints >= 5 && rt2.running === false && rt2.ok === false && rt2.kicks === 1, { kicks: kicks(RUNTIME), prints, rt: rt2 });
  check("a sync whose last run failed is kicked once, not every round", kicks(SYNC) === 1, { kicks: kicks(SYNC) });

  const post = await fetch(`${ORIGIN}/api/voice/status`, { method: "POST" });
  const foreign = await fetch(`${ORIGIN}/api/voice/status`, { headers: { origin: "https://evil.example" } });
  check("status is read-only and only served to this machine", post.status === 405 && foreign.status === 403, { post: post.status, foreign: foreign.status });
  const rGet = await fetch(`${ORIGIN}/api/voice/restart`);
  const rForeign = await fetch(`${ORIGIN}/api/voice/restart`, { method: "POST", headers: { origin: "https://evil.example" } });
  check("restart is POST only, and only from this machine", rGet.status === 405 && rForeign.status === 403 && kicks(RUNTIME) === 1, { get: rGet.status, foreign: rForeign.status, kicks: kicks(RUNTIME) });

  // 3. The app: the Voice side nav's dot and last dictation; the rail dot while SISO Voice is down.
  browser = await launchBrowser();
  const errors = [];
  for (const [w, h] of [[1440, 900], [390, 844]]) {
    const page = await browser.newPage({ viewport: { width: w, height: h } });
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(`${ORIGIN}/`);
    const rail = page.locator('.siso-app__rail-btn[aria-label^="Voice"]').first();
    if (w === 1440) {
      await page.locator('.siso-app__rail-btn[aria-label="Voice: SISO Voice is down"]').waitFor({ timeout: 15000 }).catch(() => {});
      const down = await rail.getAttribute("aria-label");
      const dot = await rail.locator(".siso-app__rail-dot.is-alert").count();
      await rail.click();
      const health = page.locator("[data-testid=voice-health]");
      await page.locator('[data-testid=voice-health]:not([data-health=loading])').waitFor({ timeout: 10000 });
      check("rail: the Voice button carries a red dot and says SISO Voice is down", dot === 1 && /down/.test(down ?? ""), { label: down, dot });
      // v2 (c9c520b8) moved the note into the side nav as "SISO Voice down" with a Restart, and dropped "last dictation".
      check("side nav: says SISO Voice is down, with a Restart, while it is down", (await health.getAttribute("data-health")) === "down" && /SISO Voice down/.test(await health.innerText()) && (await page.locator("[data-testid=voice-restart]").count()) === 1, { health: await health.getAttribute("data-health"), text: await health.innerText() });
      const restartBtn = page.locator("[data-testid=voice-restart]");
      const fitsDown = await health.evaluate((el) => {
        const h = el.closest("h2");
        return !h || h.scrollWidth <= h.clientWidth + 1;
      });
      check("down: a Restart button beside the dot, and the note still fits", (await restartBtn.count()) === 1 && fitsDown, { fits: fitsDown });
      await page.screenshot({ path: path.join(SHOTS, "voice-watch-down.png") });
      // His press: restarted now (inside the watch's 5-minute gap), and the dot shows it back without waiting a poll.
      await restartBtn.click();
      await page.locator("[data-testid=voice-health]:not([data-health=down])").waitFor({ timeout: 8000 }).catch(() => {});
      check("Restart kicks it at once and the dot comes back", kicks(RUNTIME) === 2 && ["up", "kicked"].includes(await health.getAttribute("data-health")) && /kickstart ok · kick 2 \(asked for\)/.test(node.out), { kicks: kicks(RUNTIME), health: await health.getAttribute("data-health") });
      const svc3 = JSON.parse(readFileSync(svcFile, "utf8"));
      svc3[RUNTIME].state = "not running";
      services(svc3);
      const again = await (await fetch(`${ORIGIN}/api/voice/restart`, { method: "POST" })).json();
      check("a second Restart inside 20 s does not kick again", kicks(RUNTIME) === 2 && again.services.find((x) => x.label === RUNTIME)?.ok === false, { kicks: kicks(RUNTIME) });
      // The node going away: the dot says the node is not answering, not "not watched".
      await page.route("**/api/voice/status", (r) => r.abort());
      await page.reload();
      await rail.click().catch(() => {});
      await page.locator("[data-testid=voice-health][data-health=offline]").waitFor({ timeout: 10000 }).catch(() => {});
      check("node not answering: the dot is red and says so", (await health.getAttribute("data-health")) === "offline" && /not answering/.test(await health.innerText()), { health: await health.getAttribute("data-health"), text: await health.innerText().catch(() => "") });
      await page.unroute("**/api/voice/status");
      // It comes back (launchd restarts it): the dot turns green within one poll.
      const svc2 = JSON.parse(readFileSync(svcFile, "utf8"));
      svc2[RUNTIME].state = "running";
      svc2[SYNC].lastExit = "0";
      services(svc2);
      await page.reload();
      await rail.click().catch(() => {});
      await page.locator("[data-testid=voice-health]").waitFor({ timeout: 10000 });
      let hv = "";
      for (let i = 0; i < 30 && !["up", "kicked"].includes(hv); i++) {
        await sleep(300);
        await page.reload();
        await page.locator("[data-testid=voice-health]:not([data-health=loading])").waitFor({ timeout: 10000 });
        hv = (await page.locator("[data-testid=voice-health]").getAttribute("data-health")) ?? "";
      }
      const railDot = await rail.locator(".siso-app__rail-dot").count();
      check("back up: the dot is no longer red and the rail dot is gone", ["up", "kicked"].includes(hv) && railDot === 0, { health: hv, railDot });
      const box = await page.locator("[data-testid=voice-health]").evaluate((el) => {
        const box = el.parentElement;
        return { fits: el.getClientRects().length === 1 && el.getBoundingClientRect().right <= box.getBoundingClientRect().right + 1, text: el.textContent };
      });
      check("1440: the side nav's health note fits on one line", box.fits, box);
      await page.screenshot({ path: path.join(SHOTS, "voice-watch-1440.png") });
    } else {
      await rail.click({ timeout: 15000 }).catch(() => {});
      const health = page.locator("[data-testid=voice-health]");
      const seen = await page.locator("[data-testid=voice-health]:not([data-health=loading])").waitFor({ timeout: 10000 }).then(() => true, () => false);
      const text = seen ? await health.innerText() : "";
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
      check("390: the note shows and the page does not scroll sideways", seen && /^SISO Voice /.test(text) && !overflow, { seen, text, overflow });
      await page.screenshot({ path: path.join(SHOTS, "voice-watch-390.png") });
    }
    await page.close();
  }
  check("no page errors", errors.length === 0, { errors });

  // 4. SISO Voice not loaded at all (booted out): kickstart cannot reach it, so the node bootstraps its own plist.
  node.kill();
  node = null;
  const svc4 = JSON.parse(readFileSync(svcFile, "utf8"));
  delete svc4[RUNTIME];
  svc4[SYNC].lastExit = "0";
  services(svc4);
  writeFileSync(callLog, "");
  const P2 = await freePort();
  node = startNode({ ...base(P2), AB_VOICE_WATCH: "1", AB_VOICE_WATCH_MS: "700" });
  await up(`http://127.0.0.1:${P2}`);
  for (let i = 0; i < 30 && !calls().some(([v]) => v === "bootstrap"); i++) await sleep(100);
  await sleep(700);
  const s4 = await status(`http://127.0.0.1:${P2}`);
  const rt4 = s4.services.find((x) => x.label === RUNTIME);
  const boot = calls().find(([v]) => v === "bootstrap");
  check("not loaded: bootstrapped from ~/Library/LaunchAgents/<label>.plist, and then running", boot?.[1] === `gui/${UID}` && boot?.[2] === path.join(agentsDir, `${RUNTIME}.plist`) && kicks(RUNTIME) === 0 && rt4?.running === true && rt4.loaded, { boot, rt: rt4 });
} catch (e) {
  check("ran to the end", false, { error: String(e?.stack ?? e).slice(0, 600), node: node?.out.slice(-400) });
} finally {
  await browser?.close();
  node?.kill();
  other?.kill();
  rmSync(scratch, { recursive: true, force: true, maxRetries: 5 });
}
const failed = results.filter((r) => !r).length;
console.log(JSON.stringify({ "voice-watch": failed ? "FAIL" : "PASS", passed: results.length - failed, failed }));
process.exit(failed ? 1 : 0);
