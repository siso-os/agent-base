/**
 * The Voice data lane: read-only GETs against a node that serves /api/voice/* (Agent Base's services/node/src/voice.ts,
 * or SISO Internal's bridge). A component takes a `source`: a base URL ("" means same origin) or a fetch adapter.
 * No session token, no provider key, no writes.
 */
import { useEffect, useMemo, useState } from "react";

export type VoiceEntry = {
  id: number | string;
  /** "agent-base" for a dictation Agent Base took itself; absent for SISO Voice's */
  source?: "agent-base";
  /** ISO time the dictation was captured */
  timestamp: string;
  app: string | null;
  bundleId: string | null;
  intent: string;
  durationSeconds: number | null;
  hasAudio: boolean;
  /** the cleaned-up text, or the raw text when there is none */
  text: string;
  raw: string;
  words: number;
  status: string | null;
};

export type VoiceHistoryPage = { total: number; entries: VoiceEntry[]; apps: Array<{ app: string; n: number }> };

export type VoiceLevel = { level: number; title: string; xpInLevel: number; xpForNext: number; wordsToNext: number };

export type VoiceStatsData = {
  totalWords: number;
  wordsToday: number;
  entries: number;
  wpm: number | null;
  topApp: string | null;
  streakDays: number;
  timeSavedMinutes: number;
  level: VoiceLevel;
};

export type VoiceActivity = {
  /** yyyy-MM-dd (local) → dictations */
  days: Record<string, number>;
  /** yyyy-MM-dd (local) → words */
  words: Record<string, number>;
  /** hour of day 0-23 → dictations, all time */
  hours: number[];
  apps: Array<{ app: string; entries: number; words: number }>;
};

/** Where the data comes from: a base URL in front of /api/voice/*, or a function that GETs a path and returns JSON. */
export type VoiceSource = {
  base?: string;
  fetchJson?: (path: string) => Promise<unknown>;
  /** for the dictionary and settings writes; defaults to fetch against `base` */
  sendJson?: (method: "POST" | "DELETE", path: string, body?: unknown) => Promise<unknown>;
};

export type VoiceState<T> = { data: T | null; loading: boolean; error: string | null };

export async function voiceGet(source: VoiceSource | undefined, path: string): Promise<unknown> {
  if (source?.fetchJson) return source.fetchJson(path);
  const res = await fetch(`${source?.base ?? ""}${path}`, { cache: "no-store" });
  const body = (await res.json().catch(() => null)) as { error?: string } | null;
  if (!res.ok) throw new Error(body?.error ?? `Voice is not answering (HTTP ${res.status})`);
  return body;
}

/** One read of a voice path; `refresh` changes re-read it. The store is live, so a fresh mount is always current. */
export function useVoiceApi<T>(path: string | null, source?: VoiceSource, refresh = 0): VoiceState<T> {
  const [state, setState] = useState<VoiceState<T>>({ data: null, loading: path !== null, error: null });
  const base = source?.base;
  const fetchJson = source?.fetchJson;
  useEffect(() => {
    if (path === null) return;
    let cancelled = false;
    setState((s) => ({ ...s, loading: true }));
    voiceGet({ base, fetchJson }, path)
      .then((data) => !cancelled && setState({ data: data as T, loading: false, error: null }))
      .catch((e: unknown) => !cancelled && setState({ data: null, loading: false, error: e instanceof Error ? e.message : String(e) }));
    return () => {
      cancelled = true;
    };
  }, [path, base, fetchJson, refresh]);
  return state;
}

export function historyPath(p: { limit?: number; offset?: number; q?: string; app?: string | null; day?: string }) {
  const s = new URLSearchParams();
  s.set("limit", String(p.limit ?? 50));
  if (p.offset) s.set("offset", String(p.offset));
  if (p.q) s.set("q", p.q);
  if (p.app) s.set("app", p.app);
  if (p.day) s.set("day", p.day);
  return `/api/voice/history?${s.toString()}`;
}

export const useVoiceHistory = (p: Parameters<typeof historyPath>[0], source?: VoiceSource, refresh = 0) =>
  useVoiceApi<VoiceHistoryPage>(historyPath(p), source, refresh);
/** SISO Voice's launchd services as the node watches them (t-0271), and the time of the newest dictation (no text). */
export type VoiceService = { label: string; loaded: boolean; running: boolean; ok: boolean; kind: "keepalive" | "interval" | "unknown"; lastKick: string | null; lastKickOk: boolean | null; kicks: number; checkedAt: string };
export type VoiceStatus = { watching: boolean; services: VoiceService[]; lastDictationAt: string | null };

/** /api/voice/status, read again every `everyMs` (the node itself checks launchd every 60 s). */
export function useVoiceStatus(source?: VoiceSource, everyMs = 30_000, refresh = 0): VoiceState<VoiceStatus> {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), everyMs);
    return () => clearInterval(t);
  }, [everyMs]);
  const [state, setState] = useState<VoiceState<VoiceStatus>>({ data: null, loading: true, error: null });
  const base = source?.base;
  const fetchJson = source?.fetchJson;
  useEffect(() => {
    let cancelled = false;
    // A poll keeps the last answer on screen while it reads, so the dot never blinks.
    voiceGet({ base, fetchJson }, "/api/voice/status")
      .then((data) => !cancelled && setState({ data: data as VoiceStatus, loading: false, error: null }))
      .catch((e: unknown) => !cancelled && setState((s) => ({ data: s.data, loading: false, error: e instanceof Error ? e.message : String(e) })));
    return () => {
      cancelled = true;
    };
  }, [base, fetchJson, tick, refresh]);
  return state;
}

