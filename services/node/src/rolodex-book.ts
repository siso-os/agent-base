import { createHash, randomUUID } from "node:crypto";
import { copyFileSync, existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { atomicPrivate } from "./whatsapp-private.ts";
import { list as registryList, norm, type RolodexPerson } from "./rolodex.ts";
import type { WhatsAppPerson } from "./whatsapp.ts";

// The Rolodex book (Rolodex v3, ROLODEX 7 Oct; design in _data/rolodex/DESIGN.md): everyone he talks to, placed on six
// levels. His own facts about people (level, full name, where from, birthday, notes, next step) live in a private local
// file, never in git (CLIENTS.json is in git and stays read-only here). WhatsApp gives names, numbers, counts and times
// live from the gateway; message bodies are never read. Nothing here logs a name, a number or a note.

export const LEVELS = ["client", "partner", "friend", "family", "network", "want"] as const;
export type Level = (typeof LEVELS)[number] | "off";
export type Links = { linkedin?: string; x?: string; instagram?: string; site?: string };
export type Touch = { at: string; note: string };
export type Move = { at: string; from: Level | "inbox" | null; to: Level };
export type Card = {
  id: string; name: string; level: Level; proposed?: boolean;
  fullName?: string; from?: string; lives?: string; birthday?: string; howMet?: string; company?: string; role?: string;
  why?: string; notes?: string; nextStep?: string; nextStepAt?: string; links?: Links;
  /** WhatsApp chat ids (private; the page sees hashed keys). */
  chats?: string[];
  /** The CLIENTS.json name this card stands for, when it is a work person. */
  registry?: string;
  touches?: Touch[]; history?: Move[]; added: string; updated: string;
};
export type Book = { version: 1; people: Card[]; dismissed: string[] };

export type Proposal = { level: Level; confidence: "high" | "medium" | "low"; reason: string };
export type Talk = { messages: number; sent: number; lastIn?: number; lastOut?: number; last?: number };
export type InboxRow = { key: string; name: string; named: boolean; phone?: string; talk: Talk; proposal: Proposal };
export type WorkFacts = Pick<RolodexPerson, "projects" | "note" | "words" | "wordsMore" | "careful" | "via" | "relation">;
export type BookPerson = Omit<Card, "chats" | "registry"> & {
  keys: string[]; phone?: string; talk?: Talk; work?: WorkFacts; gaps: Gap[]; fromRegistry?: boolean;
};
export type Gap = "fullName" | "from" | "birthday" | "company" | "role" | "why" | "links";
export type BookView = {
  people: BookPerson[]; inbox: InboxRow[]; offCount: number;
  whatsapp: { state: "live" | "off"; chats: number; named: number };
};
export type Options = { file?: string; home?: string; now?: number };

const DAY = 86_400_000;
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const str = (v: unknown, max = 400) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : undefined);
export const keyOf = (jid: string) => "wa:" + createHash("sha1").update(jid).digest("hex").slice(0, 12);
const digits = (s?: string) => (s ?? "").replace(/\D/g, "");
const numberLike = (s: string) => /^[\d\s+()-]+$/.test(s) && /\d/.test(s);

export const bookFile = (o: Options = {}) =>
  o.file ?? process.env.AB_ROLODEX_BOOK ?? path.join(homedir(), ".local", "state", "agent-base", "rolodex", "book.json");

export function readBook(o: Options = {}): Book {
  const file = bookFile(o);
  let raw: unknown;
  try { raw = JSON.parse(readFileSync(file, "utf8")); }
  catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return { version: 1, people: [], dismissed: [] };
    throw new Error("The Rolodex book cannot be read");
  }
  if (!record(raw) || !Array.isArray(raw.people)) throw new Error("The Rolodex book is not in a shape this app can read");
  return { version: 1, people: raw.people.filter((p): p is Card => record(p) && typeof p.id === "string" && typeof p.name === "string"),
    dismissed: Array.isArray(raw.dismissed) ? raw.dismissed.filter((d): d is string => typeof d === "string") : [] };
}

/** Atomic, 0600, and a copy per day beside it (archive, never lose his notes). */
export function writeBook(book: Book, o: Options = {}) {
  const file = bookFile(o);
  const day = new Date(o.now ?? Date.now()).toISOString().slice(0, 10);
  const daily = file.replace(/\.json$/, `.${day}.json`);
  if (existsSync(file) && !existsSync(daily)) { try { copyFileSync(file, daily); } catch { /* the write still happens */ } }
  atomicPrivate(file, book);
}

