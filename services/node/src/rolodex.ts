import { atomicPrivate } from "./whatsapp-private.ts";
import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

// The Rolodex (ab-145, spec rolodex §4-§5): the people he works with, from his registry (SISO_Agency/clients/CLIENTS.json),
// with last contact from a pulled WhatsApp cache (tools/rolodex-pull) or the WhatsApp link. Read-only; never message bodies.

export type RolodexProject = { id: string; name: string; folder: string; kind: string; available: boolean; stage?: string };
/** Minimal shape from the WhatsApp link (whatsapp.ts rolodexContacts): matched by name already. No bodies. */
export type RolodexContact = { id: string; name: string; label?: string; whatsapp?: string; lastContact?: number; messages?: number; facts?: ContactFact[] };
export type Relation = "client" | "partner" | "friend" | "affiliate" | "lead" | "family" | "creator" | "other";
export type Words = { text: string; source?: string; when?: string };
export type LastContact = { channel: "whatsapp"; at: number /* ms */; messageCount: number };
export type ContactFact = { field: string; value: string; source: string; observedAt: string; confidence: "source-record" | "stable-id" | "exact-name" };
export type RolodexPerson = {
  facts?: ContactFact[]; identityConfidence?: "number" | "exact-name" | "unresolved";
  id: string; name: string; note: string; kinds: string[]; projects: RolodexProject[];
  contactId?: string; label?: string; whatsapp?: string;
  relation: Relation; aliases: string[]; via?: string; group?: string;
  /** His verbatim lines about them, newest first, at most 3; `wordsMore` counts the rest. */
  words?: Words[]; wordsMore?: number;
  private?: boolean; careful?: string;
  lastContact?: LastContact;
  /** WhatsApp labels of the matched contact (searchable; never a number). */
  labels?: string[];
  /** Ids of the people whose `via` is this person. */
  introduced: string[];
  status: "private" | "quiet" | "new" | "active" | null; quietDays?: number;
};
/** The pulled WhatsApp cache (tools/rolodex-export.py): DMs only, no bodies, timestamps in unix seconds. */
export type WaContact = { chatId: string; displayName: string; labels?: string[]; lastContacted?: number; messageCount?: number; facts?: ContactFact[] };
export type WaCache = { source?: string; harvestedAt?: string; pulledAt?: string; contacts: WaContact[] };
export type Source = { id: "registry" | "whatsapp"; label: string; state: "ok" | "stale" | "missing"; at?: string; count: number; detail?: string };
export type Everyone = { total: number; hiddenNumbers: number; rows: { id: string; name: string; labels: string[]; lastContact?: LastContact }[] };
export type Lookup = { q: string; matches: { id: string; name: string; relation: Relation; line: string }[] };
export type Options = { home?: string; contacts?: RolodexContact[]; wa?: WaCache | null; waPath?: string; now?: number };

type Entry = { folder: string; kind?: string; note?: string; people?: string[]; on_rolodex?: boolean; stage?: string };
type PersonEntry = {
  projects?: string[]; note?: string; on_rolodex?: boolean; whatsapp?: string; relation?: string; kind?: string; aliases?: unknown;
  via?: string; group?: string; words?: unknown; private?: boolean; careful?: string; added?: string;
};
const RELATIONS: Relation[] = ["client", "partner", "friend", "affiliate", "lead", "family", "creator", "other"];
/** Days since the last WhatsApp message (either way) after which a person reads Quiet (§3b). Family and creator: never. */
export const QUIET_DAYS: Partial<Record<Relation, number>> = { client: 30, partner: 14, lead: 14, affiliate: 45, friend: 60 };
const DAY = 86_400_000;
const STALE_DAYS = 7;
const WORK = new Set<Relation>(["client", "partner", "lead", "affiliate"]);

