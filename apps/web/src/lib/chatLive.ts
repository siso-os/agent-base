import { useSyncExternalStore } from "react";
import type { State, Turn } from "./chat";

/**
 * What an open chat knows about its agent right now, for the chat header (ui-hub chat-header, Shaan 4 Oct 14:35: "I don't
 * even think it's accurate"). The header read herdr's row state while the input bar read the agent's own host, so the two
 * could disagree; the chat publishes its live state here and the header reads it, so both come from the host.
 */
export type ChatPreview = { text: string; at: number | null; session: string };
export type ChatLive = { sleep?: "asleep" | "waking" | null; state: State; step: string; turnAt: number | null; preview?: ChatPreview | null };

/** Reuse only completed assistant replies already read by the chat. Never persist this text. */
export function lastReadReply(turns: Turn[], session: string | null): ChatPreview | null {
  if (!session) return null;
  for (let i = turns.length - 1; i >= 0; i--) {
    const turn = turns[i];
    if (!turn.done) continue;
    const text = turn.answer.flatMap(item => item.k === "said" && !item.live ? [item.text.slice(0, 1600)] : []).join("\n").trim().slice(0, 1600);
    if (text) return { text, at: turn.endedAt, session };
  }
  return null;
}

const live = new Map<string, ChatLive>();
const subs = new Set<() => void>();

export function publishLive(id: string, v: ChatLive | null) {
  const was = live.get(id);
  if (v && was && was.sleep === v.sleep && was.state === v.state && was.step === v.step && was.turnAt === v.turnAt &&
    was.preview?.text === v.preview?.text && was.preview?.at === v.preview?.at && was.preview?.session === v.preview?.session) return;
  if (v) live.set(id, v);
  else live.delete(id);
  for (const s of subs) s();
}

export function useLive(id: string): ChatLive | null {
  return useSyncExternalStore(
    (cb) => (subs.add(cb), () => void subs.delete(cb)),
    () => live.get(id) ?? null,
  );
}
