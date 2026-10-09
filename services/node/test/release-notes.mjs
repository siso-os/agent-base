// Release notes (Release 2): readNotes skips bad lines; noteFor finds the note a release (prev..sha] holds. Scratch git repo only.
// Run: node --experimental-strip-types services/node/test/release-notes.mjs
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
const { noteFor, readNotes } = await import("../src/releases.ts");
const repo = mkdtempSync(path.join(tmpdir(), ".ab-notes-"));
const g = (...a) => execFileSync("git", a, { cwd: repo, encoding: "utf8" }).trim();
g("init", "-q"); g("config", "user.email", "t@t"); g("config", "user.name", "t");
const c = (m) => { g("commit", "-q", "--allow-empty", "-m", m); return g("rev-parse", "HEAD"); };
const a = c("one"), b = c("two"), d = c("three");
writeFileSync(path.join(repo, "n.jsonl"), [JSON.stringify({ sha: b, title: "Release B" }), "not json", JSON.stringify({ sha: "zz", title: "bad" })].join("\n"));
const notes = readNotes(path.join(repo, "n.jsonl"));
assert.equal(notes.length, 1);
assert.equal(noteFor(repo, notes, a, d)?.title, "Release B");
assert.equal(noteFor(repo, notes, b, d), undefined);
assert.equal(noteFor(repo, notes, null, a), undefined);
console.log("notes ok");
