import { useEffect, useId, useRef, useState, type ReactNode, type KeyboardEvent } from 'react'
import { LivingIcon, type LivingIconName } from '../../../../packages/halo-face/living-assets'
import { ConfirmedCopy } from './ChatResponseScene'
import { useMotionGate } from './motion-bank-shared'
import './OutputInspectDock.css'

export type InspectOutputItem = {
  id: string; title: string; kind: 'preview' | 'code' | 'log'; state: 'pending' | 'ready' | 'failed'
  detail?: string; body?: string; preview?: ReactNode
  /** Decorative, noninteractive cover supplied by the caller; excluded from tab names. */
  thumbnail?: ReactNode
  /** Explicit caller-owned metadata; never extracted from body text. */
  checks?: readonly { label: string; result: string }[]
}
export type OutputInspectDockProps = {
  items: readonly InspectOutputItem[]; selectedId: string | null; onSelect: (id: string | null) => void
  variant?: 'compact' | 'expressive'; paused?: boolean; revision?: string | number; className?: string
}
const ICONS: Record<InspectOutputItem['kind'], LivingIconName> = { preview: 'web', code: 'agent-base', log: 'library' }
/** Artifact availability and supplied checks are separate, controlled evidence. */
export function OutputInspectDock({ items, selectedId, onSelect, variant = 'expressive', paused = false, revision = 0, className = '' }: OutputInspectDockProps) {
  const uid = useId(), inspector = useRef<HTMLElement>(null), tabs = useRef(new Map<string, HTMLButtonElement>()), previous = useRef(selectedId)
  const inspectorFocused = useRef(false)
  const [view, setView] = useState<'inspect' | 'raw'>('inspect')
  const selected = items.find(item => item.id === selectedId)
  const { ref, motion } = useMotionGate(paused || selected?.state === 'failed')
  useEffect(() => {
    setView('inspect')
    const selectedTab = selected ? tabs.current.get(selected.id) : undefined
    const shelf = selectedTab?.parentElement
    if (selectedTab && shelf && shelf.scrollWidth > shelf.clientWidth) {
      const tile = selectedTab.getBoundingClientRect(), rail = shelf.getBoundingClientRect()
      const inset = parseFloat(getComputedStyle(shelf).paddingLeft) || 0
      const delta = tile.left < rail.left + inset ? tile.left - rail.left - inset : tile.right > rail.right - inset ? tile.right - rail.right + inset : 0
      shelf.scrollLeft += delta
    }
    if (!selected && previous.current && inspectorFocused.current) tabs.current.get(previous.current)?.focus()
    if (!selected) inspectorFocused.current = false
    previous.current = selectedId
  }, [selectedId, selected?.id, revision])
  const close = () => { onSelect(null); if (selectedId) tabs.current.get(selectedId)?.focus() }
  const selectKey = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    let next = index
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = (index + 1) % items.length
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') next = (index - 1 + items.length) % items.length
    else if (event.key === 'Home') next = 0
    else if (event.key === 'End') next = items.length - 1
    else return
    event.preventDefault(); onSelect(items[next].id); tabs.current.get(items[next].id)?.focus()
  }
  return <div ref={ref} className={`oid-dock oid-${variant} ${className}`} data-motion={motion ? 'on' : 'off'} data-selected={selectedId || 'none'} onKeyDown={event => { if (event.key === 'Escape' && selected) { event.preventDefault(); event.stopPropagation(); close() } }}>
    <div className="oid-shelf" role="tablist" aria-label="Supplied outputs">{items.map((item, index) => <button type="button" role="tab" id={`${uid}-tile-${index}`} aria-label={`${item.title}, ${item.kind}, ${item.state === 'ready' ? 'Supplied' : item.state === 'pending' ? 'Pending' : 'Failed'}`} aria-selected={selectedId === item.id} aria-controls={`${uid}-inspector`} tabIndex={selectedId === item.id || (!selected && index === 0) ? 0 : -1} ref={node => { if (node) tabs.current.set(item.id, node); else tabs.current.delete(item.id) }} key={item.id} className="oid-tile" data-kind={item.kind} data-state={item.state} onClick={() => onSelect(item.id)} onKeyDown={event => selectKey(event, index)}>
      <span className="oid-cover" aria-hidden="true" inert><span className="oid-thumbnail">{item.thumbnail}</span><span className="oid-object"><LivingIcon name={ICONS[item.kind]} size={variant === 'expressive' ? 40 : 30} paused={!motion || item.state === 'failed'} /></span></span><span className="oid-tile-copy"><span className="oid-kind">{item.kind}</span><strong>{item.title}</strong><span className="oid-state"><i/>{item.state === 'ready' ? 'Supplied' : item.state === 'pending' ? 'Pending' : 'Failed'}</span></span><span className="oid-tile-open" aria-hidden="true">↗</span>
    </button>)}</div>
    {selected ? <section ref={inspector} key={`${selected.id}-${revision}`} className="oid-inspector" id={`${uid}-inspector`} role="tabpanel" tabIndex={0} onFocus={() => { inspectorFocused.current = true }} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) inspectorFocused.current = false }} aria-labelledby={`${uid}-tile-${items.indexOf(selected)}`} data-state={selected.state} data-kind={selected.kind}>
      <header className="oid-inspector-head"><div><span className="oid-eyebrow">{selected.kind.toUpperCase()} · {selected.state === 'ready' ? 'SUPPLIED' : selected.state.toUpperCase()}</span><h3>{selected.title}</h3></div><button className="oid-close" type="button" onClick={close} aria-label="Close output inspector">×</button></header>
      {selected.detail && <p className="oid-detail">{selected.detail}</p>}
      <div className="oid-view-controls" role="group" aria-label="Output view"><button type="button" aria-pressed={view === 'inspect'} onClick={() => setView('inspect')}>Inspect</button><button type="button" aria-pressed={view === 'raw'} onClick={() => setView('raw')}>Original raw output</button>{selected.body !== undefined && <ConfirmedCopy text={selected.body} label="Copy raw" />}</div>
      {view === 'raw' ? <pre className="oid-raw" aria-label="Original raw output">{selected.body ?? 'No raw output supplied.'}</pre> : <div className="oid-inspect-body">
        {selected.state !== 'ready' && <div className={`oid-notice oid-${selected.state}`} role="status"><strong>{selected.state === 'pending' ? 'Awaiting this artifact' : 'This artifact failed'}</strong><p>{selected.state === 'pending' ? 'No ready receipt was supplied. The original output remains inspectable.' : 'The supplied failure is kept visible. Inspect the original output for detail.'}</p></div>}
        {selected.preview !== undefined ? <div className="oid-preview">{selected.preview}</div> : selected.body !== undefined ? <pre className="oid-raw">{selected.body}</pre> : selected.state === 'ready' ? <p className="oid-detail">No inspection content supplied.</p> : null}
        {selected.checks !== undefined && (selected.checks.length ? <div className="oid-checks"><span>SUPPLIED CHECK METADATA</span>{selected.checks.map((check, index) => <div key={index}><strong>{check.label}</strong><span>{check.result}</span></div>)}</div> : <p className="oid-no-checks">No check metadata supplied.</p>)}
      </div>}
      <footer className="oid-inspector-footer"><span>{selected.body === undefined ? 'No original text supplied' : 'Original text retained'}</span><span>Esc closes · arrows select</span></footer>
    </section> : <div className="oid-empty">{items.length ? 'Select an artifact to open its inspector.' : 'No outputs supplied yet.'}</div>}
  </div>
}
