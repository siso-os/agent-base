// Synthetic, in-memory contract checks. No account, task store, run log or process is read.
// AB_TEST_DEPENDENCIES points at an existing checkout with installed dependencies (read only).
import assert from "node:assert/strict";
import fs from "node:fs";
import childProcess from "node:child_process";
import { createRequire, syncBuiltinESMExports } from "node:module";
import { mock } from "node:test";
import vm from "node:vm";
import path from "node:path";

const require = createRequire(import.meta.url);
const dependencies = process.env.AB_TEST_DEPENDENCIES;
assert.ok(dependencies, "Set AB_TEST_DEPENDENCIES to an existing dependency checkout");
const ts = require(path.join(dependencies, "apps/web/node_modules/typescript"));
const source = fs.readFileSync(new URL("../../../apps/web/src/components/Timeline.tsx", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } });
const api = {};
vm.runInNewContext(compiled.outputText, { exports: api, require: () => ({}) });
const evidence = api.momentEvidence;
const base = { id: "synthetic", t: "2026-10-06T10:00:00Z", title: "Synthetic change", text: "", who: "FIXTURE", state: "done" };
assert.equal(evidence({ ...base, k: "soul" }), "No preview evidence · delivery unverified");
for (const state of ["done", "live", "tested", "built", "preview", "failed", "blocked"]) {
  assert.equal(evidence({ ...base, k: "task", state }), "No preview evidence · delivery unverified");
}
assert.equal(evidence({ ...base, k: "shipped", state: "live" }), "Deployment recorded · no preview evidence · live behavior unverified");
assert.equal(evidence({ ...base, k: "shipped", state: "landed", gallery: "/fixture/index.html" }), "Preview evidence attached · live behavior unverified");
assert.equal(evidence({ ...base, k: "soul", pair: { before: "/before.svg", after: "/after.svg" } }), "Preview evidence attached · delivery unverified");
assert.equal(evidence({ ...base, k: "page", url: "https://invalid.example" }), "Link posted · behavior unverified");

// All pipeline filesystem roots are virtual; process requests are mocked before import.
const root = "/__ab_achievements_fixture__";
Object.assign(process.env, {
  AB_TIMELINE_REPO: root, AB_TIMELINE_RUNS: root + "/runs", AB_CODEX_RUNS: root + "/runs",
  AB_A0_TASKS: root + "/tasks", AB_QUEUE_STATE: root + "/queue", AB_RELEASE_NOTES: root + "/notes.jsonl",
  AB_TIMELINE_GALLERIES: root + "/galleries",
});
const files = new Map();
const accesses = [];
const checked = (name) => { const value = String(name); assert.ok(value.startsWith(root + "/") || value === root, `Unbound read: ${value}`); accesses.push(value); return value; };
const sha = "a".repeat(40), deployed = "b".repeat(40);
const taskHistory = [{ at: base.t, by: "FIXTURE", stage: "built", note: "Useful outcome from the owner" }, { at: base.t, by: "FIXTURE", stage: "tested", note: "set next" }];
const states = ["live", "queued", "merged", "landed", "failed", "conflict", "blocked", "rolled-back"];
files.set(root + "/queue/queue.jsonl", states.map((state) => JSON.stringify({ id: state, state, sha, live_sha: deployed, at: base.t, by: "FIXTURE", title: "Synthetic release", tests: "Synthetic check passed", why: state === "landed" ? "Deploy held" : state === "failed" ? "Synthetic check failed" : "", commits: [{ sha, subject: "Synthetic change" }] })).join("\n"));
files.set(root + "/notes.jsonl", JSON.stringify({ sha, title: "A useful outcome", why: "A synthetic reason" }) + "\n");
files.set(root + "/tasks/INDEX.json", JSON.stringify({ tasks: [{ id: "fixture-task", owner: "FIXTURE" }] }));
files.set(root + "/tasks/fixture-task.json", JSON.stringify({ id: "fixture-task", owner: "FIXTURE", title: "Synthetic task", stage: "tested", short: "  Clean task name  ", updated: base.t, history: taskHistory }));
files.set(root + "/runs/fixture.meta.json", JSON.stringify({ name: "FIXTURE", title: "Synthetic run", started: base.t, ended: base.t }));
files.set(root + "/runs/fixture.last.md", "STATUS: done\nSynthetic return, not shipping evidence.");
mock.method(fs, "readFileSync", (file) => { const value = files.get(checked(file)); if (value === undefined) throw Error("Fixture file absent"); return value; });
mock.method(fs, "readdirSync", (dir) => checked(dir) === root + "/runs" ? ["fixture.meta.json"] : []);
mock.method(fs, "statSync", (file) => { checked(file); return { size: 0, mtimeMs: Date.parse(base.t), isFile: () => true }; });
mock.method(fs, "realpathSync", (file) => checked(file));
mock.method(childProcess, "execFile", (command, args, options, callback) => {
  assert.equal(command, "git"); assert.equal(options.cwd, root);
  setImmediate(() => callback(null, ""));
});
syncBuiltinESMExports();
try {
  const { pipelineMoments } = await import("../src/timeline.ts");
  pipelineMoments({ all: true, who: ["FIXTURE"] });
  await new Promise(setImmediate);
  const result = pipelineMoments({ all: true, who: ["FIXTURE"] });
  assert.equal(result.landed.length, 1);
  assert.equal(result.landed[0].revision, deployed, "Use deployed revision, not queued revision");
  assert.equal(result.landed[0].note.title, "A useful outcome");
  assert.deepEqual(result.pending.filter(m => m.k === "shipped").map(m => m.state).sort(), states.filter(s => s !== "live").sort());
  assert.equal(result.pending.find(m => m.state === "landed").reason, "Deploy held");
  assert.equal(result.pending.find(m => m.state === "failed").reason, "Synthetic check failed");
  assert.equal(result.moments.find(m => m.k === "soul").state, "done");
  assert.equal(result.moments.find(m => m.k === "task").state, "tested");
  const task = result.pending.find(m => m.id === "built:fixture-task");
  assert.equal(task.short, "Clean task name");
  assert.equal(task.outcome, "Useful outcome from the owner", "bookkeeping notes never replace useful owner evidence");
  assert.equal(api.headline(task), "Tested: Clean task name");
  assert.equal(api.outcomeOf(task), "Useful outcome from the owner");
  assert.equal(result.moments.filter(m => m.k === "shipped").length, 1, "Completed run/task must not become release events");
  assert.ok(accesses.length > 0);
  console.log("PASS: 12 evidence cases; 8 queue states; deployed revision, failure reasons, note outcome; pending task short/outcome preserved; run/task completion remains activity; all reads/processes fixture-bound");
} finally {
  mock.restoreAll(); syncBuiltinESMExports();
}
