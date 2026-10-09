import { useId, useRef, useState, type ReactNode } from 'react'
import { LivingIcon } from '../../../../packages/halo-face/living-assets'
import { useMotionGate, type MotionBankDemoProps } from './motion-bank-shared'
import './ContextStack.css'

export type ContextSource = {
  id: string
  kind: 'document' | 'image' | 'link'
  title: string
  state: 'loading' | 'ready' | 'failed'
  detail?: string
  /** Supplied revision receipt; absent means no revision comparison is available. */
  capturedRevision?: string
  currentRevision?: string
  removable?: boolean
}
export type ContextStackProps = {
  sources: ContextSource[]
  selectedId?: string | null
  openId?: string | null
  expanded: boolean
  onExpandedChange: (expanded: boolean) => void
  onInspect: (id: string) => void
  onRemove: (id: string) => void
  onClose: () => void
  paused?: boolean
  renderDetail?: (source: ContextSource) => ReactNode
  /** `strip` (the chat's input, Shaan 6 Oct 21:10: "it should just show the image boxes across"): thumbnails in a row, no header card. */
  variant?: 'card' | 'strip'
  thumbOf?: (source: ContextSource) => string | null
}

const kindLabels = { document: 'Document', image: 'Image', link: 'Link' }
export const sourceChanged = (source: ContextSource) => !!source.capturedRevision && !!source.currentRevision && source.capturedRevision !== source.currentRevision;
const stateLabels = { loading: 'Loading', ready: 'Ready', failed: 'Failed' }

function SourceGlyph({ kind }: { kind: ContextSource['kind'] }) {
  return <svg className="cs-glyph" viewBox="0 0 32 32" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    {kind === 'document' ? <><path d="M8 4h11l6 6v18H8zM19 4v7h6M12 16h9M12 20h9M12 24h6" /></> : kind === 'image' ? <><rect x="4" y="5" width="24" height="22" rx="3" /><circle cx="12" cy="12" r="2" /><path d="m5 23 8-7 5 4 4-6 6 9" /></> : <><path d="m13 20-3 3a5 5 0 0 1-7-7l6-6a5 5 0 0 1 7 0M19 12l3-3a5 5 0 0 1 7 7l-6 6a5 5 0 0 1-7 0M11 21l10-10" /></>}
  </svg>
}

/** Supplied state owns availability; motion never changes source metadata. */
/** The chat's compact form: one small box per source, click to open it below, × to take it off. */
function ContextStrip({ sources, openId, onInspect, onRemove, onClose, renderDetail, thumbOf }: ContextStackProps) {
  const uid = useId()
  const openSource = sources.find(source => source.id === openId)
  if (!sources.length) return null
  return <section className="cs-strip" aria-label="Attached context" onKeyDown={event => { if (event.key === 'Escape' && openSource) { event.preventDefault(); onClose() } }}>
    <ul className="cs-strip__row">
      {sources.map(source => { const thumb = source.state === 'ready' ? thumbOf?.(source) ?? null : null; return <li key={`${source.id}-${source.state}`} className="cs-strip__tile" data-state={source.state} data-open={source.id === openId}>
        <button type="button" className="cs-strip__open" title={`${source.title} · ${stateLabels[source.state]}`} aria-label={`Inspect ${source.title}`} aria-expanded={source.id === openId} aria-controls={source.id === openId ? uid + '-detail' : undefined} onClick={() => source.id === openId ? onClose() : onInspect(source.id)}>
          {thumb ? <img src={thumb} alt="" loading="lazy" /> : <SourceGlyph kind={source.kind} />}
          {sourceChanged(source) && <span className="cs-changed" title="Changed since captured">!</span>}
          {source.state === 'loading' && <i className="cs-strip__spin" aria-hidden="true" />}
        </button>
        <button type="button" className="cs-strip__x" disabled={source.removable === false} aria-label={`Remove ${source.title}`} onClick={() => onRemove(source.id)}>×</button>
      </li> })}
    </ul>
    {openSource && <div id={uid + '-detail'} className="cs-strip__detail" role="region" aria-label={`Details for ${openSource.title}`}><span>{openSource.title} · {stateLabels[openSource.state]}{sourceChanged(openSource) && " · Changed since captured"}</span>{renderDetail?.(openSource)}</div>}
  </section>
}

