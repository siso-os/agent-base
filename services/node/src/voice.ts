/**
 * Voice: SISO Voice's history, stats, dictionary and settings for Agent Base.
 *
 * Lifted from SISO Internal's api/voice-local-routes.js (queryHistory, computeLevel, computeDerived, the dictionary
 * and prefs writers), with the credential mint and the cleanup-instructions writer left behind (SISO Voice's pipeline
 * does not read that record yet: InstructionsEditorView.swift says so). The mic's speech to text, which reads SISO
 * Voice's Groq key and keeps it in this process, is voice-transcribe.ts (/api/voice/transcribe).
 *
 * History store: PipelineHistory.sqlite, opened read-only; the native app is its only writer.
 *   GET  /api/voice/history?limit&offset&q&app&day   newest first; day is yyyy-MM-dd in local time
 *   GET  /api/voice/stats                            ShareCardStats parity: words, level, wpm, streak, time saved
 *   GET  /api/voice/activity?days                    per-day counts and words, hour-of-day, top apps
 *   POST /api/voice/speak    {text}                  one sentence as a WAV, Groq's voice or macOS say (voice-speak.ts)
 *   GET  /api/voice/status                           its launchd services and the last dictation's time (voice-health.ts)
 *   POST /api/voice/restart                          check now and restart what is down (voice-health.ts)
 *
 * Preferences: the com.siso.voice defaults domain (~/Library/Preferences/com.siso.voice.plist), read with
 * `defaults export` + plistlib (lossless) and written with `defaults write`, so cfprefsd stays the owner.
 *   GET    /api/voice/dictionary                     terms, replacement rules, the transcriber vocabulary, suggestions
 *   POST   /api/voice/dictionary/terms  {text}       DictionaryStore.add parity (trim, case-insensitive dedupe)
 *   DELETE /api/voice/dictionary/terms?id=
 *   POST   /api/voice/dictionary/rules  {from,to}    ReplacementStore.add parity
 *   POST   /api/voice/dictionary/rules/toggle {id}
 *   DELETE /api/voice/dictionary/rules?id=
 *   GET    /api/voice/settings                       the web-writable prefs, their legal values, the record
 *   POST   /api/voice/settings      {key,value}      one pref; validated against WRITABLE
 * When SISO Voice sees a write (freeflow Sources): dictionary terms and rules are decoded when its Dictionary page
 * opens; every other pref is read by AppState at launch, so it applies when SISO Voice relaunches.
 *
 * A browser request from anywhere but 127.0.0.1 or localhost is refused (403); writes must be JSON. AB_VOICE_DB and
 * AB_VOICE_PREFS (a defaults domain or a .plist path) point the routes at copies for tests.
 */
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { statSync, existsSync } from "node:fs";
import type http from "node:http";
import { homedir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { DatabaseSync } from "node:sqlite";
import { handleTranscribe } from "./voice-transcribe.ts";
import { restartVoice, voiceStatus } from "./voice-health.ts";
import { handleSpeak } from "./voice-speak.ts";

const run = promisify(execFile);
const HISTORY_DB = process.env.AB_VOICE_DB || path.join(homedir(), "Library", "Application Support", "SISO Voice", "PipelineHistory.sqlite");
const PREFS = process.env.AB_VOICE_PREFS || "com.siso.voice";
/*
 * Agent Base's own dictations (dictation.ts) are the same record to him: history and stats read both stores (t-0500).
 * A test that points AB_VOICE_DB at a copy reads no Agent Base rows unless it also sets AB_DICTATION_DIR.
 */
const AB_DB = process.env.AB_DICTATION_DIR ? path.join(process.env.AB_DICTATION_DIR, "history.sqlite")
  : process.env.AB_VOICE_DB ? "" : path.join(homedir(), ".local/state/agent-base/dictation/history.sqlite");

type AbRow = { id: string; timestamp: string; app: string; bundleId: string; text: string; cleanup: string; raw?: string | null; seconds?: number | null };
function abRows(): AbRow[] {
  if (!AB_DB || !existsSync(AB_DB)) return [];
  try {
    const db = new DatabaseSync(AB_DB, { readOnly: true });
    // SELECT *: rows written before 9 Oct have no raw/seconds columns until the node migrates the store.
    try { return db.prepare("SELECT * FROM dictations").all() as AbRow[]; }
    finally { db.close(); }
  } catch { return []; }
}
function abEntry(r: AbRow): VoiceEntry {
  return { id: r.id, timestamp: r.timestamp, app: r.app || null, bundleId: r.bundleId || null, intent: "dictation", durationSeconds: typeof r.seconds === "number" ? r.seconds : null, hasAudio: false, text: r.text, raw: r.raw || r.text, words: countWords(r.text), status: r.cleanup || null, source: "agent-base" };
}

/** Core Data stores dates as seconds since 2001-01-01; Unix wants 1970. */
const CORE_DATA_EPOCH_OFFSET = 978307200;
const LOCAL_ORIGIN = /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/;

type Row = Record<string, unknown>;

export type VoiceEntry = {
  id: number | string;
  timestamp: string;
  app: string | null;
  bundleId: string | null;
  intent: string;
  durationSeconds: number | null;
  hasAudio: boolean;
  text: string;
  raw: string;
  words: number;
  status: string | null;
  source?: "agent-base";
};

function send(res: http.ServerResponse, code: number, body: unknown) {
  res.writeHead(code, { "content-type": "application/json", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
}

const str = (v: unknown) => (typeof v === "string" ? v : "");
const num = (v: unknown) => (typeof v === "number" ? v : Number(v ?? 0));

function openDb() {
  return new DatabaseSync(HISTORY_DB, { readOnly: true });
}

/** Same tokenizer as ShareCardStats.wordCount (split on space, newline, tab, CR). */
function countWords(text: string) {
  return text ? text.split(/[ \n\t\r]+/).filter(Boolean).length : 0;
}

function textOf(row: Row) {
  const processed = str(row.ZPOSTPROCESSEDTRANSCRIPT).trim();
  return processed.length > 0 ? processed : str(row.ZRAWTRANSCRIPT);
}

function rowToEntry(row: Row): VoiceEntry {
  const text = textOf(row);
  return {
    id: num(row.Z_PK),
    timestamp: new Date((num(row.ZTIMESTAMP) + CORE_DATA_EPOCH_OFFSET) * 1000).toISOString(),
    app: str(row.ZCONTEXTAPPNAME) || null,
    bundleId: str(row.ZCONTEXTBUNDLEIDENTIFIER) || null,
    intent: str(row.ZINTENT) || "dictation",
    durationSeconds: row.ZAUDIODURATIONSECONDS == null ? null : num(row.ZAUDIODURATIONSECONDS),
    hasAudio: Boolean(row.ZAUDIOFILENAME),
    text,
    raw: str(row.ZRAWTRANSCRIPT),
    words: countWords(text),
    status: str(row.ZPOSTPROCESSINGSTATUS) || null,
  };
}

const escapeLike = (term: string) => term.replace(/[\\%_]/g, (c) => `\\${c}`);

function dayKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

/** A local yyyy-MM-dd as a [start, end) range in Core Data seconds, or null when it is not a real date. */
function dayRange(day: string): [number, number] | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!m) return null;
  const start = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  if (Number.isNaN(start.getTime()) || dayKey(start) !== day) return null;
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return [start.getTime() / 1000 - CORE_DATA_EPOCH_OFFSET, end.getTime() / 1000 - CORE_DATA_EPOCH_OFFSET];
}

function queryHistory(o: { limit: number; offset: number; q: string | null; app: string | null; range: [number, number] | null }) {
  // Agent Base's own record stands alone on a machine without SISO Voice's store.
  const db = existsSync(HISTORY_DB) ? openDb() : new DatabaseSync(":memory:");
  if (!existsSync(HISTORY_DB)) db.exec("CREATE TABLE ZPIPELINEHISTORYENTRY (Z_PK, ZTIMESTAMP, ZCONTEXTAPPNAME, ZCONTEXTBUNDLEIDENTIFIER, ZINTENT, ZAUDIODURATIONSECONDS, ZAUDIOFILENAME, ZPOSTPROCESSEDTRANSCRIPT, ZRAWTRANSCRIPT, ZPOSTPROCESSINGSTATUS)");
  try {
    const where: string[] = [];
    const params: Array<string | number> = [];
    if (o.q) {
      where.push("(ZPOSTPROCESSEDTRANSCRIPT LIKE ? ESCAPE '\\' OR ZRAWTRANSCRIPT LIKE ? ESCAPE '\\')");
      const like = `%${escapeLike(o.q)}%`;
      params.push(like, like);
    }
    if (o.app) {
      where.push("ZCONTEXTAPPNAME = ?");
      params.push(o.app);
    }
    if (o.range) {
      where.push("ZTIMESTAMP >= ? AND ZTIMESTAMP < ?");
      params.push(o.range[0], o.range[1]);
    }
    const whereSql = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";
    const total = num((db.prepare(`SELECT COUNT(*) AS n FROM ZPIPELINEHISTORYENTRY ${whereSql}`).get(...params) as Row).n);
    const rows = db
      .prepare(
        `SELECT Z_PK, ZTIMESTAMP, ZCONTEXTAPPNAME, ZCONTEXTBUNDLEIDENTIFIER, ZINTENT, ZAUDIODURATIONSECONDS, ZAUDIOFILENAME,
                ZPOSTPROCESSEDTRANSCRIPT, ZRAWTRANSCRIPT, ZPOSTPROCESSINGSTATUS
         FROM ZPIPELINEHISTORYENTRY ${whereSql} ORDER BY ZTIMESTAMP DESC LIMIT ?`,
      )
      .all(...params, o.limit + o.offset) as Row[];
    const q = o.q?.toLowerCase();
    const mine = abRows().filter((r) => {
      if (q && !r.text.toLowerCase().includes(q)) return false;
      if (o.app && r.app !== o.app) return false;
      if (o.range) { const s = Date.parse(r.timestamp) / 1000 - CORE_DATA_EPOCH_OFFSET; if (s < o.range[0] || s >= o.range[1]) return false; }
      return true;
    }).map(abEntry);
    const merged = [...rows.map(rowToEntry), ...mine].sort((a, b) => b.timestamp.localeCompare(a.timestamp)).slice(o.offset, o.offset + o.limit);
    const apps = (
      db
        .prepare(
          `SELECT ZCONTEXTAPPNAME AS app, COUNT(*) AS n FROM ZPIPELINEHISTORYENTRY
           WHERE ZCONTEXTAPPNAME IS NOT NULL AND ZCONTEXTAPPNAME != '' GROUP BY ZCONTEXTAPPNAME ORDER BY n DESC LIMIT 6`,
        )
        .all() as Row[]
    ).map((r) => ({ app: str(r.app), n: num(r.n) }));
    return { total: total + mine.length, entries: merged, apps };
  } finally {
    db.close();
  }
}

/** Mirrors ShareCardLevel.compute: level = floor(sqrt(words / 100)) + 1. */
function computeLevel(totalWords: number) {
  const base = 100;
  const words = Math.max(0, totalWords);
  const level = Math.floor(Math.sqrt(words / base)) + 1;
  const xpForCurrent = base * (level - 1) * (level - 1);
  const xpForNextLevel = base * level * level;
  const titles = ["Whisper", "Signal", "Operator", "Conductor", "Architect", "Vanguard", "Overclock", "Singularity", "Hypervisor", "JARVIS Tier"];
  return {
    level,
    title: titles[Math.min(Math.max(level - 1, 0), titles.length - 1)],
    xpInLevel: Math.max(0, words - xpForCurrent),
    xpForNext: Math.max(1, xpForNextLevel - xpForCurrent),
    wordsToNext: Math.max(0, xpForNextLevel - words),
  };
}

type Derived = {
  stats: {
    totalWords: number;
    wordsToday: number;
    entries: number;
    wpm: number | null;
    topApp: string | null;
    streakDays: number;
    timeSavedMinutes: number;
    level: ReturnType<typeof computeLevel>;
  };
  perDay: Record<string, number>;
  perDayWords: Record<string, number>;
  hourCounts: number[];
  appBreakdown: Array<{ app: string; entries: number; words: number }>;
};

let derivedCache: { key: string; value: Derived | null } = { key: "", value: null };

function cacheKey() {
  const sig = (p: string) => {
    try {
      const s = statSync(p);
      return `${s.size}:${s.mtimeMs}`;
    } catch {
      return "absent";
    }
  };
  return `${new Date().toDateString()}|${sig(HISTORY_DB)}|${sig(`${HISTORY_DB}-wal`)}|${AB_DB ? `${sig(AB_DB)}|${sig(`${AB_DB}-wal`)}` : ""}`;
}

/** One scan of the table: stats plus per-day counts. Cached on the store's signature (and the date, for today and streak). */
function computeDerived(): Derived {
  const key = cacheKey();
  if (derivedCache.key === key && derivedCache.value) return derivedCache.value;

  let rows: Row[] = [];
  const db = existsSync(HISTORY_DB) ? openDb() : null;
  if (db) try {
    rows = db.prepare("SELECT ZTIMESTAMP, ZCONTEXTAPPNAME, ZPOSTPROCESSEDTRANSCRIPT, ZRAWTRANSCRIPT, ZAUDIODURATIONSECONDS FROM ZPIPELINEHISTORYENTRY").all() as Row[];
  } finally {
    db.close();
  }
  for (const r of abRows()) rows.push({ ZTIMESTAMP: Date.parse(r.timestamp) / 1000 - CORE_DATA_EPOCH_OFFSET, ZCONTEXTAPPNAME: r.app, ZPOSTPROCESSEDTRANSCRIPT: r.text, ZRAWTRANSCRIPT: r.raw || r.text, ZAUDIODURATIONSECONDS: r.seconds ?? null });

  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  let totalWords = 0;
  let wordsToday = 0;
  // Speaking speed from takes whose length is known: their words over the minutes he spoke them.
  let timedWords = 0, spokenSeconds = 0;
  const appCounts = new Map<string, number>();
  const appWords = new Map<string, number>();
  const perDay: Record<string, number> = {};
  const perDayWords: Record<string, number> = {};
  const hourCounts = new Array<number>(24).fill(0);

  for (const row of rows) {
    const ms = (num(row.ZTIMESTAMP) + CORE_DATA_EPOCH_OFFSET) * 1000;
    const date = new Date(ms);
    const words = countWords(textOf(row));
    totalWords += words;
    const secs = row.ZAUDIODURATIONSECONDS == null ? NaN : num(row.ZAUDIODURATIONSECONDS);
    if (Number.isFinite(secs) && secs >= 1 && words > 0) { timedWords += words; spokenSeconds += secs; }
    if (ms >= startOfToday) wordsToday += words;
    const app = str(row.ZCONTEXTAPPNAME);
    if (app) {
      appCounts.set(app, (appCounts.get(app) ?? 0) + 1);
      appWords.set(app, (appWords.get(app) ?? 0) + words);
    }
    const k = dayKey(date);
    perDay[k] = (perDay[k] ?? 0) + 1;
    perDayWords[k] = (perDayWords[k] ?? 0) + words;
    hourCounts[date.getHours()] += 1;
  }

  // Until 9 Oct this was all words over the minutes between the first and the last take, ever: not a speed. Now it is
  // words over seconds actually spoken (SISO Voice's durations, and Agent Base's since 9 Oct); null until a minute is known.
  const wpm = spokenSeconds >= 60 ? Math.round(timedWords / (spokenSeconds / 60)) : null;

  let topApp: string | null = null;
  let topCount = -1;
  for (const [app, n] of appCounts) {
    if (n > topCount || (n === topCount && (topApp === null || app < topApp))) {
      topApp = app;
      topCount = n;
    }
  }

  let streakDays = 0;
  const cursor = new Date(startOfToday);
  while (perDay[dayKey(cursor)]) {
    streakDays += 1;
    cursor.setDate(cursor.getDate() - 1);
  }

  const value: Derived = {
    stats: { totalWords, wordsToday, entries: rows.length, wpm, topApp, streakDays, timeSavedMinutes: Math.max(0, Math.round(totalWords / 40 - (wpm ? totalWords / wpm : 0))), level: computeLevel(totalWords) },
    perDay,
    perDayWords,
    hourCounts,
    appBreakdown: [...appCounts.entries()]
      .map(([app, n]) => ({ app, entries: n, words: appWords.get(app) ?? 0 }))
      .sort((a, b) => b.entries - a.entries)
      .slice(0, 8),
  };
  derivedCache = { key, value };
  return value;
}

const clampInt = (raw: string | null, fallback: number, min: number, max: number) => Math.min(Math.max(Math.trunc(Number(raw)) || fallback, min), max);

/* ── preferences (com.siso.voice defaults) ─────────────────────────────── */

/*
 * Read with `defaults export` + plistlib, never `defaults read`: read octal-escapes non-ASCII ("perdón" becomes
 * "perd\363n"), which would mangle the text shown and corrupt the record on the next read-modify-write.
 */
const PLIST_READ_PY = `
import json, plistlib, subprocess, sys
out = subprocess.run(['defaults', 'export', sys.argv[1], '-'], capture_output=True, check=True).stdout
d = plistlib.loads(out)
print(json.dumps({k: d.get(k) for k in sys.argv[2:]}, default=str))
`;

export async function readPrefs(...keys: string[]): Promise<Record<string, unknown>> {
  const { stdout } = await run("python3", ["-c", PLIST_READ_PY, PREFS, ...keys], { timeout: 8000, maxBuffer: 4 * 1024 * 1024 }).catch(() => {
    throw new Error(`could not read the ${path.basename(PREFS)} preferences`);
  });
  return JSON.parse(stdout) as Record<string, unknown>;
}

type PrefType = "-string" | "-bool";
async function writePref(key: string, type: PrefType, value: string | boolean) {
  // execFile's error repeats the argv, which holds the value; say which key instead.
  await run("defaults", ["write", PREFS, key, type, String(value)], { timeout: 5000 }).catch(() => {
    throw new Error(`defaults write ${key} failed`);
  });
}

/** One write at a time: every dictionary change is a read-modify-write of one JSON string. */
let writeChain: Promise<unknown> = Promise.resolve();
function serial<T>(fn: () => Promise<T>): Promise<T> {
  const next = writeChain.then(fn, fn);
  writeChain = next.catch(() => {});
  return next;
}

type Term = { id: string; text: string; addedAt?: number };
type Rule = { id: string; from: string; to: string; enabled: boolean };
const TERMS_KEY = "siso.dictionary.terms";
const RULES_KEY = "siso.replacements.rules";
const VOCAB_KEY = "custom_vocabulary";

function jsonArray<T>(raw: unknown): T[] {
  if (typeof raw !== "string" || !raw) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? (v as T[]) : [];
  } catch {
    return [];
  }
}

