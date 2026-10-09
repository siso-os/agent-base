// @ts-nocheck
const h = vi.hoisted(() => ({ data: null, pad: null, open: false, setters: [], source: vi.fn(), refresh: vi.fn(), storage: new Map() }));
vi.mock("react", () => ({
  useState: value => { const index = h.setters.length; const set = vi.fn(); h.setters.push(set); return [index === 0 && h.pad ? h.pad : index === 1 ? h.open : value, set]; },
  useRef: value => ({ current: value }),
  useEffect: effect => effect(),
}));
vi.mock("../poll", () => ({
  useSharedState: (...args) => { h.source(...args); return { data: h.data, error: null }; },
  refresh: h.refresh,
}));
vi.mock("../../components/A0Nav", () => ({ A0LaneRow: () => null, fleetRunning: () => false, ModelChip: () => null, nowLanes: () => [] }));

afterEach(() => { vi.unstubAllGlobals(); h.setters = []; h.data = null; h.pad = null; h.open = false; h.storage.clear(); vi.clearAllMocks(); });

it("uses shared visible reads and preserves once-only scratchpad auto-open after resume", async () => {
  vi.stubGlobal("localStorage", { getItem: key => h.storage.get(key) ?? null, setItem: (key, value) => h.storage.set(key, value) });
  vi.stubGlobal("document", { addEventListener: vi.fn(), removeEventListener: vi.fn() });
  // The shared poller supplies its latest read on visibility resume. No component interval or extra GET is needed.
  const fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock);
  const { ScratchpadChip } = await import("../../components/Scratchpad");
  ScratchpadChip();
  expect(h.source).toHaveBeenCalledWith("/api/scratchpad", 5000);
  expect(fetchMock).not.toHaveBeenCalled();
  h.setters = [];
  h.data = { date: "2026-10-05", updated: 1, pop: 10, items: [{ id: "a", text: "fixture", at: 1 }] };
  ScratchpadChip();
  expect(h.setters[0]).toHaveBeenCalledWith(h.data);
  expect(h.setters[1]).toHaveBeenCalledWith(true);
  expect(h.storage.get("ab.scratchpad.popSeen")).toBe("10");
  h.setters = [];
  ScratchpadChip();
  expect(h.setters[1]).not.toHaveBeenCalledWith(true);
  h.setters = []; h.data = { ...h.data, updated: 2, pop: 11 };
  ScratchpadChip();
  expect(h.setters[1]).toHaveBeenCalledWith(true);
});

it("shows a successful mutation immediately and forces a fresh shared read", async () => {
  vi.stubGlobal("localStorage", { getItem: () => null, setItem: vi.fn() });
  vi.stubGlobal("document", { addEventListener: vi.fn(), removeEventListener: vi.fn() });
  h.pad = { date: new Date().toLocaleDateString("en-CA"), updated: 1, items: [{ id: "a", text: "fixture", at: 1 }] };
  h.open = true;
  const updated = { ...h.pad, updated: 2, items: [] };
  const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => updated });
  vi.stubGlobal("fetch", fetchMock);
  const { ScratchpadChip } = await import("../../components/Scratchpad");
  const tree = ScratchpadChip();
  function find(node) {
    if (!node || typeof node !== "object") return null;
    if (node.props?.["aria-label"] === "Remove") return node;
    for (const child of [node.props?.children].flat(Infinity)) { const found = find(child); if (found) return found; }
    return null;
  }
  await find(tree).props.onClick();
  expect(fetchMock).toHaveBeenCalledWith("/api/scratchpad", expect.objectContaining({ method: "POST", body: '{"op":"remove","id":"a"}' }));
  expect(h.setters[0]).toHaveBeenCalledWith(updated);
  expect(h.refresh).toHaveBeenCalledWith("/api/scratchpad");
});

it("a pad from another day shows today's open tasks and folds the old pad", async () => {
  vi.stubGlobal("localStorage", { getItem: () => null, setItem: vi.fn() });
  vi.stubGlobal("document", { addEventListener: vi.fn(), removeEventListener: vi.fn() });
  const now = new Date().toISOString();
  h.pad = { date: "2026-10-03", updated: 1, items: [{ id: "a", text: "saturday line", at: 1, done: 2 }] };
  h.open = true;
  h.data = { tasks: [{ id: "t-1", title: "tonight", stage: "thought", updated: now }, { id: "t-2", title: "shipped", stage: "live", updated: now }, { id: "t-3", title: "old", stage: "thought", updated: "2026-10-03T10:00:00Z" }] };
  const { ScratchpadChip } = await import("../../components/Scratchpad");
  const text = JSON.stringify(ScratchpadChip(), (k, v) => (k === "_owner" || k === "_store" ? undefined : typeof v === "function" ? undefined : v));
  expect(text).toContain("Today's tasks");
  expect(text).toContain("t-1");
  expect(text).not.toContain("t-2");
  expect(text).not.toContain("t-3");
  expect(text).not.toContain("saturday line");
  expect(text).toContain("Pad from");
});
