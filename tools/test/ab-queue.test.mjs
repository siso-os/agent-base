// tools/ab-queue and tools/ab-live against a throwaway origin + checkout + merge worktree. No app, mini or network is touched:
// AB_QUEUE_CHECK / AB_QUEUE_DEPLOY / AB_LIVE_BUILD / AB_LIVE_QUIT / AB_LIVE_OPEN are fakes that record what they were asked.
//   node --test tools/test/ab-queue.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync, realpathSync, chmodSync, copyFileSync, readdirSync, unlinkSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import http from "node:http";
// These cases cover the in-gate suite path, kept behind AB_QUEUE_SUITES_GATE=1; the default gate is check + smoke only (A0, 4 Oct).
process.env.AB_QUEUE_SUITES_GATE ??= "1";

const TOOLS = path.join(import.meta.dirname, "..");
const QUEUE = path.join(TOOLS, "ab-queue"), LIVE = path.join(TOOLS, "ab-live");
const env0 = { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };

function sh(cwd, ...a) { return execFileSync("git", a, { cwd, env: env0, encoding: "utf8" }).trim(); }
function run(file, args, env, cwd) {
  return new Promise((res) => {
    const p = spawn(file, args, { cwd, env: { ...env0, ...env } });
    let out = "", err = "";
    p.stdout.on("data", (d) => (out += d)); p.stderr.on("data", (d) => (err += d));
    p.on("close", (status) => res({ status, out, err }));
  });
}
async function waitFor(pathname, predicate = () => true, timeout = 2000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (existsSync(pathname) && predicate(readFileSync(pathname, "utf8"))) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error(`timed out waiting for ${pathname}`);
}

// origin (bare), a checkout (the "repo"), a merge worktree, and lane branches pushed to origin.
function fixture() {
  const base = realpathSync(mkdtempSync(path.join(tmpdir(), "abq-")));
  const origin = path.join(base, "origin.git"), repo = path.join(base, "repo"), merge = path.join(base, "merge"), state = path.join(base, "state");
  execFileSync("git", ["init", "-q", "--bare", "-b", "main", origin]);
  execFileSync("git", ["clone", "-q", origin, repo], { env: env0 });
  mkdirSync(path.join(repo,'.agents'));writeFileSync(path.join(repo,'.agents/ship.json'),JSON.stringify({tests:'true'}));
  writeFileSync(path.join(repo, "shared.txt"), "line one\n"); sh(repo, "add", "."); sh(repo, "commit", "-qm", "base"); sh(repo, "push", "-q", "origin", "HEAD:main");
  sh(repo, "worktree", "add", "-q", "--detach", merge, "origin/main");
  const lane = (name, file, body) => {
    const source=path.join(base,name);sh(repo,'worktree','add','-q','-b',name,source,'origin/main');
    mkdirSync(path.dirname(path.join(source,file)),{recursive:true});writeFileSync(path.join(source, file), body); sh(source, "add", "."); sh(source, "commit", "-qm", name);
    sh(source, "push", "-q", "origin", name);return source;
  };
  const log = path.join(base, "calls.log");
  // The fake suite run: on a merged tip (AB_WITH_CHECK=1) a RED file fails "pnpm check"; the one suite "ui" scores 1/2 when a
  // BREAK file is in the tree, else 2/2 (main's baseline run is logged as "baseline").
  const suitesCmd = `if [ "$AB_WITH_CHECK" = 1 ]; then echo check >> ${log}; test ! -e RED || exit 1; else echo baseline >> ${log}; fi; `
    + `if [ "$AB_WITH_CHECK" = 1 ]; then bash -c "$AB_TESTS" || exit 1; fi; if [ -e BREAK ]; then echo '{"ui":{"passed":1,"of":2,"exit":1},"gone":{"missing":true}}'; else echo '{"ui":{"passed":2,"of":2,"exit":0}}'; fi`;
  const env = { AB_REPO: repo, AB_MERGE_WORKTREE: merge, AB_WORKSPACES_DIR:path.join(base,'receipts'), AB_QUEUE_STATE: state, AB_QUEUE_SKIP_GUARD: "1", AB_QUEUE_POLL_S: "0",
    AB_QUEUE_BASE_WORKTREE: path.join(base, "queue-base"), AB_QUEUE_AFFECTED_CMD: "printf 'ui\\n'", AB_QUEUE_SMOKE_CMD: "true", AB_QUEUE_MIN_GAP_MIN: "0", AB_QUEUE_SAMPLER: "none",
    // never the real a0-tell (it would type into a live pane, e.g. the caller's own via SISO_AGENT_NAME): a lane notifier that can't reach anyone
    AB_QUEUE_LANE_NOTIFY: "false", SISO_AGENT_NAME: "", AB_QUEUE_NO_SELF_UPDATE: "1", AB_QUEUE_A0_NOTIFY: "none",
    AB_QUEUE_SUITES_CMD: suitesCmd, AB_QUEUE_DEPLOY: `echo deploy >> ${log}; echo`, AB_QUEUE_NOTIFY: `sh -c 'echo "notify $0" >> ${log}'` };
  const calls = () => (existsSync(log) ? readFileSync(log, "utf8").trim().split("\n") : []);
  const status = async () => JSON.parse((await run(QUEUE, ["status", "--json"], env)).out);
  return { base, origin, repo, merge, state, lane, env, calls, status };
}

test("general releases execute declared checks and preserve dirty source before queue admission", async () => {
  const f=fixture(), source=f.lane('declared-red','.agents/ship.json',JSON.stringify({tests:'false'}));
  const original=sh(f.repo,'rev-parse','origin/main');
  const added=await run(QUEUE,['add','declared-red'],f.env);assert.equal(added.status,0,added.err);
  await run(QUEUE,['run','--once'],f.env);
  assert.equal((await f.status())[0].state,'failed');assert.equal(sh(f.repo,'rev-parse','origin/main'),original);assert.ok(!f.calls().includes('deploy'));
  const dirty=f.lane('dirty-source','dirty.txt','committed source\n');writeFileSync(path.join(dirty,'untracked.txt'),'keep author work\n');
  const denied=await run(QUEUE,['add','dirty-source'],f.env);assert.notEqual(denied.status,0);assert.match(denied.err,/dirty/);
  assert.equal(readFileSync(path.join(dirty,'untracked.txt'),'utf8'),'keep author work\n');assert.equal((await f.status()).length,1);
  const noChecks=f.lane('no-checks','.agents/ship.json','{}');const refused=await run(QUEUE,['add','no-checks'],f.env);assert.notEqual(refused.status,0);assert.match(refused.err,/declare the checks/);
});

test("two lanes land in one round: merged onto main, checks run ONCE, main fast-forwarded, one deploy, both live", async () => {
  const f = fixture();
  f.lane("lane-a", "a.txt", "a\n"); f.lane("lane-b", "b.txt", "b\n");
  for (const b of ["lane-a", "lane-b"]) assert.equal((await run(QUEUE, ["add", b, "--by", "W"], f.env)).status, 0);
  const r = await run(QUEUE, ["run", "--once"], f.env);
  assert.equal(r.status, 0, r.err);
  assert.deepEqual(f.calls(), ["check", "deploy"], "one tip check, no healthy baseline, one deploy");
  const main = sh(f.repo, "rev-parse", "origin/main");
  sh(f.repo, "fetch", "-q"); assert.ok(sh(f.repo, "ls-tree", "--name-only", "origin/main").includes("b.txt"));
  const rows = await f.status();
  assert.deepEqual(rows.map((x) => x.state), ["live", "live"]);
  const dep = JSON.parse(readFileSync(path.join(f.state, "deploy.jsonl"), "utf8").trim());
  assert.equal(dep.ids.length, 2); assert.equal(sh(f.repo, "rev-parse", "origin/main"), main);
});

test("a runner crash after landing leaves a retryable landed row", async () => {
  const f = fixture();
  f.lane("crash-after-land", "crash.txt", "x\n");
  await run(QUEUE, ["add", "crash-after-land"], f.env);
  const crash = { ...f.env, AB_QUEUE_DEPLOY: "kill -9 $(ps -o ppid= -p $$)" };
  const killed = await run(QUEUE, ["run", "--once"], crash);
  assert.notEqual(killed.status, 0, "fake deploy should kill the runner");
  let row = (await f.status())[0];
  assert.equal(row.state, "landed");
  assert.equal(row.why, "", "the crash window leaves landed with no deploy reason");
  const recovered = await run(QUEUE, ["run", "--once"], { ...f.env, AB_QUEUE_DEPLOY: "echo recovered" });
  assert.equal(recovered.status, 0, recovered.err);
  row = (await f.status())[0];
  assert.equal(row.state, "live");
});

test("runner flock permits exactly one simultaneous owner and releases after exit", async () => {
  const f = fixture();
  f.lane("lock-lane", "lock.txt", "x\n");
  await run(QUEUE, ["add", "lock-lane"], f.env);
  const env = { ...f.env, AB_QUEUE_SUITES_CMD: "sleep 1; echo '{\"ui\":{\"passed\":2,\"of\":2}}'" };
  const first = run(QUEUE, ["run", "--once"], env);
  await waitFor(path.join(f.state, "runner.pid"));
  const second = await run(QUEUE, ["run", "--once"], env);
  assert.equal(second.status, 3, second.err);
  assert.equal((await first).status, 0);
  const third = await run(QUEUE, ["run", "--once"], env);
  assert.equal(third.status, 0, third.err);
});

test("runner flock releases after a crashed owner", async () => {
  const f = fixture();
  f.lane("crash-lane", "crash.txt", "x\n");
  await run(QUEUE, ["add", "crash-lane"], f.env);
  const release = path.join(f.base, 'release-crash-fixture');
  const barrier = `import pathlib,time; end=time.monotonic()+15\nwhile not pathlib.Path(${JSON.stringify(release)}).exists() and time.monotonic()<end: time.sleep(.02)`;
  const quoted = "'" + barrier.replaceAll("'", "'\\''") + "'";
  const env = { ...f.env, AB_QUEUE_SUITES_CMD: `python3 -c ${quoted}; echo '{"ui":{"passed":2,"of":2}}'` };
  const first = spawn(QUEUE, ["run", "--once"], { cwd: f.repo, env: { ...env0, ...env } });
  await waitFor(path.join(f.state, "runner.pid"), (pid) => pid.trim() === String(first.pid), 10000);
  assert.equal(first.exitCode, null, "owner must still be alive before the crash injection");
  first.kill("SIGKILL");
  writeFileSync(release, 'release owned fixture child');
  await new Promise((resolve) => first.once("close", resolve));
  const next = await run(QUEUE, ["run", "--once"], env);
  assert.equal(next.status, 0, next.err);
});

