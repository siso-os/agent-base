/** Read-only Codex rollout adapter. Matches transcript.ts's API and ChatEvent shape.
 * Use the herdr agent_session.value as session; response_item is canonical, so
 * event_msg mirrors never duplicate messages. Encrypted reasoning stays private.
 */
import { closeSync, existsSync, openSync, readdirSync, readSync, statSync, watch, type FSWatcher } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { StringDecoder } from "node:string_decoder";
import { summarize, toolInput, toolOut } from "../../host/src/events.ts";
import type { ChatEvent } from "./transcript.ts";
type FileStamp = { dev: number; ino: number; mtimeMs: number; size: number };

const found = new Map<string, string>();
/** AB_CODEX_DIRS overrides config roots for fixtures; CODEX_HOME is respected. */
export function sessionFile(session: string, _cwd = ""): string | null {
  if (!/^[A-Za-z0-9_-]+$/.test(session)) return null;
  const roots = (process.env.AB_CODEX_DIRS ?? process.env.CODEX_HOME ?? path.join(homedir(), ".codex")).split(path.delimiter).filter(Boolean);
  const key = `${roots.join(path.delimiter)}:${session}`;
  const hit = found.get(key);
  if (hit && existsSync(hit)) return hit;
  function search(dir: string): string | null {
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return null; }
    for (const e of entries) {
      if (e.isFile() && (e.name === `${session}.jsonl` || e.name.endsWith(`-${session}.jsonl`))) return path.join(dir, e.name);
      if (e.isDirectory()) { const file = search(path.join(dir, e.name)); if (file) return file; }
    }
    return null;
  }
  for (const root of roots) {
    const file = search(path.join(root, "sessions"));
    if (file) { found.set(key, file); return file; }
  }
  return null; // don't cache misses: a newly launched thread may not have written yet
}

const textOf = (content: unknown): string => typeof content === "string" ? content : Array.isArray(content)
  ? content.filter((b) => ["input_text", "output_text", "text", "summary_text", "reasoning_text"].includes(b?.type) && typeof b.text === "string").map((b) => b.text).join("\n") : "";

export function lineToEvents(rec: any): ChatEvent[] {
  if (rec?.type !== "response_item" || !rec.payload) return [];
  const p = rec.payload;
  const at = Date.parse(rec.timestamp ?? "") || 0;
  const id = p.id ?? `${rec.ordinal ?? rec.timestamp}:${p.type}`;
  if (p.type === "message" && (p.role === "user" || p.role === "assistant")) {
    const text = textOf(p.content);
    return text.trim() ? [{ t: p.role === "user" ? "user" : "text", id, text, at, ...(p.role === "user" ? { from: "history" } : {}) }] : [];
  }
  if (p.type === "reasoning") {
    const text = textOf(p.summary) || textOf(p.content);
    return text.trim() ? [{ t: "thinking", id, text, ms: null, at }] : [];
  }
  if (p.type === "function_call" || p.type === "custom_tool_call") {
    const raw = p.type === "function_call" ? p.arguments : p.input;
    let input: Record<string, any> = {};
    if (typeof raw === "string") {
      try { const parsed = JSON.parse(raw); input = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : { input: raw }; }
      catch { input = { input: raw }; }
    } else if (raw && typeof raw === "object" && !Array.isArray(raw)) input = raw;
    const shell = ["exec_command", "shell_command", "shell", "Bash"].includes(p.name);
    const command = input.cmd ?? input.command;
    const mapped = shell ? { ...input, command: Array.isArray(command) ? command.join(" ") : command } : input;
    return [{ t: "tool", id: p.call_id ?? id, name: p.name, summary: summarize(shell ? "Bash" : p.name, mapped), input: toolInput(shell ? "Bash" : p.name, mapped), at }];
  }
  if (p.type === "function_call_output" || p.type === "custom_tool_call_output") {
    const output = textOf(p.output);
    // Codex doesn't consistently store status. Use explicit errors/exit codes when present.
    let result: any = p.output;
    if (typeof result === "string") { try { result = JSON.parse(result); } catch { /* plain tool output */ } }
    const exit = result?.exit_code ?? result?.metadata?.exit_code ?? /(?:Process exited with code|exit code:)\s*(-?\d+)/i.exec(output)?.[1];
    const ok = !p.is_error && !result?.is_error && (exit == null || Number(exit) === 0);
    return [{ t: "tool_done", id: p.call_id ?? id, ok, ...toolOut(output || (result && typeof result === "object" ? JSON.stringify(result) : "")), at }];
  }
  return [];
}

