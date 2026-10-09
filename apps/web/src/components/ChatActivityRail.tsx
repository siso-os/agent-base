import { useEffect, useId, useRef, useState } from 'react'
import { AgentFace, type AgentFaceProps } from '../../../../packages/halo-face/living-assets'
import { useMotionGate, type MotionBankDemoProps } from './motion-bank-shared'
import { progress, label } from '../lib/compact-progress'
import './ChatActivityRail.css'

export type ChatActivityKind = 'thinking' | 'command' | 'compacting' | 'delegating'
export type ChatActivityStatus = 'idle' | 'running' | 'succeeded' | 'failed'
export type ChatActivityIdentity = Pick<AgentFaceProps, 'name' | 'family' | 'project' | 'hue' | 'secondHue' | 'features'>
export type ChatActivityCheckpointCounts = { before?: number; after?: number; unit?: string }
export type ChatActivityDelegation = 'assignment-pending' | 'child-started' | 'result-returned'
export type ChatActivityRailProps = {
  kind: ChatActivityKind
  status: ChatActivityStatus
  summary: string
  duration?: string
  command?: string
  output?: string
  result?: string
  exitCode?: number
  checkpointCounts?: ChatActivityCheckpointCounts
  owner?: ChatActivityIdentity
  worker?: ChatActivityIdentity
  delegation?: ChatActivityDelegation
  details?: string
  expanded?: boolean
  onExpandedChange?: (expanded: boolean) => void
  onInspectWorker?: (worker: ChatActivityIdentity) => void
  /** Supplied event revision; replays presentation, never advances activity. */
  replay?: number
  paused?: boolean
  className?: string
  /** For compacting: timestamp when compaction started (ms) */
  startedAt?: number
  /** For compacting: typical (p50) duration in ms (default 78000) */
  typicalMs?: number
  /** For compacting: long threshold (p90) duration in ms (default 136000) */
  longMs?: number
}
const KINDS: ChatActivityKind[] = ['thinking', 'command', 'compacting', 'delegating']
const LABELS: Record<ChatActivityKind, string> = { thinking: 'Thinking', command: 'Command', compacting: 'Compacting', delegating: 'Delegating' }
const STATES: Record<ChatActivityStatus, string> = { idle: 'Idle', running: 'Running', succeeded: 'Complete', failed: 'Failed' }
const DELEGATION: Record<ChatActivityDelegation, string> = { 'assignment-pending': 'Assignment pending', 'child-started': 'Child started', 'result-returned': 'Result returned' }

function ActivityGlyph({ kind, uid }: { kind: ChatActivityKind; uid: string }) {
  return <svg className="ca-glyph" viewBox="0 0 64 48" aria-hidden="true">
    <defs><linearGradient id={uid} x1="0" y1="0" x2="1" y2="1"><stop stopColor="#e4eaf1"/><stop offset=".32" stopColor="#657485"/><stop offset=".6" stopColor="#253345"/><stop offset="1" stopColor="#a4b4c6"/></linearGradient></defs>
    {kind === 'thinking' && <g className="ca-facets" fill={`url(#${uid})`} stroke="var(--ca-ink)" strokeWidth=".7"><path className="ca-facet ca-facet-a" d="m32 7 11 10-11 7-11-7Z"/><path className="ca-facet ca-facet-b" d="m20 19 10 7-5 15-12-11Z"/><path className="ca-facet ca-facet-c" d="m44 19 7 11-12 11-5-15Z"/><path d="m32 25 4 6-4 6-4-6Z" fill="var(--ca-ink)"/></g>}
    {kind === 'command' && <g><rect x="6" y="7" width="52" height="34" rx="6" fill={`url(#${uid})`}/><rect x="8" y="9" width="48" height="30" rx="4" fill="#09121e" stroke="var(--ca-ink)" strokeWidth=".6"/><path d="m17 18 7 6-7 6" fill="none" stroke="#c4d6e9" strokeWidth="2"/><path className="ca-cursor" d="M30 30h11" stroke="var(--ca-ink)" strokeWidth="2"/></g>}
    {kind === 'compacting' && <g fill={`url(#${uid})`} stroke="#93a6bb" strokeWidth=".5"><rect className="ca-page ca-page-a" x="9" y="7" width="28" height="31" rx="3"/><rect className="ca-page ca-page-b" x="17" y="10" width="28" height="31" rx="3"/><rect x="25" y="13" width="28" height="31" rx="3"/><rect x="28" y="16" width="22" height="25" rx="2" fill="#111d2b" stroke="var(--ca-ink)"/><path d="M32 22h14M32 27h14M32 32h9" fill="none" stroke="var(--ca-ink)"/></g>}
    {kind === 'delegating' && <g><path d="M13 24h38" stroke="#66788d" strokeWidth="2"/><path d="m45 20 6 4-6 4" fill="none" stroke="var(--ca-ink)"/><circle cx="10" cy="24" r="6" fill={`url(#${uid})`} stroke="var(--ca-ink)"/><circle cx="54" cy="24" r="6" fill={`url(#${uid})`} stroke="var(--ca-ink)"/><rect className="ca-packet" x="15" y="21" width="7" height="6" rx="1" fill="var(--ca-ink)"/></g>}
  </svg>
}

