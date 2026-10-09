import { createReadStream } from "node:fs";
import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import { createHash } from "node:crypto";
import { createInterface } from "node:readline";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { readReviewCaptures, reviewCaptureFile, type CapturedReview } from "./review-capture.ts";

/** Console posts and answers are durable in its journal. GET /events is its public replay contract. */
export const consoleUrl = (): string | null => {
  const set = process.env.AB_CONSOLE_URL;
  if (set) return set.replace(/\/+$/, "");
  return Number(process.env.AB_PUBLIC_PORT ?? process.env.AB_PORT ?? 5401) === 5401 ? "http://127.0.0.1:8891" : null;
};
export const openedFile = () => process.env.AB_REVIEWS_OPENED || join(homedir(), ".local/state/agent-base/reviews-opened.json");
export type ReviewEvent = { kind: "posted" | "opened" | "approved" | "feedback" | "resolved"; at: string | null; text?: string };
export type Review = {
  id: string; title: string; url: string; by: string | null; at: string | null;
  opened: boolean; openedAt?: string; verdict: "approved" | "feedback" | "none"; feedback: string | null;
  history: ReviewEvent[];
  provenance?: CapturedReview["provenance"];
};
export type Reviews = { source: string; reviews: Review[]; unopened: number; availability: "available" | "unavailable" | "disabled"; coverage: "console-journal" | "console-replay" | "console-cards" | "chat-deliveries" | "console-and-chat" | "none"; error?: string };
const str = (v: unknown) => typeof v === "string" && v.trim() ? v.trim() : undefined;
const isUrl = (v: unknown): v is string => {
  if (typeof v !== "string") return false;
  try { const u = new URL(v); return ["http:", "https:"].includes(u.protocol) && !u.username && !u.password; } catch { return false; }
};
const when = (v: unknown): string | undefined => {
  const t = typeof v === "number" ? (v < 1e12 ? v * 1000 : v) : typeof v === "string" ? Date.parse(v) : NaN;
  return Number.isFinite(t) && Math.abs(t) <= 8.64e15 ? new Date(t).toISOString() : undefined;
};
// An explicit affirmative response only. "Unapproved", "approve if…" and agent resolve events are not approval.
const APPROVE = /^(?:approved?|lgtm|ship it|looks good)(?:[.!]|,?\s+ship it[.!]?)?$/i;
function answersOf(c: Record<string, unknown>): { text: string; at: string | null }[] {
  for (const k of ["answers", "replies", "comments", "feedback"]) {
    if (!Array.isArray(c[k])) continue;
    return (c[k] as unknown[]).flatMap(a => {
      const obj = a && typeof a === "object" ? a as Record<string, unknown> : {};
      const text = str(a) ?? str(obj.text) ?? str(obj.body);
      return text ? [{ text, at: when(obj.ts) ?? when(obj.at) ?? null }] : [];
    });
  }
  const text = str(c.feedback) ?? str(c.answer) ?? str(c.reply);
  return text ? [{ text, at: when(c.answeredAt) ?? null }] : [];
}
export function toReview(card: unknown, base: string, opened: Record<string, string>): Review | null {
  if (!card || typeof card !== "object") return null;
  const c = card as Record<string, unknown>;
  const id = str(c.id) ?? str(c.card) ?? str(c.slug) ?? (typeof c.id === "number" ? String(c.id) : undefined);
  if (!id) return null;
  const answers = answersOf(c), feedback = answers.at(-1)?.text ?? null;
  const approved = c.approved === true || /^(approved|accepted)$/i.test(str(c.status) ?? str(c.state) ?? str(c.verdict) ?? "") || (!!feedback && APPROVE.test(feedback));
  const at = when(c.ts) ?? when(c.at) ?? when(c.created) ?? when(c.created_at) ?? when(c.posted) ?? when(c.time) ?? null;
  const openedAt = when(opened[id]) ?? when(c.openedAt);
  const history: ReviewEvent[] = [{ kind: "posted", at }, ...answers.map(a => ({ kind: APPROVE.test(a.text) ? "approved" as const : "feedback" as const, ...a }))];
  if (approved && !history.some(e => e.kind === "approved")) history.push({ kind: "approved", at: when(c.approvedAt) ?? null });
  if (c.resolved === true) history.push({ kind: "resolved", at: when(c.resolvedAt) ?? null });
  if (openedAt || c.opened === true) history.push({ kind: "opened", at: openedAt ?? null });
  return { id, title: str(c.title) ?? str(c.name) ?? id, url: isUrl(c.url) ? c.url : `${base}/card/${encodeURIComponent(id)}/html`,
    by: str(c.agent) ?? str(c.by) ?? str(c.from) ?? str(c.author) ?? str(c.posted_by) ?? null,
    at, opened: !!openedAt || c.opened === true, ...(openedAt ? { openedAt } : {}), verdict: approved ? "approved" : feedback ? "feedback" : "none", feedback, history: history.sort((a, b) => a.at && b.at ? a.at.localeCompare(b.at) : 0) };
}