// --- Proposals: from the chat's name and its counts only ---------------------------------------------------------------
const FAMILY = /\b(mum|mom|mummy|mama|mam|ammi|amma|dad|daddy|papa|pappa|abbu|baba|bro|brother|sis|sister|nani|nana|dadi|dada|uncle|aunty|auntie|aunt|cousin|chacha|chachi|mausi|masi|mama ji|bhai|bhaiya|didi|wife|husband|grandma|grandad|granny|grandpa|son|daughter|bhabhi|jiju)\b/i;
const BUSINESS = /\b(ltd|limited|llc|inc|plc|gmbh|support|service|services|delivery|deliveries|booking|bookings|clinic|hotel|hostel|restaurant|cafe|bank|taxi|cab|uber|grab|bolt|pharmacy|agency|official|team|shop|store|salon|spa|gym|dentist|dental|doctor|hospital|insurance|airbnb|rental|rentals|realty|estate agent|property|motors|garage|courier|logistics|bot|alerts|noreply|verify)\b/i;
export function propose(name: string, talk: Talk, now: number, surname?: string): Proposal {
  const n = name.trim();
  const both = talk.sent > 0 && talk.messages - talk.sent > 0;
  const days = talk.last ? (now - talk.last * 1000) / DAY : Infinity;
  if (n && (FAMILY.test(n) || (surname && new RegExp(`\\b${surname}\\b`, "i").test(n)))) return { level: "family", confidence: "medium", reason: "The name reads like family" };
  if (n && BUSINESS.test(n)) return { level: "off", confidence: "medium", reason: "Looks like a business, not a person" };
  if (both && talk.messages >= 200 && days <= 90) return { level: "friend", confidence: "medium", reason: `${talk.messages} messages both ways, talked ${Math.max(0, Math.round(days))} d ago` };
  if (both && talk.messages >= 40 && days <= 365) return { level: "friend", confidence: "low", reason: `${talk.messages} messages both ways this year` };
  if (!n && !talk.sent) return { level: "off", confidence: "low", reason: "Unknown number, and you never replied" };
  if (!talk.sent && talk.messages > 0) return { level: "network", confidence: "low", reason: "They wrote; you never replied" };
  return { level: "network", confidence: "low", reason: talk.messages ? `${talk.messages} messages, last ${Number.isFinite(days) ? `${Math.round(days)} d ago` : "unknown"}` : "No messages yet" };
}
const fromRelation = (r: string): Level => r === "client" ? "client" : r === "partner" || r === "affiliate" ? "partner" : r === "friend" || r === "creator" ? "friend" : r === "family" ? "family" : "network";

// --- Gaps: what each level wants to know, asked one at a time ----------------------------------------------------------
export function gapsOf(c: Pick<Card, "level" | "fullName" | "from" | "birthday" | "company" | "role" | "why" | "links" | "name">): Gap[] {
  const g: Gap[] = [];
  if (c.level === "off") return g;
  if (!c.fullName && c.name.trim().split(/\s+/).length < 2) g.push("fullName");
  if (c.level === "want") { if (!c.why) g.push("why"); if (!c.links || !Object.values(c.links).some(Boolean)) g.push("links"); return g; }
  if (!c.from) g.push("from");
  if ((c.level === "friend" || c.level === "family") && !c.birthday) g.push("birthday");
  if ((c.level === "client" || c.level === "partner") && !c.company) g.push("company");
  if ((c.level === "client" || c.level === "partner") && !c.role) g.push("role");
  return g;
}

function talkOf(people: WhatsAppPerson[]): Talk | undefined {
  if (!people.length) return undefined;
  const t: Talk = { messages: 0, sent: 0 };
  for (const p of people) {
    t.messages += p.messages || 0; t.sent += p.sent || 0;
    if (p.lastIn) t.lastIn = Math.max(t.lastIn ?? 0, p.lastIn);
    if (p.lastOut) t.lastOut = Math.max(t.lastOut ?? 0, p.lastOut);
    const last = Math.max(p.lastIn || 0, p.lastOut || 0) || p.lastTs || 0;
    if (last) t.last = Math.max(t.last ?? 0, last);
  }
  return t;
}