/** Compact controlled disclosure. Status, outputs and delegation receipts belong to the caller. */
export function ChatActivityRail({ kind, status, summary, duration, command, output, result, exitCode, checkpointCounts, owner, worker, delegation, details, expanded = false, onExpandedChange, onInspectWorker, replay = 0, paused = false, className = '', startedAt, typicalMs, longMs }: ChatActivityRailProps) {
  const { ref, motion } = useMotionGate(paused || status === 'failed')
  const uid = 'ca-' + useId().replace(/[^a-zA-Z0-9_-]/g, '')
  const disclosure = useRef<HTMLButtonElement>(null)
  const hasDetails = details !== undefined || output !== undefined || result !== undefined || exitCode !== undefined || command !== undefined
  const safeCount = (n?: number) => n !== undefined && Number.isFinite(n) && n >= 0 ? n : undefined
  const before = safeCount(checkpointCounts?.before), after = safeCount(checkpointCounts?.after)

  // Compacting progress: tick once per second while running, step every 5s if reduced motion
  const [now, setNow] = useState(() => Date.now())
  const isCompactingLive = kind === 'compacting' && status === 'running' && startedAt !== undefined

  useEffect(() => {
    if (!isCompactingLive || paused) return

    // Update immediately, then on interval
    setNow(Date.now())

    // For reduced motion, step every 5s; otherwise every 1s
    const interval = motion ? 1000 : 5000
    const timer = setInterval(() => setNow(Date.now()), interval)
    return () => clearInterval(timer)
  }, [isCompactingLive, motion, paused])

  const elapsedMs = isCompactingLive ? now - startedAt : 0
  const fillFraction = kind === 'compacting' ? progress(elapsedMs, typicalMs) : 0
  const progressLabel = kind === 'compacting' && startedAt !== undefined ? label(elapsedMs, typicalMs, longMs) : ''
  const isLong = kind === 'compacting' && longMs !== undefined && elapsedMs >= longMs

  // For compacting: show progress label while running, summary while done
  const displaySummary = kind === 'compacting' && status === 'running' && progressLabel ? progressLabel : summary

  return <div ref={ref} className={`ca-rail ca-${kind} ca-${status} ${className}`} data-motion={motion && status !== 'failed'} data-status={status} data-delegation={delegation} data-long={isLong ? 'true' : undefined}>
    <div className="ca-head">
      <span key={`${kind}-${status}-${replay}`} className="ca-object"><ActivityGlyph kind={kind} uid={uid + '-metal'}/></span>
      <div className="ca-copy"><div className="ca-labelrow"><strong className="ca-kind">{LABELS[kind]}</strong><span className="ca-status">{STATES[status]}</span>{duration && <span className="ca-duration">{duration}</span>}</div><div className="ca-summary">{displaySummary}</div></div>
      {hasDetails && onExpandedChange && <button ref={disclosure} className="ca-disclose" type="button" aria-expanded={expanded} aria-controls={uid + '-details'} onClick={() => onExpandedChange(!expanded)} aria-label={`${expanded ? 'Collapse' : 'Expand'} ${LABELS[kind].toLowerCase()} details`}><span aria-hidden="true">{expanded ? '−' : '+'}</span></button>}
    </div>
    {kind === 'compacting' && startedAt !== undefined && (status === 'running' || status === 'failed') && <div className="ca-progress" style={{ '--ca-fill': Math.min(1, fillFraction) } as React.CSSProperties}><div className="ca-progress-bar"/></div>}
    {kind === 'command' && command && <div className="ca-command"><span className="ca-prompt" aria-hidden="true">›</span><code>{command}</code></div>}
    {kind === 'compacting' && (before !== undefined || after !== undefined) && <div className="ca-meta">{before !== undefined && <span>Before: {before} {checkpointCounts?.unit ?? 'messages'}</span>}{after !== undefined && <span>After: {after} {checkpointCounts?.unit ?? 'messages'}</span>}</div>}
    {kind === 'delegating' && <div className="ca-route">{owner && <span className="ca-person"><AgentFace {...owner} size={19} status="waiting" paused={!motion}/><span>{owner.name ?? 'Owner'}</span></span>}<span className="ca-route-arrow" aria-hidden="true">→</span>{worker && <span className="ca-person"><AgentFace {...worker} size={19} status="waiting" paused={!motion}/>{onInspectWorker ? <button className="ca-worker" type="button" onClick={() => onInspectWorker(worker)}>{worker.name ?? 'Worker'}</button> : <span>{worker.name ?? 'Worker'}</span>}</span>}<span className="ca-delegation">{delegation ? DELEGATION[delegation] : 'No assignment receipt supplied'}</span></div>}
    {hasDetails && expanded && <div id={uid + '-details'} className="ca-details" onKeyDown={event => { if (event.key === 'Escape' && onExpandedChange) { event.preventDefault(); onExpandedChange(false); disclosure.current?.focus() } }}>
      {details !== undefined && <p className="ca-detail-text">{details}</p>}
      {output !== undefined && <><span className="ca-detail-label">Supplied output</span><pre className="ca-output">{output || '(empty output)'}</pre></>}
      {exitCode !== undefined && <div className="ca-result">Exit code: {exitCode}</div>}{result !== undefined && <div className="ca-result">Result: {result}</div>}
    </div>}
  </div>
}

