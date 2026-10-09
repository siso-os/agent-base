export type RemoteInventoryKind = 'herdr' | 'managed-hosts' | 'codex-processes';
export type RemoteInventoryAgent = { id: string; machineKey: string; machineSession: string; machineUser?: string; name: string; harness: string; source?: RemoteInventoryKind; identity?: 'task-session' | 'process-only' | 'conflict'; taskSession?: string | null; processState?: 'observed' | 'not-observed' | 'unknown'; reportedState?: string; runtimeId?: string; runtimeParentId?: string | null; state: string; parentId: string | null; observedAt: number; stale: boolean; readOnly: true };
export type RemoteInventorySource = { machineKey: string; session: string; machineUser?: string; source?: RemoteInventoryKind; coverage?: string; diagnostics?: Record<string, number>; state: 'fresh' | 'stale' | 'unavailable'; attemptedAt: number; observedAt: number | null; agents: RemoteInventoryAgent[] };
export type RemoteInventorySnapshot = { enabled: boolean; configured: boolean; readOnly: true; at: number; coverage?: string; coverageComplete?: false; sources: RemoteInventorySource[] };
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const stamp = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 8.64e15;
const user = (v:unknown): v is string => typeof v==='string' && /^[a-z_][a-z0-9_-]{0,31}$/.test(v);
const sourceKind = (v: unknown): v is RemoteInventoryKind => ['herdr','managed-hosts','codex-processes'].includes(String(v));
const word = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= 2048;
export function parseRemoteInventory(value: unknown): RemoteInventorySnapshot {
  if (!object(value) || typeof value.enabled !== 'boolean' || typeof value.configured !== 'boolean' || value.readOnly !== true || !stamp(value.at) || !Array.isArray(value.sources) || value.sources.length > 32) throw new Error('Invalid inventory');
  if (value.coverageComplete !== undefined && value.coverageComplete !== false || value.coverage !== undefined && !word(value.coverage)) throw new Error('Invalid coverage');
  const sourceKeys = new Set<string>();
  const ids = new Set<string>();
  for (const source of value.sources) {
    if (!object(source) || !word(source.machineKey) || !word(source.session) || (source.machineUser!==undefined&&!user(source.machineUser)) || !['fresh','stale','unavailable'].includes(String(source.state)) || !stamp(source.attemptedAt) || !(source.observedAt === null || stamp(source.observedAt)) || !Array.isArray(source.agents) || source.agents.length > 2000) throw new Error('Invalid source');
    if (source.source !== undefined && !sourceKind(source.source) || source.coverage !== undefined && !word(source.coverage) || source.diagnostics !== undefined && (!object(source.diagnostics) || Object.values(source.diagnostics).some(v => !Number.isSafeInteger(v) || Number(v) < 0))) throw new Error('Invalid source coverage');
    const key = JSON.stringify(source.machineUser===undefined?[source.machineKey, source.session]:[source.machineKey, source.machineUser, source.session]);
    if (sourceKeys.has(key)) throw new Error('Ambiguous source');
    sourceKeys.add(key);
    for (const a of source.agents) {
      if (!object(a) || !word(a.id) || !a.id.startsWith('remote:') || ids.has(a.id) || !word(a.name) || !word(a.harness) || !word(a.state) || a.machineKey !== source.machineKey || a.machineSession !== source.session || a.machineUser !== source.machineUser || !(a.parentId === null || word(a.parentId)) || !stamp(a.observedAt) || typeof a.stale !== 'boolean' || a.readOnly !== true) throw new Error('Invalid agent');
      const kind = source.source ?? 'herdr';
      if (a.source !== undefined && a.source !== kind || a.identity !== undefined && !['task-session','process-only','conflict'].includes(String(a.identity)) || a.processState !== undefined && !['observed','not-observed','unknown'].includes(String(a.processState)) || a.taskSession !== undefined && a.taskSession !== null && !word(a.taskSession)) throw new Error('Invalid record identity');
      if (kind === 'codex-processes' && (!['process-only','conflict'].includes(String(a.identity)) || a.taskSession !== null || a.state !== 'unknown') || kind === 'managed-hosts' && (!['task-session','conflict'].includes(String(a.identity)) || !word(a.taskSession))) throw new Error('Invalid source record');
      ids.add(a.id);
    }
  }
  return value as unknown as RemoteInventorySnapshot;
}

