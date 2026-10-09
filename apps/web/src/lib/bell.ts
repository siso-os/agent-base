import type { Attention } from './attention';
import type { OwnerNote } from '../components/OwnerLinkToast';
import type { AgentStackNotification } from '../components/AgentNotificationStack';

export type BellItem = AgentStackNotification & { phase: 'needs' | 'outcome'; identity: string; attention?: Attention; note?: OwnerNote };
export type BellShelf = 'all' | 'needs' | 'outcomes' | 'later';
export type Snoozes = Record<string, number>;
export function attentionIdentity(i: Attention) { return JSON.stringify([i.id, i.ref.hostInstanceId, i.ref.sessionId, i.ref.runId, i.requestId, i.revision, i.phase]); }
export function attentionArrivals(items: readonly Attention[], known: ReadonlySet<string>, now: number) {
  return items.filter(i => !known.has(i.id) && i.buzz && i.phase !== 'resolved' && now - Date.parse(i.at) >= 0 && now - Date.parse(i.at) < 120_000);
}
export function bellItems(items: readonly Attention[], notes: readonly OwnerNote[] = []): BellItem[] {
  const owners: BellItem[] = notes.map(n => {
    return { id: `owner:${n.key}`, identity: JSON.stringify(['owner', n.key, n.updated]), at: new Date(n.at).toISOString(), title: n.subtitle,
      read: n.read, owner: { id: n.name, name: n.name, project: n.workspace }, note: n,
      phase: 'outcome' }; // Retained owner notes are history, not proof of a current request.
  });
  return [...items.map((i): BellItem => ({ id: i.id, identity: attentionIdentity(i),
    at: i.at, title: i.headline, read: i.read, owner: { id: i.agentId ?? i.ref.hostInstanceId, name: i.agentName }, attention: i,
    phase: i.phase === 'needs' ? 'needs' : 'outcome',
    ...(i.phase === 'resolved' ? { body: 'Request ended · no decision is pending.' } : {}) })), ...owners].sort((a,b) => {
      const zero = (n?: string) => /^(a0|agent[ -]?zero)$/i.test(n ?? '') ? 1 : 0;
      return zero(b.owner?.name) - zero(a.owner?.name) || b.at.localeCompare(a.at);
    });
}
export function isLater(item: BellItem, snoozes: Snoozes, now: number) { return (snoozes[item.identity] ?? 0) > now; }
export function bellCounts(items: readonly BellItem[], snoozes: Snoozes, now: number, lastOpened = 0) {
  const active = items.filter(i => !isLater(i, snoozes, now));
  const needs = active.filter(i => i.phase === 'needs');
  const outcomes = active.filter(i => i.phase === 'outcome');
  const fresh = active.filter(i => {
    const at = Date.parse(i.at);
    return !i.read && at > lastOpened && at > now - 24 * 3600_000 && at <= now;
  });
  return { needs: needs.length, outcomes: outcomes.length, later: items.length - active.length,
    unread: active.filter(i => !i.read).length, newCount: fresh.length,
    badge: needs.length + fresh.filter(i => i.phase === 'outcome').length, face: needs[0]?.owner };
}
export function visibleBellItems(items: readonly BellItem[], snoozes: Snoozes, now: number, shelf: BellShelf, unread: boolean) {
  return items.filter(i => (shelf === 'later' ? isLater(i, snoozes, now) : !isLater(i, snoozes, now)
    && (shelf === 'all' || i.phase === (shelf === 'needs' ? 'needs' : 'outcome'))) && (!unread || !i.read));
}
export function parseSnoozes(raw: string | null, now: number): Snoozes {
  try { const value = JSON.parse(raw ?? '{}'); return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, number] => entry[0].length < 2000 && typeof entry[1] === 'number' && entry[1] > now && entry[1] <= now + 4 * 3600_000)); } catch { return {}; }
}
