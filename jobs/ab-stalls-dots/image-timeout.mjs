// Failed uploads retain the requested message; retry/remove needs a fresh explicit Send.
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { webkit } from '../../services/node/test/suite-runtime.mjs';

const REPO = path.join(import.meta.dirname, "../.."); const reserve = createServer();
await new Promise((resolve, reject) => reserve.once("error", reject).listen(0, "127.0.0.1", resolve)); const PORT = reserve.address().port; await new Promise((resolve) => reserve.close(resolve)); const BASE = `http://127.0.0.1:${PORT}`;
mkdirSync(path.join(REPO, "jobs/ab-stalls-dots/image-fixture/tmp"), { recursive: true });
const scratch = mkdtempSync(path.join(REPO, "jobs/ab-stalls-dots/image-fixture/tmp", ".siso-ephemeral-upload-fail.")); const claude = path.join(scratch, "claude"); const project = path.join(claude, "projects", "fixture"); mkdirSync(project, { recursive: true });
const sessions = { alpha: "stream-alpha", beta: "stream-beta" }; for (const [name, session] of Object.entries(sessions)) writeFileSync(path.join(project, `${session}.jsonl`), JSON.stringify({ type: "user", uuid: `${name}-ready`, timestamp: new Date().toISOString(), message: { role: "user", content: `${name} ready` } }) + "\n");
const agentsFile = path.join(scratch, "agents.json"); const rec = (name, pane, terminal_id, session) => ({ agent: "claude", agent_status: "working", cwd: "/tmp", pane_id: pane, terminal_id, terminal_title_stripped: name, agent_session: { value: session } });
writeFileSync(agentsFile, JSON.stringify([rec("ALPHA", "w1:p2", "term-stream-alpha", sessions.alpha), rec("BETA", "w1:p3", "term-stream-beta", sessions.beta)])); writeFileSync(path.join(scratch, "registry.json"), JSON.stringify({ projects: [], agents: { ALPHA: { project: "Fixture", kind: "owner", domain: "Fixture" }, BETA: { project: "Fixture", kind: "owner", domain: "Fixture" } }, domains: [] }));
const env = { PATH: process.env.PATH, TMPDIR: process.env.TMPDIR, LANG: process.env.LANG, SHELL: process.env.SHELL, HOME: scratch, AB_HOME: scratch, CODEX_HOME: path.join(scratch, ".codex"), AB_CODEX_HOME: path.join(scratch, ".codex"), CLAUDE_CONFIG_DIR: path.join(scratch, ".claude"), XDG_CONFIG_HOME: path.join(scratch, ".config"), XDG_CACHE_HOME: path.join(scratch, ".cache"), XDG_DATA_HOME: path.join(scratch, ".local/share"), XDG_STATE_HOME: path.join(scratch, ".local/state"), AB_PORT: String(PORT), AB_HUB_HOME: scratch, AB_ORG_HOME: scratch, AB_ROLODEX_HOME: scratch, AB_CLAUDE_DIRS: claude, AB_CTX_DIR: path.join(scratch, "ctx"), AB_HUD_DIR: path.join(scratch, "ctx"), AB_HERDR: `${process.execPath} ${path.join(REPO, "services/node/test/fake-herdr.mjs")}`, FAKE_HERDR_AGENTS_FILE: agentsFile, AB_HOSTS_DIR: path.join(scratch, "hosts"), AB_STATE: path.join(scratch, "rows.json"), AB_REGISTRY: path.join(scratch, "registry.json"), AB_RESURRECT_DIR: path.join(scratch, "none"), AB_CONSOLE_EVENTS: path.join(scratch, "none.jsonl"), AB_OPEN_DRY: "1", AB_CONSOLE_URL: BASE, AB_BURN_CMD: "true", AB_VOICE_DB: path.join(scratch, "voice.db"), AB_VOICE_PREFS: path.join(scratch, "voice.plist"), AB_VOICE_WATCH: "0" };
writeFileSync(path.join(REPO,"jobs/ab-stalls-dots/image-fixture/upload-fail-results.jsonl"), "");
const results=[];const check=(name,ok,detail={})=>{results.push(!!ok);const result=JSON.stringify({check:name,ok:!!ok,...detail});writeFileSync(path.join(REPO,"jobs/ab-stalls-dots/image-fixture/upload-fail-results.jsonl"),result+"\n",{flag:"a"});console.log(result);};const sleep=ms=>new Promise(r=>setTimeout(r,ms));const until=async(fn,ms=5000)=>{for(const end=Date.now()+ms;Date.now()<end;await sleep(50))if(await fn())return true;return false;};let node,browser;const png=Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/4Rr4WQAAAABJRU5ErkJggg==","base64");
let release,context;
try {
 node=spawn(process.execPath,["--experimental-strip-types","--no-warnings","src/server.ts"],{cwd:path.join(REPO,"services/node"),env,stdio:"ignore"});check('isolated node health',await until(async()=>(await fetch(`${BASE}/api/health`).catch(()=>null))?.ok,15000));
 browser=await webkit.launch();context=await browser.newContext();
 await context.addInitScript(()=>{
  localStorage.setItem('agent-base:active',JSON.stringify('term-stream-alpha'));localStorage.setItem('agent-base:open',JSON.stringify(['term-stream-alpha']));
  const timeout=AbortSignal.timeout.bind(AbortSignal);window.uploadTimeouts=[];
  AbortSignal.timeout=ms=>{window.uploadTimeouts.push(ms);return timeout(ms===15000?500:ms);};
 });
 const hold=new Promise(r=>release=r);let requests=0;
 await context.route('**/api/uploads',async route=>{requests++;if(requests>1)return route.continue();await hold;await route.abort().catch(()=>{});});
 const page=await context.newPage(),messages=[];
 await page.routeWebSocket(/\/chat\/[^/]+\/ws/,ws=>{
  ws.onMessage(raw=>messages.push(JSON.parse(String(raw))));
  ws.send(JSON.stringify({t:'hello',session:'stream-alpha',log:[],before:0,more:false,state:'idle',thinking:{},partial:{},tasks:[],bg:[]}));
 });
 await page.goto(BASE);const view=page.locator('[data-testid="chat-view"]:visible'),editor=view.getByRole('textbox',{name:'Message',exact:true});await editor.waitFor();
 await editor.fill('Retained draft after timeout');await view.locator('input[type=file]').setInputFiles({name:'timeout.png',mimeType:'image/png',buffer:png});
 await until(()=>requests===1);await view.getByRole('button',{name:'Send',exact:true}).click();
 const failed=await until(async()=>await view.getByTestId('upload-error').count()===1,2500);
 check('hung upload settles into retryable failure',failed,{adding:(await view.innerText()).includes('Adding…'),timeouts:await page.evaluate(()=>window.uploadTimeouts)});
 if(failed){
  check('timeout retains draft and cancels deferred Send',await editor.inputValue()==='Retained draft after timeout'&&messages.filter(m=>m.t==='prompt').length===0);
  release();await view.getByRole('button',{name:/Retry upload/}).click();await until(async()=>await view.locator('.siso-chat__attach img').count()===1);
  check('retry sends the same PNG without reviving canceled Send',requests===2&&messages.filter(m=>m.t==='prompt').length===0&&await editor.inputValue()==='Retained draft after timeout');
  await view.getByRole('button',{name:'Send',exact:true}).click();check('fresh Send includes retried PNG',await until(()=>messages.some(m=>m.t==='prompt'&&m.images?.length===1)));
 }
}catch(e){check('image upload timeout',false,{error:String(e?.stack??e).slice(0,700)});}
finally{release?.();await context?.close();await browser?.close();if(node){node.kill();if(node.exitCode===null)await new Promise(r=>node.once('exit',r));}}
console.log(JSON.stringify({passed:results.filter(Boolean).length,of:results.length}));process.exit(results.every(Boolean)?0:1);
