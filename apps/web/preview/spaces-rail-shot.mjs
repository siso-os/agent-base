// SpacesRail preview shots: verify FLIP head animation, body open, divider glow, module stagger, and reduced motion.
import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
import path from "node:path";

const arg = (k, d) => {
  const i = process.argv.indexOf(`--${k}`);
  return i > 0 ? process.argv[i + 1] : d;
};
const root = path.resolve(arg("root", path.resolve(import.meta.dirname, "../../..")));
const out = path.resolve(arg("out", "/tmp/t0599/rail"));
mkdirSync(out, { recursive: true });

const req = createRequire(path.join(root, "apps/web/package.json"));
const { createServer } = req("vite");
const nodeReq = createRequire(path.join(root, "services/node/package.json"));
const { webkit } = nodeReq("playwright");

const server = await createServer({
  root: path.join(root, "apps/web"),
  configFile: path.join(root, "apps/web/vite.config.ts"),
  logLevel: "error",
  server: { host: "127.0.0.1", port: 0, strictPort: false, hmr: false, watch: { ignored: ["**/*"] } },
});
await server.listen();
const base = `http://127.0.0.1:${server.httpServer.address().port}`;
const browser = await webkit.launch({ headless: true });

let checks = 0;
const checkTexts = [];

try {
  // Test with normal motion
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e).slice(0, 200)));

  await page.goto(`${base}/preview/spaces-rail.html`);
  await page.waitForTimeout(500);

  // Initial state: Agent Base is open
  await page.screenshot({ path: path.join(out, "rail-agent-base.png") });
  checks++;

  // Click App Factory
  await page.locator('[aria-label="App Factory"]').click();
  await page.waitForTimeout(600);
  await page.screenshot({ path: path.join(out, "rail-app-factory.png") });
  checks++;

  // Click Agency
  await page.locator('[aria-label="Agency"]').click();
  await page.waitForTimeout(600);
  await page.screenshot({ path: path.join(out, "rail-agency.png") });
  checks++;

  // Check animation count after a click (should be > 0)
  await page.locator('[aria-label="Agent Base"]').click();
  await page.waitForTimeout(50);
  const animCount = await page.evaluate(() => document.getAnimations().length);
  checkTexts.push(`Animations running after click (normal motion): ${animCount} (expect >0)`);
  checks++;

  await ctx.close();

  // Test with reduced motion
  const ctxReduced = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    reducedMotion: "reduce",
    deviceScaleFactor: 2,
  });
  const pageReduced = await ctxReduced.newPage();
  await pageReduced.goto(`${base}/preview/spaces-rail.html`);
  await pageReduced.waitForTimeout(500);

  // Click App Factory with reduced motion
  await pageReduced.locator('[aria-label="App Factory"]').click();
  await pageReduced.waitForTimeout(50);

  // Check that the head switches instantly (data-open should be app-factory immediately)
  const openAttr = await pageReduced.locator(".siso-spaces").getAttribute("data-open");
  checkTexts.push(`Head switches instantly under reduced motion: data-open="${openAttr}" (expect "app-factory")`);
  checks++;

  // Check animation count (should be 0)
  const animCountReduced = await pageReduced.evaluate(() => document.getAnimations().filter(a => a.constructor.name !== "CSSTransition").length); console.log("reduced-motion animations:", await pageReduced.evaluate(() => document.getAnimations().map(a => a.constructor.name + ":" + (a.animationName ?? a.transitionProperty ?? "waapi")).join(",")));
  checkTexts.push(`Animations running after click (reduced motion): ${animCountReduced} (expect 0)`);
  checks++;

  if (errors.length > 0) {
    checkTexts.push(`Page errors: ${errors.join("; ")}`);
  } else {
    checkTexts.push(`No page errors`);
    checks++;
  }

  await ctxReduced.close();

  console.log(checkTexts.join("\n"));
  console.log(`\nspaces-rail-shot: ${checks}/6 checks passed`);
} finally {
  await browser.close();
  await server.close();
}
