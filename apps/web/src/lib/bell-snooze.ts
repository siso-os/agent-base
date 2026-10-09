import { useEffect, useSyncExternalStore } from 'react';
import { parseSnoozes, type Snoozes } from './bell';
const KEY = 'ab.bell.later.v1';
const listeners = new Set<() => void>();
let snapshot: Snoozes = {};
try { snapshot = parseSnoozes(localStorage.getItem(KEY), Date.now()); } catch { /* Storage unavailable; session-only shelf. */ }
let now = Date.now();
let timer: ReturnType<typeof setInterval> | undefined;
const emit = () => listeners.forEach(fn => fn());
function subscribe(fn: () => void) {
  listeners.add(fn);
  if (!timer) timer = setInterval(() => { now = Date.now(); emit(); }, 1000);
  return () => { listeners.delete(fn); if (!listeners.size) { clearInterval(timer); timer = undefined; } };
}
export function useBellSnooze() {
  const snoozes = useSyncExternalStore(subscribe, () => snapshot);
  const clock = useSyncExternalStore(subscribe, () => now);
  useEffect(() => {
    const sync = (event: StorageEvent) => { if (event.key === KEY) { snapshot = parseSnoozes(event.newValue, Date.now()); emit(); } };
    window.addEventListener('storage', sync); return () => window.removeEventListener('storage', sync);
  }, []);
  function snooze(identity: string, minutes: number) {
    snapshot = { ...parseSnoozes(JSON.stringify(snapshot), Date.now()) };
    if (minutes) snapshot[identity] = Date.now() + minutes * 60_000; else delete snapshot[identity];
    try { localStorage.setItem(KEY, JSON.stringify(snapshot)); } catch { /* Still visible for this session. */ }
    now = Date.now(); emit();
  }
  return { snoozes, now: clock, snooze };
}
