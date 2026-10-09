import { useEffect, useId, useRef, useState } from 'react'
import { LivingIcon } from '../../../../packages/halo-face/living-assets'
import { useMotionGate, type MotionBankDemoProps } from './motion-bank-shared'
import './ChatLinkPreview.css'

export type ChatLinkPreviewState = 'unavailable' | 'loading' | 'ready' | 'failed'
export type ChatLinkPreviewItem = {
  id: string
  url: string
  title?: string
  description?: string
  previewState: ChatLinkPreviewState
  /** Inline image data only. Remote thumbnails remain a static frame until the owner supplies image bytes. */
  thumbnail?: { src: string; alt: string }
}
export type ChatLinkPreviewProps = {
  item: ChatLinkPreviewItem
  expanded: boolean
  onExpand: (item: ChatLinkPreviewItem, expanded: boolean) => void
  onOpen?: (item: ChatLinkPreviewItem, destination: string) => void
  onRetry?: (item: ChatLinkPreviewItem) => void
  paused?: boolean
}

const labels: Record<ChatLinkPreviewState, string> = {
  unavailable: 'Metadata unavailable', loading: 'Metadata pending', ready: 'Supplied preview', failed: 'Preview failed',
}
function destinationOf(raw: string): URL | null {
  try {
    if (!/^https?:\/\//i.test(raw) || /[\u0000-\u0020\u007f]/.test(raw)) return null
    const destination = new URL(raw)
    return ['http:', 'https:'].includes(destination.protocol) && destination.hostname && !destination.username && !destination.password ? destination : null
  } catch { return null }
}

/** Disclosure only: the owner supplies metadata and owns page-tab routing. */
export function ChatLinkPreview({ item, expanded, onExpand, onOpen, onRetry, paused = false }: ChatLinkPreviewProps) {
  const { ref, motion } = useMotionGate(paused)
  const trigger = useRef<HTMLButtonElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  const panelId = useId()
  const titleId = useId()
  const destination = destinationOf(item.url)
  const imageSource = item.thumbnail?.src
  const inlineImage = imageSource && /^data:image\/(png|jpeg|webp|gif);base64,[a-z0-9+/=\s]+$/i.test(imageSource) ? imageSource : undefined
  const [brokenImage, setBrokenImage] = useState(false)
  useEffect(() => { setBrokenImage(false) }, [imageSource, item.id])
  useEffect(() => {
    if (!expanded && panel.current?.contains(document.activeElement)) trigger.current?.focus()
  }, [expanded])
  const close = () => { onExpand(item, false); trigger.current?.focus() }
  return <div ref={ref} className="lp-object" data-motion={motion && item.previewState !== 'failed'} data-state={item.previewState} onKeyDown={event => {
    if (event.key === 'Escape' && expanded) { event.preventDefault(); event.stopPropagation(); close() }
  }}>
    <button ref={trigger} type="button" className="lp-chip" aria-expanded={expanded} aria-controls={panelId} onClick={() => onExpand(item, !expanded)}>
      <LivingIcon name="web" variant="glyph" size={26} active={expanded} paused={!motion || item.previewState === 'failed'} />
      <span className="lp-chip-copy"><strong>{item.title || destination?.hostname || 'Inspect link'}</strong><span>{destination?.host || 'Invalid destination'}</span></span>
      <span className="lp-chevron" aria-hidden="true">{expanded ? '−' : '+'}</span>
    </button>
    <div className="lp-fold" data-expanded={expanded}>
      <div ref={panel} id={panelId} className="lp-fold-inner" inert={!expanded} aria-hidden={!expanded}>
        <section className="lp-browser" aria-labelledby={titleId}>
          <div className="lp-chrome"><span className="lp-chrome-dots" aria-hidden="true"><i /><i /><i /></span><span>LINK PREVIEW</span><button type="button" className="lp-close" aria-label="Collapse link preview" onClick={close}>×</button></div>
          <div className="lp-address"><span>Destination</span><strong>{destination?.host || 'Cannot open this destination'}</strong><code>{item.url || '(empty URL)'}</code></div>
          <div className="lp-page">
            <div className="lp-thumbnail">{inlineImage && !brokenImage ? <img src={inlineImage} alt={item.thumbnail?.alt || 'Supplied page thumbnail'} onError={() => setBrokenImage(true)} /> : <><LivingIcon name="web" size={64} paused /><span>Thumbnail not supplied</span></>}</div>
            <div className="lp-metadata"><span className="lp-status" role="status">{labels[item.previewState]}</span><h3 id={titleId}>{item.title || 'No title supplied'}</h3><p>{item.description || 'The owner has not supplied a description for this link.'}</p></div>
          </div>
          {!destination && <p className="lp-warning">Only valid HTTP or HTTPS destinations without embedded credentials can be opened.</p>}
          {item.previewState === 'failed' && <p className="lp-warning">Preview metadata failed. The destination can still be opened deliberately.</p>}
          <div className="lp-actions">
            {(item.previewState === 'failed' || item.previewState === 'unavailable') && <button type="button" className="lp-retry" disabled={!destination || !onRetry} onClick={() => onRetry?.(item)}>Request preview</button>}
            <button type="button" className="lp-open" disabled={!destination || !onOpen} onClick={() => { if (destination) onOpen?.(item, destination.href) }}>Open page <span aria-hidden="true">↗</span></button>
          </div>
          {destination && !onOpen && <p className="lp-warning">Page action is not connected.</p>}
        </section>
      </div>
    </div>
  </div>
}

const examples: ChatLinkPreviewItem[] = [
  { id: 'ready', url: 'https://studio.example/work/materials', title: 'Material studies', description: 'Example metadata supplied by a local fixture: three studies in glass, metal and light.', previewState: 'ready' },
  { id: 'pending', url: 'https://notes.example/fieldnotes', previewState: 'loading' },
  { id: 'failed', url: 'https://archive.example/study/03', title: 'Study archive', previewState: 'failed' },
  { id: 'invalid', url: 'javascript:alert("example")', title: 'Unsupported link', previewState: 'unavailable' },
]

export function ChatLinkPreviewDemo({ paused = false }: MotionBankDemoProps) {
  const [index, setIndex] = useState(0)
  const [item, setItem] = useState(examples[0])
  const [expanded, setExpanded] = useState(false)
  const [receipt, setReceipt] = useState('No local callback yet.')
  const [opened, setOpened] = useState<{ destination: string; title: string; description: string } | null>(null)
  return <div className="lp-demo" data-demo-id="chat-link-preview">
    <div className="lp-demo-heading"><span>LOCAL EXAMPLE · CHAT LINKS</span><p>Inspect a link, then choose whether to open its page.</p></div>
    <label className="lp-demo-select">Example link<select value={index} onChange={event => {
      const next = Number(event.target.value); setIndex(next); setItem(examples[next]); setExpanded(false); setOpened(null); setReceipt('Example changed. No local callback yet.')
    }}><option value={0}>Supplied preview</option><option value={1}>Metadata pending</option><option value={2}>Failed preview</option><option value={3}>Invalid destination</option></select></label>
    <p className="lp-chat-text">Here is the page mentioned in this example conversation:</p>
    <ChatLinkPreview item={item} expanded={expanded} paused={paused} onExpand={(value, next) => { setExpanded(next); setReceipt(`${next ? 'Expanded' : 'Collapsed'} local link ${value.id}.`) }} onRetry={value => {
      setItem({ ...value, previewState: 'loading' }); setReceipt(`Local preview request: ${value.url}. Supply a result below.`)
    }} onOpen={(value, destination) => {
      setReceipt(`Local Open page callback: ${destination}`)
      setOpened({ destination, title: value.title || 'Example destination', description: value.description || 'This local destination panel has no supplied page content.' })
    }} />
    <div className="lp-demo-controls" aria-label="Supply local preview result"><button type="button" onClick={() => { setItem({ ...item, previewState: 'ready', title: 'Local supplied result', description: 'This metadata was supplied by the example success control.' }); setReceipt('Local success metadata supplied.') }}>Supply success</button><button type="button" onClick={() => { setItem({ ...item, previewState: 'failed' }); setReceipt('Local failure supplied.') }}>Supply failure</button></div>
    <p className="lp-receipt" role="status">{receipt}</p>
    {opened && <section className="lp-local-page" aria-label="Local destination preview"><div className="lp-local-page-heading"><strong>LOCAL DESTINATION EXAMPLE</strong><button type="button" onClick={() => setOpened(null)}>Close local page</button></div><code>{opened.destination}</code><h3>{opened.title}</h3><p>{opened.description}</p><small>The owner callback rendered this local panel. No external page was opened.</small></section>}
  </div>
}
