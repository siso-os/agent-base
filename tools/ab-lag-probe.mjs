#!/usr/bin/env node
// t-0586: measure Agent Base's lag with real data and nothing attached. Builds the web unminified, serves it, sends its GET
// /api calls to a node (--target, e.g. an ssh tunnel to the laptop's live node), refuses every other method, and closes
// every socket except chat sockets, which get a synthetic long chat (no transcript is read). Then in headless Chromium
// (CPU profile, heap, metrics) or WebKit (timings like the app's): idle cost, side-nav scroll frames, click-to-readable for
// five agents. Usage: node tools/ab-lag-probe.mjs --target http://127.0.0.1:15411 [--browser chromium|webkit]
//   [--idle 60] [--soak 0] [--turns 150] [--out DIR] [--dist DIR (skip the build)]
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const target = arg("target", "http://127.0.0.1:15411"), which = arg("browser", "chromium");
const css = arg("css", ""), phases = arg("phases", "idle,scroll,clicks");
const streamS = +arg("stream", 0), record = arg("record"), replay = arg("replay");
// --record DIR keeps the first answer for each GET url; --replay DIR serves only those, so runs compare on the same data.
const tape = new Map(replay ? Object.entries(JSON.parse(fs.readFileSync(path.join(replay, "tape.json"), "utf8"))) : []);
const idleS = +arg("idle", 60), soakMin = +arg("soak", 0), turnsN = +arg("turns", 150);
const out = path.resolve(arg("out", path.join(repo, `.agents/runs/t0586/${which}-${new Date().toISOString().slice(0, 16).replace(/:/g, "")}`)));
fs.mkdirSync(out, { recursive: true });
const pw = createRequire(path.join(repo, "services/node/package.json"))("playwright");

let dist = arg("dist");
if (!dist) {
  dist = path.join(out, "dist");
  const { build } = createRequire(path.join(repo, "apps/web/package.json"))("vite");
  await build({ root: path.join(repo, "apps/web"), configFile: path.join(repo, "apps/web/vite.config.ts"), logLevel: "warn",
    build: { outDir: dist, emptyOutDir: true, minify: false, sourcemap: false } });
}

