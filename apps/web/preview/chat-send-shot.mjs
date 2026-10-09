// WebKit repro + check for t-0105 "clicking send isn't actually clicking send", on a fake socket (no live agent).
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { createServer } from "vite";

const require = createRequire(import.meta.url);
const { webkit } = require("/tmp/ab-hub3-tools/node_modules/playwright");
const vite = await createServer({ configFile: resolve("apps/web/vite.config.ts"), root: resolve("apps/web"), server: { host: "127.0.0.1", port: 5421, strictPort: true } });
let browser;
const out = [];
try {
  await vite.listen();
  browser = await webkit.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 980, height: 700 }, deviceScaleFactor: 1 });
  // An image upload that takes a while, as a big paste does.
  await page.route("**/api/uploads", (route) => setTimeout(() => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ name: "lab.png", path: "/Users/lab/.local/state/agent-base/uploads/lab.png" }) }), 900));
  await page.route("**/api/uploads/lab.png", (route) => route.fulfill({ status: 200, contentType: "image/png", body: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64") }));
  await page.goto("http://127.0.0.1:5421/preview/chat-send.html");
  const box = page.getByRole("textbox", { name: "Message" });
  const send = page.getByRole("button", { name: "Send" });
  await page.getByText("On it. Reading").waitFor();

  // 1. What a click on Send hits, with the face where it was (bottom 40 px, 48 px: 5 px right of Send, a near miss) and now (in the HUD row).
  const hit = () => page.evaluate(() => {
    const r = document.querySelector(".siso-chat__send").getBoundingClientRect();
    const el = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
    return el?.closest(".siso-chat__send") ? "send" : el?.closest(".siso-zero-face") ? "face" : el?.tagName ?? "nothing";
  });
  const rects = () => page.evaluate(() => [".siso-chat__send", ".siso-zero-face"].map((q) => { const r = document.querySelector(q).getBoundingClientRect(); return `${q} x${Math.round(r.x)}-${Math.round(r.right)} y${Math.round(r.y)}-${Math.round(r.bottom)}`; }).join(" | "));
  await box.fill("x");
  const after = await hit();
  const afterRects = await rects();
  await page.goto("http://127.0.0.1:5421/preview/chat-send.html?old");
  await page.getByText("On it. Reading").waitFor();
  await page.getByRole("textbox", { name: "Message" }).fill("x");
  const before = await hit();
  const beforeRects = await rects();
  await page.screenshot({ path: "apps/web/preview/chat-send-before.png" });
  await page.goto("http://127.0.0.1:5421/preview/chat-send.html");
  await page.getByText("On it. Reading").waitFor();
  out.push(`old layout ${beforeRects}`, `new layout ${afterRects}`);
  out.push(`click on Send hits: before=${before}, after=${after}`);
  assert.equal(after, "send");
  for (const width of [760, 1100, 1440]) {
    await page.setViewportSize({ width, height: 700 });
    assert.equal(await hit(), "send", `Send is clickable at ${width}px`);
  }
  await page.setViewportSize({ width: 980, height: 700 });

  // 2. Click Send while the agent works: a row shows at once, says sent, and goes when the chat shows his message.
  await box.fill("Make the tasks page nicer");
  const t0 = Date.now();
  await send.click();
  await page.locator('[data-testid="pending-row"]', { hasText: "Make the tasks page nicer" }).waitFor({ timeout: 1000 });
  const shownMs = Date.now() - t0;
  assert.equal(await box.inputValue(), "");
  await page.locator('[data-testid="pending-row"].is-sent').waitFor({ timeout: 2000 });
  await page.screenshot({ path: "apps/web/preview/chat-send-pending.png" });
  await page.locator('[data-testid="pending-row"]').waitFor({ state: "detached", timeout: 4000 });
  await page.locator(".siso-chat__turn", { hasText: "Make the tasks page nicer" }).waitFor();
  out.push(`button: row shown in ${shownMs} ms (incl. click), sent ack, then replaced by his turn`);

  // 3. Enter does the same.
  await box.fill("Second one by Enter");
  await box.press("Enter");
  await page.locator('[data-testid="pending-row"]', { hasText: "Second one by Enter" }).waitFor({ timeout: 1000 });
  await page.locator('[data-testid="pending-row"]').waitFor({ state: "detached", timeout: 4000 });
  out.push("enter: same path");

  // 4. A failed send says so, with Retry and take-back.
  await box.fill("FAIL this one");
  await send.click();
  await page.locator('[data-testid="pending-row"].is-failed').waitFor({ timeout: 2000 });
  await page.getByRole("button", { name: "Take back" }).click();
  assert.equal(await box.inputValue(), "FAIL this one");
  await box.fill("");
  out.push("failed: shown as Not sent, take back restores the text");

  // 5. Send while an image is still uploading: it waits for the image, then sends both.
  await page.locator('input[type="file"]').setInputFiles({ name: "lab.png", mimeType: "image/png", buffer: Buffer.from("x") });
  await box.fill("With a picture");
  await send.click();
  await page.getByText("Sends as soon as the image is added").waitFor({ timeout: 500 });
  await page.locator('[data-testid="pending-row"]', { hasText: "With a picture" }).waitFor({ timeout: 3000 });
  const withImage = await page.evaluate(() => window.__sent.filter((m) => m.t === "prompt").at(-1));
  assert.deepEqual(withImage.images, ["/Users/lab/.local/state/agent-base/uploads/lab.png"]);
  out.push("upload in progress: waited, then sent text + image");

  // 6. Disconnected: Send says why and keeps the draft.
  await page.goto("http://127.0.0.1:5421/preview/chat-send.html?down");
  await page.getByRole("textbox", { name: "Message" }).fill("Nobody home");
  await page.getByRole("button", { name: "Send" }).click();
  await page.getByText("Not connected to the agent yet").waitFor({ timeout: 500 });
  assert.equal(await page.getByRole("textbox", { name: "Message" }).inputValue(), "Nobody home");
  await page.screenshot({ path: "apps/web/preview/chat-send-offline.png" });
  out.push("offline: hint shown, draft kept");
  console.log(`chat-send-shot:\n  ${out.join("\n  ")}`);
} finally {
  await browser?.close();
  await vite.close();
}
process.exit(0);
