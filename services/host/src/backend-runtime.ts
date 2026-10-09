/** Evidence belongs to the exact native child spawned by this host, not its selected label. */
import { randomUUID } from 'node:crypto';
import { selectedBackendRecord, type BackendOwner } from './backend-version.ts';

export type BackendRuntimeEvidence = {
  schema: 1; runId: string; hostPid: number; backendPid: number | null;
  name: string; label: string; workspaceId: string; session: string | null;
  selectionRevision: number; version: string; sha256: string; bundleSha256: string;
  status: 'starting' | 'initialized' | 'stopped' | 'failed';
  spawnedAt: string | null; initializedAt: string | null; stoppedAt: string | null;
  providerReportedVersion: null;
};
export function createBackendRuntime(file: string | undefined, owner: BackendOwner, workspaceId: string | undefined, executable: string) {
  if (!file) return null;
  const selected = selectedBackendRecord(file, owner);
  if (executable !== selected.artifact.executable) throw Error('Spawned backend differs from selected executable');
  // Legacy single-file entries can run, but cannot claim full retained-package runtime evidence.
  if (!selected.artifact.bundle || !workspaceId) return null;
  const proof: BackendRuntimeEvidence = { schema: 1, runId: randomUUID(), hostPid: process.pid, backendPid: null,
    name: owner.name, label: owner.label, workspaceId, session: null, selectionRevision: selected.revision,
    version: selected.artifact.version, sha256: selected.artifact.sha256, bundleSha256: selected.artifact.bundle.sha256,
    status: 'starting', spawnedAt: null, initializedAt: null, stoppedAt: null, providerReportedVersion: null };
  return {
    spawned(pid: number | undefined) {
      if (!Number.isInteger(pid) || !pid || proof.status !== 'starting') throw Error('Invalid native backend child identity');
      proof.backendPid = pid; proof.spawnedAt = new Date().toISOString();
    },
    initialized() {
      if (!proof.backendPid || !proof.spawnedAt || proof.status !== 'starting') throw Error('Backend initialized without its native spawn');
      const current = selectedBackendRecord(file, owner);
      if (current.revision !== proof.selectionRevision || current.artifact.sha256 !== proof.sha256 || current.artifact.bundle?.sha256 !== proof.bundleSha256) throw Error('Backend selection changed during initialization');
      proof.status = 'initialized'; proof.initializedAt = new Date().toISOString();
    },
    stopped(failed = false) { proof.status = failed || proof.status === 'failed' ? 'failed' : 'stopped'; proof.stoppedAt ??= new Date().toISOString(); },
    snapshot(session: string | null) { return { ...proof, session }; },
  };
}

/** Explicit fields only: never compare or publish arbitrary host metadata. */
export function backendRuntimeIdentity(value: unknown): BackendRuntimeEvidence | null {
  if (!value || typeof value !== 'object') return null;
  const r = value as BackendRuntimeEvidence;
  if (r.schema !== 1 || typeof r.runId !== 'string' || !/^[a-f0-9-]{36}$/.test(r.runId) || !Number.isSafeInteger(r.hostPid) || r.hostPid <= 0 || !Number.isSafeInteger(r.backendPid) || !r.backendPid || r.backendPid <= 0 || !Number.isSafeInteger(r.selectionRevision) || r.selectionRevision < 1 || !/^[A-Za-z0-9_-]{1,64}$/.test(r.name) || !/^[A-Za-z0-9_.-]+$/.test(r.label) || !/^[A-Za-z0-9_-]{1,128}$/.test(r.workspaceId) || typeof r.session !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(r.session) || !/^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/.test(r.version) || !/^[a-f0-9]{64}$/.test(r.sha256) || !/^[a-f0-9]{64}$/.test(r.bundleSha256) || r.status !== 'initialized' || !Number.isFinite(Date.parse(r.spawnedAt ?? '')) || !Number.isFinite(Date.parse(r.initializedAt ?? '')) || r.stoppedAt !== null || r.providerReportedVersion !== null) return null;
  return { schema: 1, runId: r.runId, hostPid: r.hostPid, backendPid: r.backendPid, name: r.name, label: r.label, workspaceId: r.workspaceId, session: r.session, selectionRevision: r.selectionRevision, version: r.version, sha256: r.sha256, bundleSha256: r.bundleSha256, status: r.status, spawnedAt: r.spawnedAt, initializedAt: r.initializedAt, stoppedAt: null, providerReportedVersion: null };
}
