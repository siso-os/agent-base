import { suitePort } from './suite-runtime.mjs';
// servers-tokens (3 Oct): the Tokens page's money band above TokenTracker's sections. Accounts are people (claude-credits'
// LOGINS: fuzeheritage, lordsisodia; ~/.claude is Fahmy's and is left out of every total), the $250 grant is real money,
// Codex reads its credit balance (not "100% used"), the Luna/Sol split against 80/20, DeepSeek's share left, who is
// burning it today and where it ran (the VPS rollup, over a fake ssh). Every input is a fixture: session files in a
// scratch HOME, burn-rate / spend-ledger / quota-axi as files a fake command prints, a fake herdr. It pops out into the
// right panel too. WebKit, else the cloud box's Chromium (AB_CHROMIUM). Usage: node services/node/test/tokens-money-ui.mjs [shots dir]
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { chromium, webkit } from "playwright";

const REPO = path.join(import.meta.dirname, "../../..");
const NODE_DIR = path.join(REPO, "services/node");
const PORT = await suitePort();
const BASE = `http://127.0.0.1:${PORT}`;
const SHOTS = process.argv[2] ?? path.join(import.meta.dirname, ".shots-tokens-money");
mkdirSync(SHOTS, { recursive: true });
const scratch = mkdtempSync(path.join(process.env.TMPDIR ?? tmpdir(), ".siso-ephemeral-tokens-money."));
const home = path.join(scratch, "home");
const results = [];
const check = (name, ok, detail = {}) => {
  results.push(!!ok);
  console.log(JSON.stringify({ check: name, ok: !!ok, ...detail }));
};
const until = async (f, ms) => {
  for (const end = Date.now() + ms; Date.now() < end; await new Promise((r) => setTimeout(r, 150))) if (await f().catch(() => false)) return true;
  return false;
};

