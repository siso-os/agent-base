import { useEffect, useState } from "react";

/** The browser's state lives in the node (GET/PUT /api/browser/state, a 0600 file), not in this window's localStorage.
 * This mirror answers the Storage calls the browser code already makes, synchronously, and writes every change back to the
 * node. On first load it migrates once from localStorage (the old home), then marks the node state migrated. */
type State = { spaces?: unknown[]; folders?: unknown[]; accounts?: unknown[]; today?: Record<string, unknown>; setup?: Record<string, unknown>; choice?: Record<string, string>; last?: string; migratedAt?: number };
type StateField = keyof State;
type Io = { get(): Promise<unknown>; put(state: State, opts?: { keepalive?: boolean; fields?: readonly StateField[] }): Promise<void> };
type Legacy = Pick<Storage, "getItem" | "key" | "length">;

const FIELDS = { "agent-base:browser-folders": "folders", "agent-base:arc-profiles": "spaces", "agent-base:browser-accounts": "accounts", "agent-base:browser-today": "today", "agent-base:browser-setup": "setup" } as const;
const LAST = "agent-base:browser-profile:last";
const CHOICE = "agent-base:browser-profile:";
const ACCOUNT = "agent-base:browser-account:";
type Field = (typeof FIELDS)[keyof typeof FIELDS];
const fieldOf = (key: string): Field | undefined => (FIELDS as Record<string, Field>)[key];
/** Which space (and which account, for a tab moved off its space's account) each tab shows: one map, keyed. */
const choiceKey = (key: string) => (key === LAST ? null : key.startsWith(CHOICE) ? `space:${key.slice(CHOICE.length)}` : key.startsWith(ACCOUNT) ? `account:${key.slice(ACCOUNT.length)}` : null);

function clean(raw: unknown): State {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const r = raw as Record<string, unknown>, s: State = {};
  if (Array.isArray(r.folders)) s.folders = r.folders;
  if (Array.isArray(r.spaces)) s.spaces = r.spaces;
  if (Array.isArray(r.accounts)) s.accounts = r.accounts;
  if (r.today && typeof r.today === "object" && !Array.isArray(r.today)) s.today = r.today as Record<string, unknown>;
  if (r.setup && typeof r.setup === "object" && !Array.isArray(r.setup)) s.setup = r.setup as Record<string, unknown>;
  if (r.choice && typeof r.choice === "object" && !Array.isArray(r.choice)) s.choice = Object.fromEntries(Object.entries(r.choice).filter(([, v]) => typeof v === "string")) as Record<string, string>;
  if (typeof r.last === "string") s.last = r.last;
  if (typeof r.migratedAt === "number") s.migratedAt = r.migratedAt;
  return s;
}

