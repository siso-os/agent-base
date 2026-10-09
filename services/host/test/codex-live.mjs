// Explicit opt-in real inference: real dev app + hosts, headless WebKit.
// heavy -- node services/host/test/codex-live.mjs <evidence-directory>
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import net from "node:net";
import path from "node:path";
import { WebSocket } from "ws";

const root = path.resolve(import.meta.dirname, "../../..");
const evidence = path.resolve(process.argv[2]);
mkdirSync(evidence, { recursive: true });
const fixture = path.join(evidence, "runtime");
const hosts = path.join(fixture, `hosts-${Date.now()}`);
mkdirSync(hosts, { recursive: true });
const receipt = [];
function check(text) { receipt.push(text); console.log(text); writeFileSync(path.join(evidence, "VERIFY.txt"), receipt.join("\n") + "\n"); }
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
async function until(fn, timeout = 30_000) { const end = Date.now() + timeout; while (Date.now() < end) { if (await fn()) return; await sleep(200); } throw Error("fixture wait timed out"); }
async function freePort() { const s = net.createServer(); await new Promise(r => s.listen(0, "127.0.0.1", r)); const p = s.address().port; await new Promise(r => s.close(r)); return p; }
const port = await freePort(), webPort = await freePort();
const api = `http://127.0.0.1:${port}`, web = `http://127.0.0.1:${webPort}`;
const env = { ...process.env, HERDR_ENV: "0", AB_HOSTS_DIR: hosts };
const processes = [];
function start(command, args, options = {}) {
  const p = spawn(command, args, { cwd: root, env, stdio: ["ignore", "pipe", "pipe"], ...options });
  let output = "";
  p.stdout.on("data", b => { output = (output + b).slice(-6000); });
  p.stderr.on("data", b => { output = (output + b).slice(-6000); });
  p.output = () => output; processes.push(p); return p;
}
async function stop(p) { if (p.exitCode !== null) return; const done = new Promise(r => p.once("exit", r)); p.kill("SIGTERM"); await done; }
const { webkit } = await import("../../node/node_modules/playwright/index.mjs");
let socket, browser, page;
async function screenshot(file, width=1440, height=900) {
  const png = await page.screenshot({path:path.join(evidence,file)});
  assert.equal(png.readUInt32BE(16),width); assert.equal(png.readUInt32BE(20),height);
  check(`${file}: PNG ${width}x${height} (${png.length} bytes)`);
}
const name = "CODEX-HOST-1-QA";
const label = `com.siso.host-${name}`;
const control = path.join(root, "services/host/bin/siso-host-service");
let installed = false;
async function service(args) {
  const p = start(control, args); await new Promise((r,j) => { p.once("exit", code => code === 0 ? r() : j(Error(p.output()))); p.once("error",j); });
}
async function snap() { return page.locator("body").innerText(); }
async function type(text) {
  await page.locator("textarea").fill(text);
  await page.locator("textarea").press("Enter");
}
async function row() { return (await (await fetch(`${api}/api/agents`)).json()).agents.find(a=>a.id===`service-${name}`); }
try {
  // Actual app backend and real herdr inventory; isolate writes and hosted chats, never attach terminals.
  start(process.execPath, ["--experimental-strip-types", "--no-warnings", "services/node/src/server.ts"], { env: {
    ...env, AB_PORT: String(port), AB_STATE: path.join(fixture,"rows.json"), AB_REGISTRY: path.join(fixture,"registry.json"),
  } });
  await until(() => fetch(`${api}/api/health`).then(r=>r.ok,()=>false));
  check(`Real node /api/health HTTP 200; dev node port ${port}; herdr is real (no fake harness)`);
  start("pnpm", ["--filter", "@agent-base/web", "dev", "--host", "127.0.0.1"], { env: { ...env, AB_NODE: String(port), AB_WEB_PORT: String(webPort) } });
  await until(() => fetch(web).then(r=>r.ok,()=>false));
  browser = await webkit.launch({headless:true}); page = await browser.newPage({viewport:{width:1440,height:900}});
  await page.routeWebSocket(/\/term\//, ws=>ws.close()); // Never attach or resize a live terminal during this test.
  await page.goto(web + "/#at=" + encodeURIComponent(JSON.stringify({s:"agents",v:{kind:"tab",id:"tasks"},a:null,o:null})));
  await page.getByTestId("zero-switch").click({timeout:60000});
  await page.getByTestId("new-codex-chat").click();
  await page.getByLabel("Codex chat name").fill(name);
  installed = true;
  await page.getByRole("button",{name:"Start Codex chat",exact:true}).click();
  await until(async()=> { const a=await row(); return a?.session && a.status==='idle'; },60000);
  await page.locator("textarea").waitFor({state:"visible",timeout:30000});
  const file=path.join(hosts,`name-${name}.json`);
  const first=JSON.parse(readFileSync(file));
  check(`App menu started launchd Codex: model=${first.model}; idle; thread=${first.session}`);
  const messages=[];
  socket=new WebSocket(`${api.replace("http","ws")}/chat/service-${name}/ws`,{headers:{Origin:api}});
  socket.on("message",raw=>messages.push(JSON.parse(String(raw))));
  await until(()=>messages.some(m=>m.t==='hello'));
  await type("Reply with exactly: Codex host ready");
  await until(()=>messages.some(m=>m.t==='result'),120000);
  assert.ok(messages.some(m=>m.t==='delta'));
  assert.ok(!messages.some(m=>m.t==='error'), 'real prompt returned an error');
  await until(async()=> (await snap()).includes('Codex host ready'));
  const idle=await row(); assert.equal(idle.status,'idle'); assert.equal(idle.hud.model,'gpt-6.1-sol'); assert.ok(idle.hud.tokensPerSecond>0); assert.ok(idle.context>0);
  check(`Composer sent prompt; Claude ChatView rendered streamed reply; row idle; model=${idle.hud.model}; ${idle.hud.tokensPerSecond} tok/s; context=${idle.context}%`);
  await screenshot("codex-chat-1440x900.png");
  await page.setViewportSize({width:390,height:844});
  await page.getByRole("button",{name:"Show or hide the side nav"}).click();
  await sleep(500); await screenshot("codex-chat-390x844.png",390,844);
  await page.setViewportSize({width:1440,height:900});
  const before=messages.length;
  await type('Use your shell tool to run printf "approval-proof\\n". Set sandbox_permissions to require_escalated and give the justification "Agent Base approval acceptance check" so I can approve it. Do not run it without that approval.');
  await until(()=>messages.slice(before).some(m=>m.t==='approval'),120000);
  await until(async()=> (await row()).status==='needs');
  await screenshot('codex-approval-1440x900.png');
  const approval=messages.slice(before).find(m=>m.t==='approval');
  await until(async()=> (await snap()).includes('Allow'));
  await page.locator('.siso-chat__ask button').filter({hasText:'Allow'}).click();
  await until(()=>messages.slice(before).some(m=>m.t==='approval_done' && m.allow),30000);
  await until(()=>messages.slice(before).some(m=>m.t==='result'),120000);
  check('Real command approval appeared in existing card; row needs-you; Allow resolved approval and turn completed');
  const next=messages.length;
  await type('Run sleep 45 in the shell, then reply with finished.');
  await until(()=>messages.slice(next).some(m=>m.t==='tool'),60000);
  await page.getByRole('button',{name:'Stop',exact:true}).click();
  await until(()=>messages.slice(next).some(m=>m.t==='note' && m.text==='Turn interrupted'),30000);
  await until(async()=> (await row()).status==='idle');
  check('Real Stop button interrupted active Codex turn; turn/completed interrupted; row returned idle');
  socket.close();
  process.kill(first.pid,'SIGKILL');
  await until(()=>{const h=JSON.parse(readFileSync(file));return h.pid!==first.pid && h.session===first.session;},30000);
  let h=JSON.parse(readFileSync(file));
  check(`Killed owned host ${first.pid}; supervised host recovered as ${h.pid}; same thread ${h.session}`);
  // Kill the runner too: this restart is specifically launchd KeepAlive rather than only the runner loop.
  const {execFileSync}=await import('node:child_process');
  const job=execFileSync('/bin/launchctl',['print',`gui/${process.getuid()}/${label}`],{encoding:'utf8'});
  const runnerPid=Number(job.match(/\bpid = (\d+)/)?.[1]); assert.ok(runnerPid>0);
  process.kill(h.pid,'SIGTERM'); await until(()=>fetch(`http://127.0.0.1:${h.port}/health`).then(()=>false,()=>true));
  process.kill(runnerPid,'SIGKILL');
  await until(()=>{const n=JSON.parse(readFileSync(file));return n.pid!==h.pid && n.session===first.session;},30000);
  const recovered=JSON.parse(readFileSync(file));
  const frames=[]; socket=new WebSocket(`${api.replace('http','ws')}/chat/service-${name}/ws`,{headers:{Origin:api}});
  socket.on('message',raw=>frames.push(JSON.parse(String(raw))));
  await until(()=>frames.some(m=>m.t==='hello'));
  assert.ok(frames.find(m=>m.t==='hello').log.some(e=>e.t==='text' && e.text.includes('Codex host ready')));
  check(`launchd KeepAlive recovered killed runner ${runnerPid}; host=${recovered.pid}; same thread; hello history contains original reply`);
  await page.reload(); await until(async()=> (await snap()).includes(name));
  await page.locator(`[data-testid="rail-row"][aria-label^="${name}"]`).click();
  await until(async()=> (await snap()).includes('Codex host ready'));
  await screenshot('codex-resumed-1440x900.png');
  check('PASS: real dev app, menu, composer, stream, responsive transcript, approval, interrupt, host/launchd recovery and history');
} finally {
  socket?.close();
  await browser?.close();
  if(installed) await service(['uninstall','--label',label,'--name',name]).catch(e=>check(`CLEANUP ERROR: ${e.message}`));
  for(const p of processes.reverse()) await stop(p);
  check('Closed task browser and stopped task dev processes; uninstalled only task-owned Codex job');
}
