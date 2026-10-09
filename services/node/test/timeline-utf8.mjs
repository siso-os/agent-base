// Incremental timeline decoding must preserve UTF-8 between separate polls.
import assert from "node:assert/strict";
import { appendFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { timelineOf } from "../src/timeline.ts";

const root = mkdtempSync(path.join(tmpdir(), "ab-timeline-utf8-"));
const text = "Fresh 🌟 café 中文";
const record = (value) => Buffer.from(JSON.stringify({ type: "user", timestamp: "2026-10-02T20:00:00Z", message: { content: value } }) + "\n");
const next = record(text);
const since = "2026-10-02T00:00:00Z";
try {
  for (let split = 1; split < next.length; split++) {
    const file = path.join(root, `${split}.jsonl`);
    writeFileSync(file, next.subarray(0, split));
    assert.deepEqual((await timelineOf(file, since)), []);
    appendFileSync(file, next.subarray(split));
    assert.equal((await timelineOf(file, since))[0].text, text, `split ${split}`);
    assert.equal((await timelineOf(file, since)).length, 1);
  }
  const file = path.join(root, "truncate.jsonl");
  const split = next.indexOf(Buffer.from("🌟")) + 2;
  writeFileSync(file, Buffer.concat([record("padding ".repeat(50)), next.subarray(0, split)]));
  assert.equal((await timelineOf(file, since)).length, 1);
  writeFileSync(file, record("New ✓"));
  assert.deepEqual((await timelineOf(file, since)).map((e) => e.text), ["New ✓"]);
  console.log(`PASS: timeline UTF-8 at ${next.length - 1} split points and decoder reset on truncation`);
} finally { rmSync(root, { recursive: true, force: true }); }
