import { execFile, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, statSync, realpathSync } from "node:fs";
import type http from "node:http";
import os from "node:os";
import path from "node:path";

/**
 * What's new (Shaan, 3 Oct 04:30: "a timeline where I can see the version updates … what new changes have been added
 * since I've walked away"). tools/ab-live appends one JSON line per deploy to live.jsonl ({at, sha, kind, result});
 * each `live` line is a release, and its commits are the ones between it and the release before it. `pending` is what
 * main holds that is not live yet.
 */
export type LiveLine = { at: string; sha: string; kind: "node" | "web" | "desktop" | string; result: "live" | "refused" | "rolled-back" | string; reason?: string };
export type Commit = { sha: string; subject: string; line: string; author: string; tag: string | null; at: string };
/** A release note (the owner owns the queue, 5 Oct): one line in services/node/releases/notes.jsonl per release it ships. */
export type EvidenceImage = { path: string; sha: string; capturedAt?: string };
export type EvidencePair = { id: string; title: string; before: EvidenceImage; after: EvidenceImage; viewport?: { width: number; height: number } };
export type ReleaseEvidence = { state: "available" | "unavailable"; pairs: { id: string; title: string; before: string; after: string; beforeSha: string; afterSha: string; viewport?: { width: number; height: number } }[]; reason?: string };
export type Note = { sha: string; title: string; why?: string; what?: string[]; see?: string; evidence?: EvidencePair[] };
export type Release = { version: number; at: string; sha: string; kinds: string[]; commits: Commit[]; note?: Note; evidence?: ReleaseEvidence };
export type Releases = { releases: Release[]; pending: { ref: string | null; commits: Commit[]; note?: Note }; log: string };

const MAX_RELEASES = 60;
const MAX_COMMITS = 120;
/** The first release has no release before it: its commits stop here. */
const FIRST_RELEASE_COMMITS = 20;

export const liveLog = () => process.env.AB_LIVE_LOG || path.join(os.homedir(), ".local/state/agent-base/live/live.jsonl");

export function readLiveLog(file: string, requireReadable = false): LiveLine[] {
  let raw = "";
  try { raw = readFileSync(file, "utf8"); } catch { if (requireReadable) throw new Error("Deployment log unavailable"); return []; }
  return raw.split(/\r?\n/).flatMap((l) => {
    if (!l.trim()) return [];
    try {
      const e = JSON.parse(l);
      if (e && typeof e.sha === "string" && /^[0-9a-f]{7,40}$/i.test(e.sha) && typeof e.result === "string")
        return [{ ...e, at: typeof e.at === "string" ? e.at : "", kind: typeof e.kind === "string" ? e.kind : "unknown" } as LiveLine];
      if (requireReadable) throw new Error("Invalid deployment record");
      return [];
    } catch { if (requireReadable) throw new Error("Deployment log contains an unreadable record"); return []; }
  });
}

/** Housekeeping no one reads as a change: chore commits and the probe-shot commits deploys leave behind. */
export const isNoise = (subject: string) => /^chore\b/i.test(subject) || /probe[- ]?shots?\b/i.test(subject);

/**
 * A commit subject as a line he reads: no `fix(browser):` / `t-0043:` / `R1.1:` prefix, no trailing `(sha)`, a capital
 * first letter. The prefix is kept as the tag when the commit names no `Agent:` itself.
 */
export function humanize(subject: string): { line: string; prefix: string | null } {
  let s = subject.trim();
  let prefix: string | null = null;
  const m = /^([A-Za-z][\w.\/-]*(?:\([^)]{1,40}\))?!?):\s+(.+)$/.exec(s);
  if (m && m[1].length <= 40) {
    prefix = m[1];
    s = m[2];
  }
  s = s.replace(/\s*\([0-9a-f]{7,40}\)\s*$/i, "").trim();
  return { line: s ? s[0].toUpperCase() + s.slice(1) : subject.trim(), prefix };
}

/** `fix(browser)` → browser; `t-0043` → t-0043; `feat` alone says nothing about who or where. */
const tagOf = (prefix: string | null) => {
  if (!prefix) return null;
  const scope = /\(([^)]+)\)/.exec(prefix)?.[1];
  if (scope) return scope;
  return /^(feat|fix|refactor|docs|test|tests|style|perf|build|ci|revert)!?$/i.test(prefix) ? null : prefix;
};

function git(repo: string, args: string[]): string | null {
  try { return execFileSync("git", args, { cwd: repo, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], maxBuffer: 8 << 20 }); }
  catch { return null; }
}