const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const strings = (value: unknown): string[] => Array.isArray(value) ? value.filter((v): v is string => typeof v === "string" && !!v.trim()) : [];
const text = (value: unknown): string | undefined => typeof value === "string" && value.trim() ? value.trim() : undefined;
const phone = (value: unknown): string | undefined => typeof value === "string" && /^\+?\d{7,15}$/.test(value) ? value.replace(/^\+/, "") : undefined;
/** Case- and accent-insensitive, punctuation dropped: the only name comparison (no fuzzy matching, §4). */
export const norm = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^\p{L}\p{N} ]/gu, "").replace(/\s+/g, " ").trim();
const digitsOnly = (s: string) => /^[\d\s+()-]+$/.test(s) && /\d/.test(s);
const chatDigits = (chatId: string) => chatId.split("@")[0].replace(/\D/g, "");

/** Kind words (a person's own `kind`, else their projects') → relation, when `relation` is absent (§4). */
export function relationFromKind(kind: string | undefined): Relation {
  if (kind === "partner" || kind === "partner-client") return "partner";
  if (kind === "client") return "client";
  if (kind === "lead") return "lead";
  if (kind === "friend-favour" || kind === "friend") return "friend";
  if (kind === "affiliate") return "affiliate";
  return "other";
}

// Re-read a file only when its mtime changes (§4 freshness).
const cache = new Map<string, { mtime: number; value: unknown }>();
function readJson(file: string): { value: unknown; mtime: number } | null {
  let mtime: number;
  try { mtime = statSync(file).mtimeMs; } catch { cache.delete(file); return null; }
  const hit = cache.get(file);
  if (hit && hit.mtime === mtime) return { value: hit.value, mtime };
  let value: unknown;
  try { value = JSON.parse(readFileSync(file, "utf8")); } catch { value = undefined; }
  cache.set(file, { mtime, value });
  return { value, mtime };
}

const registryFile = (options: Options) => path.join(options.home ?? homedir(), "SISO_Workspace", "SISO_Agency", "clients", "CLIENTS.json");
export const waFile = (options: Options) =>
  options.waPath ?? process.env.AB_ROLODEX_WA ?? path.join(homedir(), ".local", "state", "agent-base", "rolodex", "whatsapp.json");

function cleanWa(value: unknown): WaCache | null {
  if (!record(value) || !Array.isArray(value.contacts)) return null;
  const contacts = value.contacts.flatMap((c): WaContact[] => {
    if (!record(c) || typeof c.chatId !== "string" || !c.chatId) return [];
    return [{ chatId: c.chatId, displayName: typeof c.displayName === "string" ? c.displayName : "", labels: strings(c.labels),
      lastContacted: typeof c.lastContacted === "number" && c.lastContacted > 0 ? c.lastContacted : undefined,
      facts: Array.isArray(c.facts) ? c.facts.filter((f): f is ContactFact => record(f) && typeof f.field === "string" && typeof f.value === "string" && typeof f.source === "string" && typeof f.observedAt === "string" && ["source-record", "stable-id", "exact-name"].includes(String(f.confidence))) : [],
      messageCount: typeof c.messageCount === "number" && c.messageCount >= 0 ? c.messageCount : 0 }];
  });
  return { source: text(value.source), harvestedAt: text(value.harvestedAt), pulledAt: text(value.pulledAt), contacts };
}
function readWa(options: Options): WaCache | null {
  if (options.wa !== undefined) return options.wa === null ? null : cleanWa(options.wa);
  const read = readJson(waFile(options));
  return read ? cleanWa(read.value) : null;
}
/** "2026-09-12 00:23:25" (UTC, from the snapshot's meta) or any ISO string → ms. */
export function parseWhen(s: string | undefined): number | undefined {
  if (!s) return undefined;
  const iso = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(:\d{2})?$/.test(s) ? s.replace(" ", "T") + "Z" : s;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : undefined;
}

