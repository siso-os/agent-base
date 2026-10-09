// Synthetic replay lifecycle check. It never starts Claude's query or uses credentials.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { WebSocket } from "ws";

const HOST = path.join(import.meta.dirname, "../bin/siso-host");
const scratch = mkdtempSync(path.join(process.env.TMPDIR ?? tmpdir(), ".siso-replay-readonly."));
const hosts = path.join(scratch, "hosts");
const config = path.join(scratch, "claude");
const cwd = path.join(scratch, "work");
const herdrLog = path.join(scratch, "herdr.log");
mkdirSync(cwd, { recursive: true });
// Claude stores a session under the cwd's normalized project directory. Keep an
// empty synthetic fixture there so replay exercises the normal history lookup.
const projectDir = path.join(config, "projects", cwd.replace(/[^A-Za-z0-9]/g, "-"));
mkdirSync(projectDir, { recursive: true });
writeFileSync(path.join(projectDir, "synthetic.jsonl"), "");
const fakeHerdr = path.join(scratch, "herdr");
writeFileSync(fakeHerdr, `#!/bin/sh\nprintf '%s\\n' "$*" >> ${JSON.stringify(herdrLog)}\n`);
const chmod = (await import("node:fs")).chmodSync;
chmod(fakeHerdr, 0o755);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const descriptor = path.join(hosts, "pane_test.json");
const running = [];
async function start(label) {
  const child = spawn(HOST, ["--replay", "synthetic", "--name", label], {
    cwd,
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, HOME: scratch, CLAUDE_CONFIG_DIR: config, AB_HOSTS_DIR: hosts, HERDR_BIN_PATH: fakeHerdr, HERDR_ENV: "1", HERDR_PANE_ID: "pane:test" },
  });
  const handle = { child, socket: null };
  running.push(handle);
  let stderr = "";
  child.stderr.on("data", (chunk) => (stderr += chunk));
  for (let i = 0; i < 100 && !existsSync(descriptor); i++) await sleep(50);
  assert.ok(existsSync(descriptor), `replay host descriptor missing: ${stderr}`);
  const info = JSON.parse(readFileSync(descriptor, "utf8"));
  const events = [];
  const socket = new WebSocket(`ws://127.0.0.1:${info.port}/ws?token=${encodeURIComponent(info.token)}`);
  handle.socket = socket;
  socket.on("message", (raw) => events.push(JSON.parse(String(raw))));
  await new Promise((resolve, reject) => { socket.once("open", resolve); socket.once("error", reject); });
  for (let i = 0; i < 20 && !events.some((e) => e.t === "hello"); i++) await sleep(25);
  assert.ok(events.some((e) => e.t === "hello"));
  return { child, socket, events };
}

try {
  const first = await start("READONLY");
  for (const message of [
    { t: "prompt", text: "must be ignored" },
    { t: "interrupt" },
    { t: "approve", id: "none", allow: true },
    { t: "unqueue", id: "none" },
    { t: "stop_task", id: "none" },
  ]) first.socket.send(JSON.stringify(message));
  await sleep(150);
  assert.equal(first.child.exitCode, null, "replay must survive mutation frames");
  assert.deepEqual(first.events.filter((e) => e.t !== "hello"), [], "replay must emit no mutation events");
  first.socket.close();
  first.child.kill("SIGTERM");
  await new Promise((resolve) => first.child.once("exit", resolve));
  assert.equal(existsSync(descriptor), false, "SIGTERM must remove replay descriptor");

  const second = await start("READONLY-2");
  second.socket.close();
  second.child.kill("SIGINT");
  await new Promise((resolve) => second.child.once("exit", resolve));
  assert.equal(existsSync(descriptor), false, "SIGINT must remove replay descriptor");
  await sleep(100);
  assert.match(readFileSync(herdrLog, "utf8"), /pane release-agent pane:test .*--agent siso/);
  console.log(JSON.stringify({ check: "replay read-only and SIGTERM/SIGINT cleanup", ok: true }));
} finally {
  for (const { socket } of running) socket?.terminate();
  for (const { child } of running) if (child.exitCode === null) child.kill("SIGTERM");
  await Promise.all(running.map(({ child }) => child.exitCode === null ? new Promise((resolve) => child.once("exit", resolve)) : Promise.resolve()));
  rmSync(scratch, { recursive: true, force: true });
}
