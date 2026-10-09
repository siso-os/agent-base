// uihub: arc:toast-stack (renders in the one stack, t-0460)
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { ArrowUpRightIcon, XIcon } from "lucide-react";
import { AgentFace } from "../lib/face";
import { openOwner, openOwnerLink, useOwners, type Owner } from "../lib/owners";
import "./OwnerLinkToast.css";
import { Toast } from "./ToastStack";

/**
 * An owner's finish or new link, without opening its chat (Shaan, 6 Oct 22:00: "That URL should come to you ... as a
 * pop-up ... there's no ui to show me that he's done"). Read from the owner cards (~/.local/state/a0/owners): a new `page`
 * or a move to ready / done / blocked becomes one note.
 *
 * Since 6 Oct 23:35 the notes live behind the top bar's one bell ("merge those notifications so it's just a notifications
 * icon which has a little pop up ... it pings when a new one comes through. But they're not always showing up top"): a new
 * note shows once for about 4 s and the bell pings; the list keeps the history, read or not.
 */
const SEEN = "ab.owner-links.seen", HISTORY = "ab.owner-notes";
const LOUD = ["ready", "done", "blocked", "waiting-on-shaan"];
const WORD: Record<string, string> = { ready: "ready", done: "done", blocked: "blocked", "waiting-on-shaan": "needs you" };
const GLIMPSE_MS = 4000;
export type OwnerNote = { key: string; name: string; workspace: string; status: string; subtitle: string; page: string | null; updated: string | null; at: number; read: boolean };
const keyOf = (o: Owner) => `${o.name}|${o.page ?? ""}|${LOUD.includes(o.status) ? o.status : ""}`;
const readSeen = (): Set<string> | null => { try { const v = localStorage.getItem(SEEN); return v ? new Set(JSON.parse(v)) : null; } catch { return null; } };
const writeSeen = (seen: Set<string>) => { try { localStorage.setItem(SEEN, JSON.stringify([...seen].slice(-300))); } catch { /* storage full or off */ } };

// One small store the bell, its list and the glimpse share (the feed below is mounted once, in App).
let notes: OwnerNote[] = (() => { try { const v = JSON.parse(localStorage.getItem(HISTORY) ?? "[]"); return Array.isArray(v) ? v : []; } catch { return []; } })();
let glimpse: OwnerNote | null = null, ping = 0;
const listeners = new Set<() => void>();
const emit = () => { try { localStorage.setItem(HISTORY, JSON.stringify(notes.slice(0, 60))); } catch { /* storage full or off */ } listeners.forEach(l => l()); };
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };
let snapshot: { notes: OwnerNote[]; glimpse: OwnerNote | null; ping: number } = { notes, glimpse, ping };
const getSnapshot = () => (snapshot.notes === notes && snapshot.glimpse === glimpse && snapshot.ping === ping ? snapshot : (snapshot = { notes, glimpse, ping }));
export function useOwnerNotes() { return useSyncExternalStore(subscribe, getSnapshot); }
export function markOwnerNoteRead(key: string, note?: OwnerNote) {
  // A note opened from somewhere else (the Agent Zero home's Needs you) joins the history as read.
  notes = notes.some(n => n.key === key) ? notes.map(n => n.key === key ? { ...n, read: true } : n) : note ? [{ ...note, read: true }, ...notes].slice(0, 60) : notes;
  if (glimpse?.key === key) glimpse = null; emit();
}
/** An owner card as a note: what Needs you and the bell both show. */
export const noteOf = (o: Owner, read = false): OwnerNote => ({ key: keyOf(o), name: o.name, workspace: o.workspace, status: o.status, subtitle: o.subtitle || o.title, page: o.page, updated: o.updated, at: o.updated ? Date.parse(o.updated) : Date.now(), read });
export const LOUD_STATUS = LOUD;
export function markOwnerNotesRead() { notes = notes.map(n => n.read ? n : { ...n, read: true }); glimpse = null; emit(); }
const hideGlimpse = (key: string) => { if (glimpse?.key === key) { glimpse = null; emit(); } };

