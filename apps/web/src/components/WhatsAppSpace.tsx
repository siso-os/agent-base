import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { Archive, ArrowDown, ArrowUp, AudioLines, BellOff, Bookmark, ChevronDown, Download, FileText, Folder, FolderPlus, Image as ImageIcon, Loader2, MapPin, Pin, QrCode, Reply, Search, Smartphone, Sticker, UserRound, Video, WifiOff, X } from "lucide-react";
import { LivingIcon } from "../../../../packages/halo-face/LivingIcon";
import "../../../../packages/siso-shell/src/halo-rim/halo-rim.css";
import "./WhatsAppSpace.css";

// v2 (Shaan, 7 Oct: "actually use our proper brand colours and like the dark grey ... the way you've done halo and clients
// ... is a bit shit"; ui-hub/whatsapp/v2/SPEC.md): the same client, storage and send rules in Agent Base's own look: one
// floating halo-rim card like the browser sidebar, the amber brand on warm dark grey, folders two levels deep at most, and
// bubbles so his messages and theirs read apart at a glance.

// The WhatsApp space (WA-1): his chats from siso-whatsapp-link on the Mac mini, in Buzz's chat look (Shaan, 3 Oct 05:00:
// "Buzz's UI ... over his chats, sorted by recently used"). Sending is deliberate and gated by the gateway capability.
// The component talks to a WhatsAppClient, so the preview runs on fixtures and the app on /api/whatsapp.
//
// The sidebar, chat header, timeline rows, day and "New" dividers, file card, unread pill and composer are adapted from
// block/buzz (desktop/src/features/sidebar, messages, chat; commit fe9e2409a), Copyright 2026 Block, Inc., Apache License
// 2.0 (./whatsapp/LICENSE-buzz.txt). Changes: re-written as plain React + CSS over WhatsApp data (no nostr, stores, Radix
// or Tiptap); groups take Buzz's channel row, people its DM row, each with a last-message line and time added; chats sort
// by last activity; deleted messages keep a marker; quoted replies show their source line; the composer preserves private per-chat drafts.

export type WaChat = {
  jid: string; name: string; isGroup: boolean; lastTs: number; unread: number; markedUnread?: boolean; archived?: boolean;
  pinned?: boolean; mutedUntil?: number; preview?: string; previewFromMe?: boolean; previewKind?: string;
};
export type WaMessage = {
  chat: string; id: string; sender?: string; senderName?: string; fromMe: boolean; ts: number; kind: string; text?: string;
  mime?: string; fileName?: string; hasThumb?: boolean; hasMedia?: boolean; deleted?: boolean; edited?: boolean; quotedId?: string;
};
export type WaCounts = { chats: number; groups: number; messages: number; unreadChats: number };
export type WaHealth = {
  link: { state: string; loggedIn: boolean; connected: boolean; since: number; historyPercent?: number; detail?: string };
  counts: WaCounts; sendEnabled: boolean; readReceipts: boolean;
  appSendEnabled?: boolean;
};
export type WaEvent = { type: string; chat?: string };

export type WaOrganisation = { account: string; revision: number; pins: Record<string, boolean>; folders: { id: string; name: string; parent?: string; chats: string[] }[]; saved: { chat: string; message: string }[] };

export interface WhatsAppClient {
  organisation?(): Promise<WaOrganisation>;
  organise?(op: Record<string, unknown>): Promise<WaOrganisation>;
  health(): Promise<WaHealth>;
  chats(archived: boolean): Promise<{ chats: WaChat[]; counts: WaCounts }>;
  messages(jid: string, before?: number): Promise<{ chat: WaChat; messages: WaMessage[]; olderRequested?: boolean }>;
  search(q: string): Promise<{ chats: WaChat[]; messages: WaMessage[] }>;
  read(jid: string): Promise<void>;
  send(jid: string, text: string, requestId: string): Promise<void>;
  pair(): Promise<void>;
  qr(): Promise<{ state: string; active: boolean; png?: string }>;
  thumbUrl(m: WaMessage): string;
  mediaUrl(m: WaMessage): string;
  subscribe(on: (e: WaEvent) => void): () => void;
}

const enc = (s: string) => encodeURIComponent(s);
async function getJSON<T>(u: string, init?: RequestInit): Promise<T> {
  const r = await fetch(u, { cache: "no-store", ...init });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(body.error ?? `HTTP ${r.status}`), { status: r.status, offline: !!body.offline, uncertain: !!body.uncertain });
  return body as T;
}

/** The app's client: the node's /api/whatsapp proxy. */
export const apiClient: WhatsAppClient = {
  organisation: () => getJSON("/api/whatsapp/organisation"),
  organise: (op) => getJSON("/api/whatsapp/organisation", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(op) }),
  health: () => getJSON("/api/whatsapp/health"),
  chats: (archived) => getJSON(`/api/whatsapp/chats?limit=2000${archived ? "&archived=1" : ""}`),
  messages: (jid, before) => getJSON(`/api/whatsapp/chats/${enc(jid)}/messages?limit=60${before ? `&before=${before}` : ""}`),
  search: (q) => getJSON(`/api/whatsapp/search?q=${enc(q)}&limit=60`),
  read: async (jid) => { await getJSON(`/api/whatsapp/chats/${enc(jid)}/read`, { method: "POST" }); },
  send: async (jid, text, requestId) => { await getJSON(`/api/whatsapp/chats/${enc(jid)}/send`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text, requestId, explicit: true }) }); },
  pair: async () => { await getJSON("/api/whatsapp/pair", { method: "POST" }); },
  qr: () => getJSON("/api/whatsapp/qr"),
  thumbUrl: (m) => `/api/whatsapp/media/${enc(m.chat)}/${enc(m.id)}/thumb`,
  mediaUrl: (m) => `/api/whatsapp/media/${enc(m.chat)}/${enc(m.id)}`,
  subscribe: (on) => {
    const es = new EventSource("/api/whatsapp/events");
    for (const t of ["message", "chat", "state", "history"]) es.addEventListener(t, (e) => { try { on(JSON.parse((e as MessageEvent).data)); } catch { on({ type: t }); } });
    return () => es.close();
  },
};

