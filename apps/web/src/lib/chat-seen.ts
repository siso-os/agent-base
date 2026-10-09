import type { Ev } from "./chat";

/**
 * The chat he was reading, kept for this window across a reload (t-0458, Shaan 7 Oct: "Agent Zero does take a second to
 * load once the app refreshes. Kind of annoying."). A reload paints the last turns at once and the socket's first snapshot
 * replaces them, so there is no empty "Connecting to the chat…" in between. sessionStorage only: it lives as long as the
 * window, never reaches disk across an app restart, and a pinned (sealed) conversation or an ended chat is never kept.
 */
const KEY = (agentId: string) => `ab.chat-seen:${agentId}`;
const MAX_EVENTS = 300;
const MAX_BYTES = 600_000;

/** The tail of the log, cut at one of his messages so the first kept turn is whole. */
export function seenTail(events: Ev[], max = MAX_EVENTS): Ev[] {
  if (events.length <= max) return events;
  const from = events.length - max;
  const start = events.findIndex((e, i) => i >= from && e.t === "user" && !e.mid);
  return start < 0 ? events.slice(from) : events.slice(start);
}

export function readSeen(agentId: string): Ev[] {
  try {
    const value = JSON.parse(sessionStorage.getItem(KEY(agentId)) ?? "null");
    return Array.isArray(value) ? value as Ev[] : [];
  } catch { return []; }
}

export function writeSeen(agentId: string, events: Ev[]) {
  try {
    if (!events.length) return sessionStorage.removeItem(KEY(agentId));
    const text = JSON.stringify(seenTail(events));
    if (text.length > MAX_BYTES) return sessionStorage.removeItem(KEY(agentId));
    sessionStorage.setItem(KEY(agentId), text);
  } catch { /* Storage full or unavailable: the next load waits for the socket, as before. */ }
}
