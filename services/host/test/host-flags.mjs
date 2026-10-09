// Check (R1.18): siso-host hands Agent Zero's launch flags to the claude it spawns, without a model call.
//   node services/host/test/host-flags.mjs
// A fake `claude` (CLAUDE_BIN) writes the argv and env it was started with and waits; a fake `herdr` (HERDR_BIN_PATH)
// logs what the host reports, so no real pane, herdr session or model is touched. Prints one JSON line per check and
// exits 1 if any failed.
import { spawn } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const HOST = path.join(import.meta.dirname, "../bin/siso-host");
const scratch = mkdtempSync(path.join(process.env.TMPDIR ?? tmpdir(), ".siso-ephemeral-host-flags."));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, detail = {}) => {
  results.push(!!ok);
  console.log(JSON.stringify({ check: name, ok: !!ok, ...detail }));
};

const fakeClaude = path.join(scratch, "claude");
writeFileSync(
  fakeClaude,
  `#!/usr/bin/env node
const fs = require("node:fs");
const pick = ["HERDR_ENV", "HERDR_PANE_ID", "FAKE_MARK", "CLAUDE_CONFIG_DIR", "SISO_ACCOUNT", "CLAUDE_AUTOCOMPACT_PCT_OVERRIDE"];
const env = Object.fromEntries(pick.map((k) => [k, process.env[k] ?? null]));
env.TOKEN = process.env.CLAUDE_CODE_OAUTH_TOKEN ? (process.env.CLAUDE_CODE_OAUTH_TOKEN === "tok-fuze" ? "the fuzeheritage token" : "another") : null;
fs.writeFileSync(process.env.FAKE_CLAUDE_OUT, JSON.stringify({ argv: process.argv.slice(2), env }));
process.stdin.resume();
setTimeout(() => process.exit(0), 20000);
`,
);
chmodSync(fakeClaude, 0o755);
const fakeHerdr = path.join(scratch, "herdr");
writeFileSync(fakeHerdr, `#!/bin/sh\necho "$*" >> "${path.join(scratch, "herdr.log")}"\n`);
chmodSync(fakeHerdr, 0o755);
// A fake `security`: a long-lived token for fuzeheritage only (claude-token-login's Keychain item).
const fakeBin = path.join(scratch, "bin");
mkdirSync(fakeBin);
writeFileSync(path.join(fakeBin, "security"), `#!/bin/sh\ncase "$*" in *"-s siso-claude-oauth -a fuzeheritage"*) echo tok-fuze ;; *) exit 44 ;; esac\n`);
chmodSync(path.join(fakeBin, "security"), 0o755);
const work = path.join(realpathSync(scratch), "work"); // the host sees /private/var…, not /var…
mkdirSync(path.join(work, ".claude"), { recursive: true });
writeFileSync(path.join(work, ".claude/agent-boot.json"), JSON.stringify({ hooks: {} }));

/** Starts the host with these args, waits for the fake claude's record, stops the host. */
async function run(label, hostArgs, env = {}) {
  const out = path.join(scratch, `${label}.json`);
  const child = spawn(HOST, hostArgs, {
    cwd: work,
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env, CLAUDE_BIN: fakeClaude, FAKE_CLAUDE_OUT: out, HERDR_BIN_PATH: fakeHerdr, AB_HOSTS_DIR: path.join(scratch, "hosts"), FAKE_MARK: "kept", HERDR_ENV: "0", HERDR_PANE_ID: "", ...env },
  });
  let err = "";
  child.stderr.on("data", (d) => (err += d));
  for (let i = 0; i < 100 && !existsSync(out); i++) await sleep(100);
  child.kill("SIGKILL");
  if (!existsSync(out)) return { argv: [], env: {}, err: err.slice(-400) };
  await sleep(50);
  return JSON.parse(readFileSync(out, "utf8"));
}
const after = (argv, flag) => {
  const i = argv.indexOf(flag);
  return i >= 0 ? argv[i + 1] : undefined;
};