const DAY = 86_400_000;
const startOfDay = (ms: number) => { const d = new Date(ms); return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime(); };
/** The sidebar's time: a clock today, then Yesterday, a weekday this week, else a date. */
export function when(ts: number, now = Date.now()): string {
  if (!ts) return "";
  const t = ts * 1000, start = startOfDay(now);
  if (t >= start) return new Date(t).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  if (t >= start - DAY) return "Yesterday";
  if (t >= start - 6 * DAY) return new Date(t).toLocaleDateString([], { weekday: "short" });
  return new Date(t).toLocaleDateString([], { day: "numeric", month: "short", ...(new Date(t).getFullYear() !== new Date(now).getFullYear() ? { year: "2-digit" } : {}) });
}
/** Buzz's day-group label: Today, Yesterday, a weekday within the week, else the date. */
function dayLabel(ts: number, now = Date.now()): string {
  const t = ts * 1000, start = startOfDay(now);
  if (t >= start) return "Today";
  if (t >= start - DAY) return "Yesterday";
  if (t >= start - 6 * DAY) return new Date(t).toLocaleDateString([], { weekday: "long" });
  const sameYear = new Date(t).getFullYear() === new Date(now).getFullYear();
  return new Date(t).toLocaleDateString([], sameYear ? { weekday: "long", day: "numeric", month: "long" } : { day: "numeric", month: "long", year: "numeric" });
}
const clock = (ts: number) => new Date(ts * 1000).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
const shortClock = (ts: number) => clock(ts).replace(/\s?[AP]M$/i, "");
const fullDate = (ts: number) => new Date(ts * 1000).toLocaleString([], { weekday: "long", day: "numeric", month: "long", year: "numeric", hour: "numeric", minute: "2-digit" });
const initials = (name: string) => name.replace(/[^\p{L}\p{N} ]/gu, "").split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase() || "?";
// Soft tints for avatars, sender names and folder tiles, picked by a hash of the name (rgb triples, used at low alpha).
const TONES = ["255 167 38", "45 212 191", "244 114 182", "167 139 250", "56 189 248", "163 230 53", "251 146 60", "248 113 113"];
function tone(s: string) { let h = 0; for (const c of s.toLowerCase()) h = (h * 31 + c.charCodeAt(0)) >>> 0; return TONES[h % TONES.length]; }
const toneStyle = (s: string) => ({ "--wa-tone": tone(s || "?") }) as CSSProperties;
const KIND_LABEL: Record<string, string> = { image: "Photo", video: "Video", audio: "Voice message", document: "Document", sticker: "Sticker", location: "Location", contact: "Contact", poll: "Poll", deleted: "Message deleted" };
function KindIcon({ kind, size = 14 }: { kind?: string; size?: number }) {
  const I = kind === "image" ? ImageIcon : kind === "video" ? Video : kind === "audio" ? AudioLines : kind === "document" ? FileText : kind === "sticker" ? Sticker : kind === "location" ? MapPin : kind === "contact" ? UserRound : kind === "deleted" ? X : null;
  return I ? <I size={size} aria-hidden="true" /> : null;
}
const isUnread = (c: WaChat) => c.unread > 0 || !!c.markedUnread;
const isMuted = (c: WaChat, now?: number) => !!c.mutedUntil && (c.mutedUntil < 0 || c.mutedUntil * 1000 > (now ?? Date.now()));

function Avatar({ name, size = "md", group = false }: { name: string; size?: "sm" | "md" | "lg"; group?: boolean }) {
  return <span className={`wa-avatar is-${size}${group ? " is-group" : ""}`} style={toneStyle(name)} aria-hidden="true">{initials(name || "?")}</span>;
}

type Filter = "all" | "unread" | "groups" | "direct";
type WaFolder = WaOrganisation["folders"][number];
/** A folder's chats and every descendant folder's chats. */
function subtree(folders: WaFolder[], id: string, seen = new Set<string>()): Set<string> {
  const out = new Set<string>();
  if (seen.has(id)) return out;
  seen.add(id);
  for (const f of folders) {
    if (f.id === id) f.chats.forEach((c) => out.add(c));
    if (f.parent === id) subtree(folders, f.id, seen).forEach((c) => out.add(c));
  }
  return out;
}
/** The whole tree, depth first, for the folder menu and the parent picker. */
function ordered(folders: WaFolder[], parent?: string, depth = 0, seen = new Set<string>()): { f: WaFolder; depth: number }[] {
  return folders.filter((f) => f.parent === parent && !seen.has(f.id)).flatMap((f) => { seen.add(f.id); return [{ f, depth }, ...ordered(folders, f.id, depth + 1, seen)]; });
}
/** The folders a chat is in, as short paths ("Clients · Halo"). */
function foldersOf(folders: WaFolder[], jid: string): string[] {
  const byId = new Map(folders.map((f) => [f.id, f]));
  return folders.filter((f) => f.chats.includes(jid)).map((f) => {
    const path: string[] = []; let at: WaFolder | undefined = f; const seen = new Set<string>();
    while (at && !seen.has(at.id)) { seen.add(at.id); path.unshift(at.name); at = at.parent ? byId.get(at.parent) : undefined; }
    return path.slice(-2).join(" · ");
  });
}

const STATE_LABEL: Record<string, string> = {
  connected: "Connected", connecting: "Connecting…", disconnected: "Reconnecting…", starting: "Starting…", pairing: "Waiting for scan",
  needs_qr: "Not linked", logged_out: "Unlinked from phone", banned: "Temporarily banned", outdated: "Needs an update",
};

// The last read per client, so going back to WhatsApp paints at once and refreshes behind (t-0497: every visit waited
// ~2 s for 800 chats from the Mac mini). Memory only, this window only; never stored.
const lastRead = new WeakMap<WhatsAppClient, { health?: WaHealth; chats?: WaChat[]; counts?: WaCounts; organisation?: WaOrganisation }>();

let warming: Promise<void> | null = null, warmedAt = 0;
/** Read his chats before he clicks (the rail's hover): at most every 30 s, and never while a read is running. */
export function warmWhatsApp(client: WhatsAppClient = apiClient) {
  if (warming || Date.now() - warmedAt < 30_000) return;
  warmedAt = Date.now();
  warming = Promise.all([client.health(), client.chats(false)]).then(([health, c]) => { lastRead.set(client, { ...lastRead.get(client), health, chats: c.chats, counts: c.counts }); })
    .catch(() => {}).finally(() => { warming = null; });
}

