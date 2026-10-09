// @ts-nocheck
import { describe, expect, it, vi } from "vitest";
import type { Agent, PinTarget, PinView } from "../agents";
import type { NavWorkspace } from "../workspace-nav";
import { agentPinEdits, agentPinLabel, bindPinEdit, canEditAgentPin, toggleAgentPin } from "../pin-actions";
import { normalizePinViews, pinStateLabel, pinTargetDescription, pinViewsFromSnapshot, readyPinAgent } from "../pin-view";

const row = (overrides: Partial<Agent> = {}): Agent => ({
  id: "row-a", key: "test/TWIN", name: "TWIN", machine: "test", machineKey: "test", tool: "claude",
  session: "session-a", row: "live", pinned: false, pinIds: [], ...overrides,
} as Agent);
const conversation: PinTarget = { kind: "conversation", machine: "test", harness: "claude", session: "session-a" };
const pin = (overrides: Partial<PinView> = {}): PinView => ({ id: "pin-a", name: "TWIN", target: conversation, state: "ready", agentId: "row-a", ...overrides });
const workspace: NavWorkspace = { id: "client", name: "Client", color: "blue", order: 0, owner: "OWNER" };

describe("exact pin routing", () => {
  it("keeps valid public views without copying storage-only recovery content", () => {
    expect(normalizePinViews([{ ...pin(), unresolvedSource: { private: "storage only" }, unknown: true }])).toEqual([pin()]);
  });

  it("keeps malformed transport entries blocked and tolerates missing pin fields", () => {
    expect(normalizePinViews(undefined)).toEqual([]);
    for (const input of [null, {}, "legacy", [null], pin(), [{ ...pin(), target: { kind: "owner" } }], [{ ...pin(), agentId: "" }], [{ ...pin(), state: "unknown" }]]) {
      expect(normalizePinViews(input).every(entry => entry.state !== "ready" && !entry.agentId && !("unresolvedSource" in entry))).toBe(true);
    }
  });

  it("blocks all duplicate reference IDs rather than recovering one into a ready pin", () => {
    expect(normalizePinViews([pin(), pin()]).every(entry => entry.state !== "ready")).toBe(true);
  });

  it("makes synthetic reference IDs read-only, including through cache reload", () => {
    for (const input of [[{ ...pin(), id: undefined, refEditable: true }], [pin(), pin()], pin()]) {
      const views = normalizePinViews(input);
      expect(views.every(entry => entry.refEditable === false)).toBe(true);
      expect(normalizePinViews(JSON.parse(JSON.stringify(views)), true).every(entry => entry.refEditable === false)).toBe(true);
      expect(views.every(entry => bindPinEdit(entry, entry.target, conversation) === null)).toBe(true);
    }
  });

  it("accepts explicit unique server recovery IDs without trusting client allow flags", () => {
    const recovered = pin({ id: "recovered-pin-0" });
    expect(normalizePinViews([{ ...recovered, refEditable: false }])).toEqual([recovered]);
    expect(normalizePinViews([recovered], true)).toEqual([recovered]);
    expect(normalizePinViews([{ ...pin(), id: "", refEditable: true }])[0].refEditable).toBe(false);
  });

  it("retains an old cache's legacy labels and duplicate order as read-only offline placeholders", () => {
    const legacy = pinViewsFromSnapshot(undefined, ["TWIN", "OWNER", "TWIN"], [], true);
    expect(legacy.map(entry => entry.name)).toEqual(["TWIN", "OWNER", "TWIN"]);
    expect(new Set(legacy.map(entry => entry.id)).size).toBe(3);
    expect(legacy.every(entry => entry.target === null && entry.state === "unresolved" && entry.refEditable === false)).toBe(true);
    expect(legacy.every(entry => readyPinAgent(entry, [row()], []) === null && bindPinEdit(entry, null, conversation) === null)).toBe(true);
  });

  it("preserves remembered authoritative refs when an older response omits pin views", () => {
    const owner = pin({ id: "owner-ref", target: { kind: "owner", workspaceId: "client" } });
    const blocked = pinViewsFromSnapshot(undefined, ["different legacy name"], [pin(), owner]);
    expect(blocked.map(entry => [entry.id, entry.target])).toEqual([["pin-a", conversation], ["owner-ref", owner.target]]);
    expect(blocked.every(entry => entry.state === "unavailable" && !entry.agentId)).toBe(true);
    expect(blocked.every(entry => entry.refEditable !== false)).toBe(true);
    expect(pinViewsFromSnapshot(undefined, [], blocked).map(entry => entry.id)).toEqual(["pin-a", "owner-ref"]);
  });

  it("refreshes legacy-only labels without ever inferring their target", () => {
    const old = pinViewsFromSnapshot(undefined, ["TWIN"]);
    const refreshed = pinViewsFromSnapshot(undefined, ["OWNER", "TWIN"], old);
    expect(refreshed.map(entry => entry.name)).toEqual(["OWNER", "TWIN"]);
    expect(refreshed.every(entry => entry.refEditable === false && entry.target === null)).toBe(true);
  });

  it("replaces legacy/failure placeholders only when authoritative views arrive", () => {
    const legacy = pinViewsFromSnapshot(undefined, ["TWIN"]);
    const cached = pinViewsFromSnapshot(JSON.parse(JSON.stringify(legacy)), ["TWIN"], [], true);
    expect(cached.every(entry => entry.refEditable === false)).toBe(true);
    const upgraded = pinViewsFromSnapshot([pin()], ["TWIN"], cached);
    expect(upgraded).toEqual([pin()]);
    const olderResponse = pinViewsFromSnapshot(undefined, ["TWIN"], upgraded);
    expect(readyPinAgent(olderResponse[0], [row()], [])).toBeNull();
    expect(pinViewsFromSnapshot([pin()], ["TWIN"], olderResponse)).toEqual([pin()]);
    expect(pinViewsFromSnapshot([], ["TWIN"], olderResponse)).toEqual([]);
  });

  it("opens the same exact conversation when duplicate display names reorder", () => {
    const chosen = row();
    const other = row({ id: "row-b", session: "session-b" });
    expect(readyPinAgent(pin(), [chosen, other], [])).toBe(chosen);
    expect(readyPinAgent(pin(), [other, chosen], [])).toBe(chosen);
  });

  it("keeps two same-name conversation references distinct", () => {
    const a = row();
    const b = row({ id: "row-b", session: "session-b" });
    const second = pin({ id: "pin-b", agentId: b.id, target: { ...conversation, session: "session-b" } });
    expect([pin(), second].map(p => readyPinAgent(p, [b, a], [])?.id)).toEqual([a.id, b.id]);
  });

  it("allows a label change without changing the conversation", () => {
    const renamed = row({ name: "RENAMED" });
    expect(readyPinAgent(pin(), [renamed], [])).toBe(renamed);
  });

  it("refuses a reused terminal ID with a different session, machine or harness", () => {
    for (const changed of [{ session: "replacement" }, { machineKey: "other" }, { tool: "codex" }]) {
      expect(readyPinAgent(pin(), [row(changed)], [])).toBeNull();
    }
  });

  it("does not silently retarget an older ready projection to a new row", () => {
    expect(readyPinAgent(pin(), [row({ id: "new-id" })], [])).toBeNull();
  });

  it("rejects duplicate conversation claimants, including settled rows", () => {
    expect(readyPinAgent(pin(), [row(), row({ id: "duplicate", row: "settled" })], [])).toBeNull();
    expect(readyPinAgent(pin(), [row(), row({ session: "other" })], [])).toBeNull();
  });

  it("keeps blocked server projections blocked even when a current match exists", () => {
    for (const state of ["unavailable", "ambiguous", "unresolved"] as const) {
      expect(readyPinAgent(pin({ state }), [row()], [])).toBeNull();
    }
    expect(readyPinAgent(pin({ target: null }), [row()], [])).toBeNull();
  });

  it("validates owner configuration and never rebinds an old ready row projection", () => {
    const ownerPin = pin({ target: { kind: "owner", workspaceId: "client" } });
    const owner = row({ name: "OWNER", workspace: "client", kind: "owner" });
    expect(readyPinAgent(ownerPin, [owner], [workspace])).toBe(owner);
    expect(readyPinAgent(ownerPin, [], [workspace])).toBeNull();
    expect(readyPinAgent(ownerPin, [owner], [])).toBeNull();
    expect(readyPinAgent(ownerPin, [owner], [workspace, { ...workspace, owner: "" }])).toBeNull();
    expect(readyPinAgent(ownerPin, [row({ ...owner, id: "resumed" })], [workspace])).toBeNull();
  });

  it("describes unavailable owner slots and unresolved legacy entries visibly", () => {
    const ownerPin = pin({ state: "unavailable", target: { kind: "owner", workspaceId: "client" } });
    expect(pinTargetDescription(ownerPin, [workspace])).toBe("Client · owner slot");
    expect(pinStateLabel(ownerPin, null)).toBe("Unavailable");
    expect(pinStateLabel(pin({ state: "ambiguous" }), null)).toBe("Ambiguous");
    expect(pinStateLabel(pin({ target: null, state: "unresolved" }), null)).toBe("Choose target");
  });
});

