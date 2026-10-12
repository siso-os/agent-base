import { forEachLine } from "../src/lines.ts";
import { writeFileSync, appendFileSync, unlinkSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import assert from "node:assert";

const testFile = join(tmpdir(), `big-session-${Date.now()}.jsonl`);

try {
  // Create a synthetic large session file (~600 MB)
  const lineSize = 1024 * 1024; // 1 MiB per line
  const numLines = 600;

  console.log(`Writing ${numLines} lines of ~${lineSize / 1024 / 1024} MiB each...`);
  const startWrite = Date.now();

  // Write the file incrementally to avoid holding the whole file in memory
  const padding = "x".repeat(lineSize - 50);
  // Write first line to create the file
  writeFileSync(testFile, `{"line":0,"data":"${padding}"}\n`);
  // Append the rest
  for (let i = 1; i < numLines; i++) {
    appendFileSync(testFile, `{"line":${i},"data":"${padding}"}\n`);
  }

  const writeTime = Date.now() - startWrite;

  // Read the file with forEachLine and count lines
  console.log(`Reading with forEachLine...`);
  const startRead = Date.now();
  let lineCount = 0;
  let lastLine = null;

  forEachLine(testFile, (line) => {
    lineCount++;
    lastLine = line;
  });

  const readTime = Date.now() - startRead;

  // Verify
  assert.strictEqual(lineCount, numLines, `Expected ${numLines} lines, got ${lineCount}`);
  assert(lastLine && lastLine.includes(`"line":${numLines - 1}`), "Last line does not match expected content");

  const fileSizeMB = Math.round((lineSize * numLines) / 1024 / 1024);
  console.log(`PASS big session: ${fileSizeMB} MB, ${lineCount} lines, ${readTime} ms`);

  // Clean up
  unlinkSync(testFile);
} catch (err) {
  console.error("FAIL:", err.message);
  if (existsSync(testFile)) {
    try { unlinkSync(testFile); } catch { /* */ }
  }
  process.exit(1);
}
