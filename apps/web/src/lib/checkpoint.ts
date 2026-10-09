export type CheckpointState = "done" | "in-progress" | "blocked" | null;

export type CheckpointSection = { title: string; body: string; state: CheckpointState };
export type Checkpoint = { summary: string; sections: CheckpointSection[] };

const STATE_MARK = /^(?:✅|☑️?|✔️?)/u;
const PROGRESS_MARK = /^(?:⏳|🔄|🚧)/u;
const BLOCKED_MARK = /^(?:⛔|🚫|❌)/u;
const LIST_LINE = /^\s*(?:(?:[-*+]\s+)|(?:\d+[.)]\s+))(.+)$/;

function stateOf(text: string): CheckpointState {
  const value = text.trim();
  if (STATE_MARK.test(value)) return "done";
  if (PROGRESS_MARK.test(value)) return "in-progress";
  if (BLOCKED_MARK.test(value)) return "blocked";
  return null;
}

function cleanLead(text: string): string {
  return text.trim().replace(/^(?:✅|☑️?|✔️?|⏳|🔄|🚧|⛔|🚫|❌)\s*/u, "").replace(/^\*\*(.+?)\*\*:?\s*/, "$1: ").trim();
}

function isHeading(line: string): boolean {
  const clean = line.trim().replace(/^#{1,6}\s+/, "").replace(/^\*\*(.*?)\*\*:?$/, "$1").replace(/:$/, "");
  return /^(?:checkpoint|status(?: report)?|progress|summary|next(?: steps?)?|blocked|completed?|what(?:'s| is) (?:done|next|blocked)|verification|results?)\b/i.test(clean);
}

/** Split a checkpoint-style assistant answer into a short lead and collapsible rows. Plain prose is returned unchanged. */
export function splitCheckpoint(text: string): Checkpoint | null {
  const lines = text.trim().split(/\r?\n/);
  if (!lines.length || !text.trim()) return null;

  const headingIndex = lines.findIndex(isHeading);
  const candidateLines = lines.slice(headingIndex >= 0 ? headingIndex + 1 : 0);
  const hasStructuredItems = candidateLines.some((line) => LIST_LINE.test(line) || /^\s*\*\*Next:\*\*/i.test(line));
  if (headingIndex < 0 || !hasStructuredItems) return null;

  const summary = lines.slice(0, headingIndex + 1).map((line) => line.trim().replace(/^#{1,6}\s+/, "").replace(/^\*\*(.*?)\*\*:?$/, "$1")).filter(Boolean).join(" ");
  const sections: CheckpointSection[] = [];
  let current: CheckpointSection | null = null;
  const flush = () => {
    if (current) {
      current.body = current.body.trim();
      sections.push(current);
      current = null;
    }
  };

  for (const line of candidateLines) {
    const item = line.match(LIST_LINE);
    const next = line.trim().match(/^\*\*Next:\*\*\s*(.*)$/i);
    if (item || next) {
      flush();
      const raw = (item?.[1] ?? next?.[1] ?? "").trim();
      if (!raw) continue;
      const state = stateOf(raw);
      const lead = cleanLead(raw);
      const splitAt = lead.match(/^([^:—–]{2,64})\s*[:—–]\s*(.*)$/);
      const title = splitAt?.[1]?.trim() || lead.slice(0, 72);
      const body = splitAt?.[2]?.trim() || (lead.length > 72 ? lead : "");
      current = { title, body, state: next ? "in-progress" : state };
    } else if (current && line.trim()) {
      current.body += `${current.body ? "\n" : ""}${line.trim()}`;
    } else if (current && !line.trim()) {
      flush();
    }
  }
  flush();

  return sections.length ? { summary: summary || "Checkpoint", sections } : null;
}
