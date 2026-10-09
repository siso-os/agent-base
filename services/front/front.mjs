#!/usr/bin/env node
// Agent Base's front door (t-0539): owns 127.0.0.1:5401 and hands each new connection to the node that is live now.
//
// Shaan, 8 Oct 19:17: "my agent base keeps reloading like every 60 seconds, it takes 60 to 120 seconds to reload every
// single time". A deploy used to quit the app, swap files under the running checkout and start node again in the same
// port, so the window was gone for the whole start. Now a deploy (tools/ab-switch) starts the new node in a free slot
// beside the old one, checks it, and writes its port to active.json; this front sends new connections there from that
// moment, while the old node's open sockets finish and then close (the page reconnects, to the new node).
//
// Raw TCP, so HTTP, SSE and the terminal websockets pass through untouched. A connection that arrives while no node
// answers is held, not refused: it is retried every 100 ms for AB_FRONT_WAIT_MS (15 s), so a node restart reads as a
// slow request rather than an error. Zero dependencies, loopback only. It never changes with a deploy: install it again
// (tools/ab-switch install-front) only when this file changes.
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";

const PORT = Number(process.env.AB_FRONT_PORT ?? 5401);
const ACTIVE = process.env.AB_FRONT_ACTIVE ?? path.join(os.homedir(), ".local/state/agent-base/live/active.json");
const WAIT_MS = Number(process.env.AB_FRONT_WAIT_MS ?? 15_000);
const log = (event, more = {}) => console.log(JSON.stringify({ at: new Date().toISOString(), event, ...more }));

/** The live node's port from active.json, re-read only when the file changes; 0 when there is none. */
let seen = { stamp: "", port: 0 };
function backend() {
  try {
    const st = fs.statSync(ACTIVE), stamp = `${st.ino}:${st.mtimeMs}:${st.size}`;
    if (stamp !== seen.stamp) {
      const port = Number(JSON.parse(fs.readFileSync(ACTIVE, "utf8")).port);
      seen = { stamp, port: Number.isInteger(port) && port > 0 && port < 65536 && port !== PORT ? port : 0 };
      log("active", { port: seen.port });
    }
  } catch { /* missing or half-written: keep the last good port */ }
  return seen.port;
}

let held = 0;
const server = net.createServer({ pauseOnConnect: true }, (client) => {
  client.setNoDelay(true);
  const born = Date.now();
  let upstream = null, closed = false, waiting = false;
  const settle = () => { if (waiting) { waiting = false; held--; } };
  const end = () => { if (closed) return; closed = true; settle(); upstream?.destroy(); client.destroy(); };
  client.on("error", end).on("close", end);
  const attempt = () => {
    if (closed) return;
    const port = backend();
    const retry = () => {
      if (closed) return;
      if (!waiting) { waiting = true; held++; }
      if (Date.now() - born < WAIT_MS) setTimeout(attempt, 100);
      else { log("no-node", { port, waitedMs: Date.now() - born }); end(); }
    };
    if (!port) return retry();
    const socket = net.connect({ host: "127.0.0.1", port });
    socket.once("error", () => { socket.destroy(); if (!upstream) retry(); });
    socket.once("connect", () => {
      if (closed) return socket.destroy();
      upstream = socket;
      socket.setNoDelay(true);
      // The node closing ends the client gracefully, so a reply still in flight is not cut short.
      socket.on("error", end).on("close", () => client.end());
      settle();
      client.pipe(socket); socket.pipe(client); client.resume();
    });
  };
  attempt();
});

// At cutover the app's own node still holds 5401 for a moment: keep asking for the port instead of exiting.
server.on("error", (e) => {
  if (e.code !== "EADDRINUSE") throw e;
  setTimeout(() => server.listen(PORT, "127.0.0.1"), 250);
});
server.on("listening", () => log("listening", { port: PORT, active: ACTIVE, node: backend() }));
server.listen(PORT, "127.0.0.1");
setInterval(() => { if (held) log("holding", { connections: held }); }, 5_000).unref();
for (const signal of ["SIGTERM", "SIGINT"]) process.once(signal, () => { server.close(); setTimeout(() => process.exit(0), 200).unref(); });
