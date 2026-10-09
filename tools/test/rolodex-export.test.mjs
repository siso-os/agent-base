// tools/rolodex-pull --from + tools/rolodex-export.py against a fixture siso-contact snapshot (the five tables). No VPS, no ssh.
//   node --test tools/test/rolodex-export.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const TOOLS = path.join(import.meta.dirname, "..");

function fixture(dir) {
  const db = path.join(dir, "snapshot.sqlite");
  execFileSync("python3", ["-c", `
import sqlite3, sys
db = sqlite3.connect(sys.argv[1])
db.executescript('''
CREATE TABLE chats (id TEXT PRIMARY KEY, name TEXT, is_group INTEGER, last_message_at INTEGER);
CREATE TABLE contact_labels (id TEXT, label TEXT);
CREATE TABLE messages (id TEXT, chat_id TEXT, timestamp INTEGER, from_me INTEGER, body TEXT);
CREATE TABLE meta (key TEXT, value TEXT);
CREATE TABLE harvest_progress (chat_id TEXT, done INTEGER);
INSERT INTO chats VALUES ('100000000001@c.us', 'Avery Demo', 0, 1757600000);
INSERT INTO chats VALUES ('100000000002@c.us', '100000000002', 0, 1757500000);
INSERT INTO chats VALUES ('100000000003@c.us', '100000000003', 0, 1757400000);
INSERT INTO chats VALUES ('grp@g.us', 'Family Group', 1, 1757650000);
INSERT INTO contact_labels VALUES ('100000000001@c.us', 'Studio');
INSERT INTO contact_labels VALUES ('100000000002', 'Casey Sample');
INSERT INTO messages VALUES ('m1', '100000000001@c.us', 1757600000, 1, 'SECRET BODY one');
INSERT INTO messages VALUES ('m2', '100000000001@c.us', 1757590000, 0, 'SECRET BODY two');
INSERT INTO messages VALUES ('m3', '100000000002@c.us', 1757500000, 0, 'SECRET BODY three');
INSERT INTO messages VALUES ('m4', 'grp@g.us', 1757650000, 0, 'SECRET BODY group');
INSERT INTO meta VALUES ('harvested_at', '2026-09-12 00:23:25');
INSERT INTO meta VALUES ('phone', '100000000000');
''')
db.commit()
`, db]);
  return db;
}

test("rolodex-pull --from writes a 0600 cache: DMs only, labels joined both ways, no bodies", () => {
  const dir = mkdtempSync(path.join(tmpdir(), ".siso-ephemeral-rolodex-pull-"));
  try {
    const db = fixture(dir);
    const out = path.join(dir, "state/rolodex/whatsapp.json");
    const r = spawnSync(path.join(TOOLS, "rolodex-pull"), ["--from", db], { env: { ...process.env, AB_ROLODEX_WA: out }, encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(statSync(out).mode & 0o777, 0o600);
    const raw = readFileSync(out, "utf8");
    const data = JSON.parse(raw);
    assert.deepEqual(Object.keys(data).sort(), ["contacts", "harvestedAt", "pulledAt", "source"]);
    assert.equal(data.harvestedAt, "2026-09-12 00:23:25");
    assert.match(data.source, /^local:/);
    assert.ok(!Number.isNaN(Date.parse(data.pulledAt)));
    assert.equal(data.contacts.length, 3, "DMs only (the group is dropped)");
    assert.ok(data.contacts.every((c) => !c.chatId.endsWith("@g.us")));
    const by = Object.fromEntries(data.contacts.map((c) => [c.chatId, c]));
    assert.deepEqual(by["100000000001@c.us"], { chatId: "100000000001@c.us", displayName: "Avery Demo", labels: ["Studio"], lastContacted: 1757600000, messageCount: 2 });
    assert.deepEqual(by["100000000002@c.us"].labels, ["Casey Sample"], "labels joined by the id's part before @");
    assert.equal(by["100000000002@c.us"].displayName, "Casey Sample", "a bare number resolves through its label");
    assert.equal(by["100000000003@c.us"].displayName, "100000000003", "an unlabelled number stays a number (the app hides it)");
    assert.equal(by["100000000003@c.us"].messageCount, 0);
    const keys = new Set();
    const walk = (v) => { if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) { keys.add(k); walk(x); } };
    walk(data);
    assert.ok(!keys.has("body"), "no key named body anywhere");
    assert.ok(!raw.includes("SECRET BODY"), "no message text anywhere");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("rolodex-pull refuses a missing snapshot and bad usage without touching the cache", () => {
  const dir = mkdtempSync(path.join(tmpdir(), ".siso-ephemeral-rolodex-pull-"));
  try {
    const out = path.join(dir, "whatsapp.json");
    const env = { ...process.env, AB_ROLODEX_WA: out };
    assert.equal(spawnSync(path.join(TOOLS, "rolodex-pull"), ["--from", path.join(dir, "nope.sqlite")], { env }).status, 1);
    assert.equal(spawnSync(path.join(TOOLS, "rolodex-pull"), ["--bogus"], { env }).status, 2);
    assert.throws(() => statSync(out));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
