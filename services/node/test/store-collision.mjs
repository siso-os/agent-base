// ed8a080 (overnight deep-dive): two processes saving one store must not share a .tmp file. It exercises the real jsonStore
// implementation with independent Node processes sharing one state file.
//
// node --experimental-strip-types --no-warnings services/node/test/store-collision.mjs
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import assert from "node:assert/strict";

const root = process.argv[2] === "worker" ? process.env.AB_STORE_COLLISION_ROOT : mkdtempSync(path.join(tmpdir(), "ab-store-collision-"));
const file = path.join(root, "rows.json");
const start = path.join(root, "START");
if (process.argv[2] !== "worker") writeFileSync(file, JSON.stringify({ seed: true }));

if (process.argv[2] === "worker") {
  const { jsonStore } = await import("../src/store.ts");
  while (!existsSync(start)) await new Promise((resolve) => setTimeout(resolve, 1));
  const id = Number(process.argv[3]);
  const store = jsonStore(file, (raw) => raw && typeof raw === "object" ? raw : {});
  const errors = [];
  for (let i = 0; i < 500; i++) {
    store.data[`worker_${id}`] = i;
    try { store.save(); } catch (error) { errors.push(String(error)); }
  }
  process.stdout.write(JSON.stringify({ id, errors }));
  process.exitCode = errors.length ? 1 : 0;
} else {
  const workers = Array.from({ length: 8 }, (_, id) => spawn(process.execPath, ["--experimental-strip-types", "--no-warnings", import.meta.filename, "worker", String(id)], { stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, AB_STORE_COLLISION_ROOT: root } }));
  await new Promise((resolve) => setTimeout(resolve, 50));
  writeFileSync(start, "go\n");
  const results = await Promise.all(workers.map((child) => new Promise((resolve) => {
    let out = "", err = "";
    child.stdout.on("data", (chunk) => { out += chunk; });
    child.stderr.on("data", (chunk) => { err += chunk; });
    child.on("close", (code) => resolve({ code, out, err }));
  })));
  let parsed = true;
  try { JSON.parse(readFileSync(file, "utf8")); } catch { parsed = false; }
  const workersSummary = results.map((r) => {
    let value = {};
    try { value = JSON.parse(r.out); } catch {}
    return { code: r.code, errors: value.errors?.length ?? null, sample: value.errors?.[0] ?? null };
  });
  console.log(JSON.stringify({ file, parsed, workers: workersSummary }));
  rmSync(root, { recursive: true, force: true });
  assert.ok(parsed && workersSummary.every((r) => r.code === 0 && r.errors === 0), "every save completes without a cross-process temporary-file collision");
}
