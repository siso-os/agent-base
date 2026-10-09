import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

const HOST = path.join(import.meta.dirname, "../bin/siso-host");

function waitForClose(child, timeout = 3000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { child.kill("SIGKILL"); reject(new Error("host did not exit")); }, timeout);
    child.once("close", (status, signal) => { clearTimeout(timer); resolve({ status, signal }); });
  });
}

test("SIGTERM closes the SDK query once and removes the host descriptor", async () => {
  const scratch = mkdtempSync(path.join(tmpdir(), "siso-host-shutdown-"));
  const hosts = path.join(scratch, "hosts");
  const marker = path.join(scratch, "query.closed");
  mkdirSync(hosts);
  const loader = path.join(scratch, "sdk-loader.mjs");
  writeFileSync(loader, `
    export async function resolve(s, c, n) {
      if (s === "@anthropic-ai/claude-agent-sdk") return { url: "data:text/javascript," + encodeURIComponent(
        'import { writeFileSync, readFileSync } from "node:fs"; export const getSessionMessages = async () => { throw new Error("history called"); }; export const query = () => ({ supportedCommands: () => Promise.resolve([]), close: () => { const p = process.env.CLOSE_MARKER; let n = 0; try { n = Number(readFileSync(p, "utf8")); } catch {} writeFileSync(p, String(n + 1)); }, async *[Symbol.asyncIterator]() { await new Promise(() => {}); } });'
      ), shortCircuit: true };
      return n(s, c);
    }
  `);
  const env = { ...process.env, HOME: scratch, AB_HOSTS_DIR: hosts, CLOSE_MARKER: marker, HERDR_ENV: "0", NODE_OPTIONS: `--experimental-loader=${loader}` };
  let child;
  try {
    child = spawn(HOST, ["--no-stack"], { cwd: scratch, env, stdio: ["ignore", "pipe", "pipe"] });
    let descriptor;
    for (let i = 0; i < 100 && !descriptor; i++) {
      const files = readdirSync(hosts);
      if (files.length) descriptor = path.join(hosts, files[0]);
      else await new Promise((r) => setTimeout(r, 20));
    }
    assert.ok(descriptor, "host descriptor was not created");
    child.kill("SIGTERM");
    try { child.kill("SIGTERM"); } catch {}
    const exit = await waitForClose(child);
    assert.equal(exit.status, 0);
    assert.equal(readFileSync(marker, "utf8"), "1", "query.close must run exactly once");
    assert.equal(existsSync(descriptor), false, "shutdown must remove the descriptor");
  } finally {
    if (child && child.exitCode === null && child.signalCode === null) {
      const ended = new Promise((resolve) => child.once("close", resolve));
      child.kill("SIGKILL");
      await ended;
    }
    rmSync(scratch, { recursive: true, force: true });
  }
});
