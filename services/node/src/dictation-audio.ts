/**
 * What a recording is before it goes to Groq (t-0505, Shaan 7 Oct 19:55: "my voice app is fucked"). SISO Voice's fixed
 * 30 s timeout killed a 2:21 note, and silence came back as "Thank you Thank you". So:
 *
 * - `trimSilence` cuts a 16-bit PCM WAV's leading and trailing silence and shortens long pauses, and says when there is
 *   no speech at all (then Groq is never asked, so it cannot invent words). Anything that is not PCM WAV passes as is.
 * - `timeoutFor` scales the wait with the recording: the upload and the model both grow with length.
 * - `dropHallucinations` removes Whisper's stock silence phrases ("Thank you.", "Thanks for watching!") where Groq
 *   itself says the segment was probably not speech, or where the whole text is nothing but those phrases.
 */

type Wav = { rate: number; channels: number; dataStart: number; dataEnd: number };

/** A 16-bit PCM WAV's layout, or null for anything else (m4a, webm, a broken header). */
export function wavInfo(b: Buffer): Wav | null {
  if (b.length < 44 || b.toString("latin1", 0, 4) !== "RIFF" || b.toString("latin1", 8, 12) !== "WAVE") return null;
  let at = 12, fmt: { rate: number; channels: number } | null = null;
  while (at + 8 <= b.length) {
    const id = b.toString("latin1", at, at + 4), size = b.readUInt32LE(at + 4), body = at + 8;
    if (id === "fmt " && size >= 16 && body + 16 <= b.length) {
      if (b.readUInt16LE(body) !== 1 || b.readUInt16LE(body + 14) !== 16) return null;
      fmt = { channels: b.readUInt16LE(body + 2), rate: b.readUInt32LE(body + 4) };
    } else if (id === "data" && fmt && fmt.channels > 0 && fmt.rate > 0) {
      // A recorder stopped mid-write can leave the size unset; the bytes on disk are the truth.
      const end = size === 0 || body + size > b.length ? b.length : body + size;
      return { ...fmt, dataStart: body, dataEnd: end - ((end - body) % (2 * fmt.channels)) };
    }
    at = body + size + (size % 2);
  }
  return null;
}

/** Seconds of audio: exact for WAV, a generous guess for compressed audio (about 8 kB a second). */
export function audioSeconds(b: Buffer) {
  const w = wavInfo(b);
  return w ? (w.dataEnd - w.dataStart) / (2 * w.channels * w.rate) : b.length / 8000;
}

/**
 * The loudest sample in dBFS, -120 for pure digital silence (a mic that sends nothing: no permission, or a device that
 * went away mid-take); null for anything that is not 16-bit PCM WAV. A quiet room still reads about -60 to -40.
 */
export function peakDb(b: Buffer): number | null {
  const w = wavInfo(b);
  if (!w) return null;
  let peak = 0;
  for (let i = w.dataStart; i + 1 < w.dataEnd; i += 2) { const v = Math.abs(b.readInt16LE(i)); if (v > peak) peak = v; }
  return peak ? Math.max(-120, Math.round(20 * Math.log10(peak / 32768))) : -120;
}

/** How long to wait for Groq: 30 s floor, plus time to upload the bytes and for the model to read the minutes. */
export function timeoutFor(b: Buffer) {
  return Math.round(Math.min(300, Math.max(30, 20 + audioSeconds(b) * 0.4 + b.length / 60_000)) * 1000);
}

function header(rate: number, channels: number, dataBytes: number) {
  const h = Buffer.alloc(44);
  h.write("RIFF", 0, "latin1"); h.writeUInt32LE(36 + dataBytes, 4); h.write("WAVE", 8, "latin1");
  h.write("fmt ", 12, "latin1"); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(channels, 22);
  h.writeUInt32LE(rate, 24); h.writeUInt32LE(rate * channels * 2, 28); h.writeUInt16LE(channels * 2, 32); h.writeUInt16LE(16, 34);
  h.write("data", 36, "latin1"); h.writeUInt32LE(dataBytes, 40);
  return h;
}

export type Trimmed = { audio: Buffer; seconds: number; speechSeconds: number | null; silent: boolean };

/**
 * Loudness per 20 ms frame against the recording's own noise floor (its quietest tenth), so a noisy room and a quiet
 * one both work. Keeps 0.3 s before the first speech and 0.4 s after the last; a pause over 1.5 s keeps 0.3 s each side.
 */
