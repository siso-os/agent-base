/** Service identity, seat and session migration. No auth payloads are read. */
import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { homedir } from "node:os";
export type Seat = { session: string | null; login_launcher: string; pane?: string; name: string; updated?: string; workspaceId?: string; label?: string; cwd?: string; harness?: 'claude'; model?: string; startAttempted?: boolean };
export function safeName(name: string) {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(name)) throw new Error("Invalid service name");
  return name;
}
export function configDir(login: string, home = homedir()) {
  switch (path.basename(login)) {
    case "claude": return path.join(home, ".claude");
    case "claude-siso": return path.join(home, ".claude-siso");
    case "claude-siso-3": return path.join(home, ".config/claude-siso-3");
    default: throw new Error("Unknown login launcher");
  }
}
export function readSeat(file: string, name: string): Seat {
  const seat = JSON.parse(readFileSync(file, "utf8"));
  const owned = seat.harness === 'claude' && typeof seat.workspaceId === 'string' && !!seat.workspaceId && typeof seat.label === 'string' && !!seat.label && typeof seat.cwd === 'string' && path.isAbsolute(seat.cwd) && typeof seat.model === 'string' && !!seat.model.trim() && typeof seat.startAttempted === 'boolean';
  if (seat.name !== name || !(typeof seat.session === 'string' && /^[A-Za-z0-9_-]+$/.test(seat.session) || seat.session === null && owned)) throw new Error("Invalid service seat");
  configDir(seat.login_launcher);
  return seat;
}
/** A workspace-owned seat can adopt only its own durable host identity. Never infer from a name alone. */
export function reconcileSeat(seat: Seat, saved: any, owner: { workspaceId: string; name: string; cwd: string; label: string; model: string }, alive: (pid: number) => boolean): Seat {
  if (seat.workspaceId !== owner.workspaceId || seat.name !== owner.name || seat.label !== owner.label || seat.cwd !== owner.cwd || seat.model !== owner.model || seat.harness !== 'claude') throw new Error('Service seat ownership changed');
  if (saved === undefined) {
    if (!seat.session && seat.startAttempted) throw new Error('Fresh service start is ambiguous; retained for inspection');
    return seat;
  }
  if (!saved || typeof saved !== 'object' || Array.isArray(saved)) throw new Error('Invalid saved host identity');
  if (saved.name !== owner.name || saved.workspaceId !== owner.workspaceId || saved.label !== owner.label || saved.cwd !== owner.cwd || saved.harness && saved.harness !== 'claude') throw new Error('Saved host ownership changed');
  if (!Number.isInteger(saved.pid) || saved.pid <= 0) throw new Error('Invalid saved host process');
  if (alive(saved.pid)) throw new Error('Service host is already alive');
  if (saved.child === 'stopped') throw new Error('Stopped host requires explicit session resume');
  if (saved.session != null && (typeof saved.session !== 'string' || !/^[A-Za-z0-9_-]+$/.test(saved.session))) throw new Error('Invalid saved host session');
  if (seat.session && saved.session !== seat.session) throw new Error('Host session disagrees with seat');
  if (!saved.session) throw new Error('Fresh service start is ambiguous; retained for inspection');
  return { ...seat, session: saved.session, startAttempted: true };
}
export function sessionFiles(session: string, config: string) {
  const root = path.join(config, "projects");
  return existsSync(root) ? readdirSync(root).map(folder => path.join(root, folder, `${session}.jsonl`)).filter(existsSync) : [];
}
/** Copy the transcript and SDK sidecars, then retire the source. Caller must first stop its child. */
export function moveSession(session: string, from: string, to: string) {
  if (!/^[A-Za-z0-9_-]+$/.test(session)) throw new Error("Invalid session");
  const sourceRoot = path.join(from, "projects"), targetRoot = path.join(to, "projects");
  mkdirSync(targetRoot, { recursive: true, mode: 0o700 });
  if (existsSync(sourceRoot) && realpathSync(sourceRoot) === realpathSync(targetRoot)) return;
  const sources = sessionFiles(session, from);
  if (!sources.length) throw new Error("Session transcript missing in source login");
  sources.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
  const source = sources[0], dest = path.join(targetRoot, path.basename(path.dirname(source)), `${session}.jsonl`);
  mkdirSync(path.dirname(dest), { recursive: true, mode: 0o700 });
  // Never replace a newer divergent target: that is an owner decision, not a silent loss of history.
  if (existsSync(dest) && !readFileSync(dest).equals(readFileSync(source)) && statSync(dest).mtimeMs > statSync(source).mtimeMs) throw new Error("Target has a newer divergent session");
  copyFileSync(source, dest);
  const sidecar = source.slice(0, -6), targetSidecar = dest.slice(0, -6);
  if (existsSync(sidecar)) cpSync(sidecar, targetSidecar, { recursive: true });
  const suffix = `.moved-${Date.now()}`;
  // Retire all same-session source transcripts so discovery cannot select a stale duplicate.
  for (const file of sources) {
    renameSync(file, file + suffix);
    if (existsSync(file.slice(0, -6))) renameSync(file.slice(0, -6), file.slice(0, -6) + suffix);
  }
}
export function sourceLabel(value: unknown): string | null {
  // SDK labels only. Unexpected strings must never become an accidental secret disclosure.
  return typeof value === "string" && ["ANTHROPIC_API_KEY", "apiKeyHelper", "/login managed key", "user", "project", "org", "temporary", "none", "oauth"].includes(value) ? value : null;
}
export function saveHost(file: string, value: object) {
  mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(value), { mode: 0o600 });
  renameSync(tmp, file);
}
