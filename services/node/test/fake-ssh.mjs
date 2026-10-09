// A stand-in ssh for checks (never connects anywhere): the Servers page's probe, its logs and the token rollup read
// fixture files instead. Use as AB_SSH="node services/node/test/fake-ssh.mjs", and AB_PROBE_LOCAL="node
// services/node/test/fake-ssh.mjs --local <key>" for this node's own machine. The machine is the argument before the
// remote command (`ssh <opts> <alias> sh -s`); what to print is chosen from the script on stdin:
//   the probe (ab-probe.sh)       FAKE_SSH_DIR/<alias>.probe; <alias>.fail (a file) makes it time out instead
//   journalctl / docker logs       FAKE_SSH_DIR/<alias>.logs, plus one line per 2 s since FAKE_SSH_T0 (so follow sees news)
//   curl ... tokens-api            FAKE_SSH_DIR/<alias>.devices.json, "@@ sync", <alias>.sync.json
// FAKE_SSH_LOG gets one JSON line per call: [alias, the script's first line].
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const alias = args[0] === "--local" ? args[1] : args[args.length - 2];
const dir = process.env.FAKE_SSH_DIR ?? ".";
const file = (ext) => path.join(dir, `${alias}.${ext}`);
let script = "";
for await (const b of process.stdin) script += b;
if (process.env.FAKE_SSH_LOG) appendFileSync(process.env.FAKE_SSH_LOG, JSON.stringify([alias, script.split("\n").find((l) => l && !l.startsWith("#!")) ?? ""]) + "\n");
if (script.includes("# ab-probe")) {
  if (existsSync(file("fail"))) {
    process.stderr.write(`ssh: connect to host ${alias} port 22: Connection timed out\n`);
    process.exit(255);
  }
  process.stdout.write(existsSync(file("probe")) ? readFileSync(file("probe"), "utf8") : "");
} else if (/journalctl|docker logs|plutil/.test(script)) {
  const base = existsSync(file("logs")) ? readFileSync(file("logs"), "utf8").replace(/\n$/, "").split("\n") : [];
  const t0 = Number(process.env.FAKE_SSH_T0 || Date.now());
  const ticks = Math.floor((Date.now() - t0) / 2000);
  for (let i = 1; i <= Math.min(ticks, 50); i++) base.push(`2026-10-03T05:${String(i).padStart(2, "0")}:00+0700 ${alias} tick ${i}`);
  const n = Number(script.match(/-n (\d+)|--tail (\d+)/)?.slice(1).find(Boolean) ?? 200);
  process.stdout.write(base.slice(-n).join("\n") + "\n");
} else if (script.includes("tokens-api")) {
  process.stdout.write((existsSync(file("devices.json")) ? readFileSync(file("devices.json"), "utf8") : "[]") + "\n@@ sync\n" + (existsSync(file("sync.json")) ? readFileSync(file("sync.json"), "utf8") : "{}") + "\n");
} else {
  process.stderr.write("fake-ssh: not a command this fake knows\n");
  process.exit(1);
}
