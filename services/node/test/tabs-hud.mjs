// Check: top-bar tabs close in one click and overflow like Chrome's; the bottom bar counts sub-agents (2 Oct 13:52).
//   node services/node/test/tabs-hud.mjs [shots-dir]
// Own herdr lab session with two fake agents (ALPHA leads BRAVO), a node on :5407 with scratch state, headless WebKit.
import { execFileSync, spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const RESEARCH = path.join(process.env.HOME, "SISO_Workspace/SISO_Agency/apps/siso-internal-labs/siso-internal-labs-agents/.agents/research/2026-10-01-agent-app");
const { webkit } = await import(path.join(RESEARCH, "ui-rob/t3code/node_modules/playwright/index.mjs"));
const LAB = path.join(RESEARCH, "tests/1-clean-terminal/lab");
const REPO = path.join(import.meta.dirname, "../../..");
const [shots = path.join(RESEARCH, "chat-study/shots")] = process.argv.slice(2);
const PORT = 5407;
const scratch = mkdtempSync(path.join(process.env.TMPDIR ?? tmpdir(), ".siso-ephemeral-tabs-hud."));
const lab = (...a) => execFileSync(LAB, a, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
const SESSION = lab("name", "tabshud").trim();
const herdr = (...a) => JSON.parse(lab("run", SESSION, ...a) || "{}");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, detail = {}) => {
  results.push(!!ok);
  console.log(JSON.stringify({ check: name, ok: !!ok, ...detail }));
};
const post = (p, body) => fetch(`http://127.0.0.1:${PORT}${p}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).then((r) => r.json());

let node = null;
let browser = null;
try {
  lab("provision", SESSION);
  herdr("workspace", "create", "--label", "lab", "--no-focus");
  herdr("pane", "split", "w1:p1", "--direction", "right");
  for (const [pane, name, state] of [["w1:p1", "ALPHA", "idle"], ["w1:p2", "BRAVO", "working"]]) {
    herdr("pane", "run", pane, `printf '\\033]2;${name}\\007'; read x`);
    await sleep(500);
    herdr("pane", "report-agent", "--source", "lab", "--agent", "fake", "--state", state, pane);
  }
  node = spawn(process.execPath, ["--experimental-strip-types", "--no-warnings", "src/server.ts"], {
    cwd: path.join(REPO, "services/node"),
    env: { ...process.env, AB_PORT: String(PORT), AB_HERDR: `${LAB} run ${SESSION}`, AB_STATE: path.join(scratch, "rows.json"), AB_REGISTRY: path.join(scratch, "registry.json"), AB_HOSTS_DIR: path.join(scratch, "hosts"), AB_CTX_DIR: path.join(scratch, "ctx"), AB_CONSOLE_EVENTS: path.join(scratch, "none.jsonl"), AB_RESURRECT_DIR: path.join(scratch, "none") },
    stdio: "ignore",
  });
  for (let i = 0; i < 50; i++) {
    try {
      if ((await fetch(`http://127.0.0.1:${PORT}/api/health`)).ok) break;
    } catch {}
    await sleep(200);
  }
  await post("/api/registry", { op: "register", name: "ALPHA", domain: "Lab" });
  await post("/api/registry", { op: "register", name: "BRAVO", domain: "Lab", lead: "ALPHA" });
  for (let i = 1; i <= 16; i++) await post("/api/registry", { op: "pin-page", url: `http://example.test/p${i}`, title: `A pinned page with a really quite long name, number ${i}` });

  browser = await webkit.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`http://127.0.0.1:${PORT}/`);
  await page.locator('[data-testid=rail-row][aria-label^="ALPHA,"]').click();
  await page.waitForTimeout(1200);

  const tabs = page.locator(".siso-toptabs > .siso-toptab");
  const shown = await tabs.count();
  const more = page.locator(".siso-toptabs__more > button");
  const moreText = await more.innerText().catch(() => "");
  check("tabs shrink to fit and the rest go into '⌄ N more'", (await more.count()) === 1 && /\d+ more/.test(moreText), { shown, more: moreText });
  const widths = await tabs.evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().width)));
  const closes = await page.locator(".siso-toptabs > .siso-toptab.can-close .siso-tab-close").count();
  check("every page tab shows its × (none pushed off by a long name), tabs no narrower than 90px", closes === shown - 1 && Math.min(...widths) >= 89, { closes, shown, minWidth: Math.min(...widths) });
  await page.screenshot({ path: `${shots}/tabs-1-overflow.png` });

  const pinned = () => JSON.parse(readFileSync(path.join(scratch, "registry.json"), "utf8")).pinnedPages.length;
  const before = pinned();
  await page.locator(".siso-toptabs > .siso-toptab.can-close .siso-tab-close").first().click();
  await page.waitForTimeout(800);
  check("one click on × closes a tab (a pin unpins)", pinned() === before - 1, { before, after: pinned() });
  await page.locator(".siso-toptabs > .siso-toptab.can-close").first().click({ button: "middle" });
  await page.waitForTimeout(800);
  check("middle-click closes a tab", pinned() === before - 2, { after: pinned() });
  await more.click();
  const rows = page.locator(".siso-toptabs__row");
  const nRows = await rows.count();
  await rows.first().locator(".siso-tab-close").click();
  await page.waitForTimeout(800);
  check("'N more' lists the rest, each with its ×", nRows > 0 && pinned() === before - 3, { rows: nRows, after: pinned() });
  await page.screenshot({ path: `${shots}/tabs-2-more.png` });
  await page.keyboard.press("Escape");

  const pill = (await page.locator("[data-testid=hud] [data-testid=faces-pill]").getAttribute("aria-label")) ?? "";
  check("the HUD's faces pill counts sub-agents running / total (crew included)", /1 running of 1/.test(pill), { pill });
  check("no page errors", errors.length === 0, { errors: errors.slice(0, 3) });
} catch (e) {
  check("ran to the end", false, { error: String(e?.stack ?? e).slice(0, 700) });
} finally {
  await browser?.close();
  node?.kill();
  try {
    lab("teardown", SESSION);
  } catch (e) {
    console.error(`teardown ${SESSION} failed: ${e}`);
  }
  rmSync(scratch, { recursive: true, force: true });
}
const passed = results.filter(Boolean).length;
console.log(JSON.stringify({ passed, of: results.length }));
process.exit(passed === results.length ? 0 : 1);
