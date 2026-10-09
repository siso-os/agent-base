/** OAuth credentials stay inside this reader. Only timestamped usage is cached. */
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { homedir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
const run = promisify(execFile);
export const USAGE_INTERVAL = 300_000;
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
export class ClaudeUsagePoller {
  private good = new Map<string, Omit<ClaudeUsage, "stale" | "ageMs">>();
  private failed = new Set<string>();
  private pending = new Map<string, Promise<void>>();
  private read: typeof readClaudeUsage;
  private now: () => number;
  constructor(read = readClaudeUsage, now = Date.now) { this.read = read; this.now = now; }
  get(dir: string): ClaudeUsage | null {
    const value = this.good.get(dir);
    if (!value) return null;
    const ageMs = Math.max(0, this.now() - value.at);
    return { ...value, ageMs, stale: this.failed.has(dir) || ageMs > USAGE_INTERVAL };
  }
  refresh(dir: string): Promise<void> {
    if (isReadOnlyClaudeProfile(dir)) return Promise.resolve();
    const pending = this.pending.get(dir);
    if (pending) return pending;
    const task = (async () => {
      try { this.good.set(dir, { ...await this.read(dir), at: this.now() }); this.failed.delete(dir); }
      catch { this.failed.add(dir); } // Never log credential-bearing exceptions.
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
export const claudeUsage = new ClaudeUsagePoller();
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
