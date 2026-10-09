import { normalizePinRefs, resolveAgentPin } from "../../../../services/node/src/agent-pins";
import type { Agent, PinView } from "./agents";
import type { NavWorkspace } from "./workspace-nav";

/** Project only public fields. Malformed transport/cache entries survive visibly without ready authority. */
export function normalizePinViews(value: unknown, fromCache = false): PinView[] {
  if (value === undefined) return [];
  const entries: unknown[] = Array.isArray(value) ? value.slice(0, 1000) : [value];
  const objects = entries.map(entry => entry && typeof entry === "object" && !Array.isArray(entry) ? entry as Record<string, unknown> : {});
  return normalizePinRefs(entries).map((pin, index) => {
    const source = objects[index];
    const duplicate = objects.filter(entry => entry.id === pin.id).length > 1;
    const validIdentity = Array.isArray(value) && source.id === pin.id && !duplicate && !(fromCache && source.refEditable === false);
    // Never trust an incoming allow flag. A cached denial is retained until a fresh valid server view.
    const clean = { id: pin.id, name: pin.name, target: pin.target, ...(!validIdentity ? { refEditable: false } : {}) };
    if (!pin.target) return { ...clean, state: "unresolved", detail: "Choose an owner or conversation for this saved pin" };
    if (duplicate) return { ...clean, state: "ambiguous", detail: "Saved pin identity is duplicated" };
    const valid = validIdentity && source.name === pin.name;
    const detail = typeof source.detail === "string" ? source.detail.slice(0, 500) : undefined;
    if (valid && source.state === "ready" && typeof source.agentId === "string" && source.agentId.length > 0 && source.agentId.length <= 300 && source.agentId.trim() === source.agentId && !/[\x00-\x1f\x7f]/.test(source.agentId)) {
      return { ...clean, state: "ready", agentId: source.agentId, ...(detail ? { detail } : {}) };
    }
    const state = valid && (source.state === "ambiguous" || source.state === "unresolved") ? source.state : "unavailable";
    return { ...clean, state, detail: detail || "Saved pin status is unavailable" };
  });
}

/** Older nodes/caches can name saved shortcuts but cannot authorize their targets or reference IDs. */
export function pinViewsFromSnapshot(value: unknown, legacyNames: unknown, previous: PinView[] = [], fromCache = false): PinView[] {
  if (value !== undefined) return normalizePinViews(value, fromCache);
  const hadAuthoritativeRefs = previous.some(pin => pin.refEditable !== false);
  const saved: PinView[] = hadAuthoritativeRefs || !Array.isArray(legacyNames) ? previous : legacyNames.slice(0, 1000).map((name, index) => ({
    id: `client-legacy-pin-${index}`,
    name: typeof name === "string" && name.trim() ? name : "Saved agent",
    target: null,
    state: "unresolved",
    refEditable: false,
  }));
  return saved.map(({ id, name, target, refEditable }) => ({
    id, name, target,
    ...(refEditable === false ? { refEditable: false } : {}),
    state: target ? "unavailable" : "unresolved",
    detail: "Saved shortcut. Waiting for authoritative pin information from the node.",
  }));
}

/** A ready projection never authorizes a different row, even during a stale poll or reused terminal ID. */
export function readyPinAgent(pin: PinView, agents: Agent[], workspaces: NavWorkspace[]): Agent | null {
  if (pin.refEditable === false || pin.state !== "ready" || !pin.agentId || !pin.target) return null;
  const current = resolveAgentPin(pin, agents, workspaces.map(workspace => ({ ...workspace, owner: workspace.owner ?? "" })));
  if (current.state !== "ready" || current.agentId !== pin.agentId) return null;
  return agents.find(agent => agent.id === current.agentId) ?? null;
}

export function pinStateLabel(pin: PinView, agent: Agent | null): string {
  if (agent) return "Ready";
  if (pin.state === "ambiguous") return "Ambiguous";
  if (pin.state === "unresolved" || !pin.target) return "Choose target";
  return "Unavailable";
}

export function pinTargetDescription(pin: PinView, workspaces: NavWorkspace[]): string {
  if (!pin.target) return "Saved name only. Choose an owner slot or an exact conversation.";
  if (pin.target.kind === "owner") {
    const id = pin.target.workspaceId;
    return `${workspaces.find(workspace => workspace.id === id)?.name ?? id} · owner slot`;
  }
  return `${pin.target.machine} · ${pin.target.harness} · session ${pin.target.session}`;
}
