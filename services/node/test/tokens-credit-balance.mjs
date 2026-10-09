import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";

// Exercise the real JSONL scanner and its published consumers in a fresh process
// per case. Every source is synthetic; no real account, credential or command is read.
const cases = [
  { name: "null stays unknown", raw: "null", expected: null },
  { name: "missing balance stays unknown", expected: null },
  { name: "empty string stays unknown", raw: '""', expected: null },
  { name: "whitespace stays unknown", raw: '" \\t\\n"', expected: null },
  { name: "malformed string stays unknown", raw: '"not a balance"', expected: null },
  { name: "numeric prefix is not a balance", raw: '"42 credits"', expected: null },
  { name: "NaN string stays unknown", raw: '"NaN"', expected: null },
  { name: "Infinity string stays unknown", raw: '"Infinity"', expected: null },
  { name: "negative Infinity stays unknown", raw: '"-Infinity"', expected: null },
  { name: "overflowed JSON number stays unknown", raw: "1e999", expected: null },
  { name: "overflowed numeric string stays unknown", raw: '"1e999"', expected: null },
  { name: "false is not zero", raw: "false", expected: null },
  { name: "true is not one", raw: "true", expected: null },
  { name: "empty array is not zero", raw: "[]", expected: null },
  { name: "number array is not a balance", raw: "[42]", expected: null },
  { name: "string array is not a balance", raw: '["42"]', expected: null },
  { name: "object is not a balance", raw: '{"value":42}', expected: null },
  { name: "object conversion hooks cannot break the scan", raw: '{"toString":null,"valueOf":null}', expected: null },
  { name: "numeric zero is known", raw: "0", expected: 0 },
  { name: "string zero is known", raw: '"0"', expected: 0 },
  { name: "finite numeric balance is known", raw: "4321.25", expected: 4321.25 },
  { name: "finite string balance is known", raw: '"4321.25"', expected: 4321.25 },
  { name: "negative numeric balance retains compatibility", raw: "-12.5", expected: -12.5 },
  { name: "negative string balance retains compatibility", raw: '"-12.5"', expected: -12.5 },
  { name: "padded numeric string retains compatibility", raw: '" 4321.25 "', expected: 4321.25 },
  { name: "numeric exponent retains compatibility", raw: '"4.32125e3"', expected: 4321.25 },
  { name: "unknown without a burn fallback stays unknown", raw: "null", expected: null, noBurn: true },
  { name: "burn fallback false stays unknown", raw: "null", expected: null, burnBalance: false, expectedBurn: null },
  { name: "burn fallback whitespace stays unknown", raw: "null", expected: null, burnBalance: " ", expectedBurn: null },
  { name: "burn fallback array stays unknown", raw: "null", expected: null, burnBalance: [], expectedBurn: null },
  { name: "burn fallback zero is known", raw: "null", expected: null, burnBalance: 0, expectedBurn: 0 },
  { name: "burn fallback negative is retained", raw: "null", expected: null, burnBalance: -0.25, expectedBurn: -0.25 },
  { name: "burn fallback numeric string is retained", raw: "null", expected: null, burnBalance: "123.25", expectedBurn: 123.25 },
  { name: "false burn budget stays unknown", raw: "0", expected: 0, burnBudget: false, expectedBudget: null },
  { name: "array burn budget stays unknown", raw: "0", expected: 0, burnBudget: [], expectedBudget: null },
  { name: "zero burn budget is known", raw: "0", expected: 0, burnBudget: 0, expectedBudget: 0 },
  { name: "negative burn budget is retained", raw: "0", expected: 0, burnBudget: -1, expectedBudget: -1 },
  { name: "old sample is distinct from new HTTP response", raw: "123.25", expected: 123.25, oldSample: true },
  { name: "missing burn sample time remains unknown", raw: "null", expected: null, noBurnAt: true },
  { name: "unlimited event with zero retains flag and zero", raw: "0", expected: 0, unlimited: true },
  { name: "unlimited event with unknown retains independent flag", raw: "null", expected: null, unlimited: true },
  { name: "failed burn refresh keeps last-good fallback provenance", raw: "null", expected: null, failedBurn: true },
];

