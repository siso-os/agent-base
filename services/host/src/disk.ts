/**
 * t-0504: a full disk must never kill a host mid-run (7 Oct it took STREAMING, MODEL-APP and SISO-AGENCY down: a state
 * write threw ENOSPC out of the SDK loop). Memory is the truth; files are snapshots of it. `persist(key, write)` runs a
 * snapshot write; on ENOSPC it keeps the newest write for that key and retries every 5 s until the disk has room, and the
 * caller carries on. Any other error still throws, as before.
 */
import { rmSync, statfsSync } from "node:fs";
import { homedir } from "node:os";

/** Below this the agent says the disk is low (Shaan's ask: warn below 5 GB). */
export const LOW_BYTES = 5 * 1024 ** 3;
const RETRY_MS = 5000;

export type DiskState = { full: boolean; low: boolean; freeBytes: number | null; since: number | null };
const pending = new Map<string, () => void>();
const listeners = new Set<(s: DiskState) => void>();
let fullSince: number | null = null;
let freeBytes: number | null = null;
let checkedAt = 0;
let timer: NodeJS.Timeout | null = null;

export const isNoSpace = (e: unknown) => ["ENOSPC", "EDQUOT"].includes((e as NodeJS.ErrnoException | null)?.code ?? "");

function free(): number | null {
  if (Date.now() - checkedAt < 30_000) return freeBytes;
  checkedAt = Date.now();
  try { const s = statfsSync(process.env.AB_DISK_PATH ?? homedir()); freeBytes = Number(s.bavail) * Number(s.bsize); } catch { /* keep the last */ }
  return freeBytes;
}
export function diskState(): DiskState {
  const f = free();
  return { full: fullSince !== null, low: fullSince !== null || (f !== null && f < LOW_BYTES), freeBytes: f, since: fullSince };
}
let watch: NodeJS.Timeout | null = null;
let lastLow: boolean | null = null;
/** Listen for full / low / room again. The first listener starts a 60 s free-space look (unref'd, statfs only). */
export function onDisk(fn: (s: DiskState) => void) {
  listeners.add(fn);
  if (!watch) {
    lastLow = diskState().low;
    if (lastLow) setTimeout(() => fn(diskState()), 0);
    watch = setInterval(() => { checkedAt = 0; const low = diskState().low; if (low !== lastLow) changed(); }, 60_000);
    watch.unref();
  }
  return () => listeners.delete(fn);
}
function changed() { checkedAt = 0; const s = diskState(); lastLow = s.low; for (const fn of listeners) { try { fn(s); } catch { /* a listener must not undo the guard */ } } }

/** A write failed for lack of space somewhere we could not wrap: mark the disk full so the agent says so. */
export function noteNoSpace() { if (fullSince === null) { fullSince = Date.now(); changed(); } schedule(); }

export function persist(key: string, write: () => void): boolean {
  try {
    write();
    pending.delete(key);
    if (fullSince !== null && pending.size === 0) { fullSince = null; changed(); }
    return true;
  } catch (e) {
    if (!isNoSpace(e)) throw e;
    pending.set(key, write);
    noteNoSpace();
    return false;
  }
}

function schedule() {
  if (timer) return;
  timer = setTimeout(() => {
    timer = null;
    for (const [key, write] of [...pending]) { if (pending.get(key) === write) persist(key, write); }
    if (pending.size) schedule();
    else if (fullSince !== null) {
      // Nothing of ours is waiting, but something failed for space: clear only once the disk has room again.
      checkedAt = 0; const f = free();
      if (f === null || f > 64 * 1024 ** 2) { fullSince = null; changed(); } else schedule();
    }
  }, Number(process.env.AB_DISK_RETRY_MS) || RETRY_MS);
  timer.unref();
}

/** What the agent says in its chat when the disk fills, runs low, or has room again. */
export function diskMessage(d: DiskState) {
  const gb = d.freeBytes === null ? "" : ` (${(d.freeBytes / 1024 ** 3).toFixed(1)} GB free)`;
  return d.full
    ? `Disk full${gb}. Nothing is lost: I'm keeping my state in memory and saving it again every 5 s. Free some space and I carry on.`
    : d.low ? `Disk low${gb}: under 5 GB. Free some space before it fills.` : `Disk has room again${gb}; my state is saved.`;
}

/** Remove a half-written temp file after a failed write; never throws. */
export function dropTemp(file: string) { try { rmSync(file, { force: true }); } catch { /* best effort */ } }

/** Pending snapshot writes, for tests and for a clean exit. */
export const pendingWrites = () => pending.size;
