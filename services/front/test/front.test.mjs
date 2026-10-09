// The front (t-0539): new connections follow active.json, an open one stays on its node until it closes, a connection
// that arrives while no node answers is held until one does, and a big reply passes whole. Ports 5470-5473 only.
// Run: node services/front/test/front.test.mjs
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ab-front-test-"));
const ACTIVE = path.join(dir, "active.json"), FRONT = 5470;
const setActive = (port) => { fs.writeFileSync(ACTIVE + ".tmp", JSON.stringify({ port })); fs.renameSync(ACTIVE + ".tmp", ACTIVE); };
const big = "x".repeat(4 << 20);
const node = (name, port) => new Promise((ok) => {
  const s = http.createServer((req, res) => {
    if (req.url === "/big") return res.end(big);
    if (req.url === "/stream") { res.writeHead(200); res.write(`${name}\n`); return; } // stays open like SSE
    res.end(name);
  });
  s.listen(port, "127.0.0.1", () => ok(s));
});
const get = (p) => new Promise((ok, no) => http.get({ host: "127.0.0.1", port: FRONT, path: p, agent: false }, (r) => { let b = ""; r.on("data", (c) => (b += c)); r.on("end", () => ok(b)); }).on("error", no));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const a = await node("A", 5471), b = await node("B", 5472);
setActive(5471);
const front = spawn(process.execPath, [path.join(import.meta.dirname, "../front.mjs")], { env: { ...process.env, AB_FRONT_PORT: String(FRONT), AB_FRONT_ACTIVE: ACTIVE, AB_FRONT_WAIT_MS: "4000" }, stdio: ["ignore", "pipe", "inherit"] });
let out = ""; front.stdout.on("data", (c) => (out += c));
try {
  for (let i = 0; i < 40 && !out.includes("listening"); i++) await sleep(50);
  assert.equal(await get("/"), "A");
  assert.equal((await get("/big")).length, big.length);
  // An open stream on A survives the switch; new requests go to B.
  const stream = await new Promise((ok) => http.get({ host: "127.0.0.1", port: FRONT, path: "/stream", agent: false }, (r) => { r.once("data", (c) => ok({ r, first: String(c) })); }));
  assert.equal(stream.first, "A\n");
  setActive(5472);
  assert.equal(await get("/"), "B");
  let closed = false; stream.r.on("close", () => (closed = true)); stream.r.on("end", () => (closed = true));
  await sleep(200); assert.equal(closed, false, "the open stream stayed on A");
  a.closeAllConnections(); a.close();
  await sleep(200); assert.equal(closed, true, "A stopping closes its stream, so the page reconnects");
  console.log("PASS switch: new connections follow active.json; an open stream stays on the old node until it stops");
  // No node: the connection is held, then served once one answers.
  b.close(); b.closeAllConnections(); setActive(5473);
  const t0 = Date.now(); const pending = get("/");
  await sleep(700); const c = await node("C", 5473);
  assert.equal(await pending, "C"); assert.ok(Date.now() - t0 >= 700);
  console.log(`PASS hold: a request with no node answering waited ${Date.now() - t0} ms and was served by the next node`);
  c.close(); c.closeAllConnections();
  const t1 = Date.now(); await assert.rejects(get("/")); assert.ok(Date.now() - t1 >= 3900);
  console.log("PASS give up: with no node for AB_FRONT_WAIT_MS the connection closes");
} finally { front.kill("SIGTERM"); a.close(); b.close(); }
