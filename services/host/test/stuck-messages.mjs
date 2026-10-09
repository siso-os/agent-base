// Real SDK delivery/queue probe, behind a lab node. Never uses the live herdr.
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { mkdtempSync, readdirSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import net from "node:net";
import { WebSocket } from "ws";

const REPO = path.resolve(import.meta.dirname, "../../..");
const RESEARCH = path.join(process.env.HOME, "SISO_Workspace/SISO_Agency/apps/siso-internal-labs/siso-internal-labs-agents/.agents/research/2026-10-01-agent-app");
const LAB = path.join(RESEARCH, "tests/1-clean-terminal/lab");
const scratch = realpathSync(mkdtempSync(path.join(tmpdir(), ".siso-ephemeral-sdk-stuck.")));
const lab = (...a) => execFileSync(LAB, a, { encoding: "utf8" });
const session = lab("name", "sdkstuck").trim();
const herdr = (...a) => JSON.parse(lab("run", session, ...a) || "{}");
const q = (s) => `'${s.replace(/'/g, `'\\''`)}'`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const hosts = path.join(scratch, "hosts");
const reserve = net.createServer();
await new Promise((r) => reserve.listen(0, "127.0.0.1", r));
const PORT = reserve.address().port;
await new Promise((r) => reserve.close(r));
const env = { ...process.env, AB_PORT: String(PORT), AB_HERDR: `${LAB} run ${session}`, AB_HOSTS_DIR: hosts, AB_UPLOADS: path.join(scratch, "uploads"), AB_STATE: path.join(scratch, "rows.json"), AB_REGISTRY: path.join(scratch, "registry.json"), AB_CTX_DIR: path.join(scratch, "ctx"), AB_CONSOLE_EVENTS: path.join(scratch, "none"), AB_RESURRECT_DIR: path.join(scratch, "none") };
let node, socket;
const events = [];
const wait = async (name, predicate, ms = 120000) => {
  const until = Date.now() + ms;
  while (!predicate()) {
    const limited = events.find((e) => ["text", "note"].includes(e.t) && /hit your.*limit/i.test(e.text ?? ""));
    if (limited) {
      console.log(JSON.stringify({ check: name, ok: false, status: "BLOCKED", reason: limited.text }));
      throw new Error("Claude quota blocks the model-backed check");
    }
    if (Date.now() >= until) {
      // Event types, queue text and notes are our own lab's inputs only.
      console.log(JSON.stringify({ check: name, ok: false, events: events.map((e) => ({ t: e.t, state: e.state, text: e.t === "note" ? e.text : undefined })) }));
      throw new Error(`${name} timed out`);
    }
    await sleep(100);
  }
  console.log(JSON.stringify({ check: name, ok: true }));
};
const textSeen = (token) => events.some((e) => e.t === "text" && e.text.includes(token));
const connect = async (id) => {
  socket = new WebSocket(`ws://127.0.0.1:${PORT}/chat/${id}/ws`, { origin: `http://127.0.0.1:${PORT}` });
  socket.on("message", (raw) => {
    const e = JSON.parse(String(raw));
    if (e.t === "hello") events.push(...e.log);
    events.push(e);
  });
  await new Promise((resolve, reject) => { socket.once("message", resolve); socket.once("error", reject); });
};
try {
  lab("provision", session);
  herdr("workspace", "create", "--label", "lab", "--no-focus", "--cwd", scratch);
  herdr("pane", "run", "w1:p1", `cd ${q(scratch)} && AB_HOSTS_DIR=${q(hosts)} ${q(path.join(REPO, "services/host/bin/siso-host"))} --name SDK-STUCK --model haiku --permission-mode bypassPermissions`);
  await wait("lab SDK host starts", () => { try { return readdirSync(hosts).length > 0; } catch { return false; } }, 30000);
  node = spawn(process.execPath, ["--experimental-strip-types", "--no-warnings", "src/server.ts"], { cwd: path.join(REPO, "services/node"), env, stdio: "ignore" });
  let agent;
  for (let i = 0; i < 60 && !agent?.host; i++) {
    await sleep(500);
    assert.equal(node.exitCode, null, "lab node must own its port");
    try { agent = (await (await fetch(`http://127.0.0.1:${PORT}/api/agents`)).json()).agents.find((a) => a.host && a.name === "SDK-STUCK" && a.cwd === scratch); } catch {}
  }
  assert.ok(agent?.host);
  assert.equal(agent.pane, "w1:p1");
  await connect(agent.id);
  socket.send(JSON.stringify({ t: "prompt", text: "No tools. Reply exactly SDK-IDLE-OK." }));
  await wait("SDK idle prompt answered", () => textSeen("SDK-IDLE-OK"));
  await wait("SDK idle turn ends", () => events.at(-1)?.t === "state" && events.at(-1).state === "idle");
  events.length = 0;
  socket.send(JSON.stringify({ t: "prompt", text: "No tools. Reply exactly SDK-FIRST." }));
  socket.send(JSON.stringify({ t: "prompt", text: "Also reply exactly SDK-SECOND." }));
  await wait("SDK two quick sends are both taken", () => ["SDK-FIRST", "SDK-SECOND"].every((s) => events.some((e) => e.t === "user" && e.text.includes(s))));
  await wait("SDK quick second send answered", () => textSeen("SDK-SECOND"));
  await wait("SDK quick turns end", () => events.at(-1)?.t === "state" && events.at(-1).state === "idle");
  events.length = 0;
  const long = `Ignore the padding: ${"word ".repeat(1200)}\nNo tools. Reply exactly SDK-LONG-OK.`;
  socket.send(JSON.stringify({ t: "prompt", text: long }));
  await wait("SDK long paste arrives whole", () => events.some((e) => e.t === "user" && e.text === long));
  await wait("SDK long paste answered", () => textSeen("SDK-LONG-OK"));
  await wait("SDK long turn ends", () => events.at(-1)?.t === "state" && events.at(-1).state === "idle");
  events.length = 0;
  socket.send(JSON.stringify({ t: "prompt", text: "Use Bash to run `sleep 8; echo READY`. Then reply with one short sentence." }));
  await wait("SDK mid-turn tool starts", () => events.some((e) => e.t === "tool"));
  socket.send(JSON.stringify({ t: "prompt", text: "End your final reply with SDK-RESTART-OK." }));
  await wait("SDK mid-turn message queued", () => events.some((e) => e.t === "queued"));
  socket.terminate();
  node.kill("SIGTERM");
  await new Promise((r) => node.once("exit", r));
  node = spawn(process.execPath, ["--experimental-strip-types", "--no-warnings", "src/server.ts"], { cwd: path.join(REPO, "services/node"), env, stdio: "ignore" });
  await sleep(1000);
  await fetch(`http://127.0.0.1:${PORT}/api/agents`);
  await connect(agent.id);
  await wait("SDK queued message survives node restart and is taken", () => events.some((e) => e.t === "user" && e.text.includes("SDK-RESTART-OK")));
  await wait("SDK queued message answered after node restart", () => textSeen("SDK-RESTART-OK"));
} finally {
  socket?.terminate();
  node?.kill("SIGTERM");
  lab("teardown", session);
  rmSync(scratch, { recursive: true, force: true });
}
