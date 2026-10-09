/**
 * Voice to text for the app's mic (t-0100): audio in, text out, through Groq with SISO Voice's own key.
 *
 * SISO Voice (personal/apps/freeflow) and SISO Internal (api/voice-local-routes.js) both transcribe with Groq's
 * Whisper (`/openai/v1/audio/transcriptions`); his "grok key" is that Groq key. SISO Voice keeps it in
 * ~/Library/Application Support/SISO Voice/.settings (JSON, `groq_api_key`, mode 0600). This node reads the same
 * record at each request, as SISO Internal does: the key never reaches the browser, a log, a reply or another file.
 *
 *   GET  /api/voice/transcribe   {ready, model} or {ready: false, code: "no-key", error}; never the key
 *   POST /api/voice/transcribe   the raw recording as the body (webm, ogg, wav, mp4/m4a, mp3 or flac, up to 24 MB)
 *     200 {text, provider: "groq", model, ms}
 *     400 empty or not audio · 413 too long · 503 no key on this machine (code "no-key") · 502 Groq refused or is down
 *
 * GROQ_API_KEY, when set, wins over the record (SISO Internal's order). For tests: AB_VOICE_SETTINGS points at another
 * .settings file, AB_GROQ_URL at a fake Groq, AB_GROQ_STT_MODEL picks the model.
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import type http from "node:http";
import { homedir } from "node:os";
import path from "node:path";
import { dropEchoedVocabulary, dropHallucinations, timeoutFor, trimSilence, type Segment } from "./dictation-audio.ts";

const SETTINGS = process.env.AB_VOICE_SETTINGS || path.join(homedir(), "Library", "Application Support", "SISO Voice", ".settings");
const GROQ_URL = process.env.AB_GROQ_URL || "https://api.groq.com/openai/v1/audio/transcriptions";
const MODEL = process.env.AB_GROQ_STT_MODEL || "whisper-large-v3-turbo";
const MAX_BYTES = 24 * 1024 * 1024;
const NO_KEY =
  "No Groq key on this machine. SISO Voice keeps it in ~/Library/Application Support/SISO Voice/.settings; add it in SISO Voice's Settings, then try again.";

export function groqKey(): string | null {
  if (process.env.GROQ_API_KEY) return process.env.GROQ_API_KEY;
  try {
    const key = JSON.parse(readFileSync(SETTINGS, "utf8")).groq_api_key;
    return typeof key === "string" && key.trim() ? key.trim() : null;
  } catch {
    return null;
  }
}

/** What the bytes are, read from their first bytes (the browser's content type is a hint, not proof). */
export function sniffAudio(b: Buffer): { ext: string; type: string } | null {
  const at = (i: number, s: string) => b.length >= i + s.length && b.toString("latin1", i, i + s.length) === s;
  if (b.length >= 4 && b.readUInt32BE(0) === 0x1a45dfa3) return { ext: "webm", type: "audio/webm" };
  if (at(0, "OggS")) return { ext: "ogg", type: "audio/ogg" };
  if (at(0, "RIFF") && at(8, "WAVE")) return { ext: "wav", type: "audio/wav" };
  if (at(4, "ftyp")) return { ext: "m4a", type: "audio/mp4" };
  if (at(0, "fLaC")) return { ext: "flac", type: "audio/flac" };
  if (at(0, "ID3") || (b.length >= 2 && b[0] === 0xff && (b[1] & 0xe0) === 0xe0)) return { ext: "mp3", type: "audio/mpeg" };
  return null;
}

