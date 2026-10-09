import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createDonorWorkReader } from '../src/donor-work.ts';

export const hash = bytes => createHash('sha256').update(bytes).digest('hex');
export async function donorFixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), '.siso-ephemeral-donor-work-'));
  const now = Date.parse('2026-10-06T03:00:00.000Z');
  const source = { id: 'synthetic-donor', revision: '4c6426646148d341b8ee150c1866ff4d0f5bcc25' };
  const task = (id, state = 'todo') => ({ id, title: 'Same task title', state, owner: 'donor-owner', updated_at: new Date(now).toISOString() });
  const project = (id, tasks) => ({ id, name: 'Same project title', oneliner: 'Synthetic Work records only', goal: 'Keep donor ownership separate.', area: 'main', priority: 2, stage: 'active', tasks });
  let snapshot = { schema: 1, source, capturedAt: new Date(now).toISOString(), projects: [project('alpha', [task('shared', 'doing'), task('unmapped'), task('complete', 'done')]), project('beta', [task('shared')])] };
  const configFile = path.join(root, 'mapping.json'), snapshotFile = path.join(root, 'snapshot.json');
  let config = { schema: 1, source, snapshot: { path: snapshotFile, sha256: '' }, projects: [
    { donorProjectId: 'alpha', projectId: 'project-A', tasks: [{ donorTaskId: 'shared', taskId: 't-alpha' }] },
    { donorProjectId: 'beta', projectId: 'project-B', tasks: [{ donorTaskId: 'shared', taskId: 't-beta' }] },
  ] };
  let targets = { projects: ['project-A', 'project-B'], tasks: [{ id: 't-alpha', stage: 'live', available: true }, { id: 't-beta', stage: 'thought', available: true }] };
  let targetReads = 0;
  const reader = createDonorWorkReader({ configFile, now: () => now, readTargets: async () => { targetReads++; return targets; } });
  const save = async () => {
    const bytes = JSON.stringify(snapshot);
    await writeFile(snapshotFile, bytes, { mode: 0o600 });
    config.snapshot.sha256 = hash(bytes);
    await writeFile(configFile, JSON.stringify(config), { mode: 0o600 });
  };
  await save();
  return {
    root, configFile, snapshotFile, now, reader, save,
    get snapshot() { return snapshot; }, set snapshot(v) { snapshot = v; },
    get config() { return config; }, set config(v) { config = v; },
    get targets() { return targets; }, set targets(v) { targets = v; },
    get targetReads() { return targetReads; },
    files: async () => Promise.all([configFile, snapshotFile].map(f => readFile(f, 'utf8'))),
    close: () => rm(root, { recursive: true }),
  };
}
