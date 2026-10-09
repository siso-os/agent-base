/**
 * The HUD of an agent run by siso-host (an SDK seat such as Agent Zero), which has no Claude Code statusline and so no
 * context-ping HUD file (R1.19, Shaan 2 Oct: "where is my approved chat hud input text one"; SPEC-CHAT-HUD bug 4).
 * Read from what the seat already writes: its session file (each main-thread assistant record's usage and model),
 * plus the host's SDK /usage read for account limits. Same-login terminal HUD files supply the context window
 * and serve as a timestamped fallback for older hosts that do not yet write their own limits.
 * The session file is read incrementally (offset kept per file); only lines with "usage" are parsed.
 */
import { closeSync, openSync, readFileSync, readSync, readdirSync, statSync } from "node:fs";
import { open } from "node:fs/promises";
import { setImmediate as yieldIO } from "node:timers/promises";
import path from "node:path";
import { priceOf } from "./tokens.ts";

type Scan = { offset: number; rest: Buffer; ins: Map<string, number>; outs: Map<string, number>; usd: Map<string, number>; ctx: number | null; read: number; all: number; model: string | null };
const scans = new Map<string, Scan>();

function scan(file: string): Scan | null {
  let size: number;
  try {
    size = statSync(file).size;
  } catch {
    return null;
  }
  let s = scans.get(file);
  if (!s || size < s.offset) scans.set(file, (s = { offset: 0, rest: Buffer.alloc(0), ins: new Map(), outs: new Map(), usd: new Map(), ctx: null, read: 0, all: 0, model: null }));
  if (size === s.offset) return s;
  const fd = openSync(file, "r");
  try {
    const buf = Buffer.alloc(size - s.offset);
    readSync(fd, buf, 0, buf.length, s.offset);
    s.offset = size;
    consume(s, buf);
  } finally {
    closeSync(fd);
  }
  return s;
}

/** Keep unfinished records as bytes so a chunk/appended multibyte character is never corrupted. */
function consume(s: Scan, chunk: Buffer) {
  const bytes = Buffer.concat([s.rest, chunk]);
  const end = bytes.lastIndexOf(10);
  s.rest = Buffer.from(bytes.subarray(end + 1));
  if (end < 0) return;
  for (const line of bytes.subarray(0, end).toString("utf8").split("\n")) {
    if (!line.includes('"usage"')) continue;
    let rec: any;
    try {
      rec = JSON.parse(line);
    } catch {
      continue;
    }
    const u = rec?.message?.usage;
    if (rec?.type !== "assistant" || rec.isSidechain || !u) continue;
    const read = Number(u.cache_read_input_tokens) || 0, all = read + (Number(u.cache_creation_input_tokens) || 0) + (Number(u.input_tokens) || 0);
    const id = String(rec.message.id ?? rec.uuid);
    // One API message is written as several records repeating its usage: count it once.
    s.ins.set(id, all);
    s.outs.set(id, Math.max(Number(u.output_tokens) || 0, s.outs.get(id) ?? 0));
    // This chat's cost at API prices, as the Tokens page prices it (an SDK seat's result has no cost line of its own).
    const pr = typeof rec.message.model === "string" ? priceOf(rec.message.model) : null;
    if (pr) s.usd.set(id, ((Number(u.input_tokens) || 0) * pr.in + (Number(u.cache_creation_input_tokens) || 0) * pr.cw + read * pr.cr + (s.outs.get(id) ?? 0) * pr.out) / 1e6);
    if (all > 0) (s.ctx = all), (s.read = read), (s.all = all);
    if (typeof rec.message.model === "string" && rec.message.model.startsWith("claude")) s.model = rec.message.model;
  }
}

const pending = new Map<string, Promise<void>>();
const stamps = new Map<string, { dev: number; ino: number; size: number; mtimeMs: number }>();
/** The fleet can paint while accounting catches up. Publish complete snapshots; one read per file at a time. */
function backgroundScan(file: string): Scan | null {
  if (!pending.has(file)) {
    const task = (async () => {
      const fd = await open(file, "r");
      try {
        const st = await fd.stat(), stamp = stamps.get(file), previous = scans.get(file);
        const same = stamp && st.dev === stamp.dev && st.ino === stamp.ino && st.size >= stamp.size &&
          (st.size !== stamp.size || st.mtimeMs === stamp.mtimeMs);
        if (same && previous?.offset === st.size) return;
        const s: Scan = same && previous ? { ...previous, ins: new Map(previous.ins), outs: new Map(previous.outs), usd: new Map(previous.usd) }
          : { offset: 0, rest: Buffer.alloc(0), ins: new Map(), outs: new Map(), usd: new Map(), ctx: null, read: 0, all: 0, model: null };
        const buf = Buffer.alloc(256 << 10);
        while (s.offset < st.size) {
          const { bytesRead } = await fd.read(buf, 0, Math.min(buf.length, st.size - s.offset), s.offset);
          if (!bytesRead) throw new Error("Session changed during HUD read");
          consume(s, buf.subarray(0, bytesRead));
          s.offset += bytesRead;
          await yieldIO();
        }
        // Replacement/truncation while scanning must not publish the old file's accounting.
        const current = statSync(file);
        if (current.dev !== st.dev || current.ino !== st.ino || current.size < st.size ||
            (current.size === st.size && current.mtimeMs !== st.mtimeMs)) return;
        scans.set(file, s);
        stamps.set(file, { dev: st.dev, ino: st.ino, size: st.size, mtimeMs: st.mtimeMs });
      } finally { await fd.close(); }
    })().catch(() => { /* A missing/changing file retains the last completed HUD; retry on the next refresh. */ })
      .finally(() => pending.delete(file));
    pending.set(file, task);
  }
  return scans.get(file) ?? null;
}

