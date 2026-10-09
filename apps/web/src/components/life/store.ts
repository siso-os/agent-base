import { useEffect, useState } from "react";

/**
 * Life's data layer, shared by the Agent Base Life space and the phone PWA. The API is siso-life (Rust + SQLite on
 * siso-vps): Agent Base reaches it through the node's /api/life proxy, the PWA through Caddy on sisolabs.space behind
 * the site login. `setLifeBase` picks which.
 *
 * Every tap is an event with its own id, queued in localStorage first and posted when the API answers, so a tap
 * offline is never lost and a retry never double-counts. XP is computed by the API from the day's events; the client
 * never keeps a balance of its own.
 */
export type Input = { key: string; type: "time" | "number" | "text" | "scale"; unit?: string; step?: number; lines?: number; min?: number; max?: number };
export type Row = { key: string; label: string; hint?: string; check?: boolean; input?: Input };
export type Counter = { key: string; label: string; unit: string; inc: number; goal?: number; good: "up" | "down" | "neutral" };
export type Food = { kcalTarget: number; proteinTarget: number; mealXp: number; mealXpMax: number; proteinXp: number };
export type Config = { version: number; levelSize: number; streakMin: number; dailyTarget: number; morning: Row[]; counters: Counter[]; checkout: Row[]; food?: Food };
export type DayState = { checks: Record<string, boolean>; sets: Record<string, string | number>; counters: Record<string, number> };
export type XpItem = { id: string; label: string; xp: number };
export type Day = { day: string; state: DayState; xp: { total: number; items: XpItem[]; target?: number } };
export type Xp = { total: number; level: number; intoLevel: number; levelSize: number; streak: number; streakMin: number; today: number; target: number; best: number; daysLogged: number; days: { day: string; xp: number }[] };
export type Range = { days: Day[]; target: number; streakMin: number };
export type LifeEvent = { id: string; day: string; kind: "check" | "set" | "add"; key: string; value?: number; text?: string; at: number };
export type Meal = { id: string; name: string; kcal: number; protein: number; carbs: number; fat: number; at: number };

let BASE = "/api/life";
export function setLifeBase(base: string) { BASE = base.replace(/\/$/, ""); }
export const lifeUrl = (sub: string) => BASE + sub;

