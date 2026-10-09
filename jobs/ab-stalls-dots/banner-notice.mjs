// Failed uploads retain the requested message; retry/remove needs a fresh explicit Send.
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { webkit } from '../../services/node/test/suite-runtime.mjs';

const REPO = path.join(import.meta.dirname, "../.."); const reserve = createServer();
await new Promise((resolve, reject) => reserve.once("error", reject).listen(0, "127.0.0.1", resolve)); const PORT = reserve.address().port; await new Promise((resolve) => reserve.close(resolve)); const BASE = `http://127.0.0.1:${PORT}`;
mkdirSync(path.join(REPO, "jobs/ab-stalls-dots/banner-fixture/tmp"), { recursive: true });
const scratch = mkdtempSync(path.join(REPO, "jobs/ab-stalls-dots/banner-fixture/tmp", ".siso-ephemeral-upload-fail.")); const claude = path.join(scratch, "claude"); const project = path.join(claude, "projects", "fixture"); mkdirSync(project, { recursive: true });
const sessions = { alpha: "stream-alpha", beta: "stream-beta" }; for (const [name, session] of Object.entries(sessions)) writeFileSync(path.join(project, `${session}.jsonl`), JSON.stringify({ type: "user", uuid: `${name}-ready`, timestamp: new Date().toISOString(), message: { role: "user", content: `${name} ready` } }) + "\n");
const agentsFile = path.join(scratch, "agents.json"); const rec = (name, pane, terminal_id, session) => ({ agent: "claude", agent_status: "working", cwd: "/tmp", pane_id: pane, terminal_id, terminal_title_stripped: name, agent_session: { value: session } });
writeFileSync(agentsFile, JSON.stringify([rec("ALPHA", "w1:p2", "term-stream-alpha", sessions.alpha), rec("BETA", "w1:p3", "term-stream-beta", sessions.beta)])); writeFileSync(path.join(scratch, "registry.json"), JSON.stringify({ projects: [], agents: { ALPHA: { project: "Fixture", kind: "owner", domain: "Fixture" }, BETA: { project: "Fixture", kind: "owner", domain: "Fixture" } }, domains: [] }));
const env = { PATH: process.env.PATH, TMPDIR: process.env.TMPDIR, LANG: process.env.LANG, SHELL: process.env.SHELL, HOME: scratch, AB_HOME: scratch, CODEX_HOME: path.join(scratch, ".codex"), AB_CODEX_HOME: path.join(scratch, ".codex"), CLAUDE_CONFIG_DIR: path.join(scratch, ".claude"), XDG_CONFIG_HOME: path.join(scratch, ".config"), XDG_CACHE_HOME: path.join(scratch, ".cache"), XDG_DATA_HOME: path.join(scratch, ".local/share"), XDG_STATE_HOME: path.join(scratch, ".local/state"), AB_PORT: String(PORT), AB_HUB_HOME: scratch, AB_ORG_HOME: scratch, AB_ROLODEX_HOME: scratch, AB_CLAUDE_DIRS: claude, AB_CTX_DIR: path.join(scratch, "ctx"), AB_HUD_DIR: path.join(scratch, "ctx"), AB_HERDR: `${process.execPath} ${path.join(REPO, "services/node/test/fake-herdr.mjs")}`, FAKE_HERDR_AGENTS_FILE: agentsFile, AB_HOSTS_DIR: path.join(scratch, "hosts"), AB_STATE: path.join(scratch, "rows.json"), AB_REGISTRY: path.join(scratch, "registry.json"), AB_RESURRECT_DIR: path.join(scratch, "none"), AB_CONSOLE_EVENTS: path.join(scratch, "none.jsonl"), AB_OPEN_DRY: "1", AB_CONSOLE_URL: BASE, AB_BURN_CMD: "true", AB_VOICE_DB: path.join(scratch, "voice.db"), AB_VOICE_PREFS: path.join(scratch, "voice.plist"), AB_VOICE_WATCH: "0" };
writeFileSync(path.join(REPO,"jobs/ab-stalls-dots/banner-fixture/upload-fail-results.jsonl"), "");
const results=[];const check=(name,ok,detail={})=>{results.push(!!ok);const result=JSON.stringify({check:name,ok:!!ok,...detail});writeFileSync(path.join(REPO,"jobs/ab-stalls-dots/banner-fixture/upload-fail-results.jsonl"),result+"\n",{flag:"a"});console.log(result);};const sleep=ms=>new Promise(r=>setTimeout(r,ms));const until=async(fn,ms=5000)=>{for(const end=Date.now()+ms;Date.now()<end;await sleep(50))if(await fn())return true;return false;};let node,browser;const png=Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/4Rr4WQAAAABJRU5ErkJggg==","base64");
try {
 node=spawn(process.execPath,["--experimental-strip-types","--no-warnings","src/server.ts"],{cwd:path.join(REPO,"services/node"),env,stdio:"ignore"});check('isolated node health',await until(async()=>(await fetch(`${BASE}/api/health`).catch(()=>null))?.ok,15000));
 browser=await webkit.launch();const context=await browser.newContext();
 await context.addInitScript(()=>{window.versionTime=0;Date.now=()=>window.versionTime;});
 let mode='failed',reads=0;
 await context.route('**/*',async route=>{
  const url=new URL(route.request().url());if(url.origin!==BASE)return route.abort();
  if(url.pathname==='/api/version'){
   reads++;return route.fulfill({status:mode==='failed'?503:200,contentType:'application/json',body:JSON.stringify(mode==='failed'?{error:'fixture unavailable'}:{web:mode,node:'n',desktop:'d',sha:mode,assets:[]})});
  }
  if(url.pathname==='/api/version/changes')return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({subjects:['Real fixture change'],changes:[],sha:mode})});
  return route.continue();
 });
 const page=await context.newPage();await page.routeWebSocket(/.*/,ws=>ws.close());await page.goto(BASE);await until(()=>reads>0);await page.waitForTimeout(200);
 const notice=page.getByText('Update check unavailable',{exact:true});
 check('one failed version check stays hidden',await notice.count()===0);
 const poll=async at=>{const previous=reads;await page.evaluate(at=>{window.versionTime=at;window.dispatchEvent(new Event('focus'));},at);if(!await until(()=>reads>previous))throw Error('fixture version poll did not run');await page.waitForTimeout(150);};
 await poll(119999);check('notice stays hidden before two minutes',await notice.count()===0);
 await poll(120000);check('two minutes of failure displays the notice',await until(async()=>await notice.count()===1));
 await page.getByRole('button',{name:'Dismiss update notice',exact:true}).click();check('clicking the existing × dismisses the error notice',await notice.count()===0);
 await poll(180000);check('same failed state stays dismissed',await notice.count()===0);
 mode='old';await poll(210000);mode='failed';await poll(240000);await poll(360000);
 check('recovery resets dismissal for a new failed period',await until(async()=>await notice.count()===1));
 await page.getByRole('button',{name:'Dismiss update notice',exact:true}).click();mode='new';await poll(390000);
 check('a real build change is visible after dismissal',await until(async()=>await page.getByTestId('ready-pill').count()===1)&&await notice.count()===0);
 await page.screenshot({path:path.join(REPO,'jobs/ab-stalls-dots/banner-new-state.png')});await context.close();
}catch(e){check('rendered update notice',false,{error:String(e?.stack??e).slice(0,700)});}
finally{await browser?.close();if(node){node.kill();if(node.exitCode===null)await new Promise(r=>node.once('exit',r));}}
console.log(JSON.stringify({passed:results.filter(Boolean).length,of:results.length}));process.exit(results.every(Boolean)?0:1);
