/**
 * The chat mic (t-0100): record in the window, send the recording to the node (/api/voice/transcribe, Groq with
 * SISO Voice's key, which never leaves the node), hand back the words. One recording at a time across the app, so
 * the face's mic and a chat's mic never both hold the microphone.
 *
 * The mic stays warm (t-0271, Shaan 3 Oct: "super fast"): the first press opens it (and asks macOS once); after a take
 * its tracks are muted, not closed, so the next press starts recording at once with no second permission prompt. It
 * closes after 2 minutes without a press (the orange mic dot goes), and the next press opens it again (~300 ms, once).
 * The level goes straight to a callback each frame (the orb writes it to a CSS
 * variable), never through React state, so listening costs no renders; `onVoice` lets Agent Zero's face listen along.
 */
import { useEffect, useRef, useState } from "react";
import { stopSpeaking } from "./speak";

export type VoicePhase = "idle" | "starting" | "listening" | "writing";

/** The first format this WebKit can record that Groq reads. */
function pickType() {
  if (typeof MediaRecorder === "undefined") return null;
  for (const t of ["audio/webm;codecs=opus", "audio/mp4", "audio/webm", "audio/ogg;codecs=opus"]) if (MediaRecorder.isTypeSupported?.(t)) return t;
  return "";
}

/** How long the page waits for the words: the node gives Groq 45 s, so this only fires when the node itself hangs. */
const WRITE_MS = 60_000;

export async function transcribe(audio: Blob): Promise<string> {
  let r: Response;
  try {
    r = await fetch("/api/voice/transcribe", { method: "POST", headers: { "content-type": audio.type || "application/octet-stream" }, body: audio, signal: AbortSignal.timeout(WRITE_MS) });
  } catch (e) {
    throw new Error((e as Error)?.name === "TimeoutError" ? "Writing it down took over a minute, so it stopped. Try again." : "Agent Base's node is not answering, so it was not written down. Try again in a moment.");
  }
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(typeof d.error === "string" ? d.error : `Writing it down failed (${r.status}). Try again.`);
  return String(d.text ?? "").trim();
}

function micError(e: unknown) {
  const name = (e as { name?: string })?.name;
  if (name === "NotAllowedError" || name === "SecurityError") return "The microphone is blocked: allow Agent Base in System Settings, Privacy & Security, Microphone.";
  if (name === "NotFoundError") return "No microphone found.";
  return `The microphone did not start: ${String((e as Error)?.message ?? e).slice(0, 120)}`;
}

/* ── the warm mic ─────────────────────────────────────────────────────── */

type Mic = { stream: MediaStream; ctx: AudioContext | null; an: AnalyserNode | null; idle: number };
/** How long the mic stays open with no press: macOS shows its orange mic dot while it is (AGENT-BASE 3 Oct: 2 min). */
const WARM_MS = 2 * 60_000;
const HOVER_MS = 60_000;
/** A test may shorten both (window.__abMicWarmMs); the app never sets it. */
const warmFor = (ms: number) => Math.min(ms, Number((globalThis as { __abMicWarmMs?: number }).__abMicWarmMs) || ms);
let mic: Mic | null = null;
let opening: Promise<Mic> | null = null;

const live = (m: Mic | null): m is Mic => !!m && m.stream.getAudioTracks().some((t) => t.readyState === "live");

/** The open mic, or a new one (the only getUserMedia call). Its level analyser is built once with it. */
function openMic(): Promise<Mic> {
  if (live(mic)) {
    clearTimeout(mic.idle);
    return Promise.resolve(mic);
  }
  mic = null;
  opening ??= navigator.mediaDevices
    .getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } })
    .then((stream) => {
      let ctx: AudioContext | null = null;
      let an: AnalyserNode | null = null;
      try {
        ctx = new AudioContext();
        an = ctx.createAnalyser();
        an.fftSize = 512;
        ctx.createMediaStreamSource(stream).connect(an);
      } catch {
        /* no level, still records */
      }
      mic = { stream, ctx, an, idle: 0 };
      return mic;
    })
    .finally(() => (opening = null));
  return opening;
}

/** Between takes: tracks muted and the analyser asleep, the device kept; closed for good after `ms` (WARM_MS). */
function restMic(m: Mic, ms = WARM_MS) {
  m.stream.getAudioTracks().forEach((t) => (t.enabled = false));
  m.ctx?.suspend().catch(() => {});
  clearTimeout(m.idle);
  m.idle = window.setTimeout(closeMic, warmFor(ms));
}

/** Lets the device go (the warm window ran out, or the page is leaving). */
export function closeMic() {
  const m = mic;
  mic = null;
  if (!m) return;
  clearTimeout(m.idle);
  m.stream.getTracks().forEach((t) => t.stop());
  m.ctx?.close().catch(() => {});
}

