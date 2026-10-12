/** OAuth credentials stay inside this reader. Only timestamped usage is cached. */
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
const run = promisify(execFile);
// Two minutes (Shaan, 10 Oct: usage "doesn't update as often as it should"); the panel's ↻ reads it now (POST /api/claude-usage).
export const USAGE_INTERVAL = 120_000;
export type UsageWindow = { pct: number; resetsAt: number | null };
export type ClaudeUsage = { fiveHour: UsageWindow; week: UsageWindow; at: number; stale: boolean; ageMs: number };
export const isReadOnlyClaudeProfile = (dir: string) => /(?:^|[\\/])\.?claude-fahmy(?:[\\/]|$)/i.test(dir);
export const defaultClaudeDir = () => process.env.CLAUDE_CONFIG_DIR ?? path.join(homedir(), ".config/claude-siso-3");
/** Claude Code: NFC config path, SHA256 first eight hex characters; default home has no suffix. */
export function credentialService(dir: string, home = homedir()) {
  const secure = process.env.CLAUDE_SECURESTORAGE_CONFIG_DIR;
  const config = path.resolve(dir);
  const effective = secure === undefined ? config : path.resolve(secure || path.join(home, ".claude"));
  // A process-wide override must never be cached under a different account's profile.
  if (effective !== config) throw new Error("Credential profile conflicts with requested account");
  const plain = config === path.join(home, ".claude");
  return `Claude Code-credentials${plain ? "" : `-${createHash("sha256").update(config.normalize("NFC")).digest("hex").slice(0, 8)}`}`;
}
export async function readClaudeUsage(dir: string): Promise<{ fiveHour: UsageWindow; week: UsageWindow }> {
  if (isReadOnlyClaudeProfile(dir) || isReadOnlyClaudeProfile(process.env.CLAUDE_SECURESTORAGE_CONFIG_DIR ?? "")) throw new Error("Read-only account: not read");
  let token: unknown;
  try {
    const { stdout } = await run("security", ["find-generic-password", "-s", credentialService(dir), "-w"], { timeout: 5000 });
    token = JSON.parse(stdout).claudeAiOauth?.accessToken;
  } catch { throw new Error("Claude credentials unavailable"); }
  if (typeof token !== "string" || !token) throw new Error("Claude credentials unavailable");
  const response = await fetch("https://api.anthropic.com/api/oauth/usage", { headers: { Authorization: `Bearer ${token}`, "anthropic-beta": "oauth-2025-04-20" }, signal: AbortSignal.timeout(15_000), redirect: "error" });
  if (!response.ok) throw new Error(`Claude usage HTTP ${response.status}`);
  const body = await response.json() as any;
  const window = (value: any): UsageWindow => {
    if (typeof value?.utilization !== "number" || !Number.isFinite(value.utilization) || value.utilization < 0 || value.utilization > 100) throw new Error("Invalid Claude usage");
    return { pct: value.utilization, resetsAt: typeof value.resets_at === "string" && Number.isFinite(Date.parse(value.resets_at)) ? Date.parse(value.resets_at) : null };
  };
  return { fiveHour: window(body.five_hour), week: window(body.seven_day) };
}
/** A failed read in his words, from a fixed list (Shaan, 10 Oct: "My Fuse Heritage one isn't showing stuff"): the card says
 * why an account has no usage instead of a blank. Only our own error texts are matched; nothing from a response or token. */
export function usageFailure(error: unknown): string {
  const text = error instanceof Error ? error.message : "";
  if (text === "Claude credentials unavailable") return "no Claude sign-in found for this account on the laptop";
  if (text === "Read-only account: not read") return "read-only: not read";
  const http = /^Claude usage HTTP (\d{3})$/.exec(text)?.[1];
  if (http === "401" || http === "403") return "its Claude sign-in has expired: open a chat on this account once to renew it";
  if (http === "429") return "Anthropic is rate-limiting the usage reading; it retries every 2 min";
  if (http) return `Anthropic answered HTTP ${http}`;
  if (text === "Invalid Claude usage") return "Anthropic's answer had no usage in it";
  return "Anthropic did not answer";
}
type Seat = Omit<ClaudeUsage, "stale" | "ageMs">;
const SEAT_MAX_AGE = 10 * 60_000;
/**
 * The newest seat reading the owner hosts on each login wrote (`rateLimits` in hosts/*.json, from the SDK's /usage every
 * 2 min). Shaan, 10 Oct: "My Fuse Heritage one isn't showing stuff": fuzeheritage runs 7 hosts, each reading the same
 * OAuth usage endpoint, so the node's own read was answered 429 every time while the hosts held a reading 0-2 min old.
 * Files are re-parsed only when they change.
 */