try {
  // 1. Defaults unchanged: in a herdr pane the child still gets HERDR_ENV=0 and no name or settings of ours.
  const plain = await run("plain", [], { HERDR_ENV: "1", HERDR_PANE_ID: "w9:pfake", CLAUDE_AUTOCOMPACT_PCT_OVERRIDE: undefined });
  check("spawned the fake claude", plain.argv.length > 0, plain.err ? { err: plain.err } : {});
  check("default: child HERDR_ENV=0", plain.env.HERDR_ENV === "0", { env: plain.env });
  check("default: no --settings, no --name", !plain.argv.includes("--settings") && !plain.argv.includes("--name"), { argv: plain.argv });
  check("other env still passes through", plain.env.FAKE_MARK === "kept");
  check("default: child auto-compacts at 30%", plain.env.CLAUDE_AUTOCOMPACT_PCT_OVERRIDE === "30", { env: plain.env });

  // 2. Agent Zero's launch: named, its agent-boot settings, herdr's env left alone.
  const a0 = await run("a0", ["--name", "A0-SDK", "--settings", ".claude/agent-boot.json", "--keep-herdr-env"], { HERDR_ENV: "1", HERDR_PANE_ID: "w9:pfake" });
  check("--name reaches claude as --name (-n)", after(a0.argv, "--name") === "A0-SDK", { argv: a0.argv });
  check("--settings reaches claude, path made absolute", after(a0.argv, "--settings") === path.join(work, ".claude/agent-boot.json"), { settings: after(a0.argv, "--settings") });
  const set = await run("compact-set", [], { CLAUDE_AUTOCOMPACT_PCT_OVERRIDE: "45" });
  check("a launcher's own compact percent wins", set.env.CLAUDE_AUTOCOMPACT_PCT_OVERRIDE === "45", { env: set.env });
  check("--keep-herdr-env: child keeps HERDR_ENV=1 and its pane id", a0.env.HERDR_ENV === "1" && a0.env.HERDR_PANE_ID === "w9:pfake", { env: a0.env });
  check("settingSources still user,project,local", a0.argv.includes("--setting-sources=user,project,local"));
  const reported = existsSync(path.join(scratch, "herdr.log")) ? readFileSync(path.join(scratch, "herdr.log"), "utf8") : "";
  check("host still reports itself to herdr as siso", /pane report-agent w9:pfake .*--agent siso/.test(reported), { log: reported.split("\n")[0] });

  // 3. Edge: --keep-herdr-env outside herdr changes nothing (no HERDR_ENV to keep, and nothing reported).
  const outside = await run("outside", ["--keep-herdr-env", "--name", "x y"], { HERDR_ENV: "", HERDR_PANE_ID: "" });
  check("outside herdr: child HERDR_ENV empty, name with a space intact", (outside.env.HERDR_ENV ?? "") === "" && after(outside.argv, "--name") === "x y", { env: outside.env, name: after(outside.argv, "--name") });

  // 4. One config home (native-agents step 4): --account runs on that account's token in ~/.claude, never a folder login.
  const PATHX = `${fakeBin}:${process.env.PATH}`;
  const acct = await run("acct", ["--account", "fuzeheritage"], { PATH: PATHX, CLAUDE_CONFIG_DIR: "/somewhere/.claude-siso", CLAUDE_CODE_OAUTH_TOKEN: "" });
  check("--account: the child gets that account's token and no CLAUDE_CONFIG_DIR", acct.env.TOKEN === "the fuzeheritage token" && acct.env.CLAUDE_CONFIG_DIR === null && acct.env.SISO_ACCOUNT === "fuzeheritage", { env: acct.env });
  const none = spawn(HOST, ["--account", "lordsisodia"], { cwd: work, env: { ...process.env, PATH: PATHX, CLAUDE_BIN: fakeClaude, FAKE_CLAUDE_OUT: path.join(scratch, "none.json"), HERDR_BIN_PATH: fakeHerdr, AB_HOSTS_DIR: path.join(scratch, "hosts") } });
  let noneErr = "";
  none.stderr.on("data", (d) => (noneErr += d));
  const code = await new Promise((r) => none.on("close", r));
  check("--account with no token: exit 3, claude never started", code === 3 && !existsSync(path.join(scratch, "none.json")) && /claude-token-login lordsisodia/.test(noneErr), { code, err: noneErr.trim() });

  // 5. The stack plugin (step 2) loads by default; --no-stack leaves it out.
  const stack = path.resolve(import.meta.dirname, "../../../stack/plugin");
  check("stack plugin passed to claude by default", plain.argv.join(" ").includes(stack), { argv: plain.argv.filter((a) => a.includes("plugin")) });
  const nostack = await run("nostack", ["--no-stack"]);
  check("--no-stack: no plugin", !nostack.argv.join(" ").includes(stack));
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
const failed = results.filter((r) => !r).length;
console.log(JSON.stringify({ summary: `${results.length - failed}/${results.length} passed` }));
process.exit(failed ? 1 : 0);
