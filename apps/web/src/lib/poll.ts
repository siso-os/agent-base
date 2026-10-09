/**
 * Every poll in the app runs through here (P0 performance, Shaan 2 Oct 17:46: "the app is lagging out ... our system is
 * crashing our laptop"). Nothing polls faster than every 5 s; a hidden window polls nothing and reads once when it
 * comes back; one data source is read once however many parts of the app show it (useShared).
 */
import { useEffect, useState, useSyncExternalStore } from "react";

export const MIN_POLL_MS = 5000;

let visible = typeof document === "undefined" || document.visibilityState !== "hidden";
const watchers = new Set<(v: boolean) => void>();
if (typeof document !== "undefined")
  document.addEventListener("visibilitychange", () => {
    const now = document.visibilityState !== "hidden";
    if (now === visible) return;
    visible = now;
    for (const w of watchers) w(visible);
    still();
    if (visible) for (const f of [...ticks]) f();
    retick();
  });

export const isVisible = () => visible;

/*
 * Idle (HEALTH, 3 Oct: the app's WebContent + GPU burned ~0.4 core with nobody looking). After 5 min without input, or
 * whenever the window is hidden, <html data-still> pauses every CSS animation (index.css) and the shared clock below slows
 * to 15 s (hidden: stops). Any input wakes it at once.
 */
const IDLE_MS = 5 * 60_000;
let idle = false;
let lastInput = Date.now();
const idleWatchers = new Set<(waking: boolean) => void>();
function onIdleChange(fn: (waking: boolean) => void): () => void {
  idleWatchers.add(fn);
  return () => void idleWatchers.delete(fn);
}
function still() {
  if (typeof document !== "undefined") document.documentElement.toggleAttribute("data-still", !visible || idle);
}
if (typeof window !== "undefined") {
  const wake = () => {
    lastInput = Date.now();
    if (!idle) return;
    idle = false;
    still();
    for (const f of [...idleWatchers]) f(true);
    for (const f of [...ticks]) f();
    retick();
  };
  for (const e of ["pointermove", "pointerdown", "keydown", "wheel", "focus"]) window.addEventListener(e, wake, { capture: true, passive: true });
  window.setInterval(() => {
    if (idle || Date.now() - lastInput < IDLE_MS) return;
    idle = true;
    still();
    for (const f of [...idleWatchers]) f(false);
    retick();
  }, 30_000);
  still();
}

/** The app's one per-second clock (elapsed times, "working 3m"): every second while he is here, 15 s idle, stopped hidden. */
const ticks = new Set<() => void>();
let tickTimer = 0;
let tickMs = 0;
function retick() {
  const want = !ticks.size || !visible ? 0 : idle ? 15_000 : 1000;
  if (want === tickMs) return;
  window.clearInterval(tickTimer);
  tickTimer = 0;
  tickMs = want;
  if (want) tickTimer = window.setInterval(() => { for (const f of [...ticks]) f(); }, want);
}
/** Call `fn` on the shared clock; returns its stop. Use it instead of a setInterval of 1 s. */
export function clock(fn: () => void): () => void {
  ticks.add(fn);
  retick();
  return () => {
    ticks.delete(fn);
    retick();
  };
}
function onVisibility(fn: (v: boolean) => void): () => void {
  watchers.add(fn);
  return () => void watchers.delete(fn);
}

/** Whether the window is on screen (a hidden one stops its clocks too). */
export function usePageVisible(): boolean {
  return useSyncExternalStore(onVisibility, isVisible, () => true);
}

/** Run `fn` now and every `ms` (at least 5 s) while the window is visible; once more when it comes back. */
export function every(fn: () => void, ms: number): () => void {
  const period = Math.max(MIN_POLL_MS, ms);
  let timer = 0;
  const start = () => {
    if (!timer) timer = window.setInterval(fn, idle ? Math.max(period, 15_000) : period);
  };
  const stop = () => {
    window.clearInterval(timer);
    timer = 0;
  };
  if (visible) {
    fn();
    start();
  }
  const off = onVisibility((v) => {
    if (v) {
      fn();
      start();
    } else stop();
  });
  const offIdle = onIdleChange((waking) => {
    stop();
    if (visible && waking) fn();
    if (visible) start();
  });
  return () => {
    stop();
    off();
    offIdle();
  };
}