const QUEUE = "life-queue-v1";
const CONFIG_CACHE = "life-config-v2";
export const isDay = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && localDay(dateOf(s)) === s;
export const localDay = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
export const dateOf = (day: string) => { const [y, m, d] = day.split("-").map(Number); return new Date(y, m - 1, d, 12); };
export const addDays = (day: string, n: number) => { const d = dateOf(day); d.setDate(d.getDate() + n); return localDay(d); };
const readJson = <T,>(k: string, fallback: T): T => { try { const v = localStorage.getItem(k); return v ? (JSON.parse(v) as T) : fallback; } catch { return fallback; } };
export const newId = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`);

/** The same fold the API does (check/set last-write-wins, add sums floored at 0), for taps not yet synced. */
export function applyEvents(base: DayState, events: LifeEvent[]): DayState {
  const s: DayState = { checks: { ...base.checks }, sets: { ...base.sets }, counters: { ...base.counters } };
  for (const e of [...events].sort((a, b) => a.at - b.at || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))) {
    if (e.kind === "check") s.checks[e.key] = (e.value ?? 1) !== 0;
    else if (e.kind === "set") {
      const v = e.text !== undefined ? e.text : e.value;
      if (v === undefined || v === "") delete s.sets[e.key];
      else s.sets[e.key] = v;
    } else s.counters[e.key] = Math.max(0, (s.counters[e.key] ?? 0) + (e.value ?? 0));
  }
  return s;
}

// One store: the queue, a flush loop, and a version that bumps whenever the server may have new data.
const listeners = new Set<() => void>();
let version = 0;
let flushing: Promise<void> | null = null;
let authState: "ok" | "signin" = "ok";
const bump = () => { version++; listeners.forEach((l) => l()); };
export const queue = (): LifeEvent[] => readJson<LifeEvent[]>(QUEUE, []);
const saveQueue = (q: LifeEvent[]) => localStorage.setItem(QUEUE, JSON.stringify(q));
export const needsSignIn = () => authState === "signin";

let syncMessage = "";
let lastAt = 0;
export const syncError = () => syncMessage;
// Web Locks serialize queue writes across tabs without holding a lock during network requests.
const mutateQueue = (f: (q: LifeEvent[]) => LifeEvent[]) => {
  const write = () => saveQueue(f(queue()));
  return navigator.locks ? navigator.locks.request("life-queue-write", write) : Promise.resolve().then(write);
};
export function record(e: Omit<LifeEvent, "id" | "at">) {
  lastAt = Math.max(Date.now(), lastAt + 1);
  const event = { ...e, id: newId(), at: lastAt };
  void mutateQueue(q => [...q, event]).then(() => {
    try { navigator.vibrate?.(8); } catch { /* no haptics */ }
    bump(); void flush();
  }).catch(() => { syncMessage = "This device could not save the entry. Free browser storage and try again."; bump(); });
}
export const check = (day: string, key: string, on: boolean) => record({ day, kind: "check", key, value: on ? 1 : 0 });
export const setText = (day: string, key: string, text: string) => record({ day, kind: "set", key, text });
export const setNum = (day: string, key: string, value: number | undefined) => record(value === undefined ? { day, kind: "set", key, text: "" } : { day, kind: "set", key, value });
export const add = (day: string, key: string, value: number) => record({ day, kind: "add", key, value });

export function flush(): Promise<void> {
  if (flushing) return flushing;
  if (!queue().length) return Promise.resolve();
  flushing = (async () => {
    while (queue().length) {
      const q = queue().slice(0, 500);
      try {
        const r = await fetch(lifeUrl("/events"), { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ events: q }) });
        if (r.status === 401) { authState = "signin"; syncMessage = "Sign in again to sync your saved entries."; return; }
        if (!r.ok) {
          syncMessage = r.status === 400 ? "Some entries need attention. All pending entries are kept on this device; nothing was discarded." : "Life is offline. Your entries are kept on this device.";
          return;
        }
        const sent = new Set(q.map(e => e.id));
        // Fold what the server just accepted into the last snapshot in the same step that drops it from the queue, so
        // the screen never shows the old snapshot (a tick blinking off) while the fresh read is on its way.
        await mutateQueue(current => { foldIntoSnapshot(q); return current.filter(e => !sent.has(e.id)); });
        authState = "ok"; syncMessage = "";
      } catch { syncMessage = "Life is offline. Your entries are kept on this device."; return; }
    }
  })().finally(() => { flushing = null; bump(); });
  return flushing;
}

export function useLifeVersion() {
  const [v, setV] = useState(version);
  useEffect(() => {
    const l = () => setV(version);
    listeners.add(l);
    void flush();
    const t = window.setInterval(() => { if (queue().length) void flush(); }, 15_000);
    const on = () => { void flush(); bump(); };
    const storage = (e: StorageEvent) => { if (e.key === QUEUE) bump(); };
    window.addEventListener("storage", storage);
    const vis = () => { if (document.visibilityState === "visible") bump(); };
    window.addEventListener("online", on);
    document.addEventListener("visibilitychange", vis);
    return () => { listeners.delete(l); window.removeEventListener("storage", storage); window.clearInterval(t); window.removeEventListener("online", on); document.removeEventListener("visibilitychange", vis); };
  }, []);
  return v;
}

const memo = new Map<string, unknown>();
function foldIntoSnapshot(events: LifeEvent[]) {
  const byDay = new Map<string, LifeEvent[]>();
  for (const e of events) byDay.set(e.day, [...(byDay.get(e.day) ?? []), e]);
  for (const [day, es] of byDay) {
    const url = lifeUrl(`/day/${day}`), d = memo.get(url) as Day | undefined;
    if (d?.state) memo.set(url, { ...d, state: applyEvents(d.state, es) });
  }
}
// Several views read the same URL for the same version (the day, the XP); one request answers them all.
const inflight = new Map<string, Promise<{ status: number; ok: boolean; json: unknown }>>();
function getOnce(url: string, dep: number) {
  const k = `${url}#${dep}`;
  let p = inflight.get(k);
  if (!p) {
    p = fetch(url, { cache: "no-store", credentials: "same-origin" }).then(async (r) => ({ status: r.status, ok: r.ok, json: await r.json().catch(() => ({})) }));
    inflight.set(k, p);
    void p.catch(() => undefined).finally(() => setTimeout(() => inflight.delete(k), 0));
  }
  return p;
}
export function useFetch<T>(sub: string | null, dep: number): { data?: T; error?: string; offline?: boolean; loading?: boolean } {
  const url = sub ? lifeUrl(sub) : null;
  type Result = { url: string | null; data?: T; error?: string; offline?: boolean; loading?: boolean };
  const [s, setS] = useState<Result>({ url, data: url ? memo.get(url) as T | undefined : undefined, loading: true });
  useEffect(() => {
    if (!url) return;
    let live = true;
    const cached = memo.get(url) as T | undefined;
    // Never combine a previous date's data with the requested date's controls.
    setS({ url, data: cached, loading: true });
    const run = async () => {
      // An unacknowledged POST may already be in the server fold. Retry it by id before reading;
      // while offline retain the last confirmed snapshot and its provisional local overlay.
      if (queue().length) {
        if (live) setS({ url, data: cached, error: "Pending entries are shown locally. Sync to refresh server totals.", offline: true });
        return;
      }
      try {
        const r = await getOnce(url, dep);
        const j = r.json;
        if (!live) return;
        if (r.status === 401) { if (authState !== "signin") { authState = "signin"; bump(); } setS({ url, error: "Sign in again to load Life." }); return; }
        if (r.ok) { memo.set(url, j); authState = "ok"; setS({ url, data: j as T }); }
        else setS({ url, data: cached, error: `Life could not load this view (HTTP ${r.status}).`, offline: r.status >= 500 });
      } catch { if (live) setS({ url, data: cached, error: "Life is not answering", offline: true }); }
    };
    void run();
    return () => { live = false; };
  }, [url, dep]);
  // The latest snapshot for this URL wins over this hook's copy (another view, or a just-synced tap, may have moved it on).
  const latest = url ? memo.get(url) as T | undefined : undefined;
  return s.url === url ? (latest !== undefined && latest !== s.data ? { ...s, data: latest } : s) : { data: latest, loading: true };
}

