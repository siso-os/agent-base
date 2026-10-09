// uihub: arc:popover — one line per server (t-0464; AB-MAP: 'the Agent Infrastructure card in place is a text wall').
import { useEffect, useId, useRef, useState } from 'react'
import { AgentFace, LivingIcon, type AgentFaceProps, type AgentStatus } from '../../../../packages/halo-face/living-assets'
import { useMotionGate, type MotionBankDemoProps } from './motion-bank-shared'
import './InfrastructurePopover.css'

export type InfrastructureStatus = 'working' | 'needs' | 'idle' | 'done' | 'failed' | 'offline' | 'unknown'
export type InfrastructureRecord = {
  id: string
  name: string
  domain: string
  status?: InfrastructureStatus | null
  summary?: string
  observedAt?: string
  stale?: boolean
  available?: boolean
  face?: Pick<AgentFaceProps, 'project' | 'family' | 'hue' | 'secondHue' | 'features'>
}
export type InfrastructureDisclosure = { open: boolean; pinned: boolean }
export type InfrastructurePopoverProps = InfrastructureDisclosure & {
  records: readonly InfrastructureRecord[]
  onDisclosureChange: (state: InfrastructureDisclosure) => void
  onOpenAgent: (id: string) => void
  paused?: boolean
}

const labels: Record<InfrastructureStatus, string> = { working: 'Working', needs: 'Needs you', idle: 'Idle', done: 'Done', failed: 'Failed', offline: 'Not running', unknown: 'Unknown' }
const faceStates: Record<InfrastructureStatus, AgentStatus> = { working: 'working', needs: 'needs-shaan', idle: 'waiting', done: 'done', failed: 'blocked', offline: 'offline', unknown: 'offline' }
function suppliedStatus(record: InfrastructureRecord): InfrastructureStatus {
  return record.available === false || record.stale ? 'unknown' : record.status ?? 'unknown'
}

