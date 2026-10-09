import { suitePort } from './suite-runtime.mjs';
// Check (16:15 list): ab-150 notifications and ab-142 spend, wired. The pings strip (R1.21; was the bell) lists its repo's
// .agents/notifications.jsonl, marks one read, and a reply reaches the agent through its chat as "re: notification N: …";
// the HUD carries no Spend chip (R1.19). A fake herdr, a fake siso-host, a fixture spend command; HOME is a scratch
// folder (the bell's read state). Runs anywhere (the Mac mini): node services/node/test/notify-ui.mjs
// Shots: .shots-notify.png
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { WebSocketServer } from "ws";
import { webkit } from './suite-runtime.mjs';

const REPO = path.join(import.meta.dirname, "../../..");
const PORT = await suitePort();
const scratch = mkdtempSync(path.join(process.env.TMPDIR ?? tmpdir(), ".siso-ephemeral-notify-ui."));
const repo = path.join(scratch, "repo");
mkdirSync(path.join(repo, ".agents"), { recursive: true });
writeFileSync(path.join(repo, ".agents/notifications.jsonl"), [
  { id: "n1", at: "2026-10-02T10:00:00Z", title: "Faces are live", body: "Every row has its face." },
  { id: "n2", at: "2026-10-02T10:05:00Z", title: "Needs a look", body: "The Tauri build waits on you.", needs: "a decision" },
].map((r) => JSON.stringify(r)).join("\n") + "\n");
// Agent Zero's full HUD (model, context, tokens, limits, cost), the long row the chip ran under at 18:09.
mkdirSync(path.join(scratch, "ctx"));
writeFileSync(path.join(scratch, "ctx", "zero-hud.json"), JSON.stringify({ used_percentage: 59, model: { display_name: "Opus 5.5 (1M context)" }, total_input_tokens: 590300, total_output_tokens: 5100, current_usage: { cache_read_input_tokens: 9000, input_tokens: 10 }, cost: { total_cost_usd: 61.88 }, rate_limits: { five_hour: { used_percentage: 5, resets_at: Date.now() / 1000 + 16000 }, seven_day: { used_percentage: 13, resets_at: Date.now() / 1000 + 560000 } }, at: Date.now() }));
const results = [];
const check = (name, ok, detail = {}) => {
  results.push(!!ok);
  console.log(JSON.stringify({ check: name, ok: !!ok, ...detail }));
};
const prompts = [];
const host = new WebSocketServer({ port: 0, host: "127.0.0.1" });
host.on("connection", (ws) => {
  ws.send(JSON.stringify({ t: "hello", name: "LINKS", session: null, state: "idle", partial: {}, tasks: [], bg: [], log: [{ t: "text", id: "m1", text: "Ready.", at: Date.now() }] }));
  ws.on("message", (d) => {
    const m = JSON.parse(String(d));
    if (m.t === "prompt") prompts.push(m.text);
  });
});
await new Promise((r) => host.on("listening", r));
mkdirSync(path.join(scratch, "hosts"));
writeFileSync(path.join(scratch, "hosts", "w1_p1.json"), JSON.stringify({ pid: process.pid, port: host.address().port, token: "t", session: null, pane: "w1:p1", name: "LINKS", cwd: repo }));
const AGENTS = [
  { agent: "siso", agent_status: "idle", cwd: repo, pane_id: "w1:p1", terminal_id: "term_links1", terminal_title_stripped: "LINKS" },
  // Agent Zero, so his face sits at the HUD's right end as it does live.
  { agent: "claude", agent_status: "working", cwd: "/tmp", pane_id: "w1:p2", terminal_id: "term_zero2", terminal_title_stripped: "A0", agent_session: { value: "zero-hud" } },
];
const node = spawn(process.execPath, ["--experimental-strip-types", "--no-warnings", "src/server.ts"], {
  cwd: path.join(REPO, "services/node"),
  env: { ...process.env, HOME: scratch, AB_PORT: String(PORT), AB_CTX_DIR: path.join(scratch, "ctx"), AB_SPEND_CMD: `cat ${path.join(REPO, "services/node/test/fixtures/spend.json")}`, FAKE_HERDR_AGENTS: JSON.stringify(AGENTS), AB_HERDR: `${process.execPath} ${path.join(REPO, "services/node/test/fake-herdr.mjs")}`, AB_HOSTS_DIR: path.join(scratch, "hosts"), AB_STATE: path.join(scratch, "rows.json"), AB_REGISTRY: path.join(scratch, "registry.json"), AB_RESURRECT_DIR: path.join(scratch, "none"), AB_CONSOLE_EVENTS: path.join(scratch, "none.jsonl") },
  stdio: "ignore",
});
let browser = null;
try {
  for (let i = 0; i < 150; i++) {
    try {
      if ((await fetch(`http://127.0.0.1:${PORT}/api/health`)).ok) break;
    } catch {}
    await new Promise((r) => setTimeout(r, 200));
  }
  browser = await webkit.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`http://127.0.0.1:${PORT}/`);
  // A busy machine and a fresh HOME make the first agent list slow: give the row and the bell room.
  await page.locator('[data-testid=rail-row][aria-label^="LINKS,"]:visible, [data-testid=zero-strip] [data-name="LINKS"]').first().click({ timeout: 30000 });
  // R1.21: the bell became the pings strip under the header; the needing one first, its stack holds the rest.
  const strip = page.locator("[data-testid=ping-strip]");
  await strip.waitFor({ timeout: 30000 });
  await page.waitForFunction(() => document.querySelector("[data-testid=ping-count]")?.textContent?.includes("of 2"), null, { timeout: 8000 }).catch(() => {});
  const stripText = (await strip.innerText()).replace(/\s+/g, " ");
  check("the pings strip on the agent's page shows its two unread, the one needing him first", /Needs you/i.test(stripText) && stripText.includes("Needs a look") && stripText.includes("1 of 2"), { stripText });
  await strip.getByRole("button", { name: "Open the stack", exact: true }).click();
  const panel = page.locator("[data-testid=ping-stack]");
  await panel.getByText("Faces are live").waitFor({ timeout: 4000 });
  await page.screenshot({ path: path.join(import.meta.dirname, ".shots-notify.png") });
  await panel.getByRole("button", { name: "Yes" }).first().click();
  await page.waitForTimeout(600);
  const state = (await (await fetch(`http://127.0.0.1:${PORT}/api/agents/term_links1/notifications`)).json()).notifications;
  check("liking one is kept by the node", state.some((n) => n.react === "like"), { state: state.map((n) => `${n.id}:${n.react}:${n.read}`) });
  await panel.locator("[data-testid=ping-row][data-id=n2]").getByRole("button", { name: "Voice reply" }).click();
  await panel.getByRole("textbox", { name: "Reply to ping n2" }).fill("on it");
  await panel.getByRole("button", { name: "Send reply to ping n2" }).click();
  // a0-016: the 👍 above reached the agent first ("re: notification n2: 👍 yes …"); wait for the reply itself.
  for (let i = 0; i < 30 && !prompts.includes("re: notification n2: on it"); i++) await page.waitForTimeout(200);
  check("a reply reaches the agent through its chat as 're: notification n2: …'", prompts.includes("re: notification n2: on it"), { prompts });
  await page.keyboard.press("Escape");
  // R1.19 (21:10: "I don't like this spend halo thing"): the HUD has no Spend chip; fleet spend is in the top bar.
  await page.locator('[data-testid=rail-row][data-item="term_zero2"]').first().click();
  await page.locator("[data-testid=hud]", { hasText: "ctx" }).waitFor({ timeout: 8000 });
  check("the HUD carries no Spend chip", (await page.locator(".spend-chip, .ab-hud-spend").count()) === 0);
  check("no page errors", errors.length === 0, { errors: errors.slice(0, 3) });
} catch (e) {
  // A failure leaves its picture behind, so it explains itself.
  await browser?.contexts()[0]?.pages()[0]?.screenshot({ path: path.join(import.meta.dirname, ".shots-notify-fail.png") }).catch(() => {});
  const said = await browser?.contexts()[0]?.pages()[0]?.locator("body").innerText().catch(() => "");
  check("ran to the end", false, { error: String(e?.stack ?? e).slice(0, 500), page: String(said ?? "").replace(/\s+/g, " ").slice(0, 300) });
} finally {
  await browser?.close();
  node.kill();
  host.close();
  rmSync(scratch, { recursive: true, force: true });
}
const passed = results.filter(Boolean).length;
console.log(JSON.stringify({ passed, of: results.length }));
process.exit(passed === results.length ? 0 : 1);
