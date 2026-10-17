// Communications (Shaan, 10 Oct: "Merge Rolodex and WhatsApp. Move Rolodex into WhatsApp ... I like the WhatsApp UI quite a
// lot"): one rail icon; inside, a Chats | People switch tops the side nav. A chat shows its person's level and opens
// their page; a person's page opens their chat; an unsorted chat goes onto a level from its header. Sealed vite + fixture API
// in headless webkit; every name and number is invented (phones in the 07700 900xxx drama range); never the live node.
//   heavy -- node --experimental-strip-types --no-warnings services/node/test/comms-ui.mjs
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "../../..");
const { webkit } = createRequire(path.join(root, "services/node/package.json"))("playwright");
const { createServer } = createRequire(path.join(root, "apps/web/package.json"))("vite");
const { fixtureResponse } = await import(path.join(root, "tools/ab-qa-fixtures.mjs"));
const out = "/tmp/comms-ui";
mkdirSync(out, { recursive: true });
const fail = (m) => { console.error(`FAIL: ${m}`); process.exit(1); };
const keyOf = (jid) => "wa:" + createHash("sha1").update(jid).digest("hex").slice(0, 12);

const NOW = Date.now(), sec = Math.floor(NOW / 1000), iso = (ms) => new Date(ms).toISOString(), DAY = 86_400_000;
const J = { mara: "447700900001@s.whatsapp.net", juno: "447700900002@s.whatsapp.net", crew: "120363000000000001@g.us", bram: "447700900003@s.whatsapp.net" };
const chats = [
  { jid: J.mara, name: "Mara Quillfeather", isGroup: false, lastTs: sec - 600, unread: 2, preview: "Synthetic proposal draft attached." },
  { jid: J.juno, name: "Juno Ashgrove", isGroup: false, lastTs: sec - 3600, unread: 0, preview: "See you at the fixture meetup" },
  { jid: J.crew, name: "Fixture Launch Crew", isGroup: true, lastTs: sec - 7200, unread: 0, preview: "Launch moved to Thursday" },
  { jid: J.bram, name: "Bram Copperfield", isGroup: false, lastTs: sec - 2 * 86400, unread: 0, preview: "Thanks!" },
];
const counts = { chats: 4, groups: 1, messages: 40, unreadChats: 1 };
const msgs = (jid) => [{ chat: jid, id: `${jid}-1`, fromMe: false, ts: sec - 900, kind: "text", text: "Synthetic message one" }, { chat: jid, id: `${jid}-2`, fromMe: true, ts: sec - 600, kind: "text", text: "Synthetic reply" }];
const person = (id, name, level, extra = {}) => ({ id, name, level, added: iso(NOW - 90 * DAY), updated: iso(NOW - DAY), keys: [], gaps: [], ...extra });
const book = {
  people: [
    person("p-mara", "Mara Quillfeather", "client", { fullName: "Mara Elspeth Quillfeather", company: "Synthetic Studio", from: "Port Example", keys: [keyOf(J.mara)], phone: "447700900001", talk: { messages: 412, sent: 190, last: sec - 600 }, nextStep: "send the proposal", nextStepAt: iso(NOW + 2 * DAY).slice(0, 10) }),
    person("p-bram", "Bram Copperfield", "friend", { keys: [keyOf(J.bram)], talk: { messages: 30, sent: 12, last: sec - 90 * 86400 }, from: "Sampleford" }),
    person("p-wren", "Wren Larkspur", "partner", { company: "Example Works", talk: { messages: 5, sent: 2, last: sec - 3 * 86400 } }),
    person("p-orla", "Orla Fernhollow", "family", { birthday: "1990-" + iso(NOW + 5 * DAY).slice(5, 10) }),
    person("p-kit", "Kit Mosswood", "want", { why: "their synthetic launch looked sharp" }),
  ],
  inbox: [{ key: keyOf(J.juno), name: "Juno Ashgrove", named: true, phone: "447700900002", talk: { messages: 120, sent: 60, last: sec - 3600 }, proposal: { level: "friend", confidence: "medium", reason: "120 messages both ways" } }],
  offCount: 0, whatsapp: { state: "live", chats: 4, named: 4 },
};
const posts = [];
const apply = (op) => {
  posts.push(op);
  if (op.op !== "place") return { status: 400, json: { error: "unexpected op" } };
  const i = book.inbox.findIndex((r) => r.key === op.key);
  if (i < 0) return { status: 404, json: { error: "That chat is already sorted" } };
  const [row] = book.inbox.splice(i, 1);
  book.people.push(person(`p-${op.key}`, row.name, op.level, { keys: [op.key], talk: row.talk, history: [{ at: iso(NOW), from: "inbox", to: op.level }] }));
  return { json: { ok: true, id: `p-${op.key}` } };
};

