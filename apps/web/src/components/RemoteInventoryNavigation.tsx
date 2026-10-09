import { RefreshCw } from 'lucide-react';
import { projectRemoteInventory, remoteSourceTitle, remoteSourceEmpty, remoteRecordLabel, remoteRecordState, remoteRecordSummary, type RemoteInventoryRow } from '../lib/remote-inventory';
import { useRemoteInventory } from '../lib/useRemoteInventory';
import './RemoteInventoryNavigation.css';

const observation = (at: number | null) => at === null ? 'Not observed yet' : new Date(at).toLocaleString();
/** Metadata only. Has no action callbacks, hrefs, local-agent selection or chat/terminal routing. */
export function RemoteInventoryDetail({ row }: { row: RemoteInventoryRow }) {
  const processOnly = row.identity === 'process-only';
  return <dl className="ab-remote-nav__detail">
    <dt>Machine</dt><dd>{row.machineKey}</dd>
    {row.machineUser && <><dt>Account</dt><dd>{row.machineUser}</dd></>}
    <dt>Source</dt><dd>{remoteSourceTitle({ source: row.source, session: row.session })}</dd>
    <dt>Identity</dt><dd>{remoteRecordLabel(row)}</dd>
    <dt>Task session</dt><dd>{row.identity === 'task-session' ? row.taskSession : 'Unverified'}</dd>
    <dt>{processOnly ? 'Executable' : 'Harness'}</dt><dd>{row.harness}</dd>
    <dt>Task state</dt><dd>{row.state === 'unknown' ? 'Unknown' : row.state}</dd>
    <dt>Model</dt><dd>Unverified</dd>
    {row.source !== 'herdr' && <><dt>Process</dt><dd>{row.processState === 'observed' ? 'Observed at last fresh read' : row.processState === 'not-observed' ? 'Not observed at last fresh read' : 'Unknown'}</dd></>}
    <dt>Observed</dt><dd>{observation(row.observedAt)}</dd>
    <dt>Parent</dt><dd>{row.parentName ?? 'No verified task parent'}</dd>
    {processOnly && row.runtimeParentId && <><dt>Ancestry</dt><dd>A process parent was observed; task ownership is unverified.</dd></>}
    <dt>Access</dt><dd>Read-only inventory</dd>
  </dl>;
}
function Rows({ rows }: { rows: RemoteInventoryRow[] }) {
  return <ul className="ab-remote-nav__rows">{rows.map(row => <li key={row.id} data-remote-id={row.id} data-record-kind={row.identity ?? 'herdr'}>
    <details><summary><span>{row.name}</span><small>{remoteRecordState(row)}</small><span className="ab-remote-nav__identity">{remoteRecordLabel(row)}</span></summary><RemoteInventoryDetail row={row} /></details>
    {row.children.length > 0 && <Rows rows={row.children} />}
  </li>)}</ul>;
}
/** Mount beside local rows in Sidebar or an owner view. Expands metadata in place; never selects a local agent. */
export function RemoteInventoryNavigation() {
  const { data, busy, failed, now, refresh } = useRemoteInventory();
  const { groups, count } = projectRemoteInventory(data, now, failed);
  const empty = !data ? busy ? 'Reading inventory…' : 'Inventory unavailable; activity unknown.' : !data.enabled ? 'Remote inventory disabled.' : !data.configured ? 'Remote configuration unavailable.' : !groups.length ? 'No remote sources configured.' : null;
  return <nav className="ab-remote-nav" aria-label="Remote inventory" aria-busy={busy}>
    <header><strong>Remote inventory</strong><button type="button" disabled={busy} onClick={() => void refresh()} aria-label="Refresh remote inventory"><RefreshCw size={13} /></button></header>
    <p className="ab-remote-nav__scope">Read-only · limited source coverage{groups.length > 0 ? ` · ${count} ${count === 1 ? 'record' : 'records'} · ${groups.length} sources` : ''}</p>
    {groups.length > 0 && <p className="ab-remote-nav__scope">{remoteRecordSummary(groups)}. Records are not an active-job count.</p>}
    {failed && data && <p role="alert">Refresh failed. Current activity and process presence are unknown.</p>}
    {empty ? <p role="status">{empty}</p> : groups.map(group => <section key={group.id} className="ab-remote-nav__group" aria-label={`${group.machineKey}, ${remoteSourceTitle(group)}`} data-state={group.state} data-source-kind={group.source}>
      <h3>{group.machineKey}{group.machineUser ? ` · ${group.machineUser}` : ''}<span> / {remoteSourceTitle(group)}</span></h3>
      <p className="ab-remote-nav__coverage">{group.coverage}</p>
      <p className="ab-remote-nav__observation">{group.state === 'fresh' ? group.diagnostics.directoryAbsent ? 'Fresh · directory absent' : group.rows.length ? 'Fresh' : 'Fresh · no records' : group.state === 'stale' ? 'Stale · current activity unknown' : 'Unavailable · activity unknown'} · {observation(group.observedAt)}</p>
      {!!group.diagnostics.rejectedReceipts && <p>{group.diagnostics.rejectedReceipts} receipt(s) could not be verified; task identities remain unknown.</p>}
      {!!group.diagnostics.reconciledProcesses && <p>{group.diagnostics.reconciledProcesses} process observation(s) already represented by managed sessions.</p>}
      {group.rows.length ? <Rows rows={group.rows} /> : <p>{remoteSourceEmpty(group, group.state)}</p>}
    </section>)}
  </nav>;
}
