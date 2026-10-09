// Exercise the actual private host image parser without starting the host or SDK.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { stripTypeScriptTypes } from "node:module";
import { uploadPath } from "../src/uploads.ts";
const scratch = mkdtempSync(path.join(tmpdir(), "ab-upload-paths-"));
const uploads = path.join(scratch, "uploads");
mkdirSync(uploads);
const valid = path.join(uploads, "valid.png"), outside = path.join(scratch, "outside.png");
writeFileSync(valid, "VALID-SYNTHETIC"); writeFileSync(outside, "OUTSIDE-SYNTHETIC");
const traversal = `${uploads}/../outside.png`, escape = path.join(uploads, "escape.png");
symlinkSync(outside, escape);
try {
  assert.equal(uploadPath(uploads, valid), valid);
  assert.equal(uploadPath(uploads, traversal), null);
  assert.equal(uploadPath(uploads, escape), null);
  assert.equal(uploadPath(uploads, outside), null);
  assert.equal(uploadPath(uploads, uploads), null);
  assert.equal(uploadPath(uploads, "valid.png"), null);
  assert.equal(uploadPath(uploads, {}), null);
  const source = readFileSync(new URL("../src/host.ts", import.meta.url), "utf8");
  const start = source.indexOf("function imageBlocks(");
  const end = source.indexOf("\nfunction prompt(", start);
  const actual = stripTypeScriptTypes(source.slice(start, end));
  const imageBlocks = new Function("UPLOADS", "MEDIA", "readFileSync", "uploadPath", "path", `${actual}\nreturn imageBlocks;`)(uploads, { png: "image/png" }, readFileSync, uploadPath, path);
  const rejected = imageBlocks([traversal, escape, outside]);
  assert.equal(rejected.blocks.length, 0, "host must not encode outside-upload bytes");
  assert.deepEqual(rejected.ok, []);
  const accepted = imageBlocks([valid]);
  assert.equal(accepted.blocks.length, 1);
  assert.equal(Buffer.from(accepted.blocks[0].source.data, "base64").toString(), "VALID-SYNTHETIC");
  assert.deepEqual(accepted.ok, [valid]);
  console.log("PASS: canonical upload containment and actual host image parser reject traversal/symlink escapes");
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