// GET-only proxy; bytes and time per path.
const traffic = new Map(), sessions = new Map();
const note = (p, bytes, ms) => { const k = p.replace(/\?.*/, "").replace(/\/api\/agents\/[^/]+/, "/api/agents/:name"); const t = traffic.get(k) ?? { n: 0, bytes: 0, ms: 0 }; t.n++; t.bytes += bytes; t.ms += ms; traffic.set(k, t); };
const learn = v => { if (Array.isArray(v)) v.forEach(learn); else if (v && typeof v === "object") { if (typeof v.id === "string" && typeof v.session === "string") sessions.set(v.id, v.session); Object.values(v).forEach(learn); } };
const mime = { ".js": "text/javascript", ".css": "text/css", ".html": "text/html", ".svg": "image/svg+xml", ".png": "image/png", ".woff2": "font/woff2", ".json": "application/json" };
const server = http.createServer(async (req, res) => {
  if (req.url.startsWith("/api/")) {
    if (req.method !== "GET") { res.writeHead(405, { "content-type": "application/json" }); return res.end('{"error":"probe is read-only"}'); }
    const t0 = performance.now();
    if (replay) {
      const hit = tape.get(req.url);
      const body = Buffer.from(hit?.body ?? '{"error":"not on the tape"}');
      if (req.url.startsWith("/api/agents") && !req.url.slice(11).includes("/")) { try { learn(JSON.parse(body)); } catch {} }
      // Like the node (services/node/src/http-json.ts): an unchanged answer is a 304 for a caller that sends its tag.
      const etag = hit?.status === 200 ? `"${createHash("sha1").update(body).digest("base64url").slice(0, 20)}"` : null;
      const unchanged = !!etag && req.headers["if-none-match"] === etag;
      note(req.url, unchanged ? 0 : body.length, 0);
      if (unchanged) { res.writeHead(304, { etag }); return res.end(); }
      res.writeHead(hit?.status ?? 404, { "content-type": "application/json", ...(etag ? { etag } : {}) }); return res.end(body);
    }
    try {
      const r = await fetch(target + req.url, { headers: { origin: target.replace(/:\d+$/, ":5411") } });
      const body = Buffer.from(await r.arrayBuffer());
      if (record && !tape.has(req.url)) tape.set(req.url, { status: r.status, body: body.toString() });
      note(req.url, body.length, performance.now() - t0);
      if (req.url.startsWith("/api/agents") && !req.url.slice(11).includes("/")) { try { learn(JSON.parse(body)); } catch {} }
      res.writeHead(r.status, { "content-type": r.headers.get("content-type") ?? "application/json" }); return res.end(body);
    } catch (e) { res.writeHead(502); return res.end(String(e)); }
  }
  let f = path.join(dist, decodeURIComponent(req.url.replace(/\?.*/, "")));
  if (!f.startsWith(dist) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) f = path.join(dist, "index.html");
  res.writeHead(200, { "content-type": mime[path.extname(f)] ?? "application/octet-stream" }); fs.createReadStream(f).pipe(res);
});
server.on("upgrade", (_req, socket) => socket.destroy());
await new Promise(r => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}`;

// A long synthetic chat: user line, thinking, three tools, a markdown answer with a code block; the last answer holds a marker.
function chat(name) {
  const log = []; let at = Date.now() - turnsN * 60_000;
  for (let i = 0; i < turnsN; i++) {
    log.push({ t: "user", id: `u${i}`, text: `Turn ${i}: check the side nav rows and fix the lag in ${name}`, at: at += 1000, from: "app" });
    log.push({ t: "thinking", id: `th${i}`, text: "Thinking about the change. ".repeat(20), ms: 3000, at: at += 1000 });
    for (let j = 0; j < 3; j++) {
      log.push({ t: "tool", id: `t${i}-${j}`, name: j ? "Read" : "Bash", summary: `services/node/src/file${j}.ts`, input: { command: `grep -n poll services/node/src/file${j}.ts` }, at: at += 1000 });
      log.push({ t: "tool_done", id: `t${i}-${j}`, ok: true, out: "line\n".repeat(40), lines: 40, at: at += 1000 });
    }
    const last = i === turnsN - 1 ? ` LAG-PROBE-END-${name}` : "";
    log.push({ t: "text", id: `x${i}`, text: `## Result ${i}\n\nThe **change** works: \`fleet-board\` now sends *changes*.\n\n- one\n- two\n\n\`\`\`ts\nconst a = ${i};\nfunction f(x: number) { return x * a; }\n\`\`\`\n\nDone.${last}`, at: at += 1000 });
    log.push({ t: "result", ms: 30_000, cost: 0.1, at: at += 1000 });
  }
  return log;
}

const browser = await pw[which].launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: process.argv.includes("--reduced") ? "reduce" : "no-preference" });
const page = await ctx.newPage();
await page.routeWebSocket("**/*", ws => ws.close());
await page.routeWebSocket(/\/chat\/[^/]+\/ws/, ws => {
  const id = decodeURIComponent(ws.url().match(/\/chat\/([^/]+)\/ws/)[1]);
  ws.send(JSON.stringify({ t: "hello", session: sessions.get(id) ?? id, log: chat(id), before: 0, more: false, state: streamS ? "working" : "idle", thinking: {}, partial: {}, tasks: [], bg: [] }));
  if (!streamS) return;
  // A working agent: a word every 50 ms, and every 4 s the answer lands with a tool call, like a live turn.
  let k = 0, words = "", n = 0;
  const timer = setInterval(() => {
    try {
      const at = Date.now(), tid = `live-${k}`;
      if (++n % 80) { words += "word "; return ws.send(JSON.stringify({ t: "delta", id: tid, text: "word ", at })); }
      ws.send(JSON.stringify({ t: "text", id: tid, text: words, at }));
      ws.send(JSON.stringify({ t: "tool", id: `${tid}-tool`, name: "Bash", summary: "rg -n poll", input: { command: "rg -n poll" }, at }));
      ws.send(JSON.stringify({ t: "tool_done", id: `${tid}-tool`, ok: true, out: "line\n".repeat(30), lines: 30, at }));
      k++; words = "";
    } catch { clearInterval(timer); }
  }, 50);
  ws.onClose(() => clearInterval(timer));
});
const cdp = which === "chromium" ? await ctx.newCDPSession(page) : null;
const metrics = async () => cdp ? Object.fromEntries((await cdp.send("Performance.getMetrics")).metrics.map(m => [m.name, m.value])) : {};
const heap = async () => { if (!cdp) return null; await cdp.send("HeapProfiler.collectGarbage"); return Math.round((await cdp.send("Runtime.getHeapUsage")).usedSize / 1e6); };
if (cdp) { await cdp.send("Performance.enable"); await cdp.send("HeapProfiler.enable"); }

