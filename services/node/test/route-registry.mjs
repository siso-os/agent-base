// Route modules (services/node/src/routes/*.route.ts) load and dispatch; a bad module is refused; no match falls through.
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { dispatchRoute, loadRoutes } from "../src/routes/registry.ts";

const scratch = mkdtempSync(path.join(tmpdir(), ".siso-ephemeral-route-registry."));
process.on('exit', () => rmSync(scratch, { recursive: true, force: true }));
const dir = path.join(scratch, "routes");
mkdirSync(dir);
writeFileSync(path.join(dir, "probe.route.ts"), `export const route = { method: "GET", path: /^\\/api\\/registry-probe\\/(\\w+)$/, handle: (_req, res, m) => { res.status = 200; res.body = m[1]; } };\n`);
writeFileSync(path.join(dir, "notes.txt"), "not a route");
const routes = await loadRoutes(dir);
assert.equal(routes.length, 1);
const res = {};
assert.equal(await dispatchRoute(routes, { method: "GET" }, res, "/api/registry-probe/abc"), true);
assert.deepEqual(res, { status: 200, body: "abc" });
assert.equal(await dispatchRoute(routes, { method: "POST" }, {}, "/api/registry-probe/abc"), false);
assert.equal(await dispatchRoute(routes, { method: "GET" }, {}, "/api/registry-missing"), false);
writeFileSync(path.join(dir, "bad.route.ts"), "export const route = { method: 'GET' };\n");
await assert.rejects(loadRoutes(dir), /invalid route module: bad.route.ts/);
assert.deepEqual(await loadRoutes(path.join(scratch, "none")), []);
const calls = [];
const explicit = [
  { method: null, path: /^\/api\//, handle: () => { calls.push('area'); return false; } },
  { method: 'GET', path: /^\/api\/probe$/, handle: () => { calls.push('legacy'); return false; } },
  { method: null, path: /^\/api\//, handle: () => { calls.push('last'); } },
];
assert.equal(await dispatchRoute(explicit, { method: 'GET' }, {}, '/api/probe'), true);
assert.deepEqual(calls, ['area', 'legacy'], 'old string-method handlers still consume their match even if they return false');
calls.length = 0;
assert.equal(await dispatchRoute(explicit, { method: 'PATCH' }, {}, '/api/probe'), true);
assert.deepEqual(calls, ['area', 'last'], 'an explicitly registered area can preserve method-specific fall-through');
writeFileSync(path.join(dir, 'bad.route.ts'), 'export const route = { method: null, path: /^\\//, handle() {} };\n');
await assert.rejects(loadRoutes(dir), /invalid route module/, 'filename loading cannot opt into area dispatch');
console.log("route registry: PASS legacy method/path/return behavior, explicit area ordering and fall-through, malformed and area filename refusal, missing folder, ephemeral cleanup");
