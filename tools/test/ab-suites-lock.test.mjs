import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

const SOURCE = path.join(import.meta.dirname, "..", "ab-suites");

function run(file, args, options) {
  return new Promise((resolve) => {
    const child = spawn(file, args, options);
    let out = "", err = "";
    const timer = setTimeout(() => child.kill("SIGKILL"), options.timeout ?? 10000);
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("close", (status) => { clearTimeout(timer); resolve({ status, out, err }); });
  });
}

async function waitFor(pathname, timeout = 3000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (existsSync(pathname)) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error(`timed out waiting for ${pathname}`);
}

function fixture(suite = "console.log(JSON.stringify({passed:1,of:1}));") {
  const root = mkdtempSync(path.join(tmpdir(), "abs-lock-"));
  mkdirSync(path.join(root, "tools"), { recursive: true });
  mkdirSync(path.join(root, "services/node/test"), { recursive: true });
  writeFileSync(path.join(root, "tools/ab-suites"), readFileSync(SOURCE), { mode: 0o755 });
  writeFileSync(path.join(root, "tools/ab-queue.suites"), "quick\n");
  writeFileSync(path.join(root, "services/node/test/quick.mjs"), suite);
  return { root, lock: path.join(root, "lock"), flock: path.join(root, "lock.flock") };
}

function env(f) { return { ...process.env, AB_SUITES_LOCK: f.lock, AB_SUITES_TIMEOUT_S: "2" }; }

test("stale legacy PID is replaced under the stable flock", async () => {
  const f = fixture();
  writeFileSync(f.lock, "\n");
  try {
    const r = await run(path.join(f.root, "tools/ab-suites"), ["--json"], { cwd: f.root, env: env(f) });
    assert.equal(r.status, 0, r.err);
    assert.deepEqual(JSON.parse(r.out.trim().split("\n").at(-1)), { quick: { passed: 1, of: 1, exit: 0 } });
    assert.equal(existsSync(f.flock), true, "stable flock inode remains");
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

test("a live legacy PID holder is waited out by the flock-aware CLI", async () => {
  const f = fixture();
  let legacy;
  try {
    legacy = spawn(process.execPath, ["-e", "setTimeout(() => {}, 500)"]);
    writeFileSync(f.lock, `${legacy.pid}\n`);
    const started = Date.now();
    const result = await run(path.join(f.root, "tools/ab-suites"), ["--json"], { cwd: f.root, env: env(f) });
    assert.equal(result.status, 0, result.err);
    assert.ok(Date.now() - started >= 300, "new runner did not wait for the live legacy holder");
  } finally {
    if (legacy && legacy.exitCode === null) legacy.kill("SIGKILL");
    if (legacy && legacy.exitCode === null) await new Promise((resolve) => legacy.once("close", resolve));
    rmSync(f.root, { recursive: true, force: true });
  }
});

// Load the real tool's lock function without starting any suite subprocess.
const holderCode = `
import os, pathlib, runpy, sys, time
m = runpy.run_path(sys.argv[1])
m['take_lock']()
pathlib.Path(sys.argv[2]).write_text(str(os.getpid()))
try:
    while not pathlib.Path(sys.argv[3]).exists(): time.sleep(.01)
finally:
    try: os.remove(m['LOCK'])
    except FileNotFoundError: pass
    fd = m['take_lock'].__globals__.get('SUITE_FLOCK_FD')
    if fd is not None: fd.close()
`;
const closed = (child) => child.exitCode !== null || child.signalCode !== null ? Promise.resolve() : new Promise((r) => child.once("close", r));

for (const killed of [false, true]) {
  test(`flock serializes contenders and releases after ${killed ? "SIGKILL" : "normal exit"}`, async () => {
    const f = fixture();
    const children = [];
    const start = (label) => {
      const ready = path.join(f.root, `${label}.ready`), release = path.join(f.root, `${label}.release`);
      const child = spawn("python3", ["-u", "-c", holderCode, path.join(f.root, "tools/ab-suites"), ready, release], { env: env(f), stdio: "ignore", timeout: 8000, killSignal: "SIGKILL" });
      children.push(child);
      return { child, ready, release };
    };
    try {
      const owner = start("owner");
      await waitFor(owner.ready);
      const contender = start("contender");
      await new Promise((r) => setTimeout(r, 150));
      assert.equal(existsSync(contender.ready), false, "contender must not acquire while owner holds flock");
      const ownerClosed = closed(owner.child);
      if (killed) owner.child.kill("SIGKILL");
      else writeFileSync(owner.release, "release");
      await ownerClosed;
      await waitFor(contender.ready, 4500); // legacy PID polling sleeps up to three seconds
      writeFileSync(contender.release, "release");
      await closed(contender.child);
      assert.equal(contender.child.exitCode, 0);
      assert.equal(existsSync(f.flock), true, "the authoritative lock inode stays in place");
    } finally {
      for (const child of children) if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
      await Promise.all(children.map(closed));
      rmSync(f.root, { recursive: true, force: true });
    }
  });
}
