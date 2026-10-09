import { usageAccounts } from "./claude-usage.ts";
/**
 * Tokens: what every account on this machine has spent, per hour, read from the session files in place (Shaan, 2 Oct:
 * "i like to see per account and total how many i spent today this week this month and just all the stats … i like the
 * global token leaderboard and the achievements and all that cool shit"). Spec:
 * siso-internal-labs-agents/.agents/research/2026-10-01-agent-app/tokens/SPEC.md
 *
 *   GET /api/tokens   per account and overall: today / this week / this month / all time, a 30-day daily series, an
 *                     hour-of-day series, the latest 5h and weekly limits, estimated cost, and local achievements.
 *
 * Read-only over the session files; the one thing it writes is its own cache file (below). It never returns chat text,
 * keys or cookies, only counts.
 *
 * Where the numbers come from:
 *   - Claude: every profile's session JSONL (~/.claude/projects, ~/.claude-siso/projects, ~/.config/claude-* /projects).
 *     ~/.claude-siso/projects is a symlink to ~/.claude/projects, so folders are counted once by realpath. A message is
 *     counted once, by message id + request id (ccusage's rule), at the hour of its timestamp.
 *   - Which account: a folder only one profile uses is that profile's. The shared folder (~/.claude + ~/.claude-siso) is
 *     split per session by, in order: (1) the prompt timeline, when the session's prompts appear in both profiles'
 *     history.jsonl (each reply goes to the profile of the latest prompt before it); (2) the status-line HUD file
 *     ~/.local/state/context-ping/ctx/<session>.json (`profile`); (3) the one profile that has any trace of the session
 *     (history.jsonl, session-env/<id>, file-history/<id>). Anything else is "unattributed", and the payload says how
 *     many tokens each method credited.
 *   - Codex: ~/.codex/sessions/** and ~/.codex/archived_sessions (`token_count` events; `last_token_usage` per request,
 *     skipping repeats of an unchanged running total). Its 5h/weekly limits come from the newest event's `rate_limits`.
 *   - Models that are not the account's own provider (DeepSeek and friends routed through Claude Code or Codex) go to
 *     their own "other" account: they did not spend a Claude or ChatGPT subscription.
 *   - Claude 5h/weekly limits: the newest HUD file per profile (`rate_limits`); live OAuth usage overlays these fallback readings.
 *   - Whose account (servers-tokens spec G12): the login map in ~/.local/bin/claude-credits (`LOGINS`, AB_CREDITS_BIN),
 *     read as text: claude-siso is fuzeheritage, claude-siso-3 lordsisodia. A login that is not Shaan's (plain ~/.claude
 *     is Fahmy's) is `person.mine: false` and is left out of every total; the page names it in one line.
 *   - Codex credits (G15): the newest token_count event's `rate_limits.credits` (balance), beside its used percent.
 *
 * Speed: files are read incrementally (state per inode: offset and the unfinished last line), so the first scan reads
 * everything once (a few seconds for ~15 GB) and later scans read only new bytes. A request answers from the last scan
 * and starts a fresh one in the background when it is over 60 s old. Each file read awaits between 8 MB chunks, so the
 * event loop is never held for long. Only lines carrying a marker ("usage", "token_count", ...) are parsed.
 *
 * Cache (t-0043, "the tokens page takes way too long to load"): the answer is one JSON string, rebuilt at most once a
 * minute (or when the local day turns), and the last one is kept on disk next to rows.json (counts only, the same
 * payload the page gets). A node that has just started answers from that file at once, marked `cached` and `scanning`,
 * while its first scan runs, so the page never waits on the first read of every session file.
 *
 * Hours follow local hour boundaries, retaining distinct instants when the clock repeats an hour. Calendar ranges
 * therefore also split correctly at midnight in half-hour and quarter-hour time zones.
 */
import { type Stats, readFileSync, readdirSync, realpathSync, existsSync } from "node:fs";
import { mkdir, open, readdir, rename, stat, writeFile } from "node:fs/promises";
import type http from "node:http";
import os from "node:os";
import path from "node:path";

/*
 * MIT License
 * Copyright (c) 2026 xiufengsun
 * Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated
 * documentation files (the "Software"), to deal in the Software without restriction, including without limitation
 * the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and
 * to permit persons to whom the Software is furnished to do so, subject to the following conditions: The above
 * copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO
 * THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT,
 * TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
 */

const HOME = process.env.AB_HOME ?? os.homedir();
const HUD_DIR = process.env.AB_HUD_DIR ?? path.join(HOME, ".local/state/context-ping/ctx");
const CODEX_HOME = process.env.AB_CODEX_HOME ?? process.env.CODEX_HOME ?? path.join(HOME, ".codex");
const H = 3_600_000;
const DAY = 86_400_000;

// ---------------------------------------------------------------- pricing
//
// Estimated cost, ccusage-style: per-model $/million tokens for input, output, cache write (5 min), cache read; a 1 h
// cache write costs 2x input, a 5 min write 1.25x. Source: Anthropic's published API prices as carried in the bundled
// claude-api skill's model table (shared/models.md, shared/prompt-caching.md, cached 2026-09-25), the same first-party
// rates ccusage pulls from LiteLLM's model_prices_and_context_window.json. This is list price for API use, not what a
// subscription bills: read it as "what this would have cost on the API". OpenAI/Codex and DeepSeek models are left
// unpriced (their tokens are counted and reported as `unpricedTokens`), rather than guessed.
type Price = { in: number; out: number; cw: number; cr: number };
const p = (inp: number, out: number, cr: number): Price => ({ in: inp, out, cw: inp * 1.25, cr });
const INLINE_PRICES: [RegExp, Price][] = [
  [/fable-5-1|mythos-5-1/, p(10, 50, 0.25)],
  [/fable-5|mythos-5/, p(10, 50, 1)],
  [/opus-5-5/, p(4, 20, 0.2)],
  [/opus-5|opus-4-[5-9]/, p(5, 25, 0.5)],
  [/opus-4/, p(15, 75, 1.5)],
  [/sonnet-5/, p(2, 10, 0.2)],
  [/sonnet-4/, p(3, 15, 0.3)],
  [/haiku-4-5/, p(1, 5, 0.1)],
  [/haiku/, p(0.8, 4, 0.08)],
];
/** Bare aliases Claude Code writes for some sub-agents: the current model of that family. */
const INLINE_ALIAS: Record<string, string> = { opus: "claude-opus-5-5", sonnet: "claude-sonnet-5-5", haiku: "claude-haiku-4-5", fable: "claude-fable-5-1" };
/**
 * The one price table (EFFICIENCY 16:07): siso-harness-lab/config/prices.json, read once at start, so this and the
 * spend ledger never drift. A missing or unreadable file keeps the inline table above.
 */
