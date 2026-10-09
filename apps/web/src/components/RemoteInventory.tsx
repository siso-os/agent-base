import { useId } from 'react';
import { useRemoteInventory } from '../lib/useRemoteInventory';
import { projectRemoteInventory, remoteSourceTitle, remoteSourceEmpty, remoteRecordLabel, remoteRecordState, remoteRecordSummary, type RemoteInventoryRow } from '../lib/remote-inventory';
import { RefreshCw, Server, ShieldCheck } from 'lucide-react';
import './RemoteInventory.css';

function observed(at: number | null) {
  return at === null ? 'Not observed yet' : new Date(at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' });
}
function RecordRows({ rows, label, depth = 0 }: { rows: RemoteInventoryRow[]; label: string; depth?: number }) {
  return <ul className={depth ? 'ab-remote__children' : 'ab-remote__agents'} aria-label={label}>{rows.map(row => <li key={row.id} className="ab-remote__agent" data-agent-id={row.id} data-record-kind={row.identity ?? 'herdr'} data-child={depth > 0 || undefined}>
    <div className="ab-remote__agent-line"><span className="ab-remote__agent-dot" data-stale={row.stale || row.identity === 'process-only' || undefined} /><div className="ab-remote__agent-copy"><strong>{row.name}</strong><span>{remoteRecordLabel(row)}{row.children.length > 0 ? ` · ${row.children.length} explicit ${row.children.length === 1 ? 'child' : 'children'}` : ''}</span></div><span className="ab-remote__agent-state">{remoteRecordState(row)}</span></div>
    {row.children.length > 0 && <RecordRows rows={row.children} label={`Children of ${row.name}`} depth={depth + 1} />}
  </li>)}</ul>;
}

/** Local, read-only inventory. Mount inside Servers or Fleet; no control callbacks. */
export function RemoteInventory() {
  const titleId = useId();
  const { data, busy, failed, now, refresh } = useRemoteInventory();
  const { groups, count } = projectRemoteInventory(data, now, failed);
  const machines = [...new Set(groups.map(s => s.machineKey))];
  const empty = !data ? (busy ? 'Reading configured machines…' : 'Remote inventory is unavailable.') : !data.enabled ? 'Remote inventory is disabled.' : !data.configured ? 'Remote configuration could not be read safely.' : !groups.length ? 'No remote sources are configured.' : null;
  return <section className="ab-remote" aria-labelledby={titleId} aria-busy={busy}>
    <header className="ab-remote__header"><div className="ab-remote__heading"><Server size={18} aria-hidden="true" /><div><h2 id={titleId}>Remote inventory</h2><p>Configured sources · read-only observations</p></div></div><button type="button" onClick={() => void refresh()} disabled={busy} aria-label="Refresh remote inventory"><RefreshCw size={14} aria-hidden="true" />{busy ? 'Reading…' : 'Refresh'}</button></header>
    {failed && <p className="ab-remote__notice" role="alert">Refresh failed.{groups.length ? ' Last observed records are kept below; current activity and process presence are unknown.' : ' Try Refresh to read the inventory again.'}</p>}
    {empty ? <div className="ab-remote__empty" role="status"><ShieldCheck size={20} aria-hidden="true" /><strong>{empty}</strong><p>{data?.enabled === false ? 'This node has not enabled remote inventory.' : data?.configured === false ? 'No remote records are exposed until the configuration is valid.' : data ? 'Only existing machine and account scopes configured on this node can appear here.' : 'This view reports only explicitly configured sources.'}</p></div> : <>
      <div className="ab-remote__summary"><span>{count} {count === 1 ? 'record' : 'records'} · {groups.length} {groups.length === 1 ? 'source' : 'sources'} · {machines.length} {machines.length === 1 ? 'machine' : 'machines'}</span><span>{remoteRecordSummary(groups)}</span><span className="ab-remote__coverage-summary">Coverage is limited to these sources. Records are not an active-job count.</span></div>
      <div className="ab-remote__machines">{machines.map(machine => <section className="ab-remote__machine" key={machine} aria-label={`Machine ${machine}`}><h3><Server size={14} aria-hidden="true" />{machine}</h3>{groups.filter(group => group.machineKey === machine).map(group => {
        const label = group.state === 'fresh' && group.diagnostics.directoryAbsent ? 'Fresh · directory absent' : group.state === 'fresh' && !group.recordCount ? 'Fresh · no records' : group.state === 'fresh' ? 'Fresh' : group.state === 'stale' ? 'Stale' : 'Unavailable';
        return <section className="ab-remote__session" key={group.id} data-source-state={group.state} data-source-kind={group.source} aria-label={remoteSourceTitle(group)}>
          <div className="ab-remote__session-head"><h4>{remoteSourceTitle(group)}</h4><span className="ab-remote__badge" data-state={group.state}>{label}</span></div>
          <p className="ab-remote__coverage">{group.coverage}</p>
          <p className="ab-remote__time">{group.machineUser ? `Account ${group.machineUser} · ` : ''}{group.observedAt === null ? '' : 'Last observed '}<time dateTime={group.observedAt === null ? undefined : new Date(group.observedAt).toISOString()}>{observed(group.observedAt)}</time></p>
          {!!group.diagnostics.rejectedReceipts && <p className="ab-remote__none">{group.diagnostics.rejectedReceipts} receipt(s) could not be verified; their task identities remain unknown.</p>}
          {!!group.diagnostics.reconciledProcesses && <p className="ab-remote__none">{group.diagnostics.reconciledProcesses} process observation(s) already represented by managed sessions.</p>}
          {group.rows.length ? <RecordRows rows={group.rows} label={`Records on ${machine}, ${remoteSourceTitle(group)}`} /> : <p className="ab-remote__none">{remoteSourceEmpty(group, group.state)}</p>}
        </section>;
      })}</section>)}</div>
    </>}
  </section>;
}
