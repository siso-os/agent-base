/** Local Codex artifact selection. No downloader, package manager, service restart or account access. */
import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { closeSync, constants, fstatSync, lstatSync, openSync, readFileSync, realpathSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { safeName } from './service.ts';
import { verifyBackendBundle, type LocalBackendArtifact } from './backend-artifacts.ts';
export type { LocalBackendArtifact } from './backend-artifacts.ts';

export type BackendOwner = { name: string; label: string; cwd: string };
type ValidatedArtifact = LocalBackendArtifact & { origin: 'existing-local'; downloadedAt: null; validatedAt: string };
type Selection = { revision: number; action: 'select' | 'rollback'; selectedAt: string; artifact: ValidatedArtifact };
export type BackendSelection = { schema: 1; owner: BackendOwner; history: Selection[] };
const digest = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const versionPattern = /^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/;

function ownerKey(owner: BackendOwner) {
  safeName(owner.name);
  if (!/^[A-Za-z0-9_.-]+$/.test(owner.label) || !path.isAbsolute(owner.cwd) || realpathSync(owner.cwd) !== owner.cwd) throw Error('Invalid backend owner');
  return JSON.stringify([owner.name, owner.label, owner.cwd]);
}
function artifactBytes(artifact: LocalBackendArtifact) {
  if (artifact.provider !== 'codex') throw Error('Unsupported backend provider; Claude SDK remains package-owned');
  if (!versionPattern.test(artifact.version) || !/^[a-f0-9]{64}$/.test(artifact.sha256)) throw Error('Explicit version and trusted SHA-256 required');
  const file = artifact.executable;
  if (!path.isAbsolute(file) || realpathSync(file) !== file) throw Error('Canonical absolute artifact path required');
  const fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || !(stat.mode & 0o111) || stat.mode & 0o022 || stat.size > 512 * 1024 * 1024) throw Error('Artifact must be a protected executable file');
    const bytes = readFileSync(fd), magic = bytes.subarray(0, 4).toString('hex');
    // Wrapper scripts do not pin the executable/dependencies they eventually launch.
    if (!['7f454c46','cffaedfe','feedfacf','cefaedfe','feedface','cafebabe','bebafeca','cafebabf','bfbafeca'].includes(magic)) throw Error('Standalone native artifact required; wrappers are unsupported');
    if (digest(bytes) !== artifact.sha256) throw Error('Backend artifact checksum changed');
    verifyBackendBundle(artifact);
    return bytes;
  } finally { closeSync(fd); }
}

