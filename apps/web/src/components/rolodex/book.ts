import { useCallback, useEffect, useRef, useState } from "react";

// Rolodex v3's page-side contract: the node's services/node/src/rolodex-book.ts answers /api/rolodex/book in these shapes.
export const LEVELS = ["client", "partner", "friend", "family", "network", "want"] as const;
export type Level = (typeof LEVELS)[number] | "off";
export type Talk = { messages: number; sent: number; lastIn?: number; lastOut?: number; last?: number };
export type Proposal = { level: Level; confidence: "high" | "medium" | "low"; reason: string };
export type InboxRow = { key: string; name: string; named: boolean; phone?: string; talk: Talk; proposal: Proposal };
export type Gap = "fullName" | "from" | "birthday" | "company" | "role" | "why" | "links";
export type Links = { linkedin?: string; x?: string; instagram?: string; site?: string };
export type WorkProject = { id: string; name: string; folder: string; kind: string; available: boolean; stage?: string };
export type Work = { projects: WorkProject[]; note: string; words?: { text: string; source?: string; when?: string }[]; wordsMore?: number; careful?: string; via?: string; relation: string };
export type Person = {
  id: string; name: string; level: Level; proposed?: boolean;
  fullName?: string; from?: string; lives?: string; birthday?: string; howMet?: string; company?: string; role?: string;
  why?: string; notes?: string; nextStep?: string; nextStepAt?: string; links?: Links;
  touches?: { at: string; note: string }[]; history?: { at: string; from: Level | "inbox" | null; to: Level }[];
  added: string; updated: string; keys: string[]; phone?: string; talk?: Talk; work?: Work; gaps: Gap[]; fromRegistry?: boolean;
};
export type BookView = { people: Person[]; inbox: InboxRow[]; offCount: number; whatsapp: { state: "live" | "off"; chats: number; named: number } };
export type Op =
  | { op: "place"; key: string; level: Level; fields?: Fields }
  | { op: "update"; id: string; fields: Fields }
  | { op: "dismiss" | "undismiss"; key: string }
  | { op: "touch"; id: string; note: string; at?: string }
  | { op: "want"; url: string; name?: string; why?: string }
  | { op: "unplace"; id: string };
export type Fields = Partial<Record<"name" | "fullName" | "from" | "lives" | "birthday" | "howMet" | "company" | "role" | "why" | "notes" | "nextStep" | "nextStepAt", string | null>> & { level?: Level; links?: Links; confirm?: boolean };

export const LEVEL_WORD: Record<Level, string> = { client: "Client", partner: "Partner", friend: "Friend", family: "Family", network: "Network", want: "Want to know", off: "Off the Rolodex" };
export const LEVEL_PLURAL: Record<Level, string> = { client: "Clients", partner: "Partners", friend: "Friends", family: "Family", network: "Network", want: "Want to know", off: "Off the Rolodex" };
export const LEVEL_LINE: Record<Level, string> = {
  client: "Pay us, or are about to", partner: "Build or sell with us", friend: "People you choose to see", family: "Blood, and close as blood",
  network: "Met them, know them, not close", want: "Not met yet: from LinkedIn, X and Instagram", off: "Not a person, or not someone to keep",
};
/** Days of silence after which a person reads Quiet. Family, network and want never do. */
export const QUIET_DAYS: Partial<Record<Level, number>> = { client: 30, partner: 14, friend: 60 };
export const GAP_ASK: Record<Gap, string> = {
  fullName: "What's their full name?", from: "Where are they from?", birthday: "When's their birthday?", company: "Which company are they with?",
  role: "What do they do there?", why: "Why do you want to know them?", links: "Paste their LinkedIn, X or Instagram link",
};
export const GAP_FIELD: Record<Exclude<Gap, "links">, keyof Fields> = { fullName: "fullName", from: "from", birthday: "birthday", company: "company", role: "role", why: "why" };

