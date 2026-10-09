// GET /api/ship (SPEC-STATS-TASKS §3.5.1): the node folds a fixture queue.jsonl exactly as `tools/ab-queue status --json`
// does on the same file, and today's summary (live, deploys, built → live minutes, waiting, the deploy gap) is right.
// Fixture lanes in a scratch AB_QUEUE_STATE only; never his ship queue. Run: node --experimental-strip-types services/node/test/ship.mjs
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import http from "node:http";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const REPO = path.join(import.meta.dirname, "../../..");
const dir = mkdtempSync(path.join(tmpdir(), ".ab-ship-"));
process.env.AB_QUEUE_STATE = dir;
const { foldQueue, handleShip, shipSummary } = await import("../src/ship.ts");

// Today at local noon; every event is a time of this day (so the check passes at any hour), plus one lane from yesterday.
const noon = new Date();
noon.setHours(12, 0, 0, 0);
const at = (hhmm, dayOff = 0) => {
  const d = new Date(noon);
  d.setDate(d.getDate() + dayOff);
  d.setHours(Number(hhmm.slice(0, 2)), Number(hhmm.slice(3)), 0, 0);
  return d.toISOString();
};
const ev = [];
const lane = (id, branch, by, built, steps, dayOff = 0) => {
  ev.push({ at: at(steps[0][1], dayOff), id, state: "queued", branch, sha: `${id}0000`, tests: "", by, built_at: at(built, dayOff) });
  for (const [state, t, extra] of steps.slice(1)) ev.push({ at: at(t, dayOff), id, state, ...(extra ?? {}) });
};
lane("a1", "luna/a", "LUNA-A", "07:50", [["queued", "08:00"], ["merged", "08:05"], ["landed", "08:10", { landed_sha: "x", why: "" }], ["live", "08:30", { live_sha: "x" }]]);
lane("b2", "sol/b", "SOL-B", "08:40", [["queued", "08:42"], ["landed", "08:50", { why: "" }], ["live", "09:00", { live_sha: "y" }]]);
lane("c3", "luna/c", "LUNA-C", "09:00", [["queued", "09:05"], ["conflict", "09:10", { why: "conflicts with main: apps/web/src/App.tsx" }]]);
lane("d4", "luna/d", "LUNA-D", "09:30", [["queued", "09:31"], ["failed", "09:50", { why: "checks red on the merged tip" }]]);
lane("e5", "sol/desktop", "SOL-E", "10:00", [["queued", "10:01"], ["landed", "10:20", { why: "deploy held: apps/desktop changed (needs HEALTH's GO)" }]]);
lane("f6", "luna/f", "LUNA-F", "10:30", [["queued", "10:31"], ["landed", "11:30", { why: "" }], ["live", "11:45", { live_sha: "z" }]]);
lane("g7", "luna/g", "LUNA-G", "10:35", [["queued", "10:36"], ["dropped", "10:40"]]);
lane("h8", "luna/old", "LUNA-H", "15:00", [["queued", "15:01"], ["live", "15:40", { live_sha: "w" }]], -1);
ev.sort((a, b) => a.at.localeCompare(b.at));
const queue = ev.map((e) => JSON.stringify(e)).join("\n") + "\n";
const deploys = [at("15:40", -1), at("08:30"), at("09:00"), at("11:45")].map((t, i) => JSON.stringify({ sha: `s${i}`, at: t, ids: [] })).join("\n") + "\n";
writeFileSync(path.join(dir, "queue.jsonl"), queue);
writeFileSync(path.join(dir, "deploy.jsonl"), deploys);

let server;
try {
  // 1. The fold is ab-queue's own (python, on the same file).
  const theirs = JSON.parse(execFileSync("python3", [path.join(REPO, "tools/ab-queue"), "status", "--json"], { env: { ...process.env, AB_QUEUE_STATE: dir }, encoding: "utf8" }));
  const ours = foldQueue(queue);
  assert.deepEqual(ours, theirs, "foldQueue matches ab-queue status --json");
  // The read-only dashboard tolerates a torn line; ab-queue intentionally refuses
  // an invalid journal before acting. Compare their folds only on a valid journal.
  assert.deepEqual(foldQueue(queue + "not json\n"), ours);

  // 2. Today's summary at 12:00.
  const s = shipSummary(ours, deploys, noon.getTime());
  assert.equal(s.today.live, 3, "three lanes went live today");
  assert.equal(s.today.deploys, 3, "three deploys today, yesterday's not counted");
  assert.deepEqual(s.today.leadMin, { median: 40, min: 20, max: 75 }, "built → live minutes");
  assert.equal(s.today.waiting, 1, "the held desktop lane waits");
  assert.deepEqual([s.today.conflict, s.today.failed, s.today.dropped], [1, 1, 1]);
  assert.equal(s.today.gaps.length, 1, "one gap over 45 min while something waited");
  assert.equal(s.today.gaps[0].from, at("09:00"));
  assert.equal(s.today.gaps[0].to, at("11:45"));
  assert.match(s.today.gaps[0].held ?? "", /^apps\/desktop changed/);
  assert.deepEqual(s.lanes.map((l) => l.id), ["a1", "b2", "c3", "d4", "e5", "f6", "g7"], "today's lanes by when they were built; yesterday's left out");
  assert.equal(s.lanes.find((l) => l.id === "e5").live_at, null, "a landed lane has no live time");
  assert.equal(s.lanes.find((l) => l.id === "a1").live_at, at("08:30"));

  // 3. The route answers the same shape, read-only.
  server = http.createServer(async (req, res) => {
    if (!(await handleShip(req, res, new URL(req.url, "http://local")))) res.writeHead(404).end();
  });
  await new Promise((ok) => server.listen(0, "127.0.0.1", ok));
  const base = `http://127.0.0.1:${server.address().port}`;
  const body = await (await fetch(`${base}/api/ship`)).json();
  assert.ok(body.at && body.today && Array.isArray(body.lanes), "GET /api/ship answers { at, today, lanes }");
  assert.ok(body.lanes.some((l) => l.id === "e5"), "a waiting lane is listed whatever the hour");
  assert.equal((await fetch(`${base}/api/ship`, { method: "POST" })).status, 405, "GET only");
  console.log(`ship: fold matches ab-queue on ${ours.length} lanes; today ${s.today.live} live, ${s.today.deploys} deploys, median ${s.today.leadMin.median} min, gap held "${s.today.gaps[0].held}"`);
} finally {
  server?.close();
  rmSync(dir, { recursive: true, force: true });
}
