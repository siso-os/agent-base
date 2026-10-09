import { useState } from "react";
import { createRoot } from "react-dom/client";
import { RolodexMain, RolodexSidebar, useRolodexBook, type RolodexSelection } from "../src/components/RolodexSpace";
import type { BookView, Gap, InboxRow, Level, Op, Person } from "../src/components/rolodex/book";
import "../src/index.css";

// Rolodex v3 preview. Entirely invented people; /api/rolodex/book is answered in memory, so nothing private is read.
const now = Date.now(), s = Math.floor(now / 1000), iso = new Date(now).toISOString();
const d = (days: number) => s - days * 86_400;
const P = (id: string, name: string, level: Level, extra: Partial<Person> = {}): Person =>
  ({ id, name, level, added: iso, updated: iso, keys: [], gaps: [], ...extra });
const people: Person[] = [
  P("1", "Avery Demo", "client", { fullName: "Avery Demo-Lane", from: "Leeds", company: "North Studio", role: "Founder", phone: "100000000001", talk: { messages: 312, sent: 140, last: d(41) },
    nextStep: "Send the September report", nextStepAt: new Date(now + 2 * 86_400_000).toISOString().slice(0, 10), notes: "Two kids, Mia and Leo. Hates long calls; prefers voice notes.",
    history: [{ at: "2026-03-02T10:00:00Z", from: "network", to: "client" }], touches: [{ at: "2026-09-20T10:00:00Z", note: "Lunch in Canggu, talked about the shop launch" }],
    work: { projects: [{ id: "north", name: "North Studio", folder: "/lab/north", kind: "client", available: true, stage: "active" }], note: "Building a quieter workspace for studios.", words: [{ text: "Avery has been great to work with, I want them looked after." }], relation: "client" } }),
  P("2", "Jules Example", "partner", { from: "Lisbon", company: "Fieldwork", talk: { messages: 840, sent: 400, last: d(2) }, gaps: ["role"] }),
  P("3", "Morgan Fixture", "friend", { fullName: "Morgan Fixture", from: "Manchester", birthday: "1994-" + new Date(now + 5 * 86_400_000).toISOString().slice(5, 10), talk: { messages: 1290, sent: 610, last: d(1) } }),
  P("4", "Riley Sample", "friend", { talk: { messages: 64, sent: 30, last: d(75) }, gaps: ["fullName", "from", "birthday"], proposed: true }),
  P("5", "Sam Family", "family", { fullName: "Sam Family", from: "Jaipur", talk: { messages: 2200, sent: 990, last: d(0) }, gaps: ["birthday"] }),
  P("6", "Casey Neighbour", "network", { talk: { messages: 8, sent: 3, last: d(30) }, gaps: ["fullName", "from"] }),
  P("7", "Dana Builder", "want", { why: "Runs the best design studio in Bali", links: { instagram: "https://www.instagram.com/dana.builds" }, nextStep: "Comment on the next launch post" }),
  P("8", "Kai Writer", "want", { links: { linkedin: "https://www.linkedin.com/in/kai-writer" }, gaps: ["why"] }),
];
const inbox: InboxRow[] = [
  { key: "wa:1", name: "Taylor Surf", named: true, phone: "100000000010", talk: { messages: 460, sent: 210, last: d(3) }, proposal: { level: "friend", confidence: "medium", reason: "460 messages both ways, talked 3 d ago" } },
  { key: "wa:2", name: "Nani", named: true, talk: { messages: 90, sent: 40, last: d(9) }, proposal: { level: "family", confidence: "medium", reason: "The name reads like family" } },
  { key: "wa:3", name: "Bright Dental Clinic", named: true, talk: { messages: 4, sent: 0, last: d(120) }, proposal: { level: "off", confidence: "medium", reason: "Looks like a business, not a person" } },
  { key: "wa:4", name: "Jordan Gym", named: true, talk: { messages: 22, sent: 9, last: d(200) }, proposal: { level: "network", confidence: "low", reason: "22 messages, last 200 d ago" } },
  { key: "wa:5", name: "+100000000099", named: false, phone: "100000000099", talk: { messages: 1, sent: 0, last: d(400) }, proposal: { level: "off", confidence: "low", reason: "Unknown number, and you never replied" } },
];
// This transport is deliberately local: every API operation is answered here, never by the real node.
const fixture = new URLSearchParams(location.search);
const book: BookView = { people, inbox, offCount: 0, whatsapp: { state: fixture.has("offline") ? "off" : "live", chats: inbox.length, named: inbox.filter((p) => p.named).length } };
const originalInbox = [...inbox];
const dismissed = new Set<string>();
let nextId = 10, failed = false;
if (fixture.has("empty")) { book.people = []; book.inbox = []; }
if (fixture.has("offline")) book.inbox = [];
function refreshGaps(p: Person) {
  const gaps: Gap[] = [];
  if (p.level !== "off") {
    if (!p.fullName && p.name.trim().split(/\s+/).length < 2) gaps.push("fullName");
    if (p.level === "want") {
      if (!p.why) gaps.push("why");
      if (!Object.values(p.links ?? {}).some(Boolean)) gaps.push("links");
    } else {
      if (!p.from) gaps.push("from");
      if (["family", "friend"].includes(p.level) && !p.birthday) gaps.push("birthday");
      if (["client", "partner"].includes(p.level)) { if (!p.company) gaps.push("company"); if (!p.role) gaps.push("role"); }
    }
  }
  p.gaps = gaps;
}
function change(op: Op): { id?: string } {
  const at = new Date().toISOString();
  if (op.op === "place") {
    const row = book.inbox.find((r) => r.key === op.key);
    if (!row) throw new Error("That chat is no longer in the inbox");
    const p = P(String(nextId++), row.name, op.level, { keys: [row.key], phone: row.phone, talk: row.talk, ...op.fields,
      history: [{ at, from: "inbox", to: op.level }] } as Partial<Person>);
    book.people.push(p); book.inbox = book.inbox.filter((r) => r.key !== row.key);
    return { id: p.id };
  }
  if (op.op === "dismiss" || op.op === "undismiss") {
    if (op.op === "dismiss") { dismissed.add(op.key); book.inbox = book.inbox.filter((r) => r.key !== op.key); }
    else { dismissed.delete(op.key); const row = originalInbox.find((r) => r.key === op.key); if (row && !book.inbox.some((r) => r.key === op.key)) book.inbox.push(row); }
    return {};
  }
  if (op.op === "want") {
    const url = new URL(/^https?:\/\//i.test(op.url) ? op.url : "https://" + op.url);
    const host = url.hostname.replace(/^www\./, ""), parts = url.pathname.split("/").filter(Boolean);
    const platform = host === "linkedin.com" && parts[0] === "in" && parts[1] ? "linkedin" : ["x.com", "twitter.com"].includes(host) && parts.length === 1 ? "x" : host === "instagram.com" && parts.length === 1 ? "instagram" : null;
    if (!platform || !["http:", "https:"].includes(url.protocol)) throw new Error("Paste a LinkedIn, X or Instagram profile link");
    const handle = platform === "linkedin" ? parts[1] : parts[0];
    if (["home", "explore", "p", "reel", "stories"].includes(handle)) throw new Error("Paste a person's profile link");
    const canonical = platform === "linkedin" ? `https://www.linkedin.com/in/${handle}` : `https://${platform === "x" ? "x.com" : "www.instagram.com"}/${handle}`;
    const exists = book.people.find((p) => Object.values(p.links ?? {}).includes(canonical));
    if (exists) return { id: exists.id };
    const name = platform === "linkedin" ? handle.replace(/[-_.]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()) : "@" + handle;
    const p = P(String(nextId++), op.name ?? name, "want", { why: op.why, links: { [platform]: canonical }, history: [{ at, from: null, to: "want" }] });
    book.people.push(p); return { id: p.id };
  }
  if (op.op === "update" || op.op === "touch" || op.op === "unplace") {
    const p = book.people.find((p) => p.id === op.id);
    if (!p) throw new Error("Person not found");
    if (op.op === "update") {
      if (op.fields.level && op.fields.level !== p.level) (p.history ??= []).push({ at, from: p.level, to: op.fields.level });
      Object.assign(p, op.fields); if (op.fields.confirm) p.proposed = false;
    } else if (op.op === "touch") (p.touches ??= []).push({ at: op.at ?? at, note: op.note });
    else {
      book.people = book.people.filter((r) => r !== p);
      for (const key of p.keys) { const row = originalInbox.find((r) => r.key === key); if (row) book.inbox.push(row); }
    }
    return { id: p.id };
  }
  throw new Error("Unsupported preview operation");
}
const real = window.fetch.bind(window);
window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = new URL(input instanceof Request ? input.url : String(input), location.href);
  if (!url.pathname.startsWith("/api/")) return real(input, init);
  if (url.pathname !== "/api/rolodex/book") return Response.json({ error: "Not available in the synthetic preview" }, { status: 501 });
  const method = init?.method ?? (input instanceof Request ? input.method : "GET");
  if (fixture.has("loading")) return new Promise<Response>(() => {});
  if (fixture.has("error")) return Response.json({ error: "Synthetic connection error. Refresh without ?error to retry." }, { status: 503 });
  if (method === "POST") {
    const delay = Math.min(3000, Math.max(0, Number(fixture.get("delay")) || 0));
    if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
    if (fixture.has("failOnce") && !failed) { failed = true; return Response.json({ error: "Synthetic save failure. Try again." }, { status: 503 }); }
    try { return Response.json(change(JSON.parse(String(init?.body)) as Op)); }
    catch (e) { return Response.json({ error: (e as Error).message }, { status: 400 }); }
  }
  book.people.forEach(refreshGaps);
  book.inbox.sort((a, b) => Number(b.named) - Number(a.named) || b.talk.messages - a.talk.messages);
  book.offCount = dismissed.size + book.people.filter((p) => p.level === "off").length;
  return Response.json(book);
};

function App() {
  const b = useRolodexBook(true);
  const q = new URLSearchParams(location.search);
  const [sel, setSel] = useState<RolodexSelection>((q.get("sel") as RolodexSelection) ?? "all");
  const [person, setPerson] = useState<string | null>(q.get("person"));
  return <div style={{ display: "flex", height: "100vh", background: "var(--color-page)" }}>
    <RolodexSidebar book={b} selected={sel} onSelect={(x) => { setSel(x); setPerson(null); }} onOpen={(id) => { setSel("all"); setPerson(id); }} />
    <main style={{ display: "flex", flex: 1, minWidth: 0 }}><RolodexMain book={b} selected={sel} onSelect={setSel} person={person} onPerson={setPerson} projectHref={() => "#fixture"}  /></main>
  </div>;
}
createRoot(document.getElementById("root")!).render(<App />);
