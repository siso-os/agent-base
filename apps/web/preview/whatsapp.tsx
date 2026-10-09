import { createRoot } from "react-dom/client";
import { type WaChat, type WaMessage, type WhatsAppClient, WhatsAppSpace } from "../src/components/WhatsAppSpace";
import "../src/index.css";

// Entirely invented chats and messages. No real names, numbers or WhatsApp payloads. ?state=needs_qr shows the link card.
const now = Date.UTC(2026, 9, 3, 12, 0) / 1000;
const h = 3600;
const chats: WaChat[] = [
  { jid: "g1@g.us", name: "Studio Launch Crew", isGroup: true, lastTs: now - 0.2 * h, unread: 4, preview: "Pushed the new hero, have a look", previewKind: "text" },
  { jid: "100000000001@s.whatsapp.net", name: "Avery Demo", isGroup: false, lastTs: now - 1 * h, unread: 1, preview: "", previewKind: "image" },
  { jid: "100000000002@s.whatsapp.net", name: "Jules Example", isGroup: false, lastTs: now - 3 * h, unread: 0, preview: "Sounds good, Thursday it is", previewFromMe: true, previewKind: "text", pinned: true },
  { jid: "g2@g.us", name: "Family Fixture", isGroup: true, lastTs: now - 26 * h, unread: 0, preview: "", previewKind: "audio", mutedUntil: -1 },
  { jid: "100000000003@s.whatsapp.net", name: "Riley Sample", isGroup: false, lastTs: now - 4 * 24 * h, unread: 0, preview: "Invoice_October.pdf", previewKind: "document" },
  { jid: "100000000004@s.whatsapp.net", name: "Morgan Fixture", isGroup: false, lastTs: now - 40 * 24 * h, unread: 0, preview: "Message deleted", previewKind: "deleted" },
];
const msgs: Record<string, WaMessage[]> = {
  "g1@g.us": [
    { chat: "g1@g.us", id: "m1", sender: "s1", senderName: "Avery Demo", fromMe: false, ts: now - 27 * h, kind: "text", text: "Morning all, plan for the launch week is in the doc" },
    { chat: "g1@g.us", id: "m2", fromMe: true, ts: now - 26.5 * h, kind: "text", text: "On it. I'll take the landing page and the emails." },
    { chat: "g1@g.us", id: "m3", sender: "s2", senderName: "Jules Example", fromMe: false, ts: now - 2 * h, kind: "image", text: "New hero direction", hasThumb: true, hasMedia: true },
    { chat: "g1@g.us", id: "m4", sender: "s3", senderName: "Riley Sample", fromMe: false, ts: now - 1.5 * h, kind: "document", fileName: "launch-checklist.pdf", hasMedia: true },
    { chat: "g1@g.us", id: "m5", sender: "s2", senderName: "Jules Example", fromMe: false, ts: now - 1 * h, kind: "text", text: "Copy is final, edited the subtitle", edited: true, quotedId: "m3" },
    { chat: "g1@g.us", id: "m6", sender: "s1", senderName: "Avery Demo", fromMe: false, ts: now - 0.5 * h, kind: "text", deleted: true },
    { chat: "g1@g.us", id: "m7", sender: "s1", senderName: "Avery Demo", fromMe: false, ts: now - 0.2 * h, kind: "text", text: "Pushed the new hero, have a look" },
    { chat: "g1@g.us", id: "m8", sender: "s1", senderName: "Avery Demo", fromMe: false, ts: now - 0.18 * h, kind: "text", text: "Live on the staging link too" },
  ],
};
// A tiny striped SVG stands in for a photo thumbnail.
const thumb = "data:image/svg+xml;utf8," + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="260" height="170"><defs><linearGradient id="g" x1="0" x2="1" y1="0" y2="1"><stop offset="0" stop-color="#f97316"/><stop offset="1" stop-color="#22d3ee"/></linearGradient></defs><rect width="260" height="170" fill="url(#g)"/><circle cx="190" cy="60" r="28" fill="#fff8"/></svg>`);
const state = new URLSearchParams(location.search).get("state") ?? "connected";
const linked = state !== "needs_qr";
const counts = { chats: linked ? chats.length : 0, groups: 2, messages: 7, unreadChats: 2 };
const fixture: WhatsAppClient = {
  health: async () => ({ link: { state, loggedIn: linked, connected: linked, since: now }, counts, sendEnabled: false, readReceipts: false }),
  chats: async () => ({ chats: linked ? chats : [], counts }),
  messages: async (jid, before) => ({ chat: chats.find((c) => c.jid === jid)!, messages: before ? [] : msgs[jid] ?? [], olderRequested: !!before }),
  search: async (q) => ({ chats: chats.filter((c) => c.name.toLowerCase().includes(q.toLowerCase())), messages: Object.values(msgs).flat().filter((m) => (m.text ?? "").toLowerCase().includes(q.toLowerCase())) }),
  read: async () => {}, send: async () => { throw new Error("Sending is off"); }, pair: async () => {},
  qr: async () => ({ state: "pairing", active: true, png: "data:image/svg+xml;utf8," + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="240" height="240" shape-rendering="crispEdges">${Array.from({ length: 400 }, (_, i) => ((i * 7919) % 13 < 6 ? `<rect x="${(i % 20) * 12}" y="${Math.floor(i / 20) * 12}" width="12" height="12"/>` : "")).join("")}</svg>`) }),
  thumbUrl: () => thumb, mediaUrl: () => thumb,
  subscribe: () => () => {},
};
createRoot(document.getElementById("root")!).render(<WhatsAppSpace client={fixture} now={now * 1000} />);