const OPEN_BYTES = Number(process.env.AB_CHAT_OPEN_BYTES ?? 16 << 20);
export class Transcript {
  readonly log: ChatEvent[] = [];
  private offset = 0;
  private rest = "";
  private decoder = new StringDecoder("utf8");
  private watcher: FSWatcher | null = null;
  private poll: NodeJS.Timeout | null = null;
  private subs = new Set<(e: ChatEvent) => void>();
  get observed() { return this.subs.size > 0; }
  private stamp: FileStamp | null = null;
  readonly file: string;
  constructor(file: string) {
    this.file = file;
    const initial = statSync(file);
    this.stamp = { dev: Number(initial.dev), ino: Number(initial.ino), mtimeMs: initial.mtimeMs, size: initial.size };
    this.offset = Math.max(0, initial.size - OPEN_BYTES);
    // The offset may already be at a line boundary; discard only a genuinely partial first line.
    let partial = false;
    if (this.offset > 0) {
      const fd = openSync(file, "r");
      try {
        const b = Buffer.alloc(1);
        readSync(fd, b, 0, 1, this.offset - 1);
        partial = b[0] !== 10;
      } finally {
        closeSync(fd);
      }
    }
    this.read(partial);
  }
  catchUp() { this.read(); }
  private read(skipFirst = false) {
    let current: FileStamp;
    try {
      const st = statSync(this.file);
      current = { dev: Number(st.dev), ino: Number(st.ino), mtimeMs: st.mtimeMs, size: st.size };
    } catch { return; }
    const prior = this.stamp;
    const rebuilding = !!prior && (current.dev !== prior.dev || current.ino !== prior.ino || current.size < this.offset || (current.size === this.offset && current.mtimeMs !== prior.mtimeMs));
    if (rebuilding) {
      this.offset = 0; this.rest = ""; this.decoder = new StringDecoder("utf8"); this.log.length = 0;
      skipFirst = false;
    }
    this.stamp = current;
    const size = current.size;
    if (size === this.offset) {
      if (rebuilding) for (const sub of this.subs) sub({ t: "reset" });
      return;
    }
    const fd = openSync(this.file, "r");
    try {
      const buf = Buffer.alloc(size - this.offset);
      const bytes = readSync(fd, buf, 0, buf.length, this.offset);
      this.offset += bytes;
      const lines = (this.rest + this.decoder.write(buf.subarray(0, bytes))).split("\n");
      this.rest = lines.pop() ?? "";
      if (skipFirst) lines.shift();
      for (const line of lines) {
        let rec;
        try { rec = JSON.parse(line); } catch { continue; }
        for (const e of lineToEvents(rec)) { this.log.push(e); if (!rebuilding) for (const sub of this.subs) sub(e); }
      }
      if (this.log.length > 6000) this.log.splice(0, this.log.length - 6000);
    } finally { closeSync(fd); }
    if (rebuilding) for (const sub of this.subs) sub({ t: "reset" });
  }
  subscribe(fn: (e: ChatEvent) => void): () => void {
    this.subs.add(fn);
    if (!this.poll) {
      try { this.watcher = watch(this.file, () => this.read()); } catch { /* polling fallback */ }
      this.poll = setInterval(() => this.read(), 500);
    }
    return () => {
      this.subs.delete(fn);
      if (!this.subs.size) {
        this.watcher?.close(); this.watcher = null;
        if (this.poll) clearInterval(this.poll); this.poll = null;
        if (open.get(this.file) === this) open.delete(this.file);
      }
    };
  }
}
const open = new Map<string, Transcript>();
export function transcriptOf(file: string): Transcript {
  let t = open.get(file);
  if (!t) {
    open.set(file, (t = new Transcript(file)));
    const current = t;
    // A socket owns read-only history; only active subscribers need shared retention.
    queueMicrotask(() => { if (!current.observed && open.get(file) === current) open.delete(file); });
  }
  return t;
}
