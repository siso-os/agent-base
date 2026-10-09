import { suitePort } from './suite-runtime.mjs';
// Check (R1.19, Shaan 2 Oct: "where is my approved chat hud input text one"; SPEC-CHAT-HUD bug 4): an agent run by
// siso-host (an SDK seat, as Agent Zero is) gets the halo rim's HUD row with its model, context and tokens, read from its
// session file, with its window from a terminal HUD and fresh SDK limits replacing stale terminal limits. Never "no HUD".
//   node services/node/test/hud-seat-ui.mjs [shots-dir]
// A fake herdr lists one siso agent; a fake host (a WebSocket server and its host file) serves its chat.
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { WebSocketServer } from "ws";
import { webkit } from './suite-runtime.mjs';

const REPO = path.join(import.meta.dirname, "../../..");
const [shots = null] = process.argv.slice(2);
const PORT = await suitePort();
const scratch = mkdtempSync(path.join(process.env.TMPDIR ?? tmpdir(), ".siso-ephemeral-hud-seat-ui."));
const results = [];
const check = (name, ok, detail = {}) => {
  results.push(!!ok);
  console.log(JSON.stringify({ check: name, ok: !!ok, ...detail }));
};

const CWD = "/fake/seat-lab";
const S = "seat-session-1";
const claude = path.join(scratch, "claude");
const dir = path.join(claude, "projects", CWD.replace(/[^A-Za-z0-9]/g, "-"));
mkdirSync(dir, { recursive: true });
const T0 = Date.now() - 60_000;
// Two API messages (the second written as two records repeating its usage): 305k in context at the end.
const usage = (input, read, out) => ({ input_tokens: input, cache_read_input_tokens: read, cache_creation_input_tokens: 0, output_tokens: out });
const recs = [
  { type: "user", uuid: "u1", timestamp: new Date(T0).toISOString(), sessionId: S, message: { role: "user", content: "SEATFIX hello" } },
  { type: "assistant", uuid: "a1", timestamp: new Date(T0 + 1000).toISOString(), sessionId: S, message: { id: "msg_1", model: "claude-opus-5-5", role: "assistant", content: [{ type: "text", text: "SEATFIX first." }], usage: usage(10, 200_000, 300) } },
  { type: "assistant", uuid: "a2", timestamp: new Date(T0 + 2000).toISOString(), sessionId: S, message: { id: "msg_2", model: "claude-opus-5-5", role: "assistant", content: [{ type: "text", text: "SEATFIX second." }], usage: usage(5_700, 300_000, 400) } },
  { type: "assistant", uuid: "a3", timestamp: new Date(T0 + 2100).toISOString(), sessionId: S, message: { id: "msg_2", model: "claude-opus-5-5", role: "assistant", content: [{ type: "text", text: "SEATFIX more." }], usage: usage(5_700, 300_000, 400) } },
];
writeFileSync(path.join(dir, `${S}.jsonl`), recs.map((r) => JSON.stringify(r)).join("\n") + "\n");
// A terminal Claude on the same login: its HUD file gives the 1M window and the account's limits.
const ctxDir = path.join(scratch, "ctx");
mkdirSync(ctxDir);
writeFileSync(path.join(ctxDir, "cli-peer.json"), JSON.stringify({ profile: claude, model: { id: "claude-opus-5-5[1m]", display_name: "Opus 5.5 (1M context)" }, context_window_size: 1_000_000, rate_limits: { five_hour: { used_percentage: 22, resets_at: Date.now() / 1000 + 9000 }, seven_day: { used_percentage: 17, resets_at: Date.now() / 1000 + 300000 } }, at: Date.now() - 3600000 }));

