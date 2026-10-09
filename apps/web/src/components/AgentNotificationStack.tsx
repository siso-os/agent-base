// uihub: siso:agent-notification-row
import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { Check, Heart, Send, ThumbsUp, X } from 'lucide-react'
import { AgentFace, type FaceFamily } from '../../../../packages/halo-face/living-assets'
import { useMotionGate, type MotionBankDemoProps } from './motion-bank-shared'
import './AgentNotificationStack.css'

export type AgentNotificationOwner = { id: string; name: string; project?: string; family?: FaceFamily }
/** Supplied presentation data; optional capabilities never imply backend support. */
export type AgentStackNotification = { id: string; at: string; title: string; body?: string; needs?: string; read: boolean; react?: string | null; url?: string; owner?: AgentNotificationOwner }
export type NotificationPatch = { read?: boolean; react?: string | null }
export type AgentNotificationStackProps = {
  agent: AgentNotificationOwner
  notifications: readonly AgentStackNotification[]
  onMark?: (id: string, patch: NotificationPatch) => void | Promise<void>
  onReply?: (id: string, text: string) => void | Promise<void>
  /** Existing attention dialog owns its focus, dismissal and request commands. */
  embedded?: boolean
  preserveOrder?: boolean
  renderActions?: (item: AgentStackNotification) => ReactNode
  relatedLabel?: string
  /** Related pages are handed to the owner, never opened by this component. */
  onRelated?: (item: AgentStackNotification) => void
  paused?: boolean
  className?: string
}

function BellGlyph() {
  const id = useId()
  return <svg className="an-bell" viewBox="0 0 32 32" aria-hidden="true">
    <defs><linearGradient id={id} x1="0" y1="0" x2="1" y2="1"><stop stopColor="#eef4ff" /><stop offset=".4" stopColor="#99b2ca" /><stop offset=".75" stopColor="#53697f" /><stop offset="1" stopColor="#d2e0ec" /></linearGradient></defs>
    <path className="an-bell__stack" d="M22 6h5v14h-3M24 4h5v14" fill="none" stroke="#597b98" strokeWidth="1.2" />
    <g className="an-bell__body"><path d="M7 22c3-3 2-5 3-10a6 6 0 0 1 12 0c1 5 0 7 3 10v2H7z" fill={`url(#${id})`} stroke="#dbe9f4" strokeWidth=".8" /><path d="M12 12a4 4 0 0 1 4-4M10 21h12" fill="none" stroke="#f5fbff" strokeOpacity=".6" /><path d="M13 26a3 3 0 0 0 6 0" fill="none" stroke="#b5cce0" strokeWidth="2" strokeLinecap="round" /><path d="M16 4v2" stroke="#b5cce0" strokeWidth="2" strokeLinecap="round" /></g>
  </svg>
}