export function trimSilence(b: Buffer): Trimmed {
  const w = wavInfo(b);
  if (!w) return { audio: b, seconds: audioSeconds(b), speechSeconds: null, silent: false };
  const step = 2 * w.channels, frame = Math.max(1, Math.round(w.rate * 0.02)) * step;
  const rms: number[] = [];
  for (let at = w.dataStart; at + step <= w.dataEnd; at += frame) {
    const end = Math.min(at + frame, w.dataEnd);
    let sum = 0, n = 0;
    for (let i = at; i + 1 < end; i += 2) { const v = b.readInt16LE(i); sum += v * v; n++; }
    rms.push(Math.sqrt(sum / Math.max(1, n)));
  }
  const seconds = rms.length * 0.02;
  if (!rms.length) return { audio: b, seconds: 0, speechSeconds: 0, silent: true };
  const floor = [...rms].sort((x, y) => x - y)[Math.floor(rms.length * 0.1)];
  const loud = rms.map((v) => v > Math.max(floor * 3.5, 300));
  const speech = loud.filter(Boolean).length * 0.02;
  if (speech < 0.25) return { audio: b, seconds, speechSeconds: speech, silent: true };
  const first = loud.indexOf(true), last = loud.lastIndexOf(true);
  const keep: Array<[number, number]> = [];
  let start = Math.max(0, first - 15), quiet = 0;
  for (let i = first; i <= last; i++) {
    if (loud[i]) {
      if (quiet > 75) { keep.push([start, i - quiet + 15]); start = i - 15; }
      quiet = 0;
    } else quiet++;
  }
  keep.push([start, Math.min(rms.length, last + 21)]);
  const parts = keep.map(([s, e]) => b.subarray(w.dataStart + s * frame, Math.min(w.dataEnd, w.dataStart + e * frame)));
  const bytes = parts.reduce((n, p) => n + p.length, 0);
  return { audio: Buffer.concat([header(w.rate, w.channels, bytes), ...parts]), seconds, speechSeconds: speech, silent: false };
}

const STOCK = new Set([
  "thank you", "thank you very much", "thanks", "thanks for watching", "thank you for watching", "thanks for listening",
  "thank you for listening", "please subscribe", "subscribe", "bye", "bye bye", "you", "so", "okay", "oh",
  "subtitles by the amaraorg community", "transcribed by", "music",
]);
const norm = (s: string) => s.toLowerCase().replace(/[^a-z\s]/g, "").replace(/\s+/g, " ").trim();
/** True when the text is nothing but stock silence phrases ("Thank you. Thank you."). */
export function onlyStock(text: string) {
  const parts = text.split(/[.!?,;]+/).map(norm).filter(Boolean);
  return parts.length > 0 && parts.every((p) => STOCK.has(p) || p.split(" ").every((w) => w === "you" || w === "thank" || w === "thanks"));
}

export type Segment = { text?: string; no_speech_prob?: number; avg_logprob?: number };
/** The transcript with Whisper's silence inventions removed; "" when nothing real is left. */
export function dropHallucinations(text: string, segments: Segment[] | undefined, speechSeconds: number | null) {
  let kept = text.trim();
  if (Array.isArray(segments) && segments.length) {
    const real = segments.filter((s) => {
      const t = String(s.text ?? ""), p = Number(s.no_speech_prob ?? 0), lp = Number(s.avg_logprob ?? 0);
      if (p > 0.6 && lp < -0.6) return false;
      return !(onlyStock(t) && (p > 0.15 || lp < -0.8));
    });
    kept = real.map((s) => String(s.text ?? "").trim()).filter(Boolean).join(" ");
  }
  // A whole answer of stock phrases from almost no speech is the classic silence hallucination.
  if (onlyStock(kept) && (speechSeconds === null ? kept.split(/\s+/).length > 2 : speechSeconds < 1.2)) return "";
  return kept;
}

/**
 * t-0553: Whisper echoes its prompt (the Dictionary's spellings) on trailing silence: two takes on 8 Oct ended with
 * "Convex, Fable, SISO, herdr, Groq" and "Convex, Fable, Groq". A tail of vocabulary terms in the prompt's own order is cut
 * when it is three or more terms, or two after a sentence end. A real list of those words mid-sentence, or one term, stays.
 */
export function dropEchoedVocabulary(text: string, vocabulary: string) {
  const key = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
  const order = vocabulary.split(/[,\n]/).map(key).filter(Boolean);
  if (order.length < 2) return text;
  const items = [...text.matchAll(/[^,.;:!?]+/g)];
  let n = 0, last = Infinity, i = items.length - 1;
  for (; i >= 0; i--) {
    const at = order.indexOf(key(items[i][0]));
    if (at < 0 || at >= last) break;
    last = at; n++;
  }
  if (n < 2) return text;
  let start = items[items.length - n].index!;
  // The echo can run on from the last spoken word with no comma ("ship it tonight Convex, Fable, Groq").
  const glued = i >= 0 ? order.slice(0, last).map(t => new RegExp(`\\s(${t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})\\s*$`, "i").exec(items[i][0])).find(Boolean) : null;
  if (glued && n >= 2) { start = items[i].index! + glued.index; n++; }
  const before = text.slice(0, start).replace(/\s+$/, "");
  if (n < 3 && before && !/[.!?]$/.test(before)) return text;
  return before.replace(/[\s,;:]+$/, "");
}
