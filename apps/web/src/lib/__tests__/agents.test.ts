// @ts-nocheck
import { byWhoNeedsYou, layout, sidebarOrder } from "../agents";

const agent = (name, extra = {}) => ({ id: name, name, status: "idle", since: 1, row: "live", zero: false, pinned: false, project: null, ...extra });

describe("agent layout and sidebar order", () => {
  it("puts Agent Zero above other rows", () => expect(sidebarOrder([agent("x"), agent("zero", { zero: true })], []).map((a) => a.name)[0]).toBe("zero"));
  it("groups workers under their owner", () => {
    const result = layout([agent("lead", { project: "P" }), agent("worker", { owner: "lead", project: "P" })], ["P"]);
    expect(result.sections[0].teams[0].crew.map((a) => a.name)).toEqual(["worker"]);
  });
  it("places workers alone when their owner is absent", () => expect(sidebarOrder([agent("worker", { owner: "missing", project: "P" })], ["P"]).map((a) => a.name)).toEqual(["worker"]));
  it("returns pinned agents in pinned group", () => expect(layout([agent("pin", { pinned: true })], []).pinned.map((x) => x.lead.name)).toEqual(["pin"]));
  it("keeps pinned agents once in numeric shortcut order", () => {
    const order = sidebarOrder([
      agent("zero", { zero: true }),
      agent("pin", { pinned: true, project: "P" }),
      agent("regular", { project: "P" }),
    ], ["P"]);
    expect(order.map((a) => a.name)).toEqual(["zero", "pin", "regular"]);
  });
  it("follows visible project order with a later pinned owner and its crew", () => {
    const order = sidebarOrder([
      agent("zero", { zero: true }),
      agent("first", { project: "First" }),
      agent("second", { project: "Second", pinned: true }),
      agent("worker", { project: "Second", owner: "second" }),
    ], ["First", "Second"]);
    // Sidebar renders sections in domain order; each team renders its lead, then its folded crew in source order.
    expect(order.map((a) => a.name)).toEqual(["zero", "first", "second", "worker"]);
  });
  it("omits settled rows from the live sidebar", () => expect(sidebarOrder([agent("done", { row: "settled" })], [])).toEqual([]));
  it("lists every Agent Zero under the one entry, the default first, none as its own row (t-0264)", () => {
    const l = layout([agent("A0 CLI", { a0: true }), agent("Agent Zero", { zero: true, a0: true }), agent("x")], []);
    expect([l.zeros.map((a) => a.name), l.sections.flatMap((s) => s.teams.map((t) => t.lead.name))]).toEqual([["Agent Zero", "A0 CLI"], ["x"]]);
  });
  it("ranks needs-you ahead of working", () => expect(byWhoNeedsYou(agent("work", { status: "working" }), agent("need", { status: "needs" }))).toBeGreaterThan(0));
});
