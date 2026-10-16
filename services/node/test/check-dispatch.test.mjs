import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const runner = path.join(root, "services/node/test/check.mjs");
const temp = mkdtempSync(path.join(os.tmpdir(), "check-dispatch."));
const preload = path.join(temp, "intercept.mjs");
const records = path.join(temp, "records.jsonl");
const nodePath = process.execPath;
writeFileSync(preload, `
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { createHash } from 'node:crypto';
import { appendFileSync } from 'node:fs';
const envHash = (env) => { const hash = createHash('sha256'); for (const [key, value] of Object.entries(env).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) { if (key === 'PATH') continue; hash.update(String(key.length)).update(':').update(key).update(String(value.length)).update(':').update(value).update(';'); } return hash.digest('hex'); };
const original = childProcess.spawnSync;
childProcess.spawnSync = (command, args = [], options = {}) => {
  const env = options.env ?? process.env;
  if (command === 'pnpm' || command === 'pnpm.cmd') {
    if (args[0] === 'exec' && args[1] === 'node' && args[2] === '-e') {
      const mode = process.env.CHECK_DISPATCH_MODE;
      const output = mode === 'probe-failed' ? 'probe-secret-sentinel' : JSON.stringify({
        execPath: mode === 'probe-invalid' ? '/tmp/not-node' : (process.env.CHECK_DISPATCH_NODE_PATH || process.execPath),
        envDigest: mode === 'probe-mismatch' ? '0'.repeat(64) : envHash(env),
        path: '/probe-prepended/.bin:' + env.PATH,
      });
      appendFileSync(process.env.CHECK_DISPATCH_RECORDS, JSON.stringify({ kind: 'probe', cwd: options.cwd }) + '\\n');
      return mode === 'probe-failed'
        ? { pid: 1, output: ['', 'probe-secret-sentinel', ''], stdout: 'probe-secret-sentinel', stderr: '', status: 19, signal: null }
        : { pid: 1, output: ['', output, ''], stdout: output, stderr: '', status: 0, signal: null };
    }
  }
  const row = { kind: 'check', command, args, cwd: options.cwd, path: env.PATH, fixture: Object.fromEntries(Object.entries(env).filter(([key]) => key.startsWith('AB_') || key === 'LIBRARY_TEST_ROOT')) };
  appendFileSync(process.env.CHECK_DISPATCH_RECORDS, JSON.stringify(row) + '\\n');
  const scenario = process.env.CHECK_DISPATCH_MODE;
  if (scenario === 'fail-first' && row.kind === 'check' && !process.env.CHECK_DISPATCH_FAILED) {
    process.env.CHECK_DISPATCH_FAILED = '1';
    return { pid: 1, output: ['', '', ''], stdout: '', stderr: '', status: 19, signal: null };
  }
  if (scenario === 'spawn-error' && row.kind === 'check' && !process.env.CHECK_DISPATCH_FAILED) {
    process.env.CHECK_DISPATCH_FAILED = '1';
    return { pid: 1, output: ['', '', ''], stdout: '', stderr: '', status: null, signal: null, error: new Error('synthetic spawn failure') };
  }
  if (scenario === 'fail-fixture' && row.args.some((arg) => arg.includes('browser-visibility.mjs'))) {
    return { pid: 1, output: ['', '', ''], stdout: '', stderr: '', status: 19, signal: null };
  }
  return { pid: 1, output: ['', '', ''], stdout: '', stderr: '', status: 0, signal: null };
};
syncBuiltinESMExports();
`);

