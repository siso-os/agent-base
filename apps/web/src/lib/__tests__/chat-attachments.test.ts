// @ts-nocheck
import { setImmediate as settleTurn } from 'node:timers/promises';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
// Dependency-free hook contract, matching the repository's existing panel tests.
// Independent real-React DOM eviction/twin/StrictMode tests accompany the QA receipt.
const h = vi.hoisted(() => ({ current: null as Harness | null }));
type Slot = { deps?: unknown[]; value?: unknown; off?: () => void; subscribe?: (f: () => void) => () => void };
type Harness = { slots: Slot[]; cursor: number; render: () => void; commits: (() => void)[] };
vi.mock('react', () => ({
  useMemo(factory: () => unknown, deps: unknown[]) {
    const root = h.current!, i = root.cursor++, previous = root.slots[i];
    if (previous?.deps && deps.every((d, n) => Object.is(d, previous.deps![n]))) return previous.value;
    const value = factory(); root.slots[i] = { value, deps }; return value;
  },
  useSyncExternalStore(subscribe: (f: () => void) => () => void, getSnapshot: () => unknown) {
    const root = h.current!, i = root.cursor++, slot = root.slots[i] ??= {};
    if (!slot.off) root.commits.push(() => { slot.subscribe = subscribe; slot.off = subscribe(root.render); });
    return getSnapshot();
  },
}));
import { readChatDraft, useChatAttachments } from '../chat-attachments';
type Attachments = ReturnType<typeof useChatAttachments>;
type Root = { unmount: () => void };
const roots: Root[] = [];
let latest: Record<string, Attachments>, pending: { resolve: (v: Response) => void; reject: (v: Error) => void; file: File }[], serial = 0;
const act = async (fn: () => unknown) => { await fn(); await settleTurn(); await settleTurn(); };
const drain = () => act(() => {});
async function mount(key: string, slot = key, strict = false) {
  const holder: Harness = { slots: [], cursor: 0, commits: [], render: () => {} };
  holder.render = () => {
    holder.cursor = 0; h.current = holder; latest[slot] = useChatAttachments(key); h.current = null;
    for (const commit of holder.commits.splice(0)) commit();
  };
  const root = { unmount: () => { for (const s of holder.slots) { s.off?.(); s.off = undefined; } } }; roots.push(root);
  holder.render(); if (strict) { root.unmount(); holder.render(); }
  return root;
}
const key = () => 'agent-base:draft:unit-' + ++serial;
async function upload(k: string, name = 'test.png', id?: string) {
  const file = new File(['fixture'], name, { type: 'image/png' });
  await act(() => latest[k].uploadImage(file, id)); return file;
}
async function complete(index = 0, name = 'test.png', invalid = false) {
  await act(() => pending[index].resolve(new Response(JSON.stringify(invalid ? { name } : { name, path: '/fixture/' + name }), { status: 200 })));
  await drain();
}
beforeEach(() => {
  latest = {}; pending = []; const values = new Map<string, string>();
  vi.stubGlobal('localStorage', { getItem: (k: string) => values.get(k) ?? null, setItem: (k: string, value: string) => values.set(k, value), removeItem: (k: string) => values.delete(k), clear: () => values.clear() });
  vi.stubGlobal('fetch', vi.fn((_url: string, init: { body: File }) => new Promise<Response>((resolve, reject) => pending.push({ resolve, reject, file: init.body }))));
});
afterEach(async () => { for (const root of roots.splice(0)) await act(() => root.unmount()); vi.unstubAllGlobals(); });