function NotificationRow({ item, owner, onMark, onReply, onRelated, renderActions, relatedLabel }: {
  item: AgentStackNotification; owner: AgentNotificationOwner
} & Pick<AgentNotificationStackProps, 'onMark' | 'onReply' | 'onRelated' | 'renderActions' | 'relatedLabel'>) {
  const [draft, setDraft] = useState('')
  const [pending, setPending] = useState('')
  const [error, setError] = useState('')
  const [receipt, setReceipt] = useState('')
  const [awaiting, setAwaiting] = useState<{ read?: boolean; react?: string | null } | null>(null)
  const lock = useRef(false)
  const alive = useRef(false)
  const titleId = useId()
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])
  useEffect(() => {
    if (awaiting && (awaiting.read === undefined || awaiting.read === item.read) && (awaiting.react === undefined || awaiting.react === item.react)) { lock.current = false; setAwaiting(null) }
  }, [item.read, item.react, awaiting])
  async function act(label: string, callback: () => void | Promise<void>, patch?: { read?: boolean; react?: string | null }) {
    if (lock.current || awaiting) return
    lock.current = true
    setPending(label); setError(''); setReceipt('')
    try {
      await callback()
      if (!alive.current) return
      if (patch) { setAwaiting(patch); setReceipt('Save accepted. Read and reaction state follow the owner’s supplied items.') }
      else { setDraft(''); setReceipt(`Reply accepted by ${owner.name}’s callback.`) }
    } catch (cause) {
      lock.current = false
      if (alive.current) setError(cause instanceof Error ? cause.message : 'The owner did not accept this action. Try again.')
    } finally {
      if (!patch) lock.current = false
      if (alive.current) setPending('')
    }
  }
  const unavailable = Boolean(pending || awaiting)
  function mark(patch: { read?: boolean; react?: string | null }, label: string) { void act(label, () => onMark?.(item.id, patch), patch) }
  return <article className="an-item" data-read={item.read} aria-labelledby={titleId} aria-busy={Boolean(pending)}>
    <div className="an-item__identity"><AgentFace name={owner.name} family={owner.family} project={owner.project} size={34} paused />
      <div><strong>{owner.name}</strong><span>{owner.project ?? 'Responsible agent'}</span></div><span className="an-item__state">{item.read ? 'Read' : 'Unread'}</span>
    </div>
    <time className="an-item__time" dateTime={item.at}>{item.at.replace('T', ' · ').replace(/Z$/, ' UTC')}</time>
    <h3 id={titleId}>{item.title}</h3>{item.body && <p className="an-item__body">{item.body}</p>}
    {item.needs && <p className="an-item__needs"><span>Needs you</span>{item.needs}</p>}
    {item.url && <button className="an-item__related" type="button" disabled={!onRelated || unavailable} onClick={() => onRelated?.(item)}>{relatedLabel ?? 'Inspect related context ↗'}</button>}
    {onMark && !renderActions && <div className="an-item__actions">
      <button type="button" disabled={unavailable} aria-pressed={item.read} onClick={() => mark({ read: !item.read }, item.read ? 'Marking unread' : 'Marking read')}><Check size={14} />{item.read ? 'Mark unread' : 'Mark read'}</button>
      <button type="button" disabled={unavailable} aria-label={`Like notification ${item.id}`} aria-pressed={item.react === 'like'} onClick={() => mark({ react: item.react === 'like' ? null : 'like' }, 'Saving reaction')}><ThumbsUp size={14} /><span>Like</span></button>
      <button type="button" disabled={unavailable} aria-label={`Love notification ${item.id}`} aria-pressed={item.react === 'love'} onClick={() => mark({ react: item.react === 'love' ? null : 'love' }, 'Saving reaction')}><Heart size={14} /><span>Love</span></button>
    </div>}
    {renderActions ? renderActions(item) : onReply && <form className="an-item__reply" onSubmit={event => { event.preventDefault(); if (draft.trim()) void act('Sending reply', () => onReply?.(item.id, draft)) }}>
      <textarea aria-label={`Reply to notification ${item.id}`} rows={2} placeholder={`Reply to ${owner.name}…`} value={draft} disabled={unavailable} onChange={event => setDraft(event.target.value)} />
      <div><span>Enter adds a new line</span><button type="submit" disabled={unavailable || !draft.trim()}><Send size={13} />Send reply</button></div>
    </form>}
    {pending && <p className="an-item__pending" role="status">{pending}… Waiting for owner confirmation.</p>}
    {receipt && <p className="an-item__receipt" role="status">{receipt}</p>}
    {error && <p className="an-item__error" role="alert">{error} Your supplied read state and draft are retained.</p>}
  </article>
}

