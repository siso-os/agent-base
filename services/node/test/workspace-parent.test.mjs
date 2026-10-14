// A workspace's parent clears with null (lifted to the top of the nav), and a seeded nav workspace set nav:false stays off.
import assert from "node:assert/strict";
import test from "node:test";
import { editWorkspace, seedWorkspaces } from "../src/workspace-registry.ts";

test("parent null lifts a workspace and survives a reload", () => {
  const all = seedWorkspaces([{ id: "clients", name: "Clients", owner: "", group: "Clients", color: "#e6a46a", order: 3, nav: true, parent: "siso-agency" }]);
  assert.equal(editWorkspace(all, { workspaces: [{ id: "clients", parent: null }, { id: "siso-agency", nav: false }] }), null);
  const again = seedWorkspaces(JSON.parse(JSON.stringify(all)));
  assert.equal(again.find((w) => w.id === "clients").parent, undefined);
  assert.equal(again.find((w) => w.id === "siso-agency").nav, false);
});

test("parent still rejects junk", () => {
  const all = seedWorkspaces([]);
  assert.equal(editWorkspace(all, { id: "agent-base", parent: 5 }), "invalid workspace parent");
});