function run(mode = "qualify", { lab = false } = {}) {
  rmSync(records, { force: true });
  const env = {
    ...process.env,
    CHECK_DISPATCH_MODE: mode,
    CHECK_DISPATCH_NODE_PATH: nodePath,
    CHECK_DISPATCH_RECORDS: records,
    ...(lab ? { CHECK_LAB: "1" } : { CHECK_LAB: "0" }),
  };
  const result = spawnSync(process.execPath, ["--import", preload, runner], {
    cwd: root, env, encoding: "utf8", maxBuffer: 2 * 1024 * 1024,
  });
  const rows = readFileSync(records, "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
  return { result, rows };
}

test.after(() => rmSync(temp, { recursive: true, force: true }));

test("qualified Node commands run directly while non-Node pnpm commands retain their arguments", () => {
  const { result, rows } = run();
  assert.equal(result.status, 0, result.stderr);
  assert.equal(rows[0].kind, "probe");
  const checks = rows.filter((row) => row.kind === "check");
  const direct = checks.filter((row) => row.command === nodePath);
  const wrapped = checks.filter((row) => row.command === "pnpm");
  assert.ok(direct.some((row) => row.args.includes("services/node/test/model-accounts.mjs")));
  assert.ok(direct.every((row) => !row.args.includes("exec")));
  assert.ok(direct.every((row) => row.path.startsWith("/probe-prepended/.bin:")), "direct dispatch keeps the PATH that pnpm exec would have given the child");
  assert.ok(wrapped.some((row) => row.args[0] === "--filter" && row.args.includes("tsc")));
  assert.ok(wrapped.some((row) => row.args[0] === "dlx" && row.args.includes("vitest@3.2.4")));
  assert.ok(wrapped.some((row) => row.args.includes("python3")));
});

test("invalid metadata, mismatched environment, and failed probe keep every check on pnpm", () => {
  for (const mode of ["probe-invalid", "probe-mismatch", "probe-failed"]) {
    const { result, rows } = run(mode);
    assert.equal(result.status, 0, `${mode}: ${result.stderr}`);
    const checks = rows.filter((row) => row.kind === "check");
    assert.ok(checks.length > 0);
    assert.ok(checks.every((row) => row.command === "pnpm"), mode);
    assert.ok(!result.stdout.includes("probe-secret-sentinel"));
    assert.ok(!result.stderr.includes("probe-secret-sentinel"));
  }
});

test("a check exit 19 stops the plan before Vite or later checks", () => {
  const { result, rows } = run("fail-first");
  assert.equal(result.status, 19);
  const checks = rows.filter((row) => row.kind === "check");
  assert.equal(checks.length, 1);
  assert.ok(!checks.some((row) => row.args.includes("vite")));
});

test("spawn errors remain fail-closed", () => {
  const { result, rows } = run("spawn-error");
  assert.equal(result.status, 1);
  assert.match(result.stderr, /could not start/);
  assert.equal(rows.filter((row) => row.kind === "check").length, 1);
});

test("scratch fixture paths are passed through and removed after pass and failure", () => {
  for (const mode of ["qualify", "fail-fixture"]) {
    const { result, rows } = run(mode);
    const fixtureRow = rows.find((row) => row.kind === "check" && row.args.some((arg) => arg.includes("browser-visibility.mjs")));
    assert.ok(fixtureRow, `browser fixture dispatched in ${mode}`);
    const scratch = fixtureRow.fixture.AB_BROWSER_TEST_TMP;
    assert.ok(scratch);
    assert.equal(result.status, mode === "qualify" ? 0 : 19);
    assert.equal(existsSync(scratch), false);
  }
});

test("the full plan preserves all 85 normal checks and four optional lab checks", () => {
  const normal = run("probe-mismatch");
  const lab = run("probe-mismatch", { lab: true });
  const normalChecks = normal.rows.filter((row) => row.kind === "check");
  const labChecks = lab.rows.filter((row) => row.kind === "check");
  assert.equal(normalChecks.length, 86); // original 85 plus this regression
  assert.equal(labChecks.length, 90); // original 85 plus this regression and four lab rows
  for (const title of ["rows-survive.mjs", "tabs-hud.mjs", "terminal-chat.mjs", "chat-lab.mjs"]) {
    assert.ok(labChecks.some((row) => row.args.some((arg) => arg.includes(title))), title);
  }
});
