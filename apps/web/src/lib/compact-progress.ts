/**
 * Progress calculation and labeling for compacting activity.
 * Based on measured durations from ~/.local/state/self-compact/log.jsonl (n=118):
 * - p50: 78 s (78000 ms)
 * - p90: 136 s (136000 ms)
 */

const P50_MS = 78000;
const P90_MS = 136000;

/**
 * Calculate progress fill fraction for the compacting bar.
 * Formula: fill = min(0.9, 1 - exp(-elapsed / (p50/2.3)))
 * Reaches ~90% at p50, then creeps. Never reaches 100% until the end event.
 *
 * @param elapsedMs Time elapsed since compaction started (in milliseconds)
 * @param p50Ms Typical duration at 50th percentile (default 78000 ms)
 * @returns Fill fraction 0-1, clamped to max 0.9
 */
export function progress(elapsedMs: number, p50Ms = P50_MS): number {
  const clamped = Math.max(0, elapsedMs);
  const fill = 1 - Math.exp(-clamped / (p50Ms / 2.3));
  return Math.min(0.9, fill);
}

/**
 * Format elapsed time as "m:ss"
 */
function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

/**
 * Generate label text for the compacting record.
 * Shows "Compacting · m:ss · usually about 1:18" normally.
 * Past p90 (136 s), shows "Compacting · m:ss · longer than usual" in amber.
 *
 * @param elapsedMs Time elapsed since compaction started (in milliseconds)
 * @param p50Ms Typical duration at 50th percentile (default 78000 ms)
 * @param p90Ms Long threshold at 90th percentile (default 136000 ms)
 * @returns Label text string
 */
export function label(elapsedMs: number, p50Ms = P50_MS, p90Ms = P90_MS): string {
  const clamped = Math.max(0, elapsedMs);
  const elapsed = formatElapsed(clamped);
  const typical = formatElapsed(p50Ms);

  if (clamped >= p90Ms) {
    return `Compacting · ${elapsed} · longer than usual`;
  }
  return `Compacting · ${elapsed} · usually about ${typical}`;
}
