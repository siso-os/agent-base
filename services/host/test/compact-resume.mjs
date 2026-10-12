// Check: after an asked-for compaction (/compact, self-compact) the host tells Claude to carry on; after an automatic
// one it does not (that turn goes on by itself); AB_RESUME_AFTER_COMPACT=0 turns it off.
//   node services/host/test/compact-resume.mjs
// Uses test/fake-claude.mjs (MANUALCOMPACT / COMPACT) and reads what reached Claude from its log. No model, no herdr.
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const HOST = path.join(import.meta.dirname, "../bin/siso-host");
const FAKE = path.join(import.meta.dirname, "fake-claude.mjs");
const scratch = realpathSync(mkdtempSync(path.join(process.env.TMPDIR ?? tmpdir(), ".siso-ephemeral-compact-resume.")));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, detail = {}) => (results.push(!!ok), console.log(JSON.stringify({ check: name, ok: !!ok, ...detail })));

async function run(label, first, env = {}) {
  const log = path.join(scratch, `${label}.log`);
  const child = spawn(HOST, ["--prompt", first], {
    cwd: scratch,
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env, CLAUDE_BIN: FAKE, FAKE_CLAUDE_LOG: log, FAKE_COMPACT_MS: "200", AB_HOSTS_DIR: path.join(scratch, "hosts"), HERDR_ENV: "0", HERDR_PANE_ID: "", HERDR_BIN_PATH: "/usr/bin/true", ...env },
  });
  await sleep(6000);
  child.kill("SIGTERM");
  await sleep(500);
  const lines = existsSync(log) ? readFileSync(log, "utf8").trim().split("\n").map((l) => JSON.parse(l)) : [];
  return JSON.stringify(lines);
}

const manual = await run("manual", "please MANUALCOMPACT now");
check("asked-for compaction: Claude is told to carry on", manual.includes("Compaction finished. Carry on"), { log: manual.slice(0, 300) });
const auto = await run("auto", "please COMPACT now");
check("automatic compaction: no extra prompt", auto.includes("COMPACT") && !auto.includes("Compaction finished"), { log: auto.slice(0, 300) });
const off = await run("off", "please MANUALCOMPACT now", { AB_RESUME_AFTER_COMPACT: "0" });
check("AB_RESUME_AFTER_COMPACT=0: no extra prompt", off.includes("MANUALCOMPACT") && !off.includes("Compaction finished"), { log: off.slice(0, 300) });
console.log(JSON.stringify({ summary: `${results.filter(Boolean).length}/${results.length} passed` }));
process.exit(results.every(Boolean) ? 0 : 1);
