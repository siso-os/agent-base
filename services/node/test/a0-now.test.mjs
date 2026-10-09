import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer } from "node:http";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

const repo = path.resolve(import.meta.dirname, "../../..");
mkdirSync(path.join(repo, ".lab-pair/tmp"), { recursive: true });
const scratch = mkdtempSync(path.join(repo, ".lab-pair/tmp/a0-now-"));
Object.assign(process.env, { AB_HOME: scratch, AB_CODEX_HOME: path.join(scratch, ".codex"), AB_HUD_DIR: path.join(scratch, "hud"), AB_TOKENS_CACHE: path.join(scratch, "tokens.json"), AB_A0NOW_PAIR_STATE: scratch, AB_A0NOW_LIVE_FILE: path.join(scratch, "LIVE") });
writeFileSync(process.env.AB_A0NOW_LIVE_FILE, "abcdef0123456\n");
const command = path.join(scratch, "source.mjs");
writeFileSync(command, `import {readFileSync,appendFileSync} from 'node:fs';
import path from 'node:path';
const key=process.argv[2], root=import.meta.dirname;
appendFileSync(path.join(root,key+'.count'),'call\\n');
const config=JSON.parse(readFileSync(path.join(root,key+'.json'),'utf8'));
if(config.mode==='timeout')setInterval(()=>{},1000);
else if(config.mode==='badjson')console.log('{broken');
else if(config.mode==='fail')process.exit(1);
else{console.log(JSON.stringify(config.data));process.exit(config.exit??0);}`);
const sources = ["LANES", "STACK", "RENEWALS", "NEEDS", "SHIP", "BUDGET"];
for (const key of sources) process.env[`AB_A0NOW_${key}_CMD`] = `${process.execPath} ${command} ${key}`;
const realNow = Date.now;
let now = new Date(2026, 9, 3, 12).getTime();
Date.now = () => now;
const iso = (offset) => new Date(now + offset).toISOString();
const laneData = { at: now / 1000, tabs: [{ tab: "fixture lane", pane: "w1:p2", status: "working", model: "gpt-6-luna", cwd: "/fixture/repo", branch: "dev", worked: "Worked for 1m", said: ["fixture words"] }], pairs: [{ pair: "ab", done: 1, open: 1, blocked: [], next: "P2 Next", commits: ["abcdef0 commit"], pane: "w1:p2", model: "gpt-6-luna" }], runs: [{ at: "10:30", model: "gpt-6-luna", dir: "fixture/repo", min: 1, mtok: 1, status: "done", task: "fixture run" }] };
const plan = path.join(scratch, "PLAN.md");
writeFileSync(plan, "# Fixture\n- [x] P1 First | files: fixture (abcdef0)\n- [ ] P2 Next | files: fixture\n");
writeFileSync(path.join(scratch, "pairs.json"), JSON.stringify({ ab: { plan } }));
const needsData = { tasks: Array.from({ length: 5 }, (_, i) => ({ id: `n${i}`, title: `fresh ${i}`, status: "needs-shaan", created: iso(-(i + 1) * 3600_000), note: "fixture reason" })).concat([
  { id: "old", title: "old", status: "needs-shaan", created: iso(-48 * 3600_000 - 1) },
  { id: "future", title: "future", status: "needs-shaan", created: iso(1) },
  { id: "done", title: "done", status: "done", created: iso(-1) },
]) };
const shipData = Array.from({ length: 16 }, (_, i) => ({ id: `s${i}`, branch: `fixture-${i}`, state: i === 0 ? "queued" : "live", landed_at: iso(-(i + 1) * 60_000), live_at: i === 0 ? null : iso(-(i + 1) * 60_000 + 1000) }));
shipData.push({ id: "old", state: "live", live_at: iso(-24 * 3600_000) });
const fixtures = { LANES: laneData, STACK: [{ level: "red", check: "fixture", msg: "fixture stack problem" }], RENEWALS: [{ name: "fixture plan", kind: "codex", status: "past_due", days_left: 3, renews_local: "Thu 04:09" }], NEEDS: needsData, SHIP: shipData, BUDGET: { claude: [{ name: "fixture profile", usedPct: 84, resetsAt: now + 3 * 86400_000 }], codex: { balance: 56600 } } };
const configure = (key, config) => writeFileSync(path.join(scratch, `${key}.json`), JSON.stringify(config));
for (const key of sources) configure(key, { data: fixtures[key], exit: ["STACK", "RENEWALS"].includes(key) ? 1 : 0 });
const counts = () => Object.fromEntries(sources.map((key) => [key, readFileSync(path.join(scratch, `${key}.count`), "utf8").trim().split("\n").length]));
const { handleA0Now } = await import("../src/a0-now.ts");
const { codexLanes } = await import("../src/codex-lanes.ts");
const server = createServer(async (req, res) => { if (!await handleA0Now(req, res, new URL(req.url, "http://fixture"))) res.writeHead(404).end(); });