/** Fold all posts, keeping older URLs when a card is repurposed. Replies apply to the then-current post. */
export function consoleProjection() {
  const cards = new Map<string, Record<string, unknown>>(), current = new Map<string, string[]>(), identities = new Map<string, string>();
  let baseForProjection = "";
  return {
    accept(event: unknown) {
      if (!event || typeof event !== "object") return;
      const e = event as Record<string, unknown>, id = str(e.id);
      if (e.type === "post" && id) {
        // Plain-text/Markdown URLs sent in notes count too. HTML assets and navigation are not review requests.
        const bodyUrls = e.kind !== "html" && typeof e.body === "string" ? [...e.body.matchAll(/https?:\/\/[^\s)>\]"'`<]+/g)].map(m => m[0].replace(/[.,;:]+$/, "")).filter(isUrl) : [];
        const urls = [...new Set([...(isUrl(e.url) ? [e.url] : []), ...bodyUrls])];
        if (!urls.length && e.kind === "html") urls.push(`${baseForProjection}/card/${encodeURIComponent(id)}/html`);
        const keys: string[] = [];
        for (const [index, url] of urls.entries()) {
          const identity = `${id}\0${url}`;
          const key = identities.get(identity) ?? (cards.has(id) ? `${id}~${createHash("sha256").update(url).digest("hex").slice(0, 12)}` : id);
          identities.set(identity, key);
          const previous = cards.get(key);
          // Revisiting a previously posted URL retains its history, even after this card linked elsewhere.
          cards.set(key, { ...previous, ...e, title: urls.length > 1 ? `${str(e.title) ?? id} · link ${index + 1}` : e.title, ts: previous?.ts ?? e.ts, body: undefined, id: key, url, answers: previous?.answers ?? [] });
          keys.push(key);
        }
        current.set(id, keys);
      } else if (e.type === "answer" || e.type === "resolve") {
        for (const key of current.get(str(e.card) ?? "") ?? []) {
          const c = cards.get(key);
          if (!c) continue;
          if (e.type === "answer" && str(e.text)) (c.answers as unknown[]).push({ text: e.text, ts: e.ts });
          else if (e.type === "resolve") { c.resolved = true; c.resolvedAt = e.ts; }
        }
      }
    },
    cards: () => [...cards.values()],
    setBase(base: string) { baseForProjection = base; },
  };
}

async function readOpened(file: string): Promise<Record<string, string>> {
  try { const v = JSON.parse(await readFile(file, "utf8")); return v && typeof v === "object" && !Array.isArray(v) ? v : {}; } catch { return {}; }
}
let writing = Promise.resolve();
export async function markOpened(id: string, file = openedFile()): Promise<void> {
  const run = writing.then(async () => {
    const opened = await readOpened(file);
    if (Object.hasOwn(opened, id)) return;
    Object.defineProperty(opened, id, { value: new Date().toISOString(), enumerable: true, writable: true, configurable: true });
    await mkdir(dirname(file), { recursive: true });
    const temporary = `${file}.${process.pid}.tmp`;
    await writeFile(temporary, `${JSON.stringify(opened, null, 2)}\n`, { mode: 0o600 });
    await rename(temporary, file);
    cache = null;
  });
  writing = run.catch(() => {});
  return run;
}

function localJournal(base: string): string | null {
  if (process.env.AB_CONSOLE_EVENTS) return process.env.AB_CONSOLE_EVENTS;
  // Custom/test sources never fall back to private local data.
  return !process.env.AB_CONSOLE_URL && base === "http://127.0.0.1:8891" && Number(process.env.AB_PUBLIC_PORT ?? process.env.AB_PORT ?? 5401) === 5401
    ? join(process.env.CONSOLE_HOME || join(homedir(), ".claude/console"), "state/events.jsonl") : null;
}
async function journalCards(file: string, base: string) {
  const projection = consoleProjection(); projection.setBase(base);
  const input = createReadStream(file, { encoding: "utf8" });
  const lines = createInterface({ input, crlfDelay: Infinity });
  try { for await (const line of lines) { if (line.trim()) { let e; try { e = JSON.parse(line); } catch { throw new Error("Console journal contains an unreadable event"); } projection.accept(e); } } }
  finally { lines.close(); input.destroy(); }
  return projection.cards();
}
async function replayCards(base: string): Promise<unknown[]> {
  const r = await fetch(`${base}/events`, { headers: { accept: "text/event-stream" }, signal: AbortSignal.timeout(4000) });
  if (!r.ok || !r.body || !r.headers.get("content-type")?.includes("text/event-stream")) { await r.body?.cancel(); throw new Error("Console replay unavailable"); }
  const reader = r.body.getReader(), decoder = new TextDecoder(), projection = consoleProjection(); projection.setBase(base);
  let buffer = "", bytes = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) throw new Error("Console replay ended before ready");
      bytes += value.byteLength;
      if (bytes > 32 * 1024 * 1024) throw new Error("Console replay exceeded limit");
      buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n");
      let end;
      while ((end = buffer.indexOf("\n\n")) >= 0) {
        const block = buffer.slice(0, end); buffer = buffer.slice(end + 2);
        const data = block.split("\n").filter(l => l.startsWith("data:")).map(l => l.slice(5).trimStart()).join("\n");
        if (!data) continue;
        const e = JSON.parse(data);
        if (e.type === "ready") return projection.cards();
        projection.accept(e);
      }
    }
  } finally { await reader.cancel().catch(() => {}); }
}
async function readConsoleReviews(base: string | null, file: string): Promise<Reviews> {
  if (!base) return { source: "", reviews: [], unopened: 0, availability: "disabled", coverage: "none" };
  const opened = await readOpened(file);
  let cards: unknown[] | null = null, coverage: Reviews["coverage"] = "none";
  const journal = localJournal(base);
  if (journal) {
    try { cards = await journalCards(journal, base); coverage = "console-journal"; } catch { /* Try the public replay, labelled partial. */ }
  }
  if (!cards) { try { cards = await replayCards(base); coverage = "console-replay"; } catch { /* Older consoles exposed lists. */ } }
  if (!cards) for (const p of ["/cards", "/api/cards"]) {
    try {
      const r = await fetch(`${base}${p}`, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(3000) });
      if (!r.ok) { await r.body?.cancel(); continue; }
      const v = await r.json();
      const list = Array.isArray(v) ? v : Array.isArray(v?.cards) ? v.cards : null;
      if (list) { cards = list; coverage = "console-cards"; break; }
    } catch { /* Return unavailable, not an empty-success result. */ }
  }
  const reviews = (cards ?? []).map(c => toReview(c, base, opened)).filter((r): r is Review => !!r)
    .sort((a, b) => Number(a.opened) - Number(b.opened) || (b.at ?? "").localeCompare(a.at ?? ""));
  return { source: base, reviews, unopened: reviews.filter(r => !r.opened).length, availability: cards ? "available" : "unavailable", coverage,
    ...(!cards ? { error: "Reviews unavailable: console history could not be read." } : {}) };
}
/** The private delivery store augments console history; capture never invents opens or verdicts. */
export async function readReviews(base: string | null = consoleUrl(), file = openedFile(), deliveredFile = reviewCaptureFile(file)): Promise<Reviews> {
  const [consoleHistory, captures, opened] = await Promise.all([
    readConsoleReviews(base, file),
    readReviewCaptures(deliveredFile).then(reviews => ({reviews,error:false})).catch(()=>({reviews:[] as CapturedReview[],error:true})),
    readOpened(file),
  ]);
  if (!captures.reviews.length && !captures.error) return consoleHistory;
  const delivered = captures.reviews.map(c=>({...toReview(c,base ?? "",opened)!,provenance:c.provenance}));
  const reviews = [...consoleHistory.reviews,...delivered].sort((a,b)=>Number(a.opened)-Number(b.opened)||(b.at??"").localeCompare(a.at??""));
  const error = captures.error ? "Captured chat review history is unavailable." : consoleHistory.error;
  return {...consoleHistory, reviews, unopened:reviews.filter(r=>!r.opened).length,
    availability: error ? "unavailable" : "available",
    coverage: delivered.length ? consoleHistory.coverage === "none" ? "chat-deliveries" : "console-and-chat" : consoleHistory.coverage,
    ...(error ? {error} : {}),
  };
}
let cache: { at: number; value: Reviews } | null = null;
let reading: Promise<Reviews> | null = null;
let generation = 0;
export function invalidateReviewsCache() { cache = null; reading = null; generation++; }
export function readReviewsCached(): Promise<Reviews> {
  if (cache && Date.now() - cache.at < 15_000) return Promise.resolve(cache.value);
  if (!reading) {
    const started = generation;
    const pending = readReviews().then(value => {
      if (started !== generation) return value;
      if (value.error && cache?.value.reviews.length) value = { ...value, reviews: cache.value.reviews, unopened: cache.value.unopened };
      cache = { at: Date.now(), value }; return value;
    }).finally(() => { if (reading === pending) reading = null; });
    reading = pending;
  }
  return cache ? Promise.resolve(cache.value) : reading;
}
