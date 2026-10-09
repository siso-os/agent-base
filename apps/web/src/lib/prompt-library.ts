/** Private, browser-local text. Deliberately outside recoverPersistedJson's disposable cache keys. */
export const PROMPT_LIBRARY_KEY = "ab.prompts.v1";
export const PROMPT_LIMITS = { entries: 200, name: 80, body: 20_000, agentKey: 300, storedChars: 500_000 } as const;
export type PromptScope = "shared" | "agent";
export type SavedPrompt = { id: string; name: string; body: string; scope: PromptScope; agentKey?: string; updatedAt: number; archived: boolean };
export type PromptLibraryData = { version: 1; prompts: SavedPrompt[] };
type Store = Pick<Storage, "getItem" | "setItem">;
export type LibraryResult = { ok: true; library: PromptLibraryData } | { ok: false; error: string };
export type PromptInput = Pick<SavedPrompt, "name" | "body" | "scope" | "agentKey"> & { id?: string };
const empty = (): PromptLibraryData => ({ version: 1, prompts: [] });
const text = (value: unknown, max: number): value is string => typeof value === "string" && value.trim().length > 0 && value.length <= max;

function valid(value: unknown): value is PromptLibraryData {
  if (!value || typeof value !== "object") return false;
  const data = value as PromptLibraryData;
  if (data.version !== 1 || !Array.isArray(data.prompts) || data.prompts.length > PROMPT_LIMITS.entries) return false;
  const ids = new Set<string>();
  return data.prompts.every((p) => {
    if (!p || !text(p.id, 100) || ids.has(p.id) || !text(p.name, PROMPT_LIMITS.name) || !text(p.body, PROMPT_LIMITS.body) ||
        !Number.isSafeInteger(p.updatedAt) || p.updatedAt < 0 || typeof p.archived !== "boolean" ||
        !(p.scope === "shared" && p.agentKey === undefined || p.scope === "agent" && text(p.agentKey, PROMPT_LIMITS.agentKey))) return false;
    ids.add(p.id);
    return true;
  });
}

export function readPromptLibrary(store: Store | null): LibraryResult {
  try {
    if (!store) return { ok: false, error: "Local storage is unavailable. Your editor text is still here." };
    const raw = store.getItem(PROMPT_LIBRARY_KEY);
    if (raw === null) return { ok: true, library: empty() };
    if (raw.length > PROMPT_LIMITS.storedChars) throw new Error();
    const data: unknown = JSON.parse(raw);
    if (!valid(data)) throw new Error();
    return { ok: true, library: data };
  } catch {
    return { ok: false, error: "The saved library could not be read. Its stored data has been kept." };
  }
}

export function scopedPrompts(library: PromptLibraryData, scope: PromptScope, agentKey: string, archived = false): SavedPrompt[] {
  return library.prompts.filter((p) => p.scope === scope && (scope === "shared" || p.agentKey === agentKey) && p.archived === archived)
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

function write(store: Store | null, library: PromptLibraryData): LibraryResult {
  if (!valid(library)) return { ok: false, error: "Use a name up to 80 characters and prompt text up to 20,000 characters." };
  const raw = JSON.stringify(library);
  if (raw.length > PROMPT_LIMITS.storedChars) return { ok: false, error: "The local library is full. Your editor text has been kept." };
  try {
    if (!store) throw new Error();
    store.setItem(PROMPT_LIBRARY_KEY, raw);
    return { ok: true, library };
  } catch {
    return { ok: false, error: "Could not save locally. Existing prompts and your editor text have been kept." };
  }
}

/** Re-read for each mutation so another open composer/tab's saved prompts are retained. */
export function savePrompt(store: Store | null, input: PromptInput): LibraryResult {
  const result = readPromptLibrary(store);
  if (!result.ok) return result;
  const existing = input.id ? result.library.prompts.find((p) => p.id === input.id) : undefined;
  if (input.id && !existing) return { ok: false, error: "This prompt changed elsewhere. Reopen the library and try again." };
  if (!existing && result.library.prompts.length >= PROMPT_LIMITS.entries) return { ok: false, error: "The library holds 200 prompts, including archived prompts. Your editor text has been kept." };
  const prompt: SavedPrompt = {
    id: existing?.id ?? globalThis.crypto.randomUUID(), name: input.name.trim(), body: input.body,
    scope: input.scope, ...(input.scope === "agent" ? { agentKey: input.agentKey } : {}),
    updatedAt: Date.now(), archived: existing?.archived ?? false,
  };
  return write(store, { version: 1, prompts: existing ? result.library.prompts.map((p) => p.id === existing.id ? prompt : p) : [...result.library.prompts, prompt] });
}

export function archivePrompt(store: Store | null, id: string, archived = true): LibraryResult {
  const result = readPromptLibrary(store);
  if (!result.ok) return result;
  if (!result.library.prompts.some((p) => p.id === id)) return { ok: false, error: "This prompt changed elsewhere. Reopen the library and try again." };
  return write(store, { version: 1, prompts: result.library.prompts.map((p) => p.id === id ? { ...p, archived, updatedAt: Date.now() } : p) });
}