function waIndex(wa: WaCache | null) {
  const byDigits = new Map<string, WaContact>();
  const byName = new Map<string, WaContact>();
  const ambiguousNames = new Set<string>(), ambiguousNumbers = new Set<string>();
  const newer = (a: WaContact | undefined, b: WaContact) => !a || (b.lastContacted ?? 0) > (a.lastContacted ?? 0);
  for (const c of wa?.contacts ?? []) {
    const d = c.chatId.endsWith("@s.whatsapp.net") ? chatDigits(c.chatId) : "";
    if (d && byDigits.has(d) && byDigits.get(d)!.chatId !== c.chatId) ambiguousNumbers.add(d);
    if (d && newer(byDigits.get(d), c)) byDigits.set(d, c);
    for (const n of [c.displayName, ...(c.labels ?? [])]) {
      const k = norm(n);
      if (k && byName.has(k) && byName.get(k)!.chatId !== c.chatId) ambiguousNames.add(k);
      if (k && !digitsOnly(n) && newer(byName.get(k), c)) byName.set(k, c);
    }
  }
  for (const k of ambiguousNames) byName.delete(k);
  for (const k of ambiguousNumbers) byDigits.delete(k);
  return { byDigits, byName };
}
/** §4 matching, in order: number, then exact name/alias against a display name or label. */
function matchWa(index: ReturnType<typeof waIndex>, number: string | undefined, names: string[]): WaContact | undefined {
  if (number) { const hit = index.byDigits.get(number); if (hit) return hit; }
  // A configured number never falls back to a different identity by name.
  if (number) return undefined;
  const hits = new Map(names.flatMap(n => { const hit = index.byName.get(norm(n)); return hit ? [[hit.chatId, hit] as const] : []; }));
  return hits.size === 1 ? [...hits.values()][0] : undefined;
}

function wordsOf(value: unknown): Words[] {
  const list = (Array.isArray(value) ? value : [value]).flatMap((w): Words[] => {
    if (typeof w === "string" && w.trim()) return [{ text: w.trim() }];
    if (!record(w) || !text(w.text)) return [];
    return [{ text: text(w.text)!, ...(text(w.source) ? { source: text(w.source) } : {}), ...(text(w.when) ? { when: text(w.when) } : {}) }];
  });
  return list.sort((a, b) => (parseWhen(b.when) ?? 0) - (parseWhen(a.when) ?? 0));
}

type Registry = { root: string; entries: Entry[]; people: Record<string, unknown>; mtime: number };
function readRegistry(options: Options): Registry | null {
  const file = registryFile(options);
  const read = readJson(file);
  if (!read || !record(read.value) || !Array.isArray(read.value.clients) || !record(read.value.rolodex)) return null;
  const entries = (read.value.clients as unknown[]).filter((v): v is Entry => record(v) && typeof v.folder === "string");
  return { root: path.dirname(file), entries, people: read.value.rolodex as Record<string, unknown>, mtime: read.mtime };
}

