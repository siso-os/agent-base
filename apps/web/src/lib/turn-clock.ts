import { useSyncExternalStore } from "react";

/**
 * HUB-DESIGN 23:10: the time beside "Working" is the working line's own clock, from his last message, not when herdr
 * last flipped the status. ChatView knows the turn; it publishes its start here per agent and the panel reads it.
 */
const starts = new Map<string, number>();
const subs = new Set<() => void>();
export function setTurnStart(agentId: string, at: number | null) {
  if ((starts.get(agentId) ?? null) === at) return;
  if (at === null) starts.delete(agentId);
  else starts.set(agentId, at);
  subs.forEach((f) => f());
}
export const useTurnStart = (agentId: string) =>
  useSyncExternalStore(
    (f) => (subs.add(f), () => subs.delete(f)),
    () => starts.get(agentId) ?? null,
  );
