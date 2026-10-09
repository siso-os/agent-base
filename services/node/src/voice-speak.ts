/**
 * Text to speech for the speaker toggle (t-0270, Shaan 3 Oct 01:35: "look into a voice mode ... text-to-speech ...
 * Groq with a q ... same people we use for speech to text"): one sentence in, a WAV out. Groq's Orpheus voice with
 * SISO Voice's key (voice-transcribe.ts reads it; it never leaves this process), and macOS `say` when there is no key
 * or Groq fails, so the toggle always speaks. The page chunks a reply into sentences under 200 characters and plays
 * them in turn; stopping is the page's (it drops the queue and the audio).
 *
 *   POST /api/voice/speak  {text}   200 audio/wav, header x-voice-provider: groq | say
 *     400 no text or over 400 characters · 502 neither Groq nor say could speak it
 *
 * For tests: AB_GROQ_TTS_URL points at a fake Groq, AB_SAY at a fake `say`, AB_GROQ_TTS_MODEL and AB_GROQ_TTS_VOICE
 * pick the model and voice.
 */
import { execFile } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import type http from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { groqKey } from "./voice-transcribe.ts";

const TTS_URL = process.env.AB_GROQ_TTS_URL || "https://api.groq.com/openai/v1/audio/speech";
const MODEL = process.env.AB_GROQ_TTS_MODEL || "canopylabs/orpheus-v1-english";
const VOICE = process.env.AB_GROQ_TTS_VOICE || "troy";
const SAY = process.env.AB_SAY || "say";
const MAX_CHARS = 400;

function send(res: http.ServerResponse, code: number, body: unknown) {
  res.writeHead(code, { "content-type": "application/json", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
}

async function readText(req: http.IncomingMessage): Promise<string | null> {
  if (!String(req.headers["content-type"] ?? "").startsWith("application/json")) return null;
  const chunks: Buffer[] = [];
  let n = 0;
  for await (const c of req) {
    n += (c as Buffer).length;
    if (n > 16 * 1024) return null;
    chunks.push(c as Buffer);
  }
  try {
    const v = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    return typeof v?.text === "string" ? v.text : null;
  } catch {
    return null;
  }
}

const isWav = (b: Buffer) => b.length > 44 && b.toString("latin1", 0, 4) === "RIFF" && b.toString("latin1", 8, 12) === "WAVE";

async function groq(text: string): Promise<{ wav: Buffer } | { why: string }> {
  const key = groqKey();
  if (!key) return { why: "no Groq key" };
  try {
    const r = await fetch(TTS_URL, {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({ model: MODEL, voice: VOICE, input: text, response_format: "wav" }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!r.ok) return { why: `Groq said ${r.status}` };
    const wav = Buffer.from(await r.arrayBuffer());
    return isWav(wav) ? { wav } : { why: "Groq answered without a WAV" };
  } catch (e) {
    return { why: e instanceof Error && e.name === "TimeoutError" ? "Groq gave no answer in 20 s" : "Groq could not be reached" };
  }
}

/** macOS's own voice, written to a WAV (16-bit little-endian, 22 kHz) in a scratch folder that is removed at once. */
function say(text: string): Promise<Buffer | null> {
  const dir = mkdtempSync(path.join(tmpdir(), ".siso-ephemeral-say."));
  const out = path.join(dir, "say.wav");
  return new Promise((resolve) => {
    execFile(SAY, ["-o", out, "--data-format=LEI16@22050", "--", text], { timeout: 20_000 }, (err) => {
      let wav: Buffer | null = null;
      try {
        if (!err) wav = readFileSync(out);
      } catch {}
      rmSync(dir, { recursive: true, force: true });
      resolve(wav && isWav(wav) ? wav : null);
    });
  });
}

/** Answers /api/voice/speak; false for anything else. */
export async function handleSpeak(req: http.IncomingMessage, res: http.ServerResponse, url: URL): Promise<boolean> {
  if (url.pathname !== "/api/voice/speak") return false;
  if (req.method !== "POST") return send(res, 405, { error: "POST {text}" }), true;
  const raw = await readText(req);
  const text = raw?.replace(/\s+/g, " ").trim() ?? "";
  if (!text) return send(res, 400, { error: "Send JSON {text} with something to say" }), true;
  if (text.length > MAX_CHARS) return send(res, 400, { error: `One sentence at a time: at most ${MAX_CHARS} characters` }), true;
  const g = await groq(text);
  let wav = "wav" in g ? g.wav : null;
  let provider = "groq";
  if (!wav) {
    wav = await say(text);
    provider = "say";
  }
  if (!wav) return send(res, 502, { error: `Could not speak it: ${"why" in g ? g.why : "Groq failed"}, and say failed too` }), true;
  res.writeHead(200, { "content-type": "audio/wav", "content-length": wav.length, "cache-control": "no-store", "x-voice-provider": provider, ...("why" in g ? { "x-voice-fallback": g.why } : {}) });
  res.end(wav);
  return true;
}
