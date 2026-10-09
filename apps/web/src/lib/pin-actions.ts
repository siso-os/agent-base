import { pinTargetKey } from "../../../../services/node/src/agent-pins";
import type { Agent, PinTarget, PinView, RegistryEdit } from "./agents";

export const samePinTarget = (left: PinTarget | null, right: PinTarget | null): boolean =>
  (left ? pinTargetKey(left) : null) === (right ? pinTargetKey(right) : null);

/** The precondition is captured when the chooser opens, never adopted from a later poll. */
export function bindPinEdit(pin: PinView, expectedTarget: PinTarget | null, target: PinTarget, agentId?: string): RegistryEdit | null {
  if (pin.refEditable === false || !samePinTarget(pin.target, expectedTarget)) return null;
  return { op: "bind-pin", pinId: pin.id, target, expectedTarget, ...(agentId ? { agentId } : {}) };
}

/** Pin controls use only the node's supplied identities, including when two labels are identical. */
export function agentPinEdits(agent: Agent): RegistryEdit[] {
  if (agent.pinned) {
    const ids = [...new Set(agent.pinIds ?? [])];
    return ids.length === 1 ? [{ op: "unpin-ref", pinId: ids[0] }] : [];
  }
  return agent.pinTarget ? [{ op: "pin-target", name: agent.name, target: agent.pinTarget, agentId: agent.id }] : [];
}

export function canEditAgentPin(agent: Agent): boolean {
  return agentNeedsPinManager(agent) || agentPinEdits(agent).length > 0;
}

export function agentNeedsPinManager(agent: Agent): boolean {
  return agent.pinned && new Set(agent.pinIds ?? []).size > 1;
}

export function agentPinLabel(agent: Agent, label = "Pin"): string {
  return agentNeedsPinManager(agent) ? "Manage pins" : !canEditAgentPin(agent) ? "Pin target unavailable" : agent.pinned ? "Unpin" : label;
}

export function toggleAgentPin(agent: Agent, edit: (change: RegistryEdit) => void, onManagePins?: () => void): void {
  if (agentNeedsPinManager(agent)) { onManagePins?.(); return; }
  for (const change of agentPinEdits(agent)) edit(change);
}