// ---------------------------------------------------------------- fixture
const now = Date.now();
const midnight = new Date(now).setHours(0, 0, 0, 0);
const todayAt = (h) => Math.min(now - 60_000, midnight + h * 3_600_000);
const day = (t) => {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const TODAY = day(now);
const YESTERDAY = day(now - 86_400_000);
let n = 0;
function claude(dir, session, rows) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, `${session}.jsonl`), rows.map(([t, input, output]) => JSON.stringify({ type: "assistant", timestamp: new Date(t).toISOString(), sessionId: session, cwd: "/lab", requestId: `req-${++n}`, message: { role: "assistant", id: `msg-${n}`, model: "claude-opus-4-6", stop_reason: "end_turn", usage: { input_tokens: input, output_tokens: output } } })).join("\n") + "\n");
}
claude(path.join(home, ".claude/projects/-lab-fahmy"), "s-fahmy", [[todayAt(1), 30_000_000, 7_000_000]]);
claude(path.join(home, ".claude-siso/projects/-lab-fuze"), "s-fuze", [[todayAt(2), 400_000_000, 65_000_000]]);
claude(path.join(home, ".config/claude-siso-3/projects/-lab-lord"), "s-lord", [[todayAt(3), 800_000_000, 51_000_000]]);
const mine = 465_000_000 + 851_000_000;
mkdirSync(path.join(home, ".codex/sessions/2026/10/03"), { recursive: true });
const weekReset = Math.floor((now + 6 * 86_400_000) / 1000);
writeFileSync(path.join(home, ".codex/sessions/2026/10/03/rollout-lab.jsonl"), [
  { timestamp: new Date(todayAt(0)).toISOString(), type: "turn_context", payload: { model: "gpt-5-codex", cwd: "/lab" } },
  { timestamp: new Date(todayAt(4)).toISOString(), type: "event_msg", payload: { type: "token_count", info: { total_token_usage: { total_tokens: 50_000 }, last_token_usage: { input_tokens: 40_000, cached_input_tokens: 10_000, output_tokens: 10_000, total_tokens: 50_000 } }, rate_limits: { plan_type: "pro", primary: { used_percent: 4, window_minutes: 300, resets_at: Math.floor(now / 1000) + 3600 }, secondary: { used_percent: 0, window_minutes: 10080, resets_at: weekReset }, credits: { has_credits: true, unlimited: false, balance: "56603.55" } } } },
].map((o) => JSON.stringify(o)).join("\n") + "\n");
writeFileSync(path.join(scratch, "claude-credits"), `#!/usr/bin/env python3\n# fixture\nLOGINS = {\n    "claude-siso": "fuzeheritage@example.com",\n    "claude-siso-3": "lordsisodia@example.com",\n    "claude": "Fahmy: never read or used",\n}\n`);
const iso = (ms) => new Date(ms).toISOString();
writeFileSync(path.join(scratch, "burn.json"), JSON.stringify({
  at: now,
  window_min: 60,
  claude: [
    { login: "fuzeheritage", profile: ".claude-siso", five_hour: { used_pct: 3, resets_at: iso(now + 2 * 3_600_000), pct_per_hour: 0.4, hours_to_full: null, stale: false }, seven_day: { used_pct: 27, resets_at: iso(now + 6 * 86_400_000), pct_per_hour: 0.3, hours_to_full: null, stale: false } },
    { login: "lordsisodia", profile: ".config/claude-siso-3", five_hour: { used_pct: 19, resets_at: iso(now + 3_600_000), pct_per_hour: 1, hours_to_full: null, stale: false }, seven_day: { used_pct: 77, resets_at: iso(now + 4 * 86_400_000), pct_per_hour: 2.35, hours_to_full: 10, stale: false } },
  ],
  grants: [{ login: "fuzeheritage@example.com", profile: "claude-siso", limit: 250, used: 41.15, left: 208.85, ends: iso(now + 33 * 86_400_000), usd_per_hour: 20.42, usd_per_day_to_spend: 6.24 }],
  codex: { credits_per_hour: [30, 40], pct_of_budget_per_hour: [0.05, 0.07], today_credits: [800, 900], left: [56000, 57000], hours_left_at_rate: 1400, by_model_per_hour: {}, balance: { balance: 56603.55, budget: 60000, reset: iso(now + 4 * 86_400_000), by_day: { [TODAY]: 842, [YESTERDAY]: 2449.6 } } },
}));
writeFileSync(path.join(scratch, "codex-rates.json"), JSON.stringify({ weekly_budget: 60000 }));
writeFileSync(path.join(scratch, "split.json"), JSON.stringify({ credits: 621, split: { luna: 180, sol: 441 } }));
writeFileSync(path.join(scratch, "quota.toon"), "quotas[2]{name,left_pct,resets}:\n  opencode-go,26,2026-10-16\n  zai,90,2026-10-20\n");
const sshDir = path.join(scratch, "ssh");
mkdirSync(sshDir);
writeFileSync(path.join(sshDir, "siso-vps.devices.json"), JSON.stringify([
  { device: "mini", today: 120_000_000, total: 9e9, last_seen: iso(now - 600_000) },
  { device: "laptop", today: 0, total: 41e9, last_seen: iso(now - 15 * 86_400_000) },
  { device: "siso-vps", today: 0, total: 30e9, last_seen: iso(now - 21 * 86_400_000) },
]));
writeFileSync(path.join(sshDir, "siso-vps.sync.json"), JSON.stringify({ at: iso(now), status: "synced 5" }));
const print = (f) => `${process.execPath} ${path.join(NODE_DIR, "test/fake-print.mjs")} ${f}`;
const env = {
  ...process.env,
  HOME: home,
  AB_HOME: home,
  AB_CODEX_HOME: path.join(home, ".codex"),
  AB_HUD_DIR: path.join(scratch, "ctx"),
  AB_PRICES: path.join(scratch, "no-prices.json"),
  AB_CREDITS_BIN: path.join(scratch, "claude-credits"),
  AB_BURN_CMD: print(path.join(scratch, "burn.json")),
  AB_SPLIT_CMD: "none", // burn-rate's optional side read must not invoke the operator's live ledger
  AB_LEDGER_CMD: print(path.join(scratch, "split.json")),
  AB_QUOTA_CMD: print(path.join(scratch, "quota.toon")),
  AB_CODEX_RATES: path.join(scratch, "codex-rates.json"),
  AB_SPEND_CMD: "cat test/fixtures/spend.json",
  AB_SERVERS_PROBE: "1",
  AB_SSH: `${process.execPath} ${path.join(NODE_DIR, "test/fake-ssh.mjs")}`,
  FAKE_SSH_DIR: sshDir,
  AB_TOKENS_HOST: "siso-vps",
  AB_MACHINES_FILE: path.join(scratch, "machines.json"),
  AB_STATE: path.join(scratch, "state/rows.json"),
  AB_REGISTRY: path.join(scratch, "state/registry.json"),
  AB_HOSTS_DIR: path.join(scratch, "hosts"),
  AB_RESURRECT_DIR: path.join(scratch, "none"),
  AB_CONSOLE_EVENTS: path.join(scratch, "none.jsonl"),
  AB_PORT: String(PORT),
  AB_HERDR: `${process.execPath} ${path.join(NODE_DIR, "test/fake-herdr.mjs")}`,
};
writeFileSync(path.join(scratch, "machines.json"), JSON.stringify({ machines: {} }));

