/** Private local artifact catalog + existing workspace/service ownership. Never installs or restarts. */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import { homedir, hostname } from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { assertBackendSeatInactive, readBackendSelection, selectBackendVersion, type BackendOwner, type LocalBackendArtifact } from '../../host/src/backend-version.ts';
import { backendCatalogFile, readBackendCatalog } from '../../host/src/backend-artifacts.ts';
import { backendJobState } from '../../host/src/backend-service.ts';
import { backendRuntimeIdentity } from '../../host/src/backend-runtime.ts';
export { backendJobState } from '../../host/src/backend-service.ts';
import { readWorkspaceReceipt, validateWorkspaceReceipt } from '../../host/src/worktree-contract.ts';
import { lock, receiptFile, workspaceDir } from './worktrees.ts';

class BackendError extends Error {
  reason: string; status: number;
  constructor(reason: string, status = 409) { super(reason); this.reason = reason; this.status = status; }
}
const idPattern = /^[A-Za-z0-9_-]{1,128}$/;
const uid = () => process.getuid?.();
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const privateHome = () => path.join(homedir(), '.local/state/agent-base');
const hostsDir = () => process.env.AB_HOSTS_DIR ?? path.join(privateHome(), 'hosts');
const definitionsDir = () => process.env.AB_LAUNCH_AGENTS_DIR ?? path.join(homedir(), 'Library/LaunchAgents');
function privateText(file: string) {
  const stat = lstatSync(file), parent = lstatSync(path.dirname(file));
  if (!path.isAbsolute(file) || realpathSync(file) !== file || !stat.isFile() || !parent.isDirectory() || stat.mode & 0o077 || parent.mode & 0o022 || ![0, uid()].includes(stat.uid) || ![0, uid()].includes(parent.uid) || stat.size > 1024 * 1024) throw new BackendError('private-owner-file-invalid');
  return readFileSync(file, 'utf8');
}
function readCatalog() {
  try { return readBackendCatalog(backendCatalogFile()); }
  catch (error: any) { throw new BackendError(error.code === 'ENOENT' ? 'catalog-not-staged' : error instanceof SyntaxError || error.message?.startsWith('Invalid') ? 'catalog-invalid' : 'catalog-unavailable', 503); }
}

