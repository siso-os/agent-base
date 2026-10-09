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
try {
 node=spawn(process.execPath,["--experimental-strip-types","--no-warnings","src/server.ts"],{cwd:path.join(REPO,"services/node"),env,stdio:"ignore"});
 check("isolated node health",await until(async()=>(await fetch(`${BASE}/api/health`).catch(()=>null))?.ok,15000));
 browser=await webkit.launch();
 for(const method of ['button','paste','drop']){
  const context=await browser.newContext({viewport:{width:1440,height:900}});
  await context.addInitScript(()=>{localStorage.setItem('agent-base:active',JSON.stringify('term-stream-alpha'));localStorage.setItem('agent-base:open',JSON.stringify(['term-stream-alpha']));});
  const page=await context.newPage(),messages=[],errors=[];page.on('pageerror',e=>errors.push(e.message));
  await context.route('**/*',r=>new URL(r.request().url()).origin===BASE?r.continue():r.abort());
  await page.routeWebSocket(/\/chat\/[^/]+\/ws/,ws=>{
   ws.onMessage(raw=>{const m=JSON.parse(String(raw));messages.push(m);if(m.t==='prompt'){
    ws.send(JSON.stringify({t:'user',id:m.key,text:m.text,images:m.images.map(p=>path.basename(p)),at:Date.now()}));
    ws.send(JSON.stringify({t:'prompt.receipt',key:m.key,phase:'accepted'}));
   }});
   ws.send(JSON.stringify({t:'hello',session:'stream-alpha',log:[],before:0,more:false,state:'idle',thinking:{},partial:{},tasks:[],bg:[]}));
  });
  await page.goto(BASE);const view=page.locator('[data-testid="chat-view"]:visible'),editor=view.getByRole('textbox',{name:'Message',exact:true});await editor.waitFor();
  if(method==='button'){
   const picker=page.waitForEvent('filechooser');await view.getByRole('button',{name:'Add an image',exact:true}).click();
   await (await picker).setFiles({name:'button.png',mimeType:'image/png',buffer:png});
  }else{
   const target=method==='paste'?editor:view.locator('.siso-chat__inputrow');
   await target.evaluate((el,{method,png})=>{
    const data=new DataTransfer();data.items.add(new File([Uint8Array.from(atob(png),c=>c.charCodeAt(0))],method+'.png',{type:'image/png'}));
    const event=method==='paste'?new ClipboardEvent('paste',{clipboardData:data,bubbles:true,cancelable:true}):new DragEvent('drop',{dataTransfer:data,bubbles:true,cancelable:true});el.dispatchEvent(event);
   },{method,png:png.toString('base64')});
  }
  await view.locator('.siso-chat__attach img').waitFor();await editor.fill('PNG-'+method);await view.getByRole('button',{name:'Send',exact:true}).click();
  check(method+': PNG uploaded to real fixture API and included in prompt',await until(()=>messages.some(m=>m.t==='prompt'&&m.images?.length===1)));
  const sent=view.getByRole('img',{name:'An image he sent',exact:true});await sent.waitFor();
  check(method+': PNG visible in sent message',await sent.evaluate(img=>img.complete&&img.naturalWidth===1)&&await editor.inputValue()===''&&errors.length===0,{errors});
  if(method==='button')await page.screenshot({path:path.join(REPO,'jobs/ab-stalls-dots/image-sent.png')});
  await context.close();
 }
}catch(e){check('image attach entry paths',false,{error:String(e?.stack??e).slice(0,700)});}
finally{await browser?.close();if(node){node.kill();if(node.exitCode===null)await new Promise(r=>node.once('exit',r));}}
console.log(JSON.stringify({passed:results.filter(Boolean).length,of:results.length}));process.exit(results.every(Boolean)?0:1);
