// @ts-nocheck

vi.mock("react", () => ({
  useEffect: (effect: () => void) => effect(),
  useState: <T>(value: T) => [value, vi.fn()],
  useSyncExternalStore: (_subscribe: unknown, read: () => unknown) => read(),
}));

afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("shared polling", () => {
  it("coalesces slow scheduled reads, pauses hidden, and preserves explicit mutation refresh", async () => {
    vi.resetModules();
    const timers = new Map<number, () => void>();
    const listeners = new Map<string, () => void>();
    let nextTimer = 0;
    const doc = { visibilityState: "visible", documentElement: { toggleAttribute: vi.fn() },
      addEventListener: (name: string, fn: () => void) => listeners.set(name, fn) };
    vi.stubGlobal("document", doc);
    vi.stubGlobal("window", {
      setInterval: (fn: () => void, ms: number) => { const id = ++nextTimer; if (ms === 5000) timers.set(id, fn); return id; },
      clearInterval: (id: number) => timers.delete(id), addEventListener: vi.fn(),
    });
    const old = deferred<Response>();
    const fresh = deferred<Response>();
    const fetchMock = vi.fn().mockImplementationOnce(() => old.promise).mockImplementationOnce(() => fresh.promise)
      .mockResolvedValue({ ok: true, text: async () => '{"version":2}' });
    vi.stubGlobal("fetch", fetchMock);
    const { useShared, refresh } = await import("../poll");
    const url = "/api/slow-scheduled";
    useShared(url, 5000); useShared(url, 5000);
    expect(timers.size).toBe(1);
    for (let tick = 0; tick < 10; tick++) for (const fn of timers.values()) fn();
    // Before this fix the initial read plus ten ticks generated eleven requests.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const mutation = refresh(url);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    fresh.resolve({ ok: true, text: async () => '{"version":2}' } as Response);
    await mutation;
    old.resolve({ ok: true, text: async () => '{"version":1}' } as Response);
    await Promise.resolve(); await Promise.resolve();
    expect(useShared(url, 5000)).toEqual({ version: 2 });
    doc.visibilityState = "hidden"; listeners.get("visibilitychange")!();
    expect(timers.size).toBe(0);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    doc.visibilityState = "visible"; listeners.get("visibilitychange")!();
    expect(timers.size).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    await refresh(url, true);
    expect(useShared(url, 5000)).toEqual({ version: 2 });
    console.info("scheduled-read requests: 11 baseline → 1 coalesced; hidden 0; resume 1; mutation refresh retained");
  });

  it("keeps a newer response when an older request finishes later", async () => {
    // poll.ts wires its idle clock to window events at import (idle-quiet), so the stub takes listeners too.
    vi.stubGlobal("window", { setInterval: vi.fn(() => 1), clearInterval: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn() });
    const firstFetch = deferred<Response>();
    const firstText = deferred<string>();
    const secondFetch = deferred<Response>();
    const fetchMock = vi.fn()
      .mockImplementationOnce(() => firstFetch.promise)
      .mockImplementationOnce(() => secondFetch.promise);
    vi.stubGlobal("fetch", fetchMock);

    const { refresh, useShared, useSharedState, useSharedResult } = await import("../poll");
    const url = "/api/race";
    expect(useShared<{ version: number }>(url, 5_000)).toBeNull();

    const newer = refresh(url);
    secondFetch.resolve({ ok: true, text: async () => JSON.stringify({ version: 2 }) } as Response);
    await newer;
    expect(useShared<{ version: number }>(url, 5_000)).toEqual({ version: 2 });

    firstFetch.resolve({ ok: true, text: () => firstText.promise } as Response);
    firstText.resolve(JSON.stringify({ version: 1 }));
    await Promise.resolve();
    await Promise.resolve();
    expect(useShared<{ version: number }>(url, 5_000)).toEqual({ version: 2 });

    // An old failed request also cannot change the cache or notify viewers.
    const thirdFetch = deferred<Response>();
    fetchMock.mockImplementationOnce(() => thirdFetch.promise);
    const staleFailure = refresh(url);
    const fourthFetch = deferred<Response>();
    fetchMock.mockImplementationOnce(() => fourthFetch.promise);
    const latest = refresh(url);
    fourthFetch.resolve({ ok: true, text: async () => JSON.stringify({ version: 3 }) } as Response);
    await latest;
    thirdFetch.reject(new Error("node restarted"));
    await staleFailure;
    expect(useSharedState<{ version: number }>(url, 5_000)).toEqual({ data: { version: 3 }, error: null });
    expect(useSharedResult<{ version: number }>(url, 5_000).error).toBe("");

    // Latest failures preserve data; a matching good response clears both error APIs.
    fetchMock.mockResolvedValueOnce({ ok: false, status: 503 });
    await refresh(url);
    expect(useSharedState<{ version: number }>(url, 5_000)).toEqual({ data: { version: 3 }, error: "HTTP 503" });
    fetchMock.mockResolvedValueOnce({ ok: true, text: async () => "malformed JSON" });
    await refresh(url);
    expect(useSharedState<{ version: number }>(url, 5_000).data).toEqual({ version: 3 });
    expect(useSharedResult<{ version: number }>(url, 5_000).error).toContain("could not be read");
    fetchMock.mockResolvedValueOnce({ ok: true, text: async () => JSON.stringify({ version: 3 }) });
    await refresh(url);
    expect(useSharedState<{ version: number }>(url, 5_000).error).toBeNull();
    expect(useSharedResult<{ version: number }>(url, 5_000).error).toBe("");
  });

  it("slows idle polls, wakes once, and never polls while hidden", async () => {
    vi.resetModules();
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const listeners = new Map<string, () => void>();
    const windowListeners = new Map<string, () => void>();
    const doc = { visibilityState: "visible", documentElement: { toggleAttribute: vi.fn() },
      addEventListener: (name: string, fn: () => void) => listeners.set(name, fn) };
    vi.stubGlobal("document", doc);
    vi.stubGlobal("window", {
      setInterval: globalThis.setInterval,
      clearInterval: globalThis.clearInterval,
      addEventListener: (name: string, fn: () => void) => windowListeners.set(name, fn),
    });
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, text: async () => '{"version":1}' });
    vi.stubGlobal("fetch", fetchMock);
    const { useShared, every } = await import("../poll");
    const url = "/api/idle-policy";
    useShared(url, 5_000);
    const slowFn = vi.fn();
    const slowStop = every(slowFn, 30_000);
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    fetchMock.mockClear();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fetchMock).toHaveBeenCalledTimes(12);

    await vi.advanceTimersByTimeAsync(240_000);
    fetchMock.mockClear();
    slowFn.mockClear();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(slowFn).toHaveBeenCalledTimes(2);
    slowStop();

    windowListeners.get("pointermove")!();
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledTimes(5);
    fetchMock.mockClear();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fetchMock).toHaveBeenCalledTimes(12);

    doc.visibilityState = "hidden";
    listeners.get("visibilitychange")!();
    fetchMock.mockClear();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fetchMock).toHaveBeenCalledTimes(0);

    doc.visibilityState = "visible";
    listeners.get("visibilitychange")!();
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const stoppedFn = vi.fn();
    const stop = every(stoppedFn, 5_000);
    stoppedFn.mockClear();
    stop();
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(stoppedFn).not.toHaveBeenCalled();
    vi.clearAllTimers();
    vi.useRealTimers();
    console.info("idle policy reads: active 12/min; patched idle 4/min; wake +1; hidden +0; resume +1; stopped interval +0");
  });
});
