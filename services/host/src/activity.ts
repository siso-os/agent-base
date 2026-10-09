/** Durable lifecycle metadata only; never prompts, tool arguments or raw provider errors. */
import { randomUUID } from 'node:crypto';
import { appendFileSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
export type ActivityUsage = { inputTokens: number | null; outputTokens: number | null; cacheReadInputTokens: number | null; cacheCreationInputTokens: number | null; cumulative: true };
export type ActivityRef = { machineId: string; hostKey: string; hostInstanceId: string; sessionId: string; runId: string; taskId?: string; workspaceId?: string };
export type ActivityEvent = { v: 1; id: string; seq: number; at: string; ref: ActivityRef; kind: 'run.started'|'run.completed'|'run.failed'|'run.cancelled'|'request.opened'|'request.resolved'|'runtime.failed'; request?: { id: string; kind: 'approval'|'input' }; pendingWakeWork?: number; usage?: ActivityUsage | null };
export function classifyClaudeResult(r: any, interrupted: boolean) { return interrupted ? 'cancelled' : r.is_error || (r.subtype && r.subtype !== 'success') ? 'failed' : 'completed'; }
export function classifyCodexTurn(r: any) { return r.status === 'completed' ? 'completed' : r.status === 'interrupted' ? 'cancelled' : 'failed'; }
export class ActivityJournal {
  readonly hostInstanceId: string;
  readonly journal: string;
  seq = 0;
  readonly events: ActivityEvent[] = [];
  healthy = true;
  ref: ActivityRef | null = null;
  private terminal = false;
  interrupted = false;
  constructor(hostKey: string, instance: string = randomUUID(), identity: { taskId?: string; workspaceId?: string } = {}) {
    this.hostInstanceId = instance;
    const hosts = process.env.AB_HOSTS_DIR ?? path.join(homedir(), '.local/state/agent-base/hosts');
    this.journal = path.join(process.env.AB_ACTIVITY_DIR ?? path.join(path.dirname(hosts), 'activity'), instance + '.jsonl');
    this.hostKey = hostKey;
    this.identity = identity;
  }
  private hostKey: string;
  private identity: { taskId?: string; workspaceId?: string };
  metadata() { return { hostInstanceId: this.hostInstanceId, activityJournal: this.journal, activityVersion: 1, activitySeq: this.seq, activityHealthy: this.healthy, activityRunId: this.ref?.runId ?? null }; }
  start(sessionId: string, runId: string = randomUUID(), usage: ActivityUsage | null = null) {
    if (this.ref?.runId === runId) return;
    this.ref = { machineId: process.env.AB_MACHINE_KEY ?? 'laptop', hostKey: this.hostKey, hostInstanceId: this.hostInstanceId, sessionId, runId, ...this.identity };
    this.terminal = false; this.interrupted = false; this.append('run.started', { usage });
  }
  request(id: string, kind: 'approval'|'input', opened: boolean) { if (this.ref) this.append(opened ? 'request.opened' : 'request.resolved', { request: { id, kind } }); }
  finish(outcome: 'completed'|'failed'|'cancelled', pendingWakeWork = 0, usage: ActivityUsage | null = null) {
    if (!this.ref || this.terminal) return;
    this.terminal = true; this.append(`run.${outcome}`, { pendingWakeWork, usage });
  }
  runtimeFailed(sessionId: string | null) {
    if (this.terminal) return;
    if (!this.ref) this.start(sessionId ?? 'unknown');
    this.terminal = true; this.append(this.interrupted ? 'run.cancelled' : 'runtime.failed');
  }
  private append(kind: ActivityEvent['kind'], extra: Partial<ActivityEvent> = {}) {
    const event: ActivityEvent = { ...extra, v: 1, id: `${this.hostInstanceId}:${++this.seq}`, seq: this.seq, at: new Date().toISOString(), ref: this.ref!, kind };
    this.events.push(event);if(this.events.length>1000)this.events.shift();
    try {
      mkdirSync(path.dirname(this.journal), { recursive: true, mode: 0o700 });
      // Keep the most recent lifecycle records. Sequence identity survives truncation and same-size rewrites.
      try { if (statSync(this.journal).size > 1024 * 1024) {
        const lines = readFileSync(this.journal, 'utf8').trimEnd().split('\n').slice(-1000);
        const temp=this.journal+'.tmp';writeFileSync(temp, lines.join('\n') + '\n', { mode: 0o600, flush: true });renameSync(temp,this.journal);
      } } catch (e: any) { if (e.code !== 'ENOENT') throw e; }
      appendFileSync(this.journal, JSON.stringify(event) + '\n', { mode: 0o600, flush: true }); this.healthy = true;
    } catch { this.healthy = false; console.error('activity: storage_unavailable'); }
  }
}