describe('draft-owned attachment uploads', () => {
  it('persists successful completion after the last chat unmounts', async () => {
    const k = key(); localStorage.setItem(k, JSON.stringify({ text: 'keep' })); const root = await mount(k);
    await upload(k); await act(async () => root.unmount()); await complete();
    expect(JSON.parse(localStorage.getItem(k)!)).toEqual({ text: 'keep', images: [{ name: 'test.png', path: '/fixture/test.png' }] });
    await mount(k); expect(latest[k].images).toHaveLength(1); expect(latest[k].uploading).toBe(0);
  });
  it('shares pending state with a chat remounted before completion', async () => {
    const k = key(), root = await mount(k); await upload(k); await act(async () => root.unmount()); await mount(k);
    expect(latest[k].uploading).toBe(1); await complete(); expect(latest[k].images).toHaveLength(1); expect(latest[k].uploading).toBe(0);
  });
  it('uses current saved text, including intentional clearing', async () => {
    const k = key(); localStorage.setItem(k, JSON.stringify({ text: 'old' })); const root = await mount(k); await upload(k); await act(async () => root.unmount()); localStorage.removeItem(k);
    await complete(); expect(JSON.parse(localStorage.getItem(k)!)).toEqual({ text: '', images: [{ name: 'test.png', path: '/fixture/test.png' }] });
  });
  it('keeps simultaneous agent uploads separate when responses reverse', async () => {
    const a = key(), b = key(); await mount(a); await mount(b); await upload(a, 'a.png'); await upload(b, 'b.png'); await complete(1, 'b.png'); await complete(0, 'a.png');
    expect(latest[a].images.map(x => x.name)).toEqual(['a.png']); expect(latest[b].images.map(x => x.name)).toEqual(['b.png']);
  });
  it('keeps both concurrent attachments and deduplicates retry IDs', async () => {
    const k = key(); await mount(k); await upload(k, 'a.png', 'same'); await upload(k, 'ignored.png', 'same'); await upload(k, 'b.png', 'different'); expect(pending).toHaveLength(2);
    await complete(1, 'b.png'); await complete(0, 'a.png'); expect(latest[k].images.map(x => x.name)).toEqual(['b.png', 'a.png']);
  });
  it('does not resurrect an image removed while a different upload is pending', async () => {
    const k = key(); localStorage.setItem(k, JSON.stringify({ text: 'keep', images: [{ name: 'old.png', path: '/old.png' }] })); await mount(k); await upload(k, 'new.png'); await act(async () => latest[k].setImages([])); await complete(0, 'new.png');
    expect(latest[k].images.map(x => x.name)).toEqual(['new.png']); expect(JSON.parse(localStorage.getItem(k)!).images).toEqual(latest[k].images);
  });
  it('retains rejection and retry file after eviction, then clears failure on success', async () => {
    const k = key(), root = await mount(k), file = await upload(k); await act(async () => root.unmount()); await act(async () => pending[0].reject(Error('offline'))); await drain(); await mount(k);
    expect(latest[k].failedImages).toHaveLength(1); expect(latest[k].failedImages[0].file).toBe(file); const failed = latest[k].failedImages[0];
    await act(async () => latest[k].uploadImage(failed.file, failed.id)); await complete(1); expect(latest[k].failedImages).toHaveLength(0); expect(latest[k].images).toHaveLength(1);
  });
  it('rejects malformed success without adding an attachment', async () => {
    const k = key(); await mount(k); await upload(k); await complete(0, 'test.png', true); expect(latest[k].failedImages).toHaveLength(1); expect(latest[k].images).toHaveLength(0); expect(latest[k].uploading).toBe(0);
  });
  it('does not revive a removed failure after a later mount', async () => {
    const k = key(), root = await mount(k); await upload(k); await act(async () => pending[0].reject(Error('offline'))); await drain(); await act(async () => latest[k].setFailedImages([])); await act(async () => root.unmount()); await mount(k); expect(latest[k].failedImages).toHaveLength(0);
  });
  it('survives simulated subscription replay and subsequent unmount', async () => {
    const k = key(), root = await mount(k, k, true); await upload(k); await act(async () => root.unmount()); await mount(k, k, true); await complete(); expect(latest[k].images).toHaveLength(1); expect(pending).toHaveLength(1);
  });
  it('shares removal between two simultaneously mounted views of one agent', async () => {
    const k = key(); await mount(k); await mount(k, 'second'); await upload(k); await complete(); expect(latest.second.images).toHaveLength(1); await act(async () => latest.second.setImages([])); expect(latest[k].images).toHaveLength(0);
  });
  it('releases completed stores so a later mount reads the current persisted draft', async () => {
    const k = key(), root = await mount(k); await upload(k); await complete(); await act(async () => root.unmount()); localStorage.removeItem(k); await mount(k); expect(latest[k].images).toHaveLength(0);
  });
  it('keeps text persistence stable when attachment notifications update both views', async () => {
    const k = key(); await mount(k); await mount(k, 'mirror');
    const original = latest.mirror.saveText;
    latest[k].saveText('Keep current main text');
    await upload(k); await complete();
    expect(latest.mirror.saveText).toBe(original);
    expect(JSON.parse(localStorage.getItem(k)!).text).toBe('Keep current main text');
    latest.mirror.setImages([]);
    expect(latest.mirror.saveText).toBe(original);
    expect(JSON.parse(localStorage.getItem(k)!).text).toBe('Keep current main text');
  });
});