function ownedService(id: string) {
  if (!idPattern.test(id)) throw new BackendError('invalid-service-id', 400);
  const file = receiptFile(id);
  let text: string, r: ReturnType<typeof readWorkspaceReceipt>;
  try { text = privateText(file); r = readWorkspaceReceipt(file); } catch (error: any) { throw new BackendError(error.code === 'ENOENT' ? 'service-not-found' : 'service-owner-unavailable', error.code === 'ENOENT' ? 404 : 409); }
  if (r.workspaceId !== id || r.machine !== hostname() || r.agent?.name !== r.name || !/^[A-Za-z0-9_-]{1,64}$/.test(r.name) || !/^[A-Za-z0-9_.-]+$/.test(r.agent?.label ?? '') || !path.isAbsolute(r.worktreePath)) throw new BackendError('service-owner-unavailable');
  const owner: BackendOwner = { name: r.name, label: r.agent!.label!, cwd: r.worktreePath };
  return { r, owner, file, fingerprint: hash(text) };
}
type Owned = ReturnType<typeof ownedService>;
function definition(service: Owned) {
  const file = path.join(definitionsDir(), `${service.owner.label}.plist`);
  let text: string, plist: any;
  try {
    text = privateText(file);
    plist = JSON.parse(execFileSync('/usr/bin/plutil', ['-convert', 'json', '-o', '-', file], { env: { PATH: '/usr/bin:/bin', LC_ALL: 'C' }, timeout: 2000, maxBuffer: 1024 * 1024, encoding: 'utf8', stdio: ['ignore','pipe','pipe'] }));
    if (hash(privateText(file)) !== hash(text)) throw Error('changed');
  } catch { throw new BackendError('service-definition-unavailable'); }
  const args = plist.ProgramArguments, env = plist.EnvironmentVariables;
  const flag = (key: string) => Array.isArray(args) && args.filter((a: string) => a === key).length === 1 ? args[args.indexOf(key) + 1] : null;
  const selection = `${service.file}.backend-selection`;
  if (plist.Label !== service.owner.label || plist.WorkingDirectory !== service.owner.cwd || !Array.isArray(args) || args.some(a => typeof a !== 'string') || args[0] !== process.execPath || args[1] !== '--experimental-strip-types' || args[2] !== '--no-warnings' || args[3] !== path.resolve(import.meta.dirname, '../../host/src/service-runner.ts') || flag('--harness') !== 'codex' || flag('--name') !== service.owner.name || flag('--model') !== service.r.input.model || env?.AB_WORKSPACE_RECEIPT !== service.file || env?.AB_SERVICE_LABEL !== service.owner.label || env?.AB_HOSTS_DIR !== hostsDir()) throw new BackendError('service-definition-owner-mismatch');
  if (env?.AB_BACKEND_SELECTION !== selection || env?.AB_CODEX_BIN) throw new BackendError('service-definition-not-selection-managed');
  return { file, fingerprint: hash(text), selection };
}
function runningHost(service: Owned) {
  try {
    const host = JSON.parse(privateText(path.join(hostsDir(), `name-${service.owner.name}.json`)));
    if (host.workspaceId !== service.r.workspaceId || host.name !== service.owner.name || host.label !== service.owner.label || host.cwd !== service.owner.cwd || !Number.isInteger(host.pid) || host.pid <= 0) return 'unknown';
    try { process.kill(host.pid, 0); return 'alive'; } catch (error: any) { return error.code === 'ESRCH' ? 'dead' : 'unknown'; }
  } catch (error: any) { return error.code === 'ENOENT' ? 'not-recorded' : 'unknown'; }
}
function sourceOwnership() {
  const pkg = JSON.parse(readFileSync(path.resolve(import.meta.dirname, '../../host/package.json'), 'utf8'));
  return { claude: { source: 'services/host/package.json', sdkPin: pkg.dependencies['@anthropic-ai/claude-agent-sdk'] }, codex: { source: 'service-owned local artifact selection or legacy AB_CODEX_BIN/PATH' } };
}
async function freshRuntime(service: Owned, selection: ReturnType<typeof readBackendSelection>, selectionFile: string | null) {
  const selected = selection?.history.at(-1);
  if (!selected?.artifact.bundle || !selectionFile) return null;
  try {
    const host = JSON.parse(privateText(path.join(hostsDir(), `name-${service.owner.name}.json`))), proof = backendRuntimeIdentity(host.backend);
    if (!proof || host.name !== service.owner.name || host.label !== service.owner.label || host.cwd !== service.owner.cwd || host.workspaceId !== service.r.workspaceId || proof.name !== host.name || proof.label !== host.label || proof.workspaceId !== host.workspaceId || proof.session !== host.session || service.r.agent?.session && service.r.agent.session !== host.session || proof.hostPid !== host.pid || proof.selectionRevision !== selected.revision || proof.version !== selected.artifact.version || proof.sha256 !== selected.artifact.sha256 || proof.bundleSha256 !== selected.artifact.bundle.sha256 || !Number.isInteger(host.port) || host.port < 1 || host.port > 65535) return null;
    process.kill(proof.hostPid, 0); process.kill(proof.backendPid!, 0);
    const health: any = await new Promise(resolve => {
      let settled = false;
      const finish = (value: unknown) => { if (!settled) { settled = true; clearTimeout(deadline); resolve(value); } };
      const req = http.get({ hostname: '127.0.0.1', port: host.port, path: '/health', agent: false }, res => {
        if (res.statusCode !== 200) { res.destroy(); finish(null); return; }
        let text = ''; res.on('data', chunk => { text += chunk; if (Buffer.byteLength(text) > 16384) { res.destroy(); finish(null); } });
        res.on('error', () => finish(null)); res.on('end', () => { try { finish(JSON.parse(text)); } catch { finish(null); } });
      });
      // Absolute request deadline, including a peer that trickles a partial response.
      const deadline = setTimeout(() => { req.destroy(); finish(null); }, 1200);
      req.on('error', () => finish(null));
    });
    const live = backendRuntimeIdentity(health?.backend), current = readBackendSelection(selectionFile, service.owner)?.history.at(-1);
    if (health?.pid !== proof.hostPid || health?.name !== proof.name || health?.session !== proof.session || health?.child !== 'running' || !live || JSON.stringify(live) !== JSON.stringify(proof) || current?.revision !== selected.revision || current.artifact.sha256 !== proof.sha256 || current.artifact.bundle?.sha256 !== proof.bundleSha256) return null;
    process.kill(proof.backendPid!, 0);
    return { version: proof.version, evidence: 'spawned-validated-local-bundle', runId: proof.runId, hostPid: proof.hostPid, backendPid: proof.backendPid, selectionRevision: proof.selectionRevision, observedAt: new Date().toISOString(), initializedAt: proof.initializedAt, providerReportedVersion: null };
  } catch { return null; }
}
async function status(service: Owned, catalog: ReturnType<typeof readCatalog> | null, catalogReason: string | null) {
  const loaded = backendJobState(service.owner.label), host = runningHost(service);
  let blocker: string | null = catalogReason, selected: any = null, validated: any = null, history: object[] = [];
  let receipt: ReturnType<typeof readBackendSelection> = null, selectionFile: string | null = null;
  if (service.r.input.harness !== 'codex') blocker = 'provider-package-owned';
  else {
    try {
      const def = definition(service); selectionFile = def.selection; receipt = readBackendSelection(def.selection, service.owner);
      const current = receipt?.history.at(-1);
      const catalogId = (artifact: LocalBackendArtifact) => catalog?.value.artifacts.find(a => a.sha256 === artifact.sha256 && a.executable === artifact.executable && a.version === artifact.version)?.id ?? null;
      if (current) {
        selected = { revision: current.revision, version: current.artifact.version, catalogId: catalogId(current.artifact), at: current.selectedAt };
        validated = { version: current.artifact.version, at: current.artifact.validatedAt, evidence: 'recorded-version-and-checksum-probe', currentBytes: 'unverified' };
      }
      history = receipt?.history.map(row => ({ revision: row.revision, version: row.artifact.version, action: row.action, at: row.selectedAt, catalogId: catalogId(row.artifact) })) ?? [];
    } catch (error) { blocker = error instanceof BackendError ? error.reason : 'selection-receipt-unavailable'; }
  }
  if (loaded.loaded === null) blocker = 'launchctl-state-unknown';
  else if (loaded.loaded || host === 'alive') blocker = 'service-active';
  else if (host === 'unknown') blocker = 'host-ownership-unknown';
  const running = host === 'alive' ? await freshRuntime(service, receipt, selectionFile) : null;
  return { serviceId: service.r.workspaceId, name: service.owner.name, provider: service.r.input.harness, selected, validated, loaded, running: { ...(running ?? { version: null, evidence: 'not-attested' }), host }, downloaded: null, history, writable: blocker === null, ownership: { evidence: 'durable-workspace-and-service-definition', gitAndLaunchLock: 'rechecked-on-write' }, blocker };
}