const UUID = /^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}$/;
/** Swift JSONEncoder's default Date: seconds since 2001-01-01. */
const swiftNow = () => Date.now() / 1000 - CORE_DATA_EPOCH_OFFSET;

/** A one-line field: trimmed, no control characters, at most `max` long. */
function line(v: unknown, max: number, allowEmpty = false): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  if ((!allowEmpty && !t) || t.length > max || /[\u0000-\u001f\u007f]/.test(t)) return null;
  return t;
}

/** transcription_model legal values (HomeSettingsView.swift), streaming models, languages offered. */
const TRANSCRIPTION_MODELS = ["whisper-large-v3", "whisper-large-v3-turbo", "distil-whisper-large-v3-en", "gpt-4o-transcribe", "gpt-4o-mini-transcribe"];
const STREAMING_MODELS = ["", "gpt-4o-transcribe", "gpt-4o-mini-transcribe"];
const LANGUAGES = ["", "en", "es", "fr", "de", "pt", "hi"];

/** Web-writable prefs: key → type and check. Shortcuts, launch at login and the microphone stay native-only. */
const WRITABLE: Record<string, { type: PrefType; ok: (v: unknown) => boolean }> = {
  transcription_model: { type: "-string", ok: (v) => typeof v === "string" && TRANSCRIPTION_MODELS.includes(v) },
  transcription_language: { type: "-string", ok: (v) => typeof v === "string" && LANGUAGES.includes(v) },
  realtime_streaming_enabled: { type: "-bool", ok: (v) => typeof v === "boolean" },
  realtime_streaming_model: { type: "-string", ok: (v) => typeof v === "string" && STREAMING_MODELS.includes(v) },
  preserve_clipboard: { type: "-bool", ok: (v) => typeof v === "boolean" },
  alert_sounds_enabled: { type: "-bool", ok: (v) => typeof v === "boolean" },
  command_mode_enabled: { type: "-bool", ok: (v) => typeof v === "boolean" },
  edge_dock_enabled: { type: "-bool", ok: (v) => typeof v === "boolean" },
  [VOCAB_KEY]: { type: "-string", ok: (v) => typeof v === "string" && v.length <= 4000 && !/[\u0000-\u0009\u000b-\u001f]/.test(v) },
};