/** Opens the mic ahead of a press when macOS already allows it (the pointer is on its way to the orb): no prompt. */
export async function warmMic() {
  if (live(mic) || opening || !navigator.mediaDevices?.getUserMedia) return;
  try {
    const p = await navigator.permissions?.query({ name: "microphone" as PermissionName });
    if (p?.state !== "granted") return;
    restMic(await openMic(), HOVER_MS); // a hover that never becomes a press lets it go in a minute
  } catch {
    /* the press will open it */
  }
}

/* ── who is listening, for the face ───────────────────────────────────── */

export type VoiceLive = { phase: VoicePhase; to: string | null; level: number; error?: string };
const subs = new Set<(v: VoiceLive) => void>();
/** Every phase change and, while listening, every frame's level. */
export function onVoice(fn: (v: VoiceLive) => void): () => void {
  subs.add(fn);
  return () => void subs.delete(fn);
}
const emit = (v: VoiceLive) => subs.forEach((f) => f(v));

let holder: symbol | null = null;
const MAX_MS = 5 * 60_000;

/** Where the words go: "send" (he pressed to send) or "draft" (the mic was put away mid-take: keep them, send nothing). */
export type VoiceHow = "send" | "draft";

/**
 * Press start, speak, press stop: `onText` gets the words. `cancel` drops the recording, `park` ends it and hands the
 * words over as a draft (the chat it was for went out of view). `to` names who the words are for (the face listens to
 * its own); `onLevel` gets the loudness (0-1) each frame while listening.
 *
 * The phase is kept in a ref as well as in state: a second press, a key and a hidden tab all read the ref, so two
 * presses inside one render can never start two recordings. A failed take keeps its recording in memory (never on
 * disk) until the next press or the error is dismissed, so "Try again" can resend it.
 */