/** Read-only. Missing or malformed registry → []. Off-Rolodex people and folders never appear. */
export function list(options: Options = {}): RolodexPerson[] {
  const reg = readRegistry(options);
  if (!reg) return [];
  const { root, entries, people } = reg;
  const now = options.now ?? Date.now();
  const index = waIndex(readWa(options));
  const excluded = new Set(Object.entries(people).filter(([, v]) => record(v) && v.on_rolodex === false).map(([name]) => name));
  const names = new Set(Object.keys(people));
  for (const entry of entries) if (entry.on_rolodex !== false) for (const name of strings(entry.people)) names.add(name);
  const result: RolodexPerson[] = [];
  for (const name of names) {
    if (!name.trim() || excluded.has(name)) continue;
    const raw = people[name];
    if (raw !== undefined && !record(raw)) continue;
    const person: PersonEntry = record(raw) ? raw : {};
    const folders = new Set(strings(person.projects));
    for (const entry of entries) if (entry.on_rolodex !== false && strings(entry.people).includes(name)) folders.add(entry.folder);
    const projects: RolodexProject[] = [];
    for (const folder of folders) {
      const entry = entries.find((e) => e.folder === folder);
      if (entry?.on_rolodex === false) continue;
      const resolved = path.resolve(root, folder);
      // Registry folders may point at sibling partners, but never outside SISO_Agency.
      const agency = path.dirname(root);
      if (!resolved.startsWith(agency + path.sep)) continue;
      let available = false;
      try { available = statSync(resolved).isDirectory(); } catch { /* Unknown folders still render. */ }
      projects.push({ id: folder, name: path.basename(folder), folder: resolved, kind: typeof entry?.kind === "string" ? entry.kind : "other", available,
        ...(text(entry?.stage) ? { stage: text(entry?.stage) } : {}) });
    }
    if (!projects.length && person.on_rolodex !== true) continue;
    const kinds = [...new Set(projects.map((p) => p.kind))];
    // Who they are to him: their own entry, never a project's kind unless nothing else says (fixes the affiliate-as-template bug).
    const relation: Relation = RELATIONS.includes(person.relation as Relation) ? person.relation as Relation
      : person.kind ? relationFromKind(person.kind)
      : kinds.map(relationFromKind).find((r) => r !== "other") ?? "other";
    const isPrivate = person.private === true || relation === "family";
    const aliases = strings(person.aliases);
    const registryPhone = phone(person.whatsapp);
    const candidate = options.contacts?.find((c) => c && c.name === name && typeof c.id === "string");
    const contact = !registryPhone || phone(candidate?.whatsapp) === registryPhone ? candidate : undefined;
    const whatsapp = registryPhone ?? phone(contact?.whatsapp);
    const wa = matchWa(index, whatsapp, [name, ...aliases]);
    let lastContact: LastContact | undefined;
    if (wa?.lastContacted) lastContact = { channel: "whatsapp", at: wa.lastContacted * 1000, messageCount: wa.messageCount ?? 0 };
    else if (typeof contact?.lastContact === "number" && contact.lastContact > 0)
      lastContact = { channel: "whatsapp", at: contact.lastContact * 1000, messageCount: typeof contact.messages === "number" ? contact.messages : 0 };
    const notes = [...new Set(projects.map((p) => entries.find((e) => e.folder === p.id)?.note).filter((n): n is string => typeof n === "string" && !!n))];
    const words = wordsOf(person.words);
    // Status chip, first match wins (§3b).
    const threshold = QUIET_DAYS[relation];
    const days = lastContact ? Math.floor((now - lastContact.at) / DAY) : undefined;
    const added = parseWhen(person.added);
    const active = WORK.has(relation) && projects.some((p) => p.stage ? p.stage === "active" : p.available);
    const status: RolodexPerson["status"] = isPrivate ? "private"
      : threshold !== undefined && days !== undefined && days > threshold ? "quiet"
      : added !== undefined && now - added < 7 * DAY && now >= added ? "new"
      : active ? "active" : null;
    result.push({ id: name, name, note: typeof person.note === "string" ? person.note : notes.join(" · "), kinds, projects,
      ...(contact ? { contactId: contact.id, ...(typeof contact.label === "string" ? { label: contact.label } : {}) } : {}),
      ...(whatsapp ? { whatsapp } : {}),
      relation, aliases,
      identityConfidence: wa ? (registryPhone ? "number" : "exact-name") : contact ? "exact-name" : "unresolved",
      facts: [
        { field: "name", value: name, source: "registry", observedAt: new Date(reg.mtime).toISOString(), confidence: "source-record" },
        ...projects.map(p => ({ field: "project", value: p.name, source: "registry", observedAt: new Date(reg.mtime).toISOString(), confidence: "source-record" as const })),
        ...(wa?.facts ?? contact?.facts ?? []),
      ],
      ...(text(person.via) ? { via: text(person.via) } : {}),
      ...(text(person.group) ? { group: text(person.group) } : {}),
      ...(words.length ? { words: words.slice(0, 3), wordsMore: Math.max(0, words.length - 3) } : {}),
      ...(isPrivate ? { private: true } : {}),
      ...(text(person.careful) ? { careful: text(person.careful) } : {}),
      ...(lastContact ? { lastContact } : {}),
      ...(wa?.labels?.length ? { labels: wa.labels.filter((l) => !digitsOnly(l)) } : {}),
      introduced: [],
      status, ...(status === "quiet" ? { quietDays: days } : {}),
    });
  }
  for (const p of result) p.introduced = result.filter((q) => q.via === p.id).map((q) => q.id);
  return result.sort((a, b) => a.name.localeCompare(b.name));
}