test("Agent Zero Now isolates sources, caches reads and exposes bounded actionable state", async (t) => {
  try {
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    const get = async () => { const r = await fetch(`${base}/api/a0/now`); assert.equal(r.status, 200); return r.json(); };
    await t.test("one reader per source, valid nonzero health output, fresh needs, real live stamp and plan items", async () => {
      assert.equal((await fetch(`${base}/api/a0/now`, { method: "POST" })).status, 405);
      const responses = await Promise.all([get(), get()]); const body = responses[0];
      for (const key of sources) { assert.equal(body[key.toLowerCase()].error, null, key); assert.equal(counts()[key], 1, key); }
      assert.deepEqual(body.needs.data.items.map((n) => n.id), ["n0", "n1", "n2"]); assert.equal(body.needs.data.total, 5);
      assert.equal(body.ship.data.liveSha, "abcdef0123456"); assert.deepEqual(body.ship.data.queued.map((r) => r.id), ["s0"]);
      assert.deepEqual(body.lanes.data.pairs[0].items.map((i) => [i.id, i.state, i.sha]), [["P1", "done", "abcdef0"], ["P2", "open", null]]);
      assert.equal(body.today.data.length, 12); assert.ok(body.today.data.every((e) => ["landed", "live", "done", "blocked"].includes(e.state)));
      assert.ok(body.today.data.every((e, i, a) => !i || a[i - 1].at >= e.at));
      await codexLanes(process.env.AB_A0NOW_LANES_CMD); assert.equal(counts().LANES, 1, "full page and Now reuse the lane runner");
    });
    await t.test("each source keeps its own 10s / 60s / 10min cache", async () => {
      now += 10_000; await get(); const ten = counts(); assert.equal(ten.LANES, 2); assert.equal(ten.NEEDS, 2); assert.equal(ten.SHIP, 2); assert.equal(ten.STACK, 1); assert.equal(ten.RENEWALS, 1);
      now += 60_000; await get(); assert.equal(counts().STACK, 2); assert.equal(counts().BUDGET, 2); assert.equal(counts().RENEWALS, 1);
      now += 600_000; await get(); assert.equal(counts().RENEWALS, 2);
    });
    await t.test("one corrupt source never blanks any of the other sources", async () => {
      for (const key of sources) {
        configure(key, { mode: "badjson" }); now += 600_000;
        const body = await get(); assert.equal(body[key.toLowerCase()].data, null); assert.match(body[key.toLowerCase()].error, /unavailable/);
        for (const other of sources.filter((s) => s !== key)) assert.equal(body[other.toLowerCase()].error, null, other);
        assert.ok(Array.isArray(body.today.data)); configure(key, { data: fixtures[key] }); now += 600_000; await get();
      }
    });
    await t.test("timeout is bounded and preserves the usable blocks", async () => {
      configure("STACK", { mode: "timeout" }); now += 600_000;
      const started = performance.now(), body = await get();
      assert.ok(performance.now() - started < 12_000); assert.equal(body.stack.data, null); assert.equal(body.lanes.error, null); assert.equal(body.ship.error, null);
      configure("STACK", { data: fixtures.STACK });
    });
    await t.test("observed lane/item transitions appear once; old or queued events do not pretend to be today", async () => {
      laneData.tabs[0].status = "done"; configure("LANES", { data: laneData });
      writeFileSync(plan, "- [x] P1 First (abcdef0)\n- [x] P2 Next (123abcd)\n"); now += 600_000;
      const body = await get(); const changes = body.today.data.filter((e) => e.observed);
      assert.equal(changes.length, 2); assert.ok(changes.some((e) => e.text.includes("P2 done")));
      const again = await get(); assert.equal(again.today.data.filter((e) => e.observed).length, 2);
      assert.ok(!again.today.data.some((e) => e.text.startsWith("old ") || e.state === "queued"));
    });
  } finally {
    await new Promise((resolve) => server.close(resolve)); Date.now = realNow; rmSync(scratch, { recursive: true, force: true });
  }
});
