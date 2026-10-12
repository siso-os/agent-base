/**
 * Track window boot states by SHA: when pages report successful boot (after drawing),
 * when they report crashes, and query what state we have for a build.
 */

const MAX_CRASHES_PER_SHA = 50;

export interface BootedState {
  sha: string;
  booted: boolean;
  at: string | null;
  crashes: Array<{ name: string; message: string; at: number }>;
}

// In-memory map of sha -> boot state
const bootStates = new Map<string, BootedState>();

/**
 * Record that a page has booted successfully.
 */
export function recordBooted(sha: string): void {
  if (!bootStates.has(sha)) {
    bootStates.set(sha, {
      sha,
      booted: false,
      at: null,
      crashes: [],
    });
  }
  const state = bootStates.get(sha)!;
  state.booted = true;
  state.at = new Date().toISOString();
}

/**
 * Record a crash reported by a page.
 */
export function recordCrash(sha: string, name: string, message: string): void {
  if (!bootStates.has(sha)) {
    bootStates.set(sha, {
      sha,
      booted: false,
      at: null,
      crashes: [],
    });
  }
  const state = bootStates.get(sha)!;
  if (state.crashes.length < MAX_CRASHES_PER_SHA) {
    state.crashes.push({ name, message, at: Date.now() });
  }
}

/**
 * Get the boot state for a SHA. Returns null if no state has been recorded.
 */
export function bootState(sha: string): BootedState | null {
  return bootStates.get(sha) ?? null;
}
