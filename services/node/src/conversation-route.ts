import { readPinTarget, resolveAgentPin, type PinTarget, type PinRow } from "./agent-pins.ts";

/** Click-time intent. Kept separate from a reusable row ID and never refreshed from polling rows. */
export type ConversationPinTarget = Extract<PinTarget, { kind: "conversation" }>;

export function conversationChatQuery(target?: ConversationPinTarget): string {
  return target ? `?pin=${encodeURIComponent(JSON.stringify(target))}` : "";
}

/** A single canonical payload rejects duplicate parameters/JSON keys and partial or unsupported identities. */
export function parseConversationChatTarget(params: URLSearchParams): { valid: boolean; target: ConversationPinTarget | null } {
  const values = params.getAll("pin");
  if (!values.length) return { valid: true, target: null };
  if (values.length !== 1) return { valid: false, target: null };
  try {
    const target = readPinTarget(JSON.parse(values[0]));
    if (target?.kind !== "conversation" || JSON.stringify(target) !== values[0]) return { valid: false, target: null };
    return { valid: true, target };
  } catch { return { valid: false, target: null }; }
}

export function matchesConversationTarget(target: ConversationPinTarget, rows: PinRow[], id: string): boolean {
  const resolved = resolveAgentPin({ id: "chat-route", name: "Conversation", target }, rows, []);
  return resolved.state === "ready" && resolved.agentId === id;
}
