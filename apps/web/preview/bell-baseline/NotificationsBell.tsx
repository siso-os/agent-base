import { useEffect, useRef, useState } from "react";
import { BellIcon } from "lucide-react";
import { useOwnerNotes } from "../../src/components/OwnerLinkToast";

/**
 * The top bar's one notifications icon (Shaan, 6 Oct 23:35: "merge those notifications so it's just a notifications icon
 * which has a little pop up ... it pings when a new one comes through"). It replaces the "Updates · N" pill: the count is
 * what needs him plus the owners' unread notes, amber while anything needs him; a new note rings it once.
 */
export function NotificationsBell({ needs, open, onToggle }: { needs: number; open: boolean; onToggle: () => void }) {
  const { notes, ping } = useOwnerNotes();
  const unread = notes.filter(n => !n.read).length;
  const count = needs + unread;
  const [ringing, setRinging] = useState(false);
  const first = useRef(ping);
  useEffect(() => {
    if (ping === first.current) return;
    setRinging(true);
    const t = setTimeout(() => setRinging(false), 1200);
    return () => clearTimeout(t);
  }, [ping]);
  const label = needs ? `${needs} need you` : unread ? `${unread} new` : "nothing new";
  return <button type="button" className="ab-attention-trigger ab-bell" data-needs={needs > 0 || undefined} data-ringing={ringing || undefined} data-testid="notifications-bell"
    aria-label="Agent notifications" title={`Notifications · ${label}`} aria-haspopup="dialog" aria-expanded={open} aria-controls="agent-notifications" onClick={onToggle}>
    <BellIcon size={15} aria-hidden />
    {count > 0 && <span className="ab-bell__count" aria-hidden>{count > 99 ? "99+" : count}</span>}
  </button>;
}
