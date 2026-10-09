import { useEffect, useState } from "react";
import { useSharedState } from "./poll";

/** /api/releases (services/node/src/releases.ts): each deploy that went live, newest first, and what is not live yet. */
export type Commit = { sha: string; subject: string; line: string; author: string; tag: string | null; at: string };
/** The owner's note for a release (services/node/releases/notes.jsonl): why, in his words; what changed; how to see it. */
export type ReleaseEvidence = { state: "available" | "unavailable"; pairs: { id: string; title: string; before: string; after: string; beforeSha: string; afterSha: string; viewport?: { width: number; height: number } }[]; reason?: string };
export type Note = { sha: string; title: string; why?: string; what?: string[]; see?: string };
export type Release = { version: number; at: string; sha: string; kinds: string[]; commits: Commit[]; note?: Note; evidence?: ReleaseEvidence };
export type Releases = { releases: Release[]; pending: { ref: string | null; commits: Commit[]; note?: Note } };

const SEEN_KEY = "agent-base:whats-new.seen";

/** The newest release he has seen on the What's new page (its sha), or null before his first visit. */
export function lastSeen(): string | null {
  try { return localStorage.getItem(SEEN_KEY); } catch { return null; }
}
export function markSeen(sha: string) {
  try { localStorage.setItem(SEEN_KEY, sha); } catch { /* no storage: the divider just stays */ }
  window.dispatchEvent(new Event("ab:whats-new-seen"));
}

/** How many releases are newer than the one he last saw: all of them when that one has dropped off the list; none before a first visit. */
export function unseenCount(releases: Release[], seen: string | null): number {
  if (!seen) return 0;
  const i = releases.findIndex((r) => r.sha.startsWith(seen) || seen.startsWith(r.sha));
  return i < 0 ? releases.length : i;
}

export const useReleasesState = () => useSharedState<Releases>("/api/releases", 60_000);
export const useReleases = () => useReleasesState().data;

/** /api/not-landed (services/node/src/landing.ts): origin branches holding commits main lacks, and live behind main. */
export type Branch = { branch: string; lane: string | null; commits: number; at: string; author: string; subject: string; sha: string; why?: string };
/** `branches` is work someone means to land (an open PR, or its lane's owner live); `parked` the rest, each with its reason. */
export type Landing = { branches: Branch[]; parked?: Branch[]; live: { sha: string; main: string | null; behind: number | null }; fetchedAt: string | null };
export const useLandingState = () => useSharedState<Landing>("/api/not-landed", 60_000);
export const useLanding = () => useLandingState().data;

/**
 * What the ship queue is doing now (/api/ship lanes; 18 of his 82 messages on 4-5 Oct asked "is it live"): the newest lane
 * built in the last 3 hours that is still testing (queued) or deploying (landed), else null. Live is the reload pill's job.
 */
type ShipLane = { id: string; sha: string; state: string; built_at: string | null };
export type Shipping = { state: "testing" | "deploying"; sha: string; since: string | null };
export function shippingOf(lanes: ShipLane[], now = Date.now()): Shipping | null {
  const lane = lanes.filter((l) => ["queued", "merged", "landed"].includes(l.state) && now >= Date.parse(l.built_at ?? "") && now - Date.parse(l.built_at ?? "") < 3 * 3600_000).at(-1);
  return lane ? { state: lane.state === "landed" ? "deploying" : "testing", sha: lane.sha, since: lane.built_at } : null;
}
export function useShippingState(): { data: Shipping | null; error: string | null } {
  const { data, error } = useSharedState<{ lanes: ShipLane[] }>("/api/ship", 30_000);
  return { data: data && !error ? shippingOf(data.lanes) : null, error };
}
export function useShipping(): Shipping | null {
  return useShippingState().data;
}

/** The count badge on the way in (the Shipped card, Stats): releases since his last visit; it clears when he visits. */
export function useUnseenCount(): number {
  const data = useReleases();
  const [seen, setSeen] = useState(lastSeen);
  useEffect(() => {
    const on = () => setSeen(lastSeen());
    window.addEventListener("ab:whats-new-seen", on);
    return () => window.removeEventListener("ab:whats-new-seen", on);
  }, []);
  return data ? unseenCount(data.releases, seen) : 0;
}

/** Ask the app to open the What's new page (App listens; the Shipped card and Stats send it). */
export const openWhatsNew = () => window.dispatchEvent(new Event("ab:whats-new"));

const WHAT: Record<string, string> = { web: "App", node: "Node", desktop: "Desktop app" };
export const kindLabel = (k: string) => WHAT[k] ?? k;

/** "just now", "12 minutes ago", "3 hours ago", "yesterday at 14:05", "Tuesday at 09:12", "28 Sep at 18:40". */
export function whenWords(iso: string, now = Date.now()): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "Time unavailable";
  if (t > now) return `Future timestamp · ${new Date(t).toLocaleString()}`;
  const m = Math.round((now - t) / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m} minute${m === 1 ? "" : "s"} ago`;
  if (m < 6 * 60) return `${Math.round(m / 60)} hour${Math.round(m / 60) === 1 ? "" : "s"} ago`;
  const d = new Date(t);
  const clock = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((day(new Date(now)) - day(d)) / 86_400_000);
  if (days <= 0) return `today at ${clock}`;
  if (days === 1) return `yesterday at ${clock}`;
  if (days < 7) return `${d.toLocaleDateString([], { weekday: "long" })} at ${clock}`;
  return `${d.toLocaleDateString([], { day: "numeric", month: "short" })} at ${clock}`;
}
