import { suitePort } from './suite-runtime.mjs';
// SPEC-STATS-TASKS §5 acceptance, option A of both: Stats on one screen with every figure from a named route (a killed
// route blanks only its card), Tasks as one list where every task in the index is reachable and no line of his words is
// clipped (page and popped out), and the pop-out: ⌥-click, 380 px beside the side nav with the chat still there, the strip
// icon underlined, kept over a reload, ⤢ back to the page, × closed, the edge dragged 320-560. Amber is needs-you's alone.
// Fixtures only: a fake herdr, fixture machines, ship queue, burn-rate, spend-ledger, spend meter and task store, the node's
// HOME a scratch folder. Runs after `pnpm -C apps/web build`: node services/node/test/stats-tasks-ui.mjs [shots-dir]
import { spawn } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { webkit } from './suite-runtime.mjs';

const REPO = path.join(import.meta.dirname, "../../..");
const PORT = await suitePort();
const BASE = `http://127.0.0.1:${PORT}`;
const SHOTS = process.argv[2] ?? null;
const scratch = mkdtempSync(path.join(process.env.TMPDIR ?? tmpdir(), ".siso-ephemeral-stats-tasks-ui."));
const now = Date.now();
const iso = (minAgo) => new Date(now - minAgo * 60_000).toISOString();
const day = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const midnight = new Date(); midnight.setHours(0, 0, 0, 0);
// Times "today" that stay today whatever the hour the check runs: between local midnight and now.
const todayAt = (frac) => new Date(midnight.valueOf() + (now - midnight.valueOf()) * frac).toISOString();

// ---------------------------------------------------------------- fixtures
const registry = { projects: ["Agent Base", "HALO"], agents: { "AGENT-BASE": { project: "Agent Base", kind: "owner", domain: "Agent Base" }, "STREAMING-CLAUDE": { project: "HALO", kind: "owner", domain: "Go-live" } }, domains: [] };
mkdirSync(path.join(scratch, ".local/state/agent-base"), { recursive: true });
writeFileSync(path.join(scratch, ".local/state/agent-base/registry.json"), JSON.stringify(registry));
writeFileSync(path.join(scratch, "registry.json"), JSON.stringify(registry));
const agent = (title, status, n) => ({ agent: "claude", agent_status: status, cwd: "/tmp", pane_id: `w1:p${n}`, terminal_id: `term_st${n}`, terminal_title_stripped: title });
const AGENTS = [agent("AGENT-BASE", "working", 1), agent("STREAMING-CLAUDE", "idle", 2)];

const health = (over = {}) => ({ source: "live", at: now, level: "ok", why: [], state: null, detail: null, cpus: 8, load: [1.2, 1, 0.9], memTotalGb: 16, memAvailGb: 9, diskTotalGb: 460, diskFreeGb: 210, diskUsedGb: 250, upDays: 3, ...over });
const none = { source: "none", at: null, level: "unknown", why: [], state: null, detail: "no fleet record", cpus: null, load: null, memTotalGb: null, memAvailGb: null, diskTotalGb: null, diskFreeGb: null, diskUsedGb: null, upDays: null };
const card = (key, name, here, h, agents, extra = {}) => ({ key, name, role: "", status: "active", here, client: false, agentsVisible: here, agentMachine: here ? "MB" : null, watched: h.source !== "none", health: h, agents, tokensToday: here ? { total: 1, output: 1, at: now } : null, tokensWhyNull: here ? null : "not connected: this app reads only its own machine's Claude session files", services: null, containers: null, ...extra });
writeFileSync(path.join(scratch, "servers.json"), JSON.stringify({ fleetAt: now, servers: [
  card("laptop", "FIXTURE-MB", true, health(), { count: 11, byStatus: { working: 3, idle: 8 }, byKind: null, source: "herdr agent list", note: null }),
  card("vps", "FIXTURE-VPS", false, health({ source: "fleet record", level: "bad", why: ["11.6 GB disk free", "load 12.5 on 8 cores"], load: [12.5, 9, 8], diskFreeGb: 11.6, diskUsedGb: 448.4 }), { count: 9, byStatus: null, byKind: { claude: 9 }, source: "fleet record (agent processes)", note: "not connected: counted from the estate's last probe" }, { services: { count: 65, failed: 1 } }),
  card("mini", "FIXTURE-MINI", false, health({ source: "fleet record" }), { count: 6, byStatus: null, byKind: { codex: 6 }, source: "fleet record (agent processes)", note: "not connected" }),
  card("cam", "FIXTURE-CAM", false, none, { count: null, byStatus: null, byKind: null, source: "none", note: "not connected: no fleet record" }),
] }));