export function useVoice(onText: (text: string, how: VoiceHow) => void, o: { to?: string; onLevel?: (level: number) => void } = {}) {
  const [phase, setPhaseState] = useState<VoicePhase>("idle");
  const [since, setSince] = useState(0);
  const [error, setErrorState] = useState<string | null>(null);
  const [canRetry, setCanRetry] = useState(false);
  const me = useRef(Symbol("voice"));
  const now = useRef<VoicePhase>("idle");
  const sinceRef = useRef(0);
  /** Esc or a park while the mic was still opening: what to do once it has opened. */
  const pending = useRef<null | "cancel" | "park">(null);
  const failed = useRef<Blob | null>(null);
  const alive = useRef(true);
  const take = useRef<{ rec: MediaRecorder; m: Mic; raf: number; cap: number; keep: boolean; how: VoiceHow; broke: string | null } | null>(null);
  const onTextRef = useRef(onText);
  onTextRef.current = onText;
  const opts = useRef(o);
  opts.current = o;
  const setPhase = (p: VoicePhase, show = true) => {
    now.current = p;
    if (alive.current && show) setPhaseState(p);
    emit({ phase: p, to: opts.current.to ?? null, level: 0 });
  };
  const setError = (e: string | null, keep: Blob | null = null) => {
    failed.current = keep;
    if (alive.current) setErrorState(e), setCanRetry(!!keep);
    if (e) emit({ phase: "idle", to: opts.current.to ?? null, level: 0, error: e });
  };
  const level = (l: number) => {
    opts.current.onLevel?.(l);
    emit({ phase: "listening", to: opts.current.to ?? null, level: l });
  };

  const release = () => {
    const t = take.current;
    take.current = null;
    if (holder === me.current) holder = null;
    if (!t) return;
    cancelAnimationFrame(t.raf);
    clearTimeout(t.cap);
    restMic(t.m);
    opts.current.onLevel?.(0);
  };
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      pending.current = "cancel";
      const t = take.current;
      if (t) t.keep = false;
      if (t && t.rec.state !== "inactive") t.rec.stop();
      release();
    };
  }, []);

  /** Sends a recording to be written down and hands the words on; a failure keeps it for "Try again". */
  const write = async (blob: Blob, how: VoiceHow) => {
    setPhase("writing");
    try {
      const text = await transcribe(blob);
      if (!alive.current) return;
      if (text) onTextRef.current(text, how);
      else setError("Heard no words in that. Press, speak, then press again.");
    } catch (e) {
      if (alive.current) setError((e as Error).message, blob);
    } finally {
      if (alive.current) setPhase("idle");
    }
  };

  const start = async () => {
    if (now.current !== "idle") return;
    setError(null);
    pending.current = null;
    if (holder && holder !== me.current) return setError("Another mic is listening already: send or throw that one away first.");
    const type = pickType();
    if (type === null || !navigator.mediaDevices?.getUserMedia) return setError("This window cannot record audio.");
    holder = me.current;
    stopSpeaking(); // he talks over the agent: the agent stops
    // "starting" at once in the ref (a second press is ignored), on screen only when the mic is cold.
    setPhase("starting", !live(mic));
    let m: Mic;
    try {
      m = await openMic();
    } catch (e) {
      if (holder === me.current) holder = null;
      if (!alive.current) return;
      setPhase("idle");
      return setError(micError(e));
    }
    if (pending.current === "cancel" || !alive.current || holder !== me.current) {
      if (holder === me.current) holder = null;
      if (!alive.current && holder === null) closeMic();
      else if (holder === null) restMic(m);
      if (alive.current) setPhase("idle");
      return;
    }
    m.stream.getAudioTracks().forEach((t) => (t.enabled = true));
    m.ctx?.resume().catch(() => {});
    let rec: MediaRecorder;
    try {
      rec = type ? new MediaRecorder(m.stream, { mimeType: type }) : new MediaRecorder(m.stream);
    } catch (e) {
      if (holder === me.current) holder = null;
      restMic(m);
      setPhase("idle");
      return setError(`The microphone opened but could not record: ${String((e as Error)?.message ?? e).slice(0, 120)}`);
    }
    const chunks: Blob[] = [];
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    rec.onerror = () => {
      if (take.current) take.current.broke = "The recording stopped by itself (the microphone went away?).";
    };
    rec.onstop = () => {
      const t = take.current;
      const keep = t?.keep ?? false;
      const how = t?.how ?? "send";
      const broke = t?.broke ?? null;
      release();
      if (!alive.current) return;
      if (!keep) return setPhase("idle");
      const blob = new Blob(chunks, { type: rec.mimeType || type || "audio/webm" });
      if (!blob.size) {
        setPhase("idle");
        return setError(broke ?? "Nothing was recorded. Press, speak, then press again.");
      }
      void write(blob, how);
    };
    // The mic going away (unplugged, another app took it) ends the take and writes down what there is.
    m.stream.getAudioTracks().forEach((t) => (t.onended = () => stop()));
    // The level: the loudness of the last frame, for the orb, the bars and the face.
    let raf = 0;
    if (m.an) {
      const an = m.an;
      const buf = new Uint8Array(an.fftSize);
      const tick = () => {
        an.getByteTimeDomainData(buf);
        let sum = 0;
        for (const v of buf) sum += ((v - 128) / 128) ** 2;
        level(Math.min(1, Math.sqrt(sum / buf.length) * 4));
        raf = requestAnimationFrame(tick);
        if (take.current) take.current.raf = raf;
      };
      raf = requestAnimationFrame(tick);
    }
    const cap = window.setTimeout(() => stop(), MAX_MS);
    take.current = { rec, m, raf, cap, keep: true, how: "send", broke: null };
    rec.start(250);
    sinceRef.current = Date.now();
    if (alive.current) setSince(sinceRef.current);
    setPhase("listening");
    // Put away while it was opening: end it now, as asked.
    if (pending.current === "park") park();
  };
  /** Ends the recording and writes it down. */
  const stop = () => {
    const t = take.current;
    if (t && t.rec.state !== "inactive") t.rec.stop();
  };
  /** Ends the recording and throws it away (Esc, the ✕); while the mic is still opening, it never starts. */
  const cancel = () => {
    if (now.current === "starting") pending.current = "cancel";
    const t = take.current;
    if (!t) return;
    t.keep = false;
    if (t.rec.state !== "inactive") t.rec.stop();
    else release(), setPhase("idle");
  };
  /** Ends the recording and keeps the words as a draft, sending nothing (the chat it was for went out of view). */
  const park = () => {
    if (now.current === "starting") pending.current = "park";
    const t = take.current;
    if (!t) return;
    t.how = "draft";
    if (t.rec.state !== "inactive") t.rec.stop();
  };
  /** Sends the recording that failed to be written down again. */
  const retry = () => {
    const blob = failed.current;
    if (!blob || now.current !== "idle") return;
    setError(null);
    void write(blob, "send");
  };
  const toggle = () => (now.current === "listening" ? stop() : now.current === "idle" ? void start() : undefined);
  return {
    phase,
    since,
    error,
    canRetry,
    clearError: () => setError(null),
    start,
    stop,
    cancel,
    park,
    retry,
    toggle,
    /** The phase right now (ahead of the render), and when this take started listening. */
    current: () => now.current,
    listeningSince: () => sinceRef.current,
  };
}

export const clock = (ms: number) => `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, "0")}`;