export function createBrowserStore(io: Io, legacy: Legacy | null) {
  let state: State = {};
  let ready: Promise<boolean> | null = null;
  let settled: boolean | null = null;
  let writing: Promise<void> = Promise.resolve();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let dirty = false;
  const dirtyFields = new Set<StateField>();
  const flush = (opts?: { keepalive?: boolean }) => {
    if (timer) { clearTimeout(timer); timer = undefined; }
    dirty = false;
    const snapshot = JSON.parse(JSON.stringify(state)) as State;
    const fields = [...dirtyFields];
    if (!fields.length) return writing;
    dirtyFields.clear();
    const writeOpts = { ...opts, fields };
    writing = writing.then(() => io.put(snapshot, writeOpts)).catch((e: unknown) => {
      dirty = true;
      for (const field of fields) dirtyFields.add(field);
      console.error("Browser state not saved", e);
    });
    return writing;
  };
  const store = {
    getItem(key: string): string | null {
      if (key === LAST) return state.last ?? null;
      const c = choiceKey(key);
      if (c) return state.choice?.[c] ?? null;
      const f = fieldOf(key);
      return f && state[f] !== undefined ? JSON.stringify(state[f]) : null;
    },
    setItem(key: string, value: string) {
      if (key === LAST) { state.last = value; dirtyFields.add("last"); }
      else if (choiceKey(key)) { state.choice = { ...state.choice, [choiceKey(key)!]: value }; dirtyFields.add("choice"); }
      else {
        const f = fieldOf(key);
        if (!f) return;
        try { (state as Record<string, unknown>)[f] = JSON.parse(value); dirtyFields.add(f); } catch { return; }
      }
      // Written on the next tick (a burst of changes is one write); a page closing mid-write is caught by `pagehide`.
      dirty = true;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => void flush(), 0);
    },
    /** Loads the node's state once; the first time, it copies the old localStorage keys over and marks the migration. */
    /** The finished load's answer, or null while there is none: a browser opened after the first renders at once (t-0494). */
    loaded: () => settled,
    load(): Promise<boolean> {
      ready ??= (async () => {
        // An unknown node state is not a first-run empty state; keep offline edits in memory without migrating.
        let raw: unknown;
        try { raw = await io.get(); } catch { return false; }
        if (!raw || typeof raw !== "object" || Array.isArray(raw)) return false;
        state = clean(raw);
        if (state.migratedAt) return true;
        if (legacy) {
          for (const key of Object.keys(FIELDS)) { const v = legacy.getItem(key); if (v !== null && state[fieldOf(key)!] === undefined) store.setItem(key, v); }
          const last = legacy.getItem(LAST);
          if (last !== null && state.last === undefined) { state.last = last; dirtyFields.add("last"); }
          for (let i = 0; i < legacy.length; i++) {
            const key = legacy.key(i);
            if (key && key !== LAST && choiceKey(key) && !state.choice?.[choiceKey(key)!]) store.setItem(key, legacy.getItem(key) ?? "");
          }
        }
        state.migratedAt = Date.now();
        dirtyFields.add("migratedAt");
        await flush();
        return true;
      })().then((ok) => { settled = ok; return ok; });
      return ready;
    },
    /** Re-read the node: the SISO Browser window and Agent Base each hold a copy (t-0439), and a window coming to the front
     * picks up what the other saved. Only once this window's own writes are out; true if anything changed. */
    async refresh(): Promise<boolean> {
      if (!(await store.load())) return false;
      await flush();
      if (dirtyFields.size || timer) return false;
      let raw: unknown;
      try { raw = await io.get(); } catch { return false; }
      if (!raw || typeof raw !== "object" || Array.isArray(raw) || dirtyFields.size || timer) return false;
      const next = clean(raw);
      if (JSON.stringify(next) === JSON.stringify(clean(JSON.parse(JSON.stringify(state))))) return false;
      state = next;
      return true;
    },
    flush,
    /** The window is going away (reload, quit): send what is unsent with a request that outlives the page. */
    leaving() { if (dirty || timer) void flush({ keepalive: true }); },
    snapshot: () => JSON.parse(JSON.stringify(state)) as State,
  };
  return store;
}

const http: Io = {
  async get() {
    const r = await fetch("/api/browser/state");
    if (!r.ok) throw new Error(`browser state ${r.status}`);
    return r.json();
  },
  async put(state, opts) {
    const body = JSON.stringify(state);
    // keepalive requests are capped at 64 KB by the browser; a bigger state goes as a normal request.
    const patch = opts?.fields?.length ? Object.fromEntries(opts.fields.filter((field) => state[field] !== undefined).map((field) => [field, state[field]])) : null;
    const payload = patch ? JSON.stringify(patch) : body;
    const r = await fetch("/api/browser/state", { method: patch ? "PATCH" : "PUT", headers: { "content-type": "application/json" }, body: payload, keepalive: Boolean(opts?.keepalive) && payload.length < 60_000 });
    if (!r.ok) throw new Error(`browser state ${r.status}`);
  },
};
const legacyStorage = (): Legacy | null => { try { return typeof localStorage === "undefined" ? null : localStorage; } catch { return null; } };
export const browserStore = createBrowserStore(http, legacyStorage());
if (typeof window !== "undefined") window.addEventListener("pagehide", () => browserStore.leaving());

/** True after an authoritative node read (and migration preparation); migration writes remain retryable if they fail. */
export function useBrowserStore(): boolean | null {
  // Every tab switch mounts the browser afresh: once the state is loaded, render on the first frame, not one frame blank.
  const [ready, setReady] = useState<boolean | null>(() => browserStore.loaded());
  useEffect(() => { if (browserStore.loaded() !== null) return; let live = true; void browserStore.load().then((loaded) => { if (live) setReady(loaded); }); return () => { live = false; }; }, []);
  return ready;
}
