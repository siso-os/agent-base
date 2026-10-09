import { readFile, mkdir, writeFile, rename } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export type NotificationId = string | number;
export type NotificationState = { read: boolean; react: string | null };
export type Notification = NotificationState & {
  id: NotificationId; at: string; title: string; body: string; needs?: string; url?: string; project?: string;
};
export type NotificationDelivery = {
  text: string;
  target: { kind: "agent"; agent: string } | {
    kind: "console"; url: string; body: { agent: "A0"; card: "a0-board"; text: string };
  };
};

// Integrators pass the stable terminal ID for ordinary agents, and "A0" for Agent Zero.
const isZero = (agent: string) => /^(A0|Agent Zero|agent-zero)$/i.test(agent);
const canonical = (agent: string) => isZero(agent) ? "A0" : agent;
const statePath = process.env.AB_NOTIFICATIONS_STATE ?? join(homedir(), ".local/state/agent-base/notifications-state.json");
const key = (agent: string, id: NotificationId) => JSON.stringify([canonical(agent), String(id)]);
const validId = (id: unknown): id is NotificationId =>
  (typeof id === "string" && id.trim().length > 0 && !/[\r\n]/.test(id)) ||
  (typeof id === "number" && Number.isFinite(id));
function validate(agent: string, id: NotificationId) {
  if (typeof agent !== "string" || !agent.trim() || !validId(id)) throw new TypeError("Invalid agent or notification ID");
}

async function loadState(): Promise<Record<string, Partial<NotificationState>>> {
  let raw: string;
  try { raw = await readFile(statePath, "utf8"); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return {}; throw error; }
  // Do not silently overwrite a corrupt state file and lose other agents' read/react state.
  const value = JSON.parse(raw);
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid notifications state");
  return value;
}

let automatic: (agent: string) => Notification[] = () => [];
export function setAutomaticNotifications(read: typeof automatic) { automatic = read; }
export async function list(agent: string, repo: string): Promise<Notification[]> {
  validate(agent, "list");
  const source = join(repo, ".agents/notifications.jsonl");
  const [raw, state] = await Promise.all([
    readFile(source, "utf8").catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return "";
      throw error;
    }), loadState(),
  ]);
  const rows = new Map<string, Notification>();
  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const row = JSON.parse(line);
      if (!row || !validId(row.id) || typeof row.at !== "string" || !Number.isFinite(Date.parse(row.at)) ||
          typeof row.title !== "string" || typeof row.body !== "string") continue;
      const saved = state[key(agent, row.id)];
      rows.set(String(row.id), {
        id: row.id, at: row.at, title: row.title, body: row.body,
        ...(typeof row.needs === "string" ? { needs: row.needs } : {}),
        ...(typeof row.url === "string" ? { url: row.url } : {}),
        ...(typeof row.project === "string" ? { project: row.project } : {}),
        read: typeof saved?.read === "boolean" ? saved.read : row.status === "seen",
        react: typeof saved?.react === "string" ? saved.react : null,
      });
    } catch { /* Skip malformed or partially written source lines. */ }
  }
  for (const row of automatic(agent)) { const saved = state[key(agent, row.id)]; rows.set(String(row.id), {...row, read: saved?.read ?? row.read, react: saved?.react ?? row.react}); }
  return [...rows.values()].sort((a, b) => Date.parse(b.at) - Date.parse(a.at) || String(b.id).localeCompare(String(a.id)));
}

// One writer queue prevents simultaneous marks from dropping another agent's state.
let writes: Promise<unknown> = Promise.resolve();
export function mark(agent: string, id: NotificationId, patch: { read?: boolean; react?: string | null }): Promise<void> {
  validate(agent, id);
  if (!patch || (patch.read !== undefined && typeof patch.read !== "boolean") ||
      (patch.react !== undefined && patch.react !== null && typeof patch.react !== "string")) {
    throw new TypeError("Invalid notification state patch");
  }
  const update = writes.then(async () => {
    const state = await loadState();
    const k = key(agent, id);
    state[k] = {
      ...state[k],
      ...(patch.read === undefined ? {} : { read: patch.read }),
      ...(patch.react === undefined ? {} : { react: patch.react }),
    };
    await mkdir(dirname(statePath), { recursive: true });
    const temp = `${statePath}.${process.pid}.tmp`;
    await writeFile(temp, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
    await rename(temp, statePath);
  });
  writes = update.catch(() => undefined);
  return update;
}

// Pure preparation only: delivery MUST use the existing app send path (or A0's /answer).
export function replyText(agent: string, id: NotificationId, text: string): NotificationDelivery {
  validate(agent, id);
  if (typeof text !== "string" || !text.trim()) throw new TypeError("A reply cannot be empty");
  const message = `re: notification ${id}: ${text}`;
  return {
    text: message,
    target: isZero(agent)
      ? { kind: "console", url: process.env.AB_CONSOLE_ANSWER_URL ?? "http://127.0.0.1:8891/answer", body: { agent: "A0", card: "a0-board", text: message } }
      : { kind: "agent", agent },
  };
}

/** a0-016: his three reactions, as they read in the message the agent gets. Any other react (an old "love") says itself. */
export const REACTS: Record<string, string> = { like: "👍 yes", no: "✗ no", hmm: "🤔 not sure" };
/**
 * a0-016: a reaction goes back to the agent like a reply ("re: notification 7: 👍 yes"), with the ping's title so the
 * agent knows which one without looking it up. Clearing a reaction says nothing.
 */
export function reactText(agent: string, id: NotificationId, react: string, title?: string): NotificationDelivery {
  validate(agent, id);
  return replyText(agent, id, `${REACTS[react] ?? react}${title ? ` (on "${title.slice(0, 80)}")` : ""}`);
}

