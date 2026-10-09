import { mkdir } from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { createServer } from "vite";

const root = process.cwd();
const require = createRequire(import.meta.url);
const { webkit } = require("/tmp/ab-hub3-tools/node_modules/playwright");
const shots = path.join(root, "apps/web/preview");
await mkdir(shots, { recursive: true });
const server = await createServer({
  root: path.join(root, "apps/web"),
  configFile: path.join(root, "apps/web/vite.config.ts"),
  server: { host: "127.0.0.1", port: 5411, strictPort: true },
});
let browser;
try {
  await server.listen();
  browser = await webkit.launch();
  for (const width of [1280, 390]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto("http://127.0.0.1:5411/preview/project-dashboard.html", { waitUntil: "networkidle" });
    const result = await page.evaluate(viewportWidth => ({
      ownerCards: document.querySelectorAll(".pd-owner").length,
      workingCopy: [...document.querySelectorAll(".pd-kpis > div")].find(kpi => kpi.querySelector("b")?.textContent?.trim() === "1")?.querySelector("span")?.textContent?.trim(),
      noPlanCards: [...document.querySelectorAll(".pd-owner")].filter(card => card.querySelector(".pd-no-plan")?.textContent?.trim() === "No plan yet" && !card.querySelector(".pd-ring, .pd-pipeline")).length,
      stageLabels: [...new Set([...document.querySelectorAll(".pd-stage-legend span")].map(label => label.textContent?.trim()))],
      missingTimeRow: [...document.querySelectorAll(".pd-timeline li")].some(row => row.querySelector("span")?.textContent?.trim() === "HALO-UI" && row.textContent?.includes("Reviewed the recovery flow; the handoff needs one more pass.") && !row.textContent?.includes("Time not recorded")),
      reportsByOwner: Object.fromEntries([...document.querySelectorAll(".pd-owner")].map(card => [card.querySelector(".pd-owner-head h2")?.textContent?.trim(), card.querySelector(".pd-report")?.textContent?.trim()])),
      timelineOwnText: [...document.querySelectorAll(".pd-timeline li")].some(row => row.textContent?.includes("Reviewed the recovery flow; the handoff needs one more pass.") && !row.textContent?.includes("Posted a project note without a timestamp.")),
      workerSingular: [...document.querySelectorAll(".pd-crew")].some(crew => crew.textContent?.includes("1 worker · 0 working")),
      boardCountsMatchCards: [...document.querySelectorAll(".pd-column:not([data-state=checked])")].every(column => Number(column.querySelector("h3 b")?.textContent) === column.querySelectorAll(".pd-board-card").length),
      unlistedItemsNamed: ["asked", "specced", "allocated"].every(state => [...document.querySelectorAll(".pd-column")].find(column => column.dataset.state === state)?.textContent?.includes("1 item in owner totals aren’t on this board.")) && [...document.querySelectorAll(".pd-column")].find(column => column.dataset.state === "building")?.textContent?.includes("2 items in owner totals aren’t on this board."),
      ownerHolderDupes: [...document.querySelectorAll(".pd-owner")].some(card => [...card.querySelectorAll(".pd-holder")].some(holder => holder.textContent?.trim() === card.querySelector(".pd-owner-head h2")?.textContent?.trim())),
      horizontalOverflow: document.documentElement.scrollWidth > viewportWidth,
    }), width);
    const ownReports = result.reportsByOwner?.["STREAMING-CLAUDE"]?.includes("Core flow checked; verifying recovery next.") && result.reportsByOwner?.["OPS-BUILD"]?.includes("Operator shell changes are ready for review.") && result.reportsByOwner?.["HALO-UI"]?.includes("No report yet.");
    const valid = result.ownerCards === 3 && result.workingCopy === "agent working" && result.noPlanCards === 1 && result.stageLabels.join(",") === "asked,specced,allocated,building,built,checked" && result.missingTimeRow && ownReports && result.timelineOwnText && result.workerSingular && result.boardCountsMatchCards && result.unlistedItemsNamed && !result.ownerHolderDupes && !result.horizontalOverflow && errors.length === 0;
    console.log(JSON.stringify({ width, ...result, errors, valid }));
    await page.screenshot({ path: path.join(shots, `project-dashboard-${width}.png`), fullPage: true });
    await page.close();
    if (!valid) process.exitCode = 1;
  }
} finally {
  await browser?.close();
  await server.close();
}