export async function backendManagementStatus(serviceId?: string) {
  let catalog: ReturnType<typeof readCatalog> | null = null, catalogReason: string | null = null;
  try { catalog = readCatalog(); } catch (error) { catalogReason = error instanceof BackendError ? error.reason : 'catalog-unavailable'; }
  const base = { source: sourceOwnership(), catalog: { availability: catalog ? 'available' : 'unavailable', reason: catalogReason, revision: catalog?.value.revision ?? null, artifacts: catalog?.value.artifacts.map(a => ({ id: a.id, provider: a.provider, version: a.version })) ?? [] }, installationSupported: false, automaticUpdates: false };
  if (serviceId) return { ...base, service: await status(ownedService(serviceId), catalog, catalogReason) };
  let ids: string[];
  try { ids = readdirSync(workspaceDir()).filter(f => f.endsWith('.json') && !/^ws-[a-f0-9]{24}-setup-[a-f0-9]+\.json$/.test(f) && idPattern.test(f.slice(0,-5))); } catch { return { ...base, inventory: { availability: 'unavailable', reason: 'workspace-inventory-unavailable' }, services: [] }; }
  if (ids.length > 256) return { ...base, inventory: { availability: 'unavailable', reason: 'workspace-inventory-limit' }, services: [] };
  const services: object[] = []; let unreadable = 0;
  for (const id of ids) { try { services.push(await status(ownedService(id.slice(0,-5)), catalog, catalogReason)); } catch { unreadable++; } }
  return { ...base, inventory: { availability: unreadable ? 'partial' : 'available', unreadable }, services };
}

