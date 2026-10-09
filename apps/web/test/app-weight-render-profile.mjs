import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import { fixtureResponse } from "../../../tools/ab-qa-fixtures.mjs";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const { webkit } = createRequire(path.join(repo, "services/node/package.json"))("playwright");
const base = "http://127.0.0.1:64123";
const variant = process.argv.find(x => x.startsWith('--variant='))?.slice(10) ?? 'candidate';
const sourceRev = process.argv.find(x => x.startsWith('--source='))?.slice(9);
const out = path.join(repo, '.agents/runs/2026-10-09-face-sleep', variant);
fs.mkdirSync(out, {recursive:true});
const fixture = { ok: true, agents: [], rows: [], data: [], projects: [], accounts: [], pages: [], tasks: [], events: [] };
const agents = Array.from({ length: 28 }, (_, i) => ({ id: `fixture-${i}`, key: `fixture/AGENT-${i}`, pane: `fixture-${i}`, name: `AGENT-${i}`, title: "working", status: "working", since: Date.now() - 60_000, row: "live", snoozedUntil: null, settledAt: null, seenAt: Date.now(), order: i, tool: "fixture", cwd: "/fixture", folder: "fixture", machine: "fixture", session: null, context: null, hud: null, zero: i === 0, pages: [], domain: "fixture", lead: null, role: "worker", pinned: false, project: i % 2 ? "HALO" : "Agent Base", owner: null, kind: "worker" }));

function rows() { return execFileSync("ps", ["-axo", "pid=,ppid=,rss=,time=,command="], { encoding: "utf8" }).trim().split("\n").map((line) => { const m = line.trim().match(/^(\d+)\s+(\d+)\s+(\d+)\s+([0-9:.]+)\s+(.*)$/); return m && { pid: Number(m[1]), ppid: Number(m[2]), rssKb: Number(m[3]), time: m[4], command: m[5] }; }).filter(Boolean); }
let processMarker = "";
let preexistingMarkerPids = new Set();
function tree(root) { const all = rows(); const ids = new Set([root]); let changed = true; while (changed) { changed = false; for (const r of all) if (ids.has(r.ppid) && !ids.has(r.pid)) { ids.add(r.pid); changed = true; } } return all.filter((r) => ids.has(r.pid) || (processMarker && r.command.includes(processMarker) && !preexistingMarkerPids.has(r.pid))); }
function seconds(s) { const p = s.split(":").map(Number); return p.length === 2 ? p[0] * 60 + p[1] : p[0] * 3600 + p[1] * 60 + p[2]; }
function procSnapshot(root) { const ps = tree(root); return { sampledAt: { wallMs: Date.now(), monotonicMs: Number(process.hrtime.bigint() / 1_000_000n) }, root, marker: processMarker, pids: ps.map((r) => r.pid), cpuSeconds: Number(ps.reduce((n, r) => n + seconds(r.time), 0).toFixed(2)), rssMb: Number((ps.reduce((n, r) => n + r.rssKb, 0) / 1024).toFixed(1)), processes: ps.map(({ pid, ppid, rssKb, time, command }) => ({ pid, ppid, rssKb, time, command: command.slice(0, 160) })) }; }
function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

const { build, preview } = createRequire(path.join(repo, "apps/web/package.json"))("vite");
// Pin the three product inputs from git without rewriting a worker's source.
const overrides = new Map();
if (sourceRev) for (const file of ['packages/halo-face/prism-engine.ts','packages/halo-face/halo-face.js','apps/web/src/components/PointAndSay.tsx','apps/web/src/components/PointAndSay.css']) overrides.set(path.join(repo,file),execFileSync('git',['show',`${sourceRev}:${file}`],{cwd:repo,encoding:'utf8'}));
const inputFiles=['packages/halo-face/prism-engine.ts','packages/halo-face/halo-face.js','apps/web/src/components/PointAndSay.tsx','apps/web/src/components/PointAndSay.css'];
fs.writeFileSync(path.join(out,'inputs.json'),JSON.stringify(inputFiles.map(file=>{const body=overrides.get(path.join(repo,file))??fs.readFileSync(path.join(repo,file),'utf8');return {file,sha256:createHash('sha256').update(body).digest('hex')};}),null,2));
await build({root:path.join(repo,'apps/web'),configFile:path.join(repo,'apps/web/vite.config.ts'),logLevel:'warn',plugins:[{name:'measured-source',enforce:'pre',load(id){return overrides.get(id);}}]});
const previewServer = await preview({ configFile: false, root: path.join(repo, "apps/web"), preview: { host: "127.0.0.1", port: 64123, strictPort: true } });
let server, browser;
try {
const beforeLaunchRows = rows();
server = await webkit.launchServer({ headless: true });
const rootPid = server.process().pid;
const launchRows = rows();
const webkitRow = launchRows.find((r) => r.command.includes("/ms-playwright/webkit-"));
processMarker = webkitRow?.command.match(/\/ms-playwright\/webkit-[^/]+\//)?.[0] ?? "";
preexistingMarkerPids = new Set(beforeLaunchRows.filter((r) => processMarker && r.command.includes(processMarker)).map((r) => r.pid));
const launch = procSnapshot(rootPid);
browser = await webkit.connect({ wsEndpoint: server.wsEndpoint() });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
await page.routeWebSocket("**/*", socket => socket.close());
await page.route('**/*', route => new URL(route.request().url()).origin === base ? route.fallback() : route.abort());
await page.addInitScript(() => {
  const raf=window.requestAnimationFrame.bind(window);
  window.__rafCallbacks=0;
  window.requestAnimationFrame=fn=>raf(t=>{window.__rafCallbacks++;fn(t)});
});
await page.route("**/api/**", async (route) => {
  const url = new URL(route.request().url());
  if (route.request().headers().accept?.includes('text/event-stream')) return route.fulfill({contentType:'text/event-stream',body:': synthetic\n\n'});
  if (url.pathname === "/api/agents") return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ agents, domains: ["fixture"], pinned: [], pins: [], pinnedPages: [], recentPages: [], workspaces: [] }) });
  if (url.pathname === "/api/org") return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ groups: [], top: [], bottom: [] }) });
  if (url.pathname === "/api/version") return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ web: "fixture", node: "fixture", desktop: "fixture", sha: "fixture" }) });
  return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(fixtureResponse(url.pathname, "bd2102d5") ?? fixture) });
});
await page.goto(`${base}/?app-weight-web=owned-process#at=${encodeURIComponent(JSON.stringify({s:"agents",v:{kind:"tab",id:"canvas"},a:null,o:null,t:null}))}`, { waitUntil: "networkidle" });
await page.waitForTimeout(1500);


