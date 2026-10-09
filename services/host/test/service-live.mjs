/** One-command attended acceptance. NEVER uses A0's seat, session, pane or launchd job.
 * After the machine gate: node services/host/test/service-live.mjs [evidence-dir]
 * Optional AB_LAB_LOGIN_FROM/TO default claude-siso/claude-siso-3; both need subscription logins.
 */
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { WebSocket } from 'ws';
import { configDir } from '../src/service.ts';
const repo=path.resolve(import.meta.dirname,'../../..');
const out=path.resolve(process.argv[2]??path.join(repo,'tasks/a0w-003'));
const scratch=mkdtempSync(path.join(tmpdir(),'.siso-ephemeral-service-live.'));
const name='HOST-LAB', label='com.siso.host-lab', hosts=path.join(scratch,'hosts'), seat=path.join(scratch,'seat.json');
const hostFile=path.join(hosts,`name-${name}.json`);
const from=process.env.AB_LAB_LOGIN_FROM??'claude-siso', to=process.env.AB_LAB_LOGIN_TO??'claude-siso-3';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const wait=async(fn,ms=30000)=>{const end=Date.now()+ms;while(Date.now()<end){const v=await fn();if(v)return v;await sleep(100);}throw Error('Acceptance timed out');};
const record=(check,detail={})=>{const line=JSON.stringify({check,ok:true,...detail});console.log(line);writeFileSync(path.join(out,'results.jsonl'),line+'\n',{flag:'a'});};
const file=()=>{try{return JSON.parse(readFileSync(hostFile));}catch{return null;}};
const ctl=path.join(repo,'services/host/bin/siso-host-service');
const env={...process.env,AB_HOSTS_DIR:hosts,AB_SEAT_FILE:seat};
for(const k of ['ANTHROPIC_API_KEY','ANTHROPIC_AUTH_TOKEN','CLAUDE_CODE_OAUTH_TOKEN','AB_HOST_SDK','AB_SERVICE_HOST_ENTRY','AB_PARENT_PID'])delete env[k];
let seed,node,browser,installed=false;
const sockets=new Set();
const chat=async(h,text)=>{
  const ws=new WebSocket(`ws://127.0.0.1:${h.port}/ws?token=${h.token}`);sockets.add(ws);
  const events=[];ws.on('message',m=>events.push(JSON.parse(m)));
  await new Promise((r,j)=>{ws.once('open',r);ws.once('error',j);});
  ws.send(JSON.stringify({t:'prompt',text}));
  try {await wait(()=>events.some(e=>e.t==='result'),120000);return events.filter(e=>e.t==='text').map(e=>e.text).join('\n');}
  finally{ws.close();sockets.delete(ws);}
};
const stop=async(child)=>{if(child&&child.exitCode===null){child.kill('SIGTERM');await new Promise(r=>child.once('exit',r));}};
try {
  assert.equal(process.platform,'darwin','Live acceptance requires launchd');
  assert.notEqual(from,to,'Two distinct login profiles required');
  // Existing loaded job is never replaced or stopped by this script.
  assert.notEqual(spawnSync('/bin/launchctl',['print',`gui/${process.getuid()}/${label}`],{stdio:'ignore'}).status,0,'Lab job already loaded; refusing ownership');
  for(const login of [from,to]) {
    const auth=spawnSync(process.env.CLAUDE_BIN??'claude',['auth','status'],{env:{...env,CLAUDE_CONFIG_DIR:configDir(login)},encoding:'utf8'});
    let status;try{status=JSON.parse(auth.stdout);}catch{throw Error(`Cannot check ${login} authentication`);}
    assert.equal(status.loggedIn,true,`${login} must be logged in`);
    assert.ok(status.authMethod==='claude.ai'||['max','pro','team','enterprise'].includes(status.subscriptionType),`${login} must use subscription authentication`);
  }
  const common=spawnSync('git',['rev-parse','--path-format=absolute','--git-common-dir'],{cwd:repo,encoding:'utf8'}).stdout.trim();
  const web=process.env.AB_WEB_DIST??[path.join(repo,'apps/web/dist'),path.join(path.dirname(common),'apps/web/dist')].find(p=>existsSync(path.join(p,'index.html')));
  assert.ok(web&&existsSync(path.join(web,'index.html')),'Built app required: set AB_WEB_DIST to the owner checkout apps/web/dist');
  env.AB_WEB_DIST=web;
  mkdirSync(out,{recursive:true});mkdirSync(hosts,{recursive:true});
  const word=`LAB-${randomUUID()}`;
  seed=spawn(process.execPath,['--experimental-strip-types','--no-warnings',path.join(repo,'services/host/src/host.ts'),'--name',name],{cwd:scratch,env:{...env,AB_SERVICE_NAME:name,CLAUDE_CONFIG_DIR:configDir(from),HERDR_ENV:'0'},stdio:'ignore'});
  const initial=await wait(()=>{if(seed.exitCode!==null)throw Error('Seed host exited');const h=file();return h?.session&&h.apiKeySource!==null?h:null;});
  // Save only the SDK's source label; never the websocket token or credential payload.
  writeFileSync(path.join(out,'billing.json'),JSON.stringify({apiKeySource:initial.apiKeySource},null,2)+'\n');
  assert.ok(['oauth','none'].includes(initial.apiKeySource),'SDK reports an API-key source; stop before installing');
  record('subscription SDK init',{apiKeySource:initial.apiKeySource});
  await chat(initial,`Remember this exact word for this lab conversation: ${word}. Reply with the word. Do not use tools.`);
  await stop(seed);seed=undefined;
  const putSeat=login=>writeFileSync(seat,JSON.stringify({session:initial.session,login_launcher:login,pane:null,name,updated:new Date().toISOString()}));
  putSeat(from);
  // Seed metadata is retained for profile/session recovery; the seed is already stopped.
  const install=spawnSync(ctl,['install','--label',label,'--name',name,'--resume',initial.session],{cwd:scratch,env,encoding:'utf8'});
  assert.equal(install.status,0,install.stderr);installed=true;
  const fakeHerdr=path.join(scratch,'herdr');writeFileSync(fakeHerdr,'#!/bin/sh\nprintf \'{"result":{"agents":[]}}\\n\'\n',{mode:0o700});
  // Isolated app node, ephemeral OS-assigned port, no live herdr connection.
  const net=await import('node:net');const probe=net.createServer();await new Promise(r=>probe.listen(0,'127.0.0.1',r));const port=probe.address().port;await new Promise(r=>probe.close(r));
  node=spawn(process.execPath,['--experimental-strip-types','--no-warnings',path.join(repo,'services/node/src/server.ts')],{cwd:repo,env:{...env,AB_PORT:String(port),AB_HERDR:fakeHerdr,AB_STATE:path.join(scratch,'rows.json'),AB_REGISTRY:path.join(scratch,'registry.json'),AB_CTX_DIR:path.join(scratch,'ctx'),AB_RESURRECT_DIR:path.join(scratch,'resurrect'),AB_CONSOLE_EVENTS:path.join(scratch,'events.jsonl'),AB_MACHINES_FILE:path.join(scratch,'machines.json')},stdio:'ignore'});
  const url=`http://127.0.0.1:${port}`;
  const row=async()=>{if(node.exitCode!==null)throw Error('Lab app node exited');try{return (await(await fetch(url+'/api/agents')).json()).agents.find(a=>a.name===name);}catch{return null;}};
  const {webkit}=await import(path.join(repo,'services/node/node_modules/playwright/index.mjs'));browser=await webkit.launch();const page=await browser.newPage();
  const shot=async(state,captured)=>{
    const snapshot=captured??await row();
    writeFileSync(path.join(out,`${state}.json`),JSON.stringify(snapshot,null,2)+'\n');
    await page.goto(url);await page.waitForTimeout(300);await page.screenshot({path:path.join(out,`${state}-app.png`),fullPage:true});
    // Freeze the actual observed API response for transient-state receipts; distinguish it from the app screenshot.
    await page.setContent('<h1>Agent Base service API snapshot</h1><pre></pre>');
    await page.locator('pre').evaluate((el,value)=>el.textContent=value,JSON.stringify(snapshot,null,2));
    await page.screenshot({path:path.join(out,`${state}.png`),fullPage:true});
  };
  await wait(async()=> (await row())?.host?.state==='live');await shot('live');record('service live',{session:initial.session});
  let h=file();const killed=h.pid;process.kill(killed,'SIGKILL');const killedAt=Date.now();
  const restarting=await wait(async()=> {const r=await row();return r?.host?.state==='restarting'?r:null;});await shot('restarting',restarting);record('API restarting after child SIGKILL');
  await wait(async()=> (await row())?.host?.state==='live'&&file()?.pid!==killed,30000);
  const recoveredMs=Date.now()-killedAt;
  h=file();assert.equal(h.session,initial.session);assert.ok((await chat(h,'What exact word did I ask you to remember? Reply only with the word. No tools.')).includes(word));await shot('recovered');record('kill recovery remembers word',{ms:recoveredMs});
  const before=h.pid, switchAt=Date.now();putSeat(to);
  await wait(()=>file()?.pid!==before&&file()?.configDir===configDir(to),30000);
  await wait(async()=> (await row())?.host?.state==='live',30000);
  const switchedMs=Date.now()-switchAt;
  h=file();assert.equal(h.session,initial.session);assert.ok((await chat(h,'What exact word did I ask you to remember? Reply only with the word. No tools.')).includes(word));await shot('login-switched');record('login switch remembers word',{ms:switchedMs});
  // Screenshots show the actual app. State assertions come from API JSON, independently of UI builder changes.
} finally {
  for(const ws of sockets)ws.terminate();
  await browser?.close();await stop(node);await stop(seed);
  if(installed){const r=spawnSync(ctl,['uninstall','--label',label,'--name',name],{env,stdio:'ignore'});if(r.status!==0)console.error('Lab job uninstall failed; retain scratch for owner cleanup:',scratch);else rmSync(scratch,{recursive:true,force:true});}
  else rmSync(scratch,{recursive:true,force:true});
}