test("a conflicting lane is handed back with its files; a lane whose checks are red is bounced alone; the good lane lands", async () => {
  const f = fixture();
  f.lane("good", "g.txt", "g\n");
  f.lane("clash", "shared.txt", "lane edit\n");
  f.lane("red", "RED", "x\n");
  await run(QUEUE, ["add", "clash", "--by", "W"], f.env);
  // main moves under the queued clash lane; clean independent lanes reconcile before admission.
  sh(f.repo, "checkout", "-q", "-B", "tmp", "origin/main"); writeFileSync(path.join(f.repo, "shared.txt"), "main edit\n"); sh(f.repo, "commit", "-qam", "main moves"); sh(f.repo, "push", "-q", "origin", "HEAD:main");
  for (const b of ["red", "good"]) { const wt=path.join(f.base,b);sh(wt,"merge","-q","--no-edit","origin/main");sh(wt,"push","-q","origin",b);await run(QUEUE,["add",b,"--by","W"],f.env); }
  const r = await run(QUEUE, ["run", "--once"], f.env);
  assert.equal(r.status, 0, r.err);
  const by = Object.fromEntries((await f.status()).map((x) => [x.branch, x]));
  assert.equal(by.clash.state, "conflict"); assert.match(by.clash.why, /rebased|Git evidence/);
  assert.equal(by.red.state, "failed"); assert.equal(by.good.state, "live");
  sh(f.repo, "fetch", "-q");
  const tree = sh(f.repo, "ls-tree", "--name-only", "origin/main");
  assert.ok(tree.includes("g.txt") && !tree.includes("RED"), "only the good lane reached main");
  // 3 Oct (Shaan: an owner "just getting pinged ... a waste of tokens"): an unreachable lane's notice is not forwarded to the owner.
  assert.ok(!f.calls().some((c) => c.startsWith("notify (for ")), "no pane: nothing is forwarded to the owner");
});

test("alarm: anything built longer ago than AB_QUEUE_ALARM_MIN and not live is announced once; status --alarm exits 1", async () => {
  const f = fixture();
  f.lane("slow", "s.txt", "s\n");
  const env = { ...f.env, AB_QUEUE_ALARM_MIN: "0", AB_QUEUE_SUITES_CMD: "exit 1" };
  await run(QUEUE, ["add", "slow"], env);
  await run(QUEUE, ["run", "--once"], env); await run(QUEUE, ["run", "--once"], env);
  assert.equal(f.calls().filter((c) => /slow/.test(c) && c.startsWith("notify")).length, 2, "one failure notice + one alarm, not repeated");
  assert.equal((await run(QUEUE, ["status", "--alarm", "0"], env)).status, 1);
});

// ---------------------------------------------------------------- ab-live

function liveFixture({ artifact = false } = {}) {
  const base = mkdtempSync(path.join(tmpdir(), "abl-"));
  const repo = path.join(base, "checkout"); mkdirSync(repo);
  if (artifact) writeFileSync(path.join(repo, '.gitignore'), 'apps/web/dist/\n.lab-checked-release/\n');
  sh(repo, "init", "-q", "-b", "main");
  for (const [p, b] of [["apps/web/src/App.tsx", "v1"], ["services/node/src/server.ts", "import x from '../../../apps/web/src/lib/org-types.ts'\n"], ["apps/web/src/lib/org-types.ts", "t1"], ["apps/web/dist/index.html", "old"]]) {
    mkdirSync(path.dirname(path.join(repo, p)), { recursive: true }); writeFileSync(path.join(repo, p), b);
  }
  sh(repo, "add", "."); sh(repo, "commit", "-qm", "v1");
  const v1 = sh(repo, "rev-parse", "HEAD");
  writeFileSync(path.join(repo, "apps/web/dist/DEPLOYED_SHA"), v1 + "\n");
  const commit = (p, b) => { sh(repo, "checkout", "-q", "--detach", "HEAD"); mkdirSync(path.dirname(path.join(repo, p)), { recursive: true }); writeFileSync(path.join(repo, p), b); sh(repo, "add", p); sh(repo, "commit", "-qm", p); const s = sh(repo, "rev-parse", "HEAD"); sh(repo, "checkout", "-q", "main"); return s; };
  const log = path.join(base, "calls.log");
  const env = { AB_LIVE_CHECKOUT: repo, AB_LIVE_STATE: path.join(base, "state"), AB_LIVE_BUILD: "mkdir -p apps/web/dist && echo built-$(git rev-parse --short HEAD) > apps/web/dist/index.html",
    AB_LIVE_QUIT: `echo quit >> ${log}`, AB_LIVE_OPEN: `echo open >> ${log}`, AB_LIVE_WAIT_S: "5", AB_MINI: "/nonexistent",
    AB_LIVE_APP_PROC: "no-such-process-ab-live-test-" + process.pid, AB_LIVE_SKIP_RAM: "1" };  // never Shaan's running app
  const calls = () => (existsSync(log) ? readFileSync(log, "utf8").trim().split("\n") : []);
  return { base, repo, v1, commit, env, calls };
}

test("ab-live: a web-only change swaps the dist and stamps DEPLOYED_SHA without quitting the app", async () => {
  const f = liveFixture();
  const s = f.commit("apps/web/src/App.tsx", "v2");
  const r = await run(LIVE, [s], f.env);
  assert.equal(r.status, 0, r.out + r.err);
  assert.match(r.out, /\(web only: the app offers the reload; no restart\)/);
  assert.deepEqual(f.calls(), [], "the app was not quit or opened");
  assert.equal(readFileSync(path.join(f.repo, "apps/web/dist/DEPLOYED_SHA"), "utf8").trim(), s);
  assert.match(readFileSync(path.join(f.repo, "apps/web/dist/index.html"), "utf8"), /^built-/);
  assert.equal(sh(f.repo, "rev-parse", "HEAD"), f.v1, "the checkout's HEAD stays");
});

test("ab-live: a node change (or a web lib the node imports) restarts the app, checks out the node paths, and waits for the new sha", async () => {
  const f = liveFixture();
  const s = f.commit("apps/web/src/lib/org-types.ts", "t2");
  const srv = http.createServer((q, a) => a.end(JSON.stringify({ sha: s }))).listen(0, "127.0.0.1");
  await new Promise((r) => srv.on("listening", r));
  const r = await run(LIVE, [s], { ...f.env, AB_LIVE_PORT: String(srv.address().port) });
  srv.close();
  assert.equal(r.status, 0, r.out + r.err);
  assert.match(r.out, /\(node\)/);
  assert.deepEqual(f.calls(), ["quit", "open"]);
  assert.equal(readFileSync(path.join(f.repo, "apps/web/src/lib/org-types.ts"), "utf8"), "t2", "the node's web lib checked out at the sha");
});

test("ab-live: domain documents travel with the node for the Library reader", async () => {
  const f = liveFixture();
  const document = "domain-base/library/README.md";
  const s = f.commit(document, "Source-owned Library intent\n");
  const srv = http.createServer((q, a) => a.end(JSON.stringify({ sha: s }))).listen(0, "127.0.0.1");
  await new Promise((r) => srv.on("listening", r));
  let result;
  try { result = await run(LIVE, [s], { ...f.env, AB_LIVE_PORT: String(srv.address().port) }); }
  finally { srv.close(); }
  assert.equal(result.status, 0, result.out + result.err);
  assert.match(result.out, /\(node\)/);
  assert.equal(readFileSync(path.join(f.repo, document), "utf8"), "Source-owned Library intent\n");
  assert.deepEqual(f.calls(), ["quit", "open"]);
});

test("a red affected suite is diagnosed once on main and reported; already-red main is not a regression", async () => {
  const f = fixture();
  f.lane("breaks-ui", "BREAK", "x\n");
  await run(QUEUE, ["add", "breaks-ui"], f.env);
  await run(QUEUE, ["run", "--once"], f.env);
  let row = (await f.status())[0];
  assert.equal(row.state, "live"); assert.match(f.calls().join("\n"), /worse than main: ui 1\/2 \(main 2\/2\)/);
  assert.equal(f.calls().filter((c) => c === "baseline").length, 1, "only the red suite is diagnosed once on main");
  // main itself is red on ui (BREAK landed some other way): the same lane is no longer worse, so it lands
  sh(f.repo, "checkout", "-q", "-B", "m", "origin/main"); writeFileSync(path.join(f.repo, "BREAK"), "on main\n"); sh(f.repo, "add", "."); sh(f.repo, "commit", "-qm", "main red"); sh(f.repo, "push", "-q", "origin", "HEAD:main");
  f.lane("other", "o.txt", "o\n");
  await run(QUEUE, ["add", "other"], f.env);
  await run(QUEUE, ["run", "--once"], f.env);
  row = (await f.status()).find((r) => r.branch === "other");
  assert.equal(row.state, "live", "judged against main's own 1/2");
});

test("a suite present on main cannot disappear from the candidate's results", async () => {
  for (const result of ['{"ui":{"missing":true}}', '{}']) {
    const f = fixture();
    f.lane("removes-suite", "REMOVE-SUITE", "x\n");
    const env = { ...f.env, AB_QUEUE_SUITES_CMD: `if [ -e REMOVE-SUITE ]; then echo '${result}'; else echo '{"ui":{"passed":2,"of":2,"exit":0}}'; fi` };
    await run(QUEUE, ["add", "removes-suite"], env);
    await run(QUEUE, ["run", "--once"], env);
    const row = (await f.status())[0];
    assert.equal(row.state, "live", `candidate results ${result} must be diagnosed`);
    assert.match(f.calls().join("\n"), /worse than main: ui/);
    assert.ok(f.calls().includes("deploy"), "smoke green still deploys");
  }
});

test("new failing assertions and nonzero exits cannot hide behind an unchanged passing count", async () => {
  for (const score of [{ passed: 2, of: 3, exit: 1 }, { passed: 2, of: 2, exit: 1 }]) {
    const f = fixture();
    f.lane("new-failure", "NEW-FAILURE", "x\n");
    const env = { ...f.env, AB_QUEUE_SUITES_CMD: `if [ -e NEW-FAILURE ]; then echo '${JSON.stringify({ ui: score })}'; else echo '{"ui":{"passed":2,"of":2,"exit":0}}'; fi` };
    await run(QUEUE, ["add", "new-failure"], env);
    await run(QUEUE, ["run", "--once"], env);
    const row = (await f.status())[0];
    assert.equal(row.state, "live", `regressed score ${JSON.stringify(score)} must be diagnosed`);
    assert.ok(f.calls().includes("deploy"));
    assert.match(f.calls().join("\n"), /affected regression/);
  }
});

