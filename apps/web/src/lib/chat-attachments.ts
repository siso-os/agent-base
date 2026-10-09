import { useMemo, useSyncExternalStore, type SetStateAction } from "react";

type Image = { name: string; path: string };
type FailedImage = { id: string; file: File };
type PersistenceError = "unavailable" | "malformed" | "unread" | null;
type Snapshot = { images: Image[]; uploading: number; failedImages: FailedImage[]; persistenceError: PersistenceError };
type Store = { key: string; text: string; dirty: boolean; unreadAtStart: boolean; snapshot: Snapshot; listeners: Set<() => void>; pending: Set<string> };
const stores = new Map<string, Store>();
const imagesOf = (value: unknown): Image[] => Array.isArray(value) ? value.filter((im): im is Image => !!im && typeof im.name === "string" && typeof im.path === "string") : [];
function read(key: string): { text: string; images: Image[]; error: PersistenceError; empty?: boolean } {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return { text: "", images: [], error: null, empty: true };
    let value;
    try { value = JSON.parse(raw); } catch { return { text: "", images: [], error: "malformed" }; }
    if (!value || typeof value !== "object" || Array.isArray(value)) return { text: "", images: [], error: "malformed" };
    const images = imagesOf(value.images);
    const malformed = (value.text !== undefined && typeof value.text !== "string") ||
      (value.images !== undefined && (!Array.isArray(value.images) || images.length !== value.images.length));
    return { text: typeof value.text === "string" ? value.text : "", images, error: malformed ? "malformed" : null };
  } catch { return { text: "", images: [], error: "unavailable" }; }
}
/** Unsaved edits survive chat eviction in this window, never a reload or relaunch. */
export function readChatDraft(key: string) {
  const store = stores.get(key);
  return store?.dirty ? { text: store.text, images: store.snapshot.images } : read(key);
}
function persist(store: Store, text?: string) {
  // Clean stores reread text at completion time, including clearing by another view.
  // Failed writes instead retain the latest unsaved text, not an older durable copy.
  const value = read(store.key);
  if (text !== undefined) store.text = text;
  else if (!store.dirty && !value.error) store.text = value.text;
  let error = value.error;
  // A denied initial read may have hidden a durable draft. Never replace that
  // unseen record with a default or new text when storage access returns.
  if (!error && store.unreadAtStart && !value.empty) error = "unread";
  else if (!error) store.unreadAtStart = false;
  if (!error) {
    try {
      if (store.text || store.snapshot.images.length) localStorage.setItem(store.key, JSON.stringify({ text: store.text, images: store.snapshot.images }));
      else localStorage.removeItem(store.key);
    } catch { error = "unavailable"; }
  }
  // A malformed or temporarily unreadable record is never replaced with defaults.
  store.dirty = !!error;
  if (error) stores.set(store.key, store);
  if (store.snapshot.persistenceError !== error) publish(store, { ...store.snapshot, persistenceError: error });
}
function release(store: Store) {
  if (!store.dirty && !store.listeners.size && !store.pending.size && !store.snapshot.failedImages.length && stores.get(store.key) === store) stores.delete(store.key);
}
function publish(store: Store, next: Snapshot) {
  store.snapshot = next;
  for (const fn of store.listeners) fn();
}
function bindingFor(key: string) {
  // Rendering may be abandoned before subscription. Keep that provisional state
  // owned by the hook, so an uncommitted render cannot leak a module-map entry.
  const saved = read(key);
  const provisional: Store = { key, text: saved.text, dirty: !!saved.error, unreadAtStart: saved.error === "unavailable", snapshot: { images: saved.images, uploading: 0, failedImages: [], persistenceError: saved.error }, listeners: new Set(), pending: new Set() };
  let adopted = provisional;
  let adoptedReadError = false;
  const current = () => {
    // Keep the adopted instance through StrictMode's temporary unsubscribe gap.
    adopted = stores.get(key) ?? adopted;
    return adopted;
  };
  return {
    current,
    // A clean reopened view observes intervening durable edits. A failed draft
    // keeps its newer in-window text; an unread snapshot never supplies defaults.
    initialText: () => { const store = current(); return store.dirty || saved.error ? store.text : saved.text; },
    getSnapshot: () => current().snapshot,
    subscribe: (fn: () => void) => {
      // Multiple views rendered together converge on the first committed store.
      const store = current(); stores.set(key, store); store.listeners.add(fn);
      if (!adoptedReadError && saved.error && !store.dirty) {
        store.unreadAtStart ||= saved.error === "unavailable";
        store.dirty = true;
        publish(store, { ...store.snapshot, persistenceError: saved.error });
      }
      adoptedReadError = true;
      return () => { store.listeners.delete(fn); release(store); };
    },
  };
}
const resolve = <T,>(value: SetStateAction<T>, previous: T): T => typeof value === "function" ? (value as (previous: T) => T)(previous) : value;

/** Upload ownership follows the per-agent draft, not a particular mounted ChatView.
 * Pending uploads, retryable failed files and unsaved edits outlive the last subscriber.
 * Successfully persisted drafts are released as before; this store never contains send intent. */
export function useChatAttachments(draftKey: string) {
  const binding = useMemo(() => bindingFor(draftKey), [draftKey]);
  const snapshot = useSyncExternalStore(binding.subscribe, binding.getSnapshot, binding.getSnapshot);
  const actions = useMemo(() => ({
    saveText(text: string) {
      const store = binding.current();
      // An image update can notify several views of the same chat. Only an actual
      // text change may persist that view's text, otherwise an idle mirror could
      // replace the current draft with its stale copy when an upload completes.
      persist(store, text);
    },
    retrySave() {
      const store = binding.current();
      persist(store); release(store);
    },
    setImages(value: SetStateAction<Image[]>) {
      const store = binding.current();
      const images = resolve(value, store.snapshot.images);
      publish(store, { ...store.snapshot, images }); persist(store); release(store);
    },
    setFailedImages(value: SetStateAction<FailedImage[]>) {
      const store = binding.current();
      publish(store, { ...store.snapshot, failedImages: resolve(value, store.snapshot.failedImages) }); release(store);
    },
    uploadImage(file: File, id: string = crypto.randomUUID()) {
      const store = binding.current();
      if (store.pending.has(id)) return;
      stores.set(store.key, store);
      store.pending.add(id);
      publish(store, { ...store.snapshot, uploading: store.pending.size });
      void fetch("/api/uploads", { method: "POST", headers: { "content-type": file.type }, body: file, signal: AbortSignal.timeout(15_000) })
        .then(async response => {
          if (!response.ok) throw new Error("Upload failed");
          const value = await response.json();
          if (typeof value?.path !== "string" || !value.path || typeof value.name !== "string" || !value.name) throw new Error("Invalid upload response");
          publish(store, { ...store.snapshot, images: [...store.snapshot.images, { name: value.name, path: value.path }], failedImages: store.snapshot.failedImages.filter(image => image.id !== id) });
          persist(store);
        })
        .catch(() => publish(store, { ...store.snapshot, failedImages: [...store.snapshot.failedImages.filter(image => image.id !== id), { id, file }] }))
        .finally(() => {
          store.pending.delete(id);
          publish(store, { ...store.snapshot, uploading: store.pending.size }); release(store);
        });
    },
  }), [binding]);
  return { ...snapshot, ...actions, initialText: binding.initialText() };
}
