import { readSleepHost, wakeRunner } from './idle-sleep.ts';
/** Managed children are full service-runner conversations. Each parent owns one ledger and only its children.
 * Uses existing host admission queues, task events and workspace preparation; no native SDK task control claims. */
import { spawn, type ChildProcess } from 'node:child_process';
import { createHash, randomUUID, randomBytes } from 'node:crypto';
import { existsSync, readFileSync, realpathSync, mkdirSync, openSync, writeFileSync, fsyncSync, closeSync, renameSync } from 'node:fs';
import { dropTemp, persist } from './disk.ts';
import { homedir } from 'node:os';
import path from 'node:path';
import { WebSocket } from 'ws';
import type { ChatEvent, Task } from './host.ts';
import type { QueueSnapshot, PromptReceipt } from './delivery.ts';
import { validateChildReturnCommand, type ChildReturnCommand, type PendingChildReturn } from './child-return.ts';

export const childIdentity = () => process.env.AB_CHILD_ID ? {
  childId: process.env.AB_CHILD_ID, parentSession: process.env.AB_PARENT_SESSION,
  parentName: process.env.AB_PARENT_NAME, taskId: process.env.AB_TASK_ID, workspaceId: process.env.AB_WORKSPACE_ID, depth: 1,
} : undefined;
const hostsDir = () => process.env.AB_HOSTS_DIR ?? path.join(homedir(), '.local/state/agent-base/hosts');
const ledger = (session: string) => path.join(hostsDir(), '.children', createHash('sha256').update(session).digest('hex') + '.json');
export type CodexChild = {
  id: string; name: string; hostName: string; model: string; effort: string; cwd: string;
  parentSession: string; controlToken: string; session: string | null; status: string; startedAt: number; endedAt: number | null;
  tokens: number; tools: number; rate: number; last: string | null; summary: string | null;
  resultAt: number; returnedAt: number; workspaceReceipt?: string;
  resultId?: string; legacyReturnedResultId?: string; pendingReturns?: PendingChildReturn[]; returnReceipts?: Record<string, PromptReceipt>;
  taskId?: string; workspaceId?: string;
};
export function readChildren(session: string | null): CodexChild[] {
  if (!session || !existsSync(ledger(session))) return [];
  const data = JSON.parse(readFileSync(ledger(session), 'utf8'));
  if (data.version !== 1 || data.parentSession !== session || !Array.isArray(data.children)) throw Error('Invalid child ledger');
  const children: CodexChild[] = data.children.filter((c: CodexChild) => c.parentSession === session && /^child-[a-f0-9-]{36}$/.test(c.id)
    && c.hostName === `${c.name}-${c.id.slice(-8)}` && /^[A-Za-z0-9_-]{1,48}$/.test(c.name));
  for (const c of children) {
    if ([c.resultId, c.legacyReturnedResultId].some(id => id !== undefined && !/^[a-f0-9]{64}$/.test(id))) throw Error('Invalid child result identity');
    if (c.pendingReturns !== undefined && !Array.isArray(c.pendingReturns)) throw Error('Invalid pending child returns');
    if (new Set((c.pendingReturns ?? []).map(p => p.resultId)).size !== (c.pendingReturns ?? []).length) throw Error('Duplicate pending child return');
    for (const pending of c.pendingReturns ?? []) {
      if (pending.parentSession !== session || !/^[a-f0-9]{64}$/.test(pending.resultId) || !Number.isFinite(pending.at)
        || typeof pending.ok !== 'boolean' || typeof pending.summary !== 'string' || pending.command?.key !== `${c.id}-return-${pending.resultId}`) throw Error('Invalid pending child return');
      validateChildReturnCommand(pending.command);
    }
    if (c.returnReceipts !== undefined && (!c.returnReceipts || typeof c.returnReceipts !== 'object' || Array.isArray(c.returnReceipts)
      || Object.entries(c.returnReceipts).some(([id, receipt]) => !/^[a-f0-9]{64}$/.test(id) || !admitted(receipt, `${c.id}-return-${id}`)))) throw Error('Invalid child return receipts');
  }
  return children;
}
function admitted(receipt: PromptReceipt, key: string) {
  return receipt?.t === 'prompt.receipt' && receipt.key === key && receipt.id === key && Number.isSafeInteger(receipt.queueRevision)
    && receipt.queueRevision > 0 && ['saved','dispatching','offered','accepted','started','cancelled','unknown'].includes(receipt.phase);
}
const text = (v: unknown, field: string, max = 32768) => {
  if (typeof v !== 'string' || !v.trim() || Buffer.byteLength(v) > max) throw Error(`Invalid ${field}`);
  return v;
};
export const childTools = [
  { name: 'spawn_codex', description: 'Start a full hosted Codex child; returns immediately. Read-only by default. For code edits use worktree:true. For source-only work, defer_install:true skips the automatic dependency install; the child must install before checks that need dependencies. Repository-owned setup recipes cannot be skipped. Continue the same child with message_codex. Children return automatically; never poll in a shell loop. Explicit task_id is retained for attribution.', properties: { name: { type: 'string' }, brief: { type: 'string' }, cwd: { type: 'string' }, model: { type: 'string', default: 'gpt-6.1-sol' }, effort: { type: 'string' }, worktree: { type: 'boolean' }, defer_install: { type: 'boolean' }, task_id: { type: 'string' } }, required: ['name','brief'] },
  { name: 'message_codex', description: 'Queue a follow-up to your own child, retaining its conversation. Accepted means admitted, not completed.', properties: { id: { type: 'string' }, text: { type: 'string' } }, required: ['id','text'] },
  { name: 'codex_status', description: 'Read your children: state, last step, token count and last answer.', properties: { id: { type: 'string' } }, required: [] },
  { name: 'stop_codex', description: 'Interrupt only your selected child turn and hold queued messages. Completion is observed separately.', properties: { id: { type: 'string' } }, required: ['id'] },
];
export const dynamicChildTools = () => childIdentity() ? [] : childTools.map(t => ({ type: 'function', name: t.name, description: t.description,
  inputSchema: { type: 'object', properties: t.properties, required: t.required, additionalProperties: false } }));

