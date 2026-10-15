// @ts-nocheck
import { describe, expect, it } from "vitest";
import { defineRegistry, type Module } from "@siso/os";
import { registry, SPACES } from "../../os/registry";

const mod = (over: Partial<Module>): Module => ({ id: "x", name: "X", space: "agent-base", icon: "x", order: 0, entry: { kind: "builtin", component: "x" }, ...over });

describe("SISO OS registry (siso-os.md §4, §5)", () => {
  it("has the three spaces in order", () => {
    expect(registry.spaces.map((s) => s.id)).toEqual(["agent-base", "app-factory", "agency"]);
  });
  it("puts today's modules where §5 says", () => {
    expect(registry.modulesOf("agent-base").map((m) => m.id)).toEqual(["siso-code", "agents", "tasks", "voice", "browser", "estate", "agents-hub", "siso-music", "people-graph"]);
    expect(registry.modulesOf("app-factory").map((m) => m.id)).toEqual(["app-factory"]);
    expect(registry.modulesOf("agency").map((m) => m.id)).toEqual(["whatsapp", "rolodex"]);
    expect(registry.bottom.map((m) => m.id)).toEqual(["library", "questions"]);
    expect(registry.avatar.map((m) => m.id)).toEqual(["life"]);
  });
  it("keeps private modules off the mirror", () => {
    for (const id of ["whatsapp", "life", "rolodex"]) expect(registry.byId(id)?.mirror).toBeUndefined();
  });
  it("refuses a duplicate id, an unknown space and a non-http URL", () => {
    expect(() => defineRegistry(SPACES, [mod({}), mod({})])).toThrow(/Two modules/);
    expect(() => defineRegistry(SPACES, [mod({ space: "nowhere" as never })])).toThrow(/doesn't exist/);
    expect(() => defineRegistry(SPACES, [mod({ entry: { kind: "url", url: "file:///etc" } })])).toThrow(/http/);
  });
  it("orders by order, then id, and hides hidden modules from the rail", () => {
    const r = defineRegistry(SPACES, [mod({ id: "b", order: 1 }), mod({ id: "a", order: 1 }), mod({ id: "c", order: 0, hidden: true })]);
    expect(r.modulesOf("agent-base").map((m) => m.id)).toEqual(["a", "b"]);
    expect(r.byId("c")?.hidden).toBe(true);
  });
});
