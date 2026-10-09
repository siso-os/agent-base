/** Server-owned preparation, independently written from the pinned research in docs/WORKTREES.md. */
import { execFile, spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { constants, existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { copyFile, readFile, open } from 'node:fs/promises';
import { hostname, homedir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { readWriterDossier } from './writer-gates.ts';
import { readWorkspaceReceipt, validateWorkspaceReceipt, type LaunchInput, type WorkspaceConfig, type WorkspaceReceipt, type WorkspaceSnapshot, type StageId } from '../../host/src/worktree-contract.ts';
const run = promisify(execFile);
const ordered=(v:any):any=>Array.isArray(v)?v.map(ordered):v && typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,ordered(v[k])])):v;
const hash = (v: unknown) => createHash('sha256').update(JSON.stringify(ordered(v))).digest('hex');
export class WorkspaceError extends Error { code: number; constructor(message: string, code = 409) { super(message); this.code = code; } }
export const workspaceDir = () => process.env.AB_WORKSPACES_DIR ?? path.join(homedir(), '.local/state/agent-base/workspaces');
export const receiptFile = (id: string) => path.join(workspaceDir(), `${validId(id)}.json`);
const validId = (id: string) => { if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(id)) throw new WorkspaceError('Invalid workspace/launch identity', 400); return id; };
export async function git(cwd: string, args: string[]) { return (await run('git', ['-C', cwd, ...args], { timeout: 60_000, maxBuffer: 256 * 1024 })).stdout.trim(); }
const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch (e: any) { if (e.code !== 'ESRCH') throw new WorkspaceError('Cannot observe lock owner'); return false; } };
/** Exclusive-create filesystem locks shared by HTTP and CLI. Only a provably dead local owner can be reclaimed. */
export async function lock(key: string, fn: () => Promise<any>, wait = false): Promise<any> {
  mkdirSync(workspaceDir(), { recursive: true, mode: 0o700 });
  const file = path.join(workspaceDir(), `${key}.lock`), owner = { pid: process.pid, machine: hostname(), nonce: randomUUID() };
  for (let attempt = 0; ; attempt++) {
    try { writeFileSync(file, JSON.stringify(owner), { flag: 'wx', mode: 0o600 }); break; }
    catch (e: any) {
      if (e.code !== 'EEXIST') throw e;
      let held: any; try { held = JSON.parse(readFileSync(file, 'utf8')); } catch { throw new WorkspaceError('Unreadable workspace lock; retained'); }
      if (held.machine === hostname() && Number.isInteger(held.pid) && !alive(held.pid)) { if (readFileSync(file,'utf8') === JSON.stringify(held)) unlinkSync(file); continue; }
      if (!wait || attempt > 300) throw new WorkspaceError('Workspace is owned by another preparation');
      await new Promise(r => setTimeout(r, 100));
    }
  }
  try { return await fn(); } finally { if (existsSync(file) && JSON.parse(readFileSync(file,'utf8')).nonce === owner.nonce) unlinkSync(file); }
}
export function save(r: WorkspaceReceipt) {
  r.sequence++; const file = receiptFile(r.workspaceId), temp = `${file}.${process.pid}.tmp`;
  writeFileSync(temp, JSON.stringify(r), { mode: 0o600 }); renameSync(temp, file);
}
export function snapshot(r: WorkspaceReceipt): WorkspaceSnapshot {
  return { workspaceId: r.workspaceId, launchId: r.launchId, taskId: r.taskId, name: r.name, phase: r.phase, branch: r.branch, baseRef: r.baseRef, baseSha: r.baseSha, stages: r.stages, sequence: r.sequence, error: r.error, agentId: r.agentId };
}
export function getWorkspace(id: string) { return readWorkspaceReceipt(receiptFile(id)); }
async function canonicalRepo(repo: string) {
  const root = realpathSync(await git(path.resolve(repo.replace(/^~(?=\/|$)/, homedir())), ['rev-parse','--show-toplevel']));
  const common = realpathSync(path.resolve(root, await git(root, ['rev-parse','--git-common-dir'])));
  const blocks = (await git(root,['worktree','list','--porcelain'])).split('\n\n');
  // Common Git dir points to the main checkout even when input was a linked worktree.
  const main = blocks[0].split('\n').find(s => s.startsWith('worktree '))?.slice(9);
  if (!main) throw new WorkspaceError('Cannot resolve canonical repository');
  return { root: realpathSync(main), common };
}
function noSymlinks(root: string, relative: string) {
  if (!relative || path.isAbsolute(relative) || relative.split(/[\\/]/).some(p => !p || p === '..' || p === '.' || ['.git','node_modules'].includes(p))) throw new WorkspaceError('Unsafe preparation path');
  let current = root;
  for (const part of relative.split('/')) { current = path.join(current, part); try { if (lstatSync(current).isSymbolicLink()) throw new WorkspaceError('Preparation symlink refused'); } catch(e:any) { if(e.code!=='ENOENT')throw e; } }
  return current;
}
async function configFor(repo: string, deferDefaultInstall = false): Promise<WorkspaceConfig> {
  const file = noSymlinks(repo, '.agents/workspace.json');
  let c: WorkspaceConfig;
  if (existsSync(file)) {
    if (deferDefaultInstall) throw new WorkspaceError('Cannot defer a repository-owned preparation recipe',400);
    c = JSON.parse(readFileSync(file, 'utf8'));
  }
  else c = { version: 1, fetch: true, submodules: 'none', copyFiles: [], setup: !deferDefaultInstall && existsSync(path.join(repo,'pnpm-lock.yaml')) ? [{ id: 'install', label: 'Install dependencies', argv: ['heavy','--','pnpm','install','--frozen-lockfile','--prefer-offline'], required: true, timeoutMs: 600_000 }] : [] };
  if (c.version !== 1 || c.fetch !== undefined && typeof c.fetch !== 'boolean' || c.submodules && !['none','top-level','recursive'].includes(c.submodules) || c.copyFiles && !Array.isArray(c.copyFiles) || c.setup && !Array.isArray(c.setup)) throw new WorkspaceError('Invalid .agents/workspace.json',400);
  for (const f of c.copyFiles ?? []) { if((f as any).source && (f as any).source!=='repo')throw new WorkspaceError('External credential copy source is not configured',400); noSymlinks(repo,f.relativePath); if (typeof f.required !== 'boolean' || typeof f.private !== 'boolean') throw new WorkspaceError('Invalid copy policy',400); }
  for (const s of c.setup ?? []) if (!s.id || !s.label || !Array.isArray(s.argv) || !s.argv.length || s.argv.some(a => typeof a !== 'string' || !a) || !Number.isInteger(s.timeoutMs) || s.timeoutMs < 1 || s.timeoutMs > 1_800_000 || typeof s.required !== 'boolean') throw new WorkspaceError('Invalid setup policy',400);
  return c;
}
export async function acceptLaunch(input: LaunchInput): Promise<WorkspaceReceipt> {
  validId(input.launchId);
  if (input.deferDefaultInstall !== undefined && typeof input.deferDefaultInstall !== 'boolean') throw new WorkspaceError('Invalid deferred install policy',400);
  if (input.deferDefaultInstall && input.workspace?.type !== 'isolated') throw new WorkspaceError('Deferred install requires an isolated workspace',400);
  if (input.taskId) validId(input.taskId);
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/.test(input.name) || input.name.toUpperCase() === 'A0' || !input.repo || !['claude','codex'].includes(input.harness) || typeof input.model !== 'string' || !input.model.trim() || input.model.startsWith('-')) throw new WorkspaceError('Repo, name and explicit model are required',400);
  if (!input.workspace || !['isolated','shared','existing'].includes(input.workspace.type) || input.workspace.type === 'shared' && !input.workspace.reason?.trim()) throw new WorkspaceError('Choose Own worktree or Shared checkout with a reason',400);
  if (input.prompt !== undefined && (typeof input.prompt !== 'string' || input.prompt.length > 100_000)) throw new WorkspaceError('Invalid initial prompt',400);
  if(Object.hasOwn(input,'writer')&&(!input.writer||input.writer.version!==1||!/^[a-z_][a-z0-9_-]{0,79}$/.test(input.writer.surface)||!/^[a-f0-9]{40,64}$/.test(input.writer.sourceRevision)||!/^[a-f0-9]{64}$/.test(input.writer.dossierDigest)))throw new WorkspaceError('Invalid explicit writer binding',400);
  if (Object.hasOwn(input, 'backendCatalogId') && (input.harness !== 'codex' || typeof input.backendCatalogId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(input.backendCatalogId))) throw new WorkspaceError('Invalid Codex version ID',400);
  if(input.workspace.type==='existing') {
    const saved=getWorkspace(input.workspace.workspaceId), resolved=await canonicalRepo(input.repo);
    if (Object.hasOwn(input, 'backendCatalogId') && input.backendCatalogId !== saved.input.backendCatalogId) throw new WorkspaceError('Existing workspace Codex version binding cannot be changed');
    if(input.writer&&hash(input.writer)!==hash(saved.input.writer))throw new WorkspaceError('Existing workspace writer binding cannot be changed');
    if(input.launchId!==saved.launchId || input.name!==saved.name || input.harness!==saved.input.harness || input.model!==saved.input.model || input.taskId!==saved.input.taskId || input.project!==saved.input.project || resolved.common!==saved.commonGitDir || input.prompt!==undefined && input.prompt!==saved.input.prompt)throw new WorkspaceError('Existing workspace must resume its original launch identity');
    validateWorkspaceReceipt(receiptFile(saved.workspaceId),saved.worktreePath);return saved;
  }
  const fingerprint = hash(input), id = `ws-${hash(input.taskId ?? input.launchId).slice(0,24)}`;
  return lock(`accept-${id}`, async () => {
    if (existsSync(receiptFile(id))) { const held = getWorkspace(id); if (held.inputFingerprint !== fingerprint) throw new WorkspaceError('Launch identity already has different input'); return held; }
    const { root, common } = await canonicalRepo(input.repo), config = await configFor(root, input.deferDefaultInstall);
    const repoKey = path.basename(root).replace(/[^A-Za-z0-9_.-]/g,'-');
    const slug = `${input.name.toLowerCase()}-${id.slice(-12)}`;
    const requestedRoot = path.resolve(process.env.AB_WORKTREE_ROOT ?? path.join(homedir(),'SISO_Workspace/_data/worktrees'));
    mkdirSync(requestedRoot,{recursive:true});const worktreeRoot=realpathSync(requestedRoot);
    if (worktreeRoot === root || worktreeRoot.startsWith(`${root}${path.sep}`) || path.dirname(worktreeRoot) === root) throw new WorkspaceError('Worktrees must be in the estate worktree root');
    const r: WorkspaceReceipt = { version: 1, workspaceId: id, launchId: input.launchId, taskId: input.taskId ?? null, name: input.name, machine: hostname(), repoKey, repoPath: root, commonGitDir: common, worktreePath: input.workspace.type === 'shared' ? root : path.join(worktreeRoot,repoKey,slug), branch: null, baseRef: null, baseSha: null, recipeHash: hash(config), inputFingerprint: fingerprint, input, config, phase: 'preparing', stages: (['validate','fetch','checkout','submodules','copy-files','setup','agent'] as StageId[]).map(id => ({ id, status: 'pending', startedAt: null, endedAt: null, exitCode: null, detail: null })), sequence: 0, error: null, agentId: null, agent: null, preparationPid: null, setupPid: null, checkoutAttempted: false, handoffAttempted: false };
    save(r); return r;
  },true);
}
async function stage(r: WorkspaceReceipt, id: StageId, fn: () => Promise<void>, skipped = false) {
  const s = r.stages.find(s => s.id === id)!;
  if (s.status === 'done' || s.status === 'skipped') return;
  s.status = skipped ? 'skipped' : 'running'; s.startedAt = Date.now(); save(r);
  if (!skipped) { try { await fn(); s.status = 'done'; s.exitCode = 0; } catch (e) { s.status = 'failed'; s.detail = 'Failed; inspect private launch state'; save(r); throw e; } }
  s.endedAt = Date.now(); save(r);
}
async function ensureOwned(r: WorkspaceReceipt) {
  const listing = await git(r.repoPath,['worktree','list','--porcelain']);
  const registered = listing.split('\n\n').find(b => b.split('\n')[0] === `worktree ${r.worktreePath}`);
  if (registered) {
    if (!r.checkoutAttempted && r.input.workspace.type==='isolated')throw new WorkspaceError('Foreign registered worktree; preserved');
    if (!registered.split('\n').includes(`branch refs/heads/${r.branch}`) || !existsSync(r.worktreePath)) throw new WorkspaceError('Owned worktree registration changed');
    const common = realpathSync(path.resolve(r.worktreePath,await git(r.worktreePath,['rev-parse','--git-common-dir'])));
    if (common !== r.commonGitDir || await git(r.worktreePath,['symbolic-ref','--short','HEAD']) !== r.branch) throw new WorkspaceError('Owned worktree Git identity changed');
    return;
  }
  if (existsSync(r.worktreePath)) throw new WorkspaceError('Foreign directory at workspace path; preserved');
  if (r.stages.find(s=>s.id==='checkout')?.status === 'done') throw new WorkspaceError('Saved worktree is missing; explicit recovery required');
  try { await git(r.repoPath,['show-ref','--verify',`refs/heads/${r.branch}`]); throw new WorkspaceError('Foreign branch collision; preserved'); } catch (e) { if (e instanceof WorkspaceError) throw e; }
  r.checkoutAttempted=true;save(r);
  mkdirSync(path.dirname(r.worktreePath), { recursive: true });
  await git(r.repoPath,['worktree','add','-b',r.branch!,r.worktreePath,r.baseSha!]);
  // Registration is recoverable after a crash because path/branch/base were saved before add.
  await ensureOwned(r);
}
async function prepareFiles(r: WorkspaceReceipt) {
  for (const f of r.config.copyFiles ?? []) {
    const src = noSymlinks(r.repoPath,f.relativePath), dest = noSymlinks(r.worktreePath,f.relativePath);
    if (!existsSync(src)) { if (f.required) throw new WorkspaceError('Required preparation file is missing'); continue; }
    if (!lstatSync(src).isFile()) throw new WorkspaceError('Preparation requires regular files');
    if (f.private) { try { await git(r.worktreePath,['check-ignore','--no-index',f.relativePath]); } catch { throw new WorkspaceError('Private preparation file must be ignored'); } if(await git(r.worktreePath,['ls-files','--',f.relativePath]))throw new WorkspaceError('Private preparation file must be untracked'); }
    if (existsSync(dest)) { if (!lstatSync(dest).isFile() || !(await readFile(src)).equals(await readFile(dest))) { if (f.required) throw new WorkspaceError('Existing preparation file differs; preserved'); } continue; }
    mkdirSync(path.dirname(dest),{recursive:true}); noSymlinks(r.worktreePath,f.relativePath);
    if(f.private){const file=await open(dest,'wx',0o600);try{await file.writeFile(await readFile(src));}finally{await file.close();}}else await copyFile(src,dest,constants.COPYFILE_EXCL);
  }
}
const controllers = new Map<string, AbortController>();
export function stopPreparations() {for(const c of controllers.values())c.abort();}
async function runSetup(r: WorkspaceReceipt, signal: AbortSignal) {
  if(r.setupPid && alive(r.setupPid))throw new WorkspaceError('Previous owned setup is still running; inspect it before retry');
  for (const s of r.config.setup ?? []) {
    const doneFile = path.join(workspaceDir(), `${r.workspaceId}-setup-${hash(s.id).slice(0,12)}.json`);
    if (existsSync(doneFile)) { const done = JSON.parse(readFileSync(doneFile,'utf8')); if (done.recipeHash !== r.recipeHash) throw new WorkspaceError('Recipe changed; explicit reconciliation required'); if (done.exitCode === 0) continue; }
    const exitCode = await new Promise<number | null>((resolve, reject) => {
      const child = spawn(s.argv[0],s.argv.slice(1),{ cwd:r.worktreePath, detached:true, stdio:['ignore','ignore','ignore'], env: { ...process.env, AB_PROJECT_ROOT:r.repoPath, AB_WORKTREE_PATH:r.worktreePath, AB_WORKSPACE_ID:r.workspaceId } });
      r.setupPid=child.pid??null;save(r);
      let escalation: ReturnType<typeof setTimeout> | undefined;
      const kill = () => { if (child.pid) { try { process.kill(-child.pid,'SIGTERM'); } catch {} if(!escalation)escalation=setTimeout(()=>{try{process.kill(-child.pid!,'SIGKILL');}catch{}},5000); } };
      let timedOut = false;
      const deadline = setTimeout(()=>{ timedOut=true; kill(); },s.timeoutMs);
      signal.addEventListener('abort',kill,{once:true});
      child.once('error', e => { clearTimeout(deadline); clearTimeout(escalation); r.setupPid=null;save(r); signal.removeEventListener('abort',kill); reject(e); });
      child.once('exit', code => { clearTimeout(deadline); clearTimeout(escalation); r.setupPid=null;save(r); signal.removeEventListener('abort',kill); resolve(timedOut || signal.aborted ? null : code); });
      if (signal.aborted) kill();
    });
    r.stages.find(s=>s.id==='setup')!.exitCode=exitCode;save(r);
    writeFileSync(doneFile,JSON.stringify({ recipeHash:r.recipeHash,exitCode }),{mode:0o600});
    if (exitCode !== 0 && s.required) throw new WorkspaceError('Required setup failed or timed out; agent was not started');
  }
}
export async function prepareWorkspace(r: WorkspaceReceipt, signal: AbortSignal) {
  if(r.machine!==hostname())throw new WorkspaceError("Workspace belongs to another machine");
  if(r.input.writer && !r.checkoutAttempted) {
    if(r.input.workspace.type==='shared')throw new WorkspaceError('Component writers require an owned worktree');
    const binding=await readWriterDossier(r.repoPath,r.input.writer.surface);
    if(hash(binding)!==hash(r.input.writer))throw new WorkspaceError('Writer source or dossier changed before preparation');
  }
  if (hash(await configFor(r.repoPath, r.input.deferDefaultInstall)) !== r.recipeHash) throw new WorkspaceError('Preparation recipe changed; saved recipe retained');
  await stage(r,'validate',async()=> { if (r.machine !== hostname()) throw new WorkspaceError('Workspace belongs to another machine'); });
  const shared = r.input.workspace.type === 'shared', existing = r.input.workspace.type === 'existing';
  await stage(r,'fetch',async()=>{ if ((await git(r.repoPath,['remote'])).split('\n').includes('origin')) await git(r.repoPath,['fetch','origin']); },shared || existing || !r.config.fetch || !!r.baseSha);
  if (!r.baseSha) {
    for (const ref of r.input.writer ? [r.input.writer.sourceRevision] : ['origin/dev','dev','origin/main','main']) { try { r.baseSha=await git(r.repoPath,['rev-parse','--verify',`${ref}^{commit}`]); r.baseRef=ref; break; } catch {} }
    if (!r.baseSha) throw new WorkspaceError('Repository has no dev or main base');
    r.branch = shared ? await git(r.repoPath,['symbolic-ref','--short','HEAD']) : `job/${r.name.toLowerCase()}-${r.workspaceId.slice(-12)}`;
    await git(r.repoPath,['check-ref-format','--branch',r.branch]); save(r);
  }
  if (signal.aborted) throw new WorkspaceError('Preparation cancelled');
  await stage(r,'checkout',()=>lock(`repo-${hash(r.commonGitDir).slice(0,24)}`,()=>ensureOwned(r),true),shared || existing);
  if (!shared && !existing) await ensureOwned(r);
  await stage(r,'submodules',async()=>{ await git(r.worktreePath,['submodule','update','--init',...(r.config.submodules==='recursive'?['--recursive']:[])]); },shared || !r.config.submodules || r.config.submodules==='none');
  await stage(r,'copy-files',()=>prepareFiles(r),shared || !(r.config.copyFiles?.length));
  await stage(r,'setup',()=>runSetup(r,signal),shared || !(r.config.setup?.length));
  if (signal.aborted) throw new WorkspaceError('Preparation cancelled');
  r.phase='ready'; save(r); validateWorkspaceReceipt(receiptFile(r.workspaceId),r.worktreePath);
}
export async function withLaunch(r: WorkspaceReceipt, handoff: (r: WorkspaceReceipt) => Promise<void>) {
  return lock(`launch-${r.workspaceId}`,async()=> {
    r=getWorkspace(r.workspaceId);
    if (['active','archived','cancelled'].includes(r.phase)) return;
    const controller = new AbortController(); controllers.set(r.workspaceId,controller); r.preparationPid=process.pid; save(r);
    try {
      if (!['ready','starting'].includes(r.phase)) await prepareWorkspace(r,controller.signal);
      await handoff(r);
    } catch (e) {
      r.phase=controller.signal.aborted?'cancelled':'failed';
      // Never expose subprocess stderr, setup bodies or private file paths.
      r.error=e instanceof WorkspaceError ? e.message.slice(0,300) : 'Preparation/launch failed; inspect the private receipt'; save(r);
    } finally { r.preparationPid=null; save(r); controllers.delete(r.workspaceId); }
  });
}
export function cancelPreparation(id: string) {
  const r=getWorkspace(id); if (r.handoffAttempted || !['preparing','failed'].includes(r.phase)) return false;
  const c=controllers.get(id); if(c) { c.abort(); return true; }
  if(r.preparationPid && alive(r.preparationPid)) return false;
  r.phase='cancelled';save(r);return true;
}
export async function archiveWorkspace(id: string, hostAlive: (r: WorkspaceReceipt)=>Promise<boolean>) {
  return lock(`launch-${validId(id)}`,async()=> {
    const r=getWorkspace(id);
    if(r.phase==='archived')return snapshot(r);
    if(r.input.workspace.type!=='isolated')throw new WorkspaceError('Only an owned worktree can be archived');
    if(await hostAlive(r))throw new WorkspaceError('Host is still active; stop it before archiving');
    if(await git(r.worktreePath,['status','--porcelain','--untracked-files=all']))throw new WorkspaceError('Worktree is dirty; commit or preserve the changes first');
    await ensureOwned(r);
    if((r.config.copyFiles??[]).some(f=>f.private && existsSync(path.join(r.worktreePath,f.relativePath))))throw new WorkspaceError('Worktree contains private preparation files; preserve them before archive');
    const head=await git(r.worktreePath,['rev-parse','HEAD']);
    const pushed=await git(r.repoPath,['ls-remote','--heads','origin',`refs/heads/${r.branch}`]);
    if(pushed.split(/\s+/)[0]!==head)throw new WorkspaceError('Branch is not pushed at its current commit');
    await git(r.repoPath,['worktree','remove',r.worktreePath]);r.phase='archived';save(r);return snapshot(r);
  });
}
