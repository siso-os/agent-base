#!/usr/bin/env node
/**
 * Playwright headless webkit probe to test if a new build boots successfully.
 * Opens the URL, waits for window.__sisoBooted to be set, captures any crashes
 * and page errors, then reports the result.
 *
 * Usage: node ab-boot-probe.mjs <url> <seconds>
 * Exits: 0 if booted, 5 if not, 3 if browser could not launch
 */

import { createRequire } from "module";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(path.join(__dirname, "../services/node/package.json"));

const { webkit } = require("playwright");

const url = process.argv[2];
const timeoutSeconds = parseInt(process.argv[3], 10) || 60;
// The node takes reports only from the app's own origin (the front, 5401): the probe loads the slot directly and says it comes from there.
const publicOrigin = process.argv[4];

if (!url || isNaN(timeoutSeconds)) {
  console.error("Usage: ab-boot-probe.mjs <url> <seconds>");
  process.exit(1);
}

const VIEWPORT = { width: 1440, height: 900 };
const timeoutMs = timeoutSeconds * 1000;

async function main() {
  let browser;
  try {
    // Use webkit headless
    browser = await webkit.launch({
      headless: true,
    });
    const context = await browser.newContext({
      viewport: VIEWPORT,
    });
    const page = await context.newPage();

    // Block WebSockets: close them immediately
    await page.routeWebSocket("**/*", (ws) => ws.close());

    // Disable EventSource
    await page.addInitScript(() => {
      window.EventSource = undefined;
    });

    // Abort all requests except what we allow
    // Only reads go out, plus the two reports; nothing that could touch an agent (no /term, no /chat, no writes).
    await page.route("**/*", (route) => {
      const request = route.request();
      const { pathname } = new URL(request.url());
      if (pathname.startsWith("/term") || pathname.startsWith("/chat")) return route.abort();
      if (request.method() === "GET") return route.continue();
      if (request.method() === "POST" && (pathname === "/api/booted" || pathname === "/api/booted/crash"))
        return route.continue(publicOrigin ? { headers: { ...request.headers(), origin: publicOrigin } } : undefined);
      return route.abort();
    });

    const pageErrors = [];
    page.on("pageerror", (error) => {
      pageErrors.push(error.toString());
    });

    const startTime = Date.now();

    // Load the page - use domcontentloaded since we're blocking WebSockets/EventSource
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: timeoutMs });

    // Wait for __sisoBooted to be set or timeout
    let booted = false;
    let sha = null;
    const deadline = startTime + timeoutMs;

    while (Date.now() < deadline && !booted) {
      const bootedValue = await page.evaluate(() => window.__sisoBooted);
      if (bootedValue) {
        booted = true;
        sha = bootedValue.sha;
      } else {
        // Wait a bit before checking again
        await new Promise((r) => setTimeout(r, 100));
      }
    }

    // Stay 3 more seconds collecting crashes and page errors
    await new Promise((r) => setTimeout(r, 3000));

    const crashes = await page.evaluate(() => window.__sisoCrashes ?? []);
    const ms = Date.now() - startTime;

    // Output result as JSON
    const result = {
      booted,
      sha: sha || null,
      ms,
      crashes,
      pageErrors,
    };
    console.log(JSON.stringify(result));

    await context.close();
    await browser.close();

    process.exit(booted ? 0 : 5);
  } catch (error) {
    console.log(
      JSON.stringify({
        booted: false,
        sha: null,
        ms: 0,
        crashes: [],
        pageErrors: [error.toString()],
      })
    );
    if (browser) await browser.close();
    process.exit(3);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(3);
});