test("invalid parseable suite output fails the lane instead of crashing or passing", async () => {
  for (const output of [
    '{"log":"ok"}',
    '{"ui":{"passed":1,"of":0}}',
    '{"ui":{"passed":"1","of":2}}',
  ]) {
    const f = fixture();
    f.lane("bad-suite-shape", "bad.txt", "x\n");
    const env = { ...f.env, AB_QUEUE_SUITES_CMD: `if [ "$AB_BASELINE" = 1 ]; then echo '{"ui":{"passed":2,"of":2}}'; else echo '${output}'; fi` };
    await run(QUEUE, ["add", "bad-suite-shape"], env);
    const r = await run(QUEUE, ["run", "--once"], env);
    assert.equal(r.status, 0, r.err);
    const row = (await f.status())[0];
    assert.equal(row.state, "failed");
    assert.match(row.why, /invalid suite result shape/);
  }
});

test("suite scoring compares pass rates when the case counts change", async () => {
  const f = fixture();
  f.lane("rate-regression", "rate.txt", "x\n");
  const env = { ...f.env, AB_QUEUE_SUITES_CMD: `if [ "$AB_BASELINE" = 1 ]; then echo '{"ui":{"passed":9,"of":10}}'; else echo '{"ui":{"passed":9,"of":11}}'; fi` };
  await run(QUEUE, ["add", "rate-regression"], env);
  await run(QUEUE, ["run", "--once"], env);
  const row = (await f.status())[0];
  assert.equal(row.state, "live");
  assert.match(f.calls().join("\n"), /worse than main: ui 9\/11 \(main 9\/10\)/);
});

test("a higher pass rate with fewer raw passes is accepted", async () => {
  const f = fixture();
  f.lane("rate-improvement", "rate.txt", "x\n");
  const env = { ...f.env, AB_QUEUE_SUITES_CMD: `if [ "$AB_BASELINE" = 1 ]; then echo '{"ui":{"passed":2,"of":3}}'; else echo '{"ui":{"passed":1,"of":1}}'; fi` };
  await run(QUEUE, ["add", "rate-improvement"], env);
  await run(QUEUE, ["run", "--once"], env);
  assert.equal((await f.status())[0].state, "live");
});

test("a suite present and passing on main cannot disappear from the candidate", async () => {
  const f = fixture();
  f.lane("missing-regression", "missing.txt", "x\n");
  const env = { ...f.env, AB_QUEUE_AFFECTED_CMD: "printf 'ui\\ngone\\n'", AB_QUEUE_SUITES_CMD: `if [ "$AB_BASELINE" = 1 ]; then echo '{"ui":{"passed":2,"of":2},"gone":{"passed":2,"of":2}}'; else echo '{"ui":{"passed":2,"of":2},"gone":{"missing":true}}'; fi` };
  await run(QUEUE, ["add", "missing-regression"], env);
  await run(QUEUE, ["run", "--once"], env);
  const row = (await f.status())[0];
  assert.equal(row.state, "live");
  assert.match(f.calls().join("\n"), /worse than main: gone/);
});

test("an omitted candidate suite is reported as a regression without crashing", async () => {
  const f = fixture();
  f.lane("omitted-regression", "omitted.txt", "x\n");
  const env = { ...f.env, AB_QUEUE_AFFECTED_CMD: "printf 'ui\\ngone\\n'", AB_QUEUE_SUITES_CMD: `if [ "$AB_BASELINE" = 1 ]; then echo '{"ui":{"passed":2,"of":2},"gone":{"passed":2,"of":2}}'; else echo '{"ui":{"passed":2,"of":2}}'; fi` };
  await run(QUEUE, ["add", "omitted-regression"], env);
  await run(QUEUE, ["run", "--once"], env);
  const row = (await f.status())[0];
  assert.equal(row.state, "live");
  assert.match(f.calls().join("\n"), /worse than main: gone -\/- \(main 2\/2\)/);
});

test("invalid suite counts are rejected instead of silently accepted", async () => {
  const f = fixture();
  f.lane("invalid-score", "invalid.txt", "x\n");
  const env = { ...f.env, AB_QUEUE_SUITES_CMD: `if [ "$AB_BASELINE" = 1 ]; then echo '{"ui":{"passed":2,"of":2}}'; else echo '{"ui":{"passed":0,"of":0}}'; fi` };
  await run(QUEUE, ["add", "invalid-score"], env);
  await run(QUEUE, ["run", "--once"], env);
  const row = (await f.status())[0];
  assert.equal(row.state, "failed");
  assert.match(row.why, /invalid suite result shape/);
});

test("HEALTH's terms: deploys at least AB_QUEUE_MIN_GAP_MIN apart (held, not dropped), and the sampler gets the sha and HEALTH's notify", async () => {
  const f = fixture();
  const samp = path.join(f.base, "sampler"); writeFileSync(samp, `#!/bin/sh\necho "sampler $1 $AB_SAMPLE_NOTIFY" >> ${path.join(f.base, "calls.log")}\n`, { mode: 0o755 });
  const env = { ...f.env, AB_QUEUE_MIN_GAP_MIN: "10", AB_QUEUE_GUARD_WAIT_S: "0", AB_QUEUE_SAMPLER: samp, AB_QUEUE_HEALTH_NOTIFY: "a0-tell --queue w4:p1" };
  f.lane("one", "1.txt", "1\n"); await run(QUEUE, ["add", "one"], env); await run(QUEUE, ["run", "--once"], env);
  f.lane("two", "2.txt", "2\n"); await run(QUEUE, ["add", "two"], env); await run(QUEUE, ["run", "--once"], env);
  const by = Object.fromEntries((await f.status()).map((r) => [r.branch, r]));
  assert.equal(by.one.state, "live"); assert.equal(by.two.state, "landed"); assert.match(by.two.why, /HEALTH: at least 10 apart/);
  await new Promise((r) => setTimeout(r, 500));
  assert.ok(f.calls().some((c) => /^sampler [0-9a-f]{40} a0-tell --queue w4:p1$/.test(c)), "sampler started with the sha and HEALTH's notify");
});

test("ab-live: a desktop change without a built app does not block web+node: they ship, the desktop is logged as pending", async () => {
  const f = liveFixture();
  sh(f.repo, "checkout", "-q", "--detach", "HEAD");
  mkdirSync(path.join(f.repo, "apps/desktop/src"), { recursive: true }); writeFileSync(path.join(f.repo, "apps/desktop/src/lib.rs"), "fn main(){}");
  writeFileSync(path.join(f.repo, "apps/web/src/App.tsx"), "v2"); sh(f.repo, "add", "."); sh(f.repo, "commit", "-qm", "desktop + web");
  const s = sh(f.repo, "rev-parse", "HEAD"); sh(f.repo, "checkout", "-q", "main");
  const r = await run(LIVE, [s], f.env);
  assert.equal(r.status, 0, r.out + r.err);
  assert.match(r.out, /apps\/desktop changed \(apps\/desktop\/src\/lib.rs \); web\+node ship now/);
  assert.equal(readFileSync(path.join(f.repo, "apps/web/dist/DEPLOYED_SHA"), "utf8").trim(), s);
  const row = JSON.parse(readFileSync(path.join(f.base, "state", "live.jsonl"), "utf8").trim().split("\n").at(-1));
  assert.equal(row.result, "live"); assert.match(row.desktop_pending, /apps\/desktop\/src\/lib.rs/);
});

test("ab-live: a node ship never overwrites an edited file in the checkout (not HEAD, not the last deploy): refused, app untouched", async () => {
  const f = liveFixture();
  const s = f.commit("services/node/src/server.ts", "import x from '../../../apps/web/src/lib/org-types.ts' // v2\n");
  writeFileSync(path.join(f.repo, "services/node/src/server.ts"), "someone's uncommitted edit\n");
  const r = await run(LIVE, [s], f.env);
  assert.equal(r.status, 4); assert.match(r.out, /services\/node\/src\/server.ts is edited in the checkout/);
  assert.equal(readFileSync(path.join(f.repo, "services/node/src/server.ts"), "utf8"), "someone's uncommitted edit\n");
  assert.deepEqual(f.calls(), [], "the app was not quit");
});

test("ab-live: if the new sha never comes up, the old dist and node paths are put back and the app is reopened (never left closed)", async () => {
  const f = liveFixture();
  const s = f.commit("services/node/src/server.ts", "import x from '../../../apps/web/src/lib/org-types.ts' // v2\n");
  const srv = http.createServer((q, a) => a.end(JSON.stringify({ sha: "old" }))).listen(0, "127.0.0.1");
  await new Promise((r) => srv.on("listening", r));
  const r = await run(LIVE, [s], { ...f.env, AB_LIVE_PORT: String(srv.address().port), AB_LIVE_WAIT_S: "2" });
  srv.close();
  assert.equal(r.status, 1); assert.match(r.out, /did not come up; restoring/);
  assert.equal(f.calls().at(-1), "open", "the app is reopened last");
  assert.equal(readFileSync(path.join(f.repo, "apps/web/dist/index.html"), "utf8"), "old", "previous dist back");
  assert.match(readFileSync(path.join(f.repo, "services/node/src/server.ts"), "utf8"), /^import x[^\n]*\n$/, "previous node file back");
  assert.doesNotMatch(readFileSync(path.join(f.repo, "services/node/src/server.ts"), "utf8"), /v2/);
});

test("ab-live: a first domain package cannot prevent rollback of existing node files", async () => {
  const f = liveFixture();
  const node = f.commit("services/node/src/server.ts", "import x from '../../../apps/web/src/lib/org-types.ts' // v2\n");
  sh(f.repo, "checkout", "-q", "--detach", node);
  const document = path.join(f.repo, "domain-base/library/README.md");
  mkdirSync(path.dirname(document), { recursive: true });
  writeFileSync(document, "First domain package\n");
  sh(f.repo, "add", "domain-base"); sh(f.repo, "commit", "-qm", "first domain package");
  const s = sh(f.repo, "rev-parse", "HEAD"); sh(f.repo, "checkout", "-q", "main");
  const srv = http.createServer((q, a) => a.end(JSON.stringify({ sha: "old" }))).listen(0, "127.0.0.1");
  await new Promise((r) => srv.on("listening", r));
  let result;
  try { result = await run(LIVE, [s], { ...f.env, AB_LIVE_PORT: String(srv.address().port), AB_LIVE_WAIT_S: "1" }); }
  finally { srv.close(); }
  assert.equal(result.status, 1, result.out + result.err);
  assert.equal(readFileSync(path.join(f.repo, "apps/web/dist/index.html"), "utf8"), "old");
  assert.doesNotMatch(readFileSync(path.join(f.repo, "services/node/src/server.ts"), "utf8"), /v2/);
  assert.equal(f.calls().at(-1), "open");
  assert.equal(readFileSync(document, "utf8"), "First domain package\n", "new source documents are preserved while the old node is restored");
});

