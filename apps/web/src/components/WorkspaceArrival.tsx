import { useId, useLayoutEffect, useRef, useState, type CSSProperties } from 'react'
import { AgentFace, WorkspaceMark, projectHue, type AgentFaceProps, type AgentStatus, type WorkspaceBrand } from '../../../../packages/halo-face/living-assets'
import { useMotionGate, type MotionBankDemoProps } from './motion-bank-shared'
import './WorkspaceArrival.css'

export type WorkspaceArrivalAgent = {
  id: string
  name: string
  role: string
  project: string
  toolSummary: string
  workspaceTitle: string
  status: AgentStatus
  ownerId?: string
  brand?: WorkspaceBrand
  face?: Pick<AgentFaceProps, 'family' | 'hue' | 'secondHue' | 'features'>
}
export type WorkspaceArrivalProps = {
  agents: readonly WorkspaceArrivalAgent[]
  selectedAgentId: string | null
  onSelectAgent: (id: string) => void
  expandedOwnerIds: readonly string[]
  onToggleOwner: (id: string) => void
  paused?: boolean
}
const states: Record<AgentStatus, string> = { working: 'Working', waiting: 'Ready', 'needs-shaan': 'Needs you', blocked: 'Blocked', done: 'Done', offline: 'Offline' }
type Arrival = { id: string; sequence: number; x: number; y: number }

