import assert from "node:assert/strict";
import fs from "node:fs";
import { fixtureResponse } from "../../../tools/ab-qa-fixtures.mjs";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const { webkit } = createRequire(path.join(repo, "services/node/package.json"))("playwright");
const base = "http://127.0.0.1:64123";
const fixture = { ok: true, agents: [], rows: [], data: [], projects: [], accounts: [], pages: [], tasks: [], events: [] };
const agents = Array.from({ length: 28 }, (_, i) => ({ id: `fixture-${i}`, key: `fixture/AGENT-${i}`, pane: `fixture-${i}`, name: `AGENT-${i}`, title: "working", status: "working", since: Date.now() - 60_000, row: "live", snoozedUntil: null, settledAt: null, seenAt: Date.now(), order: i, tool: "fixture", cwd: "/fixture", folder: "fixture", machine: "fixture", session: null, context: null, hud: null, zero: i === 0, pages: [], domain: "fixture", lead: null, role: "worker", pinned: false, project: i % 2 ? "HALO" : "Agent Base", owner: null, kind: "worker" }));

function rows() { return execFileSync("ps", ["-axo", "pid=,ppid=,rss=,time=,command="], { encoding: "utf8" }).trim().split("\n").map((line) => { const m = line.trim().match(/^(\d+)\s+(\d+)\s+(\d+)\s+([0-9:.]+)\s+(.*)$/); return m && { pid: Number(m[1]), ppid: Number(m[2]), rssKb: Number(m[3]), time: m[4], command: m[5] }; }).filter(Boolean); }
let processMarker = "";
let preexistingMarkerPids = new Set();
function tree(root) { const all = rows(); const ids = new Set([root]); let changed = true; while (changed) { changed = false; for (const r of all) if (ids.has(r.ppid) && !ids.has(r.pid)) { ids.add(r.pid); changed = true; } } return all.filter((r) => ids.has(r.pid) || (processMarker && r.command.includes(processMarker) && !preexistingMarkerPids.has(r.pid))); }
function seconds(s) { const p = s.split(":").map(Number); return p.length === 2 ? p[0] * 60 + p[1] : p[0] * 3600 + p[1] * 60 + p[2]; }
function procSnapshot(root) { const ps = tree(root); return { sampledAt: { wallMs: Date.now(), monotonicMs: Number(process.hrtime.bigint() / 1_000_000n) }, root, marker: processMarker, pids: ps.map((r) => r.pid), cpuSeconds: Number(ps.reduce((n, r) => n + seconds(r.time), 0).toFixed(2)), rssMb: Number((ps.reduce((n, r) => n + r.rssKb, 0) / 1024).toFixed(1)), processes: ps.map(({ pid, ppid, rssKb, time, command }) => ({ pid, ppid, rssKb, time, command: command.slice(0, 160) })) }; }
function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

const { preview } = createRequire(path.join(repo, "apps/web/package.json"))("vite");
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
await page.routeWebSocket("**/*", () => {});
await page.route("**/api/**", async (route) => {
  const url = new URL(route.request().url());
  if (url.pathname === "/api/agents") return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ agents, domains: ["fixture"], pinned: [], pins: [], pinnedPages: [], recentPages: [], workspaces: [] }) });
  if (url.pathname === "/api/org") return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ groups: [], top: [], bottom: [] }) });
  if (url.pathname === "/api/version") return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ web: "fixture", node: "fixture", desktop: "fixture", sha: "fixture" }) });
  return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(fixtureResponse(url.pathname, "bd2102d5") ?? fixture) });
});
await page.goto(`${base}/?app-weight-web=owned-process#at=${encodeURIComponent(JSON.stringify({s:"agents",v:{kind:"tab",id:"canvas"},a:null,o:null,t:null}))}`, { waitUntil: "networkidle" });
await page.waitForTimeout(1500);
fs.writeFileSync(path.join(repo,".agents/runs/2026-10-09-app-weight/web/route-state.txt"), await page.locator("body").innerText());
await page.screenshot({path:path.join(repo,".agents/runs/2026-10-09-app-weight/web/route-state.png")});
await page.getByRole("button", { name: "Show canvas list", exact: true }).click({timeout:3000});
await page.waitForTimeout(500);
const text = await page.locator("body").innerText();
assert.ok(!text.includes("This chat could not be shown"), text.slice(-700));
assert.ok(await page.locator(".ab-canvas__card").count() >= 28);
await page.screenshot({ path: path.join(repo, ".agents/runs/2026-10-09-app-weight/web/synthetic-canvas-list.png"), fullPage: false });
async function pageSnapshot(label) { return page.evaluate((label) => ({ label, url: location.href, title: document.title, visibleText: document.body.innerText.slice(0, 600), nodes: document.querySelectorAll("*").length, canvasCards: document.querySelectorAll(".ab-canvas__card").length, animations: [...document.getAnimations({ subtree: true })].map((a) => { const t = a.effect?.target; if (!(t instanceof Element)) return { name: a.animationName ?? "unknown", selector: "unknown" }; const s = getComputedStyle(t); const r = t.getBoundingClientRect(); return { name: a.animationName ?? "unknown", selector: `${t.tagName.toLowerCase()}.${[...t.classList].slice(0, 4).join(".")}`, state: a.playState, computedAnimation: s.animationName, visibility: s.visibility, display: s.display, rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) } }; }) } ), label); }
async function boundary(label) { return { page: await pageSnapshot(label), process: procSnapshot(rootPid) }; }
await sleep(30_000);
await page.mouse.move(500, 500);
await page.waitForTimeout(1000);
await page.evaluate(() => { document.documentElement.removeAttribute("data-still"); document.documentElement.removeAttribute("data-doze"); });
const warm = await boundary("warmup-end");
await page.evaluate(faces => { const style = document.createElement("style"); style.id = "app-weight-web-freeze"; style.textContent = faces ? `:root[data-app-weight-freeze] .pf, :root[data-app-weight-freeze] .hf { display:none!important }` : `:root[data-app-weight-freeze] *, :root[data-app-weight-freeze] *::before, :root[data-app-weight-freeze] *::after { animation-play-state: paused !important; }`; document.head.append(style); document.documentElement.dataset.appWeightFreeze = "true"; }, process.argv.includes("--faces"));
const freeze1 = await boundary("freeze-1-start");
await sleep(20_000);
const freeze1End = await boundary("freeze-1-end");
await page.evaluate(() => { document.documentElement.removeAttribute("data-app-weight-freeze"); document.documentElement.removeAttribute("data-still"); document.documentElement.removeAttribute("data-doze"); });
const restore = await boundary("restore-start");
await sleep(20_000);
const restoreEnd = await boundary("restore-end");
await page.evaluate(() => document.documentElement.setAttribute("data-app-weight-freeze", "true"));
const freeze2 = await boundary("freeze-2-start");
await sleep(20_000);
const freeze2End = await boundary("freeze-2-end");

console.log(JSON.stringify({ intervention: process.argv.includes("--faces") ? "remove faces from layout (diagnostic only)" : "pause CSS animations", rootPid, launch, warm, freeze1, freeze1End, restore, restoreEnd, freeze2, freeze2End }, null, 2));

} finally { await browser?.close(); await server?.close(); await new Promise(resolve => previewServer.httpServer.close(resolve)); }