// The ship queue: five lanes went live today, two wait, one conflicts; three deploys.
const queue = path.join(scratch, "ship-queue");
mkdirSync(queue);
const ev = [];
const lane = (id, branch, by, steps) => {
  ev.push({ at: steps[0][1], id, state: "queued", branch, sha: `${id}aaaa`, tests: "", by, built_at: steps[0][1] });
  for (const [state, at, extra] of steps.slice(1)) ev.push({ at, id, state, ...(extra ?? {}) });
};
const deploys = [todayAt(0.35), todayAt(0.55), todayAt(0.9)];
lane("l1", "luna/stats-card", "LUNA-STATS", [["queued", todayAt(0.3)], ["live", deploys[0]]]);
lane("l2", "sol/browser", "SOL-S1-BROWSER", [["queued", todayAt(0.32)], ["live", deploys[0]]]);
lane("l3", "luna/tasks-live", "LUNA-TASKS", [["queued", todayAt(0.5)], ["live", deploys[1]]]);
lane("l4", "luna/very-long-branch-name-for-the-tooltip-check", "LUNA-LONG", [["queued", todayAt(0.8)], ["live", deploys[2]]]);
lane("l5", "luna/quick", "LUNA-Q", [["queued", todayAt(0.85)], ["live", deploys[2]]]);
lane("l6", "sol/desktop", "SOL-D", [["queued", todayAt(0.6)], ["landed", todayAt(0.7), { why: "deploy held: apps/desktop changed" }]]);
lane("l7", "luna/waiting", "LUNA-W", [["queued", todayAt(0.95)]]);
lane("l8", "luna/conflicted", "LUNA-C", [["queued", todayAt(0.4)], ["conflict", todayAt(0.45), { why: "conflicts with main: App.tsx" }]]);
writeFileSync(path.join(queue, "queue.jsonl"), ev.sort((a, b) => a.at.localeCompare(b.at)).map((e) => JSON.stringify(e)).join("\n") + "\n");
writeFileSync(path.join(queue, "deploy.jsonl"), deploys.map((at, i) => JSON.stringify({ sha: `d${i}`, at, ids: [] })).join("\n") + "\n");

// burn-rate and spend-ledger, as fixture commands.
const burn = { at: now, window_min: 60,
  claude: [
    { login: "claude-siso-3", profile: "/Users/fixture/.config/claude-siso-3", five_hour: { used_pct: 41, resets_at: now + 2 * 3_600_000, pct_per_hour: 3, hours_to_full: null, stale: false }, seven_day: { used_pct: 76, resets_at: now + 4 * 86_400_000, pct_per_hour: 1.1, hours_to_full: 22, stale: false } },
    { login: "claude-siso", profile: "/Users/fixture/.claude-siso", five_hour: { used_pct: 12, resets_at: now + 3_600_000, pct_per_hour: 1, hours_to_full: null, stale: false }, seven_day: { used_pct: 30, resets_at: now + 2 * 86_400_000, pct_per_hour: 0.3, hours_to_full: null, stale: false } },
  ],
  grants: [{ name: "claude-credits", left_usd: 212.51, limit_usd: 250, usd_per_hour: 16.55, usd_per_day_to_spend_it: 6.36, ends: new Date(now + 33 * 86_400_000).toISOString() }],
  codex: { balance: { now: 56604, of: 60000, today_spent: 842, per_day: 15000 }, reset: now + 3 * 86_400_000 },
};
writeFileSync(path.join(scratch, "burn.json"), JSON.stringify(burn));
writeFileSync(path.join(scratch, "split.sh"), `#!/bin/sh\ncase "$*" in *--day*) echo '{"sol":{"lo":313,"hi":459,"top":["SOL-S1-BROWSER","sol-browser"]},"luna":162}';; *) echo '{"sol":0,"luna":0}';; esac\n`);
chmodSync(path.join(scratch, "split.sh"), 0o755);
const FIGURE = "$8,753.10"; // fixtures/spend.json claude_usd_equiv 8753.1, as today's report
writeFileSync(path.join(scratch, "spend-today.json"), JSON.stringify({ ...JSON.parse(readFileSync(path.join(REPO, "services/node/test/fixtures/spend.json"), "utf8")), day: day(new Date()) }));

