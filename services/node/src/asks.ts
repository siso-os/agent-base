import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

/**
 * Your asks (Shaan, 2 Oct: "I request information ... and then it goes in the chat and it gets lost. It's annoying").
 * ASKS.json is a JSON array his intent tooling writes, one entry per thing he asked for:
 *   { id, ask, count, domain, files, first, last, quotes }
 * It carries no status yet; ASKS-STATUS.json beside it ({ [id]: { status, answer, link, owner } }) says what came of
 * each. Either file may be missing, half written or carry fields this does not know: every field is optional here.
 */
export const asksFile = () => process.env.AB_ASKS_FILE || join(homedir(), "SISO_Workspace/SISO_Agency/apps/siso-internal-labs/siso-internal-labs-agents/intent/ASKS.json");

export type AskStatus = "open" | "answered" | "done";
export type Ask = {
  id: string;
  /** His words: the ask itself. */
  words: string;
  /** His verbatim lines, as he said them. */
  quotes: string[];
  /** How many times he asked. */
  count: number;
  /** The project it belongs to. */
  domain: string | null;
  files: string[];
  first: string | null;
  last: string | null;
  status: AskStatus;
  answer?: string;
  link?: string;
  owner?: string;
};
export type Asks = { file: string; asks: Ask[]; open: number; error?: string };

const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);
const strs = (v: unknown) => (Array.isArray(v) ? v.map(str).filter((x): x is string => !!x) : typeof v === "string" && v.trim() ? [v.trim()] : []);
const STATUS = new Set<AskStatus>(["open", "answered", "done"]);

async function readJson(file: string): Promise<{ value?: unknown; error?: string }> {
  let raw: string;
  try {
    raw = await readFile(file, "utf8");
  } catch {
    return {};
  }
  try {
    return { value: JSON.parse(raw) };
  } catch (e) {
    return { error: `${file}: ${(e as Error).message}` };
  }
}

/** One entry of ASKS.json, merged with its ASKS-STATUS.json record; null when it has no words to show. */
export function toAsk(row: unknown, extra: unknown, index: number): Ask | null {
  if (!row || typeof row !== "object") return null;
  const r = row as Record<string, unknown>;
  const s = (extra && typeof extra === "object" ? extra : {}) as Record<string, unknown>;
  const quotes = strs(r.quotes);
  const words = str(r.ask) ?? str(r.words) ?? quotes[0];
  if (!words) return null;
  const first = str(r.first) ?? str(r.when) ?? null;
  const last = str(r.last) ?? first;
  const count = Number(r.count);
  const status = str(s.status) ?? str(r.status);
  const answer = str(s.answer) ?? str(r.answer);
  const link = str(s.link) ?? str(r.link);
  const owner = str(s.owner) ?? str(r.owner);
  return {
    id: str(r.id) ?? (typeof r.id === "number" ? String(r.id) : `ask-${index + 1}`),
    words,
    quotes,
    count: Number.isFinite(count) && count >= 1 ? Math.floor(count) : 1,
    domain: str(r.domain) ?? str(r.project) ?? null,
    files: strs(r.files),
    first,
    last: last ?? null,
    // An answer with no word on it means it was answered; nothing at all means it is still open.
    status: status && STATUS.has(status as AskStatus) ? (status as AskStatus) : answer ? "answered" : "open",
    ...(answer ? { answer } : {}),
    ...(link ? { link } : {}),
    ...(owner ? { owner } : {}),
  };
}

/** Newest first (by when he last asked). */
export async function readAsks(file = asksFile()): Promise<Asks> {
  const [asks, status] = await Promise.all([readJson(file), readJson(join(dirname(file), "ASKS-STATUS.json"))]);
  const list = Array.isArray(asks.value) ? asks.value : Array.isArray((asks.value as { asks?: unknown })?.asks) ? (asks.value as { asks: unknown[] }).asks : [];
  const byId = (status.value && typeof status.value === "object" && !Array.isArray(status.value) ? status.value : {}) as Record<string, unknown>;
  const rows = list
    .map((row, i) => toAsk(row, byId[String((row as { id?: unknown })?.id ?? "")], i))
    .filter((x): x is Ask => !!x)
    .sort((a, b) => (b.last ?? "").localeCompare(a.last ?? ""));
  const error = asks.error ?? status.error;
  return { file, asks: rows, open: rows.filter((a) => a.status === "open").length, ...(error ? { error } : {}) };
}
