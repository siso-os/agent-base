/** Backend lifecycle guards shared by the controller and Node's management reader. */
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { hostname } from 'node:os';
import path from 'node:path';
import { backendCatalogFile, privateBackendText, readBackendCatalog } from './backend-artifacts.ts';
import { assertBackendSeatInactive, selectBackendVersion, type BackendOwner } from './backend-version.ts';
import { validateWorkspaceReceipt } from './worktree-contract.ts';

/** Only the exact missing-job diagnostic is inactive; permissions and transport remain unknown. */
export function backendJobState(label: string) {
  const checkedAt = new Date().toISOString(), uid = process.getuid?.();
  if (!/^[A-Za-z0-9_.-]+$/.test(label) || uid === undefined) return { loaded: null, checkedAt, reason: 'launchctl-unavailable' };
  try {
    execFileSync(process.env.AB_LAUNCHCTL ?? '/bin/launchctl', ['print', `gui/${uid}/${label}`], { env: { PATH: '/usr/bin:/bin', LC_ALL: 'C' }, timeout: 2000, maxBuffer: 16384, stdio: ['ignore','ignore','pipe'] });
    return { loaded: true, checkedAt, reason: null };
  } catch (error: any) {
    const missing = `Bad request.\nCould not find service "${label}" in domain for user gui: ${uid}`;
    if (error.status === 113 && !error.signal && String(error.stderr ?? '').trim() === missing) return { loaded: false, checkedAt, reason: null };
    return { loaded: null, checkedAt, reason: 'launchctl-state-unknown' };
  }
}

/** Called only by the existing install controller, already awaited inside the Node launch lock.
 * The immutable launch input supplies a catalog ID; no path/hash or implicit default is accepted. */
export function prepareInitialBackend(file: string, owner: BackendOwner, model: string, hostsDir: string) {
  const saved = privateBackendText(file), receipt = validateWorkspaceReceipt(file, owner.cwd);
  const catalogId = receipt.input.backendCatalogId;
  if (!catalogId) return undefined;
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(catalogId) || receipt.input.harness !== 'codex' || receipt.name !== owner.name || receipt.input.model !== model || receipt.phase !== 'starting' || !receipt.handoffAttempted || receipt.agent?.name !== owner.name || owner.label !== (receipt.agent.label ?? `com.siso.host-${receipt.name}`) || path.basename(file) !== `${receipt.workspaceId}.json`) throw Error('Initial backend launch ownership changed');
  const lockFile = path.join(path.dirname(file), `launch-${receipt.workspaceId}.lock`), lockText = privateBackendText(lockFile), held = JSON.parse(lockText);
  if (held.machine !== hostname() || !Number.isInteger(held.pid) || ![process.pid,process.ppid].includes(held.pid) || typeof held.nonce !== 'string' || !held.nonce) throw Error('Initial backend selection requires the existing launch owner lock');
  const catalog = readBackendCatalog(), artifact = catalog.value.artifacts.find(a => a.id === catalogId);
  if (!artifact?.bundle) throw Error('Initial backend requires a retained local bundle catalog item');
  const selection = `${file}.backend-selection`;
  if (existsSync(selection)) throw Error('Initial backend selection already exists; retained for reconciliation');
  const guard = () => {
    if (privateBackendText(file) !== saved || privateBackendText(lockFile) !== lockText || readBackendCatalog(backendCatalogFile()).fingerprint !== catalog.fingerprint) throw Error('Initial backend owner or catalog changed');
    if (existsSync(path.join(hostsDir, `name-${owner.name}.json`))) throw Error('Existing host preserved; fresh backend launch is ambiguous');
    assertBackendSeatInactive(owner, hostsDir, backendJobState(owner.label).loaded);
  };
  selectBackendVersion(selection, owner, { action: 'select', expectedRevision: 0, artifact }, guard);
  return selection;
}