// Agent Zero's task store: three projects, every stage, his words up to ~600 characters, two that need him, live today,
// yesterday and earlier, three dropped, one with no words of his.
const tasksDir = path.join(scratch, "a0/tasks");
mkdirSync(tasksDir, { recursive: true });
const LONG = "i feel like tasks should be a better widget like i can't really see shit from this it's kind of like cut off and the board scrolls sideways and the owner names are cut to STREAM… and i want to read my own words in full every time, ".repeat(3).trim();
const yesterday = new Date(midnight.valueOf() - 6 * 3_600_000).toISOString();
const earlier = new Date(midnight.valueOf() - 4 * 86_400_000).toISOString();
const specs = [];
const add = (stage, project, extra = {}) => specs.push({ stage, project, ...extra });
for (const s of ["thought", "specced", "allocated", "building", "built", "tested", "preview", "rework", "feedback"]) add(s, "Agent Base");
for (const s of ["thought", "building", "built", "specced", "allocated", "thought", "thought"]) add(s, "HALO");
add("thought", "Estate"); add("building", "Estate", { priority: "P0" });
add("allocated", "Agent Base", { next: "NEEDS HIM: sign in to Vercel so the deploy can run" });
add("specced", "HALO", { next: "PARKED: needs him to decide on the mini" });
for (let i = 0; i < 6; i++) add("live", i % 2 ? "HALO" : "Agent Base", { live: todayAt(0.2 + i * 0.1) });
add("happy", "Agent Base", { live: todayAt(0.15) });
for (let i = 0; i < 3; i++) add("live", "Estate", { live: yesterday });
add("integrated", "HALO", { live: earlier });
for (let i = 0; i < 3; i++) add("dropped", "Agent Base");
add("thought", "Agent Base", { noHis: true });
const tasks = specs.map((s, i) => {
  const id = `t-${String(i + 1).padStart(4, "0")}`;
  const his = s.noHis ? undefined : i % 4 === 0 ? LONG : `fixture words for ${id}: make ${s.project} ${s.stage} work the way I asked`;
  const next = s.next ?? (i % 5 === 0 ? "NOW: wire the route" : "build it");
  const history = [{ at: iso(600), stage: "thought", by: "A0", note: "filed" }, ...(s.live ? [{ at: s.live, stage: s.stage, by: "ab-queue", note: "went live" }] : [{ at: iso(30 + i), stage: s.stage, by: "A0", note: `moved to ${s.stage}` }])];
  const owner = i % 3 === 0 ? "STREAMING-CLAUDE" : "AGENT-BASE";
  const summary = { id, title: `Fixture task ${id} for ${s.project}`, project: s.project, priority: s.priority ?? ["P1", "P2", "P3"][i % 3], stage: s.stage, owner, model: null, updated: iso(30 + i) };
  writeFileSync(path.join(tasksDir, `${id}.json`), JSON.stringify({ ...summary, ...(his ? { his } : {}), next, history }));
  return summary;
});
writeFileSync(path.join(tasksDir, "INDEX.json"), JSON.stringify({ updated: new Date(now).toISOString(), counts: {}, tasks }));
const liveToday = specs.map((s, i) => [tasks[i].id, s.live]).filter(([, at]) => at && new Date(at) >= midnight).map(([id]) => id);

