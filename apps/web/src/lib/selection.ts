/**
 * t-0265 (Shaan 3 Oct: "sometimes I keep auto switching to the efficiency agent"): every change of the open agent, with
 * what caused it. The app keeps the last 200 here (localStorage) and sends each to the node, which appends it to
 * ~/.local/state/agent-base/selection.jsonl. Names and causes only, never a message.
 */
export type SelectCause =
  // His own hand: a row, a face, a card, a key.
  | "click"
  | "dock"
  | "key"
  | "next-needs-you"
  | "needs-dot"
  | "close"
  // Back and forward (his buttons, ⌘[ ⌘], the mouse's back button, a swipe): his, but it can come by accident.
  | "history"
  // The app on its own.
  | "restore-key"
  | "restore-zero"
  | "seat-follow"
  | "moved"
  | "say-start";
/** Not selections, on the same record: the open agent leaving the list, a page that tried to open a tab with no click of
 * his (3 Oct: pages never open on their own; `to` is "page:<host>"), and the one-time tab cleanup. */
export type SelectEntry = { from: string | null; to: string | null; cause: SelectCause | "active-gone" | "auto-open" | "tab-cleanup"; at: number; blocked?: "typing" | "own-click" | "no-click" };

/** His own hand (and a back or forward): these always happen; any other cause waits for him. */
export const BY_HIM: ReadonlySet<SelectCause> = new Set(["click", "dock", "key", "next-needs-you", "needs-dot", "close", "history"]);
const KEY = "agent-base:selection-log";
const KEEP = 200;

export const isEditable = (el: EventTarget | Element | null): boolean =>
  el instanceof HTMLElement && (el.isContentEditable || el instanceof HTMLTextAreaElement || (el instanceof HTMLInputElement && !["button", "checkbox", "radio", "submit", "range", "color", "file"].includes(el.type)));

export function selectionLog(): SelectEntry[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

export function recordSelection(e: SelectEntry) {
  try {
    localStorage.setItem(KEY, JSON.stringify([...selectionLog(), e].slice(-KEEP)));
  } catch {
    /* storage full or blocked: the node's copy still has it */
  }
  void fetch("/api/selection", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(e), keepalive: true }).catch(() => {});
}