function NotificationSession({ agent, notifications, onMark, onReply, onRelated, renderActions, relatedLabel, embedded = false, preserveOrder = false, paused, className = '' }: AgentNotificationStackProps) {
  const { ref, motion } = useMotionGate<HTMLDivElement>(paused)
  const [open, setOpen] = useState(false)
  const [arrival, setArrival] = useState(0)
  const known = useRef(new Set(notifications.map(item => item.id)))
  const motionRef = useRef(motion)
  motionRef.current = motion
  const trigger = useRef<HTMLButtonElement>(null)
  const closeButton = useRef<HTMLButtonElement>(null)
  const panelId = useId()
  const unread = notifications.filter(item => !item.read).length
  const rows = preserveOrder ? [...notifications] : [...notifications].sort((a, b) => Number(Boolean(b.needs)) - Number(Boolean(a.needs)) || (Date.parse(b.at) || 0) - (Date.parse(a.at) || 0))
  useEffect(() => {
    const added = notifications.some(item => !known.current.has(item.id))
    notifications.forEach(item => known.current.add(item.id))
    if (added && motionRef.current) setArrival(value => value + 1)
  }, [notifications])
  useEffect(() => { if (!motion) setArrival(0) }, [motion])
  function close(restore = true) { setOpen(false); if (restore) trigger.current?.focus() }
  useEffect(() => {
    if (!open || embedded) return
    closeButton.current?.focus()
    let pointerInProgress = false
    const pointer = () => { pointerInProgress = true }
    const outside = (event: MouseEvent) => { pointerInProgress = false; if (!ref.current?.contains(event.target as Node)) setOpen(false) }
    const escape = (event: KeyboardEvent) => { pointerInProgress = false; if (event.key === 'Escape') { event.stopPropagation(); setOpen(false); trigger.current?.focus() } }
    const focusOutside = (event: FocusEvent) => {
      const target = event.target
      // WebKit can focus an ancestor when a pointer presses a button; the click still belongs to this stack.
      if (!pointerInProgress && target instanceof Node && !ref.current?.contains(target) && !target.contains(ref.current)) setOpen(false)
    }
    document.addEventListener('pointerdown', pointer)
    document.addEventListener('click', outside)
    document.addEventListener('keydown', escape)
    document.addEventListener('focusin', focusOutside)
    return () => { document.removeEventListener('pointerdown', pointer); document.removeEventListener('click', outside); document.removeEventListener('keydown', escape); document.removeEventListener('focusin', focusOutside) }
  }, [open, ref, embedded])
  return <div ref={ref} className={`an-stack ${embedded ? 'an-stack--embedded' : ''} ${className}`} data-motion={motion}>
    {!embedded && <div className="an-topbar"><div className="an-topbar__label"><span className="an-topbar__eyebrow">Agent inbox</span><strong>{agent.name}</strong></div>
      <button className="an-trigger" ref={trigger} type="button" aria-label={`${agent.name} notifications, ${unread} unread`} aria-expanded={open} aria-controls={panelId} onClick={() => setOpen(value => !value)}>
        <span className="an-trigger__glyph" key={arrival} data-arrival={arrival > 0} onAnimationEnd={() => setArrival(0)}><BellGlyph /></span>{unread > 0 && <span className="an-trigger__count">{unread > 99 ? '99+' : unread}</span>}
      </button>
    </div>}
    <section className="an-panel" id={panelId} hidden={!embedded && !open} aria-label={`${agent.name} notification stack`} data-native-overlay={!embedded && open ? 'true' : undefined}>
      {!embedded && <header className="an-panel__header"><div><span className="an-topbar__eyebrow">Messages from your agents</span><h2>Notification stack</h2><p>{unread} unread · {rows.length} total</p></div><button ref={closeButton} type="button" aria-label="Close notifications" onClick={() => close()}><X size={17} /></button></header>}
      <div className="an-panel__list">{rows.length ? rows.map(item => <NotificationRow key={`${item.owner?.id ?? agent.id}:${item.id}`} item={item} owner={item.owner ?? agent} onMark={onMark} onReply={onReply} onRelated={onRelated} renderActions={renderActions} relatedLabel={relatedLabel} />) : <div className="an-empty"><BellGlyph /><strong>You’re all caught up</strong><p>No messages supplied. Agents keep their work.</p></div>}</div>
      {!embedded && <footer className="an-panel__footer">Opening this stack keeps each message’s read state.</footer>}
    </section>
  </div>
}