export function WhatsAppSpace({ client = apiClient, now }: { client?: WhatsAppClient; now?: number }) {
  const kept = lastRead.get(client);
  const [iconActive, setIconActive] = useState(false);
  const [organisation, setOrganisation] = useState<WaOrganisation | null>(kept?.organisation ?? null);
  const [orgError, setOrgError] = useState("");
  const [orgBusy, setOrgBusy] = useState(false);
  const orgLock = useRef(false);
  const [folderName, setFolderName] = useState("");
  const [folderParent, setFolderParent] = useState("");
  useEffect(() => { let live = true; client.organisation?.().then(o => { lastRead.set(client, { ...lastRead.get(client), organisation: o }); if (live) setOrganisation(o); }).catch(() => live && setOrgError("Private organisation unavailable")); return () => { live = false; }; }, [client]);
  const organise = async (op: Record<string, unknown>) => {
    if (!organisation || !client.organise || orgLock.current) return;
    orgLock.current = true; setOrgBusy(true); setOrgError("");
    try { const o = await client.organise({ ...op, revision: organisation.revision }); lastRead.set(client, { ...lastRead.get(client), organisation: o }); setOrganisation(o); return true; }
    catch (e) { setOrgError((e as Error).message); try { if (client.organisation) setOrganisation(await client.organisation()); } catch {} }
    finally { orgLock.current = false; setOrgBusy(false); }
  };
  const [health, setHealth] = useState<WaHealth | null>(kept?.health ?? null);
  const [offline, setOffline] = useState<string>("");
  const [chats, setChats] = useState<WaChat[]>(kept?.chats ?? []);
  const [counts, setCounts] = useState<WaCounts | null>(kept?.counts ?? null);
  const [loading, setLoading] = useState(!kept?.chats);
  const [filter, setFilter] = useState<Filter>("all");
  const [archived, setArchived] = useState(false);
  const [query, setQuery] = useState("");
  const [found, setFound] = useState<{ chats: WaChat[]; messages: WaMessage[] } | null>(null);
  const [openJid, setOpenJid] = useState<string>("");
  const [savedTarget, setSavedTarget] = useState<{ message: string; nonce: number } | null>(null);
  const [extraChat, setExtraChat] = useState<WaChat | null>(null);
  const [openUnread, setOpenUnread] = useState(0);
  const [folded, setFolded] = useState<Record<string, boolean>>({});
  const searchRef = useRef<HTMLInputElement>(null);
  const refreshGeneration = useRef(0);
  const searchGeneration = useRef(0);
  const alive = useRef(true);

  const refresh = useCallback(async () => {
    const generation = ++refreshGeneration.current;
    try {
      const [h, c] = await Promise.all([client.health(), client.chats(archived)]);
      if (!alive.current || generation !== refreshGeneration.current) return;
      setHealth(h); setChats(c.chats); setCounts(c.counts); setOffline("");
      if (!archived) lastRead.set(client, { ...lastRead.get(client), health: h, chats: c.chats, counts: c.counts });
    } catch (e) {
      if (!alive.current || generation !== refreshGeneration.current) return;
      setOffline((e as Error).message || "unreachable");
    } finally {
      if (alive.current && generation === refreshGeneration.current) setLoading(false);
    }
  }, [client, archived]);

  useEffect(() => { refresh(); }, [refresh]);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      refreshGeneration.current += 1;
      searchGeneration.current += 1;
    };
  }, []);
  // Live: the gateway pings on every change (chat ids only); refetch, debounced.
  const [bump, setBump] = useState(0);
  useEffect(() => {
    let t: ReturnType<typeof setTimeout> | undefined;
    const off = client.subscribe((e) => {
      if (t) clearTimeout(t);
      t = setTimeout(() => { refresh(); if (e.chat) setBump((b) => b + 1); }, 400);
    });
    const poll = setInterval(refresh, 60_000);
    return () => { off(); clearInterval(poll); if (t) clearTimeout(t); };
  }, [client, refresh]);

  useEffect(() => {
    const q = query.trim();
    const generation = ++searchGeneration.current;
    if (!q) { setFound(null); return; }
    const t = setTimeout(() => client.search(q).then((result) => {
      if (alive.current && generation === searchGeneration.current) setFound(result);
    }).catch(() => {
      if (alive.current && generation === searchGeneration.current) setFound({ chats: [], messages: [] });
    }), 200);
    return () => clearTimeout(t);
  }, [query, client]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = (e.target as HTMLElement)?.closest?.("input,textarea,[contenteditable]");
      if (e.key === "/" && !typing) { e.preventDefault(); searchRef.current?.focus(); }
      if (e.key === "Escape" && document.activeElement === searchRef.current) { setQuery(""); searchRef.current?.blur(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Recently used first (Shaan, 3 Oct): newest last message on top; pinned chats get their own section above.
  const visible = useMemo(() => chats
    .map(c => ({ ...c, pinned: organisation?.pins[c.jid] ?? c.pinned }))
    .filter((c) => filter === "all" || (filter === "unread" ? isUnread(c) : filter === "groups" ? c.isGroup : !c.isGroup))
    .sort((a, b) => b.lastTs - a.lastTs), [chats, filter, organisation]);
  const pinned = visible.filter((c) => c.pinned);
  const recent = visible.filter((c) => !c.pinned);
  const unreadTotal = chats.filter((c) => isUnread(c) && !c.archived).length;
  const open = chats.find((c) => c.jid === openJid) ?? found?.chats.find((c) => c.jid === openJid) ?? (extraChat?.jid === openJid ? extraChat : undefined);
  const state = health?.link?.state ?? (offline ? "offline" : "starting");
  const linked = !!health?.link?.loggedIn;
  const needsLink = !!health && !linked && chats.length === 0;

  const openChat = (jid: string) => {
    const c = chats.find((x) => x.jid === jid);
    setOpenUnread(c?.unread ?? 0);
    setOpenJid(jid); setSavedTarget(null);
    setChats((cs) => cs.map((x) => (x.jid === jid ? { ...x, unread: 0, markedUnread: false } : x)));
    client.read(jid).catch(() => {});
  };

  const openSaved = async (saved: { chat: string; message: string }) => {
    setOrgError("");
    try {
      if (!chats.some(c => c.jid === saved.chat)) {
        const result = await client.messages(saved.chat);
        if (!result.chat) throw new Error("This saved chat is unavailable in the current account.");
        setExtraChat(result.chat);
      }
      setOpenJid(saved.chat); setOpenUnread(0); setSavedTarget({ message: saved.message, nonce: Date.now() });
    } catch { setOrgError("This saved chat is unavailable. Its private reference is retained."); }
  };

  const folders = organisation?.folders ?? [];
  const [makingFolder, setMakingFolder] = useState(false);
  // The first 60 recent chats render at once, the rest on demand (t-0497: all 816 rows cost ~250 ms on every visit).
  const [recentShown, setRecentShown] = useState(60);
  // Two levels on screen (SPEC §2.3): a top folder is a section, its children are groups, anything deeper folds into its group.
  const renderFolders = () => folders.filter((f) => !f.parent).map((top) => {
    const own = visible.filter((c) => top.chats.includes(c.jid));
    const kids = folders.filter((f) => f.parent === top.id).map((f) => ({ f, rows: visible.filter((c) => subtree(folders, f.id).has(c.jid)) }));
    const count = visible.filter((c) => subtree(folders, top.id).has(c.jid)).length;
    if (filter !== "all" && !count) return null;
    return <div className="wa-folder" key={top.id}>
      <Section title={top.name} count={count} folded={!!folded[top.id]} onFold={() => setFolded((v) => ({ ...v, [top.id]: !v[top.id] }))}>
        {own.map((c) => <ChatRow key={c.jid} chat={c} active={c.jid === openJid} onOpen={openChat} now={now} />)}
        {kids.filter((k) => filter === "all" || k.rows.length).map(({ f, rows }) => <li key={f.id} className={`wa-group${rows.length ? "" : " is-empty"}`}>
          <button type="button" className="wa-group-head" aria-expanded={!folded[f.id]} onClick={() => setFolded((v) => ({ ...v, [f.id]: !v[f.id] }))}>
            <i style={toneStyle(f.name)}>{initials(f.name).slice(0, 1)}</i><span>{f.name}</span><b>{rows.length || ""}</b>
            {rows.length > 0 && <ChevronDown size={11} aria-hidden="true" className="wa-group-chev" />}</button>
          {!folded[f.id] && rows.length > 0 && <ul className="wa-menu">{rows.map((c) => <ChatRow key={c.jid} chat={c} active={c.jid === openJid} onOpen={openChat} now={now} />)}</ul>}
        </li>)}
        {!count && !kids.length && <li className="wa-empty-line">Add chats from a chat's folder menu.</li>}
      </Section>
    </div>;
  });
  const nav: { id: Filter; label: string; count?: number }[] = [
    { id: "all", label: "All" },
    { id: "unread", label: "Unread", count: unreadTotal },
    { id: "groups", label: "Groups" },
    { id: "direct", label: "People" },
  ];
  const syncing = !!health && state === "connected" && (health.link?.historyPercent ?? 100) < 100;
  const sendOn = !offline && health?.appSendEnabled === true && health?.sendEnabled === true && health?.link?.connected === true && health?.link?.loggedIn === true;
  const saved = organisation?.saved ?? [];

  return <section className={`wa-space${open ? " has-open" : ""}${needsLink ? " is-linking" : ""}`} aria-labelledby="wa-title">
    <aside className={`wa-side siso-rim ${loading || syncing ? "is-working" : "is-idle"}`} aria-label="Chats">
      <div className="wa-side-top">
        <div className="wa-brand" onPointerEnter={() => setIconActive(true)} onPointerLeave={() => setIconActive(false)}><LivingIcon name="whatsapp" size={24} active={iconActive} /><h1 id="wa-title">WhatsApp</h1>
          <span className={`wa-pill is-${offline ? "offline" : state}`} role="status" title={offline ? offline : health?.link?.detail || ""}>
            <span className="wa-dot" aria-hidden="true" />{offline ? "Mac mini unreachable" : syncing ? `Syncing ${health?.link?.historyPercent}%` : STATE_LABEL[state] ?? state}
          </span>
        </div>
        <label className="wa-search"><Search size={15} aria-hidden="true" /><span className="wa-sr">Search chats and messages</span>
          <input ref={searchRef} type="search" placeholder="Search chats and messages" value={query} onChange={(e) => setQuery(e.target.value)} disabled={needsLink} />
          <kbd aria-hidden="true">/</kbd></label>
        {!found && !needsLink && <div className="wa-tabs" role="tablist" aria-label="Filter chats">
          {nav.map(({ id, label, count }) => <button key={id} type="button" role="tab" className="wa-tab" aria-selected={filter === id} onClick={() => setFilter(id)}>
            {label}{!!count && <b aria-label={`${count} unread chats`}>{Math.min(count, 99)}</b>}</button>)}
        </div>}
      </div>
      <div className="wa-side-scroll">
        {needsLink || (loading && !chats.length) ? <SidebarPlaceholder linking={needsLink} />
          : found ? <SearchResults found={found} chats={chats} onOpen={openChat} now={now} query={query} />
          : <>
            {saved.length > 0 && <Section title="Saved" count={saved.length} folded={!!folded.saved} onFold={() => setFolded((f) => ({ ...f, saved: !f.saved }))}>
              {saved.map((ref, i) => { const c = chats.find((x) => x.jid === ref.chat); return <li key={ref.chat + ref.message} className="wa-item wa-saved-row">
                <button type="button" className="wa-btn wa-saved-link" onClick={() => void openSaved(ref)}><Bookmark size={14} aria-hidden="true" /><span className="wa-label">{c?.name || "Saved conversation"}</span><small>#{i + 1}</small></button>
                <button type="button" className="wa-x" disabled={orgBusy} aria-label={`Remove saved reference ${i + 1}`} onClick={() => void organise({ type: "save", chat: ref.chat, message: ref.message, saved: false })}><X size={13} /></button>
              </li>; })}
            </Section>}
            {pinned.length > 0 && <Section title="Pinned" count={pinned.length} folded={!!folded.pinned} onFold={() => setFolded((f) => ({ ...f, pinned: !f.pinned }))}>
              {pinned.map((c) => <ChatRow key={c.jid} chat={c} active={c.jid === openJid} onOpen={openChat} now={now} />)}</Section>}
            {organisation && <div className="wa-folders">
              {renderFolders()}
              {makingFolder ? <form className="wa-folder-create" onSubmit={(e) => { e.preventDefault(); if (folderName.trim()) void organise({ type: "folder", name: folderName, parent: folderParent || undefined }).then((ok) => { if (ok) { setFolderName(""); setMakingFolder(false); } }); }}>
                <input autoFocus aria-label="New folder name" placeholder="Folder name" value={folderName} maxLength={80} onChange={(e) => setFolderName(e.target.value)} onKeyDown={(e) => { if (e.key === "Escape") setMakingFolder(false); }} />
                <select aria-label="Parent folder" value={folderParent} onChange={(e) => setFolderParent(e.target.value)}><option value="">Top level</option>{ordered(folders).map(({ f, depth }) => <option key={f.id} value={f.id}>{" ".repeat(depth * 3)}{f.name}</option>)}</select>
                <button type="submit" disabled={orgBusy || !folderName.trim()}>Add</button>
                <button type="button" className="wa-x" aria-label="Cancel" onClick={() => setMakingFolder(false)}><X size={13} /></button>
              </form> : <button type="button" className="wa-new-folder" onClick={() => setMakingFolder(true)}><FolderPlus size={14} aria-hidden="true" />New folder</button>}
            </div>}
            <Section title={archived ? "Recent, with archived" : "Recent"} count={recent.length} folded={!!folded.recent} onFold={() => setFolded((f) => ({ ...f, recent: !f.recent }))}>
              {recent.length === 0 && pinned.length === 0 ? <li className="wa-empty-line">{filter === "unread" ? "Nothing unread." : "No chats here yet."}</li>
                : recent.slice(0, recentShown).map((c) => <ChatRow key={c.jid} chat={c} active={c.jid === openJid} onOpen={openChat} now={now} />)}
              {recent.length > recentShown && <li><button type="button" className="wa-new-folder wa-more" onClick={() => setRecentShown((n) => n + 200)}>Show {Math.min(200, recent.length - recentShown)} more of {(recent.length - recentShown).toLocaleString()}</button></li>}
            </Section>
          </>}
      </div>
      {counts && linked && <footer className="wa-side-foot">
        <span>{counts.chats.toLocaleString()} chats · {counts.groups.toLocaleString()} groups</span>
        <button type="button" className="wa-foot-btn" aria-pressed={archived} onClick={() => setArchived((a) => !a)} title="Include archived chats"><Archive size={13} aria-hidden="true" />Archived</button>
        <span className={`wa-send-state${sendOn ? " is-on" : ""}`} title={sendOn ? "You can send by hand: the button or Enter" : "Sending is off at the gateway"}>{sendOn ? "Manual send" : "Read only"}</span>
      </footer>}
    </aside>
    <main className="wa-main">
      {orgError && <p className="wa-err wa-org-err" role="alert">{orgError}</p>}
      {loading ? <div className="wa-center" role="status"><Loader2 className="wa-spin" size={22} aria-hidden="true" />Reading your chats…</div>
        : offline && !health ? <Offline reason={offline} retry={refresh} />
        : needsLink ? <LinkCard client={client} state={state} onLinked={refresh} />
        : open ? <Conversation key={open.jid} chat={open} unreadAtOpen={openUnread} client={client} organisation={organisation} target={savedTarget} organise={organise} orgBusy={orgBusy} bump={bump} sendEnabled={sendOn} now={now} onBack={() => setOpenJid("")} />
        : <Home chats={chats.map((c) => ({ ...c, pinned: organisation?.pins[c.jid] ?? c.pinned })).filter((c) => !c.archived)} counts={counts} unread={unreadTotal} folders={folders} linked={linked} state={state} onOpen={openChat} now={now} />}
    </main>
  </section>;
}

function Section({ title, count, folded, onFold, children }: { title: string; count?: number; folded: boolean; onFold: () => void; children: ReactNode }) {
  return <div className="wa-section">
    <button type="button" className="wa-section-label" aria-expanded={!folded} onClick={onFold}><span>{title}</span>{!!count && <b>{count.toLocaleString()}</b>}
      <span className="wa-chev" aria-hidden="true"><ChevronDown size={11} style={folded ? { transform: "rotate(-90deg)" } : undefined} /></span></button>
    {!folded && <ul className="wa-menu">{children}</ul>}
  </div>;
}

function SidebarPlaceholder({ linking }: { linking: boolean }) {
  return <div className="wa-section" aria-hidden={!linking}>
    <span className="wa-section-label is-static">Recent</span>
    <ul className="wa-menu">{[72, 54, 64, 46, 58].map((w, i) => <li key={i} className="wa-item"><span className="wa-btn wa-row is-skeleton"><span className="wa-sk-dot" /><span className="wa-sk-line" style={{ width: `${w}%` }} /></span></li>)}</ul>
    {linking && <p className="wa-side-note">Your chats appear here, most recent first, once your phone is linked.</p>}
  </div>;
}

function ChatRow({ chat, active, onOpen, now }: { chat: WaChat; active: boolean; onOpen: (j: string) => void; now?: number }) {
  const unread = isUnread(chat);
  const muted = isMuted(chat, now);
  const label = chat.previewKind && chat.previewKind !== "text" ? KIND_LABEL[chat.previewKind] : "";
  const quiet = !active && !unread && muted ? " is-muted" : "";
  return <li className="wa-item wa-chat-item">
    <button type="button" className={`wa-btn wa-row${unread ? " is-unread" : ""}${quiet}`} data-active={active} onClick={() => onOpen(chat.jid)} aria-current={active ? "true" : undefined}>
      <Avatar name={chat.name} size="sm" group={chat.isGroup} />
      <span className="wa-row-main">
        <span className="wa-row-top"><span className="wa-name">{chat.name || "Unnamed chat"}</span><span className="wa-time">{when(chat.lastTs, now)}</span></span>
        <span className="wa-preview"><span className="wa-preview-text">{chat.previewFromMe && <span className="wa-you">You: </span>}<KindIcon kind={chat.previewKind} size={12} />{chat.preview || label || " "}</span>
          {muted && <BellOff size={12} className="wa-bell" aria-label="Muted" />}
          {chat.pinned && !muted && <Pin size={12} className="wa-bell" aria-label="Pinned" />}
          {unread && !active && <span className="wa-badge" aria-label={`${chat.unread || ""} unread`}>{chat.unread > 0 ? (chat.unread > 99 ? "99+" : chat.unread) : ""}</span>}
        </span>
      </span>
    </button>
  </li>;
}

// The launcher when no chat is open (SPEC §5): what needs him, what he pinned, his folders. One click opens a chat.
function Home({ chats, counts, unread, folders, linked, state, onOpen, now }: { chats: WaChat[]; counts: WaCounts | null; unread: number; folders: WaFolder[]; linked: boolean; state: string; onOpen: (j: string) => void; now?: number }) {
  const waiting = chats.filter(isUnread).sort((a, b) => b.lastTs - a.lastTs).slice(0, 9);
  const pins = chats.filter((c) => c.pinned).sort((a, b) => b.lastTs - a.lastTs);
  const byJid = new Map(chats.map((c) => [c.jid, c]));
  const tops = folders.filter((f) => !f.parent).map((f) => ({ f, rows: [...subtree(folders, f.id)].map((j) => byJid.get(j)).filter((c): c is WaChat => !!c).sort((a, b) => b.lastTs - a.lastTs) }));
  const card = (c: WaChat) => <button key={c.jid} type="button" className={`wa-card${isUnread(c) ? " is-unread" : ""}`} onClick={() => onOpen(c.jid)}>
    <span className="wa-card-top"><Avatar name={c.name} size="md" group={c.isGroup} /><span className="wa-card-name">{c.name || "Unnamed chat"}</span>
      {c.unread > 0 && <span className="wa-badge">{c.unread > 99 ? "99+" : c.unread}</span>}</span>
    <span className="wa-card-preview">{c.previewFromMe ? "You: " : ""}{c.preview || (c.previewKind ? KIND_LABEL[c.previewKind] : "") || " "}</span>
    <span className="wa-card-time">{when(c.lastTs, now)}</span>
  </button>;
  return <div className="wa-home">
    <div className="wa-home-col">
      <header className="wa-home-head"><LivingIcon name="whatsapp" size={44} active /><div><h2>WhatsApp</h2>
        <p>{counts ? `${counts.chats.toLocaleString()} chats · ${counts.groups.toLocaleString()} groups · ${unread} unread` : "Your chats, most recent first."}</p>
        {!linked && <p className="wa-warn">Showing what was saved; the link to your phone is {STATE_LABEL[state]?.toLowerCase() ?? state}.</p>}</div></header>
      <section><h3>Unread <b>{unread || ""}</b></h3>{waiting.length ? <div className="wa-cards">{waiting.map(card)}</div> : <p className="wa-home-note">Nothing waiting. You're clear.</p>}</section>
      {pins.length > 0 && <section><h3>Pinned <b>{pins.length}</b></h3><div className="wa-cards">{pins.map(card)}</div></section>}
      {tops.length > 0 && <section><h3>Folders <b>{tops.length}</b></h3><div className="wa-tiles">{tops.map(({ f, rows }) =>
        <button key={f.id} type="button" className="wa-tile" disabled={!rows.length} onClick={() => rows[0] && onOpen(rows[0].jid)} title={rows.length ? `Open ${rows[0].name}` : "No chats in this folder yet"}>
          <i style={toneStyle(f.name)}><Folder size={15} aria-hidden="true" /></i><span className="wa-tile-name">{f.name}</span>
          <span className="wa-tile-sub">{rows.length} chat{rows.length === 1 ? "" : "s"}</span>
          <span className="wa-tile-faces">{rows.slice(0, 4).map((c) => <Avatar key={c.jid} name={c.name} size="sm" group={c.isGroup} />)}</span>
        </button>)}</div></section>}
    </div>
  </div>;
}

function Highlight({ text, q }: { text: string; q: string }) {
  const i = text.toLowerCase().indexOf(q.trim().toLowerCase());
  if (i < 0 || !q.trim()) return <>{text}</>;
  const start = Math.max(0, i - 30), end = i + q.trim().length;
  return <>{start > 0 ? "…" : ""}{text.slice(start, i)}<mark>{text.slice(i, end)}</mark>{text.slice(end, end + 80)}</>;
}

function SearchResults({ found, chats, onOpen, now, query }: { found: { chats: WaChat[]; messages: WaMessage[] }; chats: WaChat[]; onOpen: (j: string) => void; now?: number; query: string }) {
  const chatOf = (jid: string) => chats.find((c) => c.jid === jid) ?? found.chats.find((c) => c.jid === jid);
  if (!found.chats.length && !found.messages.length) return <p className="wa-side-note">No chats or messages match.</p>;
  return <>
    {found.chats.length > 0 && <div className="wa-section"><span className="wa-section-label is-static">Chats</span>
      <ul className="wa-menu">{found.chats.map((c) => <ChatRow key={c.jid} chat={c} active={false} onOpen={onOpen} now={now} />)}</ul></div>}
    {found.messages.length > 0 && <div className="wa-section"><span className="wa-section-label is-static">Messages</span>
      <ul className="wa-menu">{found.messages.map((m) => {
        const c = chatOf(m.chat);
        return <li key={m.chat + m.id} className="wa-item"><button type="button" className="wa-hit" onClick={() => onOpen(m.chat)}>
          <span className="wa-hit-top"><span className="wa-name">{c?.isGroup && "# "}{c?.name ?? "Chat"}</span><span className="wa-time">{when(m.ts, now)}</span></span>
          <span className="wa-hit-text">{m.fromMe ? "You: " : m.senderName ? `${m.senderName}: ` : ""}<Highlight text={m.text || m.fileName || ""} q={query} /></span>
        </button></li>;
      })}</ul></div>}
  </>;
}

function Conversation({ chat, unreadAtOpen, client, organisation, target, organise, orgBusy, bump, sendEnabled, now, onBack }: { organisation: WaOrganisation | null; target: { message: string; nonce: number } | null; organise: (op: Record<string, unknown>) => Promise<boolean | undefined>; orgBusy: boolean; chat: WaChat; unreadAtOpen: number; client: WhatsAppClient; bump: number; sendEnabled: boolean; now?: number; onBack: () => void }) {
  const [msgs, setMsgs] = useState<WaMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [older, setOlder] = useState<"idle" | "loading" | "asked" | "none">("idle");
  const [lightbox, setLightbox] = useState<WaMessage | null>(null);
  const [away, setAway] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const firstUnreadId = useRef<string | null>(null);

  useEffect(() => {
    let live = true;
    client.messages(chat.jid).then((r) => { if (!live) return; setMsgs((prev) => merge(prev, r.messages)); setLoading(false); }).catch(() => live && setLoading(false));
    return () => { live = false; };
  }, [chat.jid, client, bump]);

  // The "New" divider sits above the oldest of the messages that were unread when the chat was opened (Buzz's read frontier).
  if (firstUnreadId.current === null && msgs.length && unreadAtOpen > 0) {
    let n = 0, id = "";
    for (let i = msgs.length - 1; i >= 0 && n < unreadAtOpen; i--) if (!msgs[i].fromMe) { n++; id = msgs[i].id; }
    firstUnreadId.current = id;
  }

  const toBottom = () => { const el = scroller.current; if (el) el.scrollTop = el.scrollHeight; };
  useEffect(() => { if (stick.current) toBottom(); }, [msgs]);

  const loadOlder = async () => {
    if (!msgs.length || older === "loading") return;
    setOlder("loading");
    const el = scroller.current, before = el ? el.scrollHeight - el.scrollTop : 0;
    try {
      const r = await client.messages(chat.jid, msgs[0].ts);
      stick.current = false;
      setMsgs((prev) => merge(r.messages, prev));
      setOlder(r.messages.length ? "idle" : r.olderRequested ? "asked" : "none");
      requestAnimationFrame(() => { if (el) el.scrollTop = el.scrollHeight - before; });
    } catch { setOlder("idle"); }
  };

  const onScroll = () => {
    const el = scroller.current;
    if (!el) return;
    stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    setAway(!stick.current);
    if (el.scrollTop < 40 && older === "idle") loadOlder();
  };

  const [savedOnly, setSavedOnly] = useState(false);
  const [locating, setLocating] = useState(false), [locateStatus, setLocateStatus] = useState("");
  const [locateAttempt, setLocateAttempt] = useState(0);
  const [localTarget, setLocalTarget] = useState<{ message: string; nonce: number } | null>(null);
  const [highlighted, setHighlighted] = useState("");
  const requested = localTarget && (!target || localTarget.nonce > target.nonce) ? localTarget : target;
  // The gateway offers paged history, not by-ID reads. Bound each search; never imply a missing reference was deleted.
  useEffect(() => {
    if (!requested || loading) return;
    let live = true;
    const locate = async () => {
      setSavedOnly(false); setLocating(true); setLocateStatus("Looking for the saved message…"); stick.current = false;
      let history = msgs;
      try {
        for (let page = 0; page < 4 && !history.some(m => m.id === requested.message); page++) {
          if (!history.length) break;
          const r = await client.messages(chat.jid, history[0].ts);
          if (!live) return;
          const combined = merge(r.messages, history);
          if (combined.length === history.length) break;
          history = combined;
        }
        if (!live) return;
        setMsgs(previous => merge(history, previous));
        const hit = history.find(m => m.id === requested.message);
        setHighlighted(hit?.id ?? "");
        setLocateStatus(hit ? "Saved message found in its conversation." : "Not in the available history yet. The reference is retained; you can check earlier history.");
        if (hit) requestAnimationFrame(() => {
          if (!live) return;
          const row = Array.from(scroller.current?.querySelectorAll<HTMLElement>(".wa-msg") ?? []).find(el => el.dataset.id === hit.id);
          row?.scrollIntoView({ block: "center", behavior: "auto" }); row?.focus({ preventScroll: true });
        });
      } catch { if (live) setLocateStatus("Earlier history could not be read. The saved reference is retained; try again."); }
      finally { if (live) setLocating(false); }
    };
    void locate();
    return () => { live = false; };
    // Only an explicit saved-reference request starts another bounded read.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requested?.nonce, loading, locateAttempt, chat.jid, client]);
  const isSaved = (id: string) => !!organisation?.saved.some(s => s.chat === chat.jid && s.message === id);
  const byId = useMemo(() => new Map(msgs.map((m) => [m.id, m])), [msgs]);
  const author = (m: WaMessage) => (m.fromMe ? "You" : m.senderName || (chat.isGroup ? "Someone" : chat.name || "Them"));
  const who = (m: WaMessage) => (m.fromMe ? "me" : m.sender || m.senderName || chat.jid);

  // Day groups, each with Buzz's hairline behind a pill label; rows group by author within ten minutes.
  const groups: { label: string; rows: WaMessage[] }[] = [];
  for (const m of msgs) {
    if (savedOnly && !isSaved(m.id)) continue;
    const label = dayLabel(m.ts, now);
    if (groups.at(-1)?.label !== label) groups.push({ label, rows: [] });
    groups.at(-1)!.rows.push(m);
  }

  const pinnedNow = organisation ? (organisation.pins[chat.jid] ?? !!chat.pinned) : !!chat.pinned;
  const savedHere = organisation?.saved.filter((s) => s.chat === chat.jid) ?? [];
  const inFolders = organisation ? foldersOf(organisation.folders, chat.jid) : [];
  const [menu, setMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menu) return;
    const off = (e: PointerEvent) => { if (!menuRef.current?.contains(e.target as Node)) setMenu(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setMenu(false); };
    window.addEventListener("pointerdown", off); window.addEventListener("keydown", esc);
    return () => { window.removeEventListener("pointerdown", off); window.removeEventListener("keydown", esc); };
  }, [menu]);

  return <div className="wa-chat">
    <header className="wa-chat-head">
      <button type="button" className="wa-back" onClick={onBack} aria-label="Back to chats"><X size={16} /></button>
      <Avatar name={chat.name} size="lg" group={chat.isGroup} />
      <div className="wa-head-text">
        <h2 title={chat.name}>{chat.name || "Unnamed chat"}</h2>
        <p>{chat.isGroup ? "Group" : "Direct message"}{inFolders.map((f) => <span key={f} className="wa-head-folder"><Folder size={11} aria-hidden="true" />{f}</span>)}</p>
      </div>
      {organisation && <div className="wa-organise" role="toolbar" aria-label="Organise chat">
        <button type="button" className="wa-icon-btn" disabled={orgBusy} aria-pressed={pinnedNow} title={pinnedNow ? "Unpin chat" : "Pin chat"} onClick={() => void organise({ type: "pin", chat: chat.jid, pinned: !pinnedNow })}><Pin size={15} aria-hidden="true" /><span className="wa-sr">{pinnedNow ? "Unpin chat" : "Pin chat"}</span></button>
        <div className="wa-pop-wrap" ref={menuRef}>
          <button type="button" className="wa-icon-btn" aria-expanded={menu} aria-haspopup="true" title="Folders" onClick={() => setMenu((m) => !m)}><Folder size={15} aria-hidden="true" /><span className="wa-sr">Folders</span>{inFolders.length > 0 && <b>{inFolders.length}</b>}</button>
          {menu && <div className="wa-folder-choices" role="group" aria-label="Folders for this chat">
            <p className="wa-pop-head">Put this chat in</p>
            {organisation.folders.length ? ordered(organisation.folders).map(({ f, depth }) => <label key={f.id} style={{ paddingLeft: 8 + depth * 14 }}>
              <input type="checkbox" disabled={orgBusy} checked={f.chats.includes(chat.jid)} onChange={(e) => void organise({ type: "membership", chat: chat.jid, folder: f.id, member: e.target.checked })} />
              <i style={toneStyle(f.name)} aria-hidden="true">{initials(f.name).slice(0, 1)}</i><span>{f.name}</span></label>)
              : <p className="wa-pop-note">Make a folder with "New folder" in the sidebar.</p>}
          </div>}
        </div>
        <button type="button" className="wa-icon-btn" aria-pressed={savedOnly} title="Saved messages in this chat" onClick={() => setSavedOnly((v) => !v)}><Bookmark size={15} aria-hidden="true" /><span className="wa-sr">Saved messages</span>{savedHere.length > 0 && <b>{savedHere.length}</b>}</button>
      </div>}
    </header>
    {savedOnly && <div className="wa-saved-panel" aria-label="Saved references in this chat">{savedHere.length ? savedHere.map((s, i) => <button type="button" key={s.message} onClick={() => setLocalTarget({ message: s.message, nonce: Date.now() })}><Bookmark size={13} aria-hidden="true" /><span>{byId.get(s.message)?.text || `Saved reference ${i + 1}`}<small>{byId.has(s.message) ? "Open in conversation" : "Look in earlier history"}</small></span></button>) : <p className="wa-pop-note">Nothing saved in this chat. Hover a message and press its bookmark.</p>}</div>}
    {locateStatus && <div className="wa-locate" role="status"><span>{locateStatus}</span>{!highlighted && <button type="button" disabled={locating} onClick={() => setLocateAttempt((n) => n + 1)}>Check earlier history</button>}<button type="button" aria-label="Dismiss saved message status" onClick={() => setLocateStatus("")}><X size={13} /></button></div>}
    <div className="wa-timeline">
      <div className="wa-msgs" ref={scroller} onScroll={onScroll} role="log" aria-label={`Messages with ${chat.name}`}>
        {loading ? <div className="wa-center" role="status"><Loader2 className="wa-spin" size={18} aria-hidden="true" /></div> : <div className="wa-msgs-inner">
          <div className="wa-older">{older === "loading" ? "Loading older…" : older === "asked" ? "Asked your phone for older messages; they arrive in a moment." : older === "none" ? "That's the start of what's saved." : msgs.length ? <button type="button" onClick={loadOlder}>Load older</button> : null}</div>
          {msgs.length === 0 && <div className="wa-empty-card"><p className="wa-empty-title">Nothing saved here yet</p><p className="wa-empty-sub">New messages land here as they arrive.</p></div>}
          {savedOnly && groups.length === 0 && msgs.length > 0 && <p className="wa-empty-sub wa-centre-note">No saved messages in what's loaded. Load older messages to look further back.</p>}
          {groups.map((g) => <section key={g.label + g.rows[0].id} className="wa-day-group" data-day-label={g.label}>
            <div className="wa-day" aria-label={g.label}><p>{g.label}</p></div>
            {g.rows.map((m, i) => {
              const prev = g.rows[i - 1], next = g.rows[i + 1];
              const cont = !!prev && who(prev) === who(m) && m.ts - prev.ts < 600 && m.id !== firstUnreadId.current;
              const nextCont = !!next && who(next) === who(m) && next.ts - m.ts < 600 && next.id !== firstUnreadId.current;
              return <div key={m.id} className={`wa-msg-wrap${nextCont ? "" : " is-last"}${highlighted === m.id ? " is-highlighted" : ""}`}>
                {m.id === firstUnreadId.current && <div className="wa-new" aria-label="New messages"><span /><b>New</b><span /></div>}
                <Row m={m} group={chat.isGroup} tail={!nextCont} saved={isSaved(m.id)} onSave={organisation ? () => void organise({ type: "save", chat: chat.jid, message: m.id, saved: !isSaved(m.id) }) : undefined} cont={cont} author={author(m)} quoted={m.quotedId ? byId.get(m.quotedId) : undefined} quotedAuthor={author} client={client} onMedia={setLightbox}
                  onImg={() => { if (stick.current) toBottom(); }} />
              </div>;
            })}
          </section>)}
        </div>}
      </div>
      {away && <div className="wa-pill-wrap"><button type="button" className="wa-jump" onClick={() => { stick.current = true; setAway(false); toBottom(); }}><ArrowDown size={14} aria-hidden="true" />Jump to latest</button></div>}
    </div>
    <Composer account={organisation?.account ?? (client !== apiClient ? "fixture" : "")} enabled={sendEnabled} chat={chat} client={client} onSent={() => { stick.current = true; client.messages(chat.jid).then((r) => setMsgs((p) => merge(p, r.messages))).catch(() => {}); }} />
    {lightbox && <div className="wa-lightbox" role="dialog" aria-label="Media" onClick={() => setLightbox(null)}>
      {lightbox.kind === "video" ? <video src={client.mediaUrl(lightbox)} controls autoPlay onClick={(e) => e.stopPropagation()} /> : <img src={client.mediaUrl(lightbox)} alt={lightbox.text || "Photo"} />}
      <button type="button" className="wa-lightbox-x" aria-label="Close"><X size={18} /></button>
    </div>}
  </div>;
}

function merge(a: WaMessage[], b: WaMessage[]): WaMessage[] {
  const seen = new Map<string, WaMessage>();
  for (const m of [...a, ...b]) seen.set(m.id, m);
  return [...seen.values()].sort((x, y) => x.ts - y.ts);
}

// One message as a bubble (SPEC §4): his on the right in amber glass, theirs on the left in raised grey. A run of one sender
// within ten minutes is one stack: in a group the sender's name heads it and their avatar sits by its last bubble.
function Row({ m, group, tail, saved, onSave, cont, author, quoted, quotedAuthor, client, onMedia, onImg }: { m: WaMessage; group: boolean; tail: boolean; saved: boolean; onSave?: () => void; cont: boolean; author: string; quoted?: WaMessage; quotedAuthor: (m: WaMessage) => string; client: WhatsAppClient; onMedia: (m: WaMessage) => void; onImg: () => void }) {
  const media = m.kind === "image" || m.kind === "video" || m.kind === "sticker";
  const bare = media && m.hasThumb && !m.text && !m.quotedId && !m.deleted;
  return <article className={`wa-msg${cont ? " is-cont" : ""}${m.fromMe ? " is-me" : ""}${tail ? " is-tail" : ""}${saved ? " is-saved" : ""}`} data-id={m.id} tabIndex={-1}>
    {group && !m.fromMe && <span className="wa-msg-face">{tail && <Avatar name={author} size="sm" />}</span>}
    <div className="wa-msg-main">
      {group && !m.fromMe && !cont && <p className="wa-sender" style={toneStyle(author)}>{author}</p>}
      <div className={`wa-bubble${bare ? " is-bare" : ""}${m.kind === "sticker" ? " is-sticker" : ""}`}>
        {m.quotedId && <p className="wa-quote"><Reply size={12} aria-hidden="true" />{quoted ? <><b>{quotedAuthor(quoted)}</b>{quoted.deleted ? "a deleted message" : quoted.text || KIND_LABEL[quoted.kind] || ""}</> : "a reply to an earlier message"}</p>}
        {m.deleted ? <p className="wa-deleted"><X size={13} aria-hidden="true" />This message was deleted</p> : <>
          {media && m.hasThumb && <button type="button" className={`wa-thumb${m.kind === "sticker" ? " is-sticker" : ""}`} onClick={() => m.hasMedia && onMedia(m)} aria-label={`Open ${KIND_LABEL[m.kind] ?? m.kind}`}>
            <img src={client.thumbUrl(m)} alt="" loading="lazy" onLoad={onImg} />{m.kind === "video" && <span className="wa-play"><Video size={18} aria-hidden="true" /></span>}</button>}
          {m.kind === "document" ? <a className="wa-file" href={client.mediaUrl(m)} download={m.fileName || "document"}>
            <span className="wa-file-icon"><FileText size={16} aria-hidden="true" /></span>
            <span className="wa-file-main"><span className="wa-file-name">{m.fileName || "Document"}</span><span className="wa-file-sub">{m.mime || "Document"}</span></span>
            <Download size={16} className="wa-file-dl" aria-hidden="true" /></a>
            : (media && !m.hasThumb) || (!media && m.kind !== "text") ? <span className="wa-attach"><KindIcon kind={m.kind} size={15} />{KIND_LABEL[m.kind] ?? m.kind}</span> : null}
          {m.text && <p className="wa-text">{m.text}</p>}
        </>}
        <span className="wa-meta" title={fullDate(m.ts)}>{saved && <Bookmark size={10} aria-label="Saved" />}{m.edited && "edited · "}{shortClock(m.ts)}</span>
      </div>
    </div>
    {onSave && <button className="wa-save-message" type="button" aria-label={saved ? "Unsave message" : "Save message"} aria-pressed={saved} onClick={onSave} title={saved ? "Saved" : "Save this message"}><Bookmark size={13} /></button>}
  </article>;
}

type Draft = { text: string; requestId: string; uncertain?: boolean };
function Composer({ enabled, account, chat, client, onSent }: { enabled: boolean; account: string; chat: WaChat; client: WhatsAppClient; onSent: () => void }) {
  const key = `ab:whatsapp:draft:${account}:${chat.jid}`;
  const [draft, setDraft] = useState<Draft>({ text: "", requestId: crypto.randomUUID() });
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const [err, setErr] = useState("");
  const [accepted, setAccepted] = useState(false);
  useEffect(() => {
    if (!account) return;
    try { const raw = localStorage.getItem(key); const d = raw ? JSON.parse(raw) : null; if (d && typeof d.text === "string" && typeof d.requestId === "string") setDraft(d); setReady(true); }
    catch { setErr("Private draft storage unavailable. Sending paused to protect your draft."); }
  }, [key, account]);
  useEffect(() => {
    const changed = () => { try { const raw = localStorage.getItem(key); if (raw) setDraft(JSON.parse(raw)); } catch {} };
    window.addEventListener("ab-whatsapp-draft", changed);
    window.addEventListener("storage", changed);
    return () => { window.removeEventListener("ab-whatsapp-draft", changed); window.removeEventListener("storage", changed); };
  }, [key]);
  const save = (d: Draft) => { localStorage.setItem(key, JSON.stringify(d)); setDraft(d); window.dispatchEvent(new Event("ab-whatsapp-draft")); };
  const send = async () => {
    if (!enabled || !ready || !draft.text.trim() || lock.current || draft.uncertain) return;
    lock.current = true; setBusy(true); setErr(""); setAccepted(false);
    try {
      // Persist uncertainty before starting IO, so reload/navigation cannot create a duplicate request.
      save({ ...draft, uncertain: true });
      await client.send(chat.jid, draft.text.trim(), draft.requestId);
      // A remounted composer may already contain a newer draft: never erase it with this completion.
      if (JSON.parse(localStorage.getItem(key) ?? "{}").requestId === draft.requestId) save({ text: "", requestId: crypto.randomUUID() });
      setAccepted(true); onSent();
    } catch (e) {
      const failure = e as Error & { status?: number; uncertain?: boolean };
      const uncertain = failure.uncertain || !failure.status || failure.status >= 500;
      try { if (JSON.parse(localStorage.getItem(key) ?? "{}").requestId === draft.requestId) save({ ...draft, requestId: uncertain ? draft.requestId : crypto.randomUUID(), uncertain }); } catch { /* Existing persisted draft remains. */ }
      setErr(uncertain ? "Delivery is uncertain. Check this chat in WhatsApp before composing another send. Draft retained." : failure.message);
    } finally { lock.current = false; setBusy(false); }
  };
  return <footer className="wa-compose">
    <form className="wa-compose-box siso-rim is-idle no-glow" onSubmit={(e) => { e.preventDefault(); void send(); }}>
      <textarea rows={1} value={draft.text} disabled={!ready || busy} placeholder={`Message ${chat.name}`}
        onChange={(e) => { try { save({ text: e.target.value, requestId: crypto.randomUUID() }); setErr(""); setAccepted(false); } catch { setErr("Draft could not be saved; sending paused."); setReady(false); } }}
        onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void send(); } }} aria-label="Message" />
      <div className="wa-compose-bar"><span>{enabled ? "Enter sends · Shift+Enter for a new line" : "Read only: sending is off at the gateway · your draft stays here"}</span>
        <button type="submit" className="wa-send" disabled={!enabled || !ready || !draft.text.trim() || busy || !!draft.uncertain} aria-label="Send message" title="Send">
          {busy ? <Loader2 className="wa-spin" size={16} /> : <ArrowUp size={16} aria-hidden="true" />}</button></div>
    </form>
    {draft.uncertain && !err && <p className="wa-err" role="alert">Delivery is uncertain. Check WhatsApp before composing another send. Draft retained.</p>}
    {err && <p className="wa-err" role="alert">{err}</p>}
    {accepted && <p className="wa-send-status" role="status">Accepted by WhatsApp gateway. Delivery/read status is not confirmed.</p>}
  </footer>;
}

// The one ask: shown only while the gateway is up and unlinked. When it is ready (needs_qr) the code comes up by itself.
function LinkCard({ client, state, onLinked }: { client: WhatsAppClient; state: string; onLinked: () => void }) {
  const [qr, setQr] = useState<{ png?: string; active: boolean; state: string } | null>(null);
  const [err, setErr] = useState("");
  const [round, setRound] = useState(0);
  const ready = state === "needs_qr" || state === "pairing" || state === "logged_out";
  useEffect(() => {
    if (!ready) return;
    let live = true;
    const tick = async () => {
      try {
        const q = await client.qr();
        if (!live) return;
        setQr(q);
        if (q.state === "connected" || q.state === "connecting") onLinked();
      } catch (e) { if (live) setErr((e as Error).message); }
    };
    (async () => {
      setErr("");
      if (state !== "pairing" || round > 0) { try { await client.pair(); } catch (e) { if (live) setErr((e as Error).message); } }
      tick();
    })();
    const t = setInterval(tick, 3000);
    return () => { live = false; clearInterval(t); };
  }, [ready, round, client, onLinked]); // eslint-disable-line react-hooks/exhaustive-deps
  const expired = !!qr && !qr.active && !qr.png;
  return <div className="wa-center wa-link">
    <div className="wa-link-card siso-rim is-idle">
      <div className="wa-link-text">
        <p className="wa-kicker">One step, once</p>
        <h2><Smartphone size={18} aria-hidden="true" /> Link your WhatsApp</h2>
        <ol>
          <li>Open WhatsApp on your phone</li>
          <li>Settings → <b>Linked devices</b> → <b>Link a device</b></li>
          <li>Point the phone at this code</li>
        </ol>
        <p className="wa-small">It links like WhatsApp Desktop, as “SISO Agent Base”, on the Mac mini. Your chats then fill the list on the left, most recent first. Nothing is sent from your number.</p>
        {state === "logged_out" && <p className="wa-warn">Your phone unlinked this device. Scan again to carry on.</p>}
        {err && <p className="wa-err" role="alert">{err}</p>}
      </div>
      <div className="wa-qr">
        {!ready ? <div className="wa-qr-wait"><Loader2 className="wa-spin" size={20} aria-hidden="true" />Getting the link ready…</div>
          : qr?.png ? <img src={qr.png} alt="WhatsApp linking code" width={232} height={232} />
          : expired ? <button type="button" className="wa-qr-btn" onClick={() => { setQr(null); setRound((r) => r + 1); }}><QrCode size={20} aria-hidden="true" />The code expired. Show a new one</button>
          : <div className="wa-qr-wait"><Loader2 className="wa-spin" size={20} aria-hidden="true" />Getting a code…</div>}
      </div>
    </div>
  </div>;
}

function Offline({ reason, retry }: { reason: string; retry: () => void }) {
  return <div className="wa-center"><div className="wa-empty-card"><WifiOff size={22} aria-hidden="true" /><p className="wa-empty-title">Can't reach your WhatsApp link</p>
    <p className="wa-empty-sub">It runs on the Mac mini. {reason}</p><button type="button" className="wa-qr-btn" onClick={retry}>Try again</button></div></div>;
}
