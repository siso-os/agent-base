/** t-0397: task-scoped allocation through the existing, identity-checked workspace lifecycle. */
import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { lstat, mkdir, readFile, realpath, rename, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { launchAgent, retryLaunch, type LaunchAdapters } from './agent-launch.ts';
import { getWorkspace, lock, snapshot, workspaceDir, WorkspaceError } from './worktrees.ts';
import type { LaunchInput, WorkspaceReceipt, WorkspaceSnapshot } from '../../host/src/worktree-contract.ts';
import type { TaskEdit } from './a0-tasks.ts';
import { readWriterDossier } from './writer-gates.ts';
import type { WriterBinding } from '../../host/src/worktree-contract.ts';

const exec = promisify(execFile);
const ID = /^t-[A-Za-z0-9_-]{1,61}$/;
const STARTABLE = new Set(['thought', 'specced', 'allocated', 'rework']);
const normalize = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, '');
const ordered = (value: any): any => Array.isArray(value) ? value.map(ordered) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, ordered(value[key])])) : value;
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(ordered(value))).digest('hex');
type Reply = { status: number; body: any };
type Task = { id: string; title: string; project: string; stage: string; updated: string; owner?: string | null; agent?: string | null; his?: string; links?: Record<string, unknown>; [key: string]: unknown };
type Project = { id?: string; name: string; path?: string | null };
type Admission = { ok: boolean; reason?: string };
type Context = { task: Task; repo: string; model: string; recovery: boolean };
export type TaskActionsOptions = {
  read: (pathname: string) => Promise<Reply | null>;
  write: (id: string, edit: TaskEdit) => Promise<Reply>;
  projects: () => Project[];
  adapters: LaunchAdapters;
  /** The integrating server supplies its current hardware/API admission policy. Unknown fails closed. */
  admit: (context: Context) => Promise<Admission>;
  routingFile?: string;
  stateDir?: string;
  /** Test seam: the production defaults always use Agent Base's workspace lifecycle. */
  lifecycle?: {
    launch: (input: LaunchInput, adapters: LaunchAdapters) => Promise<WorkspaceSnapshot>;
    retry: (id: string, adapters: LaunchAdapters) => WorkspaceSnapshot | Promise<WorkspaceSnapshot>;
    get: (id: string) => WorkspaceReceipt;
  };
};
type Stored = { version: 1; taskId: string; expectedRevision: string; idempotencyKey: string; taskRevision: string; input: LaunchInput; workspaceId: string; accepted: boolean; boardUpdated: boolean; boardRevision?: string; boardError?: string; error?: string; createdAt: string };
type Ready = { task: Task; repo: string | null; specPath: string | null; spec: string | null; model: string | null; writer: WriterBinding | null; expectedRevision: string; idempotencyKey: string; specReady: boolean; canStart: boolean; reason: string };
const sections = ['His words', 'What is wrong now', 'The real data', 'His moments', 'Options', 'Anatomy', "Keep and don't", 'Acceptance'];
const templates = [/^verbatim, dated\./i, /^read from the live app or his screenshot:/i, /^numbers from the live api or files:/i, /^two or three real moments:/i, /^three real options with their trade-offs/i, /^exact: sections and order,/i, /^what must not change \(his standing rules/i, /^fixture built from the real data shapes;/i];
const headingKey = (value: string) => value.replace(/[‘’]/g, "'").replace(/^\d+\.\s*/, '').trim().toLowerCase();

/** A copied blank template, headings inside code fences, and empty/TODO sections are not a complete specification. */
export function incompleteTaskSpec(markdown: string): string[] {
  const clean = markdown.replace(/<!--[\s\S]*?-->/g, '').replace(/^(```|~~~)[\s\S]*?^\1[^\n]*$/gm, '');
  const matches = [...clean.matchAll(/^##\s+(.+?)\s*$/gm)];
  return sections.filter((title, index) => {
    const headings = matches.filter(match => headingKey(match[1]) === headingKey(title));
    if (headings.length !== 1) return true;
    const heading = headings[0], position = matches.indexOf(heading);
    const body = clean.slice(heading.index! + heading[0].length, matches[position + 1]?.index ?? clean.length).trim();
    const text = body.replace(/[#>*_`~\[\]()-]/g, '').replace(/\s+/g, ' ').trim();
    return text.length < 12 || /^(?:todo|tbd|pending|fill (?:this|in)|placeholder|\.\.\.)[\s.!]*$/i.test(text) || templates[index].test(text);
  });
}