describe("exact pin mutations", () => {
  it("sends an explicit null precondition for an unresolved chooser", () => {
    expect(bindPinEdit(pin({ target: null, state: "unresolved" }), null, conversation, "row-a")).toEqual({ op: "bind-pin", pinId: "pin-a", target: conversation, expectedTarget: null, agentId: "row-a" });
  });

  it("preserves the owner target observed when the chooser opened", () => {
    const expectedTarget: PinTarget = { kind: "owner", workspaceId: "client" };
    expect(bindPinEdit(pin({ target: expectedTarget }), expectedTarget, conversation, "row-a")).toEqual({ op: "bind-pin", pinId: "pin-a", target: conversation, expectedTarget, agentId: "row-a" });
  });

  it("refuses to adopt a newer binding while an older chooser is open", () => {
    expect(bindPinEdit(pin(), null, { kind: "owner", workspaceId: "client" })).toBeNull();
    expect(bindPinEdit(pin({ target: { kind: "owner", workspaceId: "changed" } }), { kind: "owner", workspaceId: "client" }, conversation, "row-a")).toBeNull();
  });

  it("never synthesizes a pin target from a display name", () => {
    expect(agentPinEdits(row())).toEqual([]);
    expect(canEditAgentPin(row())).toBe(false);
    expect(agentPinEdits(row({ pinned: true }))).toEqual([]);
  });

  it("sends only the supplied target and exact selected row ID", () => {
    expect(agentPinEdits(row({ pinTarget: conversation }))).toEqual([{ op: "pin-target", name: "TWIN", target: conversation, agentId: "row-a" }]);
  });

  it("removes a single reference by ID rather than by label", () => {
    expect(agentPinEdits(row({ pinned: true, pinIds: ["pin-a", "pin-a"] }))).toEqual([{ op: "unpin-ref", pinId: "pin-a" }]);
  });

  it("routes owner plus conversation pins to the manager without deleting either", () => {
    const agent = row({ pinned: true, pinIds: ["owner-ref", "conversation-ref"] });
    const edit = vi.fn();
    const manage = vi.fn();
    expect(agentPinEdits(agent)).toEqual([]);
    expect(agentPinLabel(agent)).toBe("Manage pins");
    toggleAgentPin(agent, edit, manage);
    expect(edit).not.toHaveBeenCalled();
    expect(manage).toHaveBeenCalledOnce();
  });
});
