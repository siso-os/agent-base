import { useSyncExternalStore } from 'react';

type CommandState = { busy: boolean; blocked: boolean; error: string };
const IDLE: CommandState = { busy: false, blocked: false, error: '' };
const KEY = 'ab.attention.commands.v1';
const states = new Map<string, CommandState>();
const listeners = new Set<() => void>();
// A remount, shelf change or reload cannot establish that an uncertain command was not delivered.
try {
  const saved = JSON.parse(sessionStorage.getItem(KEY) ?? '{}');
  for (const [identity, state] of Object.entries(saved)) {
    if (state && typeof state === 'object' && ('busy' in state && state.busy || 'blocked' in state && state.blocked))
      states.set(identity, { busy: false, blocked: true, error: 'Previous delivery is unconfirmed. Open the chat to verify before sending again.' });
  }
} catch { /* Session persistence unavailable; the mounted app still shares the guard. */ }
export const attentionCommandState = (identity: string) => states.get(identity) ?? IDLE;
function persist() {
  try { sessionStorage.setItem(KEY, JSON.stringify(Object.fromEntries([...states].filter(([, state]) => state.busy || state.blocked).map(([key, state]) => [key, {busy:state.busy,blocked:state.blocked}])))); } catch { /* Keep in-memory safety when storage is unavailable. */ }
}
/** Call only with a healthy authoritative feed; stale snapshots cannot clear delivery uncertainty. */
export function reconcileAttentionCommands(identities: Iterable<string>) {
  const current = new Set(identities);
  let changed = false;
  for (const key of states.keys()) if (!current.has(key)) { states.delete(key); changed = true; }
  if (changed) { persist(); listeners.forEach(listener => listener()); }
}
export function updateAttentionCommand(identity: string, patch: Partial<CommandState>) {
  const next = { ...attentionCommandState(identity), ...patch };
  if (!next.busy && !next.blocked && !next.error) states.delete(identity); else states.set(identity, next);
  persist();
  listeners.forEach(listener => listener());
}
export function useAttentionCommandState(identity: string) {
  return useSyncExternalStore(listener => { listeners.add(listener); return () => { listeners.delete(listener); }; }, () => attentionCommandState(identity));
}