const host = new WebSocketServer({ port: 0, host: "127.0.0.1" });
// A turn in progress: his message 30 s ago, and the reply streaming in as deltas (siso-host relays them; its usage only
// comes at the message's end), so the live line's ↓ must climb from the stream alone.
host.on("connection", (ws) => {
  ws.send(JSON.stringify({ t: "hello", name: "SEATFIX", session: S, state: "working", partial: {}, tasks: [], bg: [], log: [{ t: "text", id: "m1", text: "SEATFIX ready.", at: Date.now() - 40_000 }, { t: "user", id: "u2", text: "SEATFIX go on", at: Date.now() - 30_000, from: "app" }] }));
  // Two background jobs: a sub-agent (the faces pill counts it) and a shell (the row under the composer lists it).
  ws.send(JSON.stringify({ t: "bg", list: [{ id: "bg-agent", kind: "local_agent", description: "Spec the header" }, { id: "bg-shell", kind: "local_bash", description: "pnpm dev" }] }));
  const tick = setInterval(() => ws.readyState === ws.OPEN && ws.send(JSON.stringify({ t: "delta", id: "m2:0", text: "streaming words ".repeat(25) })), 300);
  ws.on("close", () => clearInterval(tick));
});
await new Promise((r) => host.on("listening", r));
mkdirSync(path.join(scratch, "hosts"));
writeFileSync(path.join(scratch, "hosts", "w1_p1.json"), JSON.stringify({ pid: process.pid, port: host.address().port, token: "t", rateLimits: { five_hour: { used_percentage: 7, resets_at: new Date(Date.now()+9000000).toISOString() }, seven_day: { used_percentage: 88, resets_at: new Date(Date.now()+300000000).toISOString() }, at: Date.now() }, session: S, pane: "w1:p1", name: "SEATFIX", cwd: CWD }));
writeFileSync(path.join(dir, "pane-less-session.jsonl"), recs.map(r => JSON.stringify({ ...r, sessionId: "pane-less-session" })).join("\n") + "\n");
const paneLess = JSON.parse(readFileSync(path.join(scratch, "hosts", "w1_p1.json"), "utf8"));
writeFileSync(path.join(scratch, "hosts", "name-PANELESS.json"), JSON.stringify({ ...paneLess, name: "PANELESS", session: "pane-less-session", pane: null }));
const agentsFile = path.join(scratch, "agents.json");
writeFileSync(agentsFile, JSON.stringify([{ agent: "siso", agent_status: "idle", cwd: CWD, pane_id: "w1:p1", terminal_id: "term_seat1", terminal_title_stripped: "SEATFIX" }]));
// t-0008: an agent with no project sits under Agent Zero's card; as the owner of its own project it keeps a rail row.
writeFileSync(path.join(scratch, "registry.json"), JSON.stringify({ projects: ["SEATFIX"], agents: { SEATFIX: { project: "SEATFIX", kind: "owner", domain: "SEATFIX" } } }));
const env = {
  ...process.env,
  AB_PORT: String(PORT),
  AB_HERDR: `${process.execPath} ${path.join(REPO, "services/node/test/fake-herdr.mjs")}`,
  FAKE_HERDR_AGENTS_FILE: agentsFile,
  AB_CLAUDE_DIRS: claude,
  AB_CTX_DIR: ctxDir,
  AB_HOSTS_DIR: path.join(scratch, "hosts"),
  AB_STATE: path.join(scratch, "rows.json"),
  AB_REGISTRY: path.join(scratch, "registry.json"),
  AB_RESURRECT_DIR: path.join(scratch, "none"),
  AB_CONSOLE_EVENTS: path.join(scratch, "none.jsonl"),
  AB_A0_SEAT: path.join(scratch, "seat.json"),
};
const node = spawn(process.execPath, ["--experimental-strip-types", "--no-warnings", "src/server.ts"], { cwd: path.join(REPO, "services/node"), env, stdio: "ignore" });
const base = `http://127.0.0.1:${PORT}`;
let browser = null;
try {
  for (let i = 0; i < 150 && !(await fetch(`${base}/api/health`).catch(() => null))?.ok; i++) await new Promise((r) => setTimeout(r, 200));
  const rows = (await (await fetch(`${base}/api/agents`)).json()).agents;
  const row = rows.find((a) => a.id === "term_seat1") ?? {};
  const service = rows.find((a) => a.serviceHost?.name === "PANELESS");
  check("pane-less service seat also receives its SDK limits", !service?.pane && service?.hud?.fiveHour?.pct === 7 && service?.hud?.week?.pct === 88 && service?.hud?.at === paneLess.rateLimits.at);
  const h = row.hud ?? {};
  check("the node gives the SDK seat a HUD: Opus 5.5 (1M context), 31% context, tokens counted once per message, the login's 5h/wk",
    !!row.host && h.model === "Opus 5.5 (1M context)" && h.context === 31 && h.tokensIn === 200_010 + 305_700 && h.tokensOut === 700 && h.fiveHour?.pct === 7 && h.week?.pct === 88 && Date.now() - h.at < 60000,
    { host: row.host, hud: h });

  browser = await webkit.launch();
  for (const [w, hgt] of [[1440, 900], [390, 844]]) {
    const page = await browser.newPage({ viewport: { width: w, height: hgt } });
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(`${base}/`);
    await page.locator('[data-testid=rail-row][aria-label^="SEATFIX"]:visible, [data-testid=zero-strip] [data-name="SEATFIX"]').first().click({ timeout: 20000 });
    const view = page.locator("[data-testid=chat-view]:visible");
    await view.getByText("SEATFIX ready.").waitFor({ timeout: 15000 });
    const hud = view.locator("[data-testid=halo-rim] [data-testid=hud]");
    await hud.waitFor({ timeout: 8000 });
    const text = (await hud.innerText()).replace(/\s+/g, " ");
    const ok = /Opus 5\.5 1M/.test(text) && /31%/.test(text) && /5h 7%/.test(text) && !/no HUD/.test(text) && (w < 640 || /↑ ?505\.7k ↓ ?700/.test(text));
    check(`${w}: the SDK seat's rim shows its model, context${w < 640 ? "" : ", tokens"} and 5h; never "no HUD"`, ok, { text });
    const limits = hud.locator(".ab-hud__lim");
    check(`${w}: fresh SDK limits replace stale borrowed ones and show their read time`,
      /updated 0 min ago/.test(await limits.first().getAttribute("title")) && await hud.locator(".ab-hud__lim.is-stale").count() === 0);
    if (shots) await page.screenshot({ path: path.join(shots, `r1.19-seat-${w}.png`) });
    // 23:2x ("Deliberating… (36s · ↓ 0 tokens)"): the seat's ↓ climbs while the reply streams.
    const live = view.locator("[data-testid=live-line]");
    const tok = (t) => { const m = t.match(/↓ ([\d.]+)(k?) tokens/); return m ? Number(m[1]) * (m[2] ? 1000 : 1) : -1; };
    await live.waitFor({ timeout: 8000 });
    for (let i = 0; i < 40 && tok(await live.innerText()) <= 0; i++) await page.waitForTimeout(100);
    const t1 = tok(await live.innerText());
    await page.waitForTimeout(2000);
    const t2 = tok(await live.innerText());
    check(`${w}: the SDK seat's live line ↓ climbs as the reply streams (no usage event yet)`, t1 > 0 && t2 > t1, { t1, t2 });
    // Shaan 3 Oct 00:30 ("why it says five agents running below the input"): the row under the composer names shells only.
    const below = (await view.locator(".siso-chat__bg").innerText({ timeout: 4000 }).catch(() => "")).replace(/\s+/g, " ");
    check(`${w}: under the composer, "1 shell running", no agents`, /1 shell running/.test(below) && !/agent/i.test(below), { below });
    if (w === 1440) {
      await hud.locator("[data-testid=model-chip]").click();
      const menu = (await page.locator("[data-testid=model-menu]").innerText({ timeout: 4000 })).replace(/\s+/g, " ");
      const off = await page.locator("[data-testid=model-menu] [role=menuitemradio]").evaluateAll((els) => els.every((b) => b.disabled));
      check("1440: the seat's model chip says siso-host picks the model, and offers no switch", /siso-host picks the model/.test(menu) && off, { menu: menu.slice(0, 160), off });
      await page.keyboard.press("Escape");
    }
    check(`${w}: no page errors`, errors.length === 0, { errors });
    // Move only the browser clock: a session refresh must not hide an old account read.
    await page.evaluate(at => { Date.now = () => at + 11 * 60000; }, paneLess.rateLimits.at);
    await page.waitForFunction(() => document.querySelector(".ab-hud__lim.is-stale"), null, { timeout: 40000 });
    check(`${w}: after 10 minutes limits dim and the hover reports age`,
      await hud.locator(".ab-hud__lim.is-stale").count() === 2 &&
      /updated 11 min ago/.test(await limits.first().getAttribute("title")) &&
      Number(await limits.first().evaluate(el => getComputedStyle(el).opacity)) < 1);
    if (shots) await page.screenshot({ path: path.join(shots, `usage-stale-${w}.png`) });
    await page.close();
  }
} catch (e) {
  check("ran without throwing", false, { error: String(e?.stack ?? e).slice(0, 600) });
} finally {
  await browser?.close();
  node.kill();
  host.close();
  rmSync(scratch, { recursive: true, force: true });
}
const passed = results.filter(Boolean).length;
console.log(`${passed}/${results.length} passed`);
process.exit(passed === results.length ? 0 : 1);