function send(res: http.ServerResponse, code: number, body: unknown) {
  res.writeHead(code, { "content-type": "application/json", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
}

export function readAudio(req: http.IncomingMessage): Promise<Buffer | "too-big"> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let n = 0;
    let over = false;
    req.on("data", (c: Buffer) => {
      if (over) return;
      n += c.length;
      if (n > MAX_BYTES) {
        over = true;
        chunks.length = 0;
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => resolve(over ? "too-big" : Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

/** Groq's own error message (it names the problem, never the key), cut short. */
async function groqError(r: Response) {
  const raw = await r.text().catch(() => "");
  let msg = raw;
  try {
    msg = JSON.parse(raw)?.error?.message ?? raw;
  } catch {}
  return String(msg).replace(/\s+/g, " ").trim().slice(0, 200);
}

const MODELS_URL = process.env.AB_GROQ_MODELS_URL || new URL("/openai/v1/models", GROQ_URL).toString();
const keySource = () => (process.env.GROQ_API_KEY ? "env" : groqKey() ? "file" : null);
/**
 * /api/voice/key (9 Oct, VOICE; STANDALONE.md "Bring your own Groq key"): GET says whether a key is saved and where, never
 * the key; POST {key} asks Groq first and saves only a key Groq accepts, into the same 0600 settings record the node reads;
 * DELETE removes it. The key is never echoed, logged or sent anywhere but Groq.
 */
async function handleKey(req: http.IncomingMessage, res: http.ServerResponse) {
  if (req.headers.origin && req.headers.origin !== `http://${req.headers.host}`) return send(res, 403, { error: "Only this app can change the key" });
  const read = () => { try { return JSON.parse(readFileSync(SETTINGS, "utf8")) as Record<string, unknown>; } catch { return {}; } };
  const save = (record: Record<string, unknown>) => {
    mkdirSync(path.dirname(SETTINGS), { recursive: true, mode: 0o700 });
    writeFileSync(`${SETTINGS}.tmp`, JSON.stringify(record), { mode: 0o600 });
    renameSync(`${SETTINGS}.tmp`, SETTINGS);
  };
  if (req.method === "GET") return send(res, 200, { saved: !!groqKey(), source: keySource() });
  if (req.method === "DELETE") { const r = read(); delete r.groq_api_key; save(r); return send(res, 200, { saved: !!groqKey(), source: keySource() }); }
  if (req.method !== "POST") return send(res, 405, { error: "GET, POST or DELETE" });
  const chunks: Buffer[] = [];
  for await (const c of req) { chunks.push(c as Buffer); if (chunks.reduce((n, b) => n + b.length, 0) > 4096) return send(res, 413, { error: "Too long for a key" }); }
  let key = "";
  try { key = String(JSON.parse(Buffer.concat(chunks).toString("utf8")).key ?? "").trim(); } catch { return send(res, 400, { error: "Send {key}" }); }
  if (!/^[A-Za-z0-9_-]{20,200}$/.test(key)) return send(res, 400, { error: "That does not look like a Groq key (they start gsk_)." });
  let status = 0;
  try { status = (await fetch(MODELS_URL, { headers: { authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(10_000) })).status; }
  catch { return send(res, 502, { error: "Could not reach Groq to check the key; nothing was saved." }); }
  if (status === 401 || status === 403) return send(res, 400, { error: "Groq refused this key; nothing was saved." });
  if (status !== 200) return send(res, 502, { error: `Groq answered ${status}; nothing was saved.` });
  save({ ...read(), groq_api_key: key });
  return send(res, 200, { saved: true, source: keySource(), checked: new Date().toISOString(), envWins: !!process.env.GROQ_API_KEY });
}

/** Answers /api/voice/transcribe and /api/voice/key; false for anything else. */
export async function handleTranscribe(req: http.IncomingMessage, res: http.ServerResponse, url: URL): Promise<boolean> {
  if (url.pathname === "/api/voice/key") { await handleKey(req, res); return true; }
  if (url.pathname !== "/api/voice/transcribe") return false;
  if (req.method === "GET") {
    send(res, 200, groqKey() ? { ready: true, provider: "groq", model: MODEL } : { ready: false, code: "no-key", error: NO_KEY });
    return true;
  }
  if (req.method !== "POST") {
    send(res, 405, { error: "POST the recording" });
    return true;
  }
  const result = await transcribeAudio(await readAudio(req));
  send(res, result.status, result.body);
  return true;
}

/** Shared native/browser path: the key remains in this module. */
export async function transcribeAudio(audio: Buffer | "too-big", vocabulary = ""): Promise<{ status: number; body: { text?: string; error?: string; [key: string]: unknown } }> {
  if (audio === "too-big") return { status: 413, body: { error: "That recording is over 24 MB; keep it under about twelve minutes" } };
  if (!audio.length) return { status: 400, body: { error: "No audio arrived" } };
  const kind = sniffAudio(audio);
  if (!kind) return { status: 400, body: { error: "That is not audio Groq can read (webm, ogg, wav, mp4/m4a, mp3 or flac)", code: "not-audio" } };
  const key = groqKey();
  if (!key) return { status: 503, body: { error: NO_KEY, code: "no-key" } };

  // Silence is cut first; a recording with no speech never reaches Groq, so it cannot come back as "Thank you".
  const trimmed = trimSilence(audio);
  if (trimmed.silent) return { status: 200, body: { text: "", provider: "groq", model: MODEL, ms: 0, silent: true } };
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(trimmed.audio)], { type: kind.type }), `voice.${kind.ext}`);
  form.append("model", MODEL);
  form.append("response_format", "verbose_json");
  if (vocabulary.trim()) form.append("prompt", vocabulary.slice(0, 4000));
  const t0 = Date.now(), wait = timeoutFor(trimmed.audio);
  let r: Response;
  try {
    r = await fetch(GROQ_URL, { method: "POST", headers: { authorization: `Bearer ${key}` }, body: form, signal: AbortSignal.timeout(wait) });
  } catch (e) {
    // In his words: a timeout is Groq being slow; anything else is almost always this Mac being offline.
    const why = e instanceof Error && e.name === "TimeoutError" ? `no answer in ${Math.round(wait / 1000)} s` : "is the internet down?";
    return { status: 502, body: { error: `Could not reach Groq to write it down (${why})`, code: "offline", retry: true } };
  }
  if (!r.ok) {
    const msg = (await groqError(r)).replaceAll(key, "[redacted]");
    const hint = r.status === 401 ? " (the key in SISO Voice's settings was refused)" : r.status === 429 ? " (rate limit; try again in a moment)" : "";
    return { status: 502, body: { error: `Groq said ${r.status}${hint}${msg ? `: ${msg}` : ""}`, status: r.status, retry: r.status !== 400 && r.status !== 413 } };
  }
  const out = (await r.json().catch(() => null)) as { text?: unknown; segments?: Segment[] } | null;
  if (!out || typeof out.text !== "string") return { status: 502, body: { error: "Groq answered without text", retry: true } };
  const text = dropEchoedVocabulary(dropHallucinations(out.text, out.segments, trimmed.speechSeconds), vocabulary);
  return { status: 200, body: { text, provider: "groq", model: MODEL, ms: Date.now() - t0, seconds: Math.round(trimmed.seconds * 10) / 10 } };
}