const result = { at: new Date().toISOString(), browser: which, target, turns: turnsN };
const t0 = Date.now();
await page.goto(base);
await page.waitForSelector(".siso-thread", { timeout: 60_000 });
result.bootMs = Date.now() - t0;
await page.waitForTimeout(8000);
// Every running animation, grouped by name and target, with what it animates (style recalc per frame comes from these).
const census = () => page.evaluate(() => {
  const groups = new Map();
  for (const a of document.getAnimations()) {
    if (a.playState !== "running") continue;
    const el = a.effect?.target, cls = el ? `${el.tagName.toLowerCase()}.${String(el.getAttribute?.("class") ?? "").split(/\s+/).slice(0, 2).join(".")}` : "?";
    const props = [...new Set((a.effect?.getKeyframes?.() ?? []).flatMap(k => Object.keys(k).filter(p => !["offset", "easing", "composite", "computedOffset"].includes(p))))].join(",");
    const key = `${a.animationName ?? a.transitionProperty ?? a.constructor.name} ${cls} [${props}]`;
    groups.set(key, (groups.get(key) ?? 0) + 1);
  }
  return { running: [...groups.values()].reduce((a, b) => a + b, 0), groups: [...groups].sort((a, b) => b[1] - a[1]).slice(0, 25).map(([k, n]) => `${n}x ${k}`) };
});
if (css) await page.addStyleTag({ content: css });
result.css = css || undefined;
result.animations = await census();
// Who writes to the DOM while idle: attribute/class/style mutations and setProperty calls for 5 s, by target and caller.
result.writers = await page.evaluate(async () => {
  const muts = new Map(), props = new Map(), name = el => el ? `${el.tagName?.toLowerCase()}.${String(el.getAttribute?.("class") ?? "").split(/\s+/).slice(0, 2).join(".")}` : "?";
  const ob = new MutationObserver(list => { for (const m of list) { const k = `${m.type}:${m.attributeName ?? ""} ${name(m.target.nodeType === 1 ? m.target : m.target.parentElement)}`; muts.set(k, (muts.get(k) ?? 0) + 1); } });
  ob.observe(document.documentElement, { attributes: true, childList: true, characterData: true, subtree: true });
  const orig = CSSStyleDeclaration.prototype.setProperty;
  CSSStyleDeclaration.prototype.setProperty = function (p, ...a) { const at = (new Error().stack ?? "").split("\n").slice(2, 4).map(l => l.trim().replace(/\(?http[^)]*\/([^/)]+)\)?/, "$1")).join(" < "); const k = `${p} ${at}`; props.set(k, (props.get(k) ?? 0) + 1); return orig.call(this, p, ...a); };
  await new Promise(r => setTimeout(r, 5000));
  ob.disconnect(); CSSStyleDeclaration.prototype.setProperty = orig;
  const top = m => [...m].sort((a, b) => b[1] - a[1]).slice(0, 15).map(([k, n]) => `${n}x ${k}`);
  return { mutations: top(muts), setProperty: top(props) };
});

// Idle: nothing touched for idleS seconds.
traffic.clear();
const m0 = await metrics(), h0 = await heap(), c0 = treeCpu();
if (cdp) { await cdp.send("Profiler.enable"); await cdp.send("Profiler.setSamplingInterval", { interval: 500 }); await cdp.send("Profiler.start"); }
await page.waitForTimeout(idleS * 1000);
const m1 = await metrics(), c1 = treeCpu();
if (cdp) {
  const { profile } = await cdp.send("Profiler.stop");
  fs.writeFileSync(path.join(out, "idle.cpuprofile"), JSON.stringify(profile));
  result.idleTop = summarize(profile);
}
const d = k => Math.round(((m1[k] ?? 0) - (m0[k] ?? 0)) * 1000);
result.idle = { seconds: idleS, browserCpuPct: Math.round(100 * (c1 - c0) / idleS), scriptMs: d("ScriptDuration"), taskMs: d("TaskDuration"), layoutMs: d("LayoutDuration"), styleMs: d("RecalcStyleDuration"),
  heapMB: [h0, await heap()], nodes: m1.Nodes, listeners: m1.JSEventListeners,
  traffic: Object.fromEntries([...traffic].sort((a, b) => b[1].bytes - a[1].bytes).map(([k, v]) => [k, { calls: v.n, kbPerMin: Math.round(v.bytes / 1024 / (idleS / 60)), avgMs: Math.round(v.ms / v.n) }])) };

