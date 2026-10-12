// /api/usage/tasks serves the harness file, and asks for a refresh (one run) when it is missing or old.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
const dir = mkdtempSync(path.join(tmpdir(), "ut-"));
process.env.AB_USAGE_TASKS_FILE = path.join(dir, "u.json");
process.env.AB_USAGE_TASKS_SCRIPT = path.join(dir, "fake.py");
writeFileSync(process.env.AB_USAGE_TASKS_SCRIPT, "import sys,json\nopen(sys.argv[sys.argv.index('--json')+1],'w').write(json.dumps({'usd':5,'waste':{'fetch':3}}))\n");
const { handleUsageTasks } = await import("../src/usage-tasks.ts");
const call = async () => { let body = ""; const res = { writeHead() {}, end(b) { body = b; } };
  const hit = await handleUsageTasks({ method: "GET" }, res, new URL("http://n/api/usage/tasks")); return { hit, body: JSON.parse(body || "{}") }; };
test("missing file: not ready, a refresh starts and writes it", async () => {
  const r = await call();
  assert.equal(r.hit, true); assert.equal(r.body.ready, false); assert.equal(r.body.refreshing, true);
  for (let i = 0; i < 50 && !existsSync(process.env.AB_USAGE_TASKS_FILE); i++) await new Promise((s) => setTimeout(s, 100));
  const again = await call();
  assert.equal(again.body.ready, true); assert.equal(again.body.usd, 5);
});
test("other paths fall through", async () => {
  assert.equal(await handleUsageTasks({ method: "GET" }, {}, new URL("http://n/api/usage")), false);
});
