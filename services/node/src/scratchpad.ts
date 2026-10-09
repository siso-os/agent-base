import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";

/**
 * Agent Zero's scratch pad (Shaan, 3 Oct ~16:10: "a scratch pad with an icon I can pop open ... I just want to pin the
 * stuff that we need to do today ... it will have the today's date up top and the time stamp ... without repushing maybe
 * through json ... I could see the updates"). One JSON file that both he (from the app) and Agent Zero (by editing the
 * file) write; it is read fresh on every GET, so an edit shows within the app's next poll, no deploy.
 *
 * File: AB_SCRATCHPAD, else Agent Zero's repo .agents/a0/scratchpad.json.
 * Shape: { date: "YYYY-MM-DD", updated: ms, pop?: ms, items: [{ id, text, group?, at: ms, done?: ms|null }] }
 */
export type PadItem = { id: string; text: string; group?: string; at: number; done?: number | null };
/** pop: when Agent Zero last asked the app to pop the pad open for him (ms); the app opens it once per new value. */
export type Pad = { date: string; updated: number; pop?: number; items: PadItem[] };

export const padFile = () =>
  process.env.AB_SCRATCHPAD || path.join(os.homedir(), "SISO_Workspace/SISO_Agents/agent-zero/siso-agent-zero/.agents/a0/scratchpad.json");

const today = () => new Date().toLocaleDateString("en-CA"); // YYYY-MM-DD, local

export function readPad(file = padFile()): Pad {
  try {
    const p = JSON.parse(fs.readFileSync(file, "utf8"));
    const items = Array.isArray(p.items) ? p.items.filter((i: PadItem) => i && typeof i.text === "string") : [];
    return { date: typeof p.date === "string" ? p.date : today(), updated: Number(p.updated) || fs.statSync(file).mtimeMs, ...(Number(p.pop) ? { pop: Number(p.pop) } : {}), items };
  } catch {
    return { date: today(), updated: 0, items: [] };
  }
}

function writePad(p: Pad, file = padFile()) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${crypto.randomBytes(4).toString("hex")}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify({ ...p, updated: Date.now() }, null, 2) + "\n");
  fs.renameSync(tmp, file);
}

/** add {text, group?} · toggle {id} · edit {id, text} · remove {id}. Returns the pad after the change. */
export function applyPad(op: Record<string, unknown>, file = padFile()): Pad | { error: string } {
  const p = readPad(file);
  const id = typeof op.id === "string" ? op.id : "";
  const at = p.items.findIndex((i) => i.id === id);
  const text = typeof op.text === "string" ? op.text.trim().slice(0, 500) : "";
  if (op.op === "add") {
    if (!text) return { error: "empty" };
    const group = typeof op.group === "string" && op.group.trim() ? op.group.trim().slice(0, 60) : undefined;
    p.items.push({ id: crypto.randomBytes(5).toString("hex"), text, ...(group ? { group } : {}), at: Date.now(), done: null });
  } else if (op.op === "toggle" && at >= 0) p.items[at].done = p.items[at].done ? null : Date.now();
  else if (op.op === "edit" && at >= 0 && text) p.items[at].text = text;
  else if (op.op === "remove" && at >= 0) p.items.splice(at, 1);
  else return { error: "unknown op or id" };
  writePad(p, file);
  return readPad(file);
}
