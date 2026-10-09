/** Agent Base workspace contract. Independently implemented from the T3 Code (MIT)
 * launch/snapshot and Vibe Kanban (Apache-2.0) preparation research; see docs/WORKTREES.md. */
import { execFileSync } from 'node:child_process';
import { readFileSync, realpathSync } from 'node:fs';
import { hostname } from 'node:os';
import path from 'node:path';
export type WorkspaceMode = { type: 'isolated' } | { type: 'shared'; reason: string } | { type: 'existing'; workspaceId: string };
export type StageId = 'validate' | 'fetch' | 'checkout' | 'submodules' | 'copy-files' | 'setup' | 'agent';
export type WorkspaceStage = { id: StageId; status: 'pending' | 'running' | 'done' | 'skipped' | 'warning' | 'failed'; startedAt: number | null; endedAt: number | null; exitCode: number | null; detail: string | null };
export type WriterBinding = { version: 1; surface: string; sourceRevision: string; dossierDigest: string };
export type LaunchInput = { launchId: string; taskId?: string; name: string; repo: string; project?: string; harness: 'claude' | 'codex'; model: string; prompt?: string; deferDefaultInstall?: boolean; workspace: WorkspaceMode; writer?: WriterBinding; backendCatalogId?: string };
export type WorkspaceSnapshot = { workspaceId: string; launchId: string; taskId: string | null; name: string; phase: 'preparing' | 'ready' | 'starting' | 'active' | 'failed' | 'cancelled' | 'archived'; branch: string | null; baseRef: string | null; baseSha: string | null; stages: WorkspaceStage[]; sequence: number; error: string | null; agentId: string | null };
export type WorkspaceConfig = { version: 1; fetch?: boolean; submodules?: 'none' | 'top-level' | 'recursive'; copyFiles?: { relativePath: string; required: boolean; private: boolean }[]; setup?: { id: string; label: string; argv: string[]; timeoutMs: number; required: boolean }[] };
export type WorkspaceReceipt = WorkspaceSnapshot & { version: 1; machine: string; repoKey: string; repoPath: string; commonGitDir: string; worktreePath: string; recipeHash: string; inputFingerprint: string; input: LaunchInput; config: WorkspaceConfig; preparationPid: number | null; setupPid: number | null; agent: { name: string; pane?: string; session?: string; label?: string } | null; checkoutAttempted: boolean; handoffAttempted: boolean };
const git = (cwd: string, argv: string[]) => execFileSync('git', ['-C', cwd, ...argv], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 10_000 }).trim();
export function readWorkspaceReceipt(file: string): WorkspaceReceipt {
  const r = JSON.parse(readFileSync(file, 'utf8')) as WorkspaceReceipt;
  if (r.version !== 1 || !r.workspaceId || !r.inputFingerprint || !r.input || !r.config || !Array.isArray(r.stages) || !Number.isInteger(r.sequence) || !r.worktreePath || !r.commonGitDir || !['isolated','existing','shared'].includes(r.input.workspace?.type)) throw new Error('Invalid workspace receipt; retained for inspection');
  const ids=['validate','fetch','checkout','submodules','copy-files','setup','agent'];
  if(r.input.launchId!==r.launchId || r.input.name!==r.name || !['preparing','ready','starting','active','failed','cancelled','archived'].includes(r.phase) || r.config.version!==1 || r.stages.length!==ids.length || ids.some(id=>r.stages.filter(s=>s.id===id).length!==1) || r.stages.some(s=>!['pending','running','done','skipped','warning','failed'].includes(s.status)))throw new Error('Invalid workspace receipt state; retained for inspection');
  return r;
}
/** Called before every provider spawn, including runner restarts. No allocation or repair here. */
export function validateWorkspaceReceipt(file: string, cwd: string, name?: string, session?: string): WorkspaceReceipt {
  const r = readWorkspaceReceipt(file);
  if (r.machine !== hostname() || realpathSync(cwd) !== realpathSync(r.worktreePath)) throw new Error('Workspace machine/path changed');
  if (name && name !== r.name) throw new Error('Workspace host identity changed');
  if (name && r.agent?.session && session !== r.agent.session) throw new Error('Workspace session changed');
  if (!['ready', 'starting', 'active'].includes(r.phase) || r.stages.filter(s => s.id !== 'agent').some(s => !['done','skipped','warning'].includes(s.status))) throw new Error('Workspace preparation is not ready');
  if(r.input.workspace.type!=='shared' && (!r.branch || !r.baseRef || !/^[a-f0-9]{40,64}$/.test(r.baseSha??'')))throw new Error('Owned workspace base identity is missing');
  const writer=r.input.writer;
  if(writer && (writer.version!==1 || !/^[a-z_][a-z0-9_-]{0,79}$/.test(writer.surface) || !/^[a-f0-9]{40,64}$/.test(writer.sourceRevision) || !/^[a-f0-9]{64}$/.test(writer.dossierDigest) || r.input.workspace.type==='shared' || r.baseSha!==writer.sourceRevision))throw new Error('Writer workspace dossier/source binding changed');
  if(r.config.setup?.some(s=>s.required) && r.input.workspace.type!=='shared' && r.stages.find(s=>s.id==='setup')?.exitCode!==0)throw new Error('Required setup result is missing');
  const common = realpathSync(path.resolve(cwd, git(cwd, ['rev-parse','--git-common-dir'])));
  if (common !== r.commonGitDir || git(cwd, ['symbolic-ref','--short','HEAD']) !== r.branch) throw new Error('Workspace Git ownership changed');
  if (r.input.workspace.type !== 'shared') {
    const registered = git(cwd, ['worktree','list','--porcelain']).split('\n\n').some(block => block.includes(`worktree ${realpathSync(cwd)}\n`) && block.includes(`branch refs/heads/${r.branch}`));
    if (!registered) throw new Error('Workspace is not registered');
  }
  return r;
}
export function guardWorkspace(cwd = process.cwd(), name?: string, session?: string) {
  if (process.env.AB_WORKSPACE_RECEIPT) return validateWorkspaceReceipt(process.env.AB_WORKSPACE_RECEIPT, cwd, name, session);
}
