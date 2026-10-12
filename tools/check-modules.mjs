// SISO OS §3 (t-0599 step 5): a module never reaches into another module. Every relative import in
// apps/web/src/modules/<id>/ must stay inside <id>/ or leave modules/ altogether (shared code, packages).
//   node tools/check-modules.mjs     exit 1 with file:line for each crossing
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const MODULES = path.resolve(import.meta.dirname, "../apps/web/src/modules");
const walk = (d) => readdirSync(d).flatMap((f) => { const p = path.join(d, f); return statSync(p).isDirectory() ? walk(p) : /\.(tsx?|css)$/.test(f) ? [p] : []; });
const SPEC = /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+|@import\s+)(["'])(\.{1,2}\/[^"']+)\1/g;
const bad = [];
for (const id of readdirSync(MODULES).filter((d) => statSync(path.join(MODULES, d)).isDirectory())) {
  for (const file of walk(path.join(MODULES, id))) {
    readFileSync(file, "utf8").split("\n").forEach((line, i) => {
      for (const m of line.matchAll(SPEC)) {
        const target = path.relative(MODULES, path.resolve(path.dirname(file), m[2]));
        const into = target.startsWith("..") ? null : target.split(path.sep)[0];
        if (into && into !== id) bad.push(`${path.relative(process.cwd(), file)}:${i + 1}: module ${id} imports module ${into} (${m[2]})`);
      }
    });
  }
}
if (bad.length) { console.error(bad.join("\n")); console.error(`check-modules: ${bad.length} import(s) cross between modules`); process.exit(1); }
console.log("check-modules: no module imports another");