test("ab-live: a failed desktop candidate restores the previous app bundle before reopening", async () => {
  const f = liveFixture();
  const s = f.commit("apps/desktop/src/lib.rs", "desktop candidate");
  const installed = path.join(f.base, "Installed.app"), candidate = path.join(f.base, "Candidate.app");
  mkdirSync(installed); mkdirSync(candidate);
  writeFileSync(path.join(installed, "binary"), "old app");
  writeFileSync(path.join(candidate, "binary"), "new app candidate");
  writeFileSync(path.join(candidate, "new-only"), "candidate extra");
  const srv = http.createServer((q, a) => a.end(JSON.stringify({ sha: "old" }))).listen(0, "127.0.0.1");
  await new Promise((r) => srv.on("listening", r));
  let r;
  try {
    r = await run(LIVE, [s], { ...f.env, AB_LIVE_INSTALLED_APP: installed, AB_LIVE_APP: candidate, AB_LIVE_ANY_ROOT: "1",
      AB_LIVE_PORT: String(srv.address().port), AB_LIVE_WAIT_S: "1" });
  } finally { srv.close(); }
  assert.equal(r.status, 1, r.out + r.err);
  assert.equal(readFileSync(path.join(installed, "binary"), "utf8"), "old app");
  assert.equal(existsSync(path.join(installed, "new-only")), false);
  assert.equal(f.calls().at(-1), "open");
});

test("ship (from a lane worktree): pushes the branch and queues it; refuses main and uncommitted work", async () => {
  const f = fixture();
  sh(f.repo, "checkout", "-q", "-B", "lane-s", "origin/main"); writeFileSync(path.join(f.repo, "s.txt"), "s\n"); sh(f.repo, "add", "."); sh(f.repo, "commit", "-qm", "lane s");
  writeFileSync(path.join(f.repo, "shared.txt"), "dirty\n");
  assert.equal((await run(QUEUE, ["ship"], f.env, f.repo)).status, 2, "uncommitted tracked change refused");
  sh(f.repo, "checkout", "-q", "--", "shared.txt");
  const r = await run(QUEUE, ["ship"], f.env, f.repo);
  assert.equal(r.status, 0, r.err); assert.match(r.out, /queued lane-s/);
  assert.equal(sh(f.repo, "rev-parse", "origin/lane-s"), sh(f.repo, "rev-parse", "HEAD"));
  sh(f.repo, "checkout", "-q", "-B", "main", "origin/main");
  assert.equal((await run(QUEUE, ["ship"], f.env, f.repo)).status, 2, "main refused");
});

test("ab-suites: legacy fixed-port suites wait for the machine lock, score results and mark missing ones", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "abs-"));
  mkdirSync(path.join(root, "tools"), { recursive: true }); mkdirSync(path.join(root, "services/node/test"), { recursive: true });
  writeFileSync(path.join(root, "tools/ab-suites"), readFileSync(path.join(TOOLS, "ab-suites")), { mode: 0o755 });
  writeFileSync(path.join(root, "tools/ab-queue.suites"), "# list\nok\nhalf\nnone\n");
  writeFileSync(path.join(root, "services/node/test/ok.mjs"), 'const PORT = 5431; console.log(JSON.stringify({passed:3,of:3}))');
  writeFileSync(path.join(root, "services/node/test/half.mjs"), 'console.log(JSON.stringify({summary:"1/2 passed"}));process.exit(1)');
  const lock = path.join(root, "ui.lock");
  const holder = spawn("sleep", ["2"]); writeFileSync(lock, String(holder.pid));
  const t0 = Date.now();
  const r = await run(path.join(root, "tools/ab-suites"), ["--json"], { AB_SUITES_LOCK: lock });
  assert.equal(r.status, 0, r.err);
  assert.ok(Date.now() - t0 >= 1500, "waited for the live lock holder");
  const res = JSON.parse(r.out.trim().split("\n").at(-1));
  assert.deepEqual(res.ok, { passed: 3, of: 3, exit: 0 }); assert.deepEqual(res.half, { passed: 1, of: 2, exit: 1 }); assert.deepEqual(res.none, { missing: true });
  assert.ok(!existsSync(lock), "lock released");
});

test("merge conflict notices go to the author and do not spill into an unrelated owner", async () => {
  const f = fixture(), lanes=path.join(f.base,'lanes.log'), tell=path.join(f.base,'tell');
  writeFileSync(tell, `#!/bin/sh\n[ "$1" = NAV-2 ] || exit 1\necho "$1 <- $2" >> ${lanes}\n`, {mode:0o755});
  f.lane('winner','shared.txt','winner edit\n');f.lane('clash2','shared.txt','lane edit\n');f.lane('clash3','shared.txt','other edit\n');
  const main=sh(f.repo,'rev-parse','--short=7','origin/main'), env={...f.env,AB_QUEUE_LANE_NOTIFY:tell};
  for(const [branch,owner] of [['winner','W'],['clash2','NAV-2'],['clash3','VOICE-ORB']])await run(QUEUE,['add',branch,'--by',owner],env);
  await run(QUEUE,['run','--once'],env);
  const told=readFileSync(lanes,'utf8');assert.match(told,/NAV-2 <- ab-queue: your lane clash2/);assert.ok(told.includes(`origin/main ${main} in shared.txt`));
  assert.ok(!f.calls().some(c=>c.startsWith('notify (for VOICE-ORB')));
});

test("self-update: with nothing to do, a runner whose tools/ab-queue differs from origin/main's moves its worktree to main and restarts on it", async () => {
  const f = fixture();
  // the runner runs from its own detached worktree (REPO) holding a copy of this ab-queue
  const runner = path.join(f.base, "runner");
  sh(f.repo, "checkout", "-q", "-B", "up", "origin/main"); mkdirSync(path.join(f.repo, "tools"), { recursive: true });
  writeFileSync(path.join(f.repo, "tools/ab-queue"), readFileSync(QUEUE), { mode: 0o755 });
  sh(f.repo, "add", "tools/ab-queue"); sh(f.repo, "commit", "-qm", "queue v1"); sh(f.repo, "push", "-q", "origin", "HEAD:main");
  sh(f.repo, "worktree", "add", "-q", "--detach", runner, "origin/main");
  // main then carries a "newer" ab-queue: this one plus a marker line that prints when it runs
  writeFileSync(path.join(f.repo, "tools/ab-queue"), readFileSync(QUEUE, "utf8").replace('def main(argv):', 'def main(argv):\n    print("NEW-RUNNER-STARTED", flush=True)\n    if os.environ.get("AB_QUEUE_STOP_AFTER_UPDATE"): return 0'), { mode: 0o755 });
  sh(f.repo, "add", "tools/ab-queue"); sh(f.repo, "commit", "-qm", "queue update"); sh(f.repo, "push", "-q", "origin", "HEAD:main");
  const p = spawn(path.join(runner, "tools/ab-queue"), ["run"], { env: { ...env0, ...f.env, AB_REPO: runner, AB_QUEUE_NO_SELF_UPDATE: "", AB_QUEUE_STOP_AFTER_UPDATE: "1" } });
  let out = ""; p.stdout.on("data", (d) => (out += d)); p.stderr.on("data", (d) => (out += "ERR:" + d));
  const code = await new Promise((r) => { const t = setTimeout(() => { p.kill(); r("timeout"); }, 20000); p.on("close", (c) => { clearTimeout(t); r(c); }); });
  assert.equal(code, 0, out); assert.match(out, /runner updated to origin\/main; restarting[\s\S]*NEW-RUNNER-STARTED/);
  assert.equal(sh(runner, "rev-parse", "HEAD"), sh(f.repo, "rev-parse", "origin/main"));
});

// 3 Oct: an ab-live fix landed on main but the runner kept deploying with the old ab-live (only tools/ab-queue was compared),
// so every deploy failed while the mini was down. Any change under tools/ moves the runner.
test("self-update: a change to another tool (tools/ab-live) also moves the runner to main", async () => {
  const f = fixture();
  const runner = path.join(f.base, "runner");
  sh(f.repo, "checkout", "-q", "-B", "up", "origin/main"); mkdirSync(path.join(f.repo, "tools"), { recursive: true });
  writeFileSync(path.join(f.repo, "tools/ab-queue"), readFileSync(QUEUE), { mode: 0o755 });
  writeFileSync(path.join(f.repo, "tools/ab-live"), "#!/bin/sh\necho old\n", { mode: 0o755 });
  sh(f.repo, "add", "tools"); sh(f.repo, "commit", "-qm", "tools v1"); sh(f.repo, "push", "-q", "origin", "HEAD:main");
  sh(f.repo, "worktree", "add", "-q", "--detach", runner, "origin/main");
  writeFileSync(path.join(f.repo, "tools/ab-live"), "#!/bin/sh\necho new\n", { mode: 0o755 });
  sh(f.repo, "add", "tools/ab-live"); sh(f.repo, "commit", "-qm", "ab-live fix"); sh(f.repo, "push", "-q", "origin", "HEAD:main");
  const want = sh(f.repo, "rev-parse", "origin/main");
  const p = spawn(path.join(runner, "tools/ab-queue"), ["run"], { env: { ...env0, ...f.env, AB_REPO: runner, AB_QUEUE_NO_SELF_UPDATE: "" } });
  let out = ""; p.stdout.on("data", (d) => (out += d)); p.stderr.on("data", (d) => (out += "ERR:" + d));
  let moved = false;
  for (let i = 0; i < 160 && !moved; i++) { await new Promise((r) => setTimeout(r, 250)); moved = sh(runner, "rev-parse", "HEAD") === want; }
  p.kill();
  assert.ok(moved, out);
  assert.equal(readFileSync(path.join(runner, "tools/ab-live"), "utf8"), "#!/bin/sh\necho new\n");
});

test("add: a bare suite name in --tests becomes that suite's command; real commands are left alone", async () => {
  const f = fixture();
  sh(f.repo, "checkout", "-q", "-B", "suite-lane", "origin/main");
  mkdirSync(path.join(f.repo, "services/node/test"), { recursive: true });
  writeFileSync(path.join(f.repo, "services/node/test/card-edit-ui.mjs"), "console.log('{}')\n"); sh(f.repo, "add", "."); sh(f.repo, "commit", "-qm", "suite");
  writeFileSync(path.join(f.repo,'.agents/ship.json'),JSON.stringify({tests:'card-edit-ui && pnpm -s lint'}));sh(f.repo,'commit','-qam','Declared checks');
  sh(f.repo, "push", "-q", "origin", "suite-lane");
  await run(QUEUE, ["add", "suite-lane", "--tests", "card-edit-ui && pnpm -s lint"], f.env);
  const row = (await f.status())[0];
  assert.equal(row.tests, "node --experimental-strip-types --no-warnings services/node/test/card-edit-ui.mjs && pnpm -s lint");
});