export type BackendMutation = { serviceId: string; expectedRevision: number } & ({ action: 'select'; catalogId: string } | { action: 'rollback'; targetRevision: number });
export async function changeBackendSelection(request: BackendMutation) {
  if (!idPattern.test(request.serviceId)) throw new BackendError('invalid-service-id', 400);
  // Do not let lock() create an inventory for a request that has no existing owner/catalog.
  ownedService(request.serviceId); readCatalog();
  return lock(`launch-${request.serviceId}`, async () => {
    const service = ownedService(request.serviceId), catalog = readCatalog();
    if (service.r.input.harness !== 'codex') throw new BackendError('provider-package-owned');
    const def = definition(service);
    try { validateWorkspaceReceipt(service.file, service.owner.cwd); } catch { throw new BackendError('workspace-ownership-changed'); }
    const guard = () => {
      if (hash(privateText(service.file)) !== service.fingerprint || hash(privateText(def.file)) !== def.fingerprint || readCatalog().fingerprint !== catalog.fingerprint) throw new BackendError('owner-or-catalog-changed');
      if (runningHost(service) === 'unknown') throw new BackendError('host-ownership-unknown');
      const loaded = backendJobState(service.owner.label);
      if (loaded.loaded === null) throw new BackendError('launchctl-state-unknown');
      try { assertBackendSeatInactive(service.owner, hostsDir(), loaded.loaded); } catch { throw new BackendError('service-active-or-host-unknown'); }
    };
    let mutation: Parameters<typeof selectBackendVersion>[2];
    if (request.action === 'select') {
      const artifact = catalog.value.artifacts.find(a => a.id === request.catalogId);
      if (!artifact) throw new BackendError('catalog-item-not-found', 404);
      mutation = { action: 'select', expectedRevision: request.expectedRevision, artifact };
    } else mutation = { action: 'rollback', expectedRevision: request.expectedRevision, targetRevision: request.targetRevision };
    try { selectBackendVersion(def.selection, service.owner, mutation, guard); }
    catch (error: any) {
      if (error instanceof BackendError) throw error;
      if (error.code === 'EEXIST') throw new BackendError('service-or-selection-busy');
      if (error.message === 'Backend selection revision changed') throw new BackendError('selection-revision-changed');
      throw new BackendError('artifact-or-selection-validation-failed');
    }
    return backendManagementStatus(request.serviceId);
  });
}
export function backendManagementFailure(error: unknown) {
  return error instanceof BackendError ? { status: error.status, reason: error.reason } : { status: 409, reason: 'backend-owner-unavailable-or-busy' };
}
