import { useSyncExternalStore } from "react";

// Which half of Communications is showing (Shaan, 10 Oct: "Merge Rolodex and WhatsApp"): Chats or People, and the person
// or chat to open there. The shell sets it before it opens the space (an old Rolodex link opens People); the module reads it.
export type CommsTab = "chats" | "people";
export type CommsState = { tab: CommsTab; person?: string; chatKey?: string; nonce: number };
const KEY = "agent-base:comms-tab";
let state: CommsState = { tab: (() => { try { return localStorage.getItem(KEY) === "people" ? "people" : "chats"; } catch { return "chats"; } })(), nonce: 0 };
const subs = new Set<() => void>();

export function setComms(next: Partial<Omit<CommsState, "nonce">> & { tab: CommsTab }) {
  state = { ...next, nonce: state.nonce + 1 };
  try { localStorage.setItem(KEY, state.tab); } catch { /* private window */ }
  for (const s of [...subs]) s();
}
export const useComms = () => useSyncExternalStore((s) => { subs.add(s); return () => { subs.delete(s); }; }, () => state);
