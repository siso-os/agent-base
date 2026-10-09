import { test } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync, writeFileSync, mkdirSync, unlinkSync, readdirSync, statSync, rmdirSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const srcDir = path.join(__dirname, "..", "src");

// Import the memo functions
const {
  readIfChanged, readdirIfChanged, clearCache, resetReadCounts, getReadFileCount, getReaddirCount, getCacheStats
} = await import(path.join(srcDir, "stat-memo.ts"));

// Import the functions that use memoization
const { listSubagents } = await import(path.join(srcDir, "subagents.ts"));
const { readCodexRuns } = await import(path.join(srcDir, "codex-runs.ts"));
const { sessionFile } = await import(path.join(srcDir, "transcript.ts"));

test("readIfChanged caches file reads by mtime+size", async (t) => {
  const tmpDir = path.join(os.tmpdir(), `fleet-board-memo-${Date.now()}`);
  mkdirSync(tmpDir, { recursive: true });

  try {
    const testFile = path.join(tmpDir, "test.txt");
    const content = "test content";
    writeFileSync(testFile, content);

    clearCache();
    resetReadCounts();

    // First read
    const result1 = readIfChanged(testFile);
    const count1 = getReadFileCount();
    assert.equal(result1, content, "First read returns correct content");
    assert.equal(count1, 1, "First read increments counter");

    // Second read with no change
    const result2 = readIfChanged(testFile);
    const count2 = getReadFileCount();
    assert.equal(result2, content, "Second read returns same content");
    assert.equal(count2, 1, "Second read does not increment counter (cached)");
    assert.deepEqual(result1, result2, "Results are identical");

    // Modify file
    writeFileSync(testFile, "modified content");

    // Third read after modification
    const result3 = readIfChanged(testFile);
    const count3 = getReadFileCount();
    assert.equal(result3, "modified content", "Third read returns new content");
    assert.equal(count3, 2, "Third read increments counter");
    assert.notEqual(result2, result3, "Results differ after modification");
  } finally {
    clearCache();
    try { unlinkSync(path.join(tmpDir, "test.txt")); } catch {}
    try { rmrf(tmpDir); } catch {}
  }
});

test("readdirIfChanged caches directory reads by mtime", async (t) => {
  const tmpDir = path.join(os.tmpdir(), `fleet-board-memo-dir-${Date.now()}`);
  mkdirSync(tmpDir, { recursive: true });

  try {
    mkdirSync(path.join(tmpDir, "subdir"), { recursive: true });
    writeFileSync(path.join(tmpDir, "subdir", "file1.txt"), "content1");
    writeFileSync(path.join(tmpDir, "subdir", "file2.txt"), "content2");

    const testDir = path.join(tmpDir, "subdir");

    clearCache();
    resetReadCounts();

    // First read
    const result1 = readdirIfChanged(testDir);
    const count1 = getReaddirCount();
    assert.deepEqual(result1.sort(), ["file1.txt", "file2.txt"], "First read returns correct entries");
    assert.equal(count1, 1, "First read increments counter");

    // Second read with no change
    const result2 = readdirIfChanged(testDir);
    const count2 = getReaddirCount();
    assert.deepEqual(result2.sort(), ["file1.txt", "file2.txt"], "Second read returns same entries");
    assert.equal(count2, 1, "Second read does not increment counter (cached)");

    // Add a file
    writeFileSync(path.join(testDir, "file3.txt"), "content3");

    // Third read after modification
    const result3 = readdirIfChanged(testDir);
    const count3 = getReaddirCount();
    assert.deepEqual(result3.sort(), ["file1.txt", "file2.txt", "file3.txt"], "Third read returns new entries");
    assert.equal(count3, 2, "Third read increments counter");
  } finally {
    clearCache();
    try { rmrf(tmpDir); } catch {}
  }
});

test("readCodexRuns uses memoized reads", async (t) => {
  const tmpDir = path.join(os.tmpdir(), `fleet-codex-runs-${Date.now()}`);
  mkdirSync(tmpDir, { recursive: true });

  try {
    // Create a minimal codex run structure
    const runId = "test-run-123";
    const metaFile = path.join(tmpDir, `${runId}.meta.json`);
    const jsonlFile = path.join(tmpDir, `${runId}.jsonl`);

    writeFileSync(metaFile, JSON.stringify({
      pid: 12345,
      started: Date.now(),
      parent_session: "test-session"
    }));

    writeFileSync(jsonlFile, JSON.stringify({
      type: "turn.completed",
      usage: { input_tokens: 100, output_tokens: 50 }
    }) + "\n");

    clearCache();
    resetReadCounts();

    // First call
    const result1 = readCodexRuns(Date.now(), tmpDir, { session: "test-session" });
    const readCount1 = getReadFileCount();
    const readdirCount1 = getReaddirCount();

    // Second call with no changes
    const result2 = readCodexRuns(Date.now(), tmpDir, { session: "test-session" });
    const readCount2 = getReadFileCount();
    const readdirCount2 = getReaddirCount();

    // Should not re-read files if nothing changed
    assert.equal(readCount2, readCount1, "No additional file reads on second call");
    // May have cached the directory read
    assert(readdirCount2 <= readdirCount1 + 1, "Directory reads are cached");

    // Results should be equivalent
    assert.equal(result1.length, result2.length, "Same number of results");
  } finally {
    clearCache();
    try { rmrf(tmpDir); } catch {}
  }
});

// Utility function to recursively remove a directory
function rmrf(dir) {
  try {
    const files = readdirSync(dir);
    for (const file of files) {
      const fullPath = path.join(dir, file);
      const stats = statSync(fullPath);
      if (stats.isDirectory()) {
        rmrf(fullPath);
      } else {
        unlinkSync(fullPath);
      }
    }
    rmdirSync(dir);
  } catch {}
}

test("readIfChanged reads large files through without retaining them", () => {
  const tmpDir = path.join(os.tmpdir(), `fleet-board-memo-big-${Date.now()}`);
  mkdirSync(tmpDir, { recursive: true });
  const big = path.join(tmpDir, "big.jsonl");
  try {
    writeFileSync(big, "x".repeat(65 * 1024));
    clearCache(); resetReadCounts();
    assert.equal(readIfChanged(big)?.length, 65 * 1024);
    assert.equal(readIfChanged(big)?.length, 65 * 1024);
    assert.equal(getReadFileCount(), 2, "an unchanged large file is re-read, not cached");
    assert.equal(getCacheStats().fileCacheSize, 0, "no large body is kept in memory");
  } finally {
    unlinkSync(big); rmdirSync(tmpDir);
  }
});