export function useConfig(dep = 0): Config | undefined {
  const r = useFetch<Config>("/config", dep);
  useEffect(() => { if (r.data) localStorage.setItem(CONFIG_CACHE, JSON.stringify(r.data)); }, [r.data]);
  return r.data ?? readJson<Config | undefined>(CONFIG_CACHE, undefined);
}

export const useXp = (dep: number, days = 30) => useFetch<Xp>(`/xp?today=${localDay()}&days=${days}`, dep);

/** One day: the server's fold with this device's unsynced taps on top. */
export function useDay(day: string, dep: number) {
  const r = useFetch<Day>(`/day/${day}`, dep);
  const base: DayState = r.data?.state ?? { checks: {}, sets: {}, counters: {} };
  const state = applyEvents(base, queue().filter((e) => e.day === day));
  return { ...r, state, items: r.data?.xp.items ?? [], total: r.data?.xp.total ?? 0 };
}

/** Logged days in [from, to], as a map; days with nothing logged are absent. */
export function useRange(from: string, to: string, dep: number) {
  const r = useFetch<Range>(`/days?from=${from}&to=${to}`, dep);
  const map = new Map<string, Day>();
  for (const d of r.data?.days ?? []) map.set(d.day, d);
  return { ...r, map };
}

export const xpOf = (items: XpItem[], ids: string[]) => items.filter((i) => ids.includes(i.id)).reduce((n, i) => n + i.xp, 0);
export const num = (v: unknown): number | undefined => { const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN; return Number.isFinite(n) ? n : undefined; };
export const str = (v: unknown): string => (typeof v === "string" ? v : v === undefined ? "" : String(v));

export function mealsOf(state: DayState): Meal[] {
  const out: Meal[] = [];
  for (const [k, v] of Object.entries(state.sets)) {
    if (!k.startsWith("meal.")) continue;
    let m: Partial<Meal> = {};
    try { const parsed = JSON.parse(String(v)); if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) m = parsed; } catch { /* a bad row still shows */ }
    out.push({ id: k.slice(5), name: m.name || "Meal", kcal: Number(m.kcal) || 0, protein: Number(m.protein) || 0, carbs: Number(m.carbs) || 0, fat: Number(m.fat) || 0, at: Number(m.at) || 0 });
  }
  return out.sort((a, b) => a.at - b.at);
}

export function minutesOf(t: unknown): number | undefined {
  const m = /^(\d{1,2}):(\d{2})$/.exec(str(t).trim());
  if (!m) return undefined;
  const h = Number(m[1]), mi = Number(m[2]);
  return h < 24 && mi < 60 ? h * 60 + mi : undefined;
}
export const hhmm = (min: number) => `${String(Math.floor(min / 60) % 24).padStart(2, "0")}:${String(Math.round(min % 60)).padStart(2, "0")}`;
export const nowHHMM = () => { const d = new Date(); return hhmm(d.getHours() * 60 + d.getMinutes()); };

/** Mirrors siso-life rules.rs wake_multiplier (the old LifeLock tiers). */
export function wakeTier(min: number): { mult: number; label: string; tone: string } {
  if (min <= 7 * 60) return { mult: 2, label: "Early bird", tone: "text-emerald-300" };
  if (min <= 8 * 60) return { mult: 1.5, label: "Strong start", tone: "text-lime-300" };
  if (min <= 9 * 60) return { mult: 1.2, label: "On time", tone: "text-amber-200" };
  if (min <= 10 * 60) return { mult: 0.75, label: "Late-ish", tone: "text-orange-300" };
  if (min <= 12 * 60) return { mult: 0.5, label: "Late", tone: "text-orange-400" };
  if (min <= 14 * 60) return { mult: 0.25, label: "Very late", tone: "text-rose-300" };
  if (min <= 16 * 60) return { mult: 0.1, label: "Afternoon", tone: "text-rose-400" };
  return { mult: 0.05, label: "Evening", tone: "text-rose-500" };
}

export function dayName(day: string) {
  const diff = Math.round((dateOf(localDay()).getTime() - dateOf(day).getTime()) / 86_400_000);
  if (diff === 0) return "Today";
  if (diff === 1) return "Yesterday";
  if (diff === -1) return "Tomorrow";
  return dateOf(day).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
}
export const longDate = (day: string) => dateOf(day).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });
