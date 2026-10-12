import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { forEachLine } from "../lines";
import { forkPoint } from "../context-mix";
import { writeFileSync, unlinkSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("forEachLine streaming", () => {
  let testDir: string;

  beforeAll(() => {
    testDir = join(tmpdir(), `test-lines-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
  });

  afterAll(() => {
    // Clean up test files
    const files = ["small.txt", "utf8.txt", "no-newline.txt", "empty-lines.txt"];
    files.forEach(f => {
      const path = join(testDir, f);
      if (existsSync(path)) {
        try { unlinkSync(path); } catch { /* */ }
      }
    });
  });

  it("splits lines across small chunk boundaries", () => {
    const testFile = join(testDir, "small.txt");
    const lines = ["line1", "line2 with more", "line3"];
    writeFileSync(testFile, lines.join("\n"));

    const collected: { line: string; index: number }[] = [];
    forEachLine(testFile, (line, index) => collected.push({ line, index }), 7);

    expect(collected.map(x => x.line)).toEqual(lines);
    expect(collected.map(x => x.index)).toEqual([0, 1, 2]);
  });

  it("handles UTF-8 characters straddling chunk boundaries", () => {
    const testFile = join(testDir, "utf8.txt");
    // Create lines where multi-byte UTF-8 characters might straddle boundaries
    const lines = ["hello", "café☕", "world✓", "日本語"];
    writeFileSync(testFile, lines.join("\n"), "utf8");

    const collected: string[] = [];
    forEachLine(testFile, (line) => collected.push(line), 7);

    expect(collected).toEqual(lines);
  });

  it("handles final line without trailing newline", () => {
    const testFile = join(testDir, "no-newline.txt");
    const content = "line1\nline2";
    writeFileSync(testFile, content);

    const collected: string[] = [];
    forEachLine(testFile, (line) => collected.push(line));

    expect(collected).toEqual(["line1", "line2"]);
  });

  it("preserves empty lines and their indices", () => {
    const testFile = join(testDir, "empty-lines.txt");
    const content = "line1\n\nline3\n";
    writeFileSync(testFile, content);

    const collected: { line: string; index: number }[] = [];
    forEachLine(testFile, (line, index) => collected.push({ line, index }));

    expect(collected.map(x => x.line)).toEqual(["line1", "", "line3"]);
    expect(collected.map(x => x.index)).toEqual([0, 1, 2]);
  });
});

describe("forkPoint streaming equivalence", () => {
  let testFile: string;

  beforeAll(() => {
    testFile = join(tmpdir(), `forkpoint-test-${Date.now()}.jsonl`);

    // Create a synthetic JSONL session file with user prompts and other messages
    const lines = [
      '{"uuid":"msg1","type":"assistant","message":"hello"}',
      '{"uuid":"uuid1","type":"user","message":{"content":"first prompt"},"timestamp":"2026-10-01T10:00:00Z"}',
      '{"uuid":"msg2","type":"assistant","message":"response1"}',
      '{"uuid":"uuid2","type":"user","message":{"content":"second prompt"},"timestamp":"2026-10-01T10:01:00Z"}',
      '{"uuid":"msg3","type":"assistant","message":"response2"}',
      '{"uuid":"uuid3","type":"user","message":{"content":"third prompt"},"timestamp":"2026-10-01T10:02:00Z"}',
      '{"uuid":"msg4","type":"assistant","message":"response3"}',
    ];
    writeFileSync(testFile, lines.join("\n"));
  });

  afterAll(() => {
    if (existsSync(testFile)) {
      try { unlinkSync(testFile); } catch { /* */ }
    }
  });

  it("returns null when back is out of range", () => {
    expect(forkPoint(testFile, 10)).toEqual(null);
    expect(forkPoint(testFile, -1)).toEqual(null);
  });

  it("returns { upTo: null } for the last prompt", () => {
    // back = 0 means the latest prompt (uuid3), which is the last prompt, so upTo should be null
    const result = forkPoint(testFile, 0);
    expect(result).toEqual({ upTo: null });
  });

  it("returns the uuid before the next prompt for back > 0", () => {
    // back = 1 means one prompt back (uuid2), next prompt is uuid3 at line 5
    // The last uuid before line 5 should be msg3 (line 4)
    const result = forkPoint(testFile, 1);
    expect(result).toEqual({ upTo: "msg3" });
  });

  it("returns the uuid for back = 2", () => {
    // back = 2 means two prompts back (uuid1), next prompt is uuid2 at line 3
    // The last uuid before line 3 should be msg2 (line 2)
    const result = forkPoint(testFile, 2);
    expect(result).toEqual({ upTo: "msg2" });
  });
});