test("ab-live's real quit/open (no AB_LIVE_QUIT/OPEN) pass an app path with a space as ONE argument (3 Oct first real deploy)", async () => {
  const f = liveFixture();
  const s = f.commit("services/node/src/server.ts", "import x from '../../../apps/web/src/lib/org-types.ts' // v2\n");
  const fb = path.join(f.base, "fakebin"); mkdirSync(fb);
  const argv = path.join(f.base, "argv.log");
  for (const tool of ["osascript", "open"]) writeFileSync(path.join(fb, tool), `#!/bin/sh\nfor a in "$@"; do printf '%s|' "$a"; done >> ${argv}; echo >> ${argv}\n`, { mode: 0o755 });
  const app = path.join(f.base, "My Apps", "Agent Base.app"); mkdirSync(app, { recursive: true });
  const srv = http.createServer((q, a) => a.end(JSON.stringify({ sha: s }))).listen(0, "127.0.0.1");
  await new Promise((r) => srv.on("listening", r));
  const env = { ...f.env, AB_LIVE_PORT: String(srv.address().port), AB_LIVE_INSTALLED_APP: app, PATH: `${fb}:${process.env.PATH}` };
  delete env.AB_LIVE_QUIT; delete env.AB_LIVE_OPEN;
  const r = await run(LIVE, [s], env);
  srv.close();
  assert.equal(r.status, 0, r.out + r.err);
  assert.deepEqual(readFileSync(argv, "utf8").trim().split("\n"), ['-e|quit app "Agent Base"|', `-g|${app}|`]);
});

