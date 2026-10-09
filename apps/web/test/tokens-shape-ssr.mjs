// Synthetic component regression: malformed persisted payload must render fallback, not throw.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";

const baseline = process.env.TOKENS_BASELINE === "1";
const vite = await createServer({ root: process.cwd(), optimizeDeps: { noDiscovery: true, include: [] }, server: { middlewareMode: true }, appType: "custom", plugins: baseline ? [{ name: "baseline-tokens", enforce: "pre", load(id) { return id.endsWith("/src/components/TokensSpace.tsx") ? execFileSync("git", ["show", "5d6499e:apps/web/src/components/TokensSpace.tsx"], { encoding: "utf8" }) : null; } }] : [] });
try {
  const mod = await vite.ssrLoadModule("/src/components/TokensSpace.tsx");
  const malformed = [{}, { at: 1, scanning: false, accounts: [null], daily: [], heatmap: [], hourOfDay: [], achievements: [], notes: [], overall: { today: {}, week: {}, month: {}, allTime: {} } }, { at: 1, scanning: false, accounts: [], daily: [], heatmap: [], hourOfDay: [], achievements: [], notes: [], overall: { today: "bad", week: {}, month: {}, allTime: {} } }, { at: 1, scanning: false, accounts: [{ id: "x", name: "x", kind: "claude", today: {}, week: {}, month: {}, allTime: {}, models: null, limits: null }], daily: [], heatmap: [], hourOfDay: [], achievements: [{ id: "x", thresholds: "bad" }], notes: [], attribution: [], ranges: { weekFrom: null }, overall: {} }];
  let crashed = false, html = "";
  for (const data of malformed) {
    try { html = renderToStaticMarkup(React.createElement(mod.TokensView, { data, error: null })); } catch { crashed = true; }
    if (!baseline) assert.equal(mod.isTokensShape(data), false);
  }
  if (baseline) {
    assert.equal(crashed, true);
    console.log(JSON.stringify({ ok: false, regressionObserved: true, baseline: true, crashed }));
  } else {
    assert.equal(crashed, false);
    assert.match(html, /Token data is unavailable/);
    console.log(JSON.stringify({ ok: true, fallback: true, malformedCases: malformed.length, html: html.replace(/\s+/g, " ").slice(0, 160) }));
  }
} finally {
  await vite.close();
}