if (process.argv[2] !== "--fixture") {
  for (const scenario of cases) {
    test(scenario.name, () => {
      const result = spawnSync(process.execPath, ["--experimental-strip-types", "--no-warnings", import.meta.filename, "--fixture", JSON.stringify(scenario)], { encoding: "utf8", timeout: 30_000 });
      assert.equal(result.error, undefined, result.error?.message);
      assert.equal(result.status, 0, result.stdout + result.stderr);
    });
  }
} else {
  const scenario = JSON.parse(process.argv[3]);
  const home = mkdtempSync(path.join(tmpdir(), "ab-credit-balance-"));
  const realNow = Date.now;
  let now = realNow();
  if (scenario.failedBurn) Date.now = () => now;
  const at = Date.now() - (scenario.oldSample ? 86_400_000 : 10_000);
  const burnAt = at - 30_000;
  const reset = Math.floor((at + 86_400_000) / 1000) * 1000;
  const codexHome = path.join(home, "codex-fixture");
  const burnScript = path.join(home, "burn.mjs");
  const burnFailed = path.join(home, "burn-failed");
  const burn = { at: burnAt, claude: [], codex: { balance: { balance: Object.hasOwn(scenario, "burnBalance") ? scenario.burnBalance : 6789, budget: Object.hasOwn(scenario, "burnBudget") ? scenario.burnBudget : 10000 }, credits_per_hour: null, left: null, hours_left_at_rate: null } };
  if (scenario.noBurnAt) delete burn.at;
  writeFileSync(burnScript, `import { existsSync } from "node:fs"; process.stdout.write(existsSync(${JSON.stringify(burnFailed)}) ? "{}" : ${JSON.stringify(JSON.stringify(burn))});\n`);
  Object.assign(process.env, {
    NODE_ENV: "test", HOME: home, AB_HOME: home, CODEX_HOME: codexHome, AB_CODEX_HOME: codexHome,
    AB_HUD_DIR: path.join(home, "hud"), AB_STATE: path.join(home, "rows.json"),
    AB_TOKENS_CACHE: path.join(home, "tokens.json"), AB_CREDITS_BIN: path.join(home, "no-logins"),
    AB_PRICES: path.join(home, "no-prices"), AB_CODEX_RATES: path.join(home, "no-rates"),
    AB_SERVERS_PROBE: "0", AB_URL_CHECK: "off", AB_BURN_CMD: scenario.noBurn ? "" : `${process.execPath} ${burnScript}`,
    // Allow the synthetic Node child to start on a shared laptop; this suite checks values, not launch latency.
    AB_SPLIT_CMD: "none", AB_USAGE_COMMAND_MS: "5000", AB_USAGE_CACHE_MS: scenario.failedBurn ? "50" : "300000",
  });
  const event = (time, credits) => JSON.stringify({
    timestamp: new Date(time).toISOString(), type: "event_msg",
    payload: { type: "token_count", rate_limits: {
      plan_type: "fixture-plan", credits: "__CREDITS__",
      primary: { used_percent: 20, window_minutes: 300 },
      secondary: { used_percent: 40, window_minutes: 10080, resets_at: reset / 1000 },
    }, info: { total_token_usage: { total_tokens: 5 }, last_token_usage: { input_tokens: 5, output_tokens: 0, total_tokens: 5 } } },
  }).replace('"__CREDITS__"', credits);
  const credits = `{${scenario.raw === undefined ? "" : `"balance":${scenario.raw},`}"has_credits":true,"unlimited":${Boolean(scenario.unlimited)}}`;
  mkdirSync(path.join(codexHome, "sessions"), { recursive: true });
  writeFileSync(path.join(codexHome, "sessions", "synthetic.jsonl"), [
    event(at - 2000, '{"balance":3456}'),
    event(at, credits),
    event(at - 1000, '{"balance":9999}'), // A later-scanned old event must not replace the newest reading.
  ].join("\n") + "\n");

  const response = async (handler, pathname) => {
    let status, body;
    const res = { writeHead(code) { status = code; }, end(text) { body = JSON.parse(text); } };
    assert.equal(await handler({ method: "GET" }, res, new URL(pathname, "http://synthetic.invalid")), true);
    assert.equal(status, 200);
    return body;
  };
  try {
    const { handleTokens, codexCredits, tokensBudget } = await import("../src/tokens.ts");
    let snapshot;
    for (let i = 0; i < 600; i++) {
      snapshot = await response(handleTokens, "/api/tokens");
      if (!snapshot.scanning) break;
      await delay(10);
    }
    assert.equal(snapshot.scanning, false, "synthetic scan completed");
    assert.equal(snapshot.accounts.length, 1, "only the existing synthetic Codex account is present");
    const account = snapshot.accounts[0];
    assert.equal(account.id, "codex");
    assert.equal(account.limits.credits.balance, scenario.expected);
    assert.equal(account.limits.credits.hasCredits, true);
    assert.equal(account.limits.credits.unlimited, Boolean(scenario.unlimited));
    assert.equal(account.limits.at, at, "unknown does not borrow an older event timestamp");
    assert.equal(account.limits.source, "newest Codex token_count event");
    assert.deepEqual(codexCredits(), { balance: scenario.expected, hasCredits: true, unlimited: Boolean(scenario.unlimited), at, plan: "fixture-plan", weeklyResetsAt: reset, weeklyUsedPct: 40 });
    const budget = await tokensBudget();
    assert.deepEqual(budget.codex, { balance: scenario.expected, balanceAt: at, balanceSource: "newest Codex token_count event", hasCredits: true, unlimited: Boolean(scenario.unlimited), stale: false }, "Now panel preserves the credit observation and its own provenance");

    const { handleTokensMoney } = await import("../src/tokens-money.ts");
    let money;
    for (let i = 0; i < 600; i++) {
      money = await response(handleTokensMoney, "/api/tokens/money");
      if (scenario.noBurn || !money.pending) break;
      await delay(10);
    }
    assert.equal(money.pending, Boolean(scenario.noBurn));
    assert.equal(money.codex.balance, scenario.expected ?? (scenario.noBurn ? null : Object.hasOwn(scenario, "expectedBurn") ? scenario.expectedBurn : 6789));
    assert.equal(money.codex.balanceAt, scenario.expected !== null ? at : scenario.noBurn || scenario.noBurnAt ? null : burnAt, "balance provenance keeps its actual source time");
    assert.equal(money.codex.balanceSource, scenario.expected !== null ? "newest Codex event" : "burn-rate");
    if (Object.hasOwn(scenario, "expectedBudget")) assert.equal(money.codex.budget, scenario.expectedBudget);
    assert.deepEqual(money.codex.eventCredits, { at, hasCredits: true, unlimited: Boolean(scenario.unlimited) });
    assert.ok(money.at > at, "HTTP response time is not the original event sample time");
    assert.equal(money.burnState.stale, Boolean(scenario.noBurn));
    if (!scenario.noBurn) assert.ok(money.burnState.readAt > burnAt, "cache read time is separate from upstream sample time");
    assert.equal(money.codex.reset, reset, "weekly event metadata is unchanged");
    if (scenario.failedBurn) {
      const { handleUsage } = await import("../src/usage.ts");
      const lastGood = await response(handleUsage, "/api/usage");
      writeFileSync(burnFailed, "synthetic failure");
      now += 60; // Advance only the cache clock; child runtime must not consume the retry cooldown.
      let failed;
      for (let i = 0; i < 600; i++) {
        failed = await response(handleUsage, "/api/usage");
        if (!failed.refreshing && failed.reason) break;
        await delay(10);
      }
      assert.equal(failed.stale, true);
      assert.equal(failed.refreshing, false);
      assert.equal(failed.status, "ready");
      assert.equal(failed.at, lastGood.at, "failed refresh cannot retimestamp the last-good reading");
      const retained = await response(handleTokensMoney, "/api/tokens/money");
      assert.equal(retained.codex.balance, 6789);
      assert.equal(retained.codex.balanceAt, burnAt);
      assert.equal(retained.codex.balanceSource, "burn-rate");
      assert.equal(retained.burnState.stale, true);
      assert.equal(retained.burnState.refreshing, false);
      assert.equal(retained.burnState.readAt, lastGood.at);
      assert.match(retained.burnState.reason, /previous reading/);
      assert.equal(retained.burnState.attemptedAt, failed.attemptedAt);
    }
    // Let the scanner's existing asynchronous cache write finish before removing the fixture.
    await delay(20);
  } finally {
    Date.now = realNow;
    rmSync(home, { recursive: true, force: true });
  }
}