const PRICES_FILE = process.env.AB_PRICES ?? path.join(HOME, "SISO_Workspace/SISO_Agents/siso-harness-lab/config/prices.json");
function loadPrices(): { prices: [RegExp, Price][]; alias: Record<string, string>; from: string } {
  try {
    const d = JSON.parse(readFileSync(PRICES_FILE, "utf8"));
    const prices = (d.claude as { match: string; in: number; out: number; cw5m?: number; cr: number }[]).map((r): [RegExp, Price] => [new RegExp(r.match), { in: r.in, out: r.out, cw: r.cw5m ?? r.in * 1.25, cr: r.cr }]);
    if (!prices.length || prices.some(([, x]) => ![x.in, x.out, x.cw, x.cr].every(Number.isFinite))) throw new Error("bad rows");
    return { prices, alias: { ...INLINE_ALIAS, ...(d.aliases ?? {}) }, from: PRICES_FILE };
  } catch {
    return { prices: INLINE_PRICES, alias: INLINE_ALIAS, from: "inline" };
  }
}
const loaded = loadPrices();
const PRICES = loaded.prices;
const ALIAS = loaded.alias;
export const PRICES_FROM = loaded.from;
const normModel = (m: string) => {
  const base = m.replace(/\[[^\]]*\]$/, "").trim();
  return ALIAS[base] ?? base;
};
const priceCache = new Map<string, Price | null>();
export function priceOf(model: string): Price | null {
  if (priceCache.has(model)) return priceCache.get(model)!;
  const hit = model.startsWith("claude-") ? (PRICES.find(([re]) => re.test(model))?.[1] ?? null) : null;
  priceCache.set(model, hit);
  return hit;
}
const isClaudeModel = (m: string) => m.startsWith("claude-") && !m.includes("gpt");
const isOpenAiModel = (m: string) => /^(gpt-|codex|o[1-9]|chatgpt)/.test(m);

// ---------------------------------------------------------------- the store

type Sum = { input: number; output: number; cacheRead: number; cacheWrite: number; total: number; cost: number; unpricedTokens: number; messages: number };
const zero = (): Sum => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0, cost: 0, unpricedTokens: 0, messages: 0 });
function addTo(a: Sum, b: Sum) {
  a.input += b.input;
  a.output += b.output;
  a.cacheRead += b.cacheRead;
  a.cacheWrite += b.cacheWrite;
  a.total += b.total;
  a.cost += b.cost;
  a.unpricedTokens += b.unpricedTokens;
  a.messages += b.messages;
}

/** account -> local hour boundary (epoch ms) -> sums */
const buckets = new Map<string, Map<number, Sum>>();
/** account -> model -> all-time sums */
const models = new Map<string, Map<string, Sum>>();
/** account -> local hour -> model sums; build applies the same calendar ranges as token totals. */
const modelHours = new Map<string, Map<number, Map<string, Sum>>>();
/** project -> hour -> tokens (TokenTracker's project badges) */
const projectHours = new Map<string, Map<number, number>>();
/** how many tokens each attribution method credited */
const methods = new Map<string, number>();
const sources = new Set<string>();
/** Dedupe keys, as 53-bit hashes (millions of messages would cost ~150 MB as strings). */
const seen = new Set<number>();

