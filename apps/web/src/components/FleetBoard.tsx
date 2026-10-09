import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { GripVertical, ArrowUp, ArrowDown } from 'lucide-react';
import { formatDuration, SortableRail, SortableItem } from '@siso/side-nav';
import type { Agent } from '../lib/agents';
import { every, clock } from '../lib/poll';
import { WidgetCard } from './widgets/WidgetCard';
import './FleetBoard.css';
import { OwnerBoard } from './OwnerBoard';

type FleetRow = Agent & { dispatcher: string | null; fleet?: boolean; crew?: { id: string; toolUseId?: string }; crewParentId?: string };
type Workspace = { id: string; name: string; owner: string; color: string; order: number; parent?: string; nav?: boolean; size?: 'S' | 'M' | 'L'; ownerId: string | null; rows: FleetRow[] };
type Board = { groups: Workspace[]; error?: string | null; miniEnabled: boolean; miniAt: number | null };
export function FleetBoard({ onOpen, onCrew, workspace, owners = true }: { workspace?: string; owners?: boolean; onOpen: (a: Agent) => void; onCrew: (r: FleetRow) => void }) {
  const [board, setBoard] = useState<Board | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fromZero, setFromZero] = useState(false);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [, tick] = useState(0);
  const [detail, setDetail] = useState<{ name: string; text: string } | null>(null);
  const grid = useRef<HTMLDivElement>(null);
  const saving = useRef(false);
  useEffect(() => clock(() => tick(n => n + 1)), []);
  useEffect(() => every(() => {
    if (saving.current) return;
    fetch('/api/fleet-board').then(async r => { if (!r.ok) throw Error('Fleet unavailable'); return r.json() as Promise<Board>; })
      .then(data => { if (!saving.current) { setBoard(data); setError(null); } }).catch(e => setError(e.message));
  }, 5000), []);
  const save = async (patches: Partial<Workspace>[]) => {
    if (saving.current) return;
    saving.current = true;
    setBoard(b => b && ({ ...b, groups: b.groups.map(w => ({ ...w, ...patches.find(p => p.id === w.id) })).sort((a,b) => a.order - b.order) }));
    try {
      const r = await fetch('/api/registry', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ op: 'workspace', workspaces: patches }) });
      if (!r.ok) throw Error('Layout could not be saved');
      setError(null);
    } catch (e) { setError(e instanceof Error ? e.message : 'Layout could not be saved'); }
    finally { saving.current = false; }
  };
  const move = (id: string, target: string) => {
    const ids = groups.map(w => w.id);
    const a = ids.indexOf(id), b = ids.indexOf(target);
    if (a < 0 || b < 0 || a === b) return;
    ids.splice(a,1); ids.splice(b,0,id);
    void save(ids.map((id, order) => ({ id, order })));
  };
  const open = (r: FleetRow) => {
    if (r.crew) { onCrew(r); return; }
    if (!r.fleet) { onOpen(r); return; }
    setDetail({ name: r.name, text: 'Loading job output…' });
    fetch(`/api/fleet-board/output?id=${encodeURIComponent(r.id)}`).then(async res => {
      if (!res.ok) throw Error('Job output unavailable');
      const d = await res.json(); setDetail({ name: r.name, text: d.text || 'No output yet' });
    }).catch(e => setDetail({ name: r.name, text: e.message }));
  };
  if (detail) return <div className="ab-fleet"><button type="button" onClick={() => setDetail(null)}>← Fleet</button><h3>{detail.name}</h3><pre className="ab-fleet__output">{detail.text}</pre></div>;
  const groups = board?.groups.filter(w => !workspace || w.id === workspace || w.parent === workspace) ?? [];
  return <div className="ab-fleet" data-testid="fleet-board">
    {owners && <OwnerBoard workspaces={board?.groups} />}
    <div className="ab-fleet__bar"><div role="group" aria-label="Dispatch filter">
      <button type="button" aria-pressed={!fromZero} onClick={() => setFromZero(false)}>All</button>
      <button type="button" aria-pressed={fromZero} onClick={() => setFromZero(true)}>From Agent Zero</button>
    </div><small>{board ? groups.reduce((n,g) => n + g.rows.length,0) : '…'} agents</small></div>
    {(error || board?.error) && <p role="status" className="ab-fleet__notice">{error || board?.error}</p>}
    {board && !board.miniEnabled && <p className="ab-fleet__notice">Mini fleet reading is disabled</p>}
    {!board && <p className="ab-fleet__notice">Loading workspaces…</p>}
    <SortableRail ids={groups.map(w => w.id)} onReorder={ids => { if (!workspace) void save(ids.map((id,order) => ({ id,order }))); }}><div className="ab-fleet__grid" ref={grid}>
      {groups.map((w,i) => {
        const rows = w.rows.filter(r => !fromZero || /^(agent zero|a0)$/i.test(r.dispatcher || '')).sort((a,b) => Number(b.id === w.ownerId) - Number(a.id === w.ownerId));
        const owner = w.rows.find(r => r.id === w.ownerId);
        const settled = rows.filter(r => r.status === 'done' || r.status === 'failed');
        const active = rows.filter(r => r.status !== 'done' && r.status !== 'failed');
        const visible = expanded[w.id] ? rows : active;
        const size = w.size ?? 'M';
        return <SortableItem key={w.id} id={w.id}><div data-workspace={w.id} data-size={size} data-count={rows.length} className={`ab-fleet__widget is-${size.toLowerCase()}`} style={{ '--workspace-color': w.color } as CSSProperties}>
          <div className="ab-fleet__tools">
            <button type="button" className="ab-fleet__drag" aria-label={`Drag ${w.name}`}><GripVertical size={14}/></button>
            <button type="button" aria-label={`Move ${w.name} up`} disabled={!!workspace || i === 0} onClick={() => move(w.id,groups[i-1].id)}><ArrowUp size={12}/></button>
            <button type="button" aria-label={`Move ${w.name} down`} disabled={!!workspace || i === groups.length-1} onClick={() => move(w.id,groups[i+1].id)}><ArrowDown size={12}/></button>
            <label title="Workspace colour"><span className="sr-only">{w.name} colour</span><input aria-label={`${w.name} colour`} type="color" value={w.color} onChange={e => void save([{ id:w.id,color:e.target.value }])}/></label>
            <select aria-label={`${w.name} size`} value={size} onChange={e => void save([{ id:w.id,size:e.target.value as Workspace['size'] }])}><option value="S">Small</option><option value="M">Medium</option><option value="L">Large</option></select>
          </div>
          <WidgetCard size="M" title={w.name} description={w.owner ? `Owner · ${w.owner}` : 'Parent unresolved'} icon="users-round" count={rows.length}>
            {owner && !visible.some(r => r.id === owner.id) && <button className="ab-fleet__owner" type="button" onClick={() => open(owner)}>Open {w.owner}</button>}
            <div className="ab-fleet__rows">{visible.map(r => <button key={r.id} type="button" className="ab-fleet__row" data-state={r.status} onClick={() => open(r)}>
              <span className="ab-fleet__dot"/><span className="ab-fleet__copy"><b>{r.name}{r.id === w.ownerId && <em>owner</em>}</b><span title={r.title}>{r.title || r.tool || 'No step reported'}</span><small>By {r.dispatcher || 'Unrecorded'} · {r.machineKey === 'mini' ? 'Mac Mini' : 'Laptop'}</small></span>
              <span className="ab-fleet__state">{r.status === 'needs' ? 'needs you' : r.status}<small>{r.since ? formatDuration(Math.max(0,Date.now()-r.since)) : 'age unknown'}</small></span>
            </button>)}</div>
            {!rows.length && <p className="ab-fleet__empty">{fromZero ? 'No dispatches from Agent Zero' : 'No agents recorded'}</p>}
            {!!settled.length && <button type="button" className="ab-fleet__settled" aria-expanded={!!expanded[w.id]} onClick={() => setExpanded(x => ({ ...x,[w.id]:!x[w.id] }))}>{settled.filter(r => r.status === 'done').length} done · {settled.filter(r => r.status === 'failed').length} failed · {expanded[w.id] ? 'hide' : 'show'}</button>}
          </WidgetCard>
          <button type="button" className="ab-fleet__resize" aria-label={`Resize ${w.name}`} onPointerDown={e => { e.preventDefault(); e.stopPropagation(); e.currentTarget.setPointerCapture(e.pointerId); e.currentTarget.dataset.start = String(e.clientY); }} onPointerUp={e => {
            const delta = e.clientY - Number(e.currentTarget.dataset.start ?? e.clientY);
            if (Math.abs(delta) > 15) { const sizes = ['S','M','L'] as const; const index = sizes.indexOf(size); void save([{ id:w.id,size:sizes[Math.max(0,Math.min(2,index + (delta > 0 ? 1:-1)))] }]); }
          }} title="Drag to resize">◢</button>
        </div></SortableItem>;
      })}
    </div></SortableRail>
  </div>;
}
