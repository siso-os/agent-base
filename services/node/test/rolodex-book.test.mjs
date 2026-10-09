// Rolodex v3 book: proposals, the inbox, placing, moves, gaps, want-to-know links. Synthetic people only.
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { change, keyOf, parseProfileLink, propose, view } from "../src/rolodex-book.ts";

const now = Date.parse("2026-10-07T00:00:00Z"), s = now / 1000;
const wa = [
  { jid: "441@s.whatsapp.net", phone: "+441", name: "Ava Stone", isGroup: false, lastTs: s - 86400, lastIn: s - 86400, lastOut: s - 90000, messages: 400, sent: 180 },
  { jid: "442@s.whatsapp.net", phone: "+442", name: "Mum", isGroup: false, lastTs: s, lastIn: s, lastOut: s, messages: 50, sent: 20 },
  { jid: "443@s.whatsapp.net", phone: "+443", name: "QuickFix Plumbing Ltd", isGroup: false, lastTs: s, lastIn: s, lastOut: 0, messages: 3, sent: 0 },
  { jid: "444@s.whatsapp.net", phone: "+444", name: "+44 4", isGroup: false, lastTs: s, lastIn: s, lastOut: 0, messages: 1, sent: 0 },
  { jid: "g@g.us", name: "Group", isGroup: true, lastTs: s, lastIn: s, lastOut: s, messages: 9, sent: 1 },
];
const opts = () => ({ file: path.join(mkdtempSync(path.join(tmpdir(), "rx-")), "book.json"), home: "/nonexistent", now });

test("proposals read the name and the counts, never a body", () => {
  assert.equal(propose("Mum", { messages: 1, sent: 0 }, now).level, "family");
  assert.equal(propose("Bright Dental Clinic", { messages: 2, sent: 0 }, now).level, "off");
  assert.equal(propose("Ava", { messages: 400, sent: 100, last: s - 86400 }, now).level, "friend");
  assert.equal(propose("Ava", { messages: 3, sent: 0, last: s }, now).level, "network");
});

test("inbox: DMs only, most-talked-to first, unnamed last", () => {
  const v = view(wa, true, opts());
  assert.equal(v.inbox.length, 4);
  assert.deepEqual(v.inbox.map((r) => r.name), ["Ava Stone", "Mum", "QuickFix Plumbing Ltd", "+444"]);
  assert.equal(v.whatsapp.chats, 4);
});

test("place, move, gaps, dismiss, touch", () => {
  const o = opts();
  const { id } = change({ op: "place", key: keyOf("441@s.whatsapp.net"), level: "friend", fields: { from: "Leeds" } }, wa, o);
  let v = view(wa, true, o);
  const ava = v.people.find((p) => p.id === id);
  assert.equal(ava.level, "friend"); assert.equal(ava.from, "Leeds"); assert.equal(ava.talk.messages, 400);
  assert.deepEqual(ava.gaps, ["birthday"]);
  assert.equal(v.inbox.length, 3);
  change({ op: "update", id, fields: { level: "partner", birthday: "1994-03-03" } }, wa, o);
  change({ op: "touch", id, note: "coffee" }, wa, o);
  change({ op: "dismiss", key: keyOf("443@s.whatsapp.net") }, wa, o);
  v = view(wa, true, o);
  const moved = v.people.find((p) => p.id === id);
  assert.deepEqual(moved.history.map((h) => h.to), ["friend", "partner"]);
  assert.equal(moved.touches[0].note, "coffee");
  assert.equal(v.inbox.length, 2); assert.equal(v.offCount, 1);
  assert.equal(statSync(o.file).mode & 0o777, 0o600);
  assert.ok(!readFileSync(o.file, "utf8").includes("body"));
});

test("want to know: a pasted link becomes a card; junk is refused", () => {
  assert.deepEqual(parseProfileLink("https://www.linkedin.com/in/jane-doe-1234/?trk=x"), { platform: "linkedin", handle: "jane-doe-1234", url: "https://www.linkedin.com/in/jane-doe-1234", guess: "Jane Doe" });
  assert.equal(parseProfileLink("twitter.com/someone").url, "https://x.com/someone");
  assert.equal(parseProfileLink("https://x.com/home"), null);
  assert.equal(parseProfileLink("https://instagram.com/p/abc"), null);
  const o = opts();
  const a = change({ op: "want", url: "https://instagram.com/some.one", why: "great designer" }, wa, o);
  const b = change({ op: "want", url: "instagram.com/some.one/" }, wa, o);
  assert.equal(a.id, b.id);
  const p = view(wa, true, o).people.find((x) => x.id === a.id);
  assert.equal(p.level, "want"); assert.equal(p.name, "@some.one"); assert.deepEqual(p.gaps, ["fullName"]);
  assert.throws(() => change({ op: "want", url: "https://example.com" }, wa, o), /LinkedIn/);
});
