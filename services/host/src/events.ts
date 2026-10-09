/**
 * How a Claude tool call is told in the app's chat: one line for it, what it was asked (a command, an edit's old and
 * new text) and the head of its result. Shared by siso-host (live and history) and the laptop node (chats read from a
 * terminal agent's session file), so both draw the same.
 */
/** What a tool was asked to do, for the app to draw as the CLI does: a command, or an edit's old and new text. */
/**
 * R1.20c (C10/H3/E4): the tools with no words of their own (messages, wake-ups, monitors, task and cron tools) carry what
 * the chat needs to say what they did: `to` and `text` for a message, `target` for the task or schedule they act on,
 * `wait` for a wake-up's delay in seconds (-1: the loop was stopped).
 */
export type ToolInput = {
  command?: string; description?: string; path?: string; old?: string; new?: string; created?: boolean;
  to?: string; text?: string; target?: string; wait?: number;
};

export function summarize(name: string, input: Record<string, any>): string {
  const s =
    name === "Bash" ? input.command :
    name === "Read" || name === "Write" || name === "Edit" || name === "NotebookEdit" ? input.file_path :
    name === "Grep" || name === "Glob" ? input.pattern :
    name === "Agent" || name === "Task" ? input.description :
    name === "Skill" ? input.skill ?? input.command :
    name === "WebFetch" ? input.url :
    name === "WebSearch" ? input.query :
    Object.values(input).find((v) => typeof v === "string");
  return String(s ?? "").replace(/\s+/g, " ").slice(0, 160);
}

export const cap = (v: unknown, max: number) => (typeof v === "string" ? (v.length > max ? `${v.slice(0, max)}\n…` : v) : undefined);
export function toolInput(name: string, input: Record<string, any>): ToolInput | undefined {
  if (name === "Bash") return { command: cap(input.command, 2000), description: cap(input.description, 200) };
  if (name === "Edit") return { path: input.file_path, old: cap(input.old_string, 4000), new: cap(input.new_string, 4000) };
  if (name === "Write") return { path: input.file_path, new: cap(input.content, 4000), created: true };
  const str = (v: unknown, max = 200) => (typeof v === "string" && v.trim() ? cap(v.replace(/\s+/g, " ").trim(), max) : undefined);
  if (name === "SendMessage") return { to: str(input.to ?? input.recipient, 80), text: cap(input.message ?? input.content, 4000), description: str(input.summary) };
  if (name === "ScheduleWakeup") return { wait: input.stop ? -1 : Number(input.delaySeconds) || 0, description: str(input.reason) };
  if (name === "Monitor") return { description: str(input.description), command: cap(input.command, 2000) };
  if (name === "TaskStop" || name === "TaskOutput" || name === "TaskGet" || name === "CronDelete") return { target: str(input.task_id ?? input.shell_id ?? input.taskId ?? input.id, 80) };
  if (name === "TaskUpdate") return { target: str(input.taskId ?? input.task_id, 80), description: str(input.status ?? input.subject) };
  if (name === "TaskCreate") return { description: str(input.subject ?? input.description) };
  if (name === "ToolSearch") return { description: str(input.query) };
  if (name === "CronCreate") return { description: str(input.cron) };
  if (name === "PushNotification") return { description: str(input.title ?? input.message) };
  // The to-do list's task in progress, in its own present tense ("Running tests"): the CLI's live line uses it.
  if (name === "TodoWrite" && Array.isArray(input.todos)) {
    const now = input.todos.find((t: any) => t?.status === "in_progress");
    return now?.activeForm ? { description: cap(now.activeForm, 120) } : undefined;
  }
  return undefined;
}
/** The head of a tool result as the CLI shows it under "⎿": the first lines, each and all capped; and the full count. */
export function toolOut(content: unknown): { out: string; lines: number } {
  const text = typeof content === "string" ? content : Array.isArray(content) ? content.filter((b: any) => b?.type === "text").map((b: any) => b.text).join("\n") : "";
  const all = text.replace(/\s+$/, "").split("\n");
  let head = all.slice(0, 8).map((l) => (l.length > 300 ? `${l.slice(0, 300)}…` : l)).join("\n");
  if (head.length > 1500) head = `${head.slice(0, 1500)}…`;
  return { out: head, lines: text.trim() ? all.length : 0 };
}

/**
 * R1.20c (F4/F5): "You've hit your session limit · resets 1:50pm" and API errors are written as the agent's own
 * message (`isApiErrorMessage`, model "<synthetic>"); they draw as a card instead, a limit with its reset time. Shared
 * by the node (terminal agents' files) and siso-host (history, and the SDK's live `error`).
 */
export function apiError(rec: any, at: number) {
  const c = rec.message?.content;
  const text = (typeof c === "string" ? c : Array.isArray(c) ? c.filter((b: any) => b?.type === "text").map((b: any) => b.text).join("\n") : "").trim() || String(rec.error ?? "API error");
  const q = rec.quotaLimits ?? {};
  const limit = rec.error === "rate_limit" || /hit your .*limit/i.test(text);
  return {
    t: "error" as const,
    kind: (limit ? "limit" : "api") as "limit" | "api",
    text,
    at,
    ...(limit && typeof q.resetsAt === "number" ? { resetsAt: q.resetsAt * 1000 } : {}),
    ...(limit && typeof q.rateLimitType === "string" ? { window: q.rateLimitType } : {}),
    ...(typeof rec.apiErrorStatus === "number" ? { status: rec.apiErrorStatus } : {}),
  };
}

/**
 * R1.20c (H1): another agent's message, stored as a meta user line with `origin.kind: "peer"` (body in `origin.body`, else
 * inside the <cross-session-message> wrapper). The node's terminal chats and siso-host's history both dropped it.
 */
export function peerMessage(rec: any): { t: "user"; id: string; text: string; at: number; from: "peer"; name: string } | null {
  if (rec?.type !== "user" || rec.origin?.kind !== "peer") return null;
  const c = rec.message?.content;
  const raw = typeof c === "string" ? c : Array.isArray(c) ? c.filter((b: any) => b?.type === "text").map((b: any) => b.text).join("\n") : "";
  const body = typeof rec.origin.body === "string" ? rec.origin.body : raw.match(/<cross-session-message[^>]*>([\s\S]*?)<\/cross-session-message>/)?.[1];
  if (!body?.trim()) return null;
  return { t: "user", id: String(rec.uuid ?? ""), text: body.trim(), at: Date.parse(rec.timestamp ?? "") || 0, from: "peer", name: rec.origin.name ?? rec.origin.from ?? "another agent" };
}