const isTrue = (v: unknown) => v === true || v === 1 || v === "1" || v === "true";

function suggestionsFromHistory(): string[] {
  if (!existsSync(HISTORY_DB)) return [];
  const db = openDb();
  try {
    const rows = db
      .prepare("SELECT DISTINCT ZCUSTOMVOCABULARY AS v FROM ZPIPELINEHISTORYENTRY WHERE ZCUSTOMVOCABULARY IS NOT NULL AND ZCUSTOMVOCABULARY != '' LIMIT 50")
      .all() as Row[];
    const seen = new Set<string>();
    for (const r of rows) for (const t of str(r.v).split(",")) if (t.trim()) seen.add(t.trim());
    return [...seen].slice(0, 24);
  } catch {
    return [];
  } finally {
    db.close();
  }
}

async function readDictionary() {
  const p = await readPrefs(TERMS_KEY, RULES_KEY, VOCAB_KEY);
  return { terms: jsonArray<Term>(p[TERMS_KEY]), rules: jsonArray<Rule>(p[RULES_KEY]), vocabulary: str(p[VOCAB_KEY]), suggestions: suggestionsFromHistory() };
}

async function readSettings() {
  const p = await readPrefs(
    "transcription_model", "transcription_language", "realtime_streaming_enabled", "realtime_streaming_model",
    "preserve_clipboard", "alert_sounds_enabled", "sound_volume", "command_mode_enabled", "edge_dock_enabled",
  );
  let db: { present: boolean; sizeBytes?: number; mtime?: string; entries?: number } = { present: false };
  if (existsSync(HISTORY_DB)) {
    const st = statSync(HISTORY_DB);
    // The newest write sits in the WAL until a checkpoint, so the later of the two files is "last written".
    const walMs = existsSync(`${HISTORY_DB}-wal`) ? statSync(`${HISTORY_DB}-wal`).mtimeMs : 0;
    const mtime = new Date(Math.max(st.mtimeMs, walMs)).toISOString();
    const h = openDb();
    try {
      db = { present: true, sizeBytes: st.size, mtime, entries: num((h.prepare("SELECT COUNT(*) AS n FROM ZPIPELINEHISTORYENTRY").get() as Row).n) };
    } finally {
      h.close();
    }
  }
  // Absent keys fall back the way AppState does (preserve_clipboard and the edge dock default on; alert sounds
  // follow sound_volume > 0 when unset).
  return {
    prefs: {
      transcription_model: str(p.transcription_model) || "whisper-large-v3",
      transcription_language: str(p.transcription_language),
      realtime_streaming_enabled: isTrue(p.realtime_streaming_enabled),
      realtime_streaming_model: str(p.realtime_streaming_model),
      preserve_clipboard: p.preserve_clipboard == null ? true : isTrue(p.preserve_clipboard),
      alert_sounds_enabled: p.alert_sounds_enabled == null ? Number(p.sound_volume ?? 1) > 0 : isTrue(p.alert_sounds_enabled),
      command_mode_enabled: isTrue(p.command_mode_enabled),
      edge_dock_enabled: p.edge_dock_enabled == null ? true : isTrue(p.edge_dock_enabled),
    },
    options: { transcription_model: TRANSCRIPTION_MODELS, realtime_streaming_model: STREAMING_MODELS, transcription_language: LANGUAGES },
    appliesOn: "relaunch",
    db,
  };
}

