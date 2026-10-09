/**
 * The speaker toggle (t-0270, Shaan 3 Oct 01:35: "a voice mode ... text-to-speech ... Groq"): with it on, the open
 * chat reads each finished reply aloud. The reply loses its markdown and code, splits into sentences under 200
 * characters, and each goes to the node (/api/voice/speak: Groq's Orpheus voice, macOS say when Groq can't); the next
 * sentence is fetched while this one plays. Turning it off, pressing the mic or Esc stops it at once.
 */
import { useEffect, useRef, useSyncExternalStore } from "react";

const KEY = "ab:voice-speak";
const MAX = 200;

/** A reply as it should sound: no code blocks, no markdown marks, links as their words. */
export function speakable(md: string): string {
  return md
    .replace(/```[\s\S]*?(```|$)/g, " ")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/https?:\/\/\S+/g, "a link")
    .replace(/^\s{0,3}(#{1,6}|>|[-*+]|\d+[.)])\s+/gm, "")
    .replace(/^\s*\|?[-:| ]+\|[-:| ]*$/gm, " ")
    .replace(/[|*_~#>]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Pieces of at most `max` characters: whole sentences packed together, a long sentence split at commas, a long
 * clause at spaces; never mid-word (a single word over `max` is cut).
 */
export function chunks(text: string, max = MAX): string[] {
  const out: string[] = [];
  const fit = (pieces: string[], tooLong: (p: string) => void) => {
    let line = "";
    for (const p of pieces) {
      if (p.length > max) {
        if (line) out.push(line), (line = "");
        tooLong(p);
        continue;
      }
      if (line && line.length + 1 + p.length > max) out.push(line), (line = "");
      line = line ? `${line} ${p}` : p;
    }
    if (line) out.push(line);
  };
  const words = (s: string) => fit(s.split(" ").filter(Boolean).map((w) => w.slice(0, max)), () => {});
  const clauses = (s: string) => fit(s.split(/(?<=[,;:])\s+/), words);
  fit(text.split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter(Boolean), clauses);
  return out;
}

/* ── on/off, shared by every chat ─────────────────────────────────────── */

const listeners = new Set<() => void>();
let on = (() => {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
})();
export function setSpeaking(v: boolean) {
  on = v;
  if (v) unlockAudio(); // the toggle is a click: let the player play from now on
  else clearSpeakProblem();
  try {
    localStorage.setItem(KEY, v ? "1" : "0");
  } catch {}
  if (!v) stopSpeaking();
  listeners.forEach((f) => f());
}
const subscribe = (f: () => void) => (listeners.add(f), () => void listeners.delete(f));
export const useSpeakOn = () => useSyncExternalStore(subscribe, () => on);

/* ── the player ───────────────────────────────────────────────────────── */

let gen = 0;
let player: HTMLAudioElement | null = null;
let unlocked = false;
let abort: AbortController | null = null;
let playing = false;
let problem: string | null = null;
const playingSubs = new Set<() => void>();
const ping = () => playingSubs.forEach((f) => f());
const setPlaying = (v: boolean) => {
  if (playing === v) return;
  playing = v;
  ping();
};
const subPlaying = (f: () => void) => (playingSubs.add(f), () => void playingSubs.delete(f));
export const useSpeakingNow = () => useSyncExternalStore(subPlaying, () => playing);
/** Why the last reply could not be read aloud, in plain words; null when it was (or nothing has been tried). */
export const useSpeakProblem = () => useSyncExternalStore(subPlaying, () => problem);
export function clearSpeakProblem() {
  if (problem === null) return;
  problem = null;
  ping();
}
const fail = (why: string) => {
  problem = why;
  ping();
};

/** A tenth of a second of silence (8 kHz, 16-bit mono), to unlock the player inside a gesture. */
function silence(): string {
  const n = 800;
  const b = new DataView(new ArrayBuffer(44 + n * 2));
  const w = (o: number, t: string) => [...t].forEach((c, i) => b.setUint8(o + i, c.charCodeAt(0)));
  w(0, "RIFF"), b.setUint32(4, 36 + n * 2, true), w(8, "WAVE"), w(12, "fmt "), b.setUint32(16, 16, true), b.setUint16(20, 1, true), b.setUint16(22, 1, true);
  b.setUint32(24, 8000, true), b.setUint32(28, 16000, true), b.setUint16(32, 2, true), b.setUint16(34, 16, true), w(36, "data"), b.setUint32(40, n * 2, true);
  return URL.createObjectURL(new Blob([b.buffer], { type: "audio/wav" }));
}

/**
 * The one player every sentence plays through. WebKit lets a page play sound only from a click or a key, per element,
 * and a reply finishes long after any click; so the first gesture (the toggle, the mic, any press while the speaker is
 * on) plays a moment of silence on this element, and from then on it may play the replies.
 */
export function unlockAudio() {
  if (unlocked || typeof Audio === "undefined") return;
  player ??= new Audio();
  const p = player;
  if (playing) return;
  unlocked = true;
  const url = silence();
  p.src = url;
  p.play()
    .catch(() => (unlocked = false)) // not a gesture after all: the next one tries again
    .finally(() => {
      if (p.getAttribute("src") === url) p.pause(), p.removeAttribute("src");
      URL.revokeObjectURL(url);
    });
}

/** Stops the voice now: the sentence playing, the ones fetched and the ones waiting. */
export function stopSpeaking() {
  gen++;
  abort?.abort();
  abort = null;
  if (player?.getAttribute("src")) {
    player.pause();
    player.removeAttribute("src");
  }
  setPlaying(false);
}

async function fetchWav(text: string, signal: AbortSignal): Promise<string> {
  let r: Response;
  try {
    r = await fetch("/api/voice/speak", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text }), signal });
  } catch (e) {
    if (signal.aborted) throw e;
    throw new Error("Agent Base's node is not answering, so the reply was not read aloud.");
  }
  if (!r.ok) {
    const d = (await r.json().catch(() => ({}))) as { error?: unknown };
    throw new Error(typeof d.error === "string" ? `Not read aloud: ${d.error}.` : `Not read aloud: the node said ${r.status}.`);
  }
  return URL.createObjectURL(await r.blob());
}

/** Plays one sentence on the player; resolves when it ends or is stopped, rejects when the window will not play it. */
function play(url: string): Promise<void> {
  player ??= new Audio();
  const a = player;
  return new Promise<void>((resolve, reject) => {
    const done = () => {
      a.onended = a.onerror = a.onpause = null;
      resolve();
    };
    a.onended = done;
    // stopSpeaking pauses it and takes its src away; the pause the src change itself queues is not a stop.
    a.onpause = () => a.getAttribute("src") !== url && done();
    a.onerror = () => {
      a.onended = a.onerror = a.onpause = null;
      reject(new Error("Not read aloud: the voice came back in a form this window cannot play."));
    };
    a.src = url;
    a.play().catch((e: unknown) => {
      a.onended = a.onerror = a.onpause = null;
      if ((e as Error)?.name === "NotAllowedError") reject(new Error("The window would not play sound yet: click the speaker once and it will."));
      else if ((e as Error)?.name === "AbortError") resolve(); // stopped before it began
      else reject(new Error(`Not read aloud: ${String((e as Error)?.message ?? e).slice(0, 100)}`));
    });
  });
}

/** Reads `text` aloud, after stopping whatever was being read. A sentence that fails says why and ends this reply. */
export async function speak(text: string) {
  stopSpeaking();
  const mine = gen;
  const parts = chunks(speakable(text));
  if (!parts.length) return;
  clearSpeakProblem();
  abort = new AbortController();
  const signal = abort.signal;
  setPlaying(true);
  let next: Promise<string> | null = fetchWav(parts[0], signal);
  try {
    for (let i = 0; i < parts.length && mine === gen; i++) {
      const url = await next!;
      next = i + 1 < parts.length ? fetchWav(parts[i + 1], signal) : null;
      next?.catch(() => {});
      if (mine !== gen) return URL.revokeObjectURL(url);
      try {
        await play(url);
      } finally {
        URL.revokeObjectURL(url);
      }
    }
  } catch (e) {
    // Stopped (the mic, Esc, the toggle) is not a problem; anything else is said, once.
    if (mine === gen && !signal.aborted) fail((e as Error).message);
  } finally {
    if (mine === gen) {
      setPlaying(false);
      if (player?.getAttribute("src")) player.removeAttribute("src");
    }
  }
}

type Spoken = { key: string; done: boolean; text: string } | undefined;
/**
 * In the open chat with the speaker on: each reply that finishes from now on is read aloud once. Replies already there
 * when the chat opened or the speaker came on are not: it arms on the first turn it sees (a chat still loading shows
 * none, and its history arriving must not be read out as new).
 */
export function useSpeakReplies(active: boolean, last: Spoken) {
  const speakOn = useSpeakOn();
  const said = useRef<string | null>(null);
  const armed = useRef(false);
  useEffect(() => {
    if (!active || !speakOn) {
      armed.current = false;
      return;
    }
    if (!last) return;
    if (!armed.current) {
      // Arm on the reply already on screen, so turning it on never reads the past.
      armed.current = true;
      said.current = last.done ? last.key : null;
      return;
    }
    if (!last.done || !last.text || said.current === last.key) return;
    said.current = last.key;
    void speak(last.text);
  }, [active, speakOn, last?.key, last?.done, last?.text]);
  useEffect(() => () => void (active && stopSpeaking()), [active]);
  // With the speaker on, the first press anywhere in the window unlocks sound (the app can open with it already on).
  useEffect(() => {
    if (!active || !speakOn || unlocked) return;
    const go = () => unlockAudio();
    window.addEventListener("pointerdown", go, true);
    window.addEventListener("keydown", go, true);
    return () => {
      window.removeEventListener("pointerdown", go, true);
      window.removeEventListener("keydown", go, true);
    };
  }, [active, speakOn]);
}
