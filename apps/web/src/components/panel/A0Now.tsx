import { usageAge } from "../../lib/usage-age";
import { creditFigure, creditSample } from "../../lib/credit-reading";
import type { ReactNode } from 'react';
import type { A0Now as NowData } from '../../../../../services/node/src/a0-now';
import type { Agent } from '../../lib/agents';
import { useSharedState } from '../../lib/poll';
import { laneName, ModelChip, nowLanes } from '../A0Nav';
import './A0Now.css';

function Card({ title, children }: { title: string; children: ReactNode }) {
  return <section className="a0-now__card" aria-label={title}><h3>{title}</h3>{children}</section>;
}
const resetIn = (at: number | null) => at === null ? 'reset not reported' : at <= Date.now() ? 'reset due' : `resets in ${Math.ceil((at - Date.now()) / 86400000)} d`;
export function A0Now({ selected, agents, onOpenAgent }: { selected?: string | null; agents: Agent[]; onOpenAgent: (a: Agent) => void }) {
  const { data, error } = useSharedState<NowData>('/api/a0/now', 10_000);
  const codex = data?.budget.data?.codex;
  const lanes = nowLanes(data?.lanes.data);
  const lane = lanes.find((l) => l.id === selected) ?? lanes[0];
  const pane = lane?.kind === 'run' ? null : lane?.data.pane;
  const agent = lane && agents.find((a) => (pane && (a.id === pane || a.pane === pane)) || (lane.kind === 'tab' && a.name === lane.data.tab));
  const renewals = [...(data?.renewals.data ?? [])].filter((r) => r.days_left != null).sort((a, b) => a.days_left! - b.days_left!);
  return <div className="a0-now" data-testid="a0-now">
    <h2>Now</h2>
    {error && <p role="status">Now unavailable; retrying.</p>}
    {!data && !error && <p role="status">Reading Now…</p>}
    <Card title="Stack">
      {data?.stack.error ? <p role="status">Stack unavailable</p> : data?.stack.data && <>
        <div className="a0-now__counts">{(['red', 'amber', 'green'] as const).map((level) => <span className={`a0-${level}`} key={level}>● {data.stack.data!.filter((r) => r.level === level).length} {level}</span>)}</div>
        {data.stack.data.filter((r) => r.level === 'red').map((r, i) => <p className="a0-red" key={`${r.check}-${i}`}>{r.msg}</p>)}
        <small>Read {new Date(data.stack.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</small>
      </>}
    </Card>
    <Card title="Budget">
      {data?.budget.error ? <p role="status">Budget unavailable</p> : data?.budget.data && <>
        {!data.budget.data.claude.length && <p>Claude week not reported.</p>}
        {data.budget.data.claude.map((account) => <div className="a0-now__account" key={account.name}>
          <p>Claude · {account.name} week <b>{account.usedPct}%</b> <small>{resetIn(account.resetsAt)} · {usageAge(account) || "live Claude usage"}</small></p>
          <div className="a0-now__bar" role="meter" aria-label={`${account.name} Claude week`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={account.usedPct}><i style={{ width: `${Math.min(100, Math.max(0, account.usedPct))}%`, background: account.usedPct >= 80 ? '#e5484d' : '#30a46c' }} /></div>
        </div>)}
        <div data-testid="a0-codex-credits">
          <p>Codex <b>{creditFigure(codex?.balance)}</b> reported credits</p>
          <small>Cached reading · {typeof codex?.balanceSource === 'string' && codex.balanceSource.trim() ? codex.balanceSource : 'source unknown'} · {creditSample(codex?.balanceAt)}<br />Account not identified by this source</small>
          {codex?.unlimited === true && <p>Source reports unlimited credits</p>}
          {codex?.hasCredits === false && <p>Source reports no credits available</p>}
          {codex?.stale === true && <p role="status">Credit source is stale</p>}
          {data.budget.data.scanning && <p role="status">Token scan in progress; showing recorded credits</p>}
          {error && <p role="status">Latest Now request failed; showing previous credit reading</p>}
        </div>
      </>}
      {data?.renewals.error ? <p role="status">Renewals unavailable</p> : renewals[0] ? <p>Next renewal: {renewals[0].name} <b className="a0-amber">{renewals[0].days_left} d</b></p> : data && <p>Next renewal not reported.</p>}
    </Card>
    {data?.lanes.error && <Card title="Selected lane"><p role="status">Lanes unavailable</p></Card>}
    {lane && <Card title={laneName(lane)}>
      <ModelChip model={lane.data.model} />
      {lane.kind === 'pair' ? <>
        {!lane.data.items.length && <p>{lane.data.done} done · {lane.data.open} open · {lane.data.blocked.length} blocked</p>}
        {lane.data.items.map((item) => <p className={`a0-now__item ${item.state === 'done' ? 'a0-green' : item.state === 'blocked' ? 'a0-red' : ''}`} key={item.id}><span aria-label={item.state}>{item.state === 'done' ? '✓' : item.state === 'blocked' ? '!' : '○'}</span> {item.id} {item.title}{item.sha && <code> · {item.sha.slice(0, 7)}</code>}</p>)}
        {lane.data.blocked.map((text, i) => <p className="a0-red" key={i}>{text}</p>)}
        {lane.data.commits.length > 0 && <div className="a0-now__commits"><small>Last commits</small>{lane.data.commits.map((commit, i) => <p key={i}>{commit}</p>)}</div>}
      </> : lane.kind === 'tab' ? <>
        <p>{lane.data.status} · {lane.data.branch} · {lane.data.worked}</p>
        <pre>{lane.data.said.join('\n') || 'No recent words reported.'}</pre>
        <div className="a0-now__commits"><small>Last commit</small><p>{lane.data.last_commit || 'No commit reported.'}</p></div>
      </> : <>
        <p>{lane.data.status ?? 'Status not reported'} · {lane.data.at} · {lane.data.min} minutes</p>
        <p>{lane.data.dir} · {lane.data.mtok}M input tokens</p>
      </>}
      {lane.kind !== 'run' && <button type="button" className="a0-now__open" disabled={!agent} onClick={() => agent && onOpenAgent(agent)} title={agent ? `Open ${agent.name}` : 'No matching agent terminal is available'}>Open terminal</button>}
    </Card>}
    {data?.lanes.data && !lane && <Card title="Selected lane"><p>No lanes reported.</p></Card>}
    <Card title="Today">
      {data?.today.error ? <p role="status">Today unavailable</p> : <>
        {data?.today.data?.slice(0, 12).map((event) => <div className="a0-now__event" key={event.id}><time dateTime={new Date(event.at).toISOString()}>{new Date(event.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time><span>{event.text}</span></div>)}
        {data?.today.data?.length === 0 && <p>No changes reported today.</p>}
      </>}
    </Card>
  </div>;
}