async function readJson(req: http.IncomingMessage): Promise<Record<string, unknown> | null> {
  if (!String(req.headers["content-type"] ?? "").startsWith("application/json")) return null;
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > 64 * 1024) return null;
    chunks.push(c as Buffer);
  }
  try {
    const v = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

type Answer = [number, unknown];

async function prefsRoute(req: http.IncomingMessage, url: URL): Promise<Answer | null> {
  const m = req.method ?? "GET";
  const p = url.pathname;
  const body = async () => (await readJson(req)) ?? {};
  const bad = (error: string): Answer => [400, { ok: false, error }];

  if (p === "/api/voice/dictionary" && m === "GET") return [200, await readDictionary()];
  if (p === "/api/voice/settings" && m === "GET") return [200, await readSettings()];

  if (m !== "GET" && m !== "DELETE" && !String(req.headers["content-type"] ?? "").startsWith("application/json")) return [415, { ok: false, error: "Send JSON" }];

  if (p === "/api/voice/dictionary/terms" && m === "POST") {
    const text = line((await body()).text, 200);
    if (text === null) return bad("A term is one line of 1 to 200 characters");
    return serial(async () => {
      const terms = jsonArray<Term>((await readPrefs(TERMS_KEY))[TERMS_KEY]);
      if (terms.some((t) => String(t.text).toLowerCase() === text.toLowerCase())) return [409, { ok: false, error: "That term is already there", terms }] as Answer;
      terms.push({ id: randomUUID().toUpperCase(), text, addedAt: swiftNow() });
      await writePref(TERMS_KEY, "-string", JSON.stringify(terms));
      return [200, { ok: true, terms }] as Answer;
    });
  }
  if ((p === "/api/voice/dictionary/terms" || p === "/api/voice/dictionary/rules") && m === "DELETE") {
    const id = url.searchParams.get("id") ?? "";
    if (!UUID.test(id)) return bad("id must be a UUID");
    const key = p.endsWith("terms") ? TERMS_KEY : RULES_KEY;
    const field = p.endsWith("terms") ? "terms" : "rules";
    return serial(async () => {
      const list = jsonArray<{ id: string }>((await readPrefs(key))[key]);
      const next = list.filter((x) => x.id !== id);
      if (next.length === list.length) return [404, { ok: false, error: "Not found", [field]: list }] as Answer;
      await writePref(key, "-string", JSON.stringify(next));
      return [200, { ok: true, [field]: next }] as Answer;
    });
  }
  if (p === "/api/voice/dictionary/rules" && m === "POST") {
    const b = await body();
    const from = line(b.from, 200);
    const to = line(b.to ?? "", 200, true);
    if (from === null || to === null) return bad("A rule is a one-line 'from' (1 to 200 characters) and a one-line 'to' (may be empty)");
    return serial(async () => {
      const rules = jsonArray<Rule>((await readPrefs(RULES_KEY))[RULES_KEY]);
      rules.push({ id: randomUUID().toUpperCase(), from, to, enabled: true });
      await writePref(RULES_KEY, "-string", JSON.stringify(rules));
      return [200, { ok: true, rules }] as Answer;
    });
  }
  if (p === "/api/voice/dictionary/rules/toggle" && m === "POST") {
    const id = (await body()).id;
    if (typeof id !== "string" || !UUID.test(id)) return bad("id must be a UUID");
    return serial(async () => {
      const rules = jsonArray<Rule>((await readPrefs(RULES_KEY))[RULES_KEY]);
      const rule = rules.find((r) => r.id === id);
      if (!rule) return [404, { ok: false, error: "Not found", rules }] as Answer;
      rule.enabled = !rule.enabled;
      await writePref(RULES_KEY, "-string", JSON.stringify(rules));
      return [200, { ok: true, rules }] as Answer;
    });
  }
  if (p === "/api/voice/settings" && m === "POST") {
    const b = await body();
    const key = typeof b.key === "string" ? b.key : "";
    const spec = WRITABLE[key];
    if (!spec) return bad(`"${key.slice(0, 60)}" is not a setting this page can change`);
    if (!spec.ok(b.value)) return bad(`That value is not allowed for ${key}`);
    const value = b.value as string | boolean;
    await serial(() => writePref(key, spec.type, value));
    return [200, { ok: true, key, appliesOn: "relaunch" }];
  }
  return null;
}

const HISTORY_ROUTES = ["/api/voice/history", "/api/voice/stats", "/api/voice/activity"];

/** Answers /api/voice/*; returns false for anything else so the caller carries on. */
export async function handleVoice(req: http.IncomingMessage, res: http.ServerResponse, url: URL): Promise<boolean> {
  if (!url.pathname.startsWith("/api/voice/")) return false;
  const origin = req.headers.origin;
  if (typeof origin === "string" && !LOCAL_ORIGIN.test(origin)) {
    send(res, 403, { error: "Voice is only served to this machine" });
    return true;
  }
  try {
    if (await handleTranscribe(req, res, url)) return true;
    if (await handleSpeak(req, res, url)) return true;
    if (url.pathname === "/api/voice/restart") {
      if (req.method !== "POST") send(res, 405, { error: "POST to restart SISO Voice" });
      else send(res, 200, await restartVoice());
      return true;
    }
    if (url.pathname === "/api/voice/status") {
      if (req.method !== "GET") send(res, 405, { error: "Status is read-only" });
      else send(res, 200, await voiceStatus());
      return true;
    }
    if (!HISTORY_ROUTES.includes(url.pathname)) {
      const answer = await prefsRoute(req, url);
      if (answer) send(res, answer[0], answer[1]);
      else send(res, 404, { error: `No voice route ${req.method} ${url.pathname}` });
      return true;
    }
    if (req.method !== "GET") {
      send(res, 405, { error: "History is read-only" });
      return true;
    }
    if (!existsSync(HISTORY_DB) && abRows().length === 0) {
      send(res, 503, { error: "SISO Voice's history store is not on this machine", db: false });
      return true;
    }
    if (url.pathname === "/api/voice/history") {
      const day = (url.searchParams.get("day") || "").trim();
      const range = day ? dayRange(day) : null;
      if (day && !range) {
        send(res, 400, { error: "day must be yyyy-MM-dd" });
        return true;
      }
      send(
        res,
        200,
        queryHistory({
          limit: clampInt(url.searchParams.get("limit"), 50, 1, 500),
          offset: Math.max(Math.trunc(Number(url.searchParams.get("offset"))) || 0, 0),
          q: (url.searchParams.get("q") || "").trim() || null,
          app: (url.searchParams.get("app") || "").trim() || null,
          range,
        }),
      );
      return true;
    }
    if (url.pathname === "/api/voice/stats") {
      send(res, 200, computeDerived().stats);
      return true;
    }
    const days = clampInt(url.searchParams.get("days"), 119, 7, 366);
    const { perDay, perDayWords, hourCounts, appBreakdown } = computeDerived();
    const out: Record<string, number> = {};
    const words: Record<string, number> = {};
    const cursor = new Date();
    for (let i = 0; i < days; i += 1) {
      const k = dayKey(cursor);
      if (perDay[k]) out[k] = perDay[k];
      if (perDayWords[k]) words[k] = perDayWords[k];
      cursor.setDate(cursor.getDate() - 1);
    }
    send(res, 200, { days: out, words, hours: hourCounts, apps: appBreakdown });
    return true;
  } catch (e) {
    // The message names SQL, a path or a command, never transcript or dictionary text.
    const msg = e instanceof Error ? e.message.split("\n")[0].slice(0, 200) : "unknown";
    send(res, 500, { error: `Voice store failed: ${msg}` });
    return true;
  }
}