/** POST /api/voice/restart: check SISO Voice now and restart what is down; the status after. */
export async function voiceRestart(source?: VoiceSource): Promise<VoiceStatus> {
  const res = await fetch(`${source?.base ?? ""}/api/voice/restart`, { method: "POST", cache: "no-store" });
  const body = (await res.json().catch(() => null)) as (VoiceStatus & { error?: string }) | null;
  if (!res.ok || !body) throw new Error(body?.error ?? `Voice is not answering (HTTP ${res.status})`);
  return body;
}

export const useVoiceStats = (source?: VoiceSource, refresh = 0) => useVoiceApi<VoiceStatsData>("/api/voice/stats", source, refresh);
export const useVoiceActivity = (days = 119, source?: VoiceSource, refresh = 0) =>
  useVoiceApi<VoiceActivity>(`/api/voice/activity?days=${days}`, source, refresh);

export type VoiceDay = { day: string; count: number; words: number };

/** Every day with dictations in the last `days` (default a year), newest first, for a side nav. */
export function useVoiceDays(source?: VoiceSource, days = 366, refresh = 0): VoiceState<VoiceDay[]> {
  const a = useVoiceActivity(days, source, refresh);
  const list = useMemo(() => {
    if (!a.data) return null;
    const words = a.data.words;
    return Object.entries(a.data.days)
      .map(([day, count]) => ({ day, count, words: words[day] ?? 0 }))
      .sort((x, y) => (x.day < y.day ? 1 : -1));
  }, [a.data]);
  return { data: list, loading: a.loading, error: a.error };
}

/* ── dictionary and settings (these write SISO Voice's preferences through the node) ── */

export type VoiceTerm = { id: string; text: string; /** Swift reference-epoch seconds */ addedAt?: number };
export type VoiceRule = { id: string; from: string; to: string; enabled: boolean };
export type VoiceDictionaryData = { terms: VoiceTerm[]; rules: VoiceRule[]; /** custom_vocabulary: what the transcriber is told */ vocabulary: string; suggestions: string[] };

export type VoicePrefs = {
  transcription_model: string;
  transcription_language: string;
  realtime_streaming_enabled: boolean;
  realtime_streaming_model: string;
  preserve_clipboard: boolean;
  alert_sounds_enabled: boolean;
  command_mode_enabled: boolean;
  edge_dock_enabled: boolean;
};
export type VoiceSettingsData = {
  prefs: VoicePrefs;
  options: { transcription_model: string[]; realtime_streaming_model: string[]; transcription_language: string[] };
  appliesOn: "relaunch";
  db: { present: boolean; sizeBytes?: number; mtime?: string; entries?: number };
};
export type VoicePrefKey = keyof VoicePrefs | "custom_vocabulary";

/** A write: POST with a JSON body, or DELETE. Throws the node's error message when it refuses. */
export async function voiceSend<T>(source: VoiceSource | undefined, method: "POST" | "DELETE", path: string, body?: unknown): Promise<T> {
  if (source?.sendJson) return (await source.sendJson(method, path, body)) as T;
  const res = await fetch(`${source?.base ?? ""}${path}`, {
    method,
    headers: body !== undefined ? { "content-type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const payload = (await res.json().catch(() => null)) as { error?: string } | null;
  if (!res.ok) throw new Error(payload?.error ?? `Voice refused the change (HTTP ${res.status})`);
  return payload as T;
}

export const useVoiceDictionary = (source?: VoiceSource, refresh = 0) => useVoiceApi<VoiceDictionaryData>("/api/voice/dictionary", source, refresh);
export const useVoiceSettings = (source?: VoiceSource, refresh = 0) => useVoiceApi<VoiceSettingsData>("/api/voice/settings", source, refresh);

const q = (id: string) => encodeURIComponent(id);
export const voiceWrites = (s?: VoiceSource) => ({
  addTerm: (text: string) => voiceSend<{ terms: VoiceTerm[] }>(s, "POST", "/api/voice/dictionary/terms", { text }),
  removeTerm: (id: string) => voiceSend<{ terms: VoiceTerm[] }>(s, "DELETE", `/api/voice/dictionary/terms?id=${q(id)}`),
  addRule: (from: string, to: string) => voiceSend<{ rules: VoiceRule[] }>(s, "POST", "/api/voice/dictionary/rules", { from, to }),
  toggleRule: (id: string) => voiceSend<{ rules: VoiceRule[] }>(s, "POST", "/api/voice/dictionary/rules/toggle", { id }),
  removeRule: (id: string) => voiceSend<{ rules: VoiceRule[] }>(s, "DELETE", `/api/voice/dictionary/rules?id=${q(id)}`),
  setPref: (key: VoicePrefKey, value: string | boolean) => voiceSend<{ ok: true }>(s, "POST", "/api/voice/settings", { key, value }),
});