const DAY = 86_400_000;
export const initials = (name: string) => name.replace(/^[@+]/, "").split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase()).join("") || "?";
export function age(ms: number, now: number): string {
  const d = Math.floor((now - ms) / DAY);
  if (d < 1) return "today";
  if (d < 14) return `${d} d`;
  if (d < 60) return `${Math.floor(d / 7)} w`;
  if (d < 730) return `${Math.floor(d / 30)} mo`;
  return `${Math.floor(d / 365)} y`;
}
export const ago = (ms: number, now: number) => (age(ms, now) === "today" ? "today" : `${age(ms, now)} ago`);
export const lastMs = (t?: Talk) => (t?.last ? t.last * 1000 : undefined);
export function talkLine(t: Talk | undefined, now: number): string {
  if (!t || !t.messages) return t?.last ? `last WhatsApp ${ago(t.last * 1000, now)}` : "no WhatsApp messages yet";
  const ways = t.sent > 0 && t.messages - t.sent > 0 ? "both ways" : t.sent > 0 ? "only you writing" : "only them writing";
  return `${t.messages} ${t.messages === 1 ? "message" : "messages"} · ${ways}${t.last ? ` · last ${ago(t.last * 1000, now)}` : ""}`;
}

// --- Birthdays: "1994-03-03" or "03-03" (no year) -------------------------------------------------------------------
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const pad = (n: number) => String(n).padStart(2, "0");
export function parseBirthday(raw: string): string | null {
  const s = raw.toLowerCase().replace(/(\d)(st|nd|rd|th)\b/g, "$1").replace(/\bof\b/g, " ").replace(/[,]/g, " ").replace(/\s+/g, " ").trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) return valid(+m[2], +m[3]) ? `${m[1]}-${pad(+m[2])}-${pad(+m[3])}` : null;
  m = s.match(/^(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{2,4}))?$/);
  if (m) { const y = m[3] ? (m[3].length === 2 ? (+m[3] > 30 ? 1900 : 2000) + +m[3] : +m[3]) : undefined; return valid(+m[2], +m[1]) ? (y ? `${y}-` : "") + `${pad(+m[2])}-${pad(+m[1])}` : null; }
  const mon = (w: string) => MONTHS.findIndex((x) => w.startsWith(x)) + 1;
  m = s.match(/^(\d{1,2}) ([a-z]+)(?: (\d{4}))?$/) ?? null;
  if (m && mon(m[2])) return valid(mon(m[2]), +m[1]) ? (m[3] ? `${m[3]}-` : "") + `${pad(mon(m[2]))}-${pad(+m[1])}` : null;
  m = s.match(/^([a-z]+) (\d{1,2})(?: (\d{4}))?$/);
  if (m && mon(m[1])) return valid(mon(m[1]), +m[2]) ? (m[3] ? `${m[3]}-` : "") + `${pad(mon(m[1]))}-${pad(+m[2])}` : null;
  return null;
}
const valid = (month: number, day: number) => month >= 1 && month <= 12 && day >= 1 && day <= 31;
export function birthdayText(b: string | undefined, now: number): string {
  if (!b) return "";
  const parts = b.split("-").map(Number);
  const [y, mo, d] = parts.length === 3 ? parts : [undefined, parts[0], parts[1]];
  const label = `${d} ${MONTHS[mo - 1]?.[0].toUpperCase()}${MONTHS[mo - 1]?.slice(1)}`;
  if (!y) return label;
  const t = new Date(now);
  const years = t.getFullYear() - y - (t.getMonth() + 1 < mo || (t.getMonth() + 1 === mo && t.getDate() < d) ? 1 : 0);
  return `${label} ${y} (${years})`;
}
/** Days until the next birthday (0 = today), or undefined. */
export function daysToBirthday(b: string | undefined, now: number): number | undefined {
  if (!b) return undefined;
  const parts = b.split("-").map(Number);
  const [mo, d] = parts.length === 3 ? [parts[1], parts[2]] : parts;
  const t = new Date(now); const today = new Date(t.getFullYear(), t.getMonth(), t.getDate());
  let next = new Date(t.getFullYear(), mo - 1, d);
  if (next < today) next = new Date(t.getFullYear() + 1, mo - 1, d);
  return Math.round((next.getTime() - today.getTime()) / DAY);
}

