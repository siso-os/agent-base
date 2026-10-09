// @ts-nocheck
import { archivePrompt, PROMPT_LIBRARY_KEY, PROMPT_LIMITS, readPromptLibrary, savePrompt, scopedPrompts } from "../prompt-library";
const memoryStore = () => {
  const values = new Map<string, string>();
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
};
const create = (store, name, scope = "shared", agentKey?) => savePrompt(store, { name, body: `Text for ${name}\nSecond line`, scope, agentKey });

describe("private prompt library", () => {
  it("roundtrips shared prompts and isolates stable agent keys", () => {
    const store = memoryStore();
    create(store, "Shared"); create(store, "A", "agent", "owner:a"); create(store, "B", "agent", "owner:b");
    const loaded = readPromptLibrary(store);
    expect(loaded.ok).toBe(true);
    expect(scopedPrompts(loaded.library, "shared", "owner:b").map(p => p.name)).toEqual(["Shared"]);
    expect(scopedPrompts(loaded.library, "agent", "owner:a").map(p => p.name)).toEqual(["A"]);
    expect(scopedPrompts(loaded.library, "agent", "owner:b").map(p => p.name)).toEqual(["B"]);
    expect(loaded.library.prompts[0].body).toBe("Text for Shared\nSecond line");
  });
  it("archives and restores without discarding names, bodies, or other agents", () => {
    const store = memoryStore();
    const saved = create(store, "Keep me", "agent", "owner:a").library.prompts[0];
    create(store, "Other", "agent", "owner:b");
    const archived = archivePrompt(store, saved.id).library;
    expect(scopedPrompts(archived, "agent", "owner:a")).toEqual([]);
    expect(scopedPrompts(archived, "agent", "owner:a", true)[0]).toMatchObject({ ...saved, archived: true, updatedAt: expect.any(Number) });
    expect(archived.prompts).toHaveLength(2);
    expect(archivePrompt(store, saved.id, false).library.prompts[0]).toMatchObject({ body: saved.body, name: saved.name, archived: false });
  });
  it.each(["not json", '{"version":2,"prompts":[]}', '{"version":1,"prompts":[{"scope":"agent"}]}'])("keeps corrupt or unsupported raw data intact", raw => {
    const store = memoryStore(); store.setItem(PROMPT_LIBRARY_KEY, raw);
    expect(readPromptLibrary(store).ok).toBe(false);
    expect(create(store, "New").ok).toBe(false);
    expect(store.getItem(PROMPT_LIBRARY_KEY)).toBe(raw);
  });
  it("preserves existing values on quota/write failures and rejects oversized prompts", () => {
    const store = memoryStore(); create(store, "Original");
    const raw = store.getItem(PROMPT_LIBRARY_KEY);
    expect(create({ getItem: store.getItem, setItem: () => { throw new Error("quota"); } }, "Failed").ok).toBe(false);
    expect(savePrompt(store, { name: "Long", body: "x".repeat(PROMPT_LIMITS.body + 1), scope: "shared" }).ok).toBe(false);
    expect(store.getItem(PROMPT_LIBRARY_KEY)).toBe(raw);
    expect(readPromptLibrary(null).ok).toBe(false);
  });
  it("edits from current storage while preserving intervening saved and archived prompts", () => {
    const store = memoryStore(); const first = create(store, "First").library.prompts[0];
    const second = create(store, "Second").library.prompts[1]; archivePrompt(store, second.id);
    const result = savePrompt(store, { id: first.id, name: "Edited", body: "New body", scope: "shared" });
    expect(result.library.prompts).toHaveLength(2);
    expect(result.library.prompts[0]).toMatchObject({ id: first.id, name: "Edited", body: "New body" });
    expect(result.library.prompts[1]).toMatchObject({ id: second.id, body: second.body, archived: true });
  });
});