/** Where the Rolodex's answer comes from, and how fresh (the source strip, §3 #2). */
export function sources(options: Options = {}): Source[] {
  const now = options.now ?? Date.now();
  const reg = readRegistry(options);
  const file = registryFile(options);
  const registry: Source = reg
    ? { id: "registry", label: "Registry", state: "ok", at: new Date(reg.mtime).toISOString(), count: list(options).length, detail: file }
    : { id: "registry", label: "Registry", state: "missing", count: 0, detail: file };
  const wa = readWa(options);
  const harvested = parseWhen(wa?.harvestedAt);
  const whatsapp: Source = !wa
    ? { id: "whatsapp", label: "WhatsApp", state: "missing", count: 0, detail: "not pulled: run tools/rolodex-pull" }
    : { id: "whatsapp", label: "WhatsApp", state: harvested !== undefined && now - harvested <= STALE_DAYS * DAY ? "ok" : "stale",
      ...(harvested !== undefined ? { at: new Date(harvested).toISOString() } : {}), count: wa.contacts.length, detail: wa.source ?? waFile(options) };
  return [registry, whatsapp];
}

/** WhatsApp people not on the Rolodex (the Everyone tier, D2): no chat ids, no bare numbers, no one matched to the registry. */
export function everyone(options: Options = {}, query: { q?: string; limit?: number } = {}): Everyone {
  const wa = readWa(options);
  if (!wa) return { total: 0, hiddenNumbers: 0, rows: [] };
  // Everyone the registry names (on the Rolodex, off it, or private) is matched out, so a private person never shows here.
  const matched = new Set<string>();
  const reg = readRegistry(options);
  if (reg) {
    const index = waIndex(wa);
    const names = new Set(Object.keys(reg.people));
    for (const e of reg.entries) for (const n of strings(e.people)) names.add(n);
    for (const name of names) {
      const raw = reg.people[name];
      const p: PersonEntry = record(raw) ? raw : {};
      const hit = matchWa(index, phone(p.whatsapp), [name, ...strings(p.aliases)]);
      if (hit) matched.add(hit.chatId);
    }
  }
  for (const c of options.contacts ?? []) if (c?.id?.startsWith("wa:")) matched.add(c.id.slice(3));
  const q = norm(query.q ?? "");
  const limit = Math.max(1, Math.min(1000, query.limit ?? 200));
  let hiddenNumbers = 0;
  const rows: Everyone["rows"] = [];
  for (const c of wa.contacts) {
    if (matched.has(c.chatId)) continue;
    const labels = (c.labels ?? []).filter((l) => !digitsOnly(l));
    const name = c.displayName && !digitsOnly(c.displayName) ? c.displayName : labels[0];
    if (!name) { hiddenNumbers++; continue; }
    rows.push({ id: "wa:" + createHash("sha1").update(c.chatId).digest("hex").slice(0, 10), name, labels,
      ...(c.lastContacted ? { lastContact: { channel: "whatsapp", at: c.lastContacted * 1000, messageCount: c.messageCount ?? 0 } } : {}) });
  }
  const total = rows.length;
  const hits = q ? rows.filter((r) => norm([r.name, ...r.labels].join(" ")).includes(q)) : rows;
  hits.sort((a, b) => (b.lastContact?.at ?? 0) - (a.lastContact?.at ?? 0));
  return { total, hiddenNumbers, rows: hits.slice(0, limit) };
}

