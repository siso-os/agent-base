// t-0567: the Agent Base task board's one store (services/node/src/board.ts), and his writes to it.
import { refresh, useSharedState } from './poll';

export type BoardCard = {
  id: string; kind: 'task' | 'idea'; title: string; his: string; at: string | null; stage: string; priority?: string;
  by?: string; spec?: boolean; folds?: string[]; link?: { label: string; url: string } | null; live_at?: string | null;
};
export type LandedGroup = { version: number | null; at: string | null; sha: string | null; cards: BoardCard[] };
export type Board = {
  updated: string; queue: number; size: number; days: number;
  sprint: { status: string; summary: string; next: string; updated: string } | null;
  lanes: { ideas: BoardCard[]; specced: BoardCard[]; todo: BoardCard[]; building: BoardCard[]; landed: LandedGroup[] };
};
export type BoardWrite =
  | { op: 'tell'; words: string; kind: 'task' | 'idea' }
  | { op: 'make-task'; id: string }
  | { op: 'todo'; id: string; on: boolean }
  | { op: 'order'; ids: string[] };

export const boardUrl = (days = 7) => days === 7 ? '/api/board/agent-base' : `/api/board/agent-base?days=${days}`;

/** null reads nothing (a page that is not Agent Base's). */
export function useBoard(days: number | null = 7): { data: Board | null; error: string | null } {
  const r = useSharedState<Board>(days === null ? null : boardUrl(days), 10000);
  // An answer without lanes (an old node, a proxy's page) is no board, not a crash.
  const ok = r.data && typeof r.data === 'object' && r.data.lanes && Array.isArray(r.data.lanes.todo);
  return { data: ok ? r.data : null, error: r.error ?? (r.data && !ok ? 'The node has no task board yet' : null) };
}

/** One write; on success every view of the board reads it again at once. */
export async function writeBoard(write: BoardWrite, days = 7): Promise<{ ok: true; id?: string; lane?: string } | { ok: false; error: string }> {
  try {
    const r = await fetch('/api/board/agent-base', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(write) });
    const body = await r.json().catch(() => ({})) as { ok?: boolean; error?: string; id?: string; lane?: string };
    if (!r.ok || body.ok !== true) return { ok: false, error: body.error ?? `The node said ${r.status}` };
    await Promise.all([...new Set([boardUrl(), boardUrl(days)])].map(u => refresh(u)));
    return { ok: true, id: body.id, lane: body.lane };
  } catch {
    return { ok: false, error: 'No answer from the node' };
  }
}

/** "3h", "2d": how long a card has waited. */
export function age(at: string | null, now = Date.now()) {
  const t = Date.parse(at ?? '');
  if (!Number.isFinite(t)) return '';
  const m = Math.max(0, Math.round((now - t) / 60000));
  return m < 60 ? `${m}m` : m < 60 * 48 ? `${Math.round(m / 60)}h` : `${Math.round(m / 1440)}d`;
}

export const when = (at: string | null) => Number.isFinite(Date.parse(at ?? '')) ? new Date(at!).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '';
