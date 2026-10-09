/**
 * The app's chat for an agent running in the plain terminal (not under siso-host), read from its Claude session file
 * (backlog 2a: "every agent gets the nice chat today, host or not"). The file is the record Claude Code writes as it
 * goes; this follows it with fs.watch plus a slow poll, reads only the new bytes, and turns each line into the same
 * events siso-host sends, so the app draws both the same way. Read-only: the file is only ever opened for reading.
 *
 * Proven first by test 2 (siso-internal-labs-agents/.agents/research/2026-10-01-agent-app/tests/2-chat-view): a line
 * reaches the page 0-2 ms after it lands; Claude Code itself holds the lead's reply until its last block (1-5 s).
 */
import { closeSync, existsSync, openSync, readdirSync, readSync, statSync, watch, type FSWatcher } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { apiError, peerMessage, summarize, toolInput, toolOut } from "../../host/src/events.ts";
import { readdirIfChanged } from "./stat-memo.ts";

export type ChatEvent = Record<string, unknown> & { t: string };
type ChatEv = ChatEvent;
export type { ChatEv };
type FileStamp = { dev: number; ino: number; mtimeMs: number; size: number };

/** Every Claude config folder on this machine: ~/.claude, ~/.claude-<account>, ~/.config/claude-<account>. */
function configDirs(): string[] {
  if (process.env.AB_CLAUDE_DIRS) return process.env.AB_CLAUDE_DIRS.split(":").filter(Boolean);
  const out: string[] = [];
  for (const base of [homedir(), path.join(homedir(), ".config")]) {
    try {
      for (const d of readdirSync(base)) if (/^\.?claude([-_].+)?$/.test(d)) out.push(path.join(base, d));
    } catch {
      /* no such folder */
    }
  }
  return out;
}

/** Every copy of a session found, per session id, and when the folders were last searched. */
const found = new Map<string, { files: string[]; at: number }>();
const RESCAN_MS = Number(process.env.AB_SESSION_RESCAN_MS ?? 30_000);
const mtime = (f: string) => {
  try {
    return statSync(f).mtimeMs;
  } catch {
    return -1;
  }
};
/**
 * The session's file. A session can exist in more than one Claude folder: moving an agent to another login copies its
 * session there and it carries on writing the new copy (2 Oct, Agent Zero went stale: the first copy found was cached
 * for good). So every copy is found, in every Claude folder, and the most recently written one wins. The folders are
 * searched again every 30 s, or at once with `fresh` (each time a chat opens).
 */
export function sessionFile(session: string, cwd: string, opts: { fresh?: boolean } = {}): string | null {
  if (!/^[A-Za-z0-9_-]+$/.test(session)) return null;
  let hit = found.get(session);
  if (!hit || opts.fresh || Date.now() - hit.at > RESCAN_MS) {
    const slug = cwd.replace(/[^A-Za-z0-9]/g, "-");
    const files = new Set<string>();
    for (const dir of configDirs()) {
      const direct = path.join(dir, "projects", slug, `${session}.jsonl`);
      if (slug && existsSync(direct)) files.add(direct);
      const projects = readdirIfChanged(path.join(dir, "projects"));
      for (const p of projects) {
        const f = path.join(dir, "projects", p, `${session}.jsonl`);
        if (existsSync(f)) files.add(f);
      }
    }
    hit = { files: [...files], at: Date.now() };
    found.set(session, hit);
  }
  let best: string | null = null;
  for (const f of hit.files) if (mtime(f) > (best ? mtime(best) : -1)) best = f;
  return best;
}

/** A queued line's id: its words, so the record that consumes or removes it (which repeats them) finds it. */
export function queueId(text: string): string {
  let h = 5381;
  for (const ch of text.replace(/\s+/g, " ").trim()) h = ((h * 33) ^ ch.charCodeAt(0)) >>> 0;
  return `q${h.toString(36)}`;
}

const textOf = (c: unknown): string =>
  typeof c === "string" ? c : Array.isArray(c) ? c.filter((b: any) => b?.type === "text").map((b: any) => b.text).join("\n") : "";