const FMT = "%H%x1f%s%x1f%an%x1f%aI%x1f%(trailers:key=Agent,valueonly,separator=%x2c)%x1e";
/** A log between full shas never changes; a ref (main, HEAD) is asked every time. */
const LOGS = new Map<string, Commit[]>();
const FIXED_RANGE = /^[0-9a-f]{40}(\.\.[0-9a-f]{40})?$/;
export function commits(repo: string, range: string[], max = MAX_COMMITS): Commit[] {
  const k = range.every(r => FIXED_RANGE.test(r)) ? `${repo}\0${max}\0${range.join(" ")}` : null;
  const kept = k ? LOGS.get(k) : undefined;
  if (kept) return kept;
  const list = logOf(repo, range, max);
  if (k && list) LOGS.set(k, list);
  return list ?? [];
}
function logOf(repo: string, range: string[], max: number): Commit[] | null {
  const out = git(repo, ["log", "--no-merges", `--max-count=${max}`, `--format=${FMT}`, ...range, "--"]);
  if (out === null) return null;
  return out.split("\x1e").map((r) => r.replace(/^\s+/, "")).filter(Boolean).flatMap((r) => {
    const [sha, subject = "", author = "", at = "", agent = ""] = r.split("\x1f");
    if (!sha || !subject || isNoise(subject)) return [];
    const { line, prefix } = humanize(subject);
    return [{ sha, subject, line, author, at, tag: agent.split(",")[0]?.trim() || tagOf(prefix) }];
  });
}

export const notesFile = (repo: string) => process.env.AB_RELEASE_NOTES || path.join(repo, "services/node/releases/notes.jsonl");
/** Publication follows a known release SHA. Keep that append-only record outside the commit it describes. */
export const releasePublicationFile = (repo: string) => process.env.AB_RELEASE_PUBLISHED || path.join(os.homedir(), ".local/state/agent-base/live", `notes-${createHash("sha256").update(path.resolve(repo)).digest("hex").slice(0, 16)}.jsonl`);
export function readNotes(file: string): Note[] {
  let raw = "";
  try { if (statSync(file).size > 8 * 1024 * 1024) return []; raw = readFileSync(file, "utf8"); } catch { return []; }
  return raw.split(/\r?\n/).flatMap((l) => {
    try {
      const n = JSON.parse(l);
      return n && typeof n.sha === "string" && /^[0-9a-f]{7,40}$/.test(n.sha) && typeof n.title === "string" ? [n as Note] : [];
    } catch { return []; }
  });
}
export function readReleaseNotes(repo: string): Note[] {
  const baseline = readNotes(notesFile(repo));
  // An explicit notes file isolates fixtures and custom callers unless they also opt into a publication file.
  const published = process.env.AB_RELEASE_NOTES && !process.env.AB_RELEASE_PUBLISHED ? [] : readNotes(releasePublicationFile(repo)).filter(n => /^[0-9a-f]{40}$/.test(n.sha));
  const bySha = new Map(baseline.map(n => [n.sha, n]));
  for (const note of published) bySha.set(note.sha, note);
  return [...bySha.values()];
}
/**
 * Ancestry between fixed commits never changes, so every answer is kept. On 5 Oct the Timeline asked git once per note per
 * ship, synchronously: /api/timeline took 12 s and froze the node, so the app said "Reconnecting to herdr". `noteFor`
 * stays synchronous (one `rev-list` per release range, kept); `noteSoon` never blocks: unknown pairs are asked in the
 * background, a few at a time, and the note shows on a later read.
 */
const ANCESTRY = new Map<string, boolean>();
const ancestryKey = (repo: string, a: string, b: string) => `${repo}\0${a}\0${b}`;
const asking: [string, string, string][] = [];
const queued = new Set<string>();
let running = 0;
function askLater(repo: string, a: string, b: string) {
  const k = ancestryKey(repo, a, b);
  if (ANCESTRY.has(k) || queued.has(k)) return;
  queued.add(k);
  asking.push([repo, a, b]);
  pump();
}
function pump() {
  while (running < 3 && asking.length) {
    const [repo, a, b] = asking.shift()!;
    running++;
    execFile("git", ["merge-base", "--is-ancestor", a, b], { cwd: repo }, (err) => {
      const k = ancestryKey(repo, a, b);
      ANCESTRY.set(k, !err);
      queued.delete(k);
      running--;
      pump();
    });
  }
}
const known = (repo: string, a: string, b: string): boolean | undefined => ANCESTRY.get(ancestryKey(repo, a, b));
/**
 * The commits `sha` holds and `prev` does not, merges included: one `git rev-list` per range. On 8 Oct /api/releases asked
 * `merge-base --is-ancestor` per note per release (60 x 32 x 2 spawns) and blocked the node for 36 s after every start.
 * A range between two full shas never changes, so it is kept.
 */
