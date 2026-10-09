// The voice suites' browser: headless WebKit (what the app runs in) where it is installed; Chromium where it is not (a
// cloud box with only /opt/pw-browsers/chromium). AB_BROWSER=webkit|chromium forces one. Prints which it got.
import { existsSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const pw = existsSync("/tmp/ab-hub3-tools/node_modules/playwright") ? require("/tmp/ab-hub3-tools/node_modules/playwright") : await import("playwright");
const CHROMIUM = process.env.AB_CHROMIUM || "/opt/pw-browsers/chromium";

export async function launchBrowser() {
  const want = process.env.AB_BROWSER;
  if (want !== "chromium") {
    try {
      const b = await pw.webkit.launch({ headless: true });
      console.log(JSON.stringify({ browser: "webkit" }));
      return b;
    } catch (e) {
      if (want === "webkit") throw e;
    }
  }
  const b = await pw.chromium.launch({ headless: true, ...(existsSync(CHROMIUM) ? { executablePath: CHROMIUM } : {}) });
  console.log(JSON.stringify({ browser: "chromium" }));
  return b;
}