/** The page's whole answer: placed people (book ∪ CLIENTS.json), the unsorted WhatsApp inbox, and counts. */
export function view(wa: WhatsAppPerson[], waLive: boolean, o: Options = {}): BookView {
  const now = o.now ?? Date.now();
  const book = readBook(o);
  const dms = wa.filter((p) => !p.isGroup && typeof p.jid === "string");
  const byJid = new Map(dms.map((p) => [p.jid, p]));
  const byDigits = new Map<string, WhatsAppPerson>();
  for (const p of dms) { const d = digits(p.phone) || (p.jid.endsWith("@s.whatsapp.net") ? digits(p.jid.split("@")[0]) : ""); if (d) byDigits.set(d, p); }
  const byName = new Map<string, WhatsAppPerson | null>();
  for (const p of dms) { const k = norm(p.name ?? ""); if (k && !numberLike(p.name)) byName.set(k, byName.has(k) ? null : p); }

  const claimed = new Set(book.people.flatMap((c) => c.chats ?? []));
  const registry = (() => { try { return registryList(o.home ? { home: o.home } : {}); } catch { return []; } })();
  const regByName = new Map(registry.map((r) => [r.name, r]));
  const linked = new Set(book.people.map((c) => c.registry).filter(Boolean) as string[]);
  // A registry person's chat: their number, else an exact unique name or alias. Never a guess.
  const regChat = (r: RolodexPerson) => {
    const d = digits(r.whatsapp);
    if (d && byDigits.get(d)) return byDigits.get(d)!;
    if (d) return undefined;
    const hits = new Set([r.name, ...(r.aliases ?? [])].map((n) => byName.get(norm(n))).filter(Boolean) as WhatsAppPerson[]);
    return hits.size === 1 ? [...hits][0] : undefined;
  };

  const out: BookPerson[] = [];
  const present = (c: Card, fromRegistry = false): BookPerson => {
    const chats = (c.chats ?? []).map((j) => byJid.get(j)).filter(Boolean) as WhatsAppPerson[];
    const reg = c.registry ? regByName.get(c.registry) : undefined;
    const { chats: _c, registry: _r, ...rest } = c;
    const phone = chats.find((p) => p.phone)?.phone?.replace(/^\+/, "") ?? (reg?.whatsapp || undefined);
    return { ...rest, keys: (c.chats ?? []).map(keyOf), ...(phone ? { phone } : {}), ...(chats.length ? { talk: talkOf(chats) } : {}),
      ...(reg ? { work: { projects: reg.projects, note: reg.note, words: reg.words, wordsMore: reg.wordsMore, careful: reg.careful, via: reg.via, relation: reg.relation } } : {}),
      gaps: gapsOf(c), ...(fromRegistry ? { fromRegistry: true } : {}) };
  };
  for (const c of book.people) out.push(present(c));
  for (const r of registry) {
    if (linked.has(r.name)) continue;
    const chat = regChat(r);
    if (chat && claimed.has(chat.jid)) continue;
    if (chat) claimed.add(chat.jid);
    const level = r.private ? "family" : fromRelation(r.relation);
    out.push(present({ id: "reg:" + norm(r.name).replace(/ /g, "-"), name: r.name, level, registry: r.name, chats: chat ? [chat.jid] : [],
      added: new Date(now).toISOString(), updated: new Date(now).toISOString() }, true));
  }

  const dismissed = new Set(book.dismissed);
  const inbox: InboxRow[] = [];
  for (const p of dms) {
    if (claimed.has(p.jid) || dismissed.has(p.jid)) continue;
    const name = (p.name ?? "").trim();
    const named = !!name && !numberLike(name);
    const talk = talkOf([p])!;
    inbox.push({ key: keyOf(p.jid), name: named ? name : (p.phone ? "+" + digits(p.phone) : "Unnamed chat"), named,
      ...(p.phone ? { phone: digits(p.phone) } : {}), talk, proposal: propose(named ? name : "", talk, now, "sisodia") });
  }
  // Most-talked-to first, recent first among equals, unnamed last: ten minutes of sorting reaches the people who matter.
  const weight = (r: InboxRow) => (r.named ? 1 : 0) * 1e12 + Math.log1p(r.talk.messages) * 1e10 + (r.talk.last ?? 0);
  inbox.sort((a, b) => weight(b) - weight(a));
  return { people: out.sort((a, b) => a.name.localeCompare(b.name)), inbox, offCount: book.people.filter((c) => c.level === "off").length + dismissed.size,
    whatsapp: { state: waLive ? "live" : "off", chats: dms.length, named: dms.filter((p) => p.name && !numberLike(p.name)).length } };
}