export function ChatActivityRailDemo({ paused = false }: MotionBankDemoProps) {
  const [kind, setKind] = useState<ChatActivityKind>('thinking')
  const [status, setStatus] = useState<ChatActivityStatus>('running')
  const [expanded, setExpanded] = useState(false)
  const [replay, setReplay] = useState(0)
  const [receipt, setReceipt] = useState('Example fixture: Thinking · Running')
  const [delegation, setDelegation] = useState<ChatActivityDelegation>('assignment-pending')
  const changeStatus = (next: ChatActivityStatus) => { setStatus(next); setReplay(n => n + 1); setReceipt(`Example state supplied: ${STATES[next]}`) }
  const summaries: Record<ChatActivityKind, string> = { thinking: 'Reviewing the supplied activity', command: 'Check the local example source', compacting: 'Retain the handoff and decisions', delegating: 'Assign the review to Sol' }
  return <div className="ca-demo" data-demo-id="chat-activity">
    <div className="ca-demo-top"><span className="ca-example">Local synthetic example</span><span className="ca-demo-title">Inside the chat</span></div>
    <div className="ca-controls" role="group" aria-label="Example activity variant">{KINDS.map(value => <button type="button" key={value} aria-pressed={kind === value} onClick={() => { setKind(value); setExpanded(false); setReplay(n => n + 1); setReceipt(`Example variant supplied: ${LABELS[value]}`) }}>{LABELS[value]}</button>)}</div>
    <ChatActivityRail kind={kind} status={status} summary={summaries[kind]} paused={paused} replay={replay} expanded={expanded} onExpandedChange={value => { setExpanded(value); setReceipt(`Example disclosure: ${value ? 'expanded' : 'collapsed'}`) }}
      command={kind === 'command' ? 'git diff --check -- example.tsx' : undefined}
      output={kind === 'command' && (status === 'succeeded' || status === 'failed') ? status === 'failed' ? 'example.tsx:18: trailing whitespace.\nExample check failed.' : 'Example check supplied: no whitespace errors.' : undefined}
      exitCode={kind === 'command' && (status === 'succeeded' || status === 'failed') ? status === 'succeeded' ? 0 : 2 : undefined}
      result={status === 'succeeded' ? 'Example completion receipt supplied by the demo control.' : status === 'failed' ? 'Example failure receipt supplied by the demo control.' : undefined}
      details={kind === 'thinking' ? 'Example activity label only; no private thought text is supplied.' : kind === 'compacting' ? 'Example retained summary: keep the selected component, motion policy and pending integration check.' : kind === 'delegating' ? 'Example assignment: Sol reviews the supplied component. Child started and result returned are separate supplied receipts.' : undefined}
      checkpointCounts={kind === 'compacting' ? { before: 24, after: status === 'succeeded' ? 8 : undefined, unit: 'messages' } : undefined}
      owner={{ name: 'Astra', family: 'codex' }} worker={{ name: 'Sol', family: 'codex' }} delegation={delegation} onInspectWorker={worker => setReceipt(`Example callback: inspect ${worker.name}`)}/>
    <div className="ca-controls" role="group" aria-label="Supply example status">{(['idle', 'running', 'succeeded', 'failed'] as ChatActivityStatus[]).map(value => <button type="button" key={value} aria-pressed={status === value} onClick={() => changeStatus(value)}>{STATES[value]}</button>)}<button type="button" disabled={paused || status !== 'running'} onClick={() => { setReplay(n => n + 1); setReceipt('Example gesture replay requested; supplied status unchanged') }}>Replay gesture</button></div>
    {kind === 'delegating' && <label className="ca-select-label">Example delegation receipt<select value={delegation} onChange={event => { const value = event.target.value as ChatActivityDelegation; setDelegation(value); setReplay(n => n + 1); setReceipt(`Example receipt supplied: ${DELEGATION[value]}`) }}>{(Object.keys(DELEGATION) as ChatActivityDelegation[]).map(value => <option key={value} value={value}>{DELEGATION[value]}</option>)}</select></label>}
    <p className="ca-receipt" role="status">{receipt}</p>
  </div>
}