export function ContextStack(props: ContextStackProps) {
  return props.variant === 'strip' ? <ContextStrip {...props} /> : <ContextCard {...props} />
}

function ContextCard({ sources, selectedId, openId, expanded, onExpandedChange, onInspect, onRemove, onClose, paused = false, renderDetail }: ContextStackProps) {
  const { ref, motion } = useMotionGate(paused)
  const uid = useId()
  const inspectButtons = useRef(new Map<string, HTMLButtonElement>())
  const expandButton = useRef<HTMLButtonElement>(null)
  const openSource = sources.find(source => source.id === openId)
  const focusId = selectedId ?? openId ?? sources[0]?.id
  const close = () => {
    onClose()
    if (openId) inspectButtons.current.get(openId)?.focus()
  }
  return <section ref={ref} className="cs-stack" data-motion={motion} data-expanded={expanded || !!openSource} aria-label="Attached context" onKeyDown={event => {
    if (event.key === 'Escape') {
      if (openSource) { event.preventDefault(); close() }
      else if (expanded) { event.preventDefault(); onExpandedChange(false); expandButton.current?.focus() }
    }
  }}>
    <header className="cs-header"><div className="cs-heading"><LivingIcon name="library" variant="glyph" size={32} paused={!motion} /><span><strong>Context stack</strong><small>{sources.length} {sources.length === 1 ? 'source' : 'sources'} attached</small></span></div>
      <button ref={expandButton} className="cs-button" type="button" disabled={!sources.length} aria-expanded={expanded || !!openSource} aria-controls={uid + '-sources'} onClick={() => { if (openSource) close(); onExpandedChange(!(expanded || !!openSource)) }}>{expanded || openSource ? 'Collapse' : 'Expand'}<span aria-hidden="true">{expanded || openSource ? '−' : '+'}</span></button>
    </header>
    {!sources.length ? <div className="cs-empty"><SourceGlyph kind="document" /><strong>No sources attached</strong><p>Add a source to inspect its supplied details.</p></div> : <ul className="cs-sources" id={uid + '-sources'}>
      {sources.map(source => <li className="cs-card" key={`${source.id}-${source.state}`} data-state={source.state} data-active={source.id === focusId}>
        <div className="cs-source-icon"><SourceGlyph kind={source.kind} /></div>
        <div className="cs-source-copy"><span className="cs-kind">{kindLabels[source.kind]}</span><strong>{source.title}</strong><span className="cs-state"><i aria-hidden="true" />{stateLabels[source.state]}{sourceChanged(source) && " · Changed since captured"}{source.state === 'loading' && <span className="cs-loading-mark" aria-hidden="true"> · · ·</span>}</span></div>
        <div className="cs-actions"><button className="cs-button" ref={element => { if (element) inspectButtons.current.set(source.id, element); else inspectButtons.current.delete(source.id) }} type="button" aria-expanded={openId === source.id} aria-controls={openId === source.id ? uid + '-detail' : undefined} aria-label={`Inspect ${source.title}`} onClick={() => onInspect(source.id)}>Inspect</button><button className="cs-remove" type="button" disabled={source.removable === false} aria-label={`Remove ${source.title}`} onClick={() => { onRemove(source.id); expandButton.current?.focus() }}>×</button></div>
      </li>)}
    </ul>}
    {openSource && <div id={uid + '-detail'} className="cs-detail" role="region" aria-label={`Details for ${openSource.title}`}><div className="cs-detail-heading"><strong>{openSource.title}</strong><button className="cs-button" type="button" onClick={close}>Close</button></div><p className="cs-detail-meta">{kindLabels[openSource.kind]} · {stateLabels[openSource.state]}</p><p>{openSource.detail ?? 'No detail supplied.'}</p>{renderDetail?.(openSource)}<button className="cs-button" type="button" disabled={openSource.removable === false} onClick={() => { onRemove(openSource.id); expandButton.current?.focus() }}>Remove source</button></div>}
  </section>
}

