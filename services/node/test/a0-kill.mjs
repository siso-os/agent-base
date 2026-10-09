// Check (a0-018): kill Agent Zero's claude under siso-host, mid-turn and idle, on fakes only.
//   node services/node/test/a0-kill.mjs
// siso-host runs on a fake claude (services/host/test/fake-claude.mjs) in a fake herdr pane (HERDR_BIN_PATH logs what it
// is told). Another live host's file (another pane) sits in the same hosts folder. The fake claude is SIGKILLed mid-turn,
// then again while idle. Checks: the host lives on and reports blocked (mid-turn) / idle (idle) to herdr and its socket;
// its host file stays, honest (state, child stopped, same session); it releases nothing, and never touches the other
// pane or its file; the next message starts claude again on the same session and is answered; the app (services/node on
// AB_HOSTS_DIR, herdr no longer listing the agent) still lists the seat with the host's state; only SIGTERM releases its
// own pane and removes its own file. Prints one JSON line per check.
import { spawn } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import net from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { WebSocket } from "ws";

const REPO = path.join(import.meta.dirname, "../../..");
const HOST = path.join(REPO, "services/host/bin/siso-host");
const scratch = realpathSync(mkdtempSync(path.join(process.env.TMPDIR ?? tmpdir(), ".siso-ephemeral-a0-kill.")));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, detail = {}) => {
  results.push(!!ok);
  console.log(JSON.stringify({ check: name, ok: !!ok, ...detail }));
};
const until = async (fn, ms = 10000) => {
  for (const end = Date.now() + ms; Date.now() < end; await sleep(50)) if (await fn()) return true;
  return !!(await fn());
};
const freePort = async () => {
  const s = net.createServer();
  await new Promise((r) => s.listen(0, "127.0.0.1", r));
  const p = s.address().port;
  await new Promise((r) => s.close(r));
  return p;
};
const alive = (pid) => {
  try {
    return process.kill(pid, 0), true;
  } catch {
    return false;
  }
};

const PANE = "w9:pkill";
const OTHER = "w9:pother";
const hosts = path.join(scratch, "hosts");
const work = path.join(scratch, "work");
const herdrLog = path.join(scratch, "herdr.log");
const claudeLog = path.join(scratch, "claude.log");
mkdirSync(work);
mkdirSync(hosts);
const fakeHerdr = path.join(scratch, "herdr");
writeFileSync(fakeHerdr, `#!/bin/sh\necho "$*" >> "${herdrLog}"\n`);
chmodSync(fakeHerdr, 0o755);
// Another seat's live host (this process stands in for its pid): not this host's to touch.
const otherFile = path.join(hosts, "w9_pother.json");
const otherBody = JSON.stringify({ pid: process.pid, port: 1, token: "t", session: "other-session", pane: OTHER, name: "OTHER", cwd: work });
writeFileSync(otherFile, otherBody);
const myFile = path.join(hosts, "w9_pkill.json");
const lines = (f) => (existsSync(f) ? readFileSync(f, "utf8").split("\n").filter(Boolean) : []);
const claudeEvents = () => lines(claudeLog).map((l) => JSON.parse(l));
const hostFile = () => {
  try {
    return JSON.parse(readFileSync(myFile, "utf8"));
  } catch {
    return null;
  }
};
const lastState = () => lines(herdrLog).filter((l) => l.startsWith(`pane report-agent ${PANE} `)).map((l) => l.match(/--state (\w+)/)?.[1]).pop();

