import { useEffect, useSyncExternalStore } from 'react';
export type { Owner, OwnersSnapshot } from '../../../../services/node/src/owners';
import type { OwnersSnapshot } from '../../../../services/node/src/owners';
// t-0458: the owners he last saw paint at once after a reload; the stream's first message replaces them (this window only).
const SEEN = 'ab.owners-seen';
let snapshot: OwnersSnapshot | null = (() => { try { const v = JSON.parse(sessionStorage.getItem(SEEN) ?? 'null'); return Array.isArray(v?.owners) ? v : null; } catch { return null; } })();
const fleetListeners = new Set<() => void>();
const listeners = new Set<() => void>();
let stream: EventSource | null = null;
const emit = () => { for (const l of listeners) l(); };
function connect() {
  stream?.close(); stream = null;
  // No stream where there is no EventSource (the panel previews remove it): owners stay unread rather than crashing the view.
  if (document.visibilityState === 'hidden' || !listeners.size || typeof EventSource === 'undefined') return;
  stream = new EventSource(`/api/owners/events${fleetListeners.size ? '?mini=1' : ''}`);
  stream.onmessage = e => { try { snapshot = JSON.parse(e.data); emit(); if (!snapshot?.error) sessionStorage.setItem(SEEN, e.data); } catch {} };
  stream.onerror = () => { snapshot = { ...snapshot, owners: snapshot?.owners ?? [], warnings: snapshot?.warnings ?? [], error: 'Owner updates disconnected. Reconnecting automatically…' }; emit(); };
}
function subscribe(l: () => void, mini = false) {
  const wasFleet = fleetListeners.size > 0; if (mini) fleetListeners.add(l);
  listeners.add(l);
  if (listeners.size === 1) { document.addEventListener('visibilitychange', connect); connect(); }
  if (wasFleet !== (fleetListeners.size > 0) && listeners.size > 1) connect();
  return () => { const hadFleet = fleetListeners.size > 0; fleetListeners.delete(l); listeners.delete(l); if (listeners.size && hadFleet !== (fleetListeners.size > 0)) connect(); if (!listeners.size) { stream?.close(); stream = null; document.removeEventListener('visibilitychange', connect); } };
}
const subscribeFleet = (l: () => void) => subscribe(l, true);
export function useOwners(mini = false) { return useSyncExternalStore(mini ? subscribeFleet : subscribe, () => snapshot, () => null); }
export function openOwner(name: string) { window.dispatchEvent(new CustomEvent('ab:owner', { detail: { name } })); }
/** An owner's link (its card's `page`), opened as a tab beside the agents. */
export function openOwnerLink(url: string, title: string) { window.dispatchEvent(new CustomEvent('ab:owner-link', { detail: { url, title } })); }
export function useOwnerLinkNavigation(onOpen: (url: string, title: string) => void) {
  useEffect(() => { const handler = (e: Event) => { const d = (e as CustomEvent<{url: string; title: string}>).detail; if (d?.url) onOpen(d.url, d.title); }; window.addEventListener('ab:owner-link', handler); return () => window.removeEventListener('ab:owner-link', handler); }, [onOpen]);
}
export function useOwnerNavigation(onOpen: (name: string) => void) {
  useEffect(() => { const handler = (e: Event) => { const name = (e as CustomEvent<{name: string}>).detail?.name; if (name) onOpen(name); }; window.addEventListener('ab:owner', handler); return () => window.removeEventListener('ab:owner', handler); }, [onOpen]);
}