export function AgentNotificationStack(props: AgentNotificationStackProps) { return <NotificationSession key={props.agent.id} {...props} /> }

const exampleOwner: AgentNotificationOwner = { id: 'sol', name: 'Sol', project: 'Agent Base', family: 'codex' }
function exampleItems(): AgentStackNotification[] { return [
  { id: 'review-1', at: '2026-10-06T09:42:00Z', title: 'A preview needs your direction', body: 'The local message stack is ready to inspect. Choose the spacing before the next design pass.', needs: 'Keep the compact density, or give the messages more room?', read: false, react: null },
  { id: 'context-1', at: '2026-10-06T09:36:00Z', owner: { id: 'astra', name: 'Astra', project: 'Workspace', family: 'codex' }, title: 'Context attached for review', body: 'Two synthetic context notes are attached to the example workspace. This message records the handoff.', read: true, react: 'like' },
] }
type DemoRequest = { label: string; accept: () => void; reject: () => void }
export function AgentNotificationStackDemo({ paused }: MotionBankDemoProps) {
  const [items, setItems] = useState(exampleItems)
  const [request, setRequest] = useState<DemoRequest | null>(null)
  const active = useRef<DemoRequest | null>(null)
  const [receipts, setReceipts] = useState<string[]>([])
  const nextId = useRef(1)
  useEffect(() => () => { active.current?.reject(); active.current = null }, [])
  function supply(label: string, apply: () => void): Promise<void> {
    return new Promise((resolve, reject) => {
      if (active.current) { reject(new Error('Another example action is waiting. Resolve it first.')); return }
      const pending: DemoRequest = {
        label,
        accept: () => { apply(); setReceipts(current => [`Example accepted: ${label}`, ...current].slice(0, 3)); active.current = null; setRequest(null); resolve() },
        reject: () => { active.current = null; setRequest(null); reject(new Error('Demo owner rejected this request. Try again.')) },
      }
      active.current = pending; setRequest(pending)
    })
  }
  return <div className="an-demo" data-demo-id="agent-notifications">
    <p className="an-demo__example">Local synthetic example · no messages are sent</p>
    <div className="an-demo__controls"><button type="button" disabled={Boolean(request)} onClick={() => { const id = nextId.current++; setItems(current => [{ id: `arrival-${id}`, at: `2026-10-06T10:${String(id % 60).padStart(2, '0')}:00Z`, title: `New example message ${id}`, body: 'A newly supplied notification ID triggers one arrival gesture. Its unread state belongs to the supplied item.', needs: 'Review this local example when ready.', read: false, react: null }, ...current]) }}>Add example notification</button><button type="button" disabled={Boolean(request)} onClick={() => setItems([])}>Empty stack</button><button type="button" disabled={Boolean(request)} onClick={() => setItems(exampleItems())}>Restore examples</button></div>
    <div className="an-demo__confirmation" aria-live="polite"><strong>{request ? 'Supply the callback result' : 'Example callback control'}</strong><p>{request ? request.label : 'Choose read, a reaction, or send a typed reply. Then accept or reject the pending action here.'}</p><div><button type="button" disabled={!request} onClick={() => active.current?.accept()}>Accept pending action</button><button type="button" disabled={!request} onClick={() => active.current?.reject()}>Reject pending action</button></div></div>
    <AgentNotificationStack agent={exampleOwner} notifications={items} paused={paused}
      onMark={(id, patch) => supply(`Save ${String(id)}`, () => setItems(current => current.map(item => item.id === id ? { ...item, ...patch } : item)))}
      onReply={(id, text) => supply(`Reply to ${String(id)}: ${text}`, () => {})} />
    {receipts.length > 0 && <div className="an-demo__receipts" aria-label="Local callback receipts"><strong>Local receipts</strong>{receipts.map((receipt, index) => <p key={index}>{receipt}</p>)}</div>}
  </div>
}