async function launch() {
  try {
    return await webkit.launch();
  } catch (e) {
    const exe = process.env.AB_CHROMIUM ?? "/opt/pw-browsers/chromium";
    if (!existsSync(exe)) throw e;
    return chromium.launch({ executablePath: exe });
  }
}
const get = async (p) => (await fetch(`${BASE}${p}`)).json();

const node = spawn(process.execPath, ["--experimental-strip-types", "--no-warnings", "src/server.ts"], { cwd: NODE_DIR, env, stdio: "ignore" });
let browser = null;
try {
  await until(async () => (await fetch(`${BASE}/api/health`)).ok, 30000);

  // ---------------------------------------------------------------- the API
  let tokens;
  await until(async () => !(tokens = await get("/api/tokens")).scanning, 20000);
  const acct = Object.fromEntries(tokens.accounts.map((a) => [a.id, a]));
  check("1. accounts are people: claude-siso is fuzeheritage, claude-siso-3 lordsisodia; ~/.claude is Fahmy's, not his", acct["claude:.claude-siso"]?.person?.label === "fuzeheritage" && acct["claude:claude-siso-3"]?.person?.label === "lordsisodia" && acct["claude:.claude"]?.person?.mine === false && acct["claude:.claude"]?.name === "Fahmy", { people: tokens.accounts.map((a) => [a.id, a.person?.label, a.person?.mine]) });
  check("2. Fahmy's tokens are left out of every total (today = his two logins + Codex)", tokens.overall.today.total === mine + 50_000 && acct["claude:.claude"].today.total === 37_000_000, { today: tokens.overall.today.total, want: mine + 50_000 });
  check("3. Codex reads its credit balance from the newest event, and names the plan", acct.codex.limits?.credits?.balance === 56603.55 && /ChatGPT Pro/.test(acct.codex.name), { credits: acct.codex.limits?.credits, name: acct.codex.name });
  let money;
  await until(async () => (money = await get("/api/tokens/money")).grants && money.other.length > 0, 15000);
  const g = money.grants?.[0];
  check("4. the grant: $208.85 left of $250, ends in about a month, $6.24 a day to spend it", g?.left === 208.85 && g.limit === 250 && g.ends > now && g.perDayToSpend === 6.24 && g.perHour === 20.42, { grant: g });
  check("5. Codex money: 56,603.55 of the 60,000 budget, 842 today, 2,449.6 yesterday", money.codex.balance === 56603.55 && money.codex.budget === 60000 && money.codex.todaySpent === 842 && money.codex.yesterdaySpent === 2449.6, { codex: money.codex });
  check("6. DeepSeek (OpenCode Go): 26% of the month left, resets 16 Oct", money.other[0]?.leftPct === 26 && new Date(money.other[0].resets).getUTCDate() === 16, { other: money.other });
  let split;
  await until(async () => (split = await get(`/api/tokens/split?day=${YESTERDAY}`)).lunaPct != null, 10000);
  check("7. the Luna/Sol split yesterday: Luna 29%, Sol 71% against 80/20; the ledger saw 25% of the account's spend", split.lunaPct === 29 && split.solPct === 71 && split.target.luna === 80 && split.seenPct === 25, { split });
  let fleet;
  await until(async () => !(fleet = await get("/api/tokens/fleet")).pending, 10000);
  check("8. where it ran: the VPS rollup's devices over ssh, stale ones marked", fleet.devices.length === 3 && fleet.devices.find((d) => d.device === "mini")?.stale === false && fleet.devices.find((d) => d.device === "laptop")?.stale === true, { devices: fleet.devices.map((d) => [d.device, d.stale]) });
  const badDay = await fetch(`${BASE}/api/tokens/split?day=yesterday`);
  check("9. /api/tokens/split takes only a YYYY-MM-DD day", badDay.status === 400);

  // ---------------------------------------------------------------- the page
  browser = await launch();
  const page = await browser.newPage({ viewport: { width: 1480, height: 1100 } });
  await page.addInitScript(() => localStorage.setItem("agent-base:browser-setup", JSON.stringify({ step: 4, doneAt: 1 })));
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.addInitScript(() => localStorage.setItem("agent-base:sidebar-open", "false"));
  await page.goto(BASE);
  await page.getByTestId("top-nav").getByRole("button", { name: /Tokens/ }).click({ timeout: 20000 });
  const band = page.getByTestId("money-band");
  await band.waitFor({ timeout: 5000 });
  await until(async () => (await band.getByTestId("money-grant").count()) === 1 && (await band.getByTestId("money-split").count()) === 1 && (await band.getByTestId("money-burner").count()) > 0, 15000);
  const cards = await band.getByTestId("money-account").evaluateAll((els) => els.map((e) => e.getAttribute("data-account")));
  check("10. the band sits above TokenTracker's sections: a card per login of his (not Fahmy's), Codex and DeepSeek", cards.join() === "claude:.claude-siso,claude:claude-siso-3" && (await band.getByTestId("money-codex").count()) === 1 && (await band.getByTestId("money-other").count()) === 1 && (await band.boundingBox()).y < (await page.getByTestId("tt-overview").boundingBox()).y, { cards });
  const fuze = band.locator("[data-account='claude:.claude-siso']");
  const fuzeText = (await fuze.innerText()).replace(/\s+/g, " ");
  check("11. fuzeheritage: 5h 3% and week 27% rings, the grant bar ($208.85 left of $250) with its sentence, today in API-equiv", /fuzeheritage/.test(fuzeText) && /3%/.test(fuzeText) && /27%/.test(fuzeText) && /\$208\.85 left of \$250 grant/.test(fuzeText) && /at \$6\.24 a day it is used by then; last hour burned \$20\.42/.test(fuzeText) && /465M · .* API-equiv/.test(fuzeText), { fuzeText });
  const lord = band.locator("[data-account='claude:claude-siso-3']");
  const lordText = (await lord.innerText()).replace(/\s+/g, " ");
  check("12. lordsisodia: week 77% amber with when it fills; no cloud credits on this login", /77%/.test(lordText) && (await lord.locator("[data-testid=ring][data-tone=warn]").count()) === 1 && /at 2\.35% an hour it is full in about 10 hours/.test(lordText) && /no cloud credits on this login/.test(lordText), { lordText });
  const codex = (await band.getByTestId("money-codex").innerText()).replace(/\s+/g, " ");
  check("13. Codex: credits left of the week's budget, spent today and yesterday, Sol 71% yesterday against a 20% target", /56,604 left of 60,000 this week/.test(codex) && /842 spent today, 2,450 yesterday/.test(codex) && /Sol 71% yesterday, target 20% Sol/.test(codex), { codex });
  check("14. DeepSeek: 26% of the month left", /26% of the month left/.test(await band.getByTestId("money-other").innerText()));
  const fahmy = await band.getByTestId("money-not-mine").innerText();
  check("15. Fahmy's login is one quiet line, not a card", /Fahmy's login \(~\/\.claude\) is not counted as yours: 37(\.0)?M today/.test(fahmy), { fahmy });
  const burners = await band.getByTestId("money-burner").count();
  const burnText = await band.getByTestId("money-burners").innerText();
  check("16. who is burning it today: the top 7 owners by $ API-equiv with their faces, 'and N more'", burners === 7 && /STREAMING-CLAUDE/.test(burnText) && /API-equiv/.test(burnText) && /and \d+ more/.test(burnText), { burners });
  const where = (await band.getByTestId("money-where").innerText()).replace(/\s+/g, " ");
  check("17. where it ran: this Mac live, the mini from the rollup, the stale ones in one line", /This Mac/.test(where) && /mini 120M/.test(where) && /Not reporting: laptop \(since .*\), siso-vps \(since .*\)/.test(where), { where });
  check("18. the Codex account card below reads credits, not just a used percent", /56,604 credits left/.test(await page.getByTestId("codex-credits").innerText()));
  await page.screenshot({ path: path.join(SHOTS, "tokens-money-1480.png") });

  await page.getByTestId("pop-out").click();
  const panel = page.getByTestId("side-panel");
  await panel.locator("[data-testid=money-band][data-density=panel]").waitFor({ timeout: 5000 });
  check("19. pop-out: Tokens moves into the right panel, compact: the login rows, Codex with the split, the top 5", (await panel.getByTestId("money-account").count()) === 2 && (await panel.getByTestId("money-codex").count()) === 1 && (await panel.getByTestId("money-burner").count()) === 5 && (await page.getByTestId("tokens-page").count()) === 0);
  await page.screenshot({ path: path.join(SHOTS, "tokens-panel-1480.png") });
  check("20. no page errors", errors.length === 0, { errors: errors.slice(0, 3) });
} catch (e) {
  check("ran to the end", false, { error: String(e?.stack ?? e).slice(0, 600) });
} finally {
  await browser?.close();
  node.kill();
  rmSync(scratch, { recursive: true, force: true });
}
console.log(JSON.stringify({ passed: results.filter(Boolean).length, of: results.length }));
process.exit(results.every(Boolean) ? 0 : 1);