// --- Changes -----------------------------------------------------------------------------------------------------------
const FIELDS = ["name", "fullName", "from", "lives", "birthday", "howMet", "company", "role", "why", "notes", "nextStep", "nextStepAt"] as const;
const isLevel = (v: unknown): v is Level => typeof v === "string" && ((LEVELS as readonly string[]).includes(v) || v === "off");
function applyFields(c: Card, f: Record<string, unknown>, at: string) {
  for (const k of FIELDS) if (k in f) {
    const v = f[k] === null ? undefined : str(f[k], k === "notes" ? 20_000 : 400);
    if (k === "name") { if (v) c.name = v; continue; }
    if (v === undefined) delete c[k]; else c[k] = v;
  }
  if (record(f.links)) {
    const links: Links = { ...(c.links ?? {}) };
    for (const k of ["linkedin", "x", "instagram", "site"] as const) if (k in f.links) {
      const v = str(f.links[k], 300);
      if (v && /^https?:\/\//.test(v)) links[k] = v; else delete links[k];
    }
    c.links = links;
  }
  if ("level" in f && isLevel(f.level) && f.level !== c.level) {
    c.history = [...(c.history ?? []), { at, from: c.level, to: f.level }];
    c.level = f.level;
  }
  if (f.level !== undefined || f.confirm === true) delete c.proposed;
  c.updated = at;
}

export type Op =
  | { op: "place"; key: string; level: Level; fields?: Record<string, unknown> }
  | { op: "update"; id: string; fields: Record<string, unknown> }
  | { op: "dismiss" | "undismiss"; key: string }
  | { op: "link"; id: string; key: string }
  | { op: "touch"; id: string; note: string; at?: string }
  | { op: "want"; url: string; name?: string; why?: string }
  | { op: "unplace"; id: string };

/** One change to the book. Returns the changed card's id. Registry-only people become cards on their first edit. */
export function change(op: Op, wa: WhatsAppPerson[], o: Options = {}): { id?: string } {
  if (!record(op)) throw Object.assign(new Error("Invalid change"), { status: 400 });
  const now = o.now ?? Date.now();
  const at = new Date(now).toISOString();
  const book = readBook(o);
  const jidOf = (key: unknown) => wa.find((p) => !p.isGroup && keyOf(p.jid) === key)?.jid;
  const find = (id: unknown): Card => {
    const hit = book.people.find((c) => c.id === id);
    if (hit) return hit;
    if (typeof id === "string" && id.startsWith("reg:")) {
      // First edit of a CLIENTS.json person: the card remembers which registry name it is, and their chat if known.
      const v = view(wa, true, o).people.find((p) => p.id === id && p.fromRegistry);
      if (v) {
        const reg = registryList(o.home ? { home: o.home } : {}).find((r) => "reg:" + norm(r.name).replace(/ /g, "-") === id);
        const chats = v.keys.map((k) => jidOf(k)).filter(Boolean) as string[];
        const card: Card = { id: randomUUID(), name: v.name, level: v.level, registry: reg?.name ?? v.name, chats, added: at, updated: at };
        book.people.push(card);
        return card;
      }
    }
    throw Object.assign(new Error("No one with that id"), { status: 404 });
  };
  let id: string | undefined;
  switch (op.op) {
    case "place": {
      const jid = jidOf(op.key);
      if (!jid) throw Object.assign(new Error("That chat is not in WhatsApp any more; refresh"), { status: 404 });
      if (!isLevel(op.level)) throw Object.assign(new Error("Unknown level"), { status: 400 });
      if (book.people.some((c) => c.chats?.includes(jid))) throw Object.assign(new Error("Already on the Rolodex"), { status: 409 });
      const p = wa.find((x) => x.jid === jid)!;
      const name = p.name && !numberLike(p.name) ? p.name.trim() : (str(op.fields?.name) ?? (p.phone ? "+" + digits(p.phone) : "Unnamed"));
      const card: Card = { id: randomUUID(), name, level: op.level, chats: [jid], added: at, updated: at, history: [{ at, from: "inbox", to: op.level }] };
      applyFields(card, op.fields ?? {}, at);
      book.people.push(card); book.dismissed = book.dismissed.filter((d) => d !== jid); id = card.id; break;
    }
    case "update": { const c = find(op.id); applyFields(c, record(op.fields) ? op.fields : {}, at); id = c.id; break; }
    case "dismiss": case "undismiss": {
      const jid = jidOf(op.key);
      if (!jid) throw Object.assign(new Error("That chat is not in WhatsApp any more; refresh"), { status: 404 });
      book.dismissed = book.dismissed.filter((d) => d !== jid);
      if (op.op === "dismiss") book.dismissed.push(jid);
      break;
    }
    case "link": {
      const c = find(op.id); const jid = jidOf(op.key);
      if (!jid) throw Object.assign(new Error("That chat is not in WhatsApp any more; refresh"), { status: 404 });
      for (const other of book.people) if (other !== c && other.chats?.includes(jid)) throw Object.assign(new Error("That chat belongs to someone else"), { status: 409 });
      c.chats = [...new Set([...(c.chats ?? []), jid])]; c.updated = at; id = c.id; break;
    }
    case "touch": {
      const c = find(op.id); const note = str(op.note, 2000);
      if (!note) throw Object.assign(new Error("Say what happened"), { status: 400 });
      const when = str(op.at) && Number.isFinite(Date.parse(op.at!)) ? new Date(op.at!).toISOString() : at;
      c.touches = [{ at: when, note }, ...(c.touches ?? [])].sort((a, b) => b.at.localeCompare(a.at)); c.updated = at; id = c.id; break;
    }
    case "want": {
      const link = parseProfileLink(op.url);
      if (!link) throw Object.assign(new Error("Paste a LinkedIn, X or Instagram profile link"), { status: 400 });
      const dupe = book.people.find((c) => c.links?.[link.platform] && normaliseUrl(c.links[link.platform]!) === normaliseUrl(link.url));
      if (dupe) return { id: dupe.id };
      const card: Card = { id: randomUUID(), name: str(op.name, 120) ?? link.guess, level: "want", links: { [link.platform]: link.url },
        ...(str(op.why) ? { why: str(op.why) } : {}), added: at, updated: at, history: [{ at, from: null, to: "want" }] };
      book.people.push(card); id = card.id; break;
    }
    case "unplace": {
      // Undo of a sort-deck mis-click: only a card that has done nothing since it was placed goes back to the inbox.
      const c = book.people.find((x) => x.id === op.id);
      if (!c || c.history?.length !== 1 || c.history[0].from !== "inbox" || c.touches?.length || c.notes) throw Object.assign(new Error("Only a just-placed card can go back"), { status: 409 });
      book.people = book.people.filter((x) => x !== c); break;
    }
    default: throw Object.assign(new Error("Unknown change"), { status: 400 });
  }
  writeBook(book, o);
  return { id };
}

// --- Want to know: a pasted profile link → a card, parsed locally -----------------------------------------------------
export type ProfileLink = { platform: "linkedin" | "x" | "instagram"; handle: string; url: string; guess: string };
const normaliseUrl = (u: string) => u.toLowerCase().replace(/^https?:\/\/(www\.)?/, "").replace(/[?#].*$/, "").replace(/\/+$/, "");
const RESERVED_X = new Set(["home", "explore", "search", "i", "intent", "share", "settings", "messages", "notifications", "hashtag"]);
const RESERVED_IG = new Set(["p", "reel", "reels", "explore", "stories", "accounts", "direct", "tv"]);
export function parseProfileLink(raw: unknown): ProfileLink | null {
  const s = str(raw, 500);
  if (!s) return null;
  let u: URL;
  try { u = new URL(/^https?:\/\//i.test(s) ? s : "https://" + s); } catch { return null; }
  const host = u.hostname.toLowerCase().replace(/^(www\.|m\.|mobile\.|[a-z]{2}\.)/, "");
  const seg = u.pathname.split("/").filter(Boolean);
  const titled = (h: string) => h.replace(/[-_.]+/g, " ").replace(/\b\d{3,}\b|\b[0-9a-f]{6,}\b/gi, "").replace(/\s+/g, " ").trim()
    .split(" ").filter(Boolean).map((w) => w[0].toUpperCase() + w.slice(1)).join(" ") || h;
  if (host === "linkedin.com" && seg[0] === "in" && seg[1]) {
    const handle = decodeURIComponent(seg[1]);
    return { platform: "linkedin", handle, url: `https://www.linkedin.com/in/${handle}`, guess: titled(handle) };
  }
  if ((host === "x.com" || host === "twitter.com") && seg[0] && !RESERVED_X.has(seg[0].toLowerCase()) && /^\w{1,15}$/.test(seg[0])) {
    return { platform: "x", handle: seg[0], url: `https://x.com/${seg[0]}`, guess: "@" + seg[0] };
  }
  if (host === "instagram.com" && seg[0] && !RESERVED_IG.has(seg[0].toLowerCase()) && /^[\w.]{1,30}$/.test(seg[0])) {
    return { platform: "instagram", handle: seg[0], url: `https://www.instagram.com/${seg[0]}`, guess: "@" + seg[0] };
  }
  return null;
}