/** Controlled disclosure. Supplied observations never become inferred health or runtime events. */
export function InfrastructurePopover({ records, open, pinned, onDisclosureChange, onOpenAgent, paused = false }: InfrastructurePopoverProps) {
  const { ref, motion } = useMotionGate(paused)
  const trigger = useRef<HTMLButtonElement>(null)
  const closeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const suppressFocus = useRef(false)
  const [engagedId, setEngagedId] = useState<string | null>(null)
  const panelId = useId()
  const clearClose = () => { if (closeTimer.current) clearTimeout(closeTimer.current) }
  const close = (restore = false) => {
    clearClose()
    onDisclosureChange({ open: false, pinned: false })
    if (restore && document.activeElement !== trigger.current) {
      suppressFocus.current = true
      trigger.current?.focus()
    }
  }
  const reveal = () => { clearClose(); onDisclosureChange({ open: true, pinned }) }
  const leave = () => {
    clearClose()
    if (!pinned) closeTimer.current = setTimeout(() => {
      if (!ref.current?.contains(document.activeElement)) onDisclosureChange({ open: false, pinned: false })
    }, 220)
  }
  useEffect(() => () => { if (closeTimer.current) clearTimeout(closeTimer.current) }, [])
  useEffect(() => {
    if (!open) return
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !ref.current?.contains(event.target)) onDisclosureChange({ open: false, pinned: false })
    }
    document.addEventListener('pointerdown', outside)
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.defaultPrevented) { event.preventDefault(); close(true) }
    }
    document.addEventListener('keydown', escape)
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape) }
  }, [open, onDisclosureChange, ref])
  return <div ref={ref} className="ip-root" data-motion={motion} onPointerEnter={event => { if (event.pointerType !== 'touch') reveal() }} onPointerLeave={leave}
    onBlur={event => { if (!pinned && event.relatedTarget instanceof Node && !event.currentTarget.contains(event.relatedTarget)) close() }}
    onKeyDown={event => { if (event.key === 'Escape' && open) { event.preventDefault(); event.stopPropagation(); close(true) } }}>
    <button ref={trigger} type="button" className="ip-trigger" aria-expanded={open} aria-controls={panelId}
      onFocus={() => { if (suppressFocus.current) suppressFocus.current = false; else reveal() }}
      onClick={() => { clearClose(); trigger.current?.focus(); onDisclosureChange({ open: !pinned, pinned: !pinned }) }}>
      <span className="ip-trigger-heading"><LivingIcon name="agent-base" variant="glyph" size={24} paused={!motion} active={motion && open && !engagedId} /><span>Agent Infrastructure</span><span className="ip-chevron" aria-hidden="true">{open ? '−' : '+'}</span></span>
      <span className="ip-signals">{records.map(record => <span key={record.id} className={`ip-signal ip-state-${suppliedStatus(record)}`}><i aria-hidden="true" /><span>{record.name}</span><small>{labels[suppliedStatus(record)]}</small></span>)}</span>
    </button>
    {open && <section id={panelId} className="ip-panel" aria-label="Agent Infrastructure">
      <header className="ip-panel-header"><span>Infrastructure agents</span><span className="ip-pin">{pinned ? 'Pinned' : 'Preview'}</span><button type="button" className="ip-close" aria-label="Close infrastructure" onClick={() => close(true)}>×</button></header>
      <div className="ip-rows">{records.map(record => {
        const status = suppliedStatus(record)
        // One line per server: name and state, then one line of what it is doing (the whole text and when on hover).
        const line = record.available === false ? 'Observation unavailable' : record.stale ? 'Last observation is stale' : record.summary || record.domain || 'No observation supplied'
        const full = [record.domain, line, record.observedAt && `${record.stale ? 'Last observed' : 'Observed'} ${record.observedAt}`].filter(Boolean).join(' · ')
        return <button type="button" key={record.id} title={full} disabled={record.available === false || record.stale} className={`ip-row ip-state-${status}`} onPointerEnter={() => setEngagedId(record.id)} onPointerLeave={() => setEngagedId(null)} onFocus={() => setEngagedId(record.id)} onBlur={() => setEngagedId(null)} onClick={() => { onOpenAgent(record.id); close(true) }}>
          <span className="ip-face" aria-hidden="true"><AgentFace {...record.face} name={record.name} status={faceStates[status]} size={26} paused={!motion || engagedId !== record.id || status === 'failed' || status === 'unknown'} /></span>
          <span className="ip-row-body"><span className="ip-row-heading"><strong>{record.name}</strong><span className="ip-status"><i aria-hidden="true" />{labels[status]}</span></span><span className="ip-fact" data-testid="ip-line">{line}</span></span>
          <span className="ip-chat" aria-hidden="true">↗</span><span className="ip-sr">Open {record.name} chat</span>
        </button>
      })}</div>
    </section>}
  </div>
}

export function InfrastructurePopoverDemo({ paused = false }: MotionBankDemoProps) {
  const [disclosure, setDisclosure] = useState<InfrastructureDisclosure>({ open: false, pinned: false })
  const [stale, setStale] = useState(false)
  const [receipt, setReceipt] = useState('No chat selected')
  const records: InfrastructureRecord[] = [
    { id: 'example-health', name: 'HEALTH', domain: 'Machines', status: 'working', summary: 'Inspecting the example machine', observedAt: '09:42 · example', stale, face: { project: 'health' } },
    { id: 'example-efficiency', name: 'EFFICIENCY', domain: 'Agent stack', status: 'needs', summary: 'One routing decision needs review', observedAt: '09:41 · example', available: !stale, face: { project: 'efficiency' } },
    { id: 'example-estate', name: 'ESTATE', domain: 'Files and placement', status: stale ? null : 'idle', summary: 'No placement task assigned', observedAt: stale ? undefined : '09:40 · example', face: { project: 'estate' } },
  ]
  return <div className="ip-demo" data-demo-id="infrastructure-popover">
    <div className="ip-demo-label">Local synthetic example</div>
    <InfrastructurePopover records={records} {...disclosure} onDisclosureChange={setDisclosure} paused={paused} onOpenAgent={id => setReceipt(`Chat selected: ${records.find(record => record.id === id)?.name} (${id})`)} />
    <div className="ip-demo-controls"><label><input type="checkbox" checked={stale} onChange={event => setStale(event.target.checked)} /> Stale / unavailable observations</label><span>{disclosure.pinned ? 'Pinned open' : disclosure.open ? 'Hover / focus preview' : 'Closed'}</span></div>
    <output className="ip-receipt" aria-live="polite">{receipt}</output>
  </div>
}
