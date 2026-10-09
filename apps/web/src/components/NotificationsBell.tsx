// uihub: arc:notification-center
import { useEffect, useRef, useState } from "react";
import { BellIcon } from "lucide-react";
import { useOwnerNotes, type OwnerNote } from "./OwnerLinkToast";
import { AgentFace } from '../lib/face';
import { bellItems, bellCounts, attentionArrivals } from '../lib/bell';
import { useBellSnooze } from '../lib/bell-snooze';
import type { Attention } from '../lib/attention';

const OPENED_KEY = "ab.bell.opened-at.v1";

/**
 * The top bar's one notifications icon (Shaan, 6 Oct 23:35: "merge those notifications so it's just a notifications icon
 * which has a little pop up ... it pings when a new one comes through"). It replaces the "Updates · N" pill: the count is
 * active needs plus activity and owner outcomes from the last 24 hours since the bell was opened, amber while anything needs him; a new note rings it once.
 */
export function NotificationsBell({ items = [], ownerNotes, open, onToggle }: { items?: Attention[]; ownerNotes?: OwnerNote[]; open: boolean; onToggle: () => void }) {
  const { notes, ping } = useOwnerNotes();
  const { snoozes, now } = useBellSnooze();
  const [lastOpened, setLastOpened] = useState(() => {
    try { const at = Number(localStorage.getItem(OPENED_KEY)); return Number.isFinite(at) && at >= 0 && at <= Date.now() ? at : 0; } catch { return 0; }
  });
  useEffect(() => {
    if (!open) return;
    const at = Date.now();
    setLastOpened(at);
    try { localStorage.setItem(OPENED_KEY, String(at)); } catch { /* Keep the marker for this session if storage is unavailable. */ }
  }, [open]);
  useEffect(() => {
    const sync = (event: StorageEvent) => {
      if (event.key !== OPENED_KEY) return;
      const at = Number(event.newValue);
      if (Number.isFinite(at) && at >= 0 && at <= Date.now()) setLastOpened(at);
    };
    window.addEventListener('storage', sync);
    return () => window.removeEventListener('storage', sync);
  }, []);
  const counts = bellCounts(bellItems(items, ownerNotes ?? notes), snoozes, now, lastOpened);
  const { needs, newCount: unread, badge: count, face } = counts;
  const [ringing, setRinging] = useState(false);
  const known = useRef(new Set(items.map(i=>i.id)));
  const first = useRef(ping);
  useEffect(() => {
    const arrived = attentionArrivals(items, known.current, Date.now()).length > 0;
    items.forEach(i=>known.current.add(i.id));
    if (!arrived && ping === first.current) return;
    first.current = ping;
    setRinging(true);
  }, [items, ping]);
  useEffect(() => {
    if (!ringing) return;
    const timer = setTimeout(() => setRinging(false), 1200);
    return () => clearTimeout(timer);
  }, [ringing]);
  const label = needs ? `${needs} need you` : unread ? `${unread} new` : "nothing new";
  return <button type="button" className="ab-attention-trigger ab-bell" data-needs={needs > 0 || undefined} data-ringing={ringing || undefined} data-testid="notifications-bell"
    aria-label={`Agent notifications · ${label}${counts.later ? ` · ${counts.later} later` : ''}`} title={`Notifications · ${label}`} aria-haspopup="dialog" aria-expanded={open} aria-controls="agent-notifications" onClick={onToggle}>
    {face ? <span className="ab-bell__face" data-agent={face.name}><AgentFace name={face.name} size={24} status="needs-shaan" /></span> : <BellIcon size={15} aria-hidden />}
    {count > 0 && <span className="ab-bell__count" aria-hidden>{count > 99 ? "99+" : count}</span>}
  </button>;
}
