/**
 * What is filling a chat's context (ui-hub ideas round 2 #2; Shaan 4 Oct, "I like all of your ideas"): the session file
 * since its last compaction, sorted into what the model is carrying: files it read, shell output, what sub-agents
 * brought back, the conversation itself, and other tool results. Counted at ~4 characters a token (an estimate, labelled
 * so). The system prompt and tool definitions are not in the file; they are the gap between this and the real gauge.
 */
import path from "node:path";
import { readFileSync, statSync, realpathSync, lstatSync, openSync, readSync, closeSync } from "node:fs";

export type ContextMix = { kinds: { files: number; shell: number; subagents: number; talk: number; tools: number }; top: { label: string; tokens: number }[]; turns: { back: number; text: string }[]; at: number; files?: { label: string; state: "changed" | "unchanged" | "unknown" }[] };

const FILES = new Set(["Read", "Grep", "Glob", "NotebookRead", "LS"]);
const SUBS = new Set(["Agent", "Task"]);
type Capture = { file: string; at: number | null };
type Kinds = { files: number; shell: number; subagents: number; talk: number; tools: number };
/** One file's running parse. A session file only grows, so a read takes the new bytes and carries on from here. */
type Parse = { ino: number; offset: number; tail: string; carry: Buffer; kinds: Kinds; big: Map<string, number>; toolOf: Map<string, { name: string; label: string; file?: string }>; captured: Map<string, Capture>; prompts: string[] };
const cache = new Map<string, { size: number; mtime: number; mix: ContextMix; captures: Capture[]; parse: Parse }>();
const TAIL = 256, CHUNK = 8 * 1024 * 1024;
/** Metadata only, contained to the seat's actual worktree; no arbitrary file content reads. */
export function contextFiles(captures: Capture[], root?: string): NonNullable<ContextMix['files']> {
  let base: string | null = null;
  try { if (root) base = realpathSync(root); } catch { /* unavailable */ }
  return captures.slice(-24).map(capture => {
    let state: 'changed' | 'unchanged' | 'unknown' = 'unknown';
    if (base && capture.at !== null) {
      try {
        const candidate = path.resolve(base,capture.file);
        // Reject lexical escapes before touching the path, then reject symlink escapes.
        if (candidate.startsWith(base + path.sep) || (root && candidate.startsWith(path.resolve(root) + path.sep))) {
          const resolved = realpathSync(candidate);
          if (resolved.startsWith(base + path.sep)) {
            const stat = lstatSync(resolved);
            if (stat.isFile()) state = stat.mtimeMs > capture.at ? 'changed' : 'unchanged';
          }
        }
      } catch { /* missing or unreadable is unknown */ }
    }
    return { label: path.basename(capture.file), state };
  });
}
const chars = (v: unknown): number => typeof v === "string" ? v.length : Array.isArray(v) ? v.reduce((n: number, b: any) => n + chars(b?.text ?? b?.content ?? ""), 0) : 0;

const fresh = (ino: number): Parse => ({ ino, offset: 0, tail: "", carry: Buffer.alloc(0), kinds: { files: 0, shell: 0, subagents: 0, talk: 0, tools: 0 }, big: new Map(), toolOf: new Map(), captured: new Map(), prompts: [] });

function feed(p: Parse, line: string) {
  const { kinds, big, toolOf, captured } = p;
  const prompt = promptOf(line);
  if (prompt !== null) { p.prompts.push(prompt); if (p.prompts.length > 6) p.prompts.shift(); }
  let rec: any;
  try { rec = JSON.parse(line); } catch { return; }
  if (rec.isSidechain) return;
  if (rec.type === "system" && rec.subtype === "compact_boundary") {
    for (const k of Object.keys(kinds) as (keyof Kinds)[]) kinds[k] = 0;
    big.clear(); toolOf.clear(); captured.clear();
    return;
  }
  const content = rec.message?.content;
  if (rec.type === "assistant" && Array.isArray(content)) {
    for (const b of content) {
      if (b?.type === "text") kinds.talk += (b.text ?? "").length;
      else if (b?.type === "tool_use") {
        const i = b.input ?? {};
        toolOf.set(b.id, { name: b.name, file: b.name === "Read" && typeof i.file_path === "string" ? i.file_path : undefined, label: String(i.file_path ?? i.path ?? i.pattern ?? i.description ?? i.command ?? b.name).split("/").slice(-2).join("/").slice(0, 60) });
        kinds.tools += JSON.stringify(i).length;
      }
    }
  } else if (rec.type === "user") {
    if (typeof content === "string") { kinds.talk += content.length; return; }
    if (!Array.isArray(content)) return;
    for (const b of content) {
      if (b?.type === "text") { kinds.talk += (b.text ?? "").length; continue; }
      if (b?.type !== "tool_result") continue;
      const n = chars(b.content);
      const t = toolOf.get(b.tool_use_id);
      if (t?.file && !b.is_error) {
        const at = typeof rec.timestamp === 'string' ? Date.parse(rec.timestamp) : NaN;
        captured.delete(t.file); captured.set(t.file, {file:t.file,at:Number.isFinite(at)?at:null});
        if(captured.size>64) captured.delete(captured.keys().next().value!);
      }
      const kind = !t ? "tools" : FILES.has(t.name) ? "files" : SUBS.has(t.name) ? "subagents" : t.name === "Bash" ? "shell" : "tools";
      kinds[kind] += n;
      if (t) big.set(`${t.name} ${t.label}`, (big.get(`${t.name} ${t.label}`) ?? 0) + n);
    }
  }
}

