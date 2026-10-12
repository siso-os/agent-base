// One-off for t-0599 step 5 (siso-os.md §3): move each module's own files into apps/web/src/modules/<id>/ with git mv
// and rewrite every relative import that pointed at them or out of them. A file moves only when everything that imports
// it is App.tsx, main.tsx or a file of the same module (so shared code stays where it is). Run from the repo root:
//   node tools/move-modules.mjs [--dry]
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

const SRC = path.resolve("apps/web/src");
const dry = process.argv.includes("--dry");
// Seeds: each module's entry files (its space component); its private helpers follow by the importer rule.
const SEEDS = {
  tasks: ["components/TasksPage.tsx", "components/TaskBoard.tsx"],
  voice: ["components/VoiceSpace.tsx"],
  rolodex: ["components/RolodexSpace.tsx"],
  whatsapp: ["components/WhatsAppSpace.tsx"],
  estate: ["components/LibrarySpace.tsx", "components/ServersSpace.tsx", "components/TokensSpace.tsx", "components/MiniLanes.tsx"],
  life: ["components/LifeSpace.tsx"],
};
const ROOTS = new Set(["App.tsx", "main.tsx"]);

const walk = (d) => readdirSync(d).flatMap((f) => { const p = path.join(d, f); return statSync(p).isDirectory() ? (f === "__tests__" || f === "node_modules" ? [] : walk(p)) : [p]; });
const files = walk(SRC).filter((f) => /\.(tsx?|css)$/.test(f) && !f.includes(`${path.sep}modules${path.sep}`));
const SPEC = /(\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)(["'])(\.{1,2}\/[^"']+)\2/g;
const resolve = (from, spec) => {
  const base = path.resolve(path.dirname(from), spec);
  for (const c of [base, `${base}.ts`, `${base}.tsx`, `${base}.css`, path.join(base, "index.ts"), path.join(base, "index.tsx")]) if (existsSync(c) && statSync(c).isFile()) return c;
  return null;
};
const importsOf = new Map(), importers = new Map();
for (const f of files.concat(walk(SRC).filter((f) => f.includes("__tests__")))) {
  const text = readFileSync(f, "utf8"), out = [];
  for (const m of text.matchAll(SPEC)) { const r = resolve(f, m[3]); if (r) { out.push(r); if (!importers.has(r)) importers.set(r, new Set()); importers.get(r).add(f); } }
  importsOf.set(f, out);
}
const rel = (f) => path.relative(SRC, f);
// Grow each module from its seeds: a file joins when it is imported by the module and by nothing outside it.
const owner = new Map();
for (const [id, seeds] of Object.entries(SEEDS)) for (const s of seeds) owner.set(path.join(SRC, s), id);
for (let changed = true; changed;) {
  changed = false;
  for (const [f, id] of [...owner]) for (const dep of importsOf.get(f) ?? []) {
    if (owner.has(dep) || !dep.startsWith(SRC) || dep.includes("__tests__")) continue;
    const by = [...(importers.get(dep) ?? [])];
    if (by.length && by.every((i) => owner.get(i) === id)) { owner.set(dep, id); changed = true; }
  }
}
// The shell may import a module's entry (a page that shows the task board); a module may not import another module.
for (const [f, id] of [...owner]) {
  const other = [...(importers.get(f) ?? [])].filter((i) => owner.has(i) && owner.get(i) !== id);
  if (other.length) { console.log(`stays shared: ${rel(f)} (also used by module files ${other.map(rel).join(", ")})`); owner.delete(f); }
}
// Where each file goes: modules/<id>/ keeping its path below components/ or lib/.
const dest = new Map();
for (const [f, id] of owner) {
  const r = rel(f).replace(/^components\//, "").replace(new RegExp(`^${id}/`), "");
  dest.set(f, path.join(SRC, "modules", id, r));
}
for (const [f, d] of dest) console.log(`${rel(f)} -> ${rel(d)}`);
if (dry) process.exit(0);
// Rewrite specifiers in every file that imports a moved file, and in the moved files themselves.
const touched = new Set([...dest.keys(), ...[...dest.keys()].flatMap((f) => [...(importers.get(f) ?? [])])]);
for (const f of touched) {
  const newFrom = dest.get(f) ?? f;
  const text = readFileSync(f, "utf8").replace(SPEC, (all, pre, q, spec) => {
    const r = resolve(f, spec);
    if (!r) return all;
    const target = dest.get(r) ?? r;
    let s = path.relative(path.dirname(newFrom), target);
    // keep the original style: drop the extension unless the spec had one, and index files stay as folders
    if (!/\.(tsx?|css|mjs|json)$/.test(spec)) s = s.replace(/\.(tsx?)$/, "").replace(/\/index$/, "");
    if (!s.startsWith(".")) s = `./${s}`;
    return `${pre}${q}${s}${q}`;
  });
  writeFileSync(f, text);
}
for (const [f, d] of dest) { execFileSync("mkdir", ["-p", path.dirname(d)]); execFileSync("git", ["mv", f, d]); }
console.log(`moved ${dest.size} files`);