test("ab-live refuses below HEALTH's free-RAM bar and changes nothing", async () => {
  const f = liveFixture();
  const s = f.commit("apps/web/src/App.tsx", "v2");
  const r = await run(LIVE, [s], { ...f.env, AB_LIVE_SKIP_RAM: "", AB_LIVE_MIN_FREE_MB: "99999999" });
  assert.equal(r.status, 4); assert.match(r.out, /HEALTH's bar/);
  assert.equal(readFileSync(path.join(f.repo, "apps/web/dist/DEPLOYED_SHA"), "utf8").trim(), f.v1);
});

test("a newer ship of a branch supersedes its old conflict row: no more alarms for the old one", async () => {
  const f = fixture();
  f.lane("redo", "shared.txt", "lane edit\n");
  await run(QUEUE,["add","redo"],f.env);
  sh(f.repo, "checkout", "-q", "-B", "tmp", "origin/main"); writeFileSync(path.join(f.repo, "shared.txt"), "main edit\n"); sh(f.repo, "commit", "-qam", "main moves"); sh(f.repo, "push", "-q", "origin", "HEAD:main");
  await run(QUEUE, ["run", "--once"], f.env);
  assert.equal((await f.status())[0].state, "conflict");
  const redo=path.join(f.base,'redo');
  try{sh(redo,'merge','--no-commit','origin/main');}catch{}
  writeFileSync(path.join(redo,'shared.txt'),'author resolved both edits\n');sh(redo,'add','.');sh(redo,'commit','-qm','Author reconciled target');sh(redo,'push','-q','origin','redo');
  await run(QUEUE, ["add", "redo"], { ...f.env, AB_QUEUE_ALARM_MIN: "0" });
  const rows = await f.status();
  assert.deepEqual(rows.map((r) => r.state), ["superseded", "queued"]);
  await run(QUEUE, ["run", "--once"], { ...f.env, AB_QUEUE_ALARM_MIN: "0" });
  assert.ok(!f.calls().some((c) => c.includes("still conflict")), "no alarm for the superseded row");
});

test("dirty merge artifacts are preserved and refuse the next merge; a failing round is logged", async () => {
  const f = fixture();
  // the fake suite run drops artifacts into the worktree, as the real UI suites do (screenshots, preview PNGs)
  const env = { ...f.env, AB_QUEUE_SUITES_CMD: "touch .shots-x.png; echo changed > shared.txt; " + f.env.AB_QUEUE_SUITES_CMD };  // tip AND baseline runs leave files
  f.lane("art-1", "a1.txt", "1\n"); await run(QUEUE, ["add", "art-1"], env); await run(QUEUE, ["run", "--once"], env);
  f.lane("art-2", "a2.txt", "2\n"); await run(QUEUE, ["add", "art-2"], env);
  const r = await run(QUEUE, ["run", "--once"], env);
  assert.equal(r.status, 0, r.err);
  assert.deepEqual((await f.status()).map((x) => x.state), ["live", "queued"], "dirty checkout needs its owner to reconcile");
  assert.equal(readFileSync(path.join(f.merge,'shared.txt'),'utf8'),'changed\n');assert.ok(existsSync(path.join(f.merge,'.shots-x.png')));
  // a round that throws (the merge worktree is gone) does not end the runner
  f.lane("art-3", "a3.txt", "3\n"); await run(QUEUE, ["add", "art-3"], env);
  const r2 = await run(QUEUE, ["run", "--once"], { ...env, AB_MERGE_WORKTREE: path.join(f.base, "no-such-worktree") });
  assert.equal(r2.status, 0, r2.err);
  assert.ok(f.calls().some((c) => c.startsWith("notify ab-queue runner round failed")));
  assert.ok(readFileSync(path.join(f.state, "queue.jsonl"), "utf8").includes('"id": "runner", "state": "error"'));
});

test("tools/ab-queue.suites merges with merge=union: two lanes appending suites both land; ab-suites runs each name once", async () => {
  const f = fixture();
  sh(f.repo, "checkout", "-q", "-B", "attrs", "origin/main");
  mkdirSync(path.join(f.repo, "tools"), { recursive: true });
  writeFileSync(path.join(f.repo, ".gitattributes"), readFileSync(path.join(TOOLS, "..", ".gitattributes")));
  writeFileSync(path.join(f.repo, "tools/ab-queue.suites"), "base-suite\n");
  sh(f.repo, "add", "."); sh(f.repo, "commit", "-qm", "suites list"); sh(f.repo, "push", "-q", "origin", "HEAD:main");
  for (const [b, n] of [["s-one", "one-ui"], ["s-two", "two-ui"]]) {
    f.lane(b,"tools/ab-queue.suites",`base-suite\n${n}\n`);
    await run(QUEUE, ["add", b], f.env);
  }
  sh(f.repo, "checkout", "-q", "--detach", "origin/main");
  await run(QUEUE, ["run", "--once"], f.env);
  assert.deepEqual((await f.status()).map((x) => x.state), ["live", "live"]);
  sh(f.repo, "fetch", "-q");
  const list = sh(f.repo, "show", "origin/main:tools/ab-queue.suites").split("\n");
  assert.ok(list.includes("one-ui") && list.includes("two-ui"));
});

test("a notifier that hangs never wedges the runner (30 s cap); status survives a row with no queued time", async () => {
  const f = fixture();
  f.lane("hang", "shared.txt", "lane\n");
  await run(QUEUE,["add","hang","--by","SOMEONE"],f.env);
  sh(f.repo, "checkout", "-q", "-B", "tmp", "origin/main"); writeFileSync(path.join(f.repo, "shared.txt"), "main\n"); sh(f.repo, "commit", "-qam", "m"); sh(f.repo, "push", "-q", "origin", "HEAD:main");
  const t0 = Date.now();
  const r = await run(QUEUE, ["run", "--once"], { ...f.env, AB_QUEUE_LANE_NOTIFY: "sleep 600", AB_QUEUE_NOTIFY: "sleep 600" });
  assert.equal(r.status, 0, r.err);
  assert.ok(Date.now() - t0 < 75000, "capped at 30 s per notice, not 10 min");
  writeFileSync(path.join(f.state, "queue.jsonl"), readFileSync(path.join(f.state, "queue.jsonl"), "utf8") + JSON.stringify({ at: new Date().toISOString(), id: "orphan", state: "live" }) + "\n");
  const st = await run(QUEUE, ["status"], f.env);
  assert.equal(st.status, 0, st.err); assert.match(st.out, /orphan/);
});

test("self-update moves forward only: a runner on a commit main does not contain stays put", async () => {
  const f = fixture();
  const runner = path.join(f.base, "runner");
  sh(f.repo, "checkout", "-q", "-B", "up", "origin/main"); mkdirSync(path.join(f.repo, "tools"), { recursive: true });
  writeFileSync(path.join(f.repo, "tools/ab-queue"), readFileSync(QUEUE), { mode: 0o755 });
  sh(f.repo, "add", "tools/ab-queue"); sh(f.repo, "commit", "-qm", "queue v1"); sh(f.repo, "push", "-q", "origin", "HEAD:main");
  // the runner sits on a side commit (a lane), not on main
  sh(f.repo, "checkout", "-q", "-b", "lane"); writeFileSync(path.join(f.repo, "tools/ab-queue"), readFileSync(QUEUE, "utf8") + "\n# lane\n", { mode: 0o755 });
  sh(f.repo, "commit", "-qam", "lane queue"); const laneSha = sh(f.repo, "rev-parse", "HEAD");
  sh(f.repo, "worktree", "add", "-q", "--detach", runner, laneSha);
  const p = spawn(path.join(runner, "tools/ab-queue"), ["run"], { env: { ...env0, ...f.env, AB_REPO: runner, AB_QUEUE_NO_SELF_UPDATE: "" } });
  await new Promise((r) => setTimeout(r, 3000)); p.kill();
  assert.equal(sh(runner, "rev-parse", "HEAD"), laneSha, "not moved sideways onto main");
});

test("stall alarm: nothing deployed for AB_QUEUE_STALL_MIN while lanes wait tells A0 once per stall", async () => {
  const f = fixture();
  const a0 = path.join(f.base, "a0.log");
  const tell = path.join(f.base, "tell-a0"); writeFileSync(tell, `#!/bin/sh\necho "$1" >> ${a0}\n`, { mode: 0o755 });
  mkdirSync(f.state, { recursive: true });
  writeFileSync(path.join(f.state, "deploy.jsonl"), JSON.stringify({ sha: "abc", at: new Date(Date.now() - 45 * 60000).toISOString(), ids: [] }) + "\n");
  f.lane("waits", "w.txt", "w\n");
  const env = { ...f.env, AB_QUEUE_A0_NOTIFY: tell, AB_QUEUE_SUITES_CMD: "sleep 0; exit 1" };  // the lane fails: nothing deploys
  await run(QUEUE, ["add", "waits"], env);
  sh(f.repo, "checkout", "-q", "-B", "w2", "origin/main"); writeFileSync(path.join(f.repo, "w2.txt"), "2\n"); sh(f.repo, "add", "."); sh(f.repo, "commit", "-qm", "w2"); sh(f.repo, "push", "-q", "origin", "w2");
  await run(QUEUE, ["add", "w2"], { ...env, AB_QUEUE_SUITES_CMD: "exit 1" });
  // keep one lane waiting: the alarm runs from the round's alarms() step
  writeFileSync(path.join(f.state, "queue.jsonl"), readFileSync(path.join(f.state, "queue.jsonl"), "utf8"));
  const r1 = await run(QUEUE, ["status", "--json"], env);
  assert.equal(r1.status, 0);
  const py = spawnSync("python3", ["-c", `import importlib.machinery as m, importlib.util as u, os
os.environ.update(${JSON.stringify({ AB_QUEUE_STATE: f.state, AB_QUEUE_A0_NOTIFY: tell })})
l=m.SourceFileLoader('q','${QUEUE}');x=u.module_from_spec(u.spec_from_loader('q',l));l.exec_module(x)
x.stall_alarm(); x.stall_alarm()`], { encoding: "utf8" });
  assert.equal(py.status, 0, py.stderr);
  const lines = readFileSync(a0, "utf8").trim().split("\n");
  assert.equal(lines.length, 1, "once per stall");
  assert.match(lines[0], /^ab-queue STALL: nothing deployed for 4\d min while 2 lanes wait/);
});

test("a dropped mini link is never a lane's fault: the round errors, the lanes stay queued (not failed)", async () => {
  const f = fixture();
  f.lane("net", "n.txt", "n\n"); await run(QUEUE, ["add", "net"], f.env);
  const r = await run(QUEUE, ["run", "--once"], { ...f.env, AB_QUEUE_SUITES_CMD: "echo 'Read from remote host 100.66.34.21: Connection reset by peer' >&2; exit 255" });
  assert.equal(r.status, 0, r.err);
  assert.equal((await f.status())[0].state, "queued");
  assert.ok(readFileSync(path.join(f.state, "queue.jsonl"), "utf8").includes('"id": "runner", "state": "error"'));
});

test("a red batch is bisected; later lanes must reconcile when the first half advances main", async () => {
  const f = fixture();
  for (const [b, file] of [["g1", "g1.txt"], ["g2", "g2.txt"], ["bad", "RED"], ["g3", "g3.txt"]]) { f.lane(b, file, "x\n"); await run(QUEUE, ["add", b], f.env); }
  const r = await run(QUEUE, ["run", "--once"], f.env);
  assert.equal(r.status, 0, r.err);
  const by = Object.fromEntries((await f.status()).map((x) => [x.branch, x.state]));
  assert.deepEqual(by, { g1: "live", g2: "live", bad: "conflict", g3: "conflict" });
});

test("smoke gate: an affected suite regression is diagnosed lazily and reported without blocking landing", async () => {
  const f = fixture();
  f.lane("quick", "BREAK", "x\n");  // BREAK makes the fake 'ui' suite score worse, which the full gate would bounce
  await run(QUEUE, ["add", "quick"], f.env);
  const r = await run(QUEUE, ["run", "--once"], { ...f.env, AB_QUEUE_GATE: "fast", AB_QUEUE_POSTCHECK: "0" });
  assert.equal(r.status, 0, r.err);
  assert.equal((await f.status())[0].state, "live");
});

test("deploy notices with no lane reach the owner once per distinct cause, not once per sha", async () => {
  const f = fixture();
  const env = { ...f.env, AB_QUEUE_STATE: path.join(f.base, "qstate-notify") };
  mkdirSync(env.AB_QUEUE_STATE, { recursive: true });
  const probe = (msg) => execFileSync("python3", ["-c", "import runpy, sys; runpy.run_path(sys.argv[1], run_name='q')['notify'](sys.argv[2])", QUEUE, msg], { env, encoding: "utf8" });
  probe("abc1234 landed on main but its deploy failed: rsync: connection timed out");
  probe("def5678 landed on main but its deploy failed: rsync: connection timed out");
  probe("aaa9999 landed on main but its deploy failed: build failed");
  const sent = f.calls().filter((c) => c.startsWith("notify ") && c.includes("deploy failed"));
  assert.equal(sent.length, 2, sent.join("\n"));
});

test('a red live smoke rolls back before the lane can become live', async () => {
  const f = fixture();
  const previous = sh(f.repo, 'rev-parse', 'origin/main');
  sh(f.repo, 'update-ref', 'refs/heads/live', previous);
  f.lane('smoke-red', 'new.txt', 'new\n');
  const env = { ...f.env, AB_QUEUE_SMOKE_CMD: 'false', AB_QUEUE_ROLLBACK_CMD: `echo rollback >> ${path.join(f.base, 'calls.log')}; echo` };
  await run(QUEUE, ['add', 'smoke-red'], env);
  const result = await run(QUEUE, ['run', '--once'], env);
  assert.equal(result.status, 0, result.err);
  const row = (await f.status())[0];
  assert.equal(row.state, 'landed');
  assert.match(row.why, new RegExp(`live smoke red; rolled back to ${previous.slice(0,12)}`));
  assert.deepEqual(f.calls().filter(c => /^(check|baseline|deploy|rollback)$/.test(c)), ['check', 'deploy', 'rollback']);
  assert.equal(existsSync(path.join(f.state, 'deploy.jsonl')), false, 'red smoke cannot record a successful deploy');
});

test('nightly runs each suite once off the path and persists red results', async () => {
  const f = fixture();
  const env = { ...f.env, AB_QUEUE_SUITES_CMD: `echo once >> ${path.join(f.base, 'calls.log')}; echo '{"ui":{"passed":1,"of":2,"exit":1}}'` };
  const result = await run(QUEUE, ['nightly'], env);
  assert.equal(result.status, 1);
  assert.equal(f.calls().filter(c => c === 'once').length, 1);
  const row = JSON.parse(readFileSync(path.join(f.state, 'nightly.jsonl'), 'utf8'));
  assert.deepEqual(row.red, ['ui']);
  assert.equal((await f.status()).length, 0, 'nightly does not create or gate lane rows');
});

test('affected mapping selects imports, named components, changed tests; tooling and unknown files select nothing', async () => {
  const f = fixture();
  mkdirSync(path.join(f.repo,'tools'), {recursive:true});
  mkdirSync(path.join(f.repo,'services/node/test'), {recursive:true});
  mkdirSync(path.join(f.repo,'services/node/src'), {recursive:true});
  mkdirSync(path.join(f.repo,'apps/web/src'), {recursive:true});
  writeFileSync(path.join(f.repo,'tools/ab-queue.suites'), 'route\nwidget\n');
  writeFileSync(path.join(f.repo,'services/node/src/route.ts'), 'export function routeThing() {}\n');
  writeFileSync(path.join(f.repo,'services/node/test/route.mjs'), "import { routeThing } from '../src/route.ts';\n");
  writeFileSync(path.join(f.repo,'services/node/test/widget.mjs'), "// Exercise Widget and data-testid=widget-box\n");
  writeFileSync(path.join(f.repo,'apps/web/src/Widget.tsx'), 'export function Widget() { return <div data-testid="widget-box"/>; }\n');
  sh(f.repo,'add','.'); sh(f.repo,'commit','-qm','suite map fixture');
  const base = sh(f.repo,'rev-parse','HEAD');
  const affected = async file => {
    writeFileSync(path.join(f.repo,file), readFileSync(path.join(f.repo,file),'utf8') + '\n// changed\n');
    sh(f.repo,'add',file); sh(f.repo,'commit','-qm',file);
    // Run the real mapper from the fixture path so its cache and git source belong to this repository.
    writeFileSync(path.join(f.repo,'tools/ab-affected'),readFileSync(path.join(TOOLS,'ab-affected')),{mode:0o755});
    const r = await run(path.join(f.repo,'tools/ab-affected'),[base,'HEAD'],{AB_SUITE_MAP_STATE:path.join(f.base,'map')});
    assert.equal(r.status,0,r.err);
    return r.out.trim().split(/\s+/).filter(Boolean);
  };
  assert.deepEqual(await affected('services/node/src/route.ts'), ['route']);
  assert.deepEqual(await affected('apps/web/src/Widget.tsx'), ['route','widget']);
  assert.deepEqual(await affected('services/node/test/widget.mjs'), ['route','widget']);
  const head=sh(f.repo,'rev-parse','HEAD');
  writeFileSync(path.join(f.repo,'tools/irrelevant'),'tools change\n');
  writeFileSync(path.join(f.repo,'unmapped.txt'),'unknown change\n');
  writeFileSync(path.join(f.repo,'package.json'),'{}\n');
  sh(f.repo,'add','tools/irrelevant','unmapped.txt','package.json'); sh(f.repo,'commit','-qm','smoke only');
  const r=await run(path.join(f.repo,'tools/ab-affected'),[head,'HEAD'],{AB_SUITE_MAP_STATE:path.join(f.base,'map')});
  assert.equal(r.status,0,r.err); assert.equal(r.out,'');
  const invalid=await run(path.join(f.repo,'tools/ab-affected'),['missing-ref','HEAD'],{AB_SUITE_MAP_STATE:path.join(f.base,'map')});
  assert.equal(invalid.status,1);
});

test('affected mapping reads batches larger than pipe buffers within a deadline', async () => {
  const f = fixture();
  mkdirSync(path.join(f.repo, 'tools'), { recursive: true });
  mkdirSync(path.join(f.repo, 'services/node/test'), { recursive: true });
  mkdirSync(path.join(f.repo, 'apps/web/src'), { recursive: true });
  writeFileSync(path.join(f.repo, 'tools/ab-queue.suites'), 'large\n');
  writeFileSync(path.join(f.repo, 'services/node/test/large.mjs'), '// Exercise BatchTarget\n');
  // Both directions exceed pipe capacity, as in the real 578-file release tree.
  for (let i = 0; i < 600; i++) {
    const name = `BatchSource${String(i).padStart(4, '0')}.tsx`;
    writeFileSync(path.join(f.repo, 'apps/web/src', name), `// ${'fixture '.repeat(1400)}\n`);
  }
  const target = 'apps/web/src/BatchTarget.tsx';
  writeFileSync(path.join(f.repo, target), 'export function BatchTarget() {}\n');
  sh(f.repo, 'add', '.'); sh(f.repo, 'commit', '-qm', 'large suite map fixture');
  const base = sh(f.repo, 'rev-parse', 'HEAD');
  writeFileSync(path.join(f.repo, target), 'export function BatchTarget() { return 1; }\n');
  sh(f.repo, 'add', target); sh(f.repo, 'commit', '-qm', 'change mapped component');
  const mapper = path.join(f.repo, 'tools/ab-affected');
  writeFileSync(mapper, readFileSync(path.join(TOOLS, 'ab-affected')), { mode: 0o755 });
  const result = await new Promise((resolve) => {
    const child = spawn(mapper, [base, 'HEAD'], {
      cwd: f.repo, detached: true,
      env: { ...env0, AB_SUITE_MAP_STATE: path.join(f.base, 'map') },
    });
    let out = '', err = '', timedOut = false;
    child.stdout.on('data', data => { out += data; });
    child.stderr.on('data', data => { err += data; });
    const timer = setTimeout(() => {
      timedOut = true;
      // Only this disposable mapper and its Git child belong to this process group.
      process.kill(-child.pid, 'SIGKILL');
    }, 10000);
    child.on('close', status => {
      clearTimeout(timer); resolve({ status, out, err, timedOut });
    });
  });
  assert.equal(result.timedOut, false, 'large committed-source read must not hang the queue');
  assert.equal(result.status, 0, result.err);
  assert.equal(result.out.trim(), 'large');
});

test('parallel environment-port suites bypass a live legacy lock and receive distinct ports', async () => {
  const root=mkdtempSync(path.join(tmpdir(),'abs-parallel-'));
  mkdirSync(path.join(root,'tools'),{recursive:true}); mkdirSync(path.join(root,'services/node/test'),{recursive:true});
  writeFileSync(path.join(root,'tools/ab-suites'),readFileSync(path.join(TOOLS,'ab-suites')),{mode:0o755});
  writeFileSync(path.join(root,'tools/ab-queue.suites'),'first\nsecond\n');
  for(const name of ['first','second']) writeFileSync(path.join(root,'services/node/test',name+'.mjs'), `
    import net from 'node:net';
    import {writeFileSync} from 'node:fs';
    const refusedURL='http://127.0.0.1:9'; // an assertion target, never a listening fixture
    const suitePort=Number(process.env.AB_PORT);
    const server=net.createServer();
    await new Promise(r=>server.listen(suitePort,'127.0.0.1',r));
    writeFileSync('${path.join(root,name)}',JSON.stringify({port:suitePort,at:Date.now()}));
    await new Promise(r=>setTimeout(r,250));
    await new Promise(r=>server.close(r));
    console.log(JSON.stringify({passed:1,of:1}));
  `);
  const lock=path.join(root,'lock'); writeFileSync(lock,String(process.pid));
  const r=await run(path.join(root,'tools/ab-suites'),['--only','first,second','--parallel','2','--json'],{AB_SUITES_LOCK:lock});
  assert.equal(r.status,0,r.err);
  const first=JSON.parse(readFileSync(path.join(root,'first'),'utf8')), second=JSON.parse(readFileSync(path.join(root,'second'),'utf8'));
  assert.notEqual(first.port,second.port); assert.ok(Math.abs(first.at-second.at)<200,'suites started concurrently');
  assert.equal(readFileSync(lock,'utf8'),String(process.pid),'parallel runner never touches the legacy lock');
});

test('lazy main diagnosis marks newly added suites missing and still runs the existing red suites once', async () => {
  const base=mkdtempSync(path.join(tmpdir(),'ab-lazy-map-'));
  mkdirSync(path.join(base,'tools')); writeFileSync(path.join(base,'tools/ab-queue.suites'),'existing\n');
  const code=`
import json, os, runpy
os.environ.pop('AB_QUEUE_SUITES_CMD', None)
module = runpy.run_path(${JSON.stringify(QUEUE)})
fn = module['baseline']; scope = fn.__globals__
scope['BASEWT'] = ${JSON.stringify(base)}
scope['git'] = lambda *args, **kwargs: __import__('types').SimpleNamespace(stdout='')
calls = []
def suites(cwd, with_check, only, prep):
    calls.append({'only': only, 'prep': prep, 'with_check': with_check})
    return {'existing': {'passed': 2, 'of': 2, 'exit': 0}}, ''
scope['suites'] = suites
result = fn('unused-sha', ['existing', 'new-suite'])
print(json.dumps({'result': result, 'calls': calls}))
`;
  const r=await run('python3',['-c',code],{PYTHONDONTWRITEBYTECODE:'1'});
  assert.equal(r.status,0,r.err);
  assert.deepEqual(JSON.parse(r.out),{result:{'new-suite':{missing:true},existing:{passed:2,of:2,exit:0}},calls:[{only:['existing'],prep:true,with_check:false}]});
});

const ARTIFACT = path.join(TOOLS, 'ab-artifact');
function checkedBundle(f, sha) {
  const producer = path.join(f.base, 'producer');
  sh(f.repo, 'worktree', 'add', '-q', '--detach', producer, sha);
  const nonce = 'a'.repeat(32);
  const call = (...args) => execFileSync('python3', [ARTIFACT, ...args], { env: { ...env0, NODE_OPTIONS: '', NODE_PATH: '', NODE_ENV: 'production' }, encoding: 'utf8' }).trim();
  const relative = call('request', producer, sha, nonce);
  call('begin', producer, relative);
  mkdirSync(path.join(producer, 'apps/web/dist'), { recursive: true });
  writeFileSync(path.join(producer, 'apps/web/dist/index.html'), 'checked frontend');
  writeFileSync(path.join(producer, 'apps/web/dist/app.js'), 'checked asset');
  call('seal', producer, relative);
  return { path: path.join(producer, relative), producer, nonce, call };
}

test('checked artifact: exact receipt stages tested bytes; corrupt or unknown input falls back to normal build', async () => {
  for (const failure of ['none', 'payload', 'extra', 'missing', 'sha', 'nonce', 'source', 'symlink', 'environment']) {
    const f = liveFixture({ artifact: true });
    const sha = f.commit('apps/web/src/App.tsx', 'v2');
    const a = checkedBundle(f, sha);
    if (failure === 'payload') writeFileSync(path.join(a.path, 'payload/index.html'), 'tampered');
    if (failure === 'extra') writeFileSync(path.join(a.path, 'payload/extra.js'), 'unmanifested');
    if (failure === 'missing') unlinkSync(path.join(a.path, 'payload/app.js'));
    if (failure === 'symlink') { unlinkSync(path.join(a.path, 'payload/app.js')); symlinkSync('index.html', path.join(a.path, 'payload/app.js')); }
    if (['sha', 'nonce', 'source'].includes(failure)) {
      const p = path.join(a.path, 'request.json'), x = JSON.parse(readFileSync(p));
      if (failure === 'source') x.sources['apps/web/src/App.tsx'] = '0'.repeat(64);
      else x[failure] = '0'.repeat(failure === 'sha' ? 40 : 32);
      writeFileSync(p, JSON.stringify(x));
    }
    const r = await run(LIVE, [sha], { ...f.env, AB_LIVE_CHECKED_ARTIFACT: a.path, ...(failure === 'environment' ? { VITE_LOCAL_OVERRIDE: 'fixture' } : {}) });
    assert.equal(r.status, 0, failure + ': ' + r.out + r.err);
    const body = readFileSync(path.join(f.repo, 'apps/web/dist/index.html'), 'utf8');
    if (failure === 'none') { assert.equal(body, 'checked frontend'); assert.match(r.out, /reused the checked frontend/); }
    else { assert.match(body, /^built-/, failure); assert.doesNotMatch(r.out, /reused the checked frontend/, failure); }
    assert.deepEqual(f.calls(), [], 'web-only artifacts never restart the app');
  }
});

test('checked artifact: nonce mismatch and untracked/ignored source inputs cannot be promoted or sealed', () => {
  const f = liveFixture({ artifact: true }); const sha = f.commit('apps/web/src/App.tsx', 'v2'); const a = checkedBundle(f, sha);
  const command = (...args) => spawnSync('python3', [ARTIFACT, ...args], { env: env0, encoding: 'utf8' });
  assert.notEqual(command('promote', a.producer, sha, a.path, 'b'.repeat(32), path.join(f.base, 'store')).status, 0);
  for (const file of ['apps/web/.env.local', 'apps/web/public/untracked.png', 'packages/example/new.ts', 'services/node/src/new.ts']) {
    const p = path.join(a.producer, file); mkdirSync(path.dirname(p), { recursive: true }); writeFileSync(p, 'fixture');
    assert.notEqual(command('verify', a.producer, sha, a.path).status, 0, file);
    unlinkSync(p);
  }
  assert.equal(command('verify', a.producer, sha, a.path).status, 0);
  mkdirSync(path.join(a.producer, 'apps/web/preview'), { recursive: true });
  for (const name of ['screenshot.png', 'capture.log']) writeFileSync(path.join(a.producer, 'apps/web/preview', name), 'generated output');
  assert.equal(command('verify', a.producer, sha, a.path).status, 0, 'generated preview outputs do not disable reuse');
  writeFileSync(path.join(a.producer, 'apps/web/preview/new.html'), 'Tailwind may scan this text');
  assert.notEqual(command('verify', a.producer, sha, a.path).status, 0, 'untracked preview text remains an input');
});

function artifactQueueFixture(mode) {
  const f = fixture();
  sh(f.repo, 'checkout', '-q', '-B', 'artifact-base', 'origin/main');
  const put = (name, text, executable = false) => { const p = path.join(f.repo, name); mkdirSync(path.dirname(p), { recursive: true }); writeFileSync(p, text); if (executable) chmodSync(p, 0o755); };
  put('.gitignore', 'apps/web/dist/\n.lab-checked-release/\n');
  put('apps/web/src/App.tsx', 'base');
  put('services/node/src/server.ts', '// fixture server\n');
  put('tools/ab-artifact', readFileSync(ARTIFACT), true);
  put('tools/ab-suites', "import json\nprint(json.dumps({'ui':{'passed':1,'of':1,'exit':0}}))\n");
  put('tools/fixture-smoke', '#!/bin/sh\nif [ "$1" = . ] && [ -e SMOKE_RED ]; then exit 1; fi\n', true);
  sh(f.repo, 'add', '.'); sh(f.repo, 'commit', '-qm', 'artifact fixture'); sh(f.repo, 'push', '-q', 'origin', 'HEAD:main');
  sh(f.repo, 'checkout', '-q', '--detach', 'origin/main');
  const prev = sh(f.repo, 'rev-parse', 'HEAD');
  mkdirSync(path.join(f.repo, 'apps/web/dist'), { recursive: true });
  writeFileSync(path.join(f.repo, 'apps/web/dist/index.html'), 'old live');
  writeFileSync(path.join(f.repo, 'apps/web/dist/DEPLOYED_SHA'), prev);
  const bin = path.join(f.base, 'bin'); mkdirSync(bin);
  const count = path.join(f.base, 'builds');
  writeFileSync(path.join(bin, 'pnpm'), `#!/bin/sh\nif [ "$1" = check ]; then\n echo producer >> '${count}'\n [ ! -e CHECK_RED ] || exit 7\n mkdir -p apps/web/dist\n printf 'checked transport' > apps/web/dist/index.html\n printf 'checked asset' > apps/web/dist/app.js\nfi\n`);chmodSync(path.join(bin, 'pnpm'), 0o755);
  const mini = path.join(bin, 'mini');
  writeFileSync(mini, `#!/usr/bin/env python3
import os,sys,shutil,subprocess
from pathlib import Path
source=Path.cwd();mode=${JSON.stringify(mode)}
if mode=='local':sys.exit(subprocess.call(['bash','-c',sys.argv[1]]))
remote=Path(${JSON.stringify(path.join(f.base, 'mirror'))})
shutil.copytree(source,remote,ignore=shutil.ignore_patterns('.git','dist','node_modules','target','.vite','.ab-mini'),dirs_exist_ok=True)
r=subprocess.call(['bash','-c',sys.argv[1]],cwd=remote)
spool=remote/'.lab-checked-release'
if spool.exists():
 shutil.copytree(spool,source/'.lab-checked-release',dirs_exist_ok=True)
 for bundle in (source/'.lab-checked-release').iterdir():
  receipt=bundle/'receipt.json'
  if mode=='partial' and receipt.exists():receipt.unlink()
  if mode=='tampered' and (bundle/'payload/index.html').exists():(bundle/'payload/index.html').write_text('corrupt')
sys.exit(r)
`);chmodSync(mini, 0o755);
  delete f.env.AB_QUEUE_SUITES_CMD;
  Object.assign(f.env, { PATH: bin + ':' + process.env.PATH, AB_MINI: mini, AB_QUEUE_SMOKE_CMD: 'tools/fixture-smoke', AB_QUEUE_SUITES_GATE: mode === 'local' ? '1' : '0',
    AB_QUEUE_DEPLOY: LIVE, AB_LIVE_CHECKOUT: f.repo, AB_LIVE_STATE: path.join(f.base, 'live'), AB_LIVE_SKIP_RAM: '1', NODE_OPTIONS: '', NODE_PATH: '', NODE_ENV: 'production',
    AB_LIVE_BUILD: `echo fallback >> '${count}'; mkdir -p apps/web/dist; echo fallback > apps/web/dist/index.html` });
  return { ...f, count };
}

test('checked artifact: mini transport and local fallback each build once; incomplete copy-back rebuilds', async () => {
  for (const mode of ['remote', 'local', 'partial', 'tampered']) {
    const f = artifactQueueFixture(mode);
    f.lane('web', 'apps/web/src/App.tsx', 'v2');
    await run(QUEUE, ['add', 'web'], f.env);
    const result = await run(QUEUE, ['run', '--once'], f.env);
    assert.equal(result.status, 0, mode + result.out + result.err);
    assert.equal((await f.status())[0].state, 'live', mode + result.out + result.err);
    const builds = readFileSync(f.count, 'utf8').trim().split('\n');
    assert.deepEqual(builds, ['remote', 'local'].includes(mode) ? ['producer'] : ['producer', 'fallback'], mode);
    assert.equal(readFileSync(path.join(f.repo, 'apps/web/dist/index.html'), 'utf8').trim(), ['remote', 'local'].includes(mode) ? 'checked transport' : 'fallback');
  }
});

test('checked artifact: failed producer check or worktree smoke never publishes reusable output', async () => {
  for (const flag of ['CHECK_RED', 'SMOKE_RED']) {
    const f = artifactQueueFixture('remote'); f.lane('red', flag, 'fail');
    await run(QUEUE, ['add', 'red'], f.env); await run(QUEUE, ['run', '--once'], f.env);
    assert.equal((await f.status())[0].state, 'failed');
    assert.equal(existsSync(path.join(f.state, 'checked-web')), false);
    assert.equal(readFileSync(path.join(f.repo, 'apps/web/dist/index.html'), 'utf8'), 'old live');
  }
});

test('checked artifact: rollback drops a candidate artifact even if inherited in the queue environment', async () => {
  const f = fixture(); f.lane('roll', 'roll.txt', 'x'); sh(f.repo, 'update-ref', 'refs/live', sh(f.repo, 'rev-parse', 'HEAD'));
  const log = path.join(f.base, 'rollback-env');
  const env = { ...f.env, AB_LIVE_CHECKED_ARTIFACT: '/stale-candidate', AB_QUEUE_SMOKE_CMD: 'false', AB_QUEUE_ROLLBACK_CMD: `sh -c 'printf "%s" "\${AB_LIVE_CHECKED_ARTIFACT-unset}" > ${log}' ignored` };
  await run(QUEUE, ['add', 'roll'], env); await run(QUEUE, ['run', '--once'], env);
  assert.equal(readFileSync(log, 'utf8'), 'unset');
  assert.equal((await f.status())[0].state, 'landed');
});

test('checked artifact: failed copy after index.html leaves no local dist for remote fallback to mistake as built', async () => {
  const f = liveFixture({ artifact: true }); const sha = f.commit('apps/web/src/App.tsx', 'v2'); const a = checkedBundle(f, sha);
  const bin = path.join(f.base, 'bin'); mkdirSync(bin);
  const python = execFileSync('python3', ['-c', 'import sys;print(sys.executable)'], { encoding: 'utf8' }).trim();
  const rsync = execFileSync('/bin/sh', ['-c', 'command -v rsync'], { encoding: 'utf8' }).trim();
  const remote = path.join(f.base, 'remote-output'); mkdirSync(remote);
  writeFileSync(path.join(remote, 'index.html'), 'fresh remote fallback');
  writeFileSync(path.join(remote, 'app.js'), 'remote asset');
  writeFileSync(path.join(bin, 'python3'), `#!${python}
import os,sys,runpy
from pathlib import Path
if len(sys.argv)>2 and sys.argv[2]=='stage':
 m=runpy.run_path(sys.argv[1]);original=m['shutil'].copytree
 def broken(source,target):
  Path(target).mkdir(parents=True);(Path(target)/'index.html').write_text('rejected partial payload');raise OSError('fixture copy failure')
 m['shutil'].copytree=broken
 try:m['main'](sys.argv[2:])
 except OSError:sys.exit(1)
else:os.execv(${JSON.stringify(python)},[${JSON.stringify(python)},*sys.argv[1:]])
`);
  writeFileSync(path.join(bin, 'rsync'), `#!${python}
import os,sys,shutil
if sys.argv[-2].startswith('mac-mini-ts:'):
 shutil.copytree(${JSON.stringify(remote)},sys.argv[-1],dirs_exist_ok=True)
else:os.execv(${JSON.stringify(rsync)},[${JSON.stringify(rsync)},*sys.argv[1:]])
`);
  writeFileSync(path.join(bin, 'mini'), '#!/bin/sh\nexit 0\n');
  for (const name of ['python3', 'rsync', 'mini']) chmodSync(path.join(bin, name), 0o755);
  const result = await run(LIVE, [sha], { ...f.env, PATH: bin + ':' + process.env.PATH, AB_LIVE_BUILD: '', AB_MINI: path.join(bin, 'mini'), AB_LIVE_CHECKED_ARTIFACT: a.path });
  assert.equal(result.status, 0, result.out + result.err);
  assert.equal(readFileSync(path.join(f.repo, 'apps/web/dist/index.html'), 'utf8'), 'fresh remote fallback');
  assert.equal(readFileSync(path.join(f.repo, 'apps/web/dist/app.js'), 'utf8'), 'remote asset');
  assert.doesNotMatch(result.out, /reused the checked frontend/);
});

test('checked artifact: repeated requests keep one spool/store and old nonces are rejected', () => {
  const f = liveFixture({ artifact: true }); const sha = f.commit('apps/web/src/App.tsx', 'v2'); const a = checkedBundle(f, sha);
  const store = path.join(f.base, 'store');
  a.call('promote', a.producer, sha, a.path, a.nonce, store);
  const nonce = 'c'.repeat(32); const relative = a.call('request', a.producer, sha, nonce);
  a.call('begin', a.producer, relative);
  mkdirSync(path.join(a.producer, 'apps/web/dist')); writeFileSync(path.join(a.producer, 'apps/web/dist/index.html'), 'second');
  a.call('seal', a.producer, relative);
  const old = spawnSync('python3', [ARTIFACT, 'promote', a.producer, sha, a.path, a.nonce, store], { env: env0 });
  assert.notEqual(old.status, 0);
  a.call('promote', a.producer, sha, a.path, nonce, store);
  assert.deepEqual(readdirSync(store), ['current']);
  assert.deepEqual(readdirSync(path.join(a.producer, '.lab-checked-release')), ['current']);
  assert.equal(readFileSync(path.join(store, 'current/payload/index.html'), 'utf8'), 'second');
});

test('checked artifact: a valid reused frontend still restores previous bytes and node source when startup fails', async () => {
  const f = liveFixture({ artifact: true }); const before = readFileSync(path.join(f.repo, 'services/node/src/server.ts'), 'utf8');
  const sha = f.commit('services/node/src/server.ts', 'new node source'); const a = checkedBundle(f, sha);
  const srv = http.createServer((q, reply) => reply.end(JSON.stringify({ sha: f.v1 }))).listen(0, '127.0.0.1');
  await new Promise(resolve => srv.on('listening', resolve));
  let result;
  try { result = await run(LIVE, [sha], { ...f.env, AB_LIVE_PORT: String(srv.address().port), AB_LIVE_WAIT_S: '1', AB_LIVE_CHECKED_ARTIFACT: a.path }); }
  finally { srv.close(); }
  assert.notEqual(result.status, 0); assert.match(result.out, /reused the checked frontend/);
  assert.equal(readFileSync(path.join(f.repo, 'apps/web/dist/index.html'), 'utf8'), 'old');
  assert.equal(readFileSync(path.join(f.repo, 'services/node/src/server.ts'), 'utf8'), before);
  assert.match(readFileSync(path.join(f.env.AB_LIVE_STATE, 'live.jsonl'), 'utf8'), /rolled-back/);
});

test('checked artifact: failed promotion retains current, removes its partial pending payload and permits retry', () => {
  const f = liveFixture({ artifact: true }); const sha = f.commit('apps/web/src/App.tsx', 'v2'); const a = checkedBundle(f, sha);
  const store = path.join(f.base, 'store'); a.call('promote', a.producer, sha, a.path, a.nonce, store);
  const script = `import runpy,sys\nfrom pathlib import Path\nm=runpy.run_path(sys.argv[1])\ndef broken(source,target):\n Path(target).mkdir(parents=True);(Path(target)/'index.html').write_text('partial');raise OSError('fixture copy failure')\nm['shutil'].copytree=broken\ntry:m['main'](sys.argv[2:])\nexcept OSError:sys.exit(7)\n`;
  const failed = spawnSync('python3', ['-c', script, ARTIFACT, 'promote', a.producer, sha, a.path, a.nonce, store], { env: env0 });
  assert.equal(failed.status, 7); assert.deepEqual(readdirSync(store), ['current']);
  assert.equal(readFileSync(path.join(store, 'current/payload/index.html'), 'utf8'), 'checked frontend');
  a.call('promote', a.producer, sha, a.path, a.nonce, store);
  assert.deepEqual(readdirSync(store), ['current']);
});