if (!phases.includes("scroll")) await finish();
// Scroll the side nav: wheel steps for 3 s down, 3 s up, frame gaps measured in the page.
const nav = await page.evaluateHandle(() => { let el = document.querySelector(".siso-thread"); while (el && !(el.scrollHeight > el.clientHeight + 10 && /auto|scroll/.test(getComputedStyle(el).overflowY))) el = el.parentElement; return el; });
const box = nav.asElement() && await nav.asElement().boundingBox();
if (box) {
  await page.evaluate(() => { window.__gaps = []; let last = performance.now(); const tick = t => { window.__gaps.push(t - last); last = t; if (!window.__stop) requestAnimationFrame(tick); }; window.__stop = false; requestAnimationFrame(tick); });
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  for (const dy of [120, -120]) for (let i = 0; i < 90; i++) { await page.mouse.wheel(0, dy); await page.waitForTimeout(33); }
  const gaps = await page.evaluate(() => { window.__stop = true; return window.__gaps.slice(2); });
  result.navScroll = frames(gaps);
} else result.navScroll = "no scrollable nav found";

// Click five agents; readable = the last synthetic answer is in the DOM, then a frame painted.
const names = await page.$$eval(".siso-thread .siso-thread__name", els => [...new Set(els.map(e => e.textContent.trim()))].filter(Boolean));
result.clicks = [];
for (const name of names.filter(n => !/^\+\d/.test(n)).slice(0, 5)) {
  const ms = await page.evaluate(async name => {
    const row = [...document.querySelectorAll(".siso-thread")].find(r => r.querySelector(".siso-thread__name")?.textContent.trim() === name);
    if (!row) return -1;
    const start = performance.now();
    const seen = () => /LAG-PROBE-END-/.test(document.querySelector(".siso-chat")?.textContent ?? "");
    row.click();
    await new Promise((res, rej) => { const to = setTimeout(() => rej(new Error("timeout")), 20_000); const ob = new MutationObserver(() => { if (seen()) { ob.disconnect(); clearTimeout(to); res(); } }); ob.observe(document.body, { childList: true, subtree: true, characterData: true }); if (seen()) { ob.disconnect(); clearTimeout(to); res(); } });
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    return Math.round(performance.now() - start);
  }, name).catch(e => `failed: ${e.message.slice(0, 80)}`);
  result.clicks.push({ name, ms });
  await page.waitForTimeout(1500);
}

// Scroll the open chat the same way.
const chatBox = await page.evaluateHandle(() => { let el = document.querySelector(".siso-chat [class*=log], .siso-chat"); const all = [...document.querySelectorAll(".siso-chat *")]; return all.find(e => e.scrollHeight > e.clientHeight + 200 && /auto|scroll/.test(getComputedStyle(e).overflowY)) ?? el; });
const cb = chatBox.asElement() && await chatBox.asElement().boundingBox();
if (cb) {
  await page.evaluate(() => { window.__gaps = []; let last = performance.now(); const tick = t => { window.__gaps.push(t - last); last = t; if (!window.__stop) requestAnimationFrame(tick); }; window.__stop = false; requestAnimationFrame(tick); });
  await page.mouse.move(cb.x + cb.width / 2, cb.y + cb.height / 2);
  for (const dy of [-200, 200]) for (let i = 0; i < 90; i++) { await page.mouse.wheel(0, dy); await page.waitForTimeout(33); }
  result.chatScroll = frames(await page.evaluate(() => { window.__stop = true; return window.__gaps.slice(2); }));
}
result.afterClicks = { heapMB: await heap(), nodes: (await metrics()).Nodes };
// With --stream: the opened chats keep streaming; what that costs while he just watches.
if (streamS) {
  const s0 = await metrics(), sc0 = treeCpu();
  await page.waitForTimeout(streamS * 1000);
  const s1 = await metrics(), sc1 = treeCpu(), sd = k => Math.round(((s1[k] ?? 0) - (s0[k] ?? 0)) * 1000);
  result.streaming = { seconds: streamS, browserCpuPct: Math.round(100 * (sc1 - sc0) / streamS), taskMs: sd("TaskDuration"), scriptMs: sd("ScriptDuration"), styleMs: sd("RecalcStyleDuration"), layoutMs: sd("LayoutDuration"), heapMB: await heap(), nodes: s1.Nodes };
}