const RANGES = new Map<string, Set<string>>();
function rangeOf(repo: string, prev: string | null, sha: string): Set<string> {
  const fixed = /^[0-9a-f]{40}$/.test(sha) && (!prev || /^[0-9a-f]{40}$/.test(prev));
  const k = `${repo}\0${prev ?? ""}\0${sha}`;
  const kept = fixed ? RANGES.get(k) : undefined;
  if (kept) return kept;
  // An unknown prev holds nothing, as `merge-base --is-ancestor` said: fall back to everything `sha` holds.
  const out = (prev ? git(repo, ["rev-list", sha, `^${prev}`, "--"]) : null) ?? git(repo, ["rev-list", sha, "--"]) ?? "";
  const set = new Set(out.split("\n").filter(Boolean));
  if (fixed && out) RANGES.set(k, set);
  return set;
}
const holds = (range: Set<string>, sha: string) => sha.length === 40 ? range.has(sha) : [...range].some(c => c.startsWith(sha));
/** The newest note whose commit `sha` holds and `prev` does not: the note for the release from prev to sha. */
export function noteFor(repo: string, notes: Note[], prev: string | null, sha: string): Note | undefined {
  if (!notes.length) return undefined;
  const range = rangeOf(repo, prev, sha);
  return [...notes].reverse().find((n) => holds(range, n.sha));
}
/** noteFor without blocking: undefined until every answer it needs is known (asked in the background meanwhile). */
export function noteSoon(repo: string, notes: Note[], prev: string | null, sha: string): Note | undefined {
  let missing = false;
  const ask = (a: string, b: string) => { const v = known(repo, a, b); if (v === undefined) { missing = true; askLater(repo, a, b); } return v; };
  for (const n of [...notes].reverse()) {
    const inSha = ask(n.sha, sha), inPrev = prev ? ask(n.sha, prev) : false;
    if (missing) continue;
    if (inSha && !inPrev) return n;
  }
  return undefined;
}