/** One note as a row: the face, the owner, the state word, one line and Open ↗ (the pop-up's row, reused in the bell's list). */
export function OwnerNoteRow({ note: n, onDone, onDismiss }: { note: OwnerNote; onDone?: () => void; onDismiss?: () => void }) {
  return <div className={`ab-owner-toast is-${n.status}`} data-testid="owner-toast" data-read={n.read || undefined} role="status">
    <button type="button" className="ab-owner-toast__who" onClick={() => { openOwner(n.name); markOwnerNoteRead(n.key, n); onDone?.(); }} title={`Open ${n.name}'s card`}>
      <AgentFace name={n.name} project={n.workspace} status={n.status === "blocked" ? "blocked" : n.status === "waiting-on-shaan" ? "needs-shaan" : "done"} size={28} />
      <span><b>{n.name}</b><em>{WORD[n.status] ?? (n.page ? "new link" : "update")}</em><small>{n.subtitle}</small></span>
    </button>
    {n.page && <button type="button" className="ab-owner-toast__open" data-testid="owner-toast-open" onClick={() => { openOwnerLink(n.page!, `${n.name} · ${n.subtitle}`.slice(0, 80)); markOwnerNoteRead(n.key, n); onDone?.(); }}>Open <ArrowUpRightIcon size={13} aria-hidden /></button>}
    {onDismiss && <button type="button" className="ab-owner-toast__x" aria-label={`Dismiss ${n.name}'s update`} onClick={onDismiss}><XIcon size={13} /></button>}
  </div>;
}

/** The owners' notes at the top of the bell's list. */
export function OwnerNotesList({ onDone }: { onDone?: () => void }) {
  const { notes: list } = useOwnerNotes();
  if (!list.length) return null;
  const unread = list.filter(n => !n.read).length;
  return <section className="ab-owner-notes" aria-label="Owner updates" data-testid="owner-notes">
    <header><b>Owners</b>{unread > 0 && <button type="button" onClick={markOwnerNotesRead}>Mark {unread} read</button>}</header>
    {list.slice(0, 12).map(n => <OwnerNoteRow key={n.key} note={n} onDone={onDone} />)}
  </section>;
}

/** Watches the owner cards, files new notes and shows the newest once, briefly. Mounted once. */
export function OwnerLinkToast() {
  const data = useOwners();
  const seen = useRef<Set<string> | null>(null);
  const { glimpse: shown } = useOwnerNotes();
  const [hover, setHover] = useState(false);
  useEffect(() => {
    const owners = data?.owners ?? [];
    if (!owners.length) return;
    // First run ever: what is already on the cards is not news, except anything from the last 30 minutes.
    if (!seen.current) {
      const stored = readSeen();
      seen.current = stored ?? new Set(owners.filter(o => !o.updated || Date.now() - Date.parse(o.updated) > 30 * 60_000).map(keyOf));
    }
    const fresh = owners.filter(o => !o.readError && (o.page || LOUD.includes(o.status)) && !seen.current!.has(keyOf(o)));
    if (!fresh.length) return;
    for (const o of fresh) seen.current.add(keyOf(o));
    writeSeen(seen.current);
    const at = Date.now();
    const added = fresh.map((o): OwnerNote => ({ ...noteOf(o), at }));
    // An owner's older unread note gives way to its newest; read ones stay as history.
    notes = [...added, ...notes.filter(n => !added.some(a => a.key === n.key) && !(n.read === false && added.some(a => a.name === n.name)))].slice(0, 60);
    glimpse = added[0]; ping += 1; emit();
  }, [data]);
  useEffect(() => {
    if (!shown || hover) return;
    const t = setTimeout(() => hideGlimpse(shown.key), GLIMPSE_MS);
    return () => clearTimeout(t);
  }, [shown, hover]);
  if (!shown) return null;
  return <Toast kind="owner"><div className="ab-owner-toasts" role="region" aria-label="New owner update" data-testid="owner-toasts" onPointerEnter={() => setHover(true)} onPointerLeave={() => setHover(false)}>
    <OwnerNoteRow key={shown.key} note={shown} onDismiss={() => hideGlimpse(shown.key)} />
  </div></Toast>;
}
