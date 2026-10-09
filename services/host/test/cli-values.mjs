import test from "node:test";
import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

const HOST = path.join(import.meta.dirname, "../bin/siso-host");

function run(hostArgs, env) {
  return new Promise((resolve) => {
    const child = spawn(HOST, hostArgs, { env, stdio: ["ignore", "pipe", "pipe"], timeout: 5000, killSignal: "SIGKILL" });
    let out = "", err = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("close", (status) => resolve({ status, out, err }));
  });
}

test("value flags reject missing and option-shaped values before startup side effects", async () => {
  const scratch = mkdtempSync(path.join(tmpdir(), "siso-host-values-"));
  const fakeBin = path.join(scratch, "bin");
  const hosts = path.join(scratch, "hosts");
  const securityCalls = path.join(scratch, "security.calls");
  const herdrCalls = path.join(scratch, "herdr.calls");
  mkdirSync(fakeBin); mkdirSync(hosts);
  writeFileSync(path.join(fakeBin, "security"), `#!/bin/sh\necho called >> ${securityCalls}\nexit 99\n`);
  writeFileSync(path.join(fakeBin, "herdr"), `#!/bin/sh\necho called >> ${herdrCalls}\nexit 0\n`);
  chmodSync(path.join(fakeBin, "security"), 0o755); chmodSync(path.join(fakeBin, "herdr"), 0o755);
  const loader = path.join(scratch, "sdk-loader.mjs");
  writeFileSync(loader, `export async function resolve(s,c,n){if(s==='@anthropic-ai/claude-agent-sdk')return {url:'data:text/javascript,export const query=()=>{throw new Error("query called")};export const getSessionMessages=()=>{throw new Error("messages called")}',shortCircuit:true};return n(s,c)}\n`);
  const baseEnv = { ...process.env, HOME: scratch, PATH: `${fakeBin}:${process.env.PATH}`, HERDR_ENV: "1", HERDR_PANE_ID: "pane:fixture", HERDR_BIN_PATH: path.join(fakeBin, "herdr"), AB_HOSTS_DIR: hosts, NODE_OPTIONS: `--experimental-loader=${loader}` };
  const cases = [["--model"], ["--prompt", "--keep-herdr-env"], ["--account", "--no-stack"], ["--effort", "-h"]];
  try {
    for (const args of cases) {
      const result = await run(args, baseEnv);
      assert.equal(result.status, 2, `${args.join(" ")} exited ${result.status}: ${result.err}`);
      assert.match(result.err, /requires a value/);
    }
    assert.equal(existsSync(securityCalls), false, "security must not run");
    assert.equal(existsSync(herdrCalls), false, "herdr must not run");
    assert.deepEqual((await import("node:fs")).readdirSync(hosts), []);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});
