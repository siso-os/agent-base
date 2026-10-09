import { useSyncExternalStore } from 'react';
import { parseRemoteInventory, type RemoteInventorySnapshot } from './remote-inventory';
import { every } from './poll';

type Reading = { data: RemoteInventorySnapshot | null; busy: boolean; failed: boolean; now: number };
const serverReading: Reading = { data: null, busy: true, failed: false, now: 0 };
let reading: Reading = { data: null, busy: true, failed: false, now: Date.now() };
const subscribers = new Set<() => void>();
let stop: (() => void) | null = null, active: AbortController | null = null, generation = 0, pending: Promise<void> | null = null;
const publish = (next: Partial<Reading>) => { reading = { ...reading, ...next }; for (const callback of subscribers) callback(); };
async function read() {
  const controller = new AbortController(); active = controller;
  const request = ++generation;
  publish({ busy: true, now: Date.now() });
  const timeout = window.setTimeout(() => controller.abort(), 20_000);
  try {
    const response = await fetch('/api/remote/agents', { signal: controller.signal, cache: 'no-store' });
    if (!response.ok) throw new Error('Unavailable');
    const data = parseRemoteInventory(await response.json());
    if (request === generation) publish({ data, failed: false });
  } catch { if (request === generation) publish({ failed: true }); }
  finally {
    window.clearTimeout(timeout);
    if (request === generation) { active = null; pending = null; publish({ busy: false, now: Date.now() }); }
  }
}
const refresh = () => pending ?? (pending = read());
function subscribe(callback: () => void) {
  subscribers.add(callback);
  stop ??= every(() => void refresh(), 30_000);
  return () => {
    subscribers.delete(callback);
    if (subscribers.size) return;
    stop?.(); stop = null; generation++; active?.abort(); active = null; pending = null;
    reading = { ...reading, busy: false };
  };
}
/** One bounded, visible-window read shared by the sidebar, Zero view and Servers panel. */
export function useRemoteInventory() {
  return { ...useSyncExternalStore(subscribe, () => reading, () => serverReading), refresh };
}