export function createSeatReadings(dir = process.env.AB_HOSTS_DIR ?? path.join(homedir(), ".local/state/agent-base/hosts"), now = Date.now) {
  const parsed = new Map<string, { stamp: string; config: string | null; seat: Seat | null }>();
  let at = 0, newest = new Map<string, Seat>();
  const window = (w: any): UsageWindow | null => w && typeof w.used_percentage === "number" && Number.isFinite(w.used_percentage) && w.used_percentage >= 0 && w.used_percentage <= 100
    ? { pct: w.used_percentage, resetsAt: typeof w.resets_at === "string" && Number.isFinite(Date.parse(w.resets_at)) ? Date.parse(w.resets_at) : null } : null;
  return (config: string): Seat | null => {
    if (now() - at >= 5000) {
      at = now(); newest = new Map();
      let names: string[] = [];
      try { names = readdirSync(dir).filter(n => n.endsWith(".json")); } catch { /* no hosts */ }
      for (const name of names) {
        const file = path.join(dir, name);
        let stamp = "";
        try { const st = statSync(file); if (st.size > 1 << 20) continue; stamp = `${st.mtimeMs}:${st.size}`; } catch { continue; }
        let row = parsed.get(file);
        if (row?.stamp !== stamp) {
          row = { stamp, config: null, seat: null };
          try {
            const h = JSON.parse(readFileSync(file, "utf8")), r = h?.rateLimits;
            const five = window(r?.five_hour), week = window(r?.seven_day);
            row.config = typeof h?.configDir === "string" ? path.resolve(h.configDir) : null;
            if (five && week && Number.isFinite(r?.at) && r.at <= now() + 60_000) row.seat = { fiveHour: five, week, at: r.at };
          } catch { /* a host mid-write: next pass */ }
          parsed.set(file, row);
        }
        if (row.config && row.seat && row.seat.at > (newest.get(row.config)?.at ?? -1)) newest.set(row.config, row.seat);
      }
    }
    // Only a live host's reading: a stopped host's file keeps its last one for days (a 66 h old week of 50% showed for a
    // login really at 83%).
    const seat = newest.get(path.resolve(config));
    return seat && now() - seat.at <= SEAT_MAX_AGE ? seat : null;
  };
}
export class ClaudeUsagePoller {
  private good = new Map<string, Omit<ClaudeUsage, "stale" | "ageMs">>();
  private failed = new Set<string>();
  private reasons = new Map<string, string>();
  private pending = new Map<string, Promise<void>>();
  private read: typeof readClaudeUsage;
  private now: () => number;
  private seats: (dir: string) => Seat | null;
  constructor(read = readClaudeUsage, now = Date.now, seats: (dir: string) => Seat | null = () => null) { this.read = read; this.now = now; this.seats = seats; }
  /** The newer of this node's own read and the hosts' reading of the same login. */
  get(dir: string): ClaudeUsage | null {
    const own = this.good.get(dir), seat = isReadOnlyClaudeProfile(dir) ? null : this.seats(dir);
    const value = seat && (!own || seat.at > own.at) ? seat : own;
    if (!value) return null;
    const ageMs = Math.max(0, this.now() - value.at);
    return { ...value, ageMs, stale: (value === own && this.failed.has(dir)) || ageMs > USAGE_INTERVAL + 30_000 };
  }
  /** Why the last read failed, in fixed words (never the exception's own text), or null after a good read. */
  why(dir: string): string | null { return this.reasons.get(dir) ?? null; }
  refresh(dir: string): Promise<void> {
    if (isReadOnlyClaudeProfile(dir)) return Promise.resolve();
    // A host read this login within the poll interval: one more read of the same endpoint only adds to its 429s.
    const seat = this.seats(dir);
    if (seat && this.now() - seat.at < USAGE_INTERVAL) { this.reasons.delete(dir); return Promise.resolve(); }
    const pending = this.pending.get(dir);
    if (pending) return pending;
    const task = (async () => {
      try { this.good.set(dir, { ...await this.read(dir), at: this.now() }); this.failed.delete(dir); this.reasons.delete(dir); }
      catch (error) { this.failed.add(dir); this.reasons.set(dir, usageFailure(error)); } // Never log credential-bearing exceptions.
    })().finally(() => this.pending.delete(dir));
    this.pending.set(dir, task);
    return task;
  }
  start(dirs: () => string[]) {
    const poll = () => { for (const dir of new Set(dirs())) void this.refresh(dir); };
    poll();
    const timer = setInterval(poll, USAGE_INTERVAL); timer.unref();
    return () => clearInterval(timer);
  }
}
export const claudeUsage = new ClaudeUsagePoller(readClaudeUsage, Date.now, createSeatReadings());
export function usageHud<T extends { fiveHour: UsageWindow | null; week: UsageWindow | null; at: number | null }>(hud: T, dir: string) {
  const live = claudeUsage.get(dir);
  return { ...hud, fiveHour: live?.fiveHour ?? hud.fiveHour, week: live?.week ?? hud.week, limitsAt: live?.at ?? hud.at, limitsStale: live?.stale ?? true };
}
/** Overlay even warm disk snapshots: usage freshness must not follow the token scan cache. */
export function usageAccounts(snapshot: any, home: string) {
  for (const account of snapshot.accounts ?? []) {
    if (account.kind !== "claude") continue;
    const id = account.id.slice(7);
    const dir = id.startsWith(".") ? path.join(home, id) : path.join(home, ".config", id);
    const live = claudeUsage.get(dir);
    if (live) account.limits = { fiveHour: { usedPct: live.fiveHour.pct, resetsAt: live.fiveHour.resetsAt, expired: live.fiveHour.resetsAt !== null && live.fiveHour.resetsAt < Date.now() }, weekly: { usedPct: live.week.pct, resetsAt: live.week.resetsAt, expired: live.week.resetsAt !== null && live.week.resetsAt < Date.now() }, at: live.at, stale: live.stale, ageMs: live.ageMs, source: "live Claude OAuth usage" };
    else if (account.limits) account.limits = { ...account.limits, stale: true, ageMs: Math.max(0, Date.now() - account.limits.at) };
  }
  return snapshot;
}