// --- The voice line: one dictated sentence places and fills a card ---------------------------------------------------
export type Parsed = { level?: Level; skip?: boolean; fields: Fields };
const LEVEL_WORDS: [RegExp, Level][] = [
  [/\b(want(ed)? to (know|meet)|want|wanna know|prospect)\b/, "want"], [/\b(clients?|customers?)\b/, "client"], [/\b(partners?|collab(orator)?s?)\b/, "partner"],
  [/\b(family|relatives?|cousin|mum|mom|dad|brother|sister|uncle|aunty|auntie)\b/, "family"], [/\b(friends?|mates?|homie|bestie)\b/, "friend"],
  [/\b(network|contacts?|acquaintances?|know them)\b/, "network"], [/\b(off( the rolodex)?|not a person|ignore|business|spam|bot|nobody)\b/, "off"],
];
/** "friend, Ahmed Khan, from Manchester, birthday 3 March" → level friend, fullName, from, birthday. `ask` reads a bare answer as that field. */
export function parseLine(line: string, ask?: Gap): Parsed {
  const fields: Fields = {};
  let rest = line.trim();
  if (!rest) return { fields };
  if (/^(skip|next|pass|later)\.?$/i.test(rest)) return { skip: true, fields };
  const take = (re: RegExp, key: keyof Fields, map: (v: string) => string | null = (v) => v) => {
    const m = rest.match(re);
    if (!m) return;
    const v = map(m[2].trim().replace(/[.,;]+$/, ""));
    if (v) { (fields as Record<string, string>)[key] = v; rest = (rest.slice(0, m.index) + " " + rest.slice(m.index! + m[0].length)).trim(); }
  };
  const stop = String.raw`(?=,|;|\.(?:\s|$)|\s+(?:and\s+)?(?:from|lives?|living|based|born|birthday|bday|works?|met|at|role|is a|who)\b|$)`;
  take(new RegExp(String.raw`\b(birthday(?: is)?|bday|born(?: on)?)\s+(.+?)` + stop, "i"), "birthday", (v) => parseBirthday(v));
  take(new RegExp(String.raw`\b(lives? in|living in|based in)\s+(.+?)` + stop, "i"), "lives");
  take(new RegExp(String.raw`\b(from|grew up in)\s+(.+?)` + stop, "i"), "from");
  take(new RegExp(String.raw`\b(works? at|works? for|at|with)\s+([A-Z][\w&.' -]+?)` + stop, ""), "company");
  take(new RegExp(String.raw`\b(met (?:at|through|via|in)|we met)\s+(.+?)` + stop, "i"), "howMet");
  take(new RegExp(String.raw`\b(is an?|role|job)\s+(.+?)` + stop, "i"), "role");
  let level: Level | undefined;
  const words = rest.toLowerCase();
  for (const [re, l] of LEVEL_WORDS) { const m = words.match(re); if (m) { level = l; rest = (rest.slice(0, m.index) + rest.slice(m.index! + m[0].length)).trim(); break; } }
  const left = rest.replace(/^[\s,;.:-]+|[\s,;.:-]+$/g, "").replace(/\s*,\s*/g, ", ").replace(/^(and|is|a|my|the)\s+/i, "").trim();
  if (left) {
    if (ask && ask !== "links" && ask !== "fullName" && !(GAP_FIELD[ask] in fields)) (fields as Record<string, string>)[GAP_FIELD[ask]] = ask === "birthday" ? parseBirthday(left) ?? left : left;
    else if (/^[\p{L}'’.-]+(\s+[\p{L}'’.-]+){1,4}$/u.test(left) && !fields.fullName) fields.fullName = left.replace(/\b\p{Ll}/gu, (c) => c.toUpperCase());
    else if (ask === "fullName" && !fields.fullName) fields.fullName = left;
    else fields.notes = left;
  }
  return { level, fields };
}