/**
 * One line of a session file as chat events. Sub-agent lines (isSidechain), hidden meta lines and harness wrappers
 * (slash-command echoes, caveats) are left out; a command's printed output becomes a note; a message typed while
 * Claude worked (a queued_command attachment) stays inside the running turn.
 *
 * R1.20 (Shaan 21:22: "it's not showing all the stuff that the cli shows"): what the CLI shows and this used to drop.
 * A line typed while Claude works is a queue `enqueue` the moment he presses Enter, so it shows at once as a queued row
 * (`fixed`: only the pane can take it back) and goes when it is consumed or removed; the CLI's hook errors and hook
 * output, "Conversation compacted", the turn's own time ("Worked for"), `!` shell lines and pasted images' markers.
 * Records that are only Claude's own context (reminders, listings, file snapshots, titles) stay out, as in the CLI.
 * The audit behind this: siso-internal-labs-agents/.agents/tasks/release-1/R1.20-gaps.md.
 */
export function lineToEvents(rec: any): ChatEvent[] {
  if (!rec || rec.isSidechain) return [];
  const at = Date.parse(rec.timestamp ?? "") || 0;
  const c = rec.message?.content;
  if (rec.type === "queue-operation") {
    // A `dequeue` carries no text: the user line written with it settles the row (buildChat matches by text).
    const text = typeof rec.content === "string" ? rec.content.trim() : "";
    if (!text || text.startsWith("<")) return []; // task notifications queue too; they are not his words
    if (rec.operation === "enqueue") return [{ t: "queued", id: queueId(text), text, at, fixed: true }];
    if (rec.operation === "remove") return [{ t: "unqueued", id: queueId(text) }];
    return [];
  }
  if (rec.type === "system") {
    if (rec.subtype === "compact_boundary") {
      const m = rec.compactMetadata ?? {};
      const k = (n: unknown) => (typeof n === "number" ? `${Math.round(n / 1000)}k` : "?");
      return [{ t: "note", label: "Compacted", text: `Conversation compacted (${m.trigger ?? "auto"}, ${k(m.preTokens)} → ${k(m.postTokens)} tokens)`, at }];
    }
    if (rec.subtype === "turn_duration" && typeof rec.durationMs === "number") return [{ t: "result", ms: rec.durationMs, cost: null, at }];
    return []; // stop_hook_summary repeats the hook_blocking_error attachment written with it
  }
  if (rec.type === "attachment") {
    const a = rec.attachment;
    if (a?.type === "queued_command" && typeof a.prompt === "string" && a.prompt.trim()) {
      const taken: ChatEvent = { t: "unqueued", id: queueId(a.prompt.trim()) };
      return [taken, { t: "user", text: a.prompt, at, from: "history", mid: true }];
    }
    if (a?.type === "hook_blocking_error") {
      const err = String(a.blockingError?.blockingError ?? a.blockingError ?? "").trim();
      return err ? [{ t: "note", label: `${a.hookName ?? "Hook"} hook error`, text: err, at, bad: true }] : [];
    }
    if (a?.type === "hook_success" && typeof a.content === "string" && a.content.trim()) return [{ t: "note", label: `${a.hookName ?? "Hook"} hook`, text: a.content.trim(), at }];
    if (a?.type === "hook_additional_context") {
      const text = (Array.isArray(a.content) ? a.content : [a.content]).filter((x: unknown) => typeof x === "string" && x.trim()).join("\n").trim();
      return text ? [{ t: "note", label: `${a.hookName ?? "Hook"} hook`, text, at }] : [];
    }
    return [];
  }
  if (rec.type === "user") {
    // R1.20c (H1): another agent's message is stored as a meta line with `origin.kind: "peer"`; it was dropped with
    // the rest of the meta lines, so every peer message vanished from terminal chats.
    if (rec.origin?.kind === "peer") {
      const p = peerMessage(rec);
      return p ? [p] : [];
    }
    if (rec.isMeta) return [];
    const out: ChatEvent[] = [];
    // t-0245: a call he rejected (or stopped with Esc) prints only "⎿ Interrupted" in the CLI, never the boilerplate it
    // tells Claude; the interrupt marker that follows it says so in the chat.
    const REJECTED = /^(The user doesn't want to (proceed with|take) this|\[Request interrupted by user)/;
    if (Array.isArray(c))
      for (const b of c)
        if (b?.type === "tool_result") {
          const o = toolOut(b.content);
          out.push({ t: "tool_done", id: b.tool_use_id, ok: !b.is_error, ...(b.is_error && REJECTED.test(o.out) ? { out: "", lines: 0 } : o), at });
        }
    let text = textOf(c).trim();
    // Pasted images: the CLI writes "[Image #1]" into his words; a message without the marker gets one per image.
    const images = Array.isArray(c) ? c.filter((b: any) => b?.type === "image").length : 0;
    if (images && !/\[Image #\d+\]/.test(text)) text = [Array.from({ length: images }, (_, i) => `[Image #${i + 1}]`).join(" "), text].filter(Boolean).join("\n");
    const bash = text.match(/^<bash-input>([\s\S]*?)<\/bash-input>/);
    const tag = (n: string) => text.match(new RegExp(`<${n}>([\\s\\S]*?)</${n}>`))?.[1]?.trim() ?? "";
    // t-0245: the CLI prints a slash command as he typed it ("> /model opus"), so its echo is his line, not dropped;
    // its output (stdout, or stderr as an error) follows it.
    const command = /^<(command-name|command-message|command-args)>/.test(text) ? tag("command-name") : "";
    if (/<local-command-(stdout|stderr)>/.test(text)) {
      const note = text.replace(/<\/?local-command-(stdout|stderr)>/g, "").trim();
      if (note) out.push({ t: "note", text: note, at, ...(text.includes("<local-command-stderr>") ? { label: "Error", bad: true } : {}) });
    } else if (bash) out.push({ t: "user", id: rec.uuid, text: `! ${bash[1].trim()}`, at, from: "history" });
    else if (/^<bash-(stdout|stderr)>/.test(text)) {
      const note = text.replace(/<\/?bash-(stdout|stderr)>/g, "").trim();
      if (note) out.push({ t: "note", label: "Shell", text: note, at, ...(tag("bash-stderr") ? { bad: true } : {}) });
    } else if (command) out.push({ t: "user", id: rec.uuid, text: [command, tag("command-args")].filter(Boolean).join(" "), at, from: "history" });
    else if (text && !/^<(command-name|command-message|command-args|local-command-caveat)/.test(text)) out.push({ t: "user", id: rec.uuid, text, at, from: "history" });
    return out;
  }
  if (rec.type === "assistant" && rec.isApiErrorMessage) return [apiError(rec, at)];
  if (rec.type === "assistant" && Array.isArray(c)) {
    const out: ChatEvent[] = [];
    for (const [i, b] of c.entries()) {
      if (b?.type === "text" && b.text) out.push({ t: "text", id: `${rec.uuid}:${i}`, text: b.text, at });
      else if (b?.type === "thinking" && b.thinking?.trim()) out.push({ t: "thinking", id: `${rec.uuid}:${i}`, text: b.thinking, ms: null, at });
      else if (b?.type === "tool_use") out.push({ t: "tool", id: b.id, name: b.name, summary: summarize(b.name, b.input ?? {}), input: toolInput(b.name, b.input ?? {}), at });
    }
    return out;
  }
  return [];
}

/**
 * How much of the file a chat reads when it opens: its last part, cut at a line (P0 performance, Shaan 2 Oct 17:46:
 * "the app is lagging out we need lazy loading"). It was 16 MB, so Agent Zero's whole session was parsed and sent;
 * older turns are now read back from the file a page at a time, by byte offset, only when he scrolls up to them.
 */
const OPEN_BYTES = Number(process.env.AB_CHAT_OPEN_BYTES ?? 1 << 20);
/** Events kept in memory per followed file (the newest); a chat's first screen needs far fewer. */
const KEEP = 2000;

/** A chat's first screen: its last `want` events, back to his last message (at most `max`), never splitting a line. */
export const HELLO_EVENTS = 60;
export const OLDER_EVENTS = 200;
export function windowStart(log: ChatEvent[], want = HELLO_EVENTS, max = want * 4): number {
  // Count the main chat's events only (QA P0-2, A0 3 Oct): a sub-agent's events (a siso-host `parent`) are drawn inside
  // its card, so 55 of them used to fill the window and Agent Zero's chat opened blank while its sub-agents worked.
  const back = (n: number) => {
    let i = log.length;
    for (let c = 0; i > 0 && c < n; ) if (!(log[--i] as { parent?: unknown }).parent) c++;
    return i;
  };
  let k = back(want);
  const floor = back(max);
  // Start at his message, so the first turn on screen is whole. A background event (a task notification) also opens a
  // turn, but starting there hides his last message behind a wall of Monitor pings (Screen 14), so his own words win.
  let any = -1;
  for (let i = k; i >= floor; i--) {
    const e = log[i];
    if (e?.t !== "user") continue;
    if (!e.mid && !String(e.text ?? "").includes("<task-notification>")) {
      any = i;
      break;
    }
    if (any < 0) any = i;
  }
  if (any >= 0) k = any;
  // Never more than 20 windows of events whatever the sub-agents did, so a hello stays a page, not the whole log.
  k = Math.max(k, log.length - want * 20);
  // Events from one line of the file share its offset `o`: keep them together.
  while (k > 0 && log[k].o !== undefined && log[k - 1].o === log[k].o) k--;
  return k;
}

/** Lines of a session file (bytes from `start`, whole lines) as chat events, each tagged with its line's offset `o`. */
function parseLines(text: string, start: number, onEvent: (e: ChatEvent) => void, onRec?: (rec: any) => void) {
  let at = start;
  for (const line of text.split("\n")) {
    const o = at;
    at += Buffer.byteLength(line) + 1;
    if (!line.trim()) continue;
    let rec: unknown;
    try {
      rec = JSON.parse(line);
    } catch {
      continue;
    }
    onRec?.(rec);
    for (const e of lineToEvents(rec)) onEvent({ ...e, o });
  }
}

// Keep image names independently of the bulky transcript. A queued paste can finish after
// its socket closes; reconnecting must neither lose it nor attach it to an older image.
const imageHints = new Map<string, {
  pending?: { names: string[]; at: number; after: number };
  attached: Map<number, { id: unknown; names: string[] }>;
}>();

/** One followed session file: its newest events, and who to tell about new ones. */
export class Transcript {
  readonly log: ChatEvent[] = [];
  /** The file offset the in-memory log starts at (a line start); older events are read from the file before it. */
  head = 0;
  private offset = 0;
  /** Raw bytes of the unfinished final line; retaining bytes avoids replacing split UTF-8 code points. */
  private rest: Buffer = Buffer.alloc(0);
  private watcher: FSWatcher | null = null;
  private poll: NodeJS.Timeout | null = null;
  private subs = new Set<(e: ChatEvent) => void>();
  get observed() { return this.subs.size > 0; }
  /** Images the node just pasted in by path: Claude Code stores them as "[Image #1]", so the next such message gets them. */
  private stamp: FileStamp | null = null;
  expectImages(names: string[]) {
    if (!names.length) return;
    const now = Date.now();
    for (const [file, hint] of imageHints) {
      if (hint.pending && now - hint.pending.at >= 120_000) delete hint.pending;
      if (!hint.pending && !hint.attached.size) imageHints.delete(file);
    }
    let after = this.offset;
    try { after = statSync(this.file).size; } catch { /* keep the last known boundary */ }
    const hint = imageHints.get(this.file) ?? { pending: undefined, attached: new Map() };
    hint.pending = { names: [...names], at: now, after };
    imageHints.set(this.file, hint);
  }

  /**
   * Tokens Claude has written since his last message (t-0205, R1.19): the live line's "↓ N tokens" for a terminal
   * agent, as siso-host's `usage` event gives it for an app chat. Summed per API message (its records repeat one usage).
   */
  turnOut = 0;
  private outBy = new Map<string, number>();
  private countOut(rec: any) {
    const id = rec?.message?.id, out = Number(rec?.message?.usage?.output_tokens);
    if (rec?.isSidechain || rec?.type !== "assistant" || !id || !Number.isFinite(out)) return;
    this.outBy.set(id, Math.max(out, this.outBy.get(id) ?? 0));
    this.turnOut = [...this.outBy.values()].reduce((n, v) => n + v, 0);
  }

  readonly file: string;

  constructor(file: string) {
    this.file = file;
    const initial = statSync(file);
    this.stamp = { dev: Number(initial.dev), ino: Number(initial.ino), mtimeMs: initial.mtimeMs, size: initial.size };
    const size = initial.size;
    this.offset = this.head = Math.max(0, size - OPEN_BYTES);
    // Only discard the first chunk when the offset landed inside a line. An exact line boundary is already safe to parse.
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

  /** Read whatever landed since last time (also called by fs.watch and the poll). */
  catchUp() {
    this.read();
  }

  /**
   * The page of events before file offset `before` (a line start): at least `want` events, back to one of his
   * messages where it can, read backwards from the file in growing chunks. `before` comes back as the new line start;
   * 0 means the start of the file.
   */
  older(before: number, want = OLDER_EVENTS): { events: ChatEvent[]; before: number } {
    let start = Math.max(0, Math.min(before, this.offset));
    let events: ChatEvent[] = [];
    let chunk = 256 << 10;
    let fd: number;
    try {
      fd = openSync(this.file, "r");
    } catch {
      return { events, before: 0 };
    }
    try {
      while (start > 0 && (events.length < want || !events.some((e) => e.t === "user"))) {
        const from = Math.max(0, start - chunk);
        const buf = Buffer.alloc(start - from);
        readSync(fd, buf, 0, buf.length, from);
        let cut = 0;
        if (from > 0) {
          const nl = buf.indexOf(10);
          if (nl < 0) {
            chunk *= 2; // one line longer than the chunk (a big tool output): read further back
            continue;
          }
          cut = nl + 1;
        }
        const page: ChatEvent[] = [];
        parseLines(buf.subarray(cut).toString("utf8").replace(/\n$/, ""), from + cut, (e) => page.push(e));
        events = [...page, ...events];
        start = from + cut;
        chunk = Math.min(chunk * 2, 8 << 20);
        if (events.length > want * 4) break;
      }
    } finally {
      closeSync(fd);
    }
    const k = windowStart(events, want, want * 3);
    return { events: events.slice(k), before: k > 0 ? (events[k].o as number) : start };
  }

  private read(skipFirst = false) {
    let current: FileStamp;
    try {
      const st = statSync(this.file);
      current = { dev: Number(st.dev), ino: Number(st.ino), mtimeMs: st.mtimeMs, size: st.size };
    } catch {
      return;
    }
    const prior = this.stamp;
    const replaced = !!prior && (current.dev !== prior.dev || current.ino !== prior.ino || current.size < this.offset || (current.size === this.offset && current.mtimeMs !== prior.mtimeMs));
    const rebuilding = replaced;
    if (rebuilding) {
      this.offset = this.head = 0;
      this.rest = Buffer.alloc(0);
      this.log.length = 0;
      this.outBy.clear();
      this.turnOut = 0;
      skipFirst = false;
    }
    this.stamp = current;
    const size = current.size;
    if (size === this.offset) {
      if (rebuilding) for (const s of this.subs) s({ t: "reset" });
      return;
    }
    const fd = openSync(this.file, "r");
    try {
      const buf = Buffer.alloc(size - this.offset);
      readSync(fd, buf, 0, buf.length, this.offset);
      const restStart = this.offset - this.rest.length;
      this.offset = size;
      let complete = Buffer.concat([this.rest, buf]);
      let start = restStart;
      const end = complete.lastIndexOf(10);
      // Keep bytes until the newline: an append may split a UTF-8 codepoint as well as a JSON line.
      this.rest = Buffer.from(complete.subarray(end + 1));
      complete = end >= 0 ? complete.subarray(0, end) : Buffer.alloc(0);
      if (skipFirst) {
        // Opened mid-file: the first piece is half a line.
        const nl = complete.indexOf(10);
        start += nl + 1;
        complete = nl >= 0 ? complete.subarray(nl + 1) : Buffer.alloc(0);
        this.head = start;
      }
      const text = complete.toString("utf8");
      if (!text) {
        if (rebuilding) for (const s of this.subs) s({ t: "reset" });
        return;
      }
      const out = this.turnOut;
      parseLines(text, start, (e) => {
        if (e.t === "user" && !e.mid && !String(e.text ?? "").includes("<task-notification>")) (this.outBy.clear(), (this.turnOut = 0));
        if (e.t === "user") {
          const hint = imageHints.get(this.file);
          const offset = e.o as number;
          const saved = hint?.attached.get(offset);
          if (saved && saved.id === e.id) e.images = saved.names;
          if (hint?.pending) {
            if (Date.now() - hint.pending.at >= 120_000) delete hint.pending;
            else if (offset >= hint.pending.after && /\[Image #\d+\]/.test(String(e.text))) {
              e.images = hint.pending.names;
              hint.attached.set(offset, { id: e.id, names: hint.pending.names });
              delete hint.pending;
              if (hint.attached.size > KEEP) hint.attached.delete(hint.attached.keys().next().value!);
            }
          }
          if (hint && !hint.pending && !hint.attached.size) imageHints.delete(this.file);
        }
        this.log.push(e);
        if (!rebuilding) for (const s of this.subs) s(e);
      }, (rec) => this.countOut(rec));
      if (!rebuilding && this.turnOut !== out) for (const s of this.subs) s({ t: "usage", out: this.turnOut });
      if (this.log.length > KEEP) {
        let cut = this.log.length - KEEP;
        while (cut < this.log.length && this.log[cut].o === this.log[cut - 1].o) cut++;
        this.log.splice(0, cut);
        this.head = (this.log[0]?.o as number) ?? this.offset;
      }
    } finally {
      closeSync(fd);
    }
    if (rebuilding) for (const s of this.subs) s({ t: "reset" });
  }

  /** Follow the file while anyone listens; stop when the last one leaves. */
  subscribe(fn: (e: ChatEvent) => void): () => void {
    this.subs.add(fn);
    if (!this.watcher) {
      try {
        this.watcher = watch(this.file, () => this.read());
      } catch {
        /* the poll still runs */
      }
      this.poll = setInterval(() => this.read(), 500);
    }
    return () => {
      this.subs.delete(fn);
      if (!this.subs.size) {
        this.watcher?.close();
        this.watcher = null;
        if (this.poll) clearInterval(this.poll);
        this.poll = null;
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
    // Share live viewers, but do not retain every ended/asleep chat ever opened.
    // The caller subscribes synchronously or owns its read-only history itself.
    queueMicrotask(() => { if (!current.observed && open.get(file) === current) open.delete(file); });
  }
  return t;
}

/** A chat source that can read older events back from its file (a Claude session's Transcript). */
type Paged = { head?: number; older?(before: number, want?: number): { events: ChatEv[]; before: number } };

/**
 * Lazy chats (P0 performance, Shaan 2 Oct 17:46: "the app is lagging out we need lazy loading"): a chat opens on its
 * last ~60 events and asks for older ones a page at a time ({t:"older", before}) as he scrolls up. A source that can
 * read its file backwards (a Claude session) answers by byte offset; any other (Codex, siso-host) from the log it
 * already holds, kept by this socket. The newest "commands" list always rides along (the / menu reads it from hello).
 */
export function chatWindow(log: ChatEv[], fileSource: Paged | null) {
  const k = windowStart(log, HELLO_EVENTS);
  const shown = log.slice(k);
  const cmds = log.slice(0, k).filter((e) => e.t === "commands").at(-1);
  if (cmds && !shown.some((e) => e.t === "commands")) shown.unshift(cmds);
  if (fileSource?.older) {
    const before = (shown.find((e) => typeof e.o === "number")?.o as number | undefined) ?? fileSource.head ?? 0;
    return { shown, before, more: before > 0, stash: null };
  }
  return { shown, before: k, more: k > 0, stash: log.slice(0, k) };
}
export function olderPage(m: { before?: unknown }, stash: ChatEv[] | null, fileSource: Paged | null) {
  const before = Math.max(0, Math.floor(Number(m.before) || 0));
  if (fileSource?.older && !stash) {
    const r = fileSource.older(before, OLDER_EVENTS);
    return { t: "older", events: r.events, before: r.before, more: r.before > 0 };
  }
  const list = (stash ?? []).slice(0, before);
  const k = windowStart(list, OLDER_EVENTS);
  return { t: "older", events: list.slice(k), before: k, more: k > 0 };
}