type Owner = { name: string; session: () => string | null; emit: (e: ChatEvent) => void; task: (t: Task) => void; returned: (command: ChildReturnCommand) => Promise<PromptReceipt> };
type Connection = { ws: WebSocket; host: any; queue?: QueueSnapshot; active: boolean; requests: Map<string, { resolve: (v: any) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }> };
export class CodexChildren {
  private children = new Map<string, CodexChild>();
  private connections = new Map<string, Connection>();
  private runners = new Map<string, ChildProcess>();
  private initialized = false;
  private closing = false;
  private parentSession: string | null = null;
  private returning = new Set<string>();
  private returnRetries = new Map<string, ReturnType<typeof setTimeout>>();
  private owner: Owner;
  constructor(owner: Owner) { this.owner = owner; }
  private save() {
    const session = this.owner.session();
    if (!session || this.parentSession && session !== this.parentSession) throw Error('Parent session changed');
    const file = ledger(session), data = { version: 1, parentSession: session, children: [...this.children.values()] };
    mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    const tmp = `${file}.${process.pid}.tmp`, body = JSON.stringify(data);
    // t-0504: no space keeps the children in memory and saves the ledger when there is room.
    persist('children:' + file, () => {
      try {
        const fd = openSync(tmp, 'w', 0o600);
        try { writeFileSync(fd, body); fsyncSync(fd); } finally { closeSync(fd); }
        renameSync(tmp, file);
      } catch (e) { dropTemp(tmp); throw e; }
      const dir = openSync(path.dirname(file), 'r'); try { fsyncSync(dir); } finally { closeSync(dir); }
    });
  }
  private publish(c: CodexChild) {
    this.save(); this.publishTask(c);
  }
  private publishTask(c: CodexChild) {
    this.owner.task({ id: c.id, tool: c.id, kind: 'codex', description: c.name, hostName: c.hostName, model: c.model,
      background: true, status: c.status === 'starting' ? 'pending' : ['blocked','stop_requested'].includes(c.status) ? 'running' : c.status, startedAt: c.startedAt, endedAt: c.endedAt, tokens: c.tokens, tools: c.tools, last: c.last, summary: c.summary });
  }
  async restore() {
    if (this.initialized || childIdentity()) return;
    if (!this.owner.session()) throw Error('Parent has no session');
    this.parentSession = this.owner.session();
    this.initialized = true;
    const restored = readChildren(this.parentSession);
    for (const c of restored) this.children.set(c.id, c);
    for (const c of restored) {
      this.owner.emit({ t: 'tool', id: c.id, name: 'Agent', summary: c.name, input: { description: c.name }, at: c.startedAt });
      this.publish(c);
      // A durable result can be reconciled even when its child host is gone.
      void this.flushReturns(c);
      void this.connect(c).catch(() => { c.status = 'unknown'; this.publish(c); });
    }
  }
  async call(tool: string, input: any): Promise<unknown> {
    if (childIdentity() || this.closing) throw Error('Child spawning/control is unavailable');
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw Error('Invalid tool input');
    const spec = childTools.find(t => t.name === tool);
    if (!spec || Object.keys(input).some(k => !Object.hasOwn(spec.properties, k))) throw Error('Unsupported child tool/input');
    await this.restore();
    if (tool === 'spawn_codex') {
      const name = text(input.name, 'name', 48);
      if (!/^[A-Za-z0-9_-]{1,48}$/.test(name)) throw Error('Invalid child name');
      const brief = text(input.brief, 'brief');
      const model = input.model ?? 'gpt-6.1-sol', effort = input.effort ?? 'medium';
      if (model !== 'gpt-6.1-sol' || !['none','minimal','low','medium','high','xhigh'].includes(effort)) throw Error('Child routing requires gpt-6.1-sol and a valid effort');
      if (input.worktree !== undefined && typeof input.worktree !== 'boolean') throw Error('Invalid worktree option');
      if (input.defer_install !== undefined && typeof input.defer_install !== 'boolean') throw Error('Invalid deferred install option');
      if (input.defer_install && !input.worktree) throw Error('Deferred install requires worktree:true');
      if (input.task_id !== undefined && (typeof input.task_id !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(input.task_id))) throw Error('Invalid task_id');
      if ([...this.children.values()].filter(c => ['starting','running','blocked','stop_requested'].includes(c.status)).length >= 8 || this.children.size >= 200) throw Error('Child capacity reached');
      const cwd = realpathSync(input.cwd === undefined ? process.cwd() : text(input.cwd, 'cwd', 4096));
      const id = `child-${randomUUID()}`;
      const c: CodexChild = { id, name, hostName: `${name}-${id.slice(-8)}`, model, effort, cwd, parentSession: this.owner.session()!, controlToken: randomBytes(24).toString("base64url"), session: null, taskId: input.task_id,
        status: 'starting', startedAt: Date.now(), endedAt: null, tokens: 0, tools: 0, rate: 0, last: 'Starting hosted chat', summary: null, resultAt: 0, returnedAt: 0 };
      this.children.set(id, c); this.publish(c);
      this.owner.emit({ t: 'tool', id, name: 'Agent', summary: name, input: { description: name }, at: c.startedAt });
      void this.launch(c, brief, input.worktree === true, input.defer_install === true).catch(e => {
        c.status = 'failed'; c.last = (e as Error).message; c.summary = 'Child launch failed'; c.endedAt = Date.now();
        c.summary = `${c.name} failed to start: ${c.last}`;
        c.resultAt = c.endedAt; c.resultId = this.resultIdentity(c, 'launch-failed');
        void this.returnResult(c); this.publish(c);
      });
      return { id, name, state: 'starting', open: `service-${c.hostName}` };
    }
    if (tool === 'codex_status') return input.id === undefined ? [...this.children.values()].map(c => this.public(c)) : this.public(this.owned(input.id));
    const c = this.owned(input.id);
    if (tool === 'message_codex' && !this.connections.has(c.id)) await this.connect(c, true);
    const connection = this.connections.get(c.id);
    if (!connection || connection.ws.readyState !== WebSocket.OPEN) throw Error('Child runtime unavailable; no command sent');
    if (tool === 'message_codex') {
      const followup = text(input.text, 'text');
      if (c.status === 'stop_requested') throw Error('Child stop is pending');
      if (connection.queue?.held) {
        if (c.status !== 'stopped' || connection.queue.entries.some(e => e.phase === 'saved')) throw Error('Child queue held; resolve it explicitly in its chat');
        await this.request(connection, { t: 'queue.resume', key: randomUUID(), expectedRevision: connection.queue.revision });
      }
      const key = randomUUID();
      const receipt = await this.request(connection, { t: 'prompt', key, messageId: key, text: followup, delivery: 'next', images: [] });
      c.status = 'running'; c.endedAt = null; c.last = 'Follow-up admitted'; this.publish(c);
      return { id: c.id, outcome: receipt.phase, messageId: key };
    }
    if (tool === 'stop_codex') {
      if (!connection.active) return { id: c.id, outcome: 'already_finished', state: c.status };
      const prior = c.status; c.status = 'stop_requested'; this.publish(c);
      try { return await this.request(connection, { t: 'interrupt', key: randomUUID(), expectedTurnId: connection.host.activeTurnId }); }
      catch (e) { c.status = prior; c.last = 'Stop could not be confirmed'; this.publish(c); throw e; }
    }
    throw Error('Unsupported child tool');
  }
  private owned(id: unknown) {
    const c = this.children.get(text(id, 'id', 128));
    if (!c || c.parentSession !== this.owner.session()) throw Error('Child not owned by this parent');
    return c;
  }
  private public(c: CodexChild) { return { id: c.id, name: c.name, state: c.status, taskId: c.taskId, workspaceId: c.workspaceId, last: c.last, tokens: c.tokens, lastMessage: c.summary, open: `service-${c.hostName}` }; }
  private async launch(c: CodexChild, brief: string, worktree: boolean, deferInstall = false) {
    if (worktree) {
      const { acceptLaunch, withLaunch, receiptFile, save } = await import('../../node/src/worktrees.ts');
      const r = await acceptLaunch({ launchId: c.id, taskId: c.taskId, name: c.hostName, repo: c.cwd, harness: 'codex', model: c.model, workspace: { type: 'isolated' }, ...(deferInstall ? { deferDefaultInstall: true } : {}) });
      c.workspaceId = r.workspaceId;
      await withLaunch(r, async prepared => { c.cwd = prepared.worktreePath; c.workspaceReceipt = receiptFile(r.workspaceId); prepared.phase = 'starting'; prepared.handoffAttempted = true; prepared.agent = { name: c.hostName }; save(prepared); this.save(); });
      if (!c.workspaceReceipt) throw Error('Worktree preparation failed; no host launched');
    }
    if (this.closing) return;
    const env: NodeJS.ProcessEnv = { ...process.env, HERDR_ENV: '0', AB_CHILD_ID: c.id, AB_PARENT_SESSION: c.parentSession, AB_PARENT_NAME: this.owner.name, AB_PARENT_CONTROL_TOKEN: c.controlToken };
    delete env.AB_TASK_ID; delete env.AB_WORKSPACE_ID;
    if (c.taskId) env.AB_TASK_ID = c.taskId;
    if (c.workspaceId) env.AB_WORKSPACE_ID = c.workspaceId;
    delete env.AB_SERVICE_NAME; delete env.AB_SERVICE_LABEL; delete env.AB_SEAT_FILE; delete env.AB_WORKSPACE_RECEIPT; delete env.AB_WRITER_MEASUREMENT_RECEIPT;
    if (c.workspaceReceipt) env.AB_WORKSPACE_RECEIPT = c.workspaceReceipt;
    const runner = spawn(process.execPath, ['--experimental-strip-types','--no-warnings',path.join(import.meta.dirname, 'service-runner.ts'), '--harness','codex','--name',c.hostName,'--model',c.model,'--effort',c.effort,'--lead',this.owner.name,
      '--sandbox', worktree ? 'workspace-write' : 'read-only', '--approval','never'], { cwd: c.cwd, env, detached: true, stdio: ['ignore','ignore','ignore'] });
    this.runners.set(c.id, runner);
    runner.on('error', () => { c.status = 'failed'; c.last = 'Child runner could not start'; this.publish(c); });
    runner.on('exit', () => { if (!this.closing) { c.status = 'unknown'; c.last = 'Child runner exited'; this.publish(c); } });
    await this.connect(c);
    if (this.closing) return;
    if (c.workspaceReceipt) {
      const { readWorkspaceReceipt } = await import('./worktree-contract.ts');
      const { save } = await import('../../node/src/worktrees.ts');
      const receipt = readWorkspaceReceipt(c.workspaceReceipt);
      receipt.phase = 'active'; receipt.agentId = `service-${c.hostName}`; receipt.agent = { name: c.hostName, session: c.session! };
      const stage = receipt.stages.find(s => s.id === 'agent')!; stage.status = 'done'; stage.startedAt ??= c.startedAt; stage.endedAt = Date.now(); stage.exitCode = 0; save(receipt);
    }
    const conn = this.connections.get(c.id)!;
    const key = `${c.id}-brief`;
    await this.request(conn, { t: 'prompt', key, messageId: key, text: deferInstall ? 'Dependency installation was explicitly deferred for this isolated workspace. Run the required install before any check that needs dependencies.\n\n' + brief : brief, delivery: 'next', images: [] });
  }
  private async connect(c: CodexChild, wake = false) {
    if (this.connections.has(c.id)) return;
    let host: any;
    for (let n = 0; n < 120 && !this.closing; n++) {
      try {
        host = JSON.parse(readFileSync(path.join(hostsDir(), `name-${c.hostName}.json`), 'utf8'));
        if (host.parentSession !== c.parentSession || host.childId !== c.id || host.name !== c.hostName || (c.session && host.session !== c.session)) throw Error('Child identity changed');
        if (host.state === 'asleep') {
          if (!wake) return; // Watching a completed child never wakes it.
          host = await wakeRunner(path.join(hostsDir(), `name-${c.hostName}.json`));
          if (host.parentSession !== c.parentSession || host.childId !== c.id) throw Error('Child identity changed');
        }
        const health = await fetch(`http://127.0.0.1:${host.port}/health`, { signal: AbortSignal.timeout(1000) });
        if (health.ok && (await health.json()).pid === host.pid) break;
        host = null;
      } catch (e) { if ((e as Error).message === 'Child identity changed') throw e; host = null; }
      await new Promise(r => setTimeout(r, 250));
    }
    if (!host || this.closing) throw Error('Child host not observed');
    c.session = host.session;
    const ws = new WebSocket(`ws://127.0.0.1:${host.port}/ws?token=${host.token}&controller=${c.controlToken}`);
    const conn: Connection = { ws, host, active: false, requests: new Map() };
    this.connections.set(c.id, conn);
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(Error('Child hello timed out')), 5000);
      ws.on('message', raw => {
        let e: any; try { e = JSON.parse(String(raw)); } catch { return; }
        if (e.t === 'hello') {
          if (e.session !== c.session) { clearTimeout(timer); reject(Error('Child context changed')); ws.close(); return; }
          conn.queue = e.queue; conn.host.activeTurnId = e.capabilities?.activeTurnId; conn.active = !!conn.host.activeTurnId;
          const lastIndex = e.log.findLastIndex((x: any) => x.t === 'result'), last = e.log[lastIndex];
          if (last) {
            const previous = e.log.slice(0, lastIndex).findLastIndex((x: any) => x.t === 'result');
            c.summary = e.log.slice(previous + 1, lastIndex).filter((x: any) => x.t === 'text' && !x.parent).at(-1)?.text ?? null;
            this.observeResult(c, last, true);
          }
          if (conn.active) { c.status = 'running'; c.endedAt = null; }
          clearTimeout(timer); void this.returnResult(c, conn); this.publish(c); resolve();
        } else this.event(c, conn, e);
      });
      ws.once('error', () => { clearTimeout(timer); reject(Error('Child connection failed')); });
      ws.once('close', () => {
        clearTimeout(timer); reject(Error('Child connection closed'));
        this.connections.delete(c.id);
        for (const r of conn.requests.values()) { clearTimeout(r.timer); r.reject(Error('Child admission uncertain')); }
        try {
          const sleeping = readSleepHost(path.join(hostsDir(), `name-${c.hostName}.json`));
          if (sleeping.state === 'asleep' && sleeping.childId === c.id && sleeping.parentSession === c.parentSession) return;
        } catch {}
        if (!this.closing) { c.status = 'unknown'; this.publish(c); setTimeout(() => { void this.connect(c).catch(() => {}); }, 1000).unref(); }
      });
    });
  }
  private request(conn: Connection, message: any): Promise<any> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { conn.requests.delete(message.key); reject(Error('Child admission uncertain')); }, 10000);
      conn.requests.set(message.key, { resolve, reject, timer });
      conn.ws.send(JSON.stringify(message), e => { if (e) { clearTimeout(timer); conn.requests.delete(message.key); reject(Error('Child transport failed')); } });
    });
  }
  private event(c: CodexChild, conn: Connection, e: any) {
    if (e.t === 'prompt.receipt' || e.t === 'child.stop_receipt') {
      const pending = conn.requests.get(e.key);
      if (pending) { clearTimeout(pending.timer); conn.requests.delete(e.key); e.phase === 'failed' || e.outcome === 'failed' ? pending.reject(Error(e.text ?? 'Child command failed')) : pending.resolve(e); }
    }
    if (e.t === 'queue.snapshot') { conn.queue = e.snapshot; conn.host.activeTurnId = e.capabilities?.activeTurnId; conn.active = !!conn.host.activeTurnId; void this.returnResult(c, conn); }
    if (e.t === 'state' && e.state === 'working') { conn.active = true; c.status = 'running'; c.endedAt = null; this.publish(c); }
    if (e.t === 'state' && e.state === 'blocked') { c.status = 'blocked'; this.publish(c); }
    if (e.t === 'usage') { c.tokens = e.total ?? e.out; c.rate = e.rate ?? e.out / Math.max(1, (Date.now() - c.startedAt) / 1000); this.publish(c); }
    if (e.t === 'tool') { c.tools++; c.last = `${e.name} ${e.summary}`.slice(0,160); this.publish(c); }
    if (e.t === 'text' && !e.parent) { c.summary = e.text; }
    if (e.t === 'user' && e.from === 'app') { c.last = `Shaan wrote to ${c.name}`; this.publish(c); this.owner.emit({ t: 'note', text: c.last, at: Date.now() }); }
    if (e.t === 'result') {
      conn.active = false; this.observeResult(c, e);
      void this.returnResult(c, conn); this.publish(c);
    }
  }
  private resultIdentity(c: CodexChild, turn: string) {
    return createHash('sha256').update(JSON.stringify([c.id, c.session, turn])).digest('hex');
  }
  private observeResult(c: CodexChild, e: { at: number; status?: string; turnId?: string }, replay = false) {
    const identified = typeof e.turnId === 'string' && !!e.turnId;
    if (!identified && e.at <= c.resultAt) return;
    const id = this.resultIdentity(c, identified ? `turn:${e.turnId}` : `legacy:${e.at}`);
    if (c.resultId === id) return;
    // Old acknowledgements cannot prove delivery, but replaying them could duplicate
    // parent work. Preserve them on migration; do not auto-repair historical losses.
    if (replay && !c.resultId && c.returnedAt >= c.resultAt && e.at <= c.returnedAt) c.legacyReturnedResultId = id;
    c.resultId = id; c.resultAt = e.at;
    c.status = e.status === 'interrupted' ? 'stopped' : e.status === 'failed' ? 'failed' : 'done'; c.endedAt = e.at;
  }
  private async returnResult(c: CodexChild, conn?: Connection) {
    if (this.closing || c.parentSession !== this.owner.session()) return;
    // Capture each settled result before waiting for an earlier admission. Its body
    // and key never change when a new child result or a new parent turn arrives.
    if ((!conn || !conn.active && conn.queue && !conn.requests.size
      && !conn.queue.entries.some(e => ['saved','dispatching','offered'].includes(e.phase))) && c.resultAt) {
      const id = c.resultId ?? this.resultIdentity(c, `legacy:${c.resultAt}`);
      const legacyDone = !c.resultId && c.returnedAt >= c.resultAt || c.legacyReturnedResultId === id;
      if (!legacyDone && !c.returnReceipts?.[id] && !c.pendingReturns?.some(p => p.resultId === id)) {
        const summary = (c.summary ?? 'No final message').split(/\s+/).slice(0,200).join(' ');
        const escape = (s: string) => s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
        const link = '/#at=' + encodeURIComponent(JSON.stringify({ s: 'agents', v: { kind: 'tab', id: `service-${c.hostName}` }, a: `service-${c.hostName}`, o: null }));
        const message = `<task-notification><task-id>${c.id}</task-id><tool-use-id>${c.id}</tool-use-id><status>${c.status === 'done' ? 'completed' : c.status}</status><summary>Agent "${c.name}" returned</summary><output>${escape(`${c.name} returned (${c.status}): ${summary}\nopen: ${link}`)}</output></task-notification>`;
        const key = `${c.id}-return-${id}`;
        const pending: PendingChildReturn = { parentSession: c.parentSession, resultId: id, at: c.resultAt, ok: c.status === 'done', summary,
          command: { t: 'prompt', text: message, key, messageId: key, images: [], delivery: 'auto', from: 'pane' } };
        const before = c.pendingReturns;
        c.pendingReturns = [...(before ?? []), pending];
        try { this.save(); } catch { c.last = 'Parent return could not be saved'; this.publishTask(c); this.retryReturn(c); return; }
      }
    }
    await this.flushReturns(c);
  }
  private async flushReturns(c: CodexChild) {
    if (this.closing || this.returning.has(c.id) || c.parentSession !== this.owner.session()) return;
    this.returning.add(c.id);
    const retry = this.returnRetries.get(c.id); if (retry) clearTimeout(retry); this.returnRetries.delete(c.id);
    try {
      while (!this.closing && c.pendingReturns?.length && c.parentSession === this.owner.session()) {
        const pending = c.pendingReturns[0];
        if (pending.parentSession !== this.owner.session()) throw Error('Parent session changed');
        // Also covers an earlier staging write failure: no in-memory envelope
        // becomes dispatchable until its exact body is durably stored.
        this.save();
        const receipt = await this.owner.returned(structuredClone(pending.command));
        if (!admitted(receipt, pending.command.key)) throw Error('Parent admission receipt missing');
        if (pending.parentSession !== this.owner.session()) throw Error('Parent session changed');
        const previous = { pendingReturns: c.pendingReturns, returnReceipts: c.returnReceipts, returnedAt: c.returnedAt, last: c.last };
        c.pendingReturns = c.pendingReturns.filter(p => p.resultId !== pending.resultId);
        c.returnReceipts = { ...c.returnReceipts, [pending.resultId]: structuredClone(receipt) };
        c.returnedAt = Math.max(c.returnedAt, pending.at);
        c.last = receipt.phase === 'unknown' ? 'Parent return admitted; delivery unknown' : receipt.phase === 'cancelled' ? 'Parent return admitted; cancelled in parent queue' : 'Parent return admitted';
        try { this.save(); } catch (error) { Object.assign(c, previous); throw error; }
        this.publishTask(c);
        this.owner.emit({ t: 'tool_done', id: c.id, ok: pending.ok, out: pending.summary, at: pending.at });
      }
    } catch {
      c.last = 'Parent return admission unconfirmed';
      // The already-durable envelope is retained. Retry only exact admission;
      // parent reconciliation never replays a provider send.
      if (!this.closing && c.parentSession === this.owner.session()) {
        try { this.publish(c); } catch { /* Keep the durable pending record. */ }
        this.retryReturn(c);
      }
    } finally { this.returning.delete(c.id); }
  }
  private retryReturn(c: CodexChild) {
    if (this.closing || c.parentSession !== this.owner.session() || this.returnRetries.has(c.id)) return;
    const timer = setTimeout(() => { this.returnRetries.delete(c.id); void this.flushReturns(c); }, 1000);
    timer.unref(); this.returnRetries.set(c.id, timer);
  }
  async close() {
    this.closing = true;
    for (const timer of this.returnRetries.values()) clearTimeout(timer); this.returnRetries.clear();
    for (const conn of this.connections.values()) { for (const r of conn.requests.values()) { clearTimeout(r.timer); r.reject(Error('Parent stopping')); } conn.ws.close(); }
    await Promise.all([...this.runners.values()].map(p => new Promise<void>(resolve => {
      if (p.exitCode !== null || p.signalCode) return resolve();
      const timer = setTimeout(() => resolve(), 5000); timer.unref();
      p.once('exit', () => { clearTimeout(timer); resolve(); }); p.kill('SIGTERM');
    })));
  }
}