describe('draft persistence failures', () => {
  it('retains newer text and late uploaded images after quota failure and eviction, then retries durably', async () => {
    const k = key(), values = new Map([[k, JSON.stringify({ text: 'older durable', images: [] })]]);
    let denied = true;
    vi.stubGlobal('localStorage', { getItem: (id: string) => values.get(id) ?? null,
      setItem: (id: string, value: string) => { if (denied) throw Error('quota'); values.set(id, value); },
      removeItem: (id: string) => { if (denied) throw Error('quota'); values.delete(id); } });
    const root = await mount(k); await act(() => latest[k].saveText('newer unsaved'));
    await upload(k); await act(() => root.unmount()); await complete(); await mount(k);
    expect(readChatDraft(k).text).toBe('newer unsaved'); expect(latest[k].images).toHaveLength(1);
    expect(latest[k].persistenceError).toBe('unavailable'); expect(JSON.parse(values.get(k)!).text).toBe('older durable');
    denied = false; await act(() => latest[k].retrySave());
    expect(latest[k].persistenceError).toBe(null); expect(JSON.parse(values.get(k)!)).toEqual({ text: 'newer unsaved', images: latest[k].images });
  });
  it.each(['', 'new edits'])('never replaces an initially unread durable draft when reads recover (%s)', async text => {
    const k = key(), original = JSON.stringify({ text: 'hidden durable', images: [{ name: 'old.png', path: '/old.png' }] });
    let raw: string | null = original, denied = true;
    vi.stubGlobal('localStorage', { getItem: () => { if (denied) throw Error('denied'); return raw; }, setItem: (_: string, value: string) => { raw = value; }, removeItem: () => { raw = null; } });
    await mount(k); await act(() => latest[k].saveText(text)); denied = false; await act(() => latest[k].retrySave());
    expect(raw).toBe(original); expect(latest[k].persistenceError).toBe('unread'); expect(readChatDraft(k).text).toBe(text);
  });
  it('preserves corrupt raw bytes while new edits remain available after eviction', async () => {
    const k = key(); localStorage.setItem(k, '{broken original'); const root = await mount(k);
    await act(() => latest[k].saveText('new unsaved')); await act(() => root.unmount()); await mount(k);
    expect(localStorage.getItem(k)).toBe('{broken original'); expect(readChatDraft(k).text).toBe('new unsaved');
    expect(latest[k].persistenceError).toBe('malformed');
  });
  it('retains an unsaved clearing instead of resurrecting stale durable text', async () => {
    const k = key(); let raw: string | null = JSON.stringify({ text: 'clear me', images: [] }), denied = true;
    vi.stubGlobal('localStorage', { getItem: () => raw, setItem: (_: string, value: string) => { if (denied) throw Error('quota'); raw = value; }, removeItem: () => { if (denied) throw Error('quota'); raw = null; } });
    const root = await mount(k); await act(() => latest[k].saveText('')); await act(() => root.unmount()); await mount(k);
    expect(readChatDraft(k).text).toBe(''); expect(raw).not.toBe(null); denied = false; await act(() => latest[k].retrySave());
    expect(raw).toBe(null); expect(latest[k].persistenceError).toBe(null);
  });
  it('carries a single failed initial read through draft initialization and first save', async () => {
    const k = key(), original = JSON.stringify({ text: 'hidden on first read', images: [] });
    let raw: string | null = original, first = true;
    vi.stubGlobal('localStorage', { getItem: () => { if (first) { first = false; throw Error('temporary read failure'); } return raw; }, setItem: (_: string, value: string) => { raw = value; }, removeItem: () => { raw = null; } });
    await mount(k); await act(() => latest[k].saveText(latest[k].initialText));
    expect(raw).toBe(original); expect(latest[k].persistenceError).toBe('unread');
  });
  it('reads intervening durable clearing when a clean pending draft reopens', async () => {
    const k = key(); localStorage.setItem(k, JSON.stringify({ text: 'old text', images: [] }));
    const root = await mount(k); await upload(k); await act(() => root.unmount()); localStorage.removeItem(k);
    await mount(k); expect(latest[k].initialText).toBe(''); await act(() => latest[k].saveText(latest[k].initialText));
    await complete(); expect(JSON.parse(localStorage.getItem(k)!).text).toBe(''); expect(latest[k].images).toHaveLength(1);
  });

});