/** The bytes from `from` to the end of the file, or null when it cannot be read. */
function readFrom(file: string, from: number, size: number): Buffer | null {
  let fd: number | undefined;
  try {
    fd = openSync(file, "r");
    const buf = Buffer.allocUnsafe(size - from);
    const n = readSync(fd, buf, 0, buf.length, from);
    return buf.subarray(0, n);
  } catch { return null; } finally { if (fd !== undefined) closeSync(fd); }
}

export function contextMix(file: string, root?: string): ContextMix | null {
  let st;
  try { st = statSync(file); } catch { return null; }
  const hit = cache.get(file);
  if (hit && hit.size === st.size && hit.mtime === st.mtimeMs) return { ...hit.mix, files: contextFiles(hit.captures, root) };
  // 9 Oct: re-reading the whole file on every change was the node's top cost while an agent worked (5 s a 90 s profile),
  // and Agent Zero's file passed 512 MB, more than one string can hold, so its card failed outright. Carry on from the last
  // read while the file only grew (same inode, longer, the bytes before the old end unchanged), and read in pieces split
  // at newlines (a newline byte never sits inside a UTF-8 character), so no file is ever held whole.
  let p = hit?.parse;
  if (p) {
    const back = Math.min(TAIL, p.offset), before = p.ino === st.ino && st.size >= p.offset ? readFrom(file, p.offset - back, p.offset) : null;
    if (!before || before.toString("latin1") !== p.tail) p = undefined;
  }
  if (!p) p = fresh(st.ino);
  for (let at = p.offset; at < st.size; at += CHUNK) {
    const piece = readFrom(file, at, Math.min(st.size, at + CHUNK));
    if (!piece) { cache.delete(file); return null; }
    const bytes = p.carry.length ? Buffer.concat([p.carry, piece]) : piece;
    const cut = bytes.lastIndexOf(10);
    for (const line of bytes.toString("utf8", 0, cut + 1).split("\n")) if (line) feed(p, line);
    p.carry = Buffer.from(bytes.subarray(cut + 1));
    p.offset = at + piece.length;
    if (piece.length < Math.min(st.size, at + CHUNK) - at) break;
  }
  const end = readFrom(file, Math.max(0, p.offset - TAIL), p.offset);
  p.tail = end ? end.toString("latin1") : "";
  // A last line without its newline yet is still counted as the whole-file read did; it is parsed again once complete.
  const rest = p.carry.toString("utf8");
  const view = rest ? { ...p, kinds: { ...p.kinds }, big: new Map(p.big), toolOf: new Map(p.toolOf), captured: new Map(p.captured), prompts: [...p.prompts] } : p;
  if (rest) feed(view, rest);
  const { kinds, big, captured } = view;
  const tok = (c: number) => Math.round(c / 4);
  const mix: ContextMix = {
    kinds: { files: tok(kinds.files), shell: tok(kinds.shell), subagents: tok(kinds.subagents), talk: tok(kinds.talk), tools: tok(kinds.tools) },
    top: [...big].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([label, c]) => ({ label, tokens: tok(c) })),
    turns: view.prompts.slice(-6).reverse().map((t, back) => ({ back, text: t.replace(/\s+/g, " ").slice(0, 70) })),
    at: Date.now(),
  };
  const captures = [...captured.values()];
  cache.set(file, { size: st.size, mtime: st.mtimeMs, mix, captures, parse: p });
  return { ...mix, files: contextFiles(captures, root) };
}

/** One line's prompt text when it is one of his own prompts, else null (the test `prompts` applies, line by line). */
function promptOf(line: string): string | null {
  if (!line.includes('"type":"user"')) return null;
  let rec: any;
  try { rec = JSON.parse(line); } catch { return null; }
  if (rec.type !== "user" || rec.isSidechain || rec.isMeta || typeof rec.uuid !== "string") return null;
  const c = rec.message?.content;
  const t = typeof c === "string" ? c : Array.isArray(c) && !c.some((b: any) => b?.type === "tool_result") ? c.filter((b: any) => b?.type === "text").map((b: any) => b.text).join(" ") : "";
  return t.trim() && !t.startsWith("<") ? t : null;
}

/** His own prompts in a session file, in order, with the record index each sits at (tool results and meta lines are not prompts). */
function prompts(text: string): { uuid: string; at: number; text: string }[] {
  const out: { uuid: string; at: number; text: string }[] = [];
  text.split("\n").forEach((line, at) => {
    if (!line.includes('"type":"user"')) return;
    let rec: any;
    try { rec = JSON.parse(line); } catch { return; }
    if (rec.type !== "user" || rec.isSidechain || rec.isMeta || typeof rec.uuid !== "string") return;
    const c = rec.message?.content;
    const t = typeof c === "string" ? c : Array.isArray(c) && !c.some((b: any) => b?.type === "tool_result") ? c.filter((b: any) => b?.type === "text").map((b: any) => b.text).join(" ") : "";
    if (t.trim() && !t.startsWith("<")) out.push({ uuid: rec.uuid, at, text: t });
  });
  return out;
}

/**
 * Where to cut for "fork from a turn": `back` turns before the latest prompt, keeping that turn's whole answer, so the cut
 * is the last message before the next prompt (none: the whole file). Returns null when there is no such turn.
 */
export function forkPoint(file: string, back: number): { upTo: string | null } | null {
  let text: string;
  try { text = readFileSync(file, "utf8"); } catch { return null; }
  const ps = prompts(text), i = ps.length - 1 - back;
  if (i < 0 || i >= ps.length) return null;
  const next = ps[i + 1];
  if (!next) return { upTo: null };
  const lines = text.split("\n");
  for (let k = next.at - 1; k >= 0; k--) {
    try { const rec = JSON.parse(lines[k]); if (typeof rec.uuid === "string" && !rec.isSidechain) return { upTo: rec.uuid }; } catch { /* skip */ }
  }
  return null;
}
