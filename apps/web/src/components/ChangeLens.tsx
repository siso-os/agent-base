import { useEffect, useId, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { LivingIcon } from '../../../../packages/halo-face/living-assets'
import { useMotionGate, type MotionBankDemoProps } from './motion-bank-shared'
import './ChangeLens.css'

export type ChangeLensPreview = {
  title: string
  /** Read-only supplied evidence. Thumbnail sources must be trusted by the caller. */
  node?: ReactNode
  thumbnail?: { src: string; alt: string }
}
export type ChangeLensLine = {
  id: string
  before?: string
  after?: string
  beforeLine?: number
  afterLine?: number
}
export type ChangeLensProps = {
  before: ChangeLensPreview
  after: ChangeLensPreview
  value: number
  onChange: (value: number) => void
  view: 'visual' | 'code'
  changedLines?: readonly ChangeLensLine[]
  /** A supplied evidence revision, never inferred from telemetry. */
  revision?: string | number
  paused?: boolean
  className?: string
}

function Preview({ preview }: { preview: ChangeLensPreview }) {
  if (preview.node != null) return <>{preview.node}</>
  if (preview.thumbnail) return <img className="cl-thumbnail" src={preview.thumbnail.src} alt={preview.thumbnail.alt} />
  return <div className="cl-empty">No preview supplied</div>
}

/** Displays caller-owned evidence. Range updates are requests to its controlling owner. */
export function ChangeLens({ before, after, value, onChange, view, changedLines = [], revision, paused = false, className = '' }: ChangeLensProps) {
  const { ref, motion } = useMotionGate<HTMLElement>(paused)
  const labelId = useId()
  const frameId = useId()
  const previousRevision = useRef(revision)
  const [highlight, setHighlight] = useState(0)
  useEffect(() => {
    if (previousRevision.current !== revision) {
      previousRevision.current = revision
      setHighlight(count => count + 1)
    }
  }, [revision])
  const reveal = Number.isFinite(value) ? Math.min(100, Math.max(0, value)) : 50
  const hasLines = changedLines.some(line => line.before !== undefined || line.after !== undefined)
  return <section ref={ref} className={`cl-lens ${className}`} data-motion={motion ? 'on' : 'off'} aria-label="Change comparison">
    <header className="cl-heading">
      <div className="cl-heading__icon"><LivingIcon name="web" variant="glyph" size={30} paused={!motion} /></div>
      <div><span className="cl-eyebrow">SUPPLIED EVIDENCE</span><h3>Change lens</h3></div>
      <span className="cl-mode">{view === 'visual' ? 'Visual comparison' : 'Code comparison'}</span>
    </header>
    <div className="cl-titles"><div><span>Before</span><strong>{before.title}</strong></div><div><span>After</span><strong>{after.title}</strong></div></div>
    {view === 'visual' ? <>
      <div className="cl-frame" id={frameId} style={{ '--cl-position': `${reveal}%` } as CSSProperties}>
        <div className="cl-layer cl-layer--before" inert><Preview preview={before} /></div>
        <div className="cl-layer cl-layer--after" inert style={{ clipPath: `inset(0 0 0 ${reveal}%)` }}><Preview preview={after} /></div>
        <span className="cl-frame__label cl-frame__label--before">Before</span><span className="cl-frame__label cl-frame__label--after">After</span>
        <div className="cl-divider" aria-hidden="true"><span>‹ ›</span></div>
      </div>
      <div className="cl-range-caption"><label id={labelId} htmlFor={`${frameId}-range`}>Comparison divider</label><output htmlFor={`${frameId}-range`}>{Math.round(reveal)}% before</output></div>
      <input className="cl-range" id={`${frameId}-range`} type="range" min={0} max={100} step={1} value={reveal} aria-labelledby={labelId} aria-controls={frameId} aria-valuetext={`${Math.round(reveal)} percent before, ${Math.round(100 - reveal)} percent after`} onChange={event => onChange(Number(event.currentTarget.value))} />
      <p className="cl-hint">Drag to compare · Arrow keys adjust · Home / End reveal either version</p>
    </> : <div key={highlight} className={`cl-code ${highlight > 0 && motion ? 'cl-code--revised' : ''}`} aria-label="Supplied changed lines">
      <div className="cl-code__legend"><span>− Removed from before</span><span>+ Added in after</span></div>
      {hasLines ? changedLines.map(line => <div className="cl-code__record" key={line.id}>
        {line.before !== undefined && <div className="cl-code__line cl-code__line--removed"><span className="cl-code__number">{line.beforeLine ?? '·'}</span><span className="cl-code__sign" aria-label="Removed">−</span><code>{line.before}</code></div>}
        {line.after !== undefined && <div className="cl-code__line cl-code__line--added"><span className="cl-code__number">{line.afterLine ?? '·'}</span><span className="cl-code__sign" aria-label="Added">+</span><code>{line.after}</code></div>}
      </div>) : <div className="cl-empty">No changed lines supplied for this comparison.</div>}
      {(before.node != null || after.node != null) && <details className="cl-source"><summary>Captured before and after text</summary><div><section aria-label="Captured before text"><h4>Before</h4><Preview preview={before} /></section><section aria-label="Captured after text"><h4>After</h4><Preview preview={after} /></section></div></details>}
    </div>}
  </section>
}

function SitePreview({ after, revision }: { after: boolean; revision: number }) {
  return <div className={`cl-site ${after ? 'cl-site--after' : ''}`}>
    <div className="cl-site__nav"><b>FORM / 01</b><span>Studio / Objects</span></div>
    <div className="cl-site__body"><div><small>INDEPENDENT DESIGN STUDIO</small><h4>{after ? 'Room for\nwhat’s next.' : 'Made with\nintention.'}</h4><p>{after ? 'Objects, spaces and digital experiences. A little more room to explore.' : 'We make considered objects for everyday living.'}</p><span className="cl-site__cta">{after && revision > 0 ? 'View collection ↗' : after ? 'Explore the collection ↗' : 'Our work →'}</span></div><div className="cl-site__art" aria-hidden="true"><div /><span>01 / FORM STUDY</span></div></div>
    <div className="cl-site__footer"><span>LOCAL SYNTHETIC SITE</span><span>{after ? 'Collection 01' : 'Studio 01'}</span></div>
  </div>
}

export function ChangeLensDemo({ paused = false }: MotionBankDemoProps) {
  const [value, setValue] = useState(50)
  const [view, setView] = useState<'visual' | 'code'>('visual')
  const [revision, setRevision] = useState(0)
  const [receipt, setReceipt] = useState('Example comparison supplied. Divider at 50%.')
  const reset = () => { setValue(50); setView('visual'); setRevision(0); setReceipt('Example comparison reset. Divider at 50%.') }
  const lines: ChangeLensLine[] = [
    { id: 'title', beforeLine: 12, afterLine: 12, before: '<h1>Made with intention.</h1>', after: '<h1>Room for what’s next.</h1>' },
    { id: 'space', beforeLine: 21, afterLine: 21, before: 'gap: 16px;', after: 'gap: 28px;' },
    { id: 'action', beforeLine: 26, afterLine: 26, before: '<span>Our work →</span>', after: `<span>${revision > 0 ? 'View collection' : 'Explore the collection'} ↗</span>` },
  ]
  return <div className="cl-demo" data-demo-id="change-lens">
    <div className="cl-controls"><span className="cl-example">LOCAL EXAMPLE</span><div role="group" aria-label="Comparison mode">{(['visual', 'code'] as const).map(mode => <button type="button" key={mode} aria-pressed={view === mode} onClick={() => { setView(mode); setReceipt(`Example ${mode} view selected.`) }}>{mode === 'visual' ? 'Visual' : 'Code'}</button>)}</div><button type="button" onClick={reset}>Reset comparison</button></div>
    <ChangeLens before={{ title: 'Original studio', node: <SitePreview after={false} revision={0} /> }} after={{ title: revision > 0 ? 'Collection · revision 2' : 'Collection · revision 1', node: <SitePreview after revision={revision} /> }} value={value} onChange={next => { setValue(next); setReceipt(`Local onChange received: ${next}% before / ${100 - next}% after.`) }} view={view} changedLines={lines} revision={revision} paused={paused} />
    <div className="cl-demo__footer"><button type="button" onClick={() => { const next = revision === 0 ? 1 : 0; setRevision(next); setReceipt(`Example revision ${next + 1} supplied. CTA and supplied code updated.`) }}>Supply example revision {revision === 0 ? '2' : '1'}</button><p role="status">{receipt}</p></div>
  </div>
}