const resolve = (repo: string, ref: string) => git(repo, ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`])?.trim() || null;

/** Live lines, oldest first, folded into releases: a sha that went live as web then node is one release. */
export function releasesOf(lines: LiveLine[]): { at: string; sha: string; kinds: string[] }[] {
  const out: { at: string; sha: string; kinds: string[] }[] = [];
  for (const e of lines) {
    if (e.result !== "live") continue;
    const last = out.at(-1);
    if (last && last.sha === e.sha) {
      if (!last.kinds.includes(e.kind)) last.kinds.push(e.kind);
      last.at = e.at;
    } else out.push({ at: e.at, sha: e.sha, kinds: [e.kind] });
  }
  return out;
}

let cache: { key: string; value: Releases } | null = null;

export function readReleases(repo: string, file = liveLog()): Releases {
  const st = statSync(file, { throwIfNoEntry: false });
  const refs = ["main", "origin/main"].map((r) => [r, resolve(repo, r)] as const).filter(([, sha]) => sha) as [string, string][];
  const head = resolve(repo, "HEAD");
  const notes = readReleaseNotes(repo);
  // A cached history is usable only while its source is still readable and valid.
  const lines = readLiveLog(file, true);
  const key = JSON.stringify([repo, file, st?.dev, st?.ino, st?.ctimeMs, st?.mtimeMs, st?.size, refs, head, notes]);
  if (cache?.key === key) return { ...cache.value, releases: cache.value.releases.map(r => ({ ...r, evidence: evidenceFor(repo, notes, r.sha) })) };

  const all = releasesOf(lines);
  const kept = all.slice(-MAX_RELEASES);
  const offset = all.length - kept.length;
  const releases: Release[] = kept.map((r, i) => {
    const prev = i + offset > 0 ? all[i + offset - 1].sha : null;
    const sha = resolve(repo, r.sha) ?? r.sha;
    const list = prev ? commits(repo, [`${prev}..${sha}`]) : commits(repo, [sha], FIRST_RELEASE_COMMITS);
    const note = notes.length ? noteFor(repo, notes, prev, sha) : undefined;
    return { version: i + offset + 1, at: r.at, sha, kinds: r.kinds, commits: list, ...(note ? { note } : {}), evidence: evidenceFor(repo, notes, sha) };
  }).reverse();

  // Commits beyond the newest recorded deployment, not a claim about the running app.
  // Of main and origin/main, use whichever is further ahead.
  const newest = releases[0]?.sha ?? null;
  let pending: Releases["pending"] = { ref: null, commits: [] };
  if (newest) {
    for (const [ref] of refs.length ? refs : head ? [["HEAD", head] as [string, string]] : []) {
      const list = commits(repo, [`${newest}..${ref}`]);
      if (pending.ref === null || list.length > pending.commits.length) pending = { ref, commits: list };
    }
    const note = pending.ref && notes.length ? noteFor(repo, notes, newest, resolve(repo, pending.ref) ?? pending.ref) : undefined;
    if (note) pending.note = note;
  }
  const value = { releases, pending, log: file };
  cache = { key, value };
  return value;
}


const EVIDENCE_ROOTS = ["ui-hub", "domain-base", "services/node/releases/assets"];
const SHA = /^[0-9a-f]{7,40}$/i;
/** Only manifest-declared raster files under evidence roots. No traversal, symlinks, SVG or arbitrary file endpoint. */
export function evidenceAsset(repo: string, relative: unknown): { bytes: Buffer; mime: string } | null {
  if (typeof relative !== "string" || path.isAbsolute(relative) || relative.includes("\\") || relative.split("/").some(p => !p || p === "." || p === "..")) return null;
  if (!EVIDENCE_ROOTS.some(root => relative.startsWith(`${root}/`))) return null;
  if (!/\.(png|jpe?g|webp)$/i.test(relative)) return null;
  try {
    const root = realpathSync(repo), file = path.resolve(root, relative);
    if (realpathSync(file) !== file || !file.startsWith(`${root}${path.sep}`)) return null;
    const stat = statSync(file);
    if (!stat.isFile() || stat.size > 8 * 1024 * 1024) return null;
    const bytes = readFileSync(file);
    if (bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return { bytes, mime: "image/png" };
    if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return { bytes, mime: "image/jpeg" };
    if (bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP") return { bytes, mime: "image/webp" };
  } catch { /* Missing or outside the admitted roots. */ }
  return null;
}
function declaredPairs(notes: Note[], sha: string): EvidencePair[] {
  // Evidence is exact-release-bound, even when the prose note was inherited through ancestry.
  return notes.filter(n => n.sha === sha).flatMap(n => Array.isArray(n.evidence) ? n.evidence : []).filter(p =>
    p && typeof p.id === "string" && /^[a-z0-9][a-z0-9_-]{0,63}$/i.test(p.id) && typeof p.title === "string" &&
    p.before && p.after && typeof p.before.sha === "string" && SHA.test(p.before.sha) && p.after.sha === sha &&
    typeof p.before.path === "string" && typeof p.after.path === "string" && p.before.path !== p.after.path);
}
/** Ambiguous IDs cannot identify a stable pair, even if only one pair is readable today. */
function availablePairs(repo: string, declared: EvidencePair[]): EvidencePair[] {
  const counts = new Map<string, number>();
  for (const pair of declared) counts.set(pair.id, (counts.get(pair.id) ?? 0) + 1);
  return declared.filter(p => counts.get(p.id) === 1 && evidenceAsset(repo, p.before.path) && evidenceAsset(repo, p.after.path));
}
export function evidenceFor(repo: string, notes: Note[], sha: string): ReleaseEvidence {
  const declared = declaredPairs(notes, sha);
  const pairs = availablePairs(repo, declared).flatMap(p => {
    const base = `/api/releases/${sha}/evidence/${p.id}`;
    const viewport = p.viewport && Number.isInteger(p.viewport.width) && p.viewport.width > 0 && Number.isInteger(p.viewport.height) && p.viewport.height > 0 ? p.viewport : undefined;
    return [{ id: p.id, title: p.title, before: `${base}/before`, after: `${base}/after`, beforeSha: p.before.sha, afterSha: p.after.sha, ...(viewport ? { viewport } : {}) }];
  });
  return { state: pairs.length ? "available" : "unavailable", pairs, ...(!pairs.length ? { reason: "No before/after pair recorded for this release." } : pairs.length < declared.length ? { reason: "Some recorded pairs are unavailable." } : {}) };
}

export function handleReleases(req: http.IncomingMessage, res: http.ServerResponse, url: URL, repo: string): boolean {
  const asset = url.pathname.match(/^\/api\/releases\/([0-9a-f]{7,40})\/evidence\/([a-z0-9][a-z0-9_-]{0,63})\/(before|after)$/i);
  if (asset) {
    if (req.method !== "GET") { res.writeHead(405, { Allow: "GET" }); res.end(); return true; }
    const [, sha, id, side] = asset;
    const pair = availablePairs(repo, declaredPairs(readReleaseNotes(repo), sha)).find(p => p.id === id);
    const image = pair && evidenceAsset(repo, pair[side as "before" | "after"].path);
    if (!image) { res.writeHead(404, { "content-type": "application/json" }); res.end(JSON.stringify({ error: "Release image unavailable" })); return true; }
    res.writeHead(200, { "content-type": image.mime, "cache-control": "private, no-cache", "x-content-type-options": "nosniff", "content-security-policy": "default-src 'none'; sandbox" });
    res.end(image.bytes); return true;
  }
  if (url.pathname !== "/api/releases") return false;
  let code = req.method === "GET" ? 200 : 405;
  let body: Releases | { error: string } = { error: "GET only" };
  if (code === 200) {
    try { body = readReleases(repo); }
    catch { code = 503; body = { error: "Deployment history unavailable" }; }
  }
  res.writeHead(code, { "content-type": "application/json", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
  return true;
}
