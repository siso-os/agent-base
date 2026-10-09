// All byte boundaries of synthetic Unicode messages, including offset-backed older paging.
import assert from "node:assert/strict";
import { appendFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Transcript } from "../src/transcript.ts";

const scratch = mkdtempSync(path.join(tmpdir(), "ab-transcript-utf8-"));
const text = "Fresh 🌟 café 中文";
const record = (id, text) => Buffer.from(JSON.stringify({ type: "user", uuid: id, timestamp: "2026-10-02T20:00:00Z", message: { role: "user", content: text } }) + "\n");
const prefix = record("prefix", "Previous ✓");
const next = record("next", text);
try {
  for (let split = 1; split < next.length; split++) {
    const file = path.join(scratch, `${split}.jsonl`);
    writeFileSync(file, prefix);
    const t = new Transcript(file);
    appendFileSync(file, next.subarray(0, split));
    t.catchUp();
    assert.equal(t.log.length, 1, "incomplete record must wait");
    appendFileSync(file, next.subarray(split));
    t.catchUp();
    assert.equal(t.log[1].text, text, `Unicode at split ${split}`);
    assert.equal(t.log[1].o, prefix.length, `byte offset at split ${split}`);
    t.catchUp();
    assert.equal(t.log.length, 2, "catchUp must not duplicate messages");
    assert.equal(t.older(t.log[1].o).events[0].text, "Previous ✓");
  }
  // One byte at a time exercises repeated carry, not just two appends.
  const file = path.join(scratch, "bytewise.jsonl");
  writeFileSync(file, "");
  const t = new Transcript(file);
  for (const byte of next) { appendFileSync(file, Buffer.from([byte])); t.catchUp(); }
  assert.equal(t.log[0].text, text);
  // A truncate discards an incomplete old record before reading the replacement.
  appendFileSync(file, next.subarray(0, 8)); t.catchUp();
  writeFileSync(file, record("replacement", "New ✓")); t.catchUp();
  assert.deepEqual(t.log.map((e) => e.text), ["New ✓"]);
  console.log(`PASS: ${next.length - 1} split points, bytewise append, accurate offsets/paging and truncate carry reset`);
} finally { rmSync(scratch, { recursive: true, force: true }); }