const exampleSources: ContextSource[] = [
  { id: 'example-document', kind: 'document', title: 'Workspace brief', state: 'ready', detail: 'Example metadata · 4 pages · design decisions and handoffs. No filesystem has been read.' },
  { id: 'example-image', kind: 'image', title: 'Layout reference', state: 'loading', detail: 'Example metadata · symbolic image attachment. Waiting for supplied state.' },
  { id: 'example-link', kind: 'link', title: 'Component reference', state: 'failed', detail: 'Example metadata · the source could not be loaded. No URL was fetched.' },
]

export function ContextStackDemo({ paused = false }: MotionBankDemoProps) {
  const [sources, setSources] = useState<ContextSource[]>(() => exampleSources.map(source => ({ ...source })))
  const [selectedId, setSelectedId] = useState<string | null>('example-image')
  const [openId, setOpenId] = useState<string | null>(null)
  const [expanded, setExpanded] = useState(false)
  const [kind, setKind] = useState<ContextSource['kind']>('document')
  const [receipt, setReceipt] = useState('Example fixtures · states change only through these controls.')
  const nextId = useRef(1)
  const selectId = useId()
  const selected = sources.find(source => source.id === selectedId)
  const supplyState = (state: ContextSource['state']) => {
    if (!selected) return
    setSources(current => current.map(source => source.id === selected.id ? { ...source, state } : source))
    setReceipt(`Example state supplied: ${selected.title} → ${stateLabels[state]}.`)
  }
  const remove = (id: string) => {
    const source = sources.find(item => item.id === id)
    setSources(current => current.filter(item => item.id !== id))
    if (openId === id) setOpenId(null)
    if (selectedId === id) setSelectedId(sources.find(item => item.id !== id)?.id ?? null)
    setReceipt(`Local remove callback: ${source?.title ?? id}.`)
  }
  return <div className="cs-demo" data-demo-id="context-stack"><p className="cs-example">Synthetic example · local context sources</p><ContextStack sources={sources} selectedId={selectedId} openId={openId} expanded={expanded} onExpandedChange={setExpanded} paused={paused} onInspect={id => { setSelectedId(id); setOpenId(id); setReceipt(`Local inspect callback: ${sources.find(source => source.id === id)?.title}.`) }} onRemove={remove} onClose={() => setOpenId(null)} />
    <div className="cs-demo-controls"><label>Source kind<select value={kind} onChange={event => setKind(event.target.value as ContextSource['kind'])}><option value="document">Document</option><option value="image">Image</option><option value="link">Link</option></select></label><button className="cs-button" type="button" onClick={() => { const sequence = nextId.current++; const id = `example-added-${sequence}`; const title = `${kindLabels[kind]} example ${sequence}`; setSources(current => [...current, { id, kind, title, state: 'loading', detail: 'Example metadata · added locally; no upload, reading or fetching took place.' }]); setSelectedId(id); setReceipt(`Added ${title} · Loading state supplied.`) }}>Add source</button>
      <label htmlFor={selectId}>Selected source<select id={selectId} value={selectedId ?? ''} disabled={!sources.length} onChange={event => setSelectedId(event.target.value)}>{!sources.length && <option value="">No sources</option>}{sources.map(source => <option key={source.id} value={source.id}>{source.title}</option>)}</select></label><button className="cs-button" type="button" disabled={!selected} onClick={() => supplyState('ready')}>Mark ready</button><button className="cs-button" type="button" disabled={!selected} onClick={() => supplyState('failed')}>Fail source</button>
    </div><p className="cs-receipt" role="status">{receipt}</p></div>
}