/** Selection is authoritative immediately; only the decorative face travels. */
export function WorkspaceArrival({ agents, selectedAgentId, onSelectAgent, expandedOwnerIds, onToggleOwner, paused = false }: WorkspaceArrivalProps) {
  const { ref, motion } = useMotionGate(paused)
  const uid = 'wa-' + useId().replace(/[^a-zA-Z0-9_-]/g, '')
  const destination = useRef<HTMLSpanElement>(null)
  const sources = useRef(new Map<string, HTMLSpanElement>())
  const previous = useRef(selectedAgentId)
  const sequence = useRef(0)
  const [arrival, setArrival] = useState<Arrival | null>(null)
  const selected = agents.find(agent => agent.id === selectedAgentId)
  const owner = selected?.ownerId ? agents.find(agent => agent.id === selected.ownerId) : undefined
  const selectedHidden = owner && !expandedOwnerIds.includes(owner.id)
  const hue = selected?.face?.hue ?? projectHue(selected?.project ?? 'Agent Base')
  useLayoutEffect(() => {
    if (previous.current === selectedAgentId) return
    previous.current = selectedAgentId
    const source = selectedAgentId ? sources.current.get(selectedAgentId) : undefined
    if (!motion || !selected || selected.status === 'blocked' || !source || !destination.current) { setArrival(null); return }
    const start = source.getBoundingClientRect(), end = destination.current.getBoundingClientRect()
    setArrival({ id: selected.id, sequence: ++sequence.current, x: start.left + start.width / 2 - end.left - end.width / 2, y: start.top + start.height / 2 - end.top - end.height / 2 })
  }, [selectedAgentId, selected, motion])
  const face = (agent: WorkspaceArrivalAgent, size: number) => <AgentFace {...agent.face} name={agent.name} project={agent.project} status={agent.status} size={size} paused={!motion || agent.id !== selectedAgentId || agent.status === 'blocked'} track={false}/>
  const row = (agent: WorkspaceArrivalAgent, worker = false) => <button type="button" className="wa-row" data-worker={worker} data-selected={selectedAgentId === agent.id} aria-pressed={selectedAgentId === agent.id} onClick={() => onSelectAgent(agent.id)}>
    <span className="wa-source-face" aria-hidden="true" ref={element => { if (element) sources.current.set(agent.id, element); else sources.current.delete(agent.id) }}>{face(agent, 32)}</span>
    <span className="wa-row-copy"><strong>{agent.name}</strong><small>{agent.role}</small></span>
  </button>
  return <div className="wa-specimen" ref={ref} data-motion={motion ? 'on' : 'off'} style={{ '--wa-hue': hue } as CSSProperties}>
    <nav className="wa-rail" aria-label="Example agent workspaces">
      <div className="wa-rail-title"><span aria-hidden="true"><WorkspaceMark brand="agent-base" size={28} paused={!motion}/></span><span>Agent workspaces<small>Owners & their crew</small></span></div>
      {agents.filter(agent => !agent.ownerId).map(agent => {
        const workers = agents.filter(worker => worker.ownerId === agent.id)
        const open = expandedOwnerIds.includes(agent.id)
        return <div className="wa-owner" key={agent.id} style={{ '--wa-owner-hue': agent.face?.hue ?? projectHue(agent.project) } as CSSProperties}>
          {open && workers.length > 0 && <svg className="wa-trunk" aria-hidden="true" width="80" height={workers.length * 56} viewBox={`0 0 80 ${workers.length * 56}`}><path d={`M23 0V${workers.length * 56 - 12}Q23 ${workers.length * 56} 35 ${workers.length * 56}H57${workers.slice(0, -1).map((_, i) => ` M23 ${(i + 1) * 56 - 12}Q23 ${(i + 1) * 56} 35 ${(i + 1) * 56}H57`).join('')}`}/></svg>}
          <div className="wa-owner-row">{row(agent)}{workers.length > 0 && <button className="wa-fold" type="button" aria-label={`${open ? 'Fold' : 'Expand'} ${agent.name} crew`} aria-expanded={open} aria-controls={`${uid}-${agent.id}-crew`} onClick={() => onToggleOwner(agent.id)}><span aria-hidden="true">{open ? '−' : '+'}</span><small>{workers.length}</small></button>}</div>
          <div id={`${uid}-${agent.id}-crew`} className="wa-crew" hidden={!open}>{open && workers.map(worker => <div key={worker.id}>{row(worker, true)}</div>)}</div>
        </div>
      })}
    </nav>
    <section className="wa-workspace" aria-label="Selected workspace">
      {selected ? <><header className="wa-header">
        <span className="wa-destination" ref={destination} aria-hidden="true">{face(selected, 48)}
          {motion && selected.status !== 'blocked' && arrival?.id === selected.id && <span className="wa-arrival" key={arrival.sequence} style={{ '--wa-from-x': `${arrival.x}px`, '--wa-from-y': `${arrival.y}px` } as CSSProperties}>{face(selected, 32)}</span>}
        </span>
        <div className="wa-header-copy"><small>{owner ? `${owner.name} / crew` : `${selected.project} / workspace`}</small><h3>{selected.workspaceTitle}</h3><p>{selected.toolSummary}</p></div>
      </header><div className="wa-content"><div className="wa-state"><span>{states[selected.status]}</span><span>{selected.name}</span></div><p>{selected.role}</p><div className="wa-material"><span aria-hidden="true"><WorkspaceMark brand={selected.brand ?? owner?.brand ?? 'agent-base'} size={44} paused={!motion || selected.status === 'blocked'}/></span><span><strong>{selected.project}</strong><small>Selected workspace</small></span></div>{selectedHidden && <p className="wa-folded-notice">Crew folded. {selected.name} remains selected.</p>}</div></> : <p className="wa-empty">Select an agent to inspect its supplied workspace.</p>}
    </section>
  </div>
}
const exampleAgents: readonly WorkspaceArrivalAgent[] = [
  { id: 'base', name: 'Astra', role: 'Workspace owner', project: 'Agent Base', workspaceTitle: 'Agent Base workspace', toolSummary: 'Codex · UI review · source tools', status: 'waiting', brand: 'agent-base', face: { family: 'codex', hue: 217, secondHue: 195, features: { top: 6 } } },
  { id: 'interface', ownerId: 'base', name: 'Sol · Interface', role: 'Experience & craft', project: 'Agent Base', workspaceTitle: 'Interface workspace', toolSummary: 'Codex · component source · local preview', status: 'working', face: { family: 'codex', hue: 217, secondHue: 195, features: { top: 0 } } },
  { id: 'checks', ownerId: 'base', name: 'Sol · Checks', role: 'Verification & evidence', project: 'Agent Base', workspaceTitle: 'Checks workspace', toolSummary: 'Codex · supplied check receipts', status: 'blocked', face: { family: 'codex', hue: 217, secondHue: 195, features: { top: 0 } } },
  { id: 'agency', name: 'Claude · Agency', role: 'Agency owner', project: 'SISO Agency', workspaceTitle: 'Agency workspace', toolSummary: 'Claude · project notes · client materials', status: 'waiting', brand: 'siso-agency', face: { family: 'claude', hue: 28, secondHue: 39, features: { top: 6 } } },
  { id: 'halo', name: 'Astra · HALO', role: 'Partner owner', project: 'HALO', workspaceTitle: 'HALO workspace', toolSummary: 'Codex · Operator sources · partner notes', status: 'waiting', brand: 'halo', face: { family: 'codex', hue: 270, secondHue: 185, features: { top: 6 } } },
]
export function WorkspaceArrivalDemo({ paused = false }: MotionBankDemoProps) {
  const [selected, setSelected] = useState('base')
  const [expanded, setExpanded] = useState<readonly string[]>(['base'])
  const [receipt, setReceipt] = useState('No selection callback yet.')
  return <div className="wa-demo" data-demo-id="workspace-arrival"><p className="wa-example-label">LOCAL EXAMPLE · selection opens supplied content</p><WorkspaceArrival agents={exampleAgents} selectedAgentId={selected} onSelectAgent={id => { setSelected(id); setReceipt(`onSelectAgent(${id}) received locally.`) }} expandedOwnerIds={expanded} onToggleOwner={id => { setExpanded(ids => ids.includes(id) ? ids.filter(item => item !== id) : [...ids, id]); setReceipt(`onToggleOwner(${id}) received locally. Selection preserved.`) }} paused={paused}/><output className="wa-receipt" aria-live="polite">{receipt}</output></div>
}