/** Quiet: silent past the level's threshold. Family, network and want never go quiet. */
export const isQuiet = (p: Person, now: number) => {
  const t = QUIET_DAYS[p.level];
  const last = lastContact(p)?.at;
  return t !== undefined && last !== undefined && now - last > t * DAY;
};
/** The most recent contact we know of: a WhatsApp message or a logged touch, whichever is newer. */
export function lastContact(p: Person): { at: number; how: string } | undefined {
  const wa = lastMs(p.talk);
  const touch = (p.touches ?? []).reduce<{ at: number; note: string } | undefined>((best, t) => { const at = Date.parse(t.at); return Number.isFinite(at) && (!best || at > best.at) ? { at, note: t.note } : best; }, undefined);
  if (touch && (!wa || touch.at > wa)) return { at: touch.at, how: touch.note };
  return wa ? { at: wa, how: "WhatsApp" } : undefined;
}

// --- Search: one lower-cased line per person, built once per book, ranked name-first ----------------------------------
export type SearchEntry = { name: string; words: string[]; rest: string };
export function searchIndex(people: Person[]): Map<string, SearchEntry> {
  const m = new Map<string, SearchEntry>();
  for (const p of people) {
    const name = [p.name, p.fullName].filter(Boolean).join(" ").toLowerCase();
    m.set(p.id, { name, words: name.split(/[\s@+.'’-]+/).filter(Boolean),
      rest: [p.from, p.lives, p.company, p.role, p.notes, p.why, p.howMet, p.nextStep, p.work?.note, ...(p.work?.projects ?? []).map((x) => x.name)].filter(Boolean).join(" ").toLowerCase() });
  }
  return m;
}
/** 0 the name starts with it, 1 a word in the name does, 2 the name has it, 3 another field has it; -1 no match. */
export function rank(e: SearchEntry | undefined, q: string): number {
  if (!e) return -1;
  if (e.name.startsWith(q)) return 0;
  if (e.words.some((w) => w.startsWith(q))) return 1;
  if (e.name.includes(q)) return 2;
  return e.rest.includes(q) ? 3 : -1;
}

/** One change with no reload: the sort deck sends several in a row and reloads once when they have all landed. */
export async function postOp(op: Op): Promise<{ id?: string }> {
  const r = await fetch("/api/rolodex/book", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(op) });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(body.error ?? `Not saved (HTTP ${r.status})`);
  return body;
}

// --- Data hook ---------------------------------------------------------------------------------------------------------
export function useRolodexBook(enabled: boolean) {
  const [state, setState] = useState<{ data?: BookView; loading: boolean; error?: string }>({ loading: false });
  const seq = useRef(0);
  const reload = useCallback(async () => {
    const n = ++seq.current;
    setState((s) => ({ ...s, loading: !s.data, error: undefined }));
    try {
      const r = await fetch("/api/rolodex/book", { cache: "no-store" });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(body.error ?? `The node could not read the Rolodex (HTTP ${r.status})`);
      if (n === seq.current) setState({ data: body as BookView, loading: false });
    } catch (e) {
      if (n === seq.current) setState((s) => ({ ...s, loading: false, error: e instanceof TypeError ? "No answer from the node. Try again in a moment." : (e as Error).message }));
    }
  }, []);
  useEffect(() => { if (enabled) void reload(); }, [enabled, reload]);
  /** Sends one change; the page updates from the node's answer. Throws the node's words on failure. */
  const act = useCallback(async (op: Op): Promise<{ id?: string }> => {
    const body = await postOp(op);
    await reload();
    return body;
  }, [reload]);
  /** Local optimism for the sort deck: drop a chat from the inbox before the node answers. */
  const hide = useCallback((key: string) => setState((s) => (s.data ? { ...s, data: { ...s.data, inbox: s.data.inbox.filter((r) => r.key !== key) } } : s)), []);
  return { ...state, reload, act, hide };
}
