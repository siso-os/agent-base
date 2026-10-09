#!/usr/bin/env node
// Adapt upstream pqoqubbw/icons source into this package using HALO's established port transform.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const [source, ...names] = process.argv.slice(2);
if (!source || !names.length) {
  console.error("usage: node scripts/port.mjs <pqoqubbw-icons icons dir> <name> [name...]");
  process.exit(2);
}

const bank = resolve(dirname(fileURLToPath(import.meta.url)), "../src/pq");
mkdirSync(bank, { recursive: true });
const missing = [...new Set(names)].filter((name) => !existsSync(join(source, `${name}.tsx`)));
if (missing.length) {
  console.error(`upstream icons missing: ${missing.join(", ")}`);
  process.exit(1);
}
let commit = "unknown commit";
try { commit = execFileSync("git", ["-C", source, "rev-parse", "--short", "HEAD"], { encoding: "utf8" }).trim(); } catch { /* source is not a checkout */ }

export function adapt(text) {
  let out = text
    .replace(/^"use client";\s*\n+/, "")
    .replace(/(["'])motion\/react\1/g, "'framer-motion'")
    .replace(/from (["'])@\/lib\/utils\1/g, "from '../cn'")
    .replace(/strokeWidth="[^"]+"/g, "strokeWidth={strokeWidth}")
    .replace(/strokeWidth=\{2\}/g, "strokeWidth={strokeWidth}")
    .replace(/strokeWidth:\s*\[2,\s*2\.25,\s*2\]/g, "strokeWidth: [strokeWidth, strokeWidth * 1.125, strokeWidth]")
    .replace(/strokeWidth:\s*2(?=\s*[,}])/g, "strokeWidth: strokeWidth");
  if (!/strokeWidth\?: number/.test(out)) out = out.replace(/(\n(\s*)size\?: number;)/, "$1\n$2strokeWidth?: number;");
  if (!/strokeWidth = 2/.test(out)) out = out.replace(/size = (\d+)/, "size = $1, strokeWidth = 2");
  return out;
}

for (const name of new Set(names)) {
  const text = readFileSync(join(source, `${name}.tsx`), "utf8");
  const out = adapt(text);
  const problems = [
    !/from 'framer-motion'/.test(out) && "no framer-motion import",
    /motion\/react/.test(out) && "motion/react left",
    !/strokeWidth=\{strokeWidth\}/.test(out) && !/strokeWidth: strokeWidth/.test(out) && "no strokeWidth attribute",
    !/strokeWidth = 2/.test(out) && "no strokeWidth prop",
    /@\/lib\/utils/.test(out) && "app alias left",
  ].filter(Boolean);
  if (problems.length) { console.error(`${name}: ${problems.join(", ")} — port it by hand`); process.exitCode = 1; continue; }
  const header = `// Ported from pqoqubbw/icons (MIT, github.com/pqoqubbw/icons @ ${commit}; licence: ../../LICENSE-pqoqubbw).\n// HALO transform: motion/react -> framer-motion, strokeWidth prop added (scripts/port.mjs).\n`;
  writeFileSync(join(bank, `${name}.tsx`), header + out);
  console.log(`ported ${name}`);
}