/** Hash only authored task state; reader decorations (shots/short/needs/spec_md) cannot spuriously invalidate an action. */
export function taskActionRevision(task: Task): string {
  return digest(Object.fromEntries(['id', 'title', 'project', 'priority', 'stage', 'owner', 'agent', 'model', 'updated', 'parent', 'workspace', 'his', 'next', 'links', 'feedback', 'evidence', 'history', 'intent'].map(key => [key, task[key] ?? null])));
}

export function createTaskActionsHandler(options: TaskActionsOptions) {
  const lifecycle = options.lifecycle ?? { launch: launchAgent, retry: retryLaunch, get: getWorkspace };
  const stateRoot = options.stateDir ?? path.join(workspaceDir(), 'task-actions');
  const routingFile = options.routingFile ?? path.join(homedir(), 'SISO_Workspace/SISO_Agents/agent-zero/siso-agent-zero/routing.json');
  const fileFor = (id: string) => path.join(stateRoot, `${digest(id)}.json`);
  const locked = <T>(id: string, fn: () => Promise<T>): Promise<T> => lock(`task-action-${digest(id)}`, fn, true);
  const readStored = async (id: string): Promise<Stored | null> => {
    let raw: string;
    try { raw = await readFile(fileFor(id), 'utf8'); } catch (error: any) { if (error.code === 'ENOENT') return null; throw new WorkspaceError('Allocation record unavailable; preserved', 503); }
    let saved: Stored;
    try { saved = JSON.parse(raw); } catch { throw new WorkspaceError('Allocation record invalid; preserved', 503); }
    if (saved.version !== 1 || saved.taskId !== id || !saved.input || saved.input.taskId !== id || saved.input.launchId !== saved.idempotencyKey || saved.workspaceId !== `ws-${digest(id).slice(0, 24)}` || !/^[a-f0-9]{64}$/.test(saved.expectedRevision) || !saved.taskRevision) throw new WorkspaceError('Allocation identity invalid; preserved', 503);
    return saved;
  };
  const persist = async (saved: Stored) => {
    await mkdir(stateRoot, { recursive: true, mode: 0o700 });
    const destination = fileFor(saved.taskId), temp = `${destination}.${process.pid}.${randomUUID()}.tmp`;
    await writeFile(temp, JSON.stringify(saved), { flag: 'wx', mode: 0o600 });
    await rename(temp, destination);
  };
  const readTask = async (id: string): Promise<Task> => {
    if (!ID.test(id)) throw new WorkspaceError('Invalid task id', 400);
    const result = await options.read(`/api/a0/tasks/${id}`), task = result?.body;
    if (result?.status !== 200) throw new WorkspaceError(result?.status === 404 ? 'Task not found' : 'Task source unavailable', result?.status === 404 ? 404 : 503);
    if (!task || task.id !== id || typeof task.title !== 'string' || !task.title.trim() || typeof task.project !== 'string' || typeof task.updated !== 'string' || typeof task.stage !== 'string') throw new WorkspaceError('Task source is invalid', 503);
    return task;
  };
  const resolveRepo = async (task: Task): Promise<string> => {
    const key = normalize(task.project);
    const projects = options.projects().filter(project => key && (normalize(project.name) === key || (project.id && normalize(project.id) === key)));
    if (projects.length !== 1 || !projects[0].path) throw new WorkspaceError(projects.length > 1 ? 'Task project matches more than one repository' : 'Task project has no registered repository', 409);
    const registered = path.resolve(projects[0].path.replace(/^~(?=\/|$)/, homedir()));
    const root = await realpath(registered);
    const gitRoot = (await exec('git', ['-C', root, 'rev-parse', '--show-toplevel'], { timeout: 10_000, maxBuffer: 8192 })).stdout.trim();
    if (await realpath(gitRoot) !== root) throw new WorkspaceError('Registered path is not a repository root', 409);
    return root;
  };
  const readSpec = async (repo: string, task: Task): Promise<{ relative: string; markdown: string }> => {
    const relative = task.links?.spec;
    if (typeof relative !== 'string' || !relative.startsWith('ui-hub/') || !relative.endsWith('/SPEC.md') || relative.includes('\\') || relative.split('/').some(part => !part || part === '.' || part === '..') || relative.startsWith('ui-hub/_template/')) throw new WorkspaceError('Task needs a complete UI specification', 409);
    let current = repo;
    for (const part of relative.split('/')) {
      current = path.join(current, part);
      if ((await lstat(current)).isSymbolicLink()) throw new WorkspaceError('Specification symlinks are not allowed', 409);
    }
    const resolved = await realpath(current);
    if (!resolved.startsWith(repo + path.sep)) throw new WorkspaceError('Specification is outside the registered repository', 409);
    const info = await stat(resolved);
    if (!info.isFile() || info.size > 64 * 1024) throw new WorkspaceError('Specification must be a text file under 64 KiB', 409);
    const markdown = await readFile(resolved, 'utf8');
    if (markdown.includes('\0')) throw new WorkspaceError('Specification is not text', 409);
    return { relative, markdown };
  };
  const inspect = async (id: string): Promise<Ready> => {
    const task = await readTask(id);
    let repo: string | null = null, spec: string | null = null, specPath: string | null = null, model: string | null = null, reason = '';
    try {
      repo = await resolveRepo(task);
      const file = await readSpec(repo, task); spec = file.markdown; specPath = file.relative;
      const missing = incompleteTaskSpec(spec);
      if (missing.length) reason = `Spec needs content: ${missing.join(', ')}`;
    } catch (error) { reason = error instanceof WorkspaceError ? error.message : 'Registered repository or specification is unreadable'; }
    const specReady = !!spec && !reason;
    let writer: WriterBinding | null = null;
    if (specReady && repo) {
      try { writer = await readWriterDossier(repo, task.links?.surface); }
      catch (error) { reason = error instanceof Error && !('code' in error) ? error.message.slice(0, 250) : 'Component dossier evidence is unavailable'; }
    }
    try {
      const routing = JSON.parse(await readFile(routingFile, 'utf8'));
      if (typeof routing.roles_model !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(routing.roles_model)) throw Error('invalid model');
      model = routing.roles_model;
    } catch { if (!reason) reason = 'Current model routing is unavailable'; }
    if (!STARTABLE.has(task.stage)) reason = 'This task is not ready for a new allocation';
    if (typeof task.owner !== 'string' || !task.owner.trim()) reason = 'Assign an integrating owner before starting this task';
    if (typeof task.agent === 'string' && task.agent.trim()) reason = 'Task already has an assigned agent; inspect its workspace before starting another';
    const expectedRevision = digest({ task: taskActionRevision(task), repo, specPath, spec: spec && digest(spec), model, writer });
    return { task, repo, spec, specPath, model, writer, expectedRevision, idempotencyKey: `task-${digest({ id, expectedRevision }).slice(0, 40)}`, specReady, canStart: specReady && !!model && !!writer && !reason, reason };
  };
  const workspace = (saved: Stored): WorkspaceSnapshot | null => {
    let receipt: WorkspaceReceipt;
    try { receipt = lifecycle.get(saved.workspaceId); } catch (error: any) { if (error.code === 'ENOENT') return null; throw new WorkspaceError('Workspace receipt is unavailable or invalid; no launch repeated', 503); }
    if (receipt.taskId !== saved.taskId || receipt.launchId !== saved.idempotencyKey || receipt.name !== saved.input.name || digest(receipt.input) !== digest(saved.input)) throw new WorkspaceError('Workspace belongs to a different allocation', 409);
    return snapshot(receipt);
  };
  /** Route-independent ownership: manual existing/retry requests cannot strip a saved allocation. */
  const automaticAllocationOwnership = async (receipt: WorkspaceReceipt): Promise<'ordinary' | 'automatic'> => {
    const input = receipt.input;
    const automaticShape = !!input.writer && [receipt.launchId, input.launchId].some(id => /^task-[a-f0-9]{40}$/.test(id));
    const id = [receipt.taskId, input.taskId].find(id => typeof id === 'string' && ID.test(id));
    const saved = id ? await readStored(id) : null;
    if (!saved) {
      if (automaticShape) throw new WorkspaceError('Automatic allocation provenance is missing; no launch attempted', 409);
      return 'ordinary';
    }
    const current = workspace(saved);
    if (!current || current.workspaceId !== receipt.workspaceId || saved.workspaceId !== receipt.workspaceId ||
        receipt.taskId !== saved.taskId || input.taskId !== saved.taskId || receipt.launchId !== saved.idempotencyKey ||
        input.launchId !== saved.idempotencyKey || receipt.name !== saved.input.name || digest(input) !== digest(saved.input) ||
        !automaticShape || input.harness !== 'codex' || input.workspace.type !== 'isolated') {
      throw new WorkspaceError('Automatic allocation provenance changed; no launch attempted', 409);
    }
    return 'automatic';
  };
  const publicStored = (saved: Stored, current: WorkspaceSnapshot | null) => ({ name: saved.input.name, expectedRevision: saved.expectedRevision, idempotencyKey: saved.idempotencyKey, workspace: current, taskUpdated: saved.boardUpdated, ...(saved.boardError ? { taskUpdateError: saved.boardError } : {}), ...(saved.error ? { error: saved.error } : {}) });
  const admission = async (ready: Ready, recovery = false): Promise<Admission> => {
    try {
      const result = await options.admit({ task: ready.task, repo: ready.repo!, model: ready.model!, recovery });
      return result?.ok === true ? { ok: true } : { ok: false, reason: result?.reason || 'Current resource admission did not allow a launch' };
    } catch { return { ok: false, reason: 'Current resource admission is unavailable' }; }
  };
  // Only a host that passed the caller's workspace/session identity gate can advance the task board.
  const recordActivation = async (id: string, receipt: WorkspaceReceipt) => locked(id, async () => {
    const saved = await readStored(id);
    if (!saved || saved.workspaceId !== receipt.workspaceId || saved.input.name !== receipt.name || saved.boardUpdated) return;
    const current = await readTask(id);
    if (current.stage === 'building' && current.agent === saved.input.name) { saved.boardUpdated = true; saved.boardRevision = taskActionRevision(current); delete saved.boardError; await persist(saved); return; }
    if (taskActionRevision(current) !== saved.taskRevision) { saved.boardError = 'Task changed after allocation; the connected workspace is retained without overwriting task changes'; await persist(saved); return; }
    const result = await options.write(id, { stage: 'building', agent: saved.input.name, reason: `Verified workspace ${saved.workspaceId} connected` });
    const updated = await readTask(id);
    if (result.status === 200 && result.body?.ok === true && updated.stage === 'building' && updated.agent === saved.input.name) {
      saved.boardUpdated = true; saved.boardRevision = taskActionRevision(updated); delete saved.boardError;
    } else saved.boardError = 'Agent connected, but the task update was not confirmed; retry reconciles without another launch';
    await persist(saved);
  });
  const adapters: LaunchAdapters = {
    beforeStart: options.adapters.beforeStart,
    start: options.adapters.start,
    find: async receipt => {
      const host = await options.adapters.find(receipt);
      if (host && receipt.taskId && ID.test(receipt.taskId)) void recordActivation(receipt.taskId, receipt).catch(async () => {
        // Board failure must not label a confirmed host as failed or trigger another start.
        await locked(receipt.taskId!, async () => { const saved = await readStored(receipt.taskId!); if (saved && !saved.boardUpdated) { saved.boardError = 'Agent connected; task reconciliation is unavailable'; await persist(saved); } }).catch(() => {});
      });
      return host;
    },
  };
  const failure = (error: unknown): Reply => ({ status: error instanceof WorkspaceError ? error.code : 503, body: { ok: false, error: error instanceof WorkspaceError ? error.message : 'Task allocation is unavailable; no unconfirmed success is reported' } });
  const readiness = async (id: string): Promise<Reply> => {
    try {
      const ready = await inspect(id), saved = await readStored(id);
      if (saved) {
        const current = workspace(saved);
        const changed = taskActionRevision(ready.task) !== saved.taskRevision && taskActionRevision(ready.task) !== saved.boardRevision;
        const scopeChanged = ready.expectedRevision !== saved.expectedRevision && !saved.boardUpdated;
        const retryable = !changed && !scopeChanged && (!current || ['preparing', 'ready', 'failed', 'starting'].includes(current.phase));
        const reconcile = !changed && current?.phase === 'active' && !saved.boardUpdated;
        const gate = retryable && ready.canStart ? await admission(ready, true) : { ok: false };
        return { status: 200, body: { specReady: ready.specReady, canStart: reconcile || retryable && gate.ok, action: 'retry', ...publicStored(saved, current), reason: changed || scopeChanged ? 'Task or specification changed; inspect its existing workspace before allocating again' : current?.phase === 'active' ? 'Workspace connected' : gate.reason || current?.error || `Workspace ${current?.phase ?? 'not yet accepted'}` } };
      }
      const gate = ready.canStart ? await admission(ready) : { ok: false };
      return { status: 200, body: { specReady: ready.specReady, canStart: ready.canStart && gate.ok, expectedRevision: ready.expectedRevision, idempotencyKey: ready.idempotencyKey, reason: ready.reason || gate.reason || '', model: ready.model } };
    } catch (error) { return failure(error); }
  };
  const allocate = async (id: string, body: unknown): Promise<Reply> => {
    if (!ID.test(id)) return failure(new WorkspaceError('Invalid task id', 400));
    if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(key => !['expectedRevision', 'idempotencyKey'].includes(key))) return failure(new WorkspaceError('Allocation accepts only its expected revision and idempotency key', 400));
    const request = body as Record<string, unknown>;
    if (typeof request.expectedRevision !== 'string' || !/^[a-f0-9]{64}$/.test(request.expectedRevision) || typeof request.idempotencyKey !== 'string' || !/^task-[a-f0-9]{40}$/.test(request.idempotencyKey)) return failure(new WorkspaceError('Read current task actions before allocating', 400));
    const expectedRevision = request.expectedRevision, idempotencyKey = request.idempotencyKey;
    try {
      return await locked(id, async () => {
        let saved = await readStored(id);
        if (saved && (saved.expectedRevision !== expectedRevision || saved.idempotencyKey !== idempotencyKey)) throw new WorkspaceError('A different allocation already owns this task', 409);
        let current = saved && workspace(saved);
        if (saved && current && ['active', 'cancelled', 'archived'].includes(current.phase)) {
          if (current.phase === 'active' && !saved.boardUpdated) {
            const receipt = lifecycle.get(saved.workspaceId);
            if (await options.adapters.find(receipt)) void recordActivation(id, receipt).catch(() => {});
          }
          return { status: current.phase === 'active' ? 200 : current.phase === 'cancelled' || current.phase === 'archived' ? 409 : 202, body: { ok: !['cancelled', 'archived'].includes(current.phase), accepted: true, ...publicStored(saved, current) } };
        }
        const ready = await inspect(id);
        if ((!saved && (ready.expectedRevision !== expectedRevision || ready.idempotencyKey !== idempotencyKey)) || (saved && taskActionRevision(ready.task) !== saved.taskRevision)) throw new WorkspaceError('Task or specification changed; refresh before allocating', 409);
        if (!ready.canStart) throw new WorkspaceError(ready.reason || 'Task specification is incomplete', 409);
        if (saved && (ready.repo !== saved.input.repo || ready.expectedRevision !== saved.expectedRevision)) throw new WorkspaceError('Allocation scope or routing changed; inspect its workspace before retry', 409);
        const gate = await admission(ready, !!saved);
        if (!gate.ok) throw new WorkspaceError(gate.reason!, 429);
        if ((await inspect(id)).expectedRevision !== ready.expectedRevision) throw new WorkspaceError('Task changed during resource admission; refresh before allocating', 409);
        if (!saved) {
          const name = `TASK-${id.slice(2, 44)}-${idempotencyKey.slice(-8)}`;
          const input: LaunchInput = { launchId: idempotencyKey, taskId: id, name, repo: ready.repo!, project: ready.task.project, harness: 'codex', model: ready.model!, workspace: { type: 'isolated' }, prompt: `You are a bounded worker for integrating owner ${ready.task.owner}. Work only on task ${id}: ${ready.task.title}. Preserve other agents and existing owners; do not start another standing owner, message people, or deploy. Keep the current phase plan and approved structure.\n\nShaan's words:\n${ready.task.his || '(not recorded)'}\n\nBuild the following accepted specification exactly. It was read from ${ready.specPath}; this snapshot is bound to revision ${ready.expectedRevision}. Report changed files, checks, evidence and remaining limits to the integrating owner through project-local records.\n\n${ready.spec}` };
          input.writer = ready.writer!;
          saved = { version: 1, taskId: id, expectedRevision: ready.expectedRevision, idempotencyKey: idempotencyKey, taskRevision: taskActionRevision(ready.task), input, workspaceId: `ws-${digest(id).slice(0, 24)}`, accepted: false, boardUpdated: false, createdAt: new Date().toISOString() };
          await persist(saved); // Durable intent precedes all workspace/process side effects.
        }
        try {
          current = current ? await lifecycle.retry(saved.workspaceId, adapters) : await lifecycle.launch(saved.input, adapters);
          const observed = workspace(saved);
          if (!observed || observed.workspaceId !== current.workspaceId) throw new WorkspaceError('Launch returned no verifiable workspace receipt', 503);
          saved.accepted = true; delete saved.error; await persist(saved);
          return { status: observed.phase === 'active' ? 200 : ['failed', 'cancelled', 'archived'].includes(observed.phase) ? 422 : 202, body: { ok: !['failed', 'cancelled', 'archived'].includes(observed.phase), accepted: true, ...publicStored(saved, observed) } };
        } catch {
          saved.error = 'Workspace launch was not confirmed; retry reconciles the same allocation without another identity'; await persist(saved);
          return { status: 503, body: { ok: false, accepted: saved.accepted, ...publicStored(saved, workspace(saved)) } };
        }
      });
    } catch (error) { return failure(error); }
  };
  return { readiness, allocate, automaticAllocationOwnership };
}
