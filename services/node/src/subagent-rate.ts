/** Output counters from source events, never total/input/cache tokens or browser poll timing. */
export type OutputSample = { at: number; tokens: number };
export const OUTPUT_RATE_WINDOW_MS = 30_000;
export function recentOutputRate(samples: readonly OutputSample[], now = Date.now()): number | undefined {
  let previous: OutputSample | undefined, output = 0, observedMs = 0;
  for (const sample of samples) {
    if (!Number.isFinite(sample.at) || !Number.isFinite(sample.tokens) || sample.tokens < 0 || sample.at > now) continue;
    if (previous && sample.at > previous.at) {
      if (sample.tokens < previous.tokens) { output = 0; observedMs = 0; }
      else {
        const elapsed = sample.at - previous.at;
        const overlap = Math.max(0, sample.at - Math.max(previous.at, now - OUTPUT_RATE_WINDOW_MS));
        // A long reporting gap cannot establish current throughput.
        if (elapsed <= OUTPUT_RATE_WINDOW_MS * 2 && overlap > 0) {
          output += (sample.tokens - previous.tokens) * overlap / elapsed;
          observedMs += overlap;
        }
      }
    }
    // Repeated timestamps can carry a revised cumulative counter, but add no time.
    if (!previous || sample.at >= previous.at) previous = sample;
  }
  if (!previous || !observedMs) return undefined;
  const quietMs = Math.min(OUTPUT_RATE_WINDOW_MS, Math.max(0, now - previous.at));
  return output / ((observedMs + quietMs) / 1000);
}