// Soak: heap after GC each minute, the agents and fleet polls running.
if (soakMin) {
  result.soak = [];
  for (let i = 0; i < soakMin; i++) { await page.waitForTimeout(60_000); result.soak.push({ min: i + 1, heapMB: await heap(), nodes: (await metrics()).Nodes }); }
}
await finish();
async function finish() {
  if (record) { fs.mkdirSync(record, { recursive: true }); fs.writeFileSync(path.join(record, "tape.json"), JSON.stringify(Object.fromEntries(tape))); }
  fs.writeFileSync(path.join(out, "result.json"), JSON.stringify(result, null, 1));
  console.log(JSON.stringify(result, null, 1));
  await browser.close(); server.closeAllConnections(); server.close(); process.exit(0);
}

/** CPU seconds used so far by every process under this one (the browser and its renderers). */
function treeCpu() {
  const rows = execFileSync("ps", ["-axo", "pid=,ppid=,time=,command="], { encoding: "utf8" }).trim().split("\n").map(l => { const m = l.trim().match(/^(\d+)\s+(\d+)\s+(\S+)\s+(.*)$/); return m ? [m[1], m[2], m[3], m[4]] : ["", "", "0", ""]; });
  const ids = new Set([String(process.pid)]); let grew = true;
  while (grew) { grew = false; for (const [pid, ppid] of rows) if (ids.has(ppid) && !ids.has(pid)) { ids.add(pid); grew = true; } }
  // WebKit's content processes come from XPC (launchd), not from this process: count them by Playwright's WebKit path.
  for (const [pid, , , cmd] of rows) if (/ms-playwright\/webkit-/.test(cmd)) ids.add(pid);
  return rows.filter(([pid]) => ids.has(pid) && pid !== String(process.pid)).reduce((sum, [, , t]) => sum + t.split(":").reduce((a, x) => a * 60 + Number(x), 0), 0);
}
function frames(g) {
  const s = [...g].sort((a, b) => a - b), q = p => Math.round(s[Math.min(s.length - 1, Math.floor(p * s.length))]);
  return { frames: g.length, p50: q(0.5), p95: q(0.95), max: Math.round(s.at(-1) ?? 0), over50ms: g.filter(x => x > 50).length };
}
function summarize(profile) {
  const byId = new Map(profile.nodes.map(n => [n.id, n])), parent = new Map();
  for (const n of profile.nodes) for (const c of n.children ?? []) parent.set(c, n.id);
  const dt = new Map(); profile.samples.forEach((s, i) => dt.set(s, (dt.get(s) ?? 0) + (profile.timeDeltas[i] ?? 0)));
  const key = n => `${n.callFrame.functionName || "(anon)"} ${n.callFrame.url.replace(/^.*\//, "")}:${n.callFrame.lineNumber + 1}`;
  const self = new Map(), incl = new Map();
  for (const [id, us] of dt) {
    const k = key(byId.get(id)); self.set(k, (self.get(k) ?? 0) + us);
    const seen = new Set(); for (let x = id; x; x = parent.get(x)) { const kk = key(byId.get(x)); if (!seen.has(kk)) { seen.add(kk); incl.set(kk, (incl.get(kk) ?? 0) + us); } }
  }
  const ms = m => [...m].filter(([k]) => !/^\((idle|program|root)\)/.test(k)).sort((a, b) => b[1] - a[1]).slice(0, 25).map(([k, v]) => `${Math.round(v / 1000)}ms ${k}`);
  return { self: ms(self), inclusive: ms(incl) };
}
