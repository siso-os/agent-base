// Agent Zero's scratch pad (scratchpad.ts): add, toggle, edit, remove, a hand edit shows on the next read, bad input refused.
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const nodeDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const scratch = mkdtempSync(path.join(tmpdir(), ".scratchpad-test-"));
const file = path.join(scratch, "pad.json");
const check = (name, ok, detail = {}) => { console.log(JSON.stringify({ check: name, ok, ...detail })); if (!ok) process.exitCode = 1; };
const run = (code) => JSON.parse(execFileSync(process.execPath, ["--experimental-strip-types", "--input-type=module", "-e", `import { applyPad, readPad } from './src/scratchpad.ts'; const out = await (async () => { ${code} })(); console.log(JSON.stringify(out));`], { cwd: nodeDir, env: { ...process.env, AB_SCRATCHPAD: file }, encoding: "utf8" }));
try {
  const empty = run("return readPad();");
  check("no file reads as an empty pad for today", empty.items.length === 0 && /^\d{4}-\d{2}-\d{2}$/.test(empty.date), { date: empty.date });

  const added = run("applyPad({ op: 'add', text: '  land the merge train ', group: 'Agent Base' }); return applyPad({ op: 'add', text: 'clean the mini' });");
  check("add keeps order, trims, stamps a time, keeps the group", added.items.length === 2 && added.items[0].text === "land the merge train" && added.items[0].group === "Agent Base" && typeof added.items[0].at === "number" && !added.items[1].group);

  const id = added.items[0].id;
  const ticked = run(`return applyPad({ op: 'toggle', id: '${id}' });`);
  check("toggle marks done with a time", typeof ticked.items[0].done === "number");
  const unticked = run(`return applyPad({ op: 'toggle', id: '${id}' });`);
  check("toggle again clears it", !unticked.items[0].done);

  const edited = run(`return applyPad({ op: 'edit', id: '${id}', text: 'merge train live' });`);
  check("edit changes the text only", edited.items[0].text === "merge train live" && edited.items[0].id === id);

  const bad = run("return [applyPad({ op: 'add', text: '   ' }), applyPad({ op: 'toggle', id: 'nope' }), applyPad({ op: 'explode' })];");
  check("empty text, unknown id and unknown op are refused", bad.every((r) => typeof r.error === "string"));

  const removed = run(`return applyPad({ op: 'remove', id: '${id}' });`);
  check("remove drops the line", removed.items.length === 1 && removed.items[0].text === "clean the mini");

  writeFileSync(file, JSON.stringify({ date: "2026-10-03", updated: 5, pop: 9, items: [{ id: "a", text: "hand-written by A0", at: 1 }, { nope: true }] }));
  const hand = run("return readPad();");
  check("a hand edit of the file shows on the next read; junk rows are dropped; pop passes through", hand.items.length === 1 && hand.items[0].text === "hand-written by A0" && hand.pop === 9 && hand.updated === 5);

  writeFileSync(file, "{ not json");
  const broken = run("return readPad();");
  check("a malformed file reads as an empty pad, not a crash", Array.isArray(broken.items) && broken.items.length === 0);
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