await page.getByRole("button", { name: "Show canvas list", exact: true }).click({timeout:3000});
await page.waitForTimeout(500);
const text = await page.locator("body").innerText();
assert.ok(!text.includes("This chat could not be shown"), text.slice(-700));
assert.ok(await page.locator(".ab-canvas__card").count() >= 28);
await page.screenshot({ path: path.join(out,"canvas.png"), fullPage: false });
async function boundary(label) { return {label,process:procSnapshot(rootPid),page:await page.evaluate(()=>({nodes:document.querySelectorAll('*').length,cards:document.querySelectorAll('.ab-canvas__card').length,faces:document.querySelectorAll('.pf').length,rafCallbacks:window.__rafCallbacks,doze:document.documentElement.hasAttribute('data-doze'),still:document.documentElement.hasAttribute('data-still'),movingFaces:document.querySelectorAll('.pf[data-motion="on"]').length}))}; }
await sleep(15000);
await page.mouse.move(500,500);
if(process.argv.includes('--sample')) {
 const captured=procSnapshot(rootPid);
 for(const role of ['WebContent','GPU']) {const target=captured.processes.find(p=>p.command.includes(role));assert.ok(target,role);execFileSync('sample',[String(target.pid),'3','-file',path.join(out,`${role}.sample.txt`)],{encoding:'utf8',stdio:'pipe'});}
 fs.writeFileSync(path.join(out,'sample-processes.json'),JSON.stringify(captured,null,2)+'\n');
 console.log(JSON.stringify({variant,sampled:captured.pids}));
} else if(process.argv.includes('--legacy')) {
 const phases=[];
 for(const [i,hidden] of [false,true,false].entries()) {
  await page.evaluate(hidden=>{let style=document.getElementById('legacy-diagnostic');if(!style){style=document.createElement('style');style.id='legacy-diagnostic';style.textContent='html[data-hide-legacy] .hf {display:none!important}';document.head.append(style)}document.documentElement.toggleAttribute('data-hide-legacy',hidden)},hidden);
  await page.mouse.move(500+i,500);await sleep(1000);
  const before=await boundary(hidden?'legacy-hidden':'legacy-shown');
  for(let j=0;j<4;j++){await sleep(5000);await page.mouse.move(500+i+j%2,500+j%2)}
  const after=await boundary('end');phases.push({hidden,before,after});
 }
 await sleep(21000);const idleStart=await boundary('idle-start');await sleep(20000);const idleEnd=await boundary('idle-end');
 fs.writeFileSync(path.join(out,'legacy-result.json'),JSON.stringify({variant,launch,phases,idleStart,idleEnd},null,2)+'\n');
 console.log(JSON.stringify(phases.map(({hidden,before:a,after:b})=>({hidden,cpuPct:100*(b.process.cpuSeconds-a.process.cpuSeconds)/((b.process.sampledAt.monotonicMs-a.process.sampledAt.monotonicMs)/1000),raf:b.page.rafCallbacks-a.page.rafCallbacks,rss:b.process.rssMb}))));
} else {
const samples=[await boundary('warm')];
for(let i=0;i<3;i++){await sleep(20000);samples.push(await boundary(`sample-${i+1}`));}
await page.mouse.move(510,510);
await page.waitForTimeout(1000);
const moving=await page.evaluate(async()=>{
 const faces=[...document.querySelectorAll('.pf[data-motion="on"]')], read=()=>faces.map(f=>{const g=f.querySelector('.pf-gaze')??f;return g.style.transform+['--gx','--gy','--blink'].map(k=>g.style.getPropertyValue(k)||f.style.getPropertyValue(k)).join()});
 const first=read(),changed=new Set();for(let i=0;i<10;i++){await new Promise(r=>setTimeout(r,500));read().forEach((v,j)=>{if(v!==first[j])changed.add(j)})}return {faces:faces.length,moved:changed.size};
});
assert.ok(moving.faces>0 && moving.moved===moving.faces,JSON.stringify(moving));
const result={variant,sourceRev:sourceRev??'working-tree',rootPid,launch,samples,moving};
fs.writeFileSync(path.join(out,'result.json'),JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({variant,moving,intervals:samples.slice(1).map((b,i)=>{const a=samples[i],wall=(b.process.sampledAt.monotonicMs-a.process.sampledAt.monotonicMs)/1000;return {wall,cpuPct:100*(b.process.cpuSeconds-a.process.cpuSeconds)/wall,raf:b.page.rafCallbacks-a.page.rafCallbacks,rssMb:b.process.rssMb,nodes:b.page.nodes}})}));

}
} finally { await browser?.close(); await server?.close(); await new Promise(resolve => previewServer.httpServer.close(resolve)); }
