// Check (a0-018): an SDK seat's context gauge and its compaction, relayed inside siso-host, on fakes only.
//   node services/node/test/a0-compact.mjs
// siso-host runs on a fake claude (services/host/test/fake-claude.mjs: stream-json, no model) in a fake herdr pane
// (HERDR_BIN_PATH logs what it is told); a node on AB_HOSTS_DIR lists the seat. Checks: the host's gauge (82% of a 200k
// window) reaches its host file, its socket and the app's HUD row; a compaction says "Compacting at 82%" then "Back,
// summary of 1.2k tokens"; the new session id reaches the host file, herdr (report-agent-session) and the app; a message
// sent during the compaction is held until Claude is back, then answered, never lost. Prints one JSON line per check.
import { spawn } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import net from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { WebSocket } from "ws";

const REPO = path.join(import.meta.dirname, "../../..");
const HOST = path.join(REPO, "services/host/bin/siso-host");
const scratch = realpathSync(mkdtempSync(path.join(process.env.TMPDIR ?? tmpdir(), ".siso-ephemeral-a0-compact.")));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, detail = {}) => {
  results.push(!!ok);
  console.log(JSON.stringify({ check: name, ok: !!ok, ...detail }));
};
const until = async (fn, ms = 10000) => {
  for (const end = Date.now() + ms; Date.now() < end; await sleep(50)) if (fn()) return true;
  return !!fn();
};
const freePort = async () => {
  const s = net.createServer();
  await new Promise((r) => s.listen(0, "127.0.0.1", r));
  const p = s.address().port;
  await new Promise((r) => s.close(r));
  return p;
};

const PANE = "w9:pcompact";
const NEW_SESSION = "a0-018-after-compaction";
const hosts = path.join(scratch, "hosts");
const work = path.join(scratch, "work");
const herdrLog = path.join(scratch, "herdr.log");
const claudeLog = path.join(scratch, "claude.log");
mkdirSync(work);
const fakeHerdr = path.join(scratch, "herdr");
writeFileSync(fakeHerdr, `#!/bin/sh\necho "$*" >> "${herdrLog}"\n`);
chmodSync(fakeHerdr, 0o755);
const lines = (f) => (existsSync(f) ? readFileSync(f, "utf8").split("\n").filter(Boolean) : []);
const claudeEvents = () => lines(claudeLog).map((l) => JSON.parse(l));
const hostFile = () => {
  try {
    return JSON.parse(readFileSync(path.join(hosts, readdirSync(hosts).find((f) => f.endsWith(".json"))), "utf8"));
  } catch {
    return null;
  }
};