/** A version-only command, with no inherited credentials or config. Never runs a model turn. */
export function validateLocalBackend(artifact: LocalBackendArtifact): ValidatedArtifact {
  artifactBytes(artifact);
  let output: string;
  try {
    output = execFileSync(artifact.executable, ['-m', 'backend-version-probe', '--version'], {
      cwd: path.dirname(artifact.executable), env: { PATH: '/usr/bin:/bin', LANG: 'C' },
      timeout: 3000, maxBuffer: 4096, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  } catch { throw Error('Backend version probe failed'); }
  if (output !== `codex-cli ${artifact.version}`) throw Error('Backend version did not match the requested version');
  artifactBytes(artifact);
  return { provider: 'codex', version: artifact.version, executable: artifact.executable, sha256: artifact.sha256, ...(artifact.bundle ? { bundle: { ...artifact.bundle } } : {}), origin: 'existing-local', downloadedAt: null, validatedAt: new Date().toISOString() };
}

function selectionPath(file: string) {
  if (!path.isAbsolute(file) || path.resolve(file) !== file || realpathSync(path.dirname(file)) !== path.dirname(file)) throw Error('Canonical absolute selection path required');
}
/** An exclusive file is also held by the supervised runner for its whole lifetime.
 * A crash leaves the lock for explicit owner reconciliation; never steal it based on PID reuse. */
export function lockBackendSelection(file: string) {
  selectionPath(file);
  const lock = `${file}.lock`, token = randomUUID();
  const fd = openSync(lock, 'wx', 0o600);
  try { writeFileSync(fd, JSON.stringify({ pid: process.pid, token })); } finally { closeSync(fd); }
  let released = false;
  return () => {
    if (released) return;
    const saved = JSON.parse(readFileSync(lock, 'utf8'));
    if (saved.token !== token) throw Error('Backend lock ownership changed');
    unlinkSync(lock); released = true;
  };
}
export function readBackendSelection(file: string, owner: BackendOwner): BackendSelection | null {
  selectionPath(file); const key = ownerKey(owner);
  let value: BackendSelection;
  try {
    const stat = lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.mode & 0o077 || stat.size > 1024 * 1024) throw Error('Invalid private backend selection file');
    value = JSON.parse(readFileSync(file, 'utf8'));
  } catch (error: any) { if (error.code === 'ENOENT') return null; throw error; }
  if (value.schema !== 1 || ownerKey(value.owner) !== key || !Array.isArray(value.history) || !value.history.length || value.history.length > 1000) throw Error('Backend selection ownership or history changed');
  value.history.forEach((row, i) => {
    if (row.revision !== i + 1 || !['select','rollback'].includes(row.action) || !Number.isFinite(Date.parse(row.selectedAt)) || row.artifact?.origin !== 'existing-local' || row.artifact.downloadedAt !== null || !Number.isFinite(Date.parse(row.artifact.validatedAt))) throw Error('Invalid backend selection receipt');
  });
  return value;
}
export function backendSelectionStatus(file: string, owner: BackendOwner) {
  const receipt = readBackendSelection(file, owner), selected = receipt?.history.at(-1) ?? null;
  return { receipt, selected, runningVersion: null, runningEvidence: 'unverified' as const, downloadedVersion: null, installationSupported: false, automaticUpdates: false };
}

/** Loaded job status must be supplied by the existing service owner; unknown is not inactive. */
export function assertBackendSeatInactive(owner: BackendOwner, hostsDir: string, loaded: boolean | null) {
  ownerKey(owner);
  if (loaded !== false) throw Error('Active or unknown service seat cannot change backend');
  if (!path.isAbsolute(hostsDir)) throw Error('Absolute hosts directory required');
  let host: any;
  try { host = JSON.parse(readFileSync(path.join(hostsDir, `name-${owner.name}.json`), 'utf8')); }
  catch (error: any) { if (error.code === 'ENOENT') return; throw error; }
  if (host?.name !== owner.name || host?.label !== owner.label || host?.cwd !== owner.cwd || !Number.isInteger(host?.pid) || host.pid <= 0) throw Error('Host ownership is ambiguous');
  try { process.kill(host.pid, 0); } catch (error: any) { if (error.code === 'ESRCH') return; throw Error('Host liveness is unknown'); }
  throw Error('Active service host cannot change backend');
}

/** Owner code supplies an authoritative synchronous inactive-seat check (loaded job AND host).
 * Invoke under the existing launch ownership lock. Browser input must reference a trusted catalog item,
 * never provide arbitrary executable paths, hashes, owners or the guard implementation. */
export function selectBackendVersion(file: string, owner: BackendOwner, request:
  | { action: 'select'; expectedRevision: number; artifact: LocalBackendArtifact }
  | { action: 'rollback'; expectedRevision: number; targetRevision: number },
  assertInactive: () => void): BackendSelection {
  const release = lockBackendSelection(file);
  try {
    ownerKey(owner); assertInactive();
    const prior = readBackendSelection(file, owner), revision = prior?.history.at(-1)?.revision ?? 0;
    if (!Number.isInteger(request.expectedRevision) || request.expectedRevision !== revision) throw Error('Backend selection revision changed');
    if (revision >= 1000) throw Error('Backend selection history limit reached; preserve receipts for owner review');
    if (!['select','rollback'].includes(request.action)) throw Error('Backend installation is unsupported; select a verified existing local artifact');
    const candidate = request.action === 'select' ? request.artifact : prior?.history.find(row => row.revision === request.targetRevision)?.artifact;
    if (!candidate) throw Error('Explicit retained rollback revision required');
    const artifact = validateLocalBackend(candidate);
    assertInactive();
    const next: BackendSelection = { schema: 1, owner: { name: owner.name, label: owner.label, cwd: owner.cwd }, history: [...(prior?.history ?? []), { revision: revision + 1, action: request.action, selectedAt: new Date().toISOString(), artifact }] };
    const encoded = JSON.stringify(next, null, 2) + '\n';
    if (Buffer.byteLength(encoded) > 1024 * 1024) throw Error('Backend selection receipt limit reached; preserve history for owner review');
    const temporary = `${file}.${randomUUID()}.tmp`;
    try { writeFileSync(temporary, encoded, { mode: 0o600, flag: 'wx' }); renameSync(temporary, file); }
    catch (error) { try { unlinkSync(temporary); } catch {} throw error; }
    return next;
  } finally { release(); }
}

/** Validate the selected bytes on every child start. Selection is not a running-version receipt. */
export function selectedBackendRecord(file: string, owner: BackendOwner) {
  const selected = readBackendSelection(file, owner)?.history.at(-1);
  if (!selected) throw Error('Backend selection is missing');
  artifactBytes(selected.artifact);
  return selected;
}
export function selectedBackendEnvironment(file: string, owner: BackendOwner) {
  const selected = selectedBackendRecord(file, owner);
  return { AB_CODEX_BIN: selected.artifact.executable };
}
/** A retained bundle must not inherit a global package updater's ownership environment. */
export function backendChildEnvironment(base: NodeJS.ProcessEnv, file: string, owner: BackendOwner) {
  const env: NodeJS.ProcessEnv = { ...base, ...selectedBackendEnvironment(file, owner) };
  for (const key of Object.keys(env)) if (key === 'CODEX_MANAGED_PACKAGE_ROOT' || key.startsWith('CODEX_MANAGED_BY_')) delete env[key];
  return env;
}