/** "3 w", "2 d", "today": compact age for the who-line and the list. */
export function age(ms: number, now = Date.now()): string {
  const d = Math.floor((now - ms) / DAY);
  if (d < 1) return "today";
  if (d < 14) return `${d} d`;
  if (d < 60) return `${Math.floor(d / 7)} w`;
  if (d < 730) return `${Math.floor(d / 30)} mo`;
  return `${Math.floor(d / 365)} y`;
}

/** One line for agents (D8): `<name> — <relation> (<note>) · projects a, b · WhatsApp 3 w ago`. */
export function whoLine(p: RolodexPerson, now = Date.now()): string {
  const parts = [`${p.name} — ${p.relation}${p.note ? ` (${p.note})` : ""}`];
  if (p.projects.length) parts.push(`projects ${p.projects.map((x) => x.name).join(", ")}`);
  if (p.via) parts.push(`introduced by ${p.via}`);
  if (p.careful) parts.push(`careful: ${p.careful}`);
  parts.push(p.lastContact ? `WhatsApp ${age(p.lastContact.at, now)}${age(p.lastContact.at, now) === "today" ? "" : " ago"}` : "no WhatsApp yet");
  return parts.join(" · ");
}

/** How well a person answers a search, 0 = not at all. Name prefix > alias > project > note/words/labels/relation (§3 #3). */
export function rank(p: Pick<RolodexPerson, "name" | "aliases" | "projects" | "note" | "relation"> & { words?: Words[]; labels?: string[]; careful?: string }, q: string): number {
  const k = norm(q);
  if (!k) return 1;
  const name = norm(p.name);
  if (name.startsWith(k) || name.split(" ").some((w) => w.startsWith(k))) return 5;
  if (name.includes(k)) return 4.5;
  if (p.aliases.some((a) => norm(a).includes(k))) return 4;
  if (p.projects.some((x) => norm(x.name).includes(k))) return 3;
  if (norm(p.note).includes(k)) return 2;
  if ([...(p.words ?? []).map((w) => w.text), ...(p.labels ?? []), p.relation, p.careful ?? ""].some((s) => norm(s).includes(k))) return 1.5;
  return 0;
}

/** Agents' lookup (§5): at most 5, private people never returned. */
export function lookup(options: Options, q: string): Lookup {
  const now = options.now ?? Date.now();
  const scored = list(options).filter((p) => !p.private).map((p) => ({ p, r: norm(q) ? rank(p, q) : 0 })).filter((x) => x.r > 0);
  scored.sort((a, b) => b.r - a.r || a.p.name.localeCompare(b.p.name));
  return { q, matches: scored.slice(0, 5).map(({ p }) => ({ id: p.id, name: p.name, relation: p.relation, line: whoLine(p, now) })) };
}


