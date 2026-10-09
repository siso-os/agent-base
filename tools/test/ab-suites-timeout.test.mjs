import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import net from "node:net";

const SOURCE = path.join(import.meta.dirname, "..", "ab-suites");

function run(file, args, options) {
  return new Promise((resolve) => {
    const child = spawn(file, args, options);
    let out = "", err = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("close", (status) => resolve({ status, out, err }));
  });
}

async function waitFor(pathname, timeout = 2000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (existsSync(pathname)) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error(`timed out waiting for ${pathname}`);
}

async function canBind(port) {
  const server = net.createServer();
  return new Promise((resolve) => {
    server.once("error", () => resolve(false));
    server.listen(port, "127.0.0.1", () => server.close(() => resolve(true)));
  });
}

test("ab-suites timeout terminates an ordinary child process group and closes its port", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "abs-timeout-"));
  mkdirSync(path.join(root, "tools"), { recursive: true });
  mkdirSync(path.join(root, "services/node/test"), { recursive: true });
  const suiteRoot = path.join(root, "services/node/test");
  const pidFile = path.join(root, "child.pid");
  const portFile = path.join(root, "child.port");
  writeFileSync(path.join(root, "tools/ab-suites"), readFileSync(SOURCE), { mode: 0o755 });
  writeFileSync(path.join(root, "tools/ab-queue.suites"), "leak\n");
  const childScript = `const net=require('node:net'); const s=net.createServer(); s.listen(0,'127.0.0.1',()=>{ require('node:fs').writeFileSync(${JSON.stringify(portFile)},String(s.address().port)); }); setTimeout(()=>{},10000);`;
  writeFileSync(path.join(suiteRoot, "leak.mjs"), [
    'import { spawn } from "node:child_process";',
    'import { writeFileSync } from "node:fs";',
    `const child = spawn(process.execPath, ["-e", ${JSON.stringify(childScript)}], { stdio: "ignore" });`,
    `writeFileSync(${JSON.stringify(pidFile)}, String(child.pid));`,
    'child.unref();',
    'setTimeout(() => {}, 10000);',
  ].join("\n"));
  const env = { ...process.env, AB_SUITES_LOCK: path.join(root, "lock"), AB_SUITES_TIMEOUT_S: "1", AB_SUITES_KILL_GRACE_S: "0.1" };
  let childPid;
  try {
    const result = await run(path.join(root, "tools/ab-suites"), ["--json"], { cwd: root, env });
    assert.equal(result.status, 0, result.err);
    assert.deepEqual(JSON.parse(result.out.trim().split("\n").at(-1)), { leak: { passed: 0, of: 1, exit: "timeout" } });
    await waitFor(pidFile);
    childPid = Number(readFileSync(pidFile, "utf8"));
    await waitFor(portFile);
    const port = Number(readFileSync(portFile, "utf8"));
    let alive = true;
    try { process.kill(childPid, 0); } catch { alive = false; }
    assert.equal(alive, false, `timed-out child ${childPid} is still alive`);
    assert.equal(await canBind(port), true, `timed-out child still owns port ${port}`);
  } finally {
    if (childPid) { try { process.kill(childPid, "SIGKILL"); } catch {} }
    rmSync(root, { recursive: true, force: true });
  }
});