let host, node, ws;
const events = [];
try {
  host = spawn(HOST, ["--name", "A0-COMPACT", "--no-stack"], {
    cwd: work,
    stdio: ["pipe", "ignore", "pipe"],
    env: { ...process.env, CLAUDE_BIN: path.join(REPO, "services/host/test/fake-claude.mjs"), FAKE_CLAUDE_LOG: claudeLog, FAKE_NEW_SESSION: NEW_SESSION, FAKE_COMPACT_MS: "1500", HERDR_BIN_PATH: fakeHerdr, HERDR_ENV: "1", HERDR_PANE_ID: PANE, AB_HOSTS_DIR: hosts },
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

  // 1. The gauge: 164k of a 200k window.
  say("hello");
  await until(() => seen((e) => e.t === "result"));
  check("context event on the socket: 82% of 200k", seen((e) => e.t === "context" && e.pct === 82 && e.window === 200_000 && e.used === 164_000));
  await until(() => hostFile()?.ctx?.pct === 82);
  const h1 = hostFile();
  check("host file carries the gauge, state and child", h1?.ctx?.pct === 82 && h1.ctx.window === 200_000 && h1.state === "idle" && h1.child === "running", { ctx: h1?.ctx, state: h1?.state, child: h1?.child });
  const oldSession = h1?.session;

  // 2. Compaction, with a message sent while it runs.
  say("COMPACT now");
  check("compaction announced with its % ", await until(() => seen((e) => e.t === "note" && e.label === "Compacting" && e.text === "Compacting at 82%")), { notes: events.filter((e) => e.t === "note").map((e) => e.text) });
  await until(() => hostFile()?.compacting === true, 2000);
  say("sent during compaction");
  await until(() => seen((e) => e.t === "queued" && e.text === "sent during compaction"), 3000);
  const q = events.find((e) => e.t === "queued" && e.text === "sent during compaction");
  check("message sent during compaction shows queued, not in the chat yet", !!q && !seen((e) => e.t === "user" && e.text === "sent during compaction"));
  check("back, with the summary's size", await until(() => seen((e) => e.t === "note" && e.label === "Compacted" && e.text === "Back, summary of 1.2k tokens")), { notes: events.filter((e) => e.t === "note").map((e) => e.text) });
  check("one note per compaction phase (the SDK's compact_boundary note not doubled)", events.filter((e) => e.t === "note" && /ompact/.test(e.label ?? "")).length === 2, { labels: events.filter((e) => e.t === "note").map((e) => e.label) });
  await until(() => seen((e) => e.t === "text" && e.text === "echo: sent during compaction"));
  const ce = claudeEvents();
  const post = ce.find((e) => e.ev === "hook" && e.name === "PostCompact");
  const during = ce.find((e) => e.ev === "user" && e.text === "sent during compaction");
  check("PreCompact and PostCompact ran in the host (registered, answered)", ce.filter((e) => e.ev === "hook" && e.registered && e.answered === "success").length === 2, { hooks: ce.filter((e) => e.ev === "hook") });
  check("the held message reached Claude only after PostCompact", !!post && !!during && during.at >= post.at, { post: post?.at, during: during?.at });
  check("and was answered, and shown as his message", seen((e) => e.t === "text" && e.text === "echo: sent during compaction") && seen((e) => e.t === "user" && e.id === q?.id), {});
  check("no message lost: every message he sent reached Claude once", ["hello", "COMPACT now", "sent during compaction"].every((t) => ce.filter((e) => e.ev === "user" && e.text === t).length === 1));

  // 3. The session id after compaction is followed.
  await until(() => hostFile()?.session === NEW_SESSION && hostFile()?.state === "idle");
  const h2 = hostFile();
  check("host file follows the new session id", h2?.session === NEW_SESSION && oldSession && oldSession !== NEW_SESSION, { before: oldSession, after: h2?.session });
  const hl = lines(herdrLog);
  check("herdr told the new session (report-agent-session)", hl.some((l) => l.startsWith(`pane report-agent-session ${PANE} `) && l.includes(`--agent-session-id ${NEW_SESSION}`)), { herdr: hl.filter((l) => l.includes("report-agent-session")) });
  check("gauge after compaction: 9k of 200k", h2?.ctx?.pct === 5 && h2.ctx.used === 9000, { ctx: h2?.ctx });
  check("herdr only ever heard about this pane, nothing released", hl.length > 0 && hl.every((l) => l.includes(` ${PANE} `)) && !hl.some((l) => l.includes("release-agent")), { herdr: hl.map((l) => l.split(" --")[0]) });

  // 4. The app: the seat row's HUD shows the host's gauge and its new session.
  const port = await freePort();
  node = spawn(process.execPath, ["--experimental-strip-types", "--no-warnings", "src/server.ts"], {
    cwd: path.join(REPO, "services/node"),
    stdio: "ignore",
    env: {
      ...process.env, AB_PORT: String(port), AB_HOSTS_DIR: hosts, AB_HERDR: `${process.execPath} ${path.join(REPO, "services/node/test/fake-herdr.mjs")}`,
      FAKE_HERDR_AGENTS: JSON.stringify([{ agent: "siso", agent_status: "idle", cwd: work, pane_id: PANE, terminal_id: "term_compact", terminal_title_stripped: "A0-COMPACT", agent_session: { value: NEW_SESSION } }]),
      AB_STATE: path.join(scratch, "rows.json"), AB_REGISTRY: path.join(scratch, "registry.json"), AB_CTX_DIR: path.join(scratch, "ctx"), AB_CLAUDE_DIRS: path.join(scratch, "claude"),
      AB_A0_SEAT: path.join(scratch, "seat.json"), AB_RESURRECT_DIR: path.join(scratch, "none"), AB_CONSOLE_EVENTS: path.join(scratch, "none.jsonl"), AB_UPLOADS: path.join(scratch, "uploads"),
    },
  });
  let row = null;
  for (let i = 0; i < 60 && !row; i++) {
    await sleep(500);
    try {
      row = ((await fetch(`http://127.0.0.1:${port}/api/agents`).then((r) => r.json())).agents ?? []).find((a) => a.pane === PANE) ?? null;
    } catch {}
  }
  check("app lists the seat as a host seat", !!row && row.host === true, { row: row && { name: row.name, host: row.host, session: row.session } });
  check("app's HUD shows the host's gauge (5% ctx)", row?.hud?.context === 5 && row?.context === 5, { hud: row?.hud });
  check("app's row has the new session", row?.session === NEW_SESSION, { session: row?.session });
} catch (e) {
  check("ran without throwing", false, { error: String(e?.stack ?? e).slice(0, 500) });
} finally {
  ws?.close();
  node?.kill();
  host?.kill("SIGTERM");
  await sleep(300);
  rmSync(scratch, { recursive: true, force: true });
}
const failed = results.filter((r) => !r).length;
console.log(JSON.stringify({ summary: `${results.length - failed}/${results.length} passed` }));
process.exit(failed ? 1 : 0);