export type RemoteInventoryRow = RemoteInventoryAgent & {
  kind: 'remote-inventory'; session: string; freshness: RemoteInventorySource['state'];
  children: RemoteInventoryRow[]; parentName: string | null;
};
export type RemoteInventoryGroup = {
  id: string; machineKey: string; session: string; machineUser?: string; state: RemoteInventorySource['state'];
  source: RemoteInventoryKind; coverage: string; diagnostics: Record<string, number>; recordCount: number; observedAt: number | null; attemptedAt: number; rows: RemoteInventoryRow[];
};
type SourceLabels = Pick<RemoteInventorySource, 'source' | 'session' | 'coverage' | 'diagnostics'>;
export function remoteSourceTitle(source: SourceLabels) {
  return source.source === 'managed-hosts' ? 'Managed host receipts' : source.source === 'codex-processes' ? 'Codex processes' : `Herdr session · ${source.session}`;
}
export function remoteSourceCoverage(source: SourceLabels) {
  return source.coverage ?? (source.source === 'managed-hosts'
    ? 'Default Agent Base host receipts for this account only. Custom host locations and other accounts are outside coverage.'
    : source.source === 'codex-processes' ? 'Codex executable processes for this account only. A process does not verify a task, session or model.'
    : 'This configured herdr session only. Independent jobs may exist outside it.');
}
export function remoteSourceEmpty(source: SourceLabels, state: RemoteInventorySource['state']) {
  if (state === 'unavailable') return 'No successful reading for this source. Job coverage is unknown.';
  if (state === 'stale') return 'The last reading contained no records. Current activity is unknown.';
  if (source.source === 'managed-hosts') return source.diagnostics?.directoryAbsent
    ? 'Default host receipt directory absent. Jobs may use other locations or run without managed receipts.'
    : 'No valid managed session receipts found in the default directory. This does not establish that no jobs exist.';
  if (source.source === 'codex-processes') return 'No eligible Codex executable processes observed in this account. Other jobs are outside this source.';
  return 'No agents were reported in this herdr session. Independent jobs are outside this source.';
}
export function remoteRecordLabel(row: Pick<RemoteInventoryAgent, 'source' | 'identity' | 'harness'>) {
  if (row.identity === 'conflict') return 'Conflicting identity · task state unverified';
  if (row.source === 'codex-processes' || row.identity === 'process-only') return 'Codex process · task/session/model unverified';
  if (row.identity === 'task-session') return `Identified session · ${row.harness === 'unknown' ? 'harness unverified' : row.harness}`;
  return `Herdr agent record · ${row.harness}`;
}
export function remoteRecordState(row: Pick<RemoteInventoryRow, 'identity' | 'state' | 'processState' | 'stale'>) {
  if (row.identity === 'process-only') return row.processState === 'observed' && !row.stale ? 'Process observed' : 'Unknown';
  return row.stale || row.state === 'unknown' ? 'Unknown' : row.state;
}
export function remoteRecordSummary(groups: RemoteInventoryGroup[]) {
  let agents = 0, sessions = 0, processes = 0, unknown = 0;
  function count(rows: RemoteInventoryRow[]) { for (const row of rows) {
    if (row.identity === 'process-only') processes++;
    else if (row.identity === 'task-session') sessions++;
    else if (row.identity === 'conflict') unknown++;
    else agents++;
    count(row.children);
  } }
  for (const group of groups) count(group.rows);
  return [[agents, 'herdr record'], [sessions, 'identified session'], [processes, 'process observation'], [unknown, 'unverified record']]
    .filter(([count]) => Number(count) > 0).map(([count, label]) => `${count} ${label}${count === 1 ? '' : 's'}`).join(' · ') || 'No records in the observed sources';
}
/** Read-only owner/navigation projection. Never convert these IDs to local agent or terminal IDs.
 * No owner is inferred from a name: only an explicit parent in this same machine/session is linked.
 */
export function projectRemoteInventory(snapshot: RemoteInventorySnapshot | null, now = Date.now(), failed = false) {
  const coverage = snapshot?.sources.some(s => s.source && s.source !== 'herdr') ? 'configured-sources-only' as const : 'configured-sessions-only' as const;
  if (!snapshot) return { coverage, groups: [] as RemoteInventoryGroup[], count: 0 };
  const data = parseRemoteInventory(snapshot);
  if (!data.enabled || !data.configured) return { coverage, groups: [] as RemoteInventoryGroup[], count: 0 };
  const groups = data.sources.map(source => {
    const expired = source.observedAt !== null && (now < source.observedAt || now - source.observedAt >= 60_000);
    const state: RemoteInventorySource['state'] = source.state === 'unavailable' || source.observedAt === null ? 'unavailable' : failed || expired ? 'stale' : source.state;
    const byId = new Map(source.agents.map(a => [a.id, a]));
    const rows = source.agents.map(agent => {
      const kind = source.source ?? 'herdr';
      const parent = agent.parentId ? byId.get(agent.parentId) : undefined;
      // A process parent is process ancestry, not verified task ownership. Unknown/conflicting owners stay top-level.
      const identified = (a: RemoteInventoryAgent) => kind === 'herdr' ? !a.identity || a.identity === 'task-session' : a.identity === 'task-session';
      let parentId = parent && identified(agent) && identified(parent) ? parent.id : null;
      const seen = new Set([agent.id]);
      let cursor = parentId;
      while (cursor && byId.has(cursor)) {
        if (seen.has(cursor)) { parentId = null; break; }
        seen.add(cursor); cursor = byId.get(cursor)!.parentId;
      }
      return { ...agent, source: kind, kind: 'remote-inventory' as const, session: source.session, parentId,
        parentName: parentId ? byId.get(parentId)!.name : null, freshness: state,
        stale: state !== 'fresh' || agent.stale, state: state === 'fresh' && !agent.stale && agent.identity !== 'process-only' && agent.identity !== 'conflict' ? agent.state : 'unknown', processState: state === 'fresh' ? agent.processState : 'unknown', children: [] as RemoteInventoryRow[] };
    });
    const projected = new Map(rows.map(a => [a.id, a]));
    for (const row of rows) if (row.parentId) projected.get(row.parentId)!.children.push(row);
    return { id: `remote-scope:${encodeURIComponent(JSON.stringify(source.machineUser===undefined?[source.machineKey, source.session]:[source.machineKey, source.machineUser, source.session]))}`,
      machineKey: source.machineKey, session: source.session, ...(source.machineUser===undefined?{}:{machineUser:source.machineUser}), state, observedAt: source.observedAt,
      source: source.source ?? 'herdr', coverage: remoteSourceCoverage(source), diagnostics: source.diagnostics ?? {}, recordCount: source.agents.length, attemptedAt: source.attemptedAt, rows: rows.filter(row => !row.parentId) } as RemoteInventoryGroup;
  });
  return { coverage, groups, count: data.sources.reduce((n, source) => n + source.agents.length, 0) };
}