// ---------------------------------------------------------------- run
const results = [];
const check = (name, ok, detail = {}) => {
  results.push(!!ok);
  console.log(JSON.stringify({ check: name, ok: !!ok, ...detail }));
};
const node = spawn(process.execPath, ["--experimental-strip-types", "--no-warnings", "src/server.ts"], {
  cwd: path.join(REPO, "services/node"),
  env: { ...process.env, HOME: scratch, AB_SERVERS_FILE: path.join(scratch, "servers.json"), AB_CLAUDE_DIRS: path.join(scratch, "claude"), AB_PORT: String(PORT), AB_HUB_HOME: scratch, AB_ORG_HOME: scratch, AB_ROLODEX_HOME: scratch, FAKE_HERDR_AGENTS: JSON.stringify(AGENTS), AB_HERDR: `${process.execPath} ${path.join(REPO, "services/node/test/fake-herdr.mjs")}`, AB_HOSTS_DIR: path.join(scratch, "hosts"), AB_STATE: path.join(scratch, "rows.json"), AB_REGISTRY: path.join(scratch, "registry.json"), AB_A0_SEAT: path.join(scratch, "seat.json"), AB_RESURRECT_DIR: path.join(scratch, "none"), AB_CONSOLE_EVENTS: path.join(scratch, "none.jsonl"), AB_A0_TASKS: tasksDir, AB_A0_TASK_CMD: path.join(scratch, "no-a0-task"), AB_QUEUE_STATE: queue, AB_BURN_CMD: `cat ${path.join(scratch, "burn.json")}`, AB_SPLIT_CMD: `${path.join(scratch, "split.sh")} split --json`, AB_SPEND_CMD: `cat ${path.join(scratch, "spend-today.json")}` },
  stdio: "ignore",
});
let browser = null;
const shot = async (page, name) => SHOTS && page.screenshot({ path: path.join(SHOTS, `${name}.png`) });
/** Every element under `root` drawn in the needs-you amber (text, background or border), with whether it is a needs-you part. */
const amberAudit = (page, root) => page.evaluate((sel) => {
  const probe = document.createElement("i");
  probe.style.color = "var(--color-needs)";
  document.body.append(probe);
  const amber = getComputedStyle(probe).color;
  probe.remove();
  const bad = [];
  for (const el of document.querySelectorAll(`${sel} *`)) {
    const cs = getComputedStyle(el);
    const hit = [cs.color, cs.backgroundColor, cs.borderTopColor].some((c) => c === amber) || cs.backgroundImage.includes(amber);
    if (hit && !el.closest(".is-needs, .ab-tasks__needs, .ab-tasks__dot")) bad.push(`${el.tagName.toLowerCase()}.${el.className}`.slice(0, 80));
  }
  return { amber, bad: bad.slice(0, 5), count: bad.length };
}, root);
try {
  for (let i = 0; i < 150; i++) {
    try {
      if ((await fetch(`${BASE}/api/health`)).ok) break;
    } catch {}
    await new Promise((r) => setTimeout(r, 200));
  }
  const ship = await (await fetch(`${BASE}/api/ship`)).json();
  check("/api/ship folds the fixture queue: 5 live today, 3 deploys, 2 waiting, 1 conflict", ship.today.live === 5 && ship.today.deploys === 3 && ship.today.waiting === 2 && ship.today.conflict === 1, { today: ship.today });
  const usage = await (await fetch(`${BASE}/api/usage`)).json();
  check("/api/usage carries data.split from spend-ledger for today and yesterday", usage.data?.split?.yesterday?.luna === 162 && usage.data?.split?.today?.sol === 0, { split: usage.data?.split });
  const index = await (await fetch(`${BASE}/api/a0/tasks`)).json();
  check("the task index carries his words and live_at", index.tasks.filter((t) => t.his).length === tasks.length - 1 && index.tasks.filter((t) => t.live_at).length === 11, { his: index.tasks.filter((t) => t.his).length, live: index.tasks.filter((t) => t.live_at).length });

  browser = await webkit.launch();
  const page = await browser.newPage({ viewport: { width: 1512, height: 982 } });
  const errors = [];
  page.on("pageerror", (e) => !/access control checks/.test(e.message) && errors.push(e.message));
  const strip = (label) => page.locator(`[data-testid=top-nav] button[aria-label="${label}"]`).first();
  const openPage = async (label, ready) => {
    for (let i = 0; i < 10 && !(await ready.isVisible()); i++) {
      await strip(label).click({ timeout: 3000 }).catch(() => {});
      await ready.waitFor({ timeout: 2000 }).catch(() => {});
    }
    await ready.waitFor({ timeout: 5000 });
  };
  await page.addInitScript(() => localStorage.setItem("agent-base:sidebar-open", "false"));
  await page.goto(BASE);

  // ---- Stats, option A
  const stats = page.locator("main[data-testid=fleet-stats][data-host=page]");
  await openPage("Stats", stats);
  await page.locator("[data-testid=stats-machines] .ab-mach__row").first().waitFor({ timeout: 10000 });
  await page.locator("[data-testid=stats-codex] [data-testid=codex-split]").waitFor({ timeout: 10000 });
  await page.waitForFunction((f) => document.querySelector("[data-cell=spend]")?.textContent?.includes(f), FIGURE, { timeout: 10000 }).catch(() => {});
  await shot(page, "stats-1512");
  const sentence = (await page.getByTestId("stats-sentence").innerText()).replace(/\s+/g, " ").trim();
  check("the answer comes first: working, went live today, the login past 60% of its week", /^3 agents working\. 5 things went live today, .*30 min of being built\. claude-siso-3 is at 76% of its week\.$/.test(sentence), { sentence });
  const fit = await page.evaluate(() => {
    const ids = ["stat-bar", "stats-ship", "stats-logins", "stats-grant", "stats-codex", "stats-machines"];
    return { bottoms: ids.map((id) => Math.round(document.querySelector(`[data-testid=${id}]`).getBoundingClientRect().bottom)), h: innerHeight };
  });
  check("1. at 1512 x 982 the sentence, stat bar, ship, logins, grant, Codex and Machines show without scrolling", fit.bottoms.every((b) => b <= fit.h), fit);
  const cells = await page.locator("[data-testid=stat-bar] .ab-st__cell").evaluateAll((els) => els.map((e) => ({ key: e.dataset.cell, fig: e.querySelector(".ab-st__fig").textContent, i: e.querySelector(".ab-st__i").getAttribute("title") })));
  const fig = Object.fromEntries(cells.map((c) => [c.key, c.fig]));
  check("2. the stat bar's figures are its routes' fields: herdr's working 3, /api/ship's 5 live and median, /api/spend's today", fig.working === "3" && fig.live === String(ship.today.live) && fig.lead === `${ship.today.leadMin.median} min` && fig.spend === FIGURE, { fig });
  const infos = await page.locator("[data-testid=fleet-stats] .ab-st__i").evaluateAll((els) => els.map((e) => e.getAttribute("title")));
  check("2. every card and cell names its route behind an i", infos.length === 9 && infos.every((t) => /From \/api\/(servers|ship|spend|usage|tokens)/.test(t)), { n: infos.length, infos: infos.filter((t) => !/From \/api\/(servers|ship|spend|usage|tokens)/.test(t)) });
  const sourceText = await page.locator("[data-testid=fleet-stats]").innerText();
  check("no source text under values (rule 7): sources live only in the i", !/Source:|\/api\//.test(sourceText));
  const logins = await page.locator("[data-testid=stats-logins] .ab-login").evaluateAll((els) => els.map((e) => e.dataset.login));
  const grant = (await page.getByTestId("stats-grant").innerText()).replace(/\s+/g, " ");
  const codex = (await page.getByTestId("stats-codex").innerText()).replace(/\s+/g, " ");
  check("logins by weekly %, the one filling before its reset says so", logins.join(",") === "claude-siso-3,claude-siso" && (await page.locator("[data-testid=stats-logins] .ab-login__warn").innerText()).includes("Full in ~22 h"), { logins });
  check("the grant: $212.51 left of $250, spent, its hourly rate and the daily spend that uses it all", grant.includes("$212.51 left of $250.00") && grant.includes("Spent $37.49") && grant.includes("$16.55/h") && grant.includes("$6.36 a day"), { grant });
  check("Codex: 56,604 of 60,000 left; yesterday's split, Sol against his 20%", codex.includes("56,604 of 60,000 left") && /Yesterday's split · Sol 7\d% against your 20%/.test(codex) && codex.includes("most to SOL-S1-BROWSER, sol-browser"), { codex });
  const machines = await page.locator("[data-testid=stats-machines] .ab-mach__row").evaluateAll((els) => els.map((e) => `${e.dataset.machine}:${e.className.match(/is-(\w+)/)[1]}`));
  const why = await page.locator("[data-testid=stats-machines] .ab-mach__why").innerText();
  check("machines: a row each with data, the bad one red with its why; no-data machines in one quiet line", machines.join(",") === "laptop:ok,vps:bad,mini:ok" && why.includes("11.6 GB disk free") && (await page.getByTestId("stats-machines").innerText()).includes("FIXTURE-CAM:"), { machines, why });
  const foot = await page.getByTestId("stats-foot").innerText();
  check("the foot line says what is not recorded yet and the spec's default for working (q2, q3)", /Not recorded yet: tokens used on FIXTURE-VPS and FIXTURE-MINI/.test(foot) && /Sol\/Luna split/.test(foot) && /this Mac's herdr only/.test(foot), { foot });
  const amberStats = await amberAudit(page, "[data-testid=fleet-stats]");
  check("6. nothing on Stats is amber", amberStats.count === 0, amberStats);
  const glow = await page.evaluate(() => [...document.querySelectorAll("[data-testid=fleet-stats] *")].filter((e) => getComputedStyle(e).boxShadow !== "none").map((e) => e.closest(".ab-ship__row")?.className.includes("is-alive") ? "ship-alive" : e.classList.contains("ab-mach__dot") ? "machine-dot" : `${e.tagName}.${e.className}`));
  check("6. only waiting ship bars and machine dots glow on Stats", glow.length > 0 && glow.every((g) => g === "ship-alive" || g === "machine-dot"), { glow: [...new Set(glow)] });
  // A killed route blanks only its card.
  await page.route("**/api/ship", (r) => r.fulfill({ status: 502, body: "down" }));
  await page.reload();
  await openPage("Stats", stats);
  await page.getByTestId("stats-ship").getByText("Unavailable: HTTP 502").waitFor({ timeout: 10000 }).catch(() => {});
  const shipDown = (await page.getByTestId("stats-ship").innerText()).includes("Unavailable: HTTP 502");
  const othersUp = (await page.locator("[data-testid=stats-logins] .ab-login").count()) === 2 && (await page.locator("[data-testid=stats-machines] .ab-mach__row").count()) === 3 && (await page.locator("[data-cell=working] .ab-st__fig").innerText()) === "3";
  check("2. killing /api/ship blanks only the ship card (and its cells); logins, machines and working stay", shipDown && othersUp && (await page.locator("[data-cell=live]").innerText()).includes("Unavailable: HTTP 502"), { shipDown, othersUp });
  await page.unroute("**/api/ship");

  // ---- Tasks, option A
  const tasksMain = page.locator("main[data-testid=a0-tasks-page][data-host=page]");
  await openPage("Tasks", tasksMain);
  await page.locator(".ab-trow").first().waitFor({ timeout: 10000 });
  const selected = await page.locator("[role=tab][aria-selected=true]").getAttribute("data-tab");
  check("Needs you opens first while it has anything", selected === "needs", { selected });
  const badge = async (tab) => Number(await page.locator(`[role=tab][data-tab=${tab}] b`).innerText());
  const expandAll = async (scope) => {
    for (let i = 0; i < 20; i++) {
      const more = scope.locator(".ab-tgroup__more[aria-expanded=false]");
      if (!(await more.count())) break;
      await more.first().click();
    }
  };
  const ids = (scope) => scope.locator(".ab-trow").evaluateAll((els) => els.map((e) => e.dataset.id));
  const needsIds = await ids(tasksMain);
  const amberRows = await page.locator(".ab-trow.is-needs .ab-trow__dot").evaluateAll((els) => els.map((e) => `${getComputedStyle(e).animationName} ${getComputedStyle(e).animationDuration}`));
  check("6. needs-you rows (feedback, NEEDS HIM, a parked ask) breathe amber, 2.4 s", amberRows.length === 3 && amberRows.every((a) => a === "ab-needs-breathe 2.4s"), { amberRows });
  await page.locator("[role=tab][data-tab=now]").click();
  await expandAll(tasksMain);
  const nowIds = await ids(tasksMain);
  const nowBadge = await badge("now");
  await shot(page, "tasks-1512");
  const clipped = (scope) => scope.locator(".his").evaluateAll((els) => els.filter((e) => e.scrollHeight > e.clientHeight + 1 || e.scrollWidth > e.clientWidth + 1 || getComputedStyle(e).webkitLineClamp !== "none" && getComputedStyle(e).webkitLineClamp !== "" || getComputedStyle(e).textOverflow === "ellipsis").map((e) => e.closest(".ab-trow").dataset.id));
  const clipPage = await clipped(tasksMain);
  const hisWidth = await tasksMain.locator(".his").first().evaluate((e) => Math.round(e.closest("main").getBoundingClientRect().width));
  check("4. no line of his words is clipped on the page", clipPage.length === 0 && (await tasksMain.locator(".his").count()) === nowIds.length, { clipPage, pageWidth: hisWidth });
  check("the long words are there in full", (await tasksMain.locator(".his", { hasText: LONG.slice(-60) }).count()) > 0);
  await page.locator("[role=tab][data-tab=done]").click();
  const doneToday = await badge("done");
  await expandAll(tasksMain);
  const todayIds = await tasksMain.locator("section[data-day=Today] .ab-trow").evaluateAll((els) => els.map((e) => e.dataset.id));
  await page.locator(".ab-tasks__dropped").click();
  await expandAll(tasksMain);
  const doneIds = await ids(tasksMain);
  const reach = new Set([...nowIds, ...doneIds]);
  check("3. Done › Today lists every task whose live_at is today, and its count says so", todayIds.sort().join() === liveToday.sort().join() && doneToday === liveToday.length, { todayIds, liveToday, doneToday });
  check("3. Now + Done + dropped is the index: every task reachable, none twice; Needs you sits inside Now", reach.size === tasks.length && nowIds.length + doneIds.length === tasks.length && nowBadge === nowIds.length && needsIds.every((id) => nowIds.includes(id)), { now: nowIds.length, done: doneIds.length, index: tasks.length, nowBadge });
  const amberTasks = await amberAudit(page, "main[data-testid=a0-tasks-page]");
  check("6. nothing else on Tasks is amber", amberTasks.count === 0, amberTasks);
  // A row opens in place: the track, Next and Lately, the owner's chat; Esc closes it.
  await page.locator("[role=tab][data-tab=now]").click();
  const row = tasksMain.locator(".ab-trow").first();
  await row.locator(".ab-trow__line").click();
  await row.locator("[data-testid=task-open] .ab-topen__cols").waitFor({ timeout: 5000 });
  const opened = await row.locator("[data-testid=task-open]").innerText();
  check("tap a row: it opens in place with the stage track, Next, Lately and the owner's chat", /Next/i.test(opened) && /Lately/i.test(opened) && /Open (AGENT-BASE|STREAMING-CLAUDE)'s chat/.test(opened) && (await row.locator(".ab-topen__track .is-here").count()) === 1, { opened: opened.slice(0, 160) });
  await page.keyboard.press("Escape");
  check("Esc closes the open row", (await page.locator("[data-testid=task-open]").count()) === 0);
  await page.keyboard.press("/");
  await page.keyboard.type("for Estate");
  const found = await ids(tasksMain);
  check("/ goes to search; it filters by his words, title, owner or id", found.length === 2 && found.every((id) => index.tasks.find((t) => t.id === id).project === "Estate"), { found });
  await page.locator("input[type=search]").fill("");

  // ---- Pop out
  await page.locator("button[aria-label^='Home']").first().click();
  await page.locator("section[aria-label=Chat]").waitFor({ state: "visible", timeout: 10000 });
  await strip("Tasks").click({ modifiers: ["Alt"] });
  const pop = page.locator("[data-testid=page-pop]");
  await pop.waitFor({ timeout: 5000 });
  await pop.locator(".ab-trow").first().waitFor({ timeout: 10000 });
  const side = await page.locator(".siso-sidenav").boundingBox();
  const popBox = await pop.boundingBox();
  const chat = await page.locator("section[aria-label=Chat]").boundingBox();
  const underline = await strip("Tasks").evaluate((b) => b.hasAttribute("data-popped") && getComputedStyle(b, "::before").height);
  await shot(page, "pop-tasks-1512");
  check("5. ⌥-click pops Tasks out at 380 px right of the side nav, the chat beside it, the icon underlined", Math.round(popBox.width) === 380 && popBox.x >= side.x + side.width - 1 && chat && chat.width > 300 && chat.x >= popBox.x + popBox.width - 1 && underline === "2px", { pop: popBox, side, chat, underline });
  const clipPop = await clipped(pop);
  check("4. no line of his words is clipped popped out (380 px), faces only", clipPop.length === 0 && (await pop.locator(".ab-trow__owner b").first().isHidden()), { clipPop });
  await page.reload();
  await pop.waitFor({ timeout: 10000 });
  check("5. a reload keeps it popped (ab.popped)", (await pop.getAttribute("data-page")) === "tasks" && (await page.evaluate(() => localStorage.getItem("ab.popped"))) === "tasks");
  const handle = page.locator('[aria-label="Resize Tasks"]');
  const drag = async (dx) => {
    const b = await handle.boundingBox();
    await page.mouse.move(b.x + b.width / 2, b.y + 200);
    await page.mouse.down();
    await page.mouse.move(b.x + b.width / 2 + dx, b.y + 200, { steps: 8 });
    await page.mouse.up();
    return Math.round((await pop.boundingBox()).width);
  };
  const wide = await drag(400), narrow = await drag(-500);
  await handle.dblclick();
  const reset = Math.round((await pop.boundingBox()).width);
  check("5. the edge drags 320-560 and a double-click resets to 380", wide === 560 && narrow === 320 && reset === 380, { wide, narrow, reset });
  await pop.getByRole("button", { name: "Open Tasks as a page" }).click();
  await tasksMain.waitFor({ timeout: 5000 });
  check("5. ⤢ restores the page", (await pop.count()) === 0 && (await page.getByRole("heading", { name: "Tasks", level: 1 }).isVisible()));
  await tasksMain.getByRole("button", { name: "Pop out" }).click();
  await pop.waitFor({ timeout: 5000 });
  check("Pop out on the page docks it and the view goes back to the chat", (await tasksMain.count()) === 0 && (await page.locator("section[aria-label=Chat]").isVisible()));
  await pop.getByRole("button", { name: "Close Tasks" }).click();
  check("5. × closes it", (await pop.count()) === 0 && (await page.evaluate(() => localStorage.getItem("ab.popped"))) === "" && !(await strip("Tasks").getAttribute("data-popped")));
  await strip("Stats").click({ modifiers: ["Alt"] });
  await pop.locator("[data-testid=stat-bar] .ab-st__cell").first().waitFor({ timeout: 10000 });
  const grid = await pop.locator("[data-testid=stat-bar] .ab-st__cell").evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().y)));
  await shot(page, "pop-stats-1512");
  check("Stats pops out too: the stat bar 2 x 2, the header's one line", grid[0] === grid[1] && grid[2] > grid[0] && grid[2] === grid[3] && /Stats · 3 working · \d+ live today/.test(await pop.locator(".ab-pop__head h2").innerText()), { grid });
  await pop.locator(".ab-pop__box").focus();
  await page.keyboard.press("Escape");
  check("Esc inside the pop closes it", (await pop.count()) === 0);
  check("no page errors", errors.length === 0, { errors: errors.slice(0, 3) });
} catch (e) {
  check("ran to the end", false, { error: String(e?.stack ?? e).slice(0, 800) });
} finally {
  await browser?.close();
  node.kill();
  rmSync(scratch, { recursive: true, force: true });
}
const passed = results.filter(Boolean).length;
console.log(JSON.stringify({ passed, of: results.length }));
process.exit(passed === results.length ? 0 : 1);