export type SeatLimits = {
  five_hour: { used_percentage: number; resets_at: string | null };
  seven_day: { used_percentage: number; resets_at: string | null };
  at: number;
};
type Peer = { profile: string | null; model: string | null; window: number | null; fiveHour: unknown; week: unknown; at: number };
let peers: { at: number; list: Peer[] } = { at: 0, list: [] };
/** The newest HUD files (at most 60), re-read every 20 s. */
function peerFiles(ctxDir: string): Peer[] {
  if (Date.now() - peers.at < 20_000) return peers.list;
  let files: { f: string; m: number }[] = [];
  try {
    files = readdirSync(ctxDir)
      .filter((f) => f.endsWith(".json"))
      .map((f) => ({ f: path.join(ctxDir, f), m: statSync(path.join(ctxDir, f)).mtimeMs }))
      .sort((a, b) => b.m - a.m)
      .slice(0, 60);
  } catch {
    /* no HUD files on this machine */
  }
  const list: Peer[] = [];
  for (const { f, m } of files) {
    try {
      const d = JSON.parse(readFileSync(f, "utf8"));
      list.push({ profile: d.profile ?? null, model: d.model?.id ?? null, window: Number(d.context_window_size) || null, fiveHour: d.rate_limits?.five_hour, week: d.rate_limits?.seven_day, at: Number(d.at) || m });
    } catch {
      /* half-written */
    }
  }
  peers = { at: Date.now(), list };
  return list;
}

/** "claude-opus-5-5[1m]" → "Opus 5.5", the family and version as the HUD writes them. */
const pretty = (id: string) => {
  const m = id.replace(/\[.*$/, "").match(/^claude-([a-z]+)-(\d+)(?:-(\d{1,2}))?/);
  return m ? `${m[1][0].toUpperCase()}${m[1].slice(1)} ${m[2]}${m[3] ? `.${m[3]}` : ""}` : id;
};

/**
 * The statusline-shaped HUD for a seat's session file (the same fields the context-ping file gives `readHud`), or null
 * when the file has no usage yet. `model` is the seat's own model id when it says (siso-host's init), else the file's.
 */
export function seatHud(file: string, ctxDir: string, model?: string | null, reported?: SeatLimits | null, opts: { background?: boolean } = {}) {
  const s = opts.background ? backgroundScan(file) : scan(file);
  if (!s || (s.ctx === null && !s.model)) return null;
  const profile = file.includes(`${path.sep}projects${path.sep}`) ? file.slice(0, file.indexOf(`${path.sep}projects${path.sep}`)) : null;
  const all = peerFiles(ctxDir);
  const mine = all.filter((p) => p.profile === profile);
  const pool = mine.length ? mine : all;
  const id = model ?? s.model;
  const base = id?.replace(/\[.*$/, "");
  // The window: the id says 1M, or a terminal Claude on this login runs the same model with its window, or the
  // context already passed 200k (so it can only be the 1M one).
  const window = id && /\[1m\]/i.test(id) ? 1_000_000 : (pool.find((p) => base && p.model?.startsWith(base) && p.window)?.window ?? ((s.ctx ?? 0) > 200_000 ? 1_000_000 : null));
  // Never borrow a different login's limits. Prefer the SDK's account read over statusline files.
  const borrowed = mine.find((p) => p.fiveHour || p.week);
  const limits = reported && Number.isFinite(reported.at) ? reported : borrowed
    ? { five_hour: borrowed.fiveHour, seven_day: borrowed.week, at: borrowed.at } : undefined;
  return {
    used_percentage: window && s.ctx !== null ? Math.round((s.ctx / window) * 100) : null,
    model: id ? { id, display_name: `${pretty(id)}${window === 1_000_000 ? " (1M context)" : ""}` } : null,
    total_input_tokens: [...s.ins.values()].reduce((n, v) => n + v, 0),
    total_output_tokens: [...s.outs.values()].reduce((n, v) => n + v, 0),
    current_usage: { cache_read_input_tokens: s.read, input_tokens: s.all - s.read },
    cost: s.usd.size ? { total_cost_usd: [...s.usd.values()].reduce((n, v) => n + v, 0) } : undefined,
    rate_limits: limits,
    at: limits?.at ?? null,
  };
}