export type ImportChange = { field: string; before?: string; value: string; conflict: boolean };
export type ImportReview = { chatId: string; status: "new" | "updated" | "known" | "conflict" | "unresolved"; reason?: string; changes: ImportChange[] };
export type WhatsAppImportPreview = { revision: string; observedAt: string; contacts: WaContact[]; reviews: ImportReview[]; added: number; updated: number; unchanged: number; unresolved: number };
const stableContact = (c: WaContact) => JSON.stringify([c.chatId, c.displayName, c.lastContacted, c.messageCount, (c.facts ?? []).filter(f => f.field === "displayName" || f.field === "phone").map(f => [f.field, f.value, f.source, f.confidence])]);
function sameImportedContact(previous: WaContact, incoming: WaContact) {
  return previous.displayName === incoming.displayName && previous.lastContacted === incoming.lastContacted && previous.messageCount === incoming.messageCount &&
    (incoming.facts ?? []).every(f => previous.facts?.some(old => old.field === f.field && old.value === f.value && old.source === f.source && old.confidence === f.confidence));
}
function importCache(options: Options, preserve = false): WaCache | null {
  const file = waFile(options);
  try {
    const raw = JSON.parse(readFileSync(file, "utf8"));
    if (raw !== null && (!record(raw) || !Array.isArray(raw.contacts) || raw.contacts.some(c => !record(c) || typeof c.chatId !== "string") || new Set(raw.contacts.map(c => c.chatId)).size !== raw.contacts.length)) throw new Error("Invalid cache");
    if (preserve) return raw as WaCache | null;
  } catch (e) { if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw new Error("Existing contact cache cannot be safely read"); }
  return readWa(options);
}
/** Same private cache as tools/rolodex-pull. Preview never invents relationships or merges on names. */
export function previewWhatsAppImport(people: unknown, account: string, options: Options = {}): WhatsAppImportPreview {
  if (!Array.isArray(people)) throw new Error("Invalid contact feed");
  const observedAt = new Date(options.now ?? Date.now()).toISOString();
  const byId = new Map<string, WaContact>();
  const conflictingFeed = new Set<string>();
  let unresolved = 0;
  for (const p of people) {
    if (!record(p) || p.isGroup === true || typeof p.jid !== "string" || !/^[^/\s]+@(s\.whatsapp\.net|lid)$/.test(p.jid)) continue;
    if (byId.has(p.jid)) {
      const previous = byId.get(p.jid)!;
      if (previous.displayName !== (text(p.name) ?? "") || previous.facts?.find(f => f.field === "phone")?.value !== phone(p.phone)) conflictingFeed.add(p.jid);
      continue;
    }
    const name = text(p.name) ?? "";
    if (!name || digitsOnly(name)) unresolved++;
    const source = `whatsapp:${account}:${p.jid}`;
    const facts: ContactFact[] = [{ field: "displayName", value: name, source, observedAt, confidence: "stable-id" }];
    if (phone(p.phone)) facts.push({ field: "phone", value: phone(p.phone)!, source, observedAt, confidence: "stable-id" });
    byId.set(p.jid, { chatId: p.jid, displayName: name, lastContacted: Math.max(Number(p.lastIn) || 0, Number(p.lastOut) || 0, Number(p.lastTs) || 0), messageCount: Number(p.messages) || 0, facts });
  }
  const contacts = [...byId.values()].sort((a,b) => a.chatId.localeCompare(b.chatId));
  const old = importCache(options)?.contacts ?? [];
  const stable = stableContact;
  let added = 0, updated = 0, unchanged = 0;
  for (const c of contacts) {
    const prev = old.find(p => p.chatId === c.chatId);
    if (!prev) added++; else if (!sameImportedContact(prev, c)) updated++; else unchanged++;
  }
  // Bind confirmation to both the incoming feed and existing cache; timestamps do not churn the token.
  const revision = createHash("sha256").update(JSON.stringify([contacts.map(stable), [...conflictingFeed].sort(), importCache(options, true)])).digest("hex");
  const reviews: ImportReview[] = contacts.map(c => {
    const prev = old.find(p => p.chatId === c.chatId);
    const values = new Map((prev?.facts ?? []).map(f => [f.field, f.value]));
    if (prev?.displayName) values.set("displayName", prev.displayName);
    const changes = (c.facts ?? []).filter(f => values.get(f.field) !== f.value).map(f => ({ field: f.field, before: values.get(f.field), value: f.value, conflict: !!values.get(f.field) }));
    const collision = [...old, ...contacts].some(p => p.chatId !== c.chatId && norm(p.displayName) === norm(c.displayName));
    const unnamed = !c.displayName || digitsOnly(c.displayName);
    const inconsistent = conflictingFeed.has(c.chatId);
    return { chatId: c.chatId, changes, status: unnamed || collision || inconsistent ? "unresolved" : changes.some(f => f.conflict) ? "conflict" : !prev ? "new" : sameImportedContact(prev, c) ? "known" : "updated",
      ...(unnamed || collision || inconsistent ? { reason: inconsistent ? "The source supplied conflicting facts for this same identity. Refresh after correcting the source." : unnamed ? "No usable name from the source. Keep this identity separate until reviewed." : "This name belongs to more than one stable identity. No merge or import will be guessed." } : {}) };
  });
  return { revision, observedAt, contacts, reviews, added, updated, unchanged, unresolved };

}
export function importWhatsAppContacts(preview: WhatsAppImportPreview, options: Options = {}, selection?: { selected: string[]; acceptConflicts?: string[] }) {
  const old = importCache(options);
  const selected = selection?.selected ?? preview.reviews.filter(r => r.status === "new" || r.status === "updated").map(r => r.chatId);
  if (!Array.isArray(selected) || selected.some(id => typeof id !== "string") || new Set(selected).size !== selected.length || selected.some(id => !preview.contacts.some(c => c.chatId === id))) throw Object.assign(new Error("Select contacts from the current preview"), { status: 400 });
  const accepted = selection?.acceptConflicts ?? [];
  if (!Array.isArray(accepted) || accepted.some(id => !selected.includes(id))) throw Object.assign(new Error("Invalid conflict review"), { status: 400 });
  const eligible = preview.reviews.filter(r => selected.includes(r.chatId) && r.status !== "known" && r.status !== "unresolved" && (r.status !== "conflict" || accepted.includes(r.chatId)));
  const skipped = selected.length - eligible.length;
  if (!eligible.length) return { imported: 0, skipped, total: old?.contacts.length ?? 0, reversible: false };
  const rawOld = importCache(options, true);
  const merged = new Map((rawOld?.contacts ?? []).map(c => [c.chatId, c]));
  for (const r of eligible) {
    const c = preview.contacts.find(c => c.chatId === r.chatId)!;
    const prev = merged.get(c.chatId);
    const facts = new Map((prev?.facts ?? []).map(f => [f.field, f]));
    for (const f of c.facts ?? []) facts.set(f.field, f);
    merged.set(c.chatId, { ...prev, ...c, facts: [...facts.values()], labels: prev?.labels ?? [] });
  }
  const file = waFile(options);
  const currentIds = new Set([...eligible.map(r => r.chatId), ...preview.reviews.filter(r => r.status === "known").map(r => r.chatId)]);
  const allCurrent = [...merged.keys()].every(id => currentIds.has(id));
  atomicPrivate(file + ".previous.json", rawOld);
  atomicPrivate(file, { ...rawOld, source: allCurrent ? "WhatsApp gateway contact metadata" : "WhatsApp contact metadata; mixed observation dates", harvestedAt: allCurrent ? preview.observedAt : rawOld?.harvestedAt, pulledAt: preview.observedAt, contacts: [...merged.values()] });
  cache.delete(file);
  return { imported: eligible.length, skipped, total: merged.size, reversible: true, undoRevision: importUndoRevision(options) };
}
function importUndoRevision(options: Options) {
  return createHash("sha256").update(readFileSync(waFile(options))).update(readFileSync(waFile(options) + ".previous.json")).digest("hex");
}
/** Restore only the last reviewed import, and only while neither snapshot has changed. */
export function undoWhatsAppImport(revision: unknown, options: Options = {}) {
  if (typeof revision !== "string" || revision !== importUndoRevision(options)) throw Object.assign(new Error("Contacts changed after import; undo is no longer available"), { status: 409 });
  const file = waFile(options), previous = JSON.parse(readFileSync(file + ".previous.json", "utf8"));
  if (previous !== null && (!record(previous) || !Array.isArray(previous.contacts))) throw new Error("Previous contacts cannot be read");
  atomicPrivate(file, previous);
  cache.delete(file);
  return { restored: true };
}
