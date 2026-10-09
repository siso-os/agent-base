/**
 * ecosystem SPEC §3.1 #7: a menu elsewhere in the app opens an agent's chat with words already typed ("about <postcode>",
 * "Luna task on <postcode>: "). The words wait here for that agent's chat. They stay for a few seconds rather than being
 * taken once, because the chat can mount twice while it opens (keep-mounted, then its transcript arrives); a draft he
 * already started is kept.
 */
const waiting = new Map<string, { text: string; at: number }>();
const subs = new Set<() => void>();
const FRESH_MS = 10_000;
export function prefill(agentId: string, text: string) {
  waiting.set(agentId, { text, at: Date.now() });
  subs.forEach((f) => f());
}
export function readPrefill(agentId: string): string | undefined {
  const w = waiting.get(agentId);
  if (w && Date.now() - w.at > FRESH_MS) waiting.delete(agentId);
  return w && Date.now() - w.at <= FRESH_MS ? w.text : undefined;
}
/** Sent or changed: the words have landed. */
export const clearPrefill = (agentId: string) => void waiting.delete(agentId);
export const onPrefill = (f: () => void) => (subs.add(f), () => void subs.delete(f));
