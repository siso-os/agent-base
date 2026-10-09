/** Agent Base's own dictations. No access to SISO Voice's history or recordings. */
import { appendFileSync, chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import type http from "node:http";
import { homedir, hostname } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { readAudio, transcribeAudio } from "./voice-transcribe.ts";
import { readPrefs } from "./voice.ts";
import { checkVoiceServices } from "./voice-health.ts";
import { cleanupDictation } from "./dictation-cleanup.ts";
import { audioSeconds, dropEchoedVocabulary, peakDb } from "./dictation-audio.ts";
import { barShown, dictationOwner, nativeState, ownershipBusy, rev, setBar, switchOwner, updateNative, waitForChange } from "./dictation-owner.ts";

const root = process.env.AB_DICTATION_DIR || path.join(homedir(), ".local/state/agent-base/dictation");
let db: DatabaseSync | null = null;
function history() {
  if (!db) {
    mkdirSync(root, { recursive: true, mode: 0o700 });
    const file = path.join(root, "history.sqlite");
    db = new DatabaseSync(file); chmodSync(file, 0o600);
    db.exec("CREATE TABLE IF NOT EXISTS dictations (id TEXT PRIMARY KEY, timestamp TEXT NOT NULL, app TEXT NOT NULL, bundleId TEXT NOT NULL, text TEXT NOT NULL, cleanup TEXT NOT NULL)");
    // 9 Oct (VOICE): the words before cleanup, how long he spoke, how long writing took, and the model, so History can
    // show what he really said and Stats can count real speaking speed. Older rows keep NULLs.
    const have = new Set((db.prepare("SELECT name FROM pragma_table_info('dictations')").all() as Array<{ name: string }>).map((c) => c.name));
    for (const [name, type] of [["raw", "TEXT"], ["seconds", "REAL"], ["ms", "INTEGER"], ["model", "TEXT"]]) if (!have.has(name)) db.exec(`ALTER TABLE dictations ADD COLUMN ${name} ${type}`);
  }
  return db;
}
const TERMS_KEY = "siso.dictionary.terms";
const RULES_KEY = "siso.replacements.rules";
function listOf<T>(raw: unknown): T[] {
  try { const v = typeof raw === "string" ? JSON.parse(raw) : raw; return Array.isArray(v) ? v as T[] : []; } catch { return []; }
}
/** "heard → write" rules, whole words, any case; the ones he switched off are skipped. */
export function applyRules(text: string, rules: Array<{ from?: unknown; to?: unknown; enabled?: unknown }>) {
  let out = text;
  for (const r of rules) {
    if (r.enabled === false || typeof r.from !== "string" || typeof r.to !== "string" || !r.from.trim()) continue;
    const from = r.from.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    out = out.replace(new RegExp(`(?<![\\p{L}\\p{N}])${from}(?![\\p{L}\\p{N}])`, "giu"), () => r.to as string);
  }
  return out;
}
let phase = "idle";
let error = "";
const send = (res: http.ServerResponse, status: number, body: unknown) => { res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" }); res.end(JSON.stringify(body)); };
async function jsonBody(req: http.IncomingMessage) {
  let bytes = 0; const chunks: Buffer[] = [];
  for await (const chunk of req) { bytes += chunk.length; if (bytes > 8192) throw new Error("Request is too large"); chunks.push(chunk); }
  return JSON.parse(Buffer.concat(chunks).toString()) as Record<string, unknown>;
}
const SAVED = "Saved. Groq didn't answer, so I'm writing it down in the background; it lands in Voice → History";
const pending = path.join(root, "pending");
const outbox = process.env.AB_VOICE_OUTBOX || path.join(homedir(), ".siso", "voice-outbox.ndjson");
type Take = { id: string; at: string; app: string; bundleId: string; tries: number; next?: number };
function keep(take: Take, audio: Buffer): boolean {
  try {
    mkdirSync(pending, { recursive: true, mode: 0o700 });
    const wav = path.join(pending, `${take.id}.wav`), meta = path.join(pending, `${take.id}.json`);
    // A retry must never truncate the only saved copy if disk space runs out.
    if (!existsSync(wav)) {
      writeFileSync(`${wav}.next`, audio, { mode: 0o600 });
      renameSync(`${wav}.next`, wav);
    }
    writeFileSync(`${meta}.next`, JSON.stringify(take), { mode: 0o600 });
    renameSync(`${meta}.next`, meta);
    return true;
  } catch { return false; /* A full disk still transcribes from memory; never acknowledge durable storage. */ }
}
function forget(id: string) { for (const ext of ["wav", "json"]) { try { unlinkSync(path.join(pending, `${id}.${ext}`)); } catch {} } }
/** Preserve rejected recordings before removing queue metadata, including failures during a retry. */
function retainUnreadable(id: string) {
  try {
    mkdirSync(path.join(root, "unreadable"), { recursive: true, mode: 0o700 });
    renameSync(path.join(pending, `${id}.wav`), path.join(root, "unreadable", `${id}.wav`));
    forget(id);
  } catch { /* Leave the queued original in place when archival storage is unavailable. */ }
}
/** One line per dictation for JARVIS (voice-sync drains it), as SISO Voice's SpineOutbox wrote: text only, never audio. */
function toOutbox(take: Take, raw: string, text: string, model: unknown) {
  try {
    mkdirSync(path.dirname(outbox), { recursive: true });
    const line: Record<string, unknown> = { app_name: take.app, captured_at: take.at, client_id: take.id, intent: "dictation", machine: hostname().replace(/\.local$/, ""), raw_transcript: raw, word_count: raw.split(/\s+/).filter(Boolean).length };
    if (take.bundleId) line.bundle_id = take.bundleId;
    if (text && text !== raw) line.cleaned_transcript = text;
    if (typeof model === "string") line.model = model;
    appendFileSync(outbox, JSON.stringify(line, Object.keys(line).sort()) + "\n", { mode: 0o600 });
  } catch {}
}
/**
 * One line per take in takes.jsonl (never the words, never the audio): when, how long, how loud, what happened. It is the
 * record that says "pressed but heard nothing" (9 Oct ~05:50, Shaan: "voice app is brokens its not hearing naything"),
 * which no log had: a silent take lands nowhere else. The last 40 stay in memory for the status line.
 */
export type TakeLine = { at: string; id: string; app: string; seconds: number; peakDb: number | null; outcome: "written" | "silent" | "no-speech" | "queued" | "rejected" | "duplicate"; ms: number; retry: boolean; error?: string };
const takesFile = path.join(root, "takes.jsonl");
const recentTakes: TakeLine[] = (() => {
  try {
    const size = statSync(takesFile).size, text = readFileSync(takesFile, "utf8");
    // Keep the file small: past 2 MB only the newest thousand lines are kept.
    const lines = text.split("\n").filter(Boolean);
    if (size > 2 * 1024 * 1024) writeFileSync(takesFile, lines.slice(-1000).join("\n") + "\n", { mode: 0o600 });
    return lines.slice(-40).map((l) => JSON.parse(l) as TakeLine);
  } catch { return []; }
})();
function logTake(line: TakeLine) {
  recentTakes.push(line); if (recentTakes.length > 40) recentTakes.shift();
  try { mkdirSync(root, { recursive: true, mode: 0o700 }); appendFileSync(takesFile, JSON.stringify(line) + "\n", { mode: 0o600 }); } catch {}
  console.log(`dictation: ${line.outcome}${line.retry ? " (retry)" : ""} · ${line.seconds}s · peak ${line.peakDb ?? "?"} dB · ${line.ms} ms${line.error ? ` · ${line.error.slice(0, 120)}` : ""}`);
}
let busyTakes = 0;
/** Resolves when no take is being written (or after `ms`): the node waits for this before it exits on a deploy. */
export async function dictationSettled(ms: number) {
  const end = Date.now() + ms;
  while (busyTakes > 0 && Date.now() < end) await new Promise((r) => setTimeout(r, 100));
}

/** Transcribe, clean and record one take; Groq failures are retried, and the audio stays on disk until one works. */
/**
 * Takes being written now, by id. The route keeps a take on disk before Groq answers, so the minute sweep can find a take
 * that is still in flight; it leaves those alone, and a second copy of the same take waits for the first, then is dropped.
 */
const inFlight = new Map<string, Promise<unknown>>();
async function finish(take: Take, audio: Buffer | "too-big", attempts: number, retry = false): Promise<{ entry?: Record<string, unknown>; queued?: boolean; status: number; error: string }> {
  for (let ahead = inFlight.get(take.id); ahead; ahead = inFlight.get(take.id)) await ahead.catch(() => {});
  let settle = () => {};
  inFlight.set(take.id, new Promise<void>((r) => (settle = r)));
  busyTakes++;
  const started = Date.now();
  const bytes = audio === "too-big" ? null : audio;
  const line = (outcome: TakeLine["outcome"], error = "") => logTake({ at: take.at, id: take.id, app: take.app, seconds: bytes ? Math.round(audioSeconds(bytes) * 10) / 10 : 0, peakDb: bytes ? peakDb(bytes) : null, outcome, ms: Date.now() - started, retry, ...(error ? { error } : {}) });
  try {
    // One take, one row: the helper names its take (?id=), so its own saved copy and the node's (a deploy cut the answer)
    // share the id, and whichever is written second is dropped (9 Oct 04:38: a 3-minute note landed twice, an hour late).
    const known = history().prepare("SELECT * FROM dictations WHERE id = ?").get(take.id) as Record<string, unknown> | undefined;
    if (known) { forget(take.id); line("duplicate"); return { entry: known, status: 200, error: "" }; }
    const done = await write(take, audio, attempts, started);
    line(done.entry ? "written" : done.queued ? "queued" : done.status === 422 ? (/silence/i.test(done.error) ? "silent" : "no-speech") : "rejected", done.entry ? "" : done.error);
    return done;
  } finally { busyTakes--; inFlight.delete(take.id); settle(); }
}
async function write(take: Take, audio: Buffer | "too-big", attempts: number, started = Date.now()): Promise<{ entry?: Record<string, unknown>; queued?: boolean; status: number; error: string }> {
  const prefs = await readPrefs("post_processing_enabled", "custom_vocabulary", "custom_system_prompt", "output_language", "post_processing_model", "post_processing_fallback_model", "post_processing_api_url", TERMS_KEY, RULES_KEY).catch(() => ({} as Record<string, unknown>));
  // The Dictionary does something here: its spellings join the vocabulary, its rules rewrite the final text.
  const spellings = [typeof prefs.custom_vocabulary === "string" ? prefs.custom_vocabulary : "", ...listOf<{ text?: unknown }>(prefs[TERMS_KEY]).map((t) => typeof t.text === "string" ? t.text : "")].map((t) => t.trim()).filter(Boolean).join(", ");
  prefs.custom_vocabulary = spellings;
  let result = await transcribeAudio(audio, spellings);
  for (let i = 1; i < attempts && result.body.retry; i++) { await new Promise((r) => setTimeout(r, 1500)); result = await transcribeAudio(audio, spellings); }
  if (result.status !== 200 || !result.body.text) {
    if ((result.body.retry || result.body.code === "no-key") && audio !== "too-big" && audio.length) {
      take.tries += attempts; take.next = Date.now() + retryGap(take.tries);
      if (!keep(take, audio)) return { status: 507, error: "The recording could not be queued on disk. Keep the original and check free space." };
      scheduleRetry(); return { queued: true, status: 202, error: result.body.error || "Groq did not answer" };
    }
    if (result.body.silent) forget(take.id);
    else retainUnreadable(take.id);
    return { status: result.status === 200 ? 422 : result.status, error: result.body.error || (result.body.silent ? "Only silence was heard; nothing was pasted" : "No speech was recognized") };
  }
  const cleaned = await cleanupDictation(result.body.text, prefs, take.app);
  // The cleanup model is given the same spellings and can echo them too (t-0553).
  cleaned.text = applyRules(dropEchoedVocabulary(cleaned.text, spellings), listOf<{ from?: unknown; to?: unknown; enabled?: unknown }>(prefs[RULES_KEY]));
  const entry = { id: take.id, timestamp: take.at, app: take.app, bundleId: take.bundleId, ...cleaned };
  const seconds = audio === "too-big" ? null : Math.round(audioSeconds(audio) * 10) / 10;
  history().prepare("INSERT OR REPLACE INTO dictations (id, timestamp, app, bundleId, text, cleanup, raw, seconds, ms, model) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .run(entry.id, entry.timestamp, take.app, take.bundleId, entry.text, entry.cleanup, result.body.text, seconds, Date.now() - started, typeof result.body.model === "string" ? result.body.model : null);
  toOutbox(take, result.body.text, entry.text, result.body.model);
  forget(take.id);
  return { entry, status: 200, error: "" };
}
const retryGap = (tries: number) => Math.min(10 * 60_000, (Number(process.env.AB_DICTATION_RETRY_MS) || 30_000) * 2 ** Math.max(0, Math.floor(tries / 2) - 1));
let retryTimer: NodeJS.Timeout | null = null, retrying = false;
function scheduleRetry(ms = Number(process.env.AB_DICTATION_RETRY_MS) || 30_000) {
  if (retryTimer) return;
  retryTimer = setTimeout(() => { retryTimer = null; void retryPending(); }, ms); retryTimer.unref();
}
/** Every saved take (the node's, or the helper's when the node was down) is tried again until Groq writes it down. */
export async function retryPending() {
  if (retrying) return; retrying = true;
  let left = 0;
  try {
    let files: string[] = [];
    try { files = readdirSync(pending).filter((f) => f.endsWith(".wav")); } catch { /* No queue yet, or its storage is unavailable. */ }
    for (const file of files) {
      const id = file.slice(0, -4), meta = path.join(pending, `${id}.json`);
      let take: Take;
      try { take = { tries: 0, ...JSON.parse(readFileSync(meta, "utf8")), id }; }
      catch { take = { id, at: new Date().toISOString(), app: "Unknown app", bundleId: "", tries: 0 }; }
      if ((take.next && take.next > Date.now()) || inFlight.has(id)) { left++; continue; }
      let audio: Buffer;
      try { audio = readFileSync(path.join(pending, file)); } catch { continue; }
      const done = await finish(take, audio, 1, true);
      if (done.queued) left++;
      else if (!done.entry && existsSync(path.join(pending, file))) left++;
    }
  } finally { retrying = false; }
  if (left) scheduleRetry();
}
if (process.env.AB_DICTATION_RETRY !== "0") {
  setTimeout(() => void retryPending(), 3000).unref();
  // And a look every minute: a take saved by the helper while this node was down (a deploy) has no timer of its own.
  // Before 9 Oct a retry ran only at start and after a failure, so such a take waited for the next deploy.
  setInterval(() => void retryPending(), Number(process.env.AB_DICTATION_SWEEP_MS) || 60_000).unref();
}

const VOICE_LOG = process.env.AB_VOICE_LOG || path.join(homedir(), "Library/Logs/com.siso.agent-base/voice.log");
/** The last lines of the helper's log (text-free by construction: it never writes his words). */
function logTail(n: number) {
  try {
    const size = statSync(VOICE_LOG).size, start = Math.max(0, size - 64 * 1024);
    const text = readFileSync(VOICE_LOG).subarray(start).toString("utf8");
    return text.split("\n").filter(Boolean).slice(-n);
  } catch { return []; }
}
/** GET /api/dictation/diagnostics: Settings → Diagnostics. The self-check, the helper, the last takes, the queue, the log. */
export function diagnostics() {
  let queue: Array<{ id: string; at: string; app: string; tries: number; next: string | null; kb: number }> = [];
  try {
    queue = readdirSync(pending).filter((f) => f.endsWith(".wav")).map((f) => {
      const id = f.slice(0, -4);
      let meta: Partial<Take> = {};
      try { meta = JSON.parse(readFileSync(path.join(pending, `${id}.json`), "utf8")); } catch {}
      return { id, at: meta.at ?? "", app: meta.app ?? "Unknown app", tries: meta.tries ?? 0, next: meta.next ? new Date(meta.next).toISOString() : null, kb: Math.round(statSync(path.join(pending, f)).size / 1024) };
    });
  } catch {}
  return { health: dictationHealth(), native: nativeState, owner: dictationOwner(), takes: recentTakes.slice(-20).reverse(), queue, log: logTail(40) };
}
const pendingCount = () => { try { return readdirSync(pending).filter((f) => f.endsWith(".wav")).length; } catch { return 0; } };
/**
 * Whether voice is really working, in one line (9 Oct): the helper checking in, its hotkey tap, the mic, the takes.
 * `level` ok · warn (it works, something waits) · bad (he would talk and nothing would land).
 */
export function dictationHealth() {
  const fresh = Date.now() - nativeState.updatedAt < 30_000;
  const last = recentTakes.at(-1);
  let silentRun = 0;
  for (let i = recentTakes.length - 1; i >= 0 && (recentTakes[i].outcome === "silent" || recentTakes[i].outcome === "no-speech"); i--) if (!recentTakes[i].retry) silentRun++;
  const deadMic = silentRun > 0 && recentTakes.slice(-silentRun).every((t) => (t.peakDb ?? 0) <= -90);
  const queued = pendingCount();
  const device = nativeState.device ? ` (${nativeState.device})` : "";
  const problem =
    dictationOwner() !== "agent-base" ? null
    : !fresh ? { level: "bad", line: nativeState.updatedAt ? "The voice helper stopped checking in. It restarts itself; if this stays, quit and reopen Agent Base." : "The voice helper is not running." }
    : !nativeState.registered || !nativeState.permission ? { level: "bad", line: nativeState.error || "The voice helper is waiting for permission." }
    : nativeState.tap === false ? { level: "bad", line: "The hotkey stopped reaching Voice; it is reconnecting." }
    : nativeState.mic === "denied" ? { level: "bad", line: "Microphone access is off for Agent Base Voice: System Settings → Privacy & Security → Microphone." }
    : deadMic && silentRun >= 1 ? { level: "bad", line: `The mic${device} sent nothing on your last ${silentRun === 1 ? "take" : `${silentRun} takes`}. Check System Settings → Sound → Input.` }
    : silentRun >= 2 ? { level: "warn", line: `Your last ${silentRun} takes heard no speech${device}. Is the right mic picked in System Settings → Sound → Input?` }
    : queued ? { level: "warn", line: `${queued === 1 ? "One recording is" : `${queued} recordings are`} waiting for Groq; retrying every minute.` }
    : nativeState.issue ? { level: "warn", line: nativeState.issue }
    : null;
  return { level: problem?.level ?? "ok", line: problem?.line ?? "", pending: queued, device: nativeState.device || "", lastTake: last ? { at: last.at, outcome: last.outcome, seconds: last.seconds } : null };
}

export async function handleDictation(req: http.IncomingMessage, res: http.ServerResponse, url: URL) {
  if (!url.pathname.startsWith("/api/dictation/")) return false;
  // Only the same app origin or native loopback process may change ownership or read dictations.
  if (req.headers.origin && req.headers.origin !== `http://${req.headers.host}`) { send(res, 403, { error: "Dictation is only served to this app" }); return true; }
  try {
    if (url.pathname === "/api/dictation/status" && req.method === "GET") {
      const since = url.searchParams.get("rev");
      if (since !== null && /^-?\d+$/.test(since)) await waitForChange(Number(since));
      send(res, 200, { owner: dictationOwner(), switching: ownershipBusy(), phase, error, native: nativeState, hotkey: "Fn / 🌐 hold · Right ⌥ toggle", bar: barShown(), rev, health: dictationHealth() });
    } else if (url.pathname === "/api/dictation/bar" && req.method === "POST") {
      const value = await jsonBody(req);
      if (typeof value.bar !== "boolean") { send(res, 400, { error: "bar must be a boolean" }); return true; }
      setBar(value.bar); send(res, 200, { bar: barShown() });
    } else if (url.pathname === "/api/dictation/owner" && req.method === "POST") {
      const value = await jsonBody(req);
      if (!["agent-base", "siso-voice"].includes(String(value.owner))) { send(res, 400, { error: "Choose Agent Base or SISO Voice" }); return true; }
      try { await switchOwner(value.owner as "agent-base" | "siso-voice", checkVoiceServices); phase = "idle"; error = ""; send(res, 200, { owner: dictationOwner() }); }
      catch (e) { send(res, 409, { error: (e as Error).message, owner: dictationOwner() }); }
    } else if (url.pathname === "/api/dictation/native" && req.method === "POST") {
      const value = await jsonBody(req);
      if (typeof value.registered !== "boolean") { send(res, 400, { error: "registered must be a boolean" }); return true; }
      const text = (k: string) => typeof value[k] === "string" ? value[k] as string : undefined;
      updateNative({ registered: value.registered, permission: value.permission === true, error: text("error") ?? "", tap: typeof value.tap === "boolean" ? value.tap : undefined, mic: text("mic"), device: text("device"), issue: text("issue") }); send(res, 200, { ok: true });
    } else if (url.pathname === "/api/dictation/events" && req.method === "POST") {
      const value = await jsonBody(req);
      if (!["idle", "starting", "recording", "transcribing", "pasting", "error"].includes(String(value.phase))) { send(res, 400, { error: "Unknown dictation phase" }); return true; }
      phase = String(value.phase); error = typeof value.error === "string" ? value.error.slice(0, 250) : ""; send(res, 200, { ok: true });
    } else if (url.pathname === "/api/dictation/diagnostics" && req.method === "GET") {
      send(res, 200, diagnostics());
    } else if (url.pathname === "/api/dictation/retry" && req.method === "POST") {
      // His "Retry now": every waiting take is tried at once, whatever its backoff said.
      for (const file of (() => { try { return readdirSync(pending).filter((f) => f.endsWith(".json")); } catch { return []; } })()) {
        try { const meta = path.join(pending, file); const t = JSON.parse(readFileSync(meta, "utf8")); delete t.next; writeFileSync(meta, JSON.stringify(t), { mode: 0o600 }); } catch {}
      }
      await retryPending(); send(res, 200, diagnostics());
    } else if (url.pathname === "/api/dictation/history" && req.method === "GET") {
      const q = (url.searchParams.get("q") || "").slice(0, 500);
      const day = url.searchParams.get("day") || "";
      const escaped = q.replace(/[\\%_]/g, (c) => `\\${c}`);
      const entries = history().prepare("SELECT * FROM dictations WHERE (text LIKE ? ESCAPE '\\' OR app LIKE ? ESCAPE '\\') AND (? = '' OR substr(timestamp,1,10) = ?) ORDER BY timestamp DESC LIMIT 200").all(`%${escaped}%`, `%${escaped}%`, day, day);
      const total = history().prepare("SELECT COUNT(*) AS total FROM dictations").get()?.total;
      send(res, 200, { entries, total });
    } else if (url.pathname === "/api/dictation/transcribe" && req.method === "POST") {
      if (dictationOwner() !== "agent-base" || ownershipBusy()) { send(res, 409, { error: "Dictation still runs in SISO Voice" }); return true; }
      // Two takes at once both land: a second note is never refused because the first is still being written (t-0506).
      const quiet = url.searchParams.get("quiet") === "1";
      if (!quiet) { phase = "transcribing"; error = ""; }
      const audio = await readAudio(req);
      const named = url.searchParams.get("id") || "";
      const take: Take = { id: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(named) ? named : randomUUID(), at: new Date().toISOString(), app: (url.searchParams.get("app") || "Unknown app").slice(0, 150), bundleId: (url.searchParams.get("bundleId") || "").slice(0, 250), tries: 0 };
      // The recording is on disk before Groq is asked, so a timeout or a crash never loses it.
      if (audio !== "too-big" && audio.length) keep(take, audio);
      const done = await finish(take, audio, 2);
      if (done.entry) { if (!quiet) phase = "pasting"; send(res, 200, done.entry); }
      else if (done.queued) { if (!quiet) { phase = "error"; error = SAVED; } send(res, 202, { queued: true, id: take.id, error: SAVED, why: done.error }); }
      else { if (!quiet) { phase = "error"; error = done.error; } send(res, done.status, { error: done.error }); }
    } else { send(res, 404, { error: "No dictation route" }); }
  } catch { if (url.searchParams.get("quiet") !== "1") { phase = "error"; error = "Dictation request failed"; } send(res, 400, { error: "Dictation request failed" }); }
  return true;
}
