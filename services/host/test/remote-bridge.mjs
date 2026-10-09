// Check: ab-remote's bridge makes a host on another machine look like a local pane-less host to the app, without the app
// changing. node services/host/test/remote-bridge.mjs
// A fake ssh runs the "remote" side here (HOME = a scratch remote home) and does -W with a plain TCP connect; the "remote host"
// is a TCP echo server with a host record. The app's own reader (services/node/src/service-hosts.ts) must call the mirror
// live. Prints one JSON line per check and exits 1 if any failed.
import { spawn } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import http from "node:http";
import net from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { readServiceHosts } from "../../node/src/service-hosts.ts";

const scratch = mkdtempSync(path.join(process.env.TMPDIR ?? tmpdir(), ".siso-ephemeral-remote-bridge."));
const local = path.join(scratch, "local-hosts"), state = path.join(scratch, "state"), rhome = path.join(scratch, "remote-home");
const rhosts = path.join(rhome, ".local/state/agent-base/hosts");
mkdirSync(local, { recursive: true }); mkdirSync(rhosts, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, detail = {}) => { results.push(!!ok); console.log(JSON.stringify({ check: name, ok: !!ok, ...detail })); };
const until = async (fn, ms = 8000) => { const end = Date.now() + ms; while (Date.now() < end) { const v = fn(); if (v) return v; await sleep(100); } return null; };

const fakeSsh = path.join(scratch, "ssh");
writeFileSync(fakeSsh, `#!/usr/bin/env node
const { spawn } = require("node:child_process"), net = require("node:net");
const a = process.argv.slice(2); let i = 0;
while (a[i] === "-o") i += 2;
i++; // the alias
if (a[i] === "-W") { const [h, p] = a[i + 1].split(":"); const s = net.connect(Number(p), h); process.stdin.pipe(s); s.pipe(process.stdout); s.on("close", () => process.exit(0)); s.on("error", () => process.exit(1)); }
else { const c = spawn("sh", ["-c", a[i]], { stdio: "inherit", env: { ...process.env, HOME: process.env.FAKE_REMOTE_HOME, AB_HOSTS_DIR: "" } }); c.on("exit", (code) => process.exit(code ?? 0)); }
`);
chmodSync(fakeSsh, 0o755);

const echo = net.createServer((s) => s.on("data", (d) => s.write("ECHO:" + d)));
await new Promise((r) => echo.listen(0, "127.0.0.1", r));
const rec = { pid: process.pid, port: echo.address().port, token: "tok", name: "REMOTE-TEST", session: "s-1", pane: "w1:p1", state: "idle", child: "running", model: "claude-opus-5-5[1m]", activityJournal: "/nowhere", ctx: { used: 1000, window: 1000000, pct: 0, at: Date.now() } };
const rfile = path.join(rhosts, "w1_p1.json");
writeFileSync(rfile, JSON.stringify(rec));

const bridge = spawn(process.execPath, ["--experimental-strip-types", "--no-warnings", path.join(import.meta.dirname, "../src/remote.ts"), "bridge"], {
  env: { ...process.env, AB_HOSTS_DIR: local, AB_REMOTE_STATE: state, AB_REMOTE_SSH: fakeSsh, AB_REMOTE_MACHINES: JSON.stringify({ mini: { ssh: "fake" } }), FAKE_REMOTE_HOME: rhome },
  stdio: ["ignore", "pipe", "pipe"],
});
let blog = ""; bridge.stdout.on("data", (d) => (blog += d)); bridge.stderr.on("data", (d) => (blog += d));
try {
  const mfile = path.join(local, `remote-mini-${process.pid}.json`);
  const m = await until(() => existsSync(mfile) && JSON.parse(readFileSync(mfile, "utf8")));
  if (!m) throw new Error("no mirror");
  check("mirror written", m && m.pid === bridge.pid && m.pane === null && m.remote?.pid === process.pid && m.remote?.pane === "w1:p1" && m.token === "tok" && !("activityJournal" in m) && m.machine === "mini", { mirror: m && { pid: m.pid, pane: m.pane, remote: m.remote } });
  const health = await new Promise((res) => http.get({ host: "127.0.0.1", port: m.port, path: "/health" }, (r) => { let b = ""; r.on("data", (d) => (b += d)); r.on("end", () => res(JSON.parse(b))); }).on("error", () => res(null)));
  check("/health answers as the bridge", health?.pid === bridge.pid && health?.remote?.pid === process.pid, { health });
  const reply = await new Promise((res) => { const s = net.connect(m.port, "127.0.0.1", () => s.write("hello")); let b = ""; s.on("data", (d) => { b += d; if (b.includes("hello")) { s.destroy(); res(b); } }); s.on("error", () => res(null)); setTimeout(() => res(b), 4000); });
  check("bytes reach the remote host and back", reply === "ECHO:hello", { reply });
  const { hosts } = await readServiceHosts({ dir: local, launchdLoaded: () => false });
  const seen = hosts.find((h) => h.name === "REMOTE-TEST");
  check("the app's reader calls it live and pane-less", seen?.state === "live" && seen.pane === null && seen.session === "s-1", { state: seen?.state });
  writeFileSync(rfile, JSON.stringify({ ...rec, state: "working" }));
  check("updates follow", !!(await until(() => existsSync(mfile) && JSON.parse(readFileSync(mfile, "utf8")).state === "working")));
  unlinkSync(rfile);
  check("a host that ends leaves", !!(await until(() => !existsSync(mfile))));
  writeFileSync(rfile, JSON.stringify(rec));
  await until(() => existsSync(mfile));
  bridge.kill("SIGTERM");
  check("the bridge clears its mirrors on stop", !!(await until(() => !existsSync(mfile))));
} finally {
  bridge.kill("SIGKILL"); echo.close();
  if (results.includes(false)) console.log(blog.slice(-1500));
  rmSync(scratch, { recursive: true, force: true });
}
process.exit(results.every(Boolean) && results.length === 7 ? 0 : 1);