const server = await createServer({ root: path.join(root, "apps/web"), configFile: path.join(root, "apps/web/vite.config.ts"), logLevel: "error",
  plugins: [{ name: "sealed-api", configureServer(v) { v.middlewares.use((q, s, next) => { if (/^\/(api|chat|term)\b/.test(q.url ?? "")) { s.statusCode = 410; s.end("Fixture only"); return; } next(); }); } }],
  server: { host: "127.0.0.1", port: 0, strictPort: false, hmr: false, watch: { ignored: ["**/*"] } } });
await server.listen();
const base = `http://127.0.0.1:${server.httpServer.address().port}`;
const browser = await webkit.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e).slice(0, 200)));
  // An old saved space ("rolodex") must land on Communications, People.
  await page.addInitScript(() => { window.EventSource = undefined; localStorage.setItem("agent-base:space", '"rolodex"'); localStorage.setItem("agent-base:sidebar-open", "true"); });
  await page.route("**/*", (r) => (new URL(r.request().url()).origin === base ? r.fallback() : r.abort()));
  await page.route(`${base}/api/**`, (r) => {
    const u = new URL(r.request().url()), p = u.pathname, method = r.request().method();
    if (p === "/api/rolodex/book") { if (method === "POST") { const a = apply(r.request().postDataJSON()); return r.fulfill({ status: a.status ?? 200, json: a.json }); } return r.fulfill({ json: structuredClone(book) }); }
    if (p === "/api/whatsapp/chats") return r.fulfill({ json: { chats, counts } });
    const m = p.match(/^\/api\/whatsapp\/chats\/([^/]+)\/messages$/);
    if (m) { const jid = decodeURIComponent(m[1]); return r.fulfill({ json: { chat: chats.find((c) => c.jid === jid), messages: msgs(jid) } }); }
    if (/^\/api\/whatsapp\/chats\/[^/]+\/read$/.test(p)) return r.fulfill({ json: { ok: true } });
    if (p === "/api/whatsapp/search") return r.fulfill({ json: { chats: [], messages: [] } });
    const body = fixtureResponse(p, "fixture");
    return body === undefined ? r.fulfill({ status: 404, json: {} }) : r.fulfill({ json: body });
  });
  await page.routeWebSocket("**/*", (ws) => ws.close());
  await page.goto(base);

  // 1. One rail icon, the old Rolodex link lands on People.
  const comms = page.locator(".wa-comms");
  await comms.waitFor({ timeout: 20000 }).catch(async () => { await page.screenshot({ path: path.join(out, "fail.png") }); fail(`no Communications space for the old "rolodex" space (${errors.join(" | ")}; space=${await page.evaluate(() => localStorage.getItem("agent-base:space"))}; ${(await page.locator("body").innerText()).slice(0, 300).replace(/\s+/g, " ")})`); });
  if ((await comms.getAttribute("data-tab")) !== "people") fail(`the old Rolodex link opened "${await comms.getAttribute("data-tab")}", not People`);
  const rail = page.locator(".siso-app__rail");
  const railText = (await rail.innerText().catch(() => "")) + " " + (await rail.locator("[aria-label]").evaluateAll((els) => els.map((e) => e.getAttribute("aria-label")).join(" ")));
  if (/Rolodex/i.test(railText)) fail("the rail still has a Rolodex icon");
  if (!/Communications/i.test(railText)) fail("the rail has no Communications icon");
  const people = page.locator(".wa-people");
  await people.locator('[data-person="p-mara"]').waitFor({ timeout: 10000 }).catch(() => fail("People shows no rows"));
  const listText = (await people.locator(".wa-side").innerText()).toLowerCase();   // section heads are small caps in CSS
  for (const want of ["To do", "Sort WhatsApp chats", "Clients", "Partners", "Friends", "Family"]) if (!listText.includes(want.toLowerCase())) fail(`People's list has no "${want}"`);
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(out, "people-home.png") });
  console.log("PASS one icon: the rail shows Communications and no Rolodex; an old Rolodex link opens People, in the chats' list look (To do, Clients, Partners, Friends, Family)");

  // 2. Search, open a person, their page opens their chat.
  await people.getByRole("searchbox").fill("quill");
  await people.locator('[data-rolodex-results][data-query="quill"]').waitFor({ timeout: 5000 }).catch(() => fail("search did not run"));
  await people.getByRole("searchbox").press("Enter");
  const pagePerson = people.locator(".rolodex-person");
  await pagePerson.waitFor({ timeout: 5000 }).catch(() => fail("Enter on a search did not open the person"));
  await page.screenshot({ path: path.join(out, "person.png") });
  await pagePerson.getByRole("button", { name: /Open chat/ }).click();
  await page.locator('.wa-comms[data-tab="chats"] .wa-chat-head h2', { hasText: "Mara Quillfeather" }).waitFor({ timeout: 8000 }).catch(() => fail("Open chat did not open Mara's chat in Chats"));
  const chip = page.locator(".wa-person-chip");
  if (!/Client/.test(await chip.innerText().catch(() => ""))) fail("Mara's chat header has no Client chip");
  if (!(await page.locator(".wa-comms-pane:not([hidden]) .wa-row", { hasText: "Mara Quillfeather" }).locator(".wa-lvl", { hasText: "Client" }).count())) fail("Mara's row in the chat list has no Client tag");
  await page.screenshot({ path: path.join(out, "chat-with-person.png") });
  console.log("PASS both ways: search \"quill\" + Enter opens Mara's page; Open chat jumps to her WhatsApp chat, which shows a Client chip and a Client tag on her row");

  // 3. An unsorted chat goes on a level from its header; the chip then opens their page.
  await page.locator(".wa-comms-pane:not([hidden]) .wa-row", { hasText: "Juno Ashgrove" }).click();
  const place = page.locator(".wa-place select");
  await place.waitFor({ timeout: 5000 }).catch(() => fail("Juno's unsorted chat has no Add to People"));
  await place.selectOption("friend");
  await page.locator(".wa-person-chip", { hasText: "Friend" }).waitFor({ timeout: 8000 }).catch(() => fail("after Add to People → Friend there is no Friend chip"));
  const placed = posts.find((op) => op.op === "place");
  if (!placed || placed.key !== keyOf(J.juno) || placed.level !== "friend") fail(`the place op was ${JSON.stringify(placed)}`);
  await page.locator(".wa-person-chip").click();
  await page.locator('.wa-comms[data-tab="people"] .rolodex-person[aria-label="Juno Ashgrove\'s page"]').waitFor({ timeout: 8000 }).catch(() => fail("the Friend chip did not open Juno's page in People"));
  if (await page.locator('.wa-switch-btn[data-tab="people"] b').count()) fail("People's to-sort badge still shows after the last chat was placed");
  console.log("PASS place from chat: Juno's chat → Add to People → Friend sent one place op with her hashed key; the chip opened her page in People");
  if (errors.length) fail(`page errors: ${errors.join(" | ")}`);
  console.log(JSON.stringify({ shots: ["people-home.png", "person.png", "chat-with-person.png"].map((f) => path.join(out, f)) }));
} finally { await browser.close(); await server.close(); }