function hash53(s: string): number {
  let h1 = 0xdeadbeef,
    h2 = 0x41c6ce57;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

function record(account: string, model: string, t: number, s: Sum, project: string | null, method: string) {
  const offset = -new Date(t).getTimezoneOffset() * 60_000;
  const hour = Math.floor((t + offset) / H) * H - offset;
  let a = buckets.get(account);
  if (!a) buckets.set(account, (a = new Map()));
  let b = a.get(hour);
  if (!b) a.set(hour, (b = zero()));
  addTo(b, s);
  let m = models.get(account);
  if (!m) models.set(account, (m = new Map()));
  let mm = m.get(model);
  if (!mm) m.set(model, (mm = zero()));
  addTo(mm, s);
  let mh = modelHours.get(account);
  if (!mh) modelHours.set(account, (mh = new Map()));
  let hm = mh.get(hour);
  if (!hm) mh.set(hour, (hm = new Map()));
  let ms = hm.get(model);
  if (!ms) hm.set(model, (ms = zero()));
  addTo(ms, s);
  methods.set(method, (methods.get(method) ?? 0) + s.total);
  if (project) {
    let ph = projectHours.get(project);
    if (!ph) projectHours.set(project, (ph = new Map()));
    ph.set(hour, (ph.get(hour) ?? 0) + s.total);
  }
}

/**
 * A project key from a working directory: the nearest folder above it holding a .git (a worktree counts as its repo),
 * else the folder itself. Temp and scratch folders are not projects. Looked up once per folder.
 */
const projectCache = new Map<string, string | null>();
function projectOf(cwd: unknown): string | null {
  if (typeof cwd !== "string" || !cwd) return null;
  const hit = projectCache.get(cwd);
  if (hit !== undefined) return hit;
  let key: string | null = null;
  if (!/^\/(private\/)?(tmp|var\/folders)\//.test(cwd)) {
    const dir = cwd.replace(/\/\.claude\/worktrees\/[^/]+.*$/, "").replace(/\/_data\/worktrees\/([^/]+)\/[^/]+.*$/, "/$1");
    key = dir;
    for (let d = dir; d.length > HOME.length && d !== "/"; d = path.dirname(d)) {
      if (existsSync(path.join(d, ".git"))) {
        key = d;
        break;
      }
    }
  }
  projectCache.set(cwd, key);
  return key;
}

// ---------------------------------------------------------------- whose login each profile is

type Person = { email: string | null; label: string; mine: boolean };
const CREDITS_BIN = process.env.AB_CREDITS_BIN ?? path.join(HOME, ".local/bin/claude-credits");

/**
 * claude-credits' `LOGINS` map, read as text (a Python dict or a shell array): profile -> email, or a note for a login
 * that is not Shaan's ("Fahmy: never read or used"). Only the profile names and emails are kept; nothing else is read.
 */
export function loginMap(file = CREDITS_BIN): Map<string, Person> {
  const out = new Map<string, Person>();
  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    return out;
  }
  const at = text.search(/\bLOGINS\b\s*(?::[^=]*)?=/);
  if (at < 0) return out;
  const body = text.slice(at, at + 4000);
  const open = body.search(/[{(\[]/);
  if (open < 0) return out;
  let depth = 0;
  let end = body.length;
  for (let i = open; i < body.length; i++) {
    if ("{([".includes(body[i])) depth++;
    else if ("})]".includes(body[i]) && --depth === 0) {
      end = i;
      break;
    }
  }
  const block = body.slice(open + 1, end);
  for (const m of block.matchAll(/\[?\s*["']?([.\w-]+)["']?\s*\]?\s*[:=]\s*(\{[^}]*\}|\([^)]*\)|["'][^"'\n]*["']|[^\s,)}\]]+)/g)) {
    const key = m[1].replace(/^\./, "");
    const v = m[2];
    const email = v.match(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/)?.[0] ?? null;
    const note = v.replace(/^[{("']|[})"']$/g, "").trim();
    const notMine = !email || /never|not (?:his|mine|ours)|fahmy/i.test(note);
    const label = email ? email.split("@")[0] : (note.match(/^[A-Za-z][\w-]*/)?.[0] ?? key);
    out.set(key, { email, label: /fahmy/i.test(note) ? "Fahmy" : label, mine: !notMine });
  }
  return out;
}

// ---------------------------------------------------------------- Claude profiles and attribution

type Profile = { id: string; label: string; dir: string };
type Root = { dir: string; profiles: Profile[]; kind: "claude" | "codex" };

export function claudeUsageDirs(): string[] { return claudeProfiles().map(profile => profile.dir); }
function claudeProfiles(): Profile[] {
  const out: Profile[] = [];
  for (const d of [".claude", ".claude-siso"]) if (existsSync(path.join(HOME, d))) out.push({ id: d, label: `~/${d}`, dir: path.join(HOME, d) });
  try {
    for (const d of readdirSync(path.join(HOME, ".config")).sort()) {
      if (d.startsWith("claude-") && existsSync(path.join(HOME, ".config", d, "projects"))) out.push({ id: d, label: `~/.config/${d}`, dir: path.join(HOME, ".config", d) });
    }
  } catch {
    /* no ~/.config */
  }
  return out;
}

/** Read only wrapper text needed to identify its Claude profile; never expose wrapper contents. */
export function claudeCommands(binDir: string, profiles: Profile[]): Map<string, string> {
  const commands = new Map<string, string>();
  let files: string[];
  try { files = readdirSync(binDir).filter((f) => f.startsWith("claude-") && !f.includes(".disabled")); }
  catch { return commands; }
  for (const file of files.sort()) {
    let source: string;
    try { source = readFileSync(path.join(binDir, file), "utf8"); } catch { continue; }
    // Accept only simple assignment values for the relevant identifiers. Other wrapper text is discarded.
    const values = [...source.matchAll(/^\s*(?:export\s+)?(CLAUDE_CONFIG_DIR|CLAUDE_PROFILE|CLAUDE_ACCOUNT)\s*=\s*["']?([^\s"'`;]+)["']?\s*;?\s*$/gm)];
    for (const [, key, value] of values) {
      if (!value) continue;
      const normalized = value.replace(/^\$HOME\//, "").replace(/^~\//, "").replace(/\/+$/, "");
      const match = profiles.find((p) => key === "CLAUDE_CONFIG_DIR"
        ? normalized === p.id || normalized === path.relative(HOME, p.dir) || path.basename(normalized) === p.id
        : normalized === p.id || normalized === p.label || normalized === path.basename(p.id));
      if (match) { commands.set(match.id, file); break; }
    }
  }
  return commands;
}

function roots(): Root[] {
  const byReal = new Map<string, Root>();
  for (const pr of claudeProfiles()) {
    const dir = path.join(pr.dir, "projects");
    let real: string;
    try {
      real = realpathSync(dir);
    } catch {
      continue;
    }
    const r = byReal.get(real);
    if (r) r.profiles.push(pr);
    else byReal.set(real, { dir: real, profiles: [pr], kind: "claude" });
  }
  const out = [...byReal.values()];
  for (const d of ["sessions", "archived_sessions"]) if (existsSync(path.join(CODEX_HOME, d))) out.push({ dir: path.join(CODEX_HOME, d), profiles: [], kind: "codex" });
  return out;
}

/** Per profile: every session id it has a trace of, and the prompt timeline (session -> [time, ...]). */
type Trace = { ids: Set<string>; prompts: Map<string, number[]>; histOffset: number; histIno: number; histCarry: string };
const traces = new Map<string, Trace>();
/** Status-line HUD files: session -> profile id, and the newest rate limits per profile. */
let hudProfile = new Map<string, string>();
let hudLimits = new Map<string, { fiveHour: Limit | null; weekly: Limit | null; at: number }>();
type Limit = { usedPct: number; resetsAt: number | null };

async function refreshTraces(profiles: Profile[]) {
  for (const pr of profiles) {
    let tr = traces.get(pr.id);
    if (!tr) traces.set(pr.id, (tr = { ids: new Set(), prompts: new Map(), histOffset: 0, histIno: 0, histCarry: "" }));
    for (const d of ["session-env", "file-history"]) {
      try {
        for (const id of await readdir(path.join(pr.dir, d))) tr.ids.add(id);
      } catch {
        /* none */
      }
    }
    // history.jsonl: only sessionId and timestamp are kept; the prompt text is parsed past and dropped.
    const hf = path.join(pr.dir, "history.jsonl");
    try {
      const st = await stat(hf);
      if (st.ino !== tr.histIno || st.size < tr.histOffset) {
        tr.histIno = st.ino;
        tr.histOffset = 0;
        tr.histCarry = "";
      }
      if (st.size > tr.histOffset) {
        const fh = await open(hf, "r");
        try {
          const buf = Buffer.allocUnsafe(st.size - tr.histOffset);
          const { bytesRead } = await fh.read(buf, 0, buf.length, tr.histOffset);
          tr.histOffset += bytesRead;
          const text = tr.histCarry + buf.toString("utf8", 0, bytesRead);
          const cut = text.lastIndexOf("\n");
          tr.histCarry = text.slice(cut + 1);
          for (const line of text.slice(0, cut + 1).split("\n")) {
            if (!line) continue;
            try {
              const o = JSON.parse(line);
              if (typeof o.sessionId !== "string") continue;
              tr.ids.add(o.sessionId);
              const t = Number(o.timestamp);
              if (Number.isFinite(t)) {
                let arr = tr.prompts.get(o.sessionId);
                if (!arr) tr.prompts.set(o.sessionId, (arr = []));
                arr.push(t);
              }
            } catch {
              /* a torn line */
            }
          }
        } finally {
          await fh.close();
        }
      }
    } catch {
      /* no history */
    }
  }
}

function refreshHud(profiles: Profile[]) {
  const byDir = new Map(profiles.map((pr) => [pr.dir, pr.id]));
  const prof = new Map<string, string>();
  const lim = new Map<string, { fiveHour: Limit | null; weekly: Limit | null; at: number }>();
  let failed = false;
  let names: string[] = [];
  try {
    names = readdirSync(HUD_DIR).filter((n) => n.endsWith(".json"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") failed = true;
    /* a missing HUD directory is an empty, valid state */
  }
  for (const n of names) {
    let o: any;
    try {
      o = JSON.parse(readFileSync(path.join(HUD_DIR, n), "utf8"));
    } catch {
      failed = true;
      continue;
    }
    const id = typeof o?.profile === "string" ? byDir.get(o.profile.replace(/\/+$/, "")) : undefined;
    if (!id) continue;
    prof.set(n.slice(0, -5), id);
    const rl = o.rate_limits;
    const at = Number(o.at) || 0;
    if (rl && at > (lim.get(id)?.at ?? -1)) {
      const conv = (x: any): Limit | null => (x && Number.isFinite(Number(x.used_percentage)) ? { usedPct: Number(x.used_percentage), resetsAt: x.resets_at ? Number(x.resets_at) * 1000 : null } : null);
      lim.set(id, { fiveHour: conv(rl.five_hour), weekly: conv(rl.seven_day), at });
    }
  }
  const fingerprint = JSON.stringify([...prof].sort(([a], [b]) => a.localeCompare(b)));
  return { prof, lim, fingerprint, failed };
}

/** Which profile a Claude message in a shared folder belongs to, and how that was decided. */
function attribute(root: Root, sid: string, t: number): [string, string] {
  if (root.profiles.length === 1) return [root.profiles[0].id, "own folder"];
  const cands = root.profiles.map((pr) => pr.id);
  const withPrompts = cands.filter((id) => traces.get(id)?.prompts.has(sid));
  if (withPrompts.length > 1) {
    let best: string | null = null,
      bestT = -Infinity,
      first: string | null = null,
      firstT = Infinity;
    for (const id of withPrompts) {
      for (const pt of traces.get(id)!.prompts.get(sid)!) {
        if (pt <= t && pt > bestT) [best, bestT] = [id, pt];
        if (pt < firstT) [first, firstT] = [id, pt];
      }
    }
    return [best ?? first!, "prompt timeline"];
  }
  const hud = hudProfile.get(sid);
  if (hud && cands.includes(hud)) return [hud, "HUD file"];
  const traced = cands.filter((id) => traces.get(id)?.ids.has(sid));
  if (traced.length === 1) return [traced[0], "profile trace"];
  return ["unattributed", "unattributed"];
}

// ---------------------------------------------------------------- reading files

type FileState = { offset: number; carry: Buffer; ctx: any };
/** Keyed by device:inode, so a file moved (e.g. Codex archiving a session) is not read twice. */
const files = new Map<string, FileState>();

async function walk(dir: string, out: string[], depth = 0): Promise<boolean> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ENOENT";
  }
  let complete = true;
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory() && depth < 6 && !(await walk(p, out, depth + 1))) complete = false;
    else if (e.isFile() && e.name.endsWith(".jsonl")) out.push(p);
  }
  return complete;
}

/**
 * Hand every complete line of `buf` whose head (first `head` bytes) holds one of the markers to `onLine`, and return
 * where the last full line ends. Only the head is searched: a Claude reply line names its role in its first ~200 bytes
 * and a Codex event its type in its first ~100, so the tool output that is ~90% of the bytes is never decoded.
 */
function scanHeads(buf: Buffer, markers: Buffer[], head: number, onLine: (line: string) => void): number {
  let s = 0;
  for (let e = buf.indexOf(10, s); e !== -1; e = buf.indexOf(10, s)) {
    if (e - s > 20) {
      const h = buf.subarray(s, Math.min(e, s + head));
      for (const m of markers) {
        if (h.indexOf(m) !== -1) {
          onLine(buf.toString("utf8", s, e));
          break;
        }
      }
    }
    s = e + 1;
  }
  return s;
}

const M_CLAUDE = [Buffer.from('"role":"assistant"')];
const M_CODEX = [Buffer.from('"type":"token_count"'), Buffer.from('"type":"turn_context"'), Buffer.from('"type":"session_meta"')];

/** The JSON object that opens at `at` (a "{"), as text: string-aware brace matching. */
function objectAt(s: string, at: number): string | null {
  let depth = 0,
    inStr = false;
  for (let i = at; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (inStr) {
      if (c === 92) i++;
      else if (c === 34) inStr = false;
    } else if (c === 34) inStr = true;
    else if (c === 123) depth++;
    else if (c === 125 && --depth === 0) return s.slice(at, i + 1);
  }
  return null;
}
const lastStr = (s: string, key: string) => {
  const i = s.lastIndexOf(`"${key}":"`);
  if (i < 0) return undefined;
  const from = i + key.length + 4;
  const to = s.indexOf('"', from);
  return to < 0 ? undefined : s.slice(from, to);
};

/**
 * The few fields a reply line needs, without parsing its content (the costly ~all of it): the message's model and id
 * from its head, the usage object after the last "stop_reason" (content comes before it), and the top-level fields, which follow the message so their last
 * occurrence is theirs. Any surprise falls back to a full JSON.parse.
 */
function claudeFields(line: string): any {
  const mi = line.indexOf('"message":{');
  const sr = line.lastIndexOf('"stop_reason":');
  const ui = sr < 0 ? -1 : line.indexOf('"usage":{', sr);
  if (mi >= 0 && ui > mi) {
    const head = line.slice(mi, mi + 600);
    const model = /"model":"([^"]*)"/.exec(head)?.[1];
    const id = /"id":"([^"]*)"/.exec(head)?.[1];
    const ut = objectAt(line, ui + 8);
    const timestamp = lastStr(line, "timestamp");
    if (model && ut && timestamp) {
      try {
        const usage = JSON.parse(ut);
        if (Number.isFinite(usage.input_tokens) && Number.isFinite(usage.output_tokens)) {
          return { type: "assistant", timestamp, requestId: lastStr(line, "requestId"), sessionId: lastStr(line, "sessionId"), cwd: lastStr(line, "cwd"), message: { model, id, usage } };
        }
      } catch {
        /* fall through */
      }
    }
  }
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

function claudeLine(root: Root, file: string, line: string) {
  const o = claudeFields(line);
  const m = o?.message;
  const u = m?.usage;
  if (!u || o.type === "summary") return;
  const t = Date.parse(o.timestamp);
  if (!Number.isFinite(t)) return;
  if (m.id) {
    const k = hash53(`${m.id}:${o.requestId ?? ""}`);
    if (seen.has(k)) return;
    seen.add(k);
  }
  const model = normModel(String(m.model ?? "unknown"));
  if (model === "<synthetic>") return;
  const s = zero();
  s.input = u.input_tokens ?? 0;
  s.output = u.output_tokens ?? 0;
  s.cacheRead = u.cache_read_input_tokens ?? 0;
  s.cacheWrite = u.cache_creation_input_tokens ?? 0;
  s.total = s.input + s.output + s.cacheRead + s.cacheWrite;
  s.messages = 1;
  if (s.total === 0) return;
  const pr = priceOf(model);
  if (pr) {
    const w1h = u.cache_creation?.ephemeral_1h_input_tokens ?? 0;
    const w5m = s.cacheWrite - w1h;
    const usd = (s.input * pr.in + s.output * pr.out + s.cacheRead * pr.cr + w5m * pr.cw + w1h * pr.in * 2) / 1e6;
    s.cost = u.speed === "fast" ? usd * 2 : usd;
  } else s.unpricedTokens = s.total;
  // A sub-agent's file sits in <project>/<session>/subagents/: it belongs to the parent session.
  const rel = path.relative(root.dir, file).split(path.sep);
  const sid = typeof o.sessionId === "string" ? o.sessionId : rel.length > 2 ? rel[1] : path.basename(file, ".jsonl");
  if (!isClaudeModel(model)) {
    sources.add("claude-code");
    record("other", model, t, s, projectOf(o.cwd), "other provider");
    return;
  }
  sources.add("claude-code");
  const [acct, how] = attribute(root, sid, t);
  record(`claude:${acct}`, model, t, s, projectOf(o.cwd), how);
}

type Credits = { balance: number | null; hasCredits: boolean | null; unlimited: boolean | null };
/** Missing or malformed readings are unknown; only an explicit numeric zero means zero credits. */
export function creditBalance(value: unknown): number | null {
  if (typeof value !== "number" && (typeof value !== "string" || value.trim() === "")) return null;
  const balance = Number(value);
  return Number.isFinite(balance) ? balance : null;
}
let codexLimits: { fiveHour: Limit | null; weekly: Limit | null; at: number; plan: string | null; credits: Credits | null } | null = null;

/** The newest Codex event's credit balance, for /api/tokens/money (tokens-money.ts). */
export function codexCredits(): { balance: number | null; hasCredits: boolean | null; unlimited: boolean | null; at: number; plan: string | null; weeklyResetsAt: number | null; weeklyUsedPct: number | null } | null {
  const c = codexLimits;
  if (!c?.credits) return null;
  return { balance: c.credits.balance, hasCredits: c.credits.hasCredits, unlimited: c.credits.unlimited, at: c.at, plan: c.plan, weeklyResetsAt: c.weekly?.resetsAt ?? null, weeklyUsedPct: c.weekly?.usedPct ?? null };
}

function codexLine(st: FileState, line: string) {
  let o: any;
  try {
    o = JSON.parse(line);
  } catch {
    return;
  }
  const pl = o?.payload;
  if (!pl) return;
  const ctx = (st.ctx ??= { model: "unknown", cwd: null, lastTotal: -1 });
  if (o.type === "session_meta") {
    ctx.cwd = pl.cwd ?? ctx.cwd;
    return;
  }
  if (o.type === "turn_context") {
    if (pl.model) ctx.model = String(pl.model);
    if (pl.cwd) ctx.cwd = pl.cwd;
    return;
  }
  if (pl.type !== "token_count") return;
  const t = Date.parse(o.timestamp);
  if (!Number.isFinite(t)) return;
  const rl = pl.rate_limits;
  if (rl && (!codexLimits || t >= codexLimits.at)) {
    const cr = rl.credits;
    const credits: Credits | null = cr && typeof cr === "object" ? { balance: creditBalance(cr.balance), hasCredits: typeof cr.has_credits === "boolean" ? cr.has_credits : null, unlimited: typeof cr.unlimited === "boolean" ? cr.unlimited : null } : null;
    const lim: NonNullable<typeof codexLimits> = { fiveHour: null, weekly: null, at: t, plan: rl.plan_type ?? null, credits };
    for (const w of [rl.primary, rl.secondary]) {
      if (!w || !Number.isFinite(Number(w.used_percent))) continue;
      const l = { usedPct: Number(w.used_percent), resetsAt: w.resets_at ? Number(w.resets_at) * 1000 : w.resets_in_seconds ? t + Number(w.resets_in_seconds) * 1000 : null };
      if (Number(w.window_minutes) <= 300) lim.fiveHour = l;
      else lim.weekly = l;
    }
    codexLimits = lim;
  }
  const info = pl.info;
  const last = info?.last_token_usage;
  if (!last) return;
  const runTotal = Number(info.total_token_usage?.total_tokens ?? -2);
  if (runTotal === ctx.lastTotal) return; // the same running total re-emitted: no new request
  ctx.lastTotal = runTotal;
  const k = hash53(`codex:${o.timestamp}:${runTotal}:${last.total_tokens}`); // a forked rollout repeating its parent's events
  if (seen.has(k)) return;
  seen.add(k);
  const cached = Number(last.cached_input_tokens ?? 0);
  const s = zero();
  s.input = Math.max(0, Number(last.input_tokens ?? 0) - cached); // Codex's input includes the cached part
  s.cacheRead = cached;
  s.cacheWrite = Number(last.cache_write_input_tokens ?? 0);
  s.output = Number(last.output_tokens ?? 0); // reasoning tokens are already inside output_tokens
  s.total = s.input + s.cacheRead + s.cacheWrite + s.output;
  s.messages = 1;
  if (s.total === 0) return;
  s.unpricedTokens = s.total;
  const model = normModel(ctx.model);
  const acct = isOpenAiModel(model) || model === "unknown" ? "codex" : "other";
  sources.add("codex");
  record(acct, model, t, s, projectOf(ctx.cwd), acct === "codex" ? "own folder" : "other provider");
}

const CHUNK = 8 << 20;
let work = Buffer.allocUnsafe(CHUNK);

async function readNew(root: Root, file: string, st?: Stats) {
  if (!st) {
    try {
      st = await stat(file);
    } catch {
      return;
    }
  }
  const key = `${st.dev}:${st.ino}`;
  let f = files.get(key);
  if (!f || st.size < f.offset) files.set(key, (f = { offset: 0, carry: Buffer.alloc(0), ctx: null }));
  if (st.size === f.offset) return;
  const fh = await open(file, "r");
  try {
    // One shared work buffer: the unfinished line from the last read is copied to its front and the next bytes read in
    // behind it, instead of concatenating a fresh 8 MB buffer per chunk.
    const fs = f;
    while (f.offset < st.size) {
      const keep = f.carry.length;
      if (work.length < keep + CHUNK) work = Buffer.allocUnsafe(keep + CHUNK);
      f.carry.copy(work, 0);
      const { bytesRead } = await fh.read(work, keep, Math.min(CHUNK, st.size - f.offset), f.offset);
      if (bytesRead <= 0) break;
      f.offset += bytesRead;
      const chunk = work.subarray(0, keep + bytesRead);
      const done = root.kind === "claude" ? scanHeads(chunk, M_CLAUDE, 2048, (l) => claudeLine(root, file, l)) : scanHeads(chunk, M_CODEX, 320, (l) => codexLine(fs, l));
      f.carry = Buffer.from(chunk.subarray(done));
    }
  } finally {
    await fh.close();
  }
}

// ---------------------------------------------------------------- scan and answer

let scanAt = 0;
let scanMs = 0;
let firstScanMs = 0;
let fileCount = 0;
let scanning: Promise<void> | null = null;
let rebuilding = false;
let rootsSeen: Root[] = [];
let observed = new Map<string, { size: number; mtimeMs: number }>();
let hudFingerprint = "";
let body: string | null = null;
let bodyDay = "";
let bodyAt = 0;
/** How long one built answer is served before it is rebuilt from the latest scan, and how often a scan runs. */
const CACHE_MS = 60_000;
const CACHE_FILE = process.env.AB_TOKENS_CACHE ?? path.join(path.dirname(process.env.AB_STATE ?? path.join(HOME, ".local/state/agent-base/rows.json")), "tokens.json");
/** The last answer a previous node wrote, served (marked cached) only until this node's first scan is done. */
let diskBody: string | null | undefined;

/** Keep the expensive disk walk off the first page request; requests only serialize the last completed snapshot. */
export function warmTokens() {
  if (!scanning && Date.now() - scanAt > CACHE_MS) scanning = scan().catch(() => {}).finally(() => (scanning = null));
}
setTimeout(warmTokens, 0).unref();
setInterval(warmTokens, CACHE_MS).unref();

function fromDisk(): string | null {
  if (diskBody !== undefined) return diskBody;
  try {
    const d = JSON.parse(readFileSync(CACHE_FILE, "utf8"));
    diskBody = d && Array.isArray(d.accounts) ? JSON.stringify({ ...d, scanning: true, cached: true }) : null;
  } catch {
    diskBody = null;
  }
  return diskBody;
}

async function toDisk(out: string) {
  try {
    await mkdir(path.dirname(CACHE_FILE), { recursive: true });
    const tmp = `${CACHE_FILE}.${process.pid}.tmp`;
    await writeFile(tmp, out);
    await rename(tmp, CACHE_FILE);
  } catch {
    /* a cache that cannot be written only costs the next cold start */
  }
}

async function scan() {
  const t0 = Date.now();
  const rs = roots();
  const profiles = rs.flatMap((r) => r.profiles);
  await refreshTraces(profiles);
  const hud = refreshHud(profiles);
  let n = 0;
  const pending: { root: Root; file: string; st: Stats }[] = [];
  const current = new Map<string, { size: number; mtimeMs: number }>();
  let inventoryComplete = true;
  for (const r of rs) {
    const list: string[] = [];
    if (!(await walk(r.dir, list))) inventoryComplete = false;
    n += list.length;
    for (const file of list) {
      try {
        const st = await stat(file);
        current.set(`${st.dev}:${st.ino}`, { size: st.size, mtimeMs: st.mtimeMs });
        pending.push({ root: r, file, st });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") inventoryComplete = false;
      }
    }
  }
  if (!inventoryComplete) return;
  const hudChanged = !hud.failed && hud.fingerprint !== hudFingerprint;
  const rebuild = [...observed].some(([key, prior]) => {
    const next = current.get(key);
    return !next || next.size < prior.size || (next.size === prior.size && next.mtimeMs !== prior.mtimeMs);
  }) || (hudChanged && observed.size > 0);
  if (rebuild) body ??= JSON.stringify(build());
  const backup = rebuild ? {
    buckets: new Map(buckets),
    models: new Map(models),
    modelHours: new Map(modelHours),
    projectHours: new Map(projectHours),
    methods: new Map(methods),
    sources: new Set(sources),
    seen: new Set(seen),
    files: new Map(files),
    codexLimits,
    hudProfile,
    hudLimits,
    hudFingerprint,
  } : null;
  if (!hud.failed) {
    hudProfile = hud.prof;
    hudLimits = hud.lim;
    hudFingerprint = hud.fingerprint;
  }
  if (rebuild) {
    rebuilding = true;
    buckets.clear();
    models.clear();
    modelHours.clear();
    projectHours.clear();
    methods.clear();
    sources.clear();
    seen.clear();
    files.clear();
    codexLimits = null;
  }
  try {
    for (const { root, file, st } of pending) await readNew(root, file, st);
  } catch {
    if (backup) {
      buckets.clear(); for (const [k, v] of backup.buckets) buckets.set(k, v);
      models.clear(); for (const [k, v] of backup.models) models.set(k, v);
      modelHours.clear(); for (const [k, v] of backup.modelHours) modelHours.set(k, v);
      projectHours.clear(); for (const [k, v] of backup.projectHours) projectHours.set(k, v);
      methods.clear(); for (const [k, v] of backup.methods) methods.set(k, v);
      sources.clear(); for (const v of backup.sources) sources.add(v);
      seen.clear(); for (const v of backup.seen) seen.add(v);
      files.clear(); for (const [k, v] of backup.files) files.set(k, v);
      codexLimits = backup.codexLimits;
      hudProfile = backup.hudProfile;
      hudLimits = backup.hudLimits;
      hudFingerprint = backup.hudFingerprint;
    }
    return;
  } finally {
    rebuilding = false;
  }
  rootsSeen = rs;
  observed = current;
  if (rebuild) body = null;
  fileCount = n;
  scanAt = Date.now();
  scanMs = scanAt - t0;
  if (!firstScanMs) {
    firstScanMs = scanMs;
    body = null; // the first real answer replaces the cached one at once
  }
}

// ------------- calendar helpers (local time)

const dayStart = (t: number) => {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};
const localDay = (t: number) => {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
function calendarDay(t: number, days: number) {
  const d = new Date(t);
  d.setDate(d.getDate() + days);
  return d.getTime();
}

function ranges(now = Date.now()) {
  const today = dayStart(now);
  const d = new Date(today);
  const week = calendarDay(today, -((d.getDay() + 6) % 7)); // Monday
  const month = new Date(d.getFullYear(), d.getMonth(), 1).getTime();
  return { today, week, month };
}

// ------------- achievements
//
// Lifted from TokenTracker (https://github.com/xiufengsun/TokenTracker, MIT, (c) 2026 xiufengsun, read at 8b4ca1a):
// the three local badges and their thresholds are `computeLocalAchievements` / LOCAL_BADGE_THRESHOLDS in
// src/lib/local-api.js; the cloud badges' thresholds and metrics are scripts/ops/user-badges.sql's catalog and
// `user_badges_refresh()` (UTC days, as theirs are). Computed here over this machine's own data across all accounts.
// trendsetter (needs every user's model debuts) and podium (needs a leaderboard rank) cannot be computed locally.
const TIERS = ["bronze", "silver", "gold", "diamond"] as const;
const BADGES: { id: string; name: string; what: string; thresholds: number[]; local?: boolean }[] = [
  { id: "token_titan", name: "Token Titan", what: "tokens all time", thresholds: [1e8, 1e9, 1e10, 1e11] },
  { id: "big_day", name: "Big Day", what: "tokens in one day", thresholds: [1e7, 1e8, 5e8, 3e9] },
  { id: "wordsmith", name: "Wordsmith", what: "output tokens all time", thresholds: [5e6, 25e6, 1e8, 3e8] },
  { id: "marathoner", name: "Marathoner", what: "active days", thresholds: [7, 30, 100, 365] },
  { id: "streak", name: "Streak", what: "longest run of active days", thresholds: [3, 7, 30, 100] },
  { id: "weekend_warrior", name: "Weekend Warrior", what: "active weekend days", thresholds: [5, 20, 50, 100] },
  { id: "momentum", name: "Momentum", what: "best week-over-week growth (x)", thresholds: [2, 6, 15, 40] },
  { id: "polyglot", name: "Polyglot", what: "models used", thresholds: [5, 15, 30, 60] },
  { id: "multitool", name: "Multitool", what: "tools used (Claude Code, Codex, ...)", thresholds: [2, 4, 6, 10] },
  { id: "veteran", name: "Veteran", what: "days since the first token", thresholds: [30, 90, 180, 365] },
  { id: "project_hopper", name: "Project Hopper", what: "projects worked in", thresholds: [3, 5, 10, 20], local: true },
  { id: "project_devotion", name: "Project Devotion", what: "tokens in one project", thresholds: [1e6, 1e7, 1e8, 1e9], local: true },
  { id: "night_owl", name: "Night Owl", what: "active hours between 00:00 and 05:59", thresholds: [5, 20, 60, 150], local: true },
];

function achievements(allHours: Map<number, Sum>, modelCount: number) {
  const hours = [...allHours.entries()].filter(([, s]) => s.total > 0).sort((a, b) => a[0] - b[0]);
  const daily = new Map<string, number>();
  let total = 0,
    output = 0;
  for (const [h, s] of hours) {
    const day = localDay(h);
    daily.set(day, (daily.get(day) ?? 0) + s.total);
    total += s.total;
    output += s.output;
  }
  const days = [...daily.keys()].sort();
  const dayNum = (k: string) => Date.parse(`${k}T00:00:00Z`) / DAY;
  let longest = 0,
    run = 0,
    prev = -2;
  for (const k of days) {
    const n = dayNum(k);
    run = n === prev + 1 ? run + 1 : 1;
    longest = Math.max(longest, run);
    prev = n;
  }
  const weekend = days.filter((k) => [0, 6].includes(new Date(`${k}T00:00:00Z`).getUTCDay())).length;
  // Momentum: adjacent ISO weeks only, the earlier week must clear 10M tokens.
  const weekly = new Map<number, number>();
  for (const [k, v] of daily) {
    const n = dayNum(k);
    const wk = n - ((new Date(n * DAY).getUTCDay() + 6) % 7);
    weekly.set(wk, (weekly.get(wk) ?? 0) + v);
  }
  let wow = 0;
  for (const [wk, v] of weekly) {
    const pv = weekly.get(wk - 7);
    if (pv && pv >= 1e7) wow = Math.max(wow, v / pv);
  }
  const first = days[0] ? dayNum(days[0]) : null;
  // TokenTracker's local three, replayed in hour order.
  const projTotals = [...projectHours.values()].map((m) => [...m.values()].reduce((a, b) => a + b, 0));
  const projects = projTotals.filter((v) => v > 0).length;
  const devotion = Math.max(0, ...projTotals);
  const night = hours.filter(([h]) => new Date(h).getHours() < 6).length;
  const metric: Record<string, number> = {
    token_titan: total,
    big_day: Math.max(0, ...daily.values()),
    wordsmith: output,
    marathoner: days.length,
    streak: longest,
    weekend_warrior: weekend,
    momentum: Math.round(wow * 10) / 10,
    polyglot: modelCount,
    multitool: sources.size,
    veteran: first === null ? 0 : Math.floor(Date.now() / DAY) - first,
    project_hopper: projects,
    project_devotion: devotion,
    night_owl: night,
  };
  return BADGES.map((b) => {
    const v = metric[b.id] ?? 0;
    const tier = b.thresholds.filter((x) => v >= x).length;
    return { id: b.id, name: b.name, what: b.what, value: v, tier, tierName: tier ? TIERS[tier - 1] : null, thresholds: b.thresholds, next: tier >= 4 ? null : b.thresholds[tier], local: !!b.local };
  });
}

// ------------- the payload

function label(acct: string): string {
  if (acct === "codex") return codexLimits?.plan ? `Codex (ChatGPT ${codexLimits.plan[0].toUpperCase()}${codexLimits.plan.slice(1)})` : "Codex (~/.codex)";
  if (acct === "other") return "Other models via Claude Code / Codex";
  if (acct === "claude:unattributed") return `Unattributed (${(rootsSeen.find((r) => r.profiles.length > 1)?.profiles ?? []).map((p) => p.label).join(" or ") || "shared folder"})`;
  const id = acct.slice("claude:".length);
  return rootsSeen.flatMap((r) => r.profiles).find((p) => p.id === id)?.label ?? id;
}

function limitOut(l: Limit | null) {
  if (!l) return null;
  const expired = l.resetsAt !== null && l.resetsAt < Date.now();
  return { usedPct: expired ? 0 : l.usedPct, resetsAt: l.resetsAt, expired };
}

function build() {
  const now = Date.now();
  const { today, week, month } = ranges(now);
  const day30 = calendarDay(today, -29);
  const accountIds = [...buckets.keys()];
  // Every Claude profile shows, even with no usage yet.
  const profiles = rootsSeen.flatMap((r) => r.profiles);
  for (const pr of profiles) if (!accountIds.includes(`claude:${pr.id}`)) accountIds.push(`claude:${pr.id}`);
  const commandByProfile = claudeCommands(path.join(HOME, ".local/bin"), profiles);
  const logins = loginMap();
  const personOf = (acct: string): Person | null => (acct.startsWith("claude:") ? (logins.get(acct.slice(7).replace(/^\./, "")) ?? null) : null);
  const notMine = new Set(accountIds.filter((a) => personOf(a)?.mine === false));
  const order = (a: string) => (a === "codex" ? 2 : a === "other" ? 3 : a === "claude:unattributed" ? 1 : 0);
  accountIds.sort((a, b) => order(a) - order(b) || a.localeCompare(b));

  const overall = { today: zero(), week: zero(), month: zero(), allTime: zero() };
  const all = new Map<number, Sum>();
  const dailyKeys: string[] = [];
  for (let i = 0; i < 30; i++) dailyKeys.push(localDay(calendarDay(day30, i)));
  const daily = new Map(dailyKeys.map((k) => [k, { day: k, total: 0, output: 0, cost: 0, byAccount: {} as Record<string, number> }]));
  const hourOfDay = Array.from({ length: 24 }, (_, h) => ({ hour: h, total: 0, output: 0 }));
  const heatStart = calendarDay(today, -363);
  const heatValues = new Map<string, number>();
  for (const [acct, byHour] of buckets) if (!notMine.has(acct)) for (const [h, s] of byHour) {
    if (h >= heatStart && h < calendarDay(today, 1)) { const day = localDay(h); heatValues.set(day, (heatValues.get(day) ?? 0) + s.total); }
  }
  const quantile = (sorted: number[], q: number) => {
    if (!sorted.length) return 0;
    const pos = (sorted.length - 1) * q, base = Math.floor(pos), rest = pos - base;
    return Math.round((sorted[base] ?? 0) + ((sorted[Math.min(sorted.length - 1, base + 1)] ?? 0) - (sorted[base] ?? 0)) * rest);
  };
  const thresholds = [0.5, 0.75, 0.9].map(q => quantile([...heatValues.values()].filter(v => v > 0).sort((a,b)=>a-b), q));
  const heatmap = Array.from({length:364},(_,i)=>{
    const day = localDay(calendarDay(heatStart, i)); const value=heatValues.get(day)??0;
    return {day,value,level:value<=0?0:value<=thresholds[0]?1:value<=thresholds[1]?2:value<=thresholds[2]?3:4};
  });

  const accounts = accountIds.map((acct) => {
    const per = { today: zero(), week: zero(), month: zero(), allTime: zero() };
    let firstAt: number | null = null,
      lastAt: number | null = null;
    const counted = !notMine.has(acct);
    for (const [h, s] of buckets.get(acct) ?? []) {
      addTo(per.allTime, s);
      if (h >= month) addTo(per.month, s);
      if (h >= week) addTo(per.week, s);
      if (h >= today) addTo(per.today, s);
      if (firstAt === null || h < firstAt) firstAt = h;
      if (lastAt === null || h > lastAt) lastAt = h;
      if (!counted) continue; // another person's login: its own numbers, none in the totals
      let a = all.get(h);
      if (!a) all.set(h, (a = zero()));
      addTo(a, s);
      if (h >= day30) {
        const d = daily.get(localDay(h));
        if (d) {
          d.total += s.total;
          d.output += s.output;
          d.cost += s.cost;
          d.byAccount[acct] = (d.byAccount[acct] ?? 0) + s.total;
        }
        const hd = hourOfDay[new Date(h).getHours()];
        hd.total += s.total;
        hd.output += s.output;
      }
    }
    if (counted) for (const k of ["today", "week", "month", "allTime"] as const) addTo(overall[k], per[k]);
    const id = acct.startsWith("claude:") ? acct.slice(7) : acct;
    const lim = acct === "codex" ? codexLimits : acct.startsWith("claude:") ? hudLimits.get(id) : undefined;
    const todayModels = new Map<string, Sum>(), weekModels = new Map<string, Sum>();
    for (const [h, byModel] of modelHours.get(acct) ?? []) {
      if (h < week) continue;
      for (const [model, s] of byModel) {
        for (const sums of h >= today ? [todayModels, weekModels] : [weekModels]) {
          let sum = sums.get(model);
          if (!sum) sums.set(model, (sum = zero()));
          addTo(sum, s);
        }
      }
    }
    const topModels = (sums: Map<string, Sum>) => [...sums].sort((a, b) => b[1].total - a[1].total).slice(0, 6).map(([model, s]) => ({ model, total: s.total, cost: s.cost }));
    return {
      id: acct,
      // The person when claude-credits names the login (G12); else the folder name.
      name: personOf(acct)?.label ?? label(acct),
      folder: label(acct),
      person: personOf(acct),
      ...(acct.startsWith("claude:") && commandByProfile.has(acct.slice(7)) ? { command: commandByProfile.get(acct.slice(7)) } : {}),
      kind: acct === "codex" ? "codex" : acct === "other" ? "other" : acct === "claude:unattributed" ? "unattributed" : "claude",
      ...per,
      firstAt,
      lastAt,
      models: topModels(models.get(acct) ?? new Map()),
      modelsToday: topModels(todayModels),
      modelsWeek: topModels(weekModels),
      limits: lim ? { fiveHour: limitOut(lim.fiveHour), weekly: limitOut(lim.weekly), at: lim.at, source: acct === "codex" ? "newest Codex token_count event" : "newest status-line HUD file for this profile", ...(acct === "codex" && codexLimits?.credits ? { credits: codexLimits.credits } : {}) } : null,
    };
  });

  const oldest = all.size ? Math.min(...all.keys()) : null;
  const modelSet = new Set<string>();
  for (const m of models.values()) for (const k of m.keys()) if (k !== "unknown") modelSet.add(k);
  return {
    at: scanAt,
    scanning: false,
    scanMs,
    firstScanMs,
    files: fileCount,
    ranges: { today: localDay(today), weekFrom: localDay(week), monthFrom: localDay(month), timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone },
    overall,
    accounts,
    daily: [...daily.values()],
    heatmap,
    heatmapThresholds: thresholds,
    hourOfDay,
    attribution: Object.fromEntries(methods),
    achievements: achievements(all, modelSet.size),
    notes: [
      "Cost is estimated at Anthropic API list prices (cache writes and reads priced separately); a subscription does not bill this. Codex and other providers' tokens are counted but unpriced.",
      "~/.claude and ~/.claude-siso share one chat folder: each session is split by prompt history, the status-line file, or the one profile with a trace of it; the rest is unattributed.",
      "Claude limits come from live OAuth usage; status-line fallbacks are marked stale. Codex uses its newest event.",
      ...(notMine.size ? [`Not counted as yours: ${[...notMine].map((a) => `${personOf(a)!.label}'s login (${label(a)})`).join(", ")}.`] : []),
      `"All time" is what is still on disk: Claude Code prunes old chats, and the oldest hour here is ${oldest === null ? "none" : localDay(oldest)}.`,
    ],
    oldest,
  };
}

/** Today's cost over every account (the same figure as the Tokens page's "today"), or null before a scan has seen usage today. */
export async function tokensTodayUsd(): Promise<number | null> {
  if (scanAt === 0) return null;
  const today = usageAccounts(JSON.parse(await tokens()), HOME)?.overall?.today;
  return today?.messages > 0 && typeof today.cost === "number" ? Math.round(today.cost * 100) / 100 : null;
}

async function tokens(): Promise<string> {
  warmTokens();
  if (rebuilding && body) return body;
  if (scanAt === 0) return fromDisk() ?? JSON.stringify({ ...build(), scanning: true });
  const now = Date.now();
  const day = localDay(now);
  if (!body || day !== bodyDay || now - bodyAt > CACHE_MS) {
    body = JSON.stringify(build());
    bodyDay = day;
    bodyAt = now;
    void toDisk(body);
  }
  return body;
}

/** The Now panel reuses the published token snapshot, never credentials or another scan. */
export async function tokensBudget() {
  const snapshot = usageAccounts(JSON.parse(await tokens()), HOME);
  const limits = snapshot.accounts?.find((a: any) => a.kind === "codex")?.limits;
  // Keep an explicit unknown in the selected snapshot; do not revive another reading.
  const credits = limits?.credits ?? codexCredits();
  return {
    at: snapshot.at, scanning: snapshot.scanning,
    claude: (snapshot.accounts ?? []).filter((a: any) => a.kind === "claude" && a.person?.mine !== false && a.limits?.weekly).map((a: any) => ({ name: a.name, usedPct: a.limits.weekly.usedPct, resetsAt: a.limits.weekly.resetsAt, limitsAt: a.limits.at, limitsStale: a.limits.stale })),
    codex: {
      balance: creditBalance(credits?.balance),
      balanceAt: limits?.credits ? limits.at ?? null : credits?.at ?? null,
      balanceSource: limits?.credits ? limits.source ?? null : credits ? "newest Codex token_count event" : null,
      hasCredits: typeof credits?.hasCredits === "boolean" ? credits.hasCredits : null,
      unlimited: typeof credits?.unlimited === "boolean" ? credits.unlimited : null,
      stale: limits?.credits ? limits.stale === true : false,
    },
  };
}

export async function handleTokens(req: http.IncomingMessage, res: http.ServerResponse, url: URL): Promise<boolean> {
  if (url.pathname !== "/api/tokens") return false;
  if (req.method !== "GET") {
    res.writeHead(405, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "GET only" }));
    return true;
  }
  const out = JSON.stringify(usageAccounts(JSON.parse(await tokens()), HOME));
  res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
  res.end(out);
  return true;
}