let host, node, ws;
const events = [];
try {
  host = spawn(HOST, ["--name", "A0-KILL", "--no-stack"], {
    cwd: work,
    stdio: ["pipe", "ignore", "pipe"],
    env: { ...process.env, CLAUDE_BIN: path.join(REPO, "services/host/test/fake-claude.mjs"), FAKE_CLAUDE_LOG: claudeLog, HERDR_BIN_PATH: fakeHerdr, HERDR_ENV: "1", HERDR_PANE_ID: PANE, AB_HOSTS_DIR: hosts },
  });
  let err = "";
  host.stderr.on("data", (d) => (err += d));
  check("host starts and writes its host file", await until(() => hostFile()?.port), { err: err.slice(-300) });
  const h0 = hostFile();
  ws = new WebSocket(`ws://127.0.0.1:${h0.port}/ws?token=${h0.token}`);
  ws.on("message", (raw) => events.push(JSON.parse(String(raw))));
  await new Promise((r, j) => (ws.once("open", r), ws.once("error", j)));
  const say = (text) => ws.send(JSON.stringify({ t: "prompt", text }));
  const seen = (fn) => events.some(fn);
  const states = () => events.filter((e) => e.t === "state").map((e) => e.state);

  // 1. A turn that never ends; kill its claude mid-turn.
  say("HANG on this one");
  await until(() => claudeEvents().some((e) => e.ev === "hanging"));
  const first = claudeEvents().find((e) => e.ev === "start");
  const session = hostFile()?.session;
  // Host files update synchronously; the coalesced herdr report completes asynchronously.
  check("mid-turn: host working, herdr told working", await until(() => hostFile()?.state === "working" && lastState() === "working"), { file: hostFile()?.state, herdr: lastState() });
  process.kill(first.pid, "SIGKILL");
  await until(() => hostFile()?.child === "stopped");
  await sleep(300);
  const h1 = hostFile();
  check("host survives its claude's death", alive(host.pid) && !alive(first.pid), { host: alive(host.pid), claude: alive(first.pid) });
  check("killed mid-turn: blocked on the socket and to herdr", states().at(-1) === "blocked" && lastState() === "blocked", { states: states().slice(-3), herdr: lastState() });
  check("herdr's message says why", lines(herdrLog).some((l) => l.startsWith(`pane report-agent ${PANE} `) && l.includes("--state blocked") && l.includes("--message Claude stopped")));
  check("the chat says so, and keeps the half-written words", seen((e) => e.t === "note" && e.label === "Claude stopped" && /mid-turn/.test(e.text)) && seen((e) => e.t === "text" && e.text === "working on it, half a sentence"), { notes: events.filter((e) => e.t === "note").map((e) => e.text) });
  check("host file honest: same pid and session, blocked, child stopped", h1?.pid === host.pid && h1.session === session && h1.state === "blocked" && h1.child === "stopped" && h1.port === h0.port, { file: h1 && { pid: h1.pid, session: h1.session, state: h1.state, child: h1.child } });
  check("nothing released, nothing said about another pane", !lines(herdrLog).some((l) => l.includes("release-agent") || l.includes(OTHER)));
  check("the other host's file untouched", existsSync(otherFile) && readFileSync(otherFile, "utf8") === otherBody);

  // 2. The app still lists the seat (herdr lost the agent; the pane is still there), with the host's state.
  const port = await freePort();
  node = spawn(process.execPath, ["--experimental-strip-types", "--no-warnings", "src/server.ts"], {
    cwd: path.join(REPO, "services/node"),
    stdio: "ignore",
    env: {
      ...process.env, AB_PORT: String(port), AB_HOSTS_DIR: hosts, AB_HERDR: `${process.execPath} ${path.join(REPO, "services/node/test/fake-herdr.mjs")}`,
      FAKE_HERDR_AGENTS: JSON.stringify([{ agent: "claude", agent_status: "idle", cwd: "/tmp", pane_id: "w1:p1", terminal_id: "term_links1", terminal_title_stripped: "LINKS" }]),
      FAKE_HERDR_PANES: JSON.stringify([{ pane_id: "w1:p1", terminal_id: "term_links1" }, { pane_id: PANE, terminal_id: "term_kill" }]),
      AB_STATE: path.join(scratch, "rows.json"), AB_REGISTRY: path.join(scratch, "registry.json"), AB_CTX_DIR: path.join(scratch, "ctx"), AB_CLAUDE_DIRS: path.join(scratch, "claude"),
      AB_A0_SEAT: path.join(scratch, "seat.json"), AB_RESURRECT_DIR: path.join(scratch, "none"), AB_CONSOLE_EVENTS: path.join(scratch, "none.jsonl"), AB_UPLOADS: path.join(scratch, "uploads"),
    },
  });
  const seat = async () => {
    try {
      return ((await fetch(`http://127.0.0.1:${port}/api/agents`).then((r) => r.json())).agents ?? []).find((a) => a.pane === PANE) ?? null;
    } catch {
      return null;
    }
  };
  let row = null;
  await until(async () => (row = await seat()), 30000);
  check("app still lists the seat after the kill, as a host seat", !!row?.host && row.serviceHost?.name === "A0-KILL" && row.session === session, { row: row && { name: row.name, host: row.host, session: row.session, status: row.status } });
  check("the app's row is blocked (\"needs\"), from the host file", row?.status === "needs", { status: row?.status });

  // 3. The next message starts claude again, on the same session, and is answered.
  say("are you back?");
  check("restarted and answered", await until(() => seen((e) => e.t === "text" && e.text === "echo: are you back?")));
  const starts = claudeEvents().filter((e) => e.ev === "start");
  const second = starts[1];
  check("second claude resumed the same session", starts.length === 2 && second.argv.includes(`--resume=${session}`) && second.session === session, { argv: second?.argv?.filter((a) => a.startsWith("--resume")) });
  check("the message reached the new claude once", claudeEvents().filter((e) => e.ev === "user" && e.text === "are you back?").length === 1);
  await until(() => hostFile()?.state === "idle" && hostFile()?.child === "running" && lastState() === "idle", 2000);
  check("host file running and idle again", hostFile()?.child === "running" && hostFile()?.state === "idle" && lastState() === "idle", { file: hostFile() && { state: hostFile().state, child: hostFile().child }, herdr: lastState() });

  // 4. Kill it while idle: idle stays idle (nothing was cut off), honestly marked stopped.
  process.kill(second.pid, "SIGKILL");
  await until(() => hostFile()?.child === "stopped");
  await sleep(300);
  check("killed idle: host alive, still idle to herdr and the socket", alive(host.pid) && states().at(-1) === "idle" && lastState() === "idle" && hostFile()?.state === "idle", { states: states().slice(-2), herdr: lastState() });
  check("killed idle: chat note without 'mid-turn'", seen((e) => e.t === "note" && e.label === "Claude stopped" && !/mid-turn/.test(e.text)));
  await until(async () => (row = await seat())?.status === "idle", 8000);
  check("app still lists the seat, idle", !!row?.host && row.serviceHost?.name === "A0-KILL" && row.status === "idle", { status: row?.status });
  check("still nothing released after two deaths", !lines(herdrLog).some((l) => l.includes("release-agent")));

  // 5. Only SIGTERM (the host itself ending) releases its own pane and removes its own file.
  host.kill("SIGTERM");
  await until(() => !alive(host.pid), 5000);
  const released = lines(herdrLog).filter((l) => l.includes("release-agent"));
  check("SIGTERM: releases its own pane, once, and nothing else", released.length === 1 && released[0].startsWith(`pane release-agent ${PANE} `), { released });
  check("SIGTERM: its file gone, the other host's file kept", !existsSync(myFile) && existsSync(otherFile) && readFileSync(otherFile, "utf8") === otherBody);
} catch (e) {
  check("ran without throwing", false, { error: String(e?.stack ?? e).slice(0, 500) });
} finally {
  ws?.close();
  node?.kill();
  host?.kill("SIGKILL");
  for (const e of claudeEvents().filter((e) => e.ev === "start")) if (alive(e.pid)) process.kill(e.pid, "SIGKILL");
  await sleep(200);
  rmSync(scratch, { recursive: true, force: true });
}
const failed = results.filter((r) => !r).length;
console.log(JSON.stringify({ summary: `${results.length - failed}/${results.length} passed` }));
process.exit(failed ? 1 : 0);