type Source = { data: unknown; text: string; error: string | null; subs: Set<() => void>; stop: (() => void) | null; ms: number; generation: number; pending: Promise<void> | null; etag?: string | null };
const sources = new Map<string, Source>();

/**
 * Whether a poll's answer is the one it got last time (t-0237: an idle app re-parsed and re-rendered the same answer
 * every 5 s, which kept WebKit busy and churned memory). Keep the returned text for the next call.
 */
export function unchanged(last: { current: string }, text: string): boolean {
  if (text === last.current) return true;
  last.current = text;
  return false;
}

/** Read `url` now (every viewer of it gets the answer), e.g. after a change he made. */
export function refresh(url: string, coalesce = false): Promise<void> {
  const s = sources.get(url);
  // Timer ticks share an unfinished read. Explicit refreshes after a mutation
  // still start a newer generation, so a pre-mutation answer cannot win.
  if (coalesce && s?.pending) return s.pending;
  const pending = readSource(url);
  if (s) {
    s.pending = pending;
    void pending.finally(() => { if (s.pending === pending) s.pending = null; });
  }
  return pending;
}

async function readSource(url: string) {
  const s = sources.get(url);
  // Only the newest read may change the cache: an older answer that lands late is dropped (overnight deep-dive d4e340b).
  const generation = s ? ++s.generation : 0;
  // QA #15 (A0, 3 Oct): a failed read is kept as `error` (a 500 left the Servers page "Reading the machines…" for good).
  const failed = (why: string) => {
    if (!s || generation !== s.generation || s.error === why) return;
    s.error = why;
    for (const f of s.subs) f();
  };
  try {
    // t-0586: one read per url here, so one tag per url; a 304 is "the answer you have" (never before a first answer).
    const tag = s && s.data !== null && !s.error ? s.etag : null;
    const r = await fetch(url, { cache: "no-store", ...(tag ? { headers: { "if-none-match": tag } } : {}) });
    if (r.status === 304) return;
    if (!r.ok) return failed(`HTTP ${r.status}`);
    const text = await r.text();
    if (!s || generation !== s.generation) return;
    s.etag = r.headers.get("etag");
    if (s.data !== null && text === s.text && !s.error) return;
    const data = JSON.parse(text);
    s.text = text;
    s.data = data;
    s.error = null;
    for (const f of s.subs) f();
  } catch (e) {
    /* the node is restarting: next tick */
    failed(e instanceof SyntaxError ? "The node's answer could not be read" : "No answer from the node");
  }
}

/** One poll of `url` every `ms` shared by everything that shows it; null reads nothing. */
export function useShared<T>(url: string | null, ms: number): T | null {
  return useSharedState<T>(url, ms).data;
}

/** useSharedState with "" for no failure ("HTTP 502" when it failed): a card that blanks alone says why. */
export function useSharedResult<T>(url: string | null, ms: number): { data: T | null; error: string } {
  const r = useSharedState<T>(url, ms);
  return { data: r.data, error: r.error ?? "" };
}

/** useShared with why its last read failed (null when it worked): the last good data stays, and the page says it failed. */
export function useSharedState<T>(url: string | null, ms: number): { data: T | null; error: string | null } {
  const [, bump] = useState(0);
  useEffect(() => {
    if (!url) return;
    let s = sources.get(url);
    if (!s) sources.set(url, (s = { data: null, text: "", error: null, subs: new Set(), stop: null, ms, generation: 0, pending: null }));
    const sub = () => bump((n) => n + 1);
    s.subs.add(sub);
    if (!s.stop) s.stop = every(() => void refresh(url, true), ms);
    else if (s.data !== null || s.error) sub();
    return () => {
      s.subs.delete(sub);
      if (!s.subs.size) {
        s.stop?.();
        s.stop = null;
      }
    };
  }, [url, ms]);
  const s = url ? sources.get(url) : undefined;
  return { data: (s?.data as T | undefined) ?? null, error: s?.error ?? null };
}
