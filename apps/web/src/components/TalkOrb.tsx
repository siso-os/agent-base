import { useId, useState, type CSSProperties, type ButtonHTMLAttributes } from 'react'
import { LivingIcon } from '../../../../packages/halo-face/living-assets'
import { useMotionGate, type MotionBankDemoProps } from './motion-bank-shared'
import './TalkOrb.css'

export type TalkOrbPhase = 'idle' | 'starting' | 'listening' | 'writing' | 'ready' | 'error'
export type TalkOrbSize = 'small' | 'compact' | 'hero'
export type TalkOrbProps = {
  phase: TalkOrbPhase
  /** Supplied normalized input level; this component never measures audio. */
  level?: number
  transcript?: string
  error?: string
  size?: TalkOrbSize
  label?: string
  paused?: boolean
  disabled?: boolean
  showDetails?: boolean
  className?: string
  /** Existing microphone controllers can retain their pointer/keyboard gestures on this button. */
  buttonProps?: Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children' | 'type' | 'disabled'> & { 'data-testid'?: string }
  onStart?: () => void
  onStop?: () => void
  onCancel?: () => void
  onAccept?: (transcript: string) => void
  onRetry?: () => void
}
const STATUS: Record<TalkOrbPhase, string> = { idle: 'Ready to talk', starting: 'Opening microphone', listening: 'Listening', writing: 'Writing transcript', ready: 'Review transcript', error: 'Voice needs attention' }
const SIZES: Record<TalkOrbSize, number> = { small: 32, compact: 40, hero: 104 }

export function TalkOrb({ phase, level, transcript, error, size = 'compact', label = 'Voice microphone', paused = false, disabled = false, showDetails = true, className = '', buttonProps, onStart, onStop, onCancel, onAccept, onRetry }: TalkOrbProps) {
  const { ref, motion } = useMotionGate<HTMLDivElement>(paused)
  const uid = 'to-' + useId().replace(/[^a-zA-Z0-9_-]/g, '')
  const amount = phase === 'listening' && typeof level === 'number' && Number.isFinite(level) ? Math.max(0, Math.min(1, level)) : 0
  const action = phase === 'idle' ? onStart : phase === 'listening' ? onStop : phase === 'error' ? onRetry : undefined
  const actionLabel = phase === 'idle' ? 'Start' : phase === 'listening' ? 'Stop and transcribe' : phase === 'error' ? 'Retry' : STATUS[phase]
  const canCancel = phase !== 'idle'
  const url = (name: string) => `url(#${uid}-${name})`
  return <div ref={ref} className={`to-root ${className}`} data-phase={phase} data-motion={motion && phase !== 'error'} data-size={size} style={{ '--to-size': `${SIZES[size]}px`, '--to-level': level === undefined ? undefined : amount } as CSSProperties} onKeyDown={event => {
    if (event.key === 'Escape' && canCancel && onCancel && !disabled) { event.stopPropagation(); event.preventDefault(); onCancel() }
  }}>
    <button type="button" aria-label={`${actionLabel} · ${label}`} aria-pressed={phase === 'listening'} aria-describedby={showDetails ? uid + '-status' : undefined} onClick={action} {...buttonProps} className={`to-orb ${buttonProps?.className ?? ''}`} disabled={disabled || !(buttonProps?.onClick || action)}>
      <svg className="to-sphere" viewBox="0 0 112 112" aria-hidden="true">
        <defs>
          <linearGradient id={uid + '-metal'} x1="0" y1="0" x2="1" y2="1"><stop stopColor="#e7e1f7"/><stop offset=".24" stopColor="#81748c"/><stop offset=".5" stopColor="#231b30"/><stop offset=".78" stopColor="#9885ad"/><stop offset="1" stopColor="#292035"/></linearGradient>
          <radialGradient id={uid + '-glass'} cx=".32" cy=".23" r=".85"><stop stopColor="#e7d6ff"/><stop offset=".14" stopColor="#a78bfa"/><stop offset=".4" stopColor="#7543bc"/><stop offset=".72" stopColor="#391762"/><stop offset="1" stopColor="#100d22"/></radialGradient>
          <linearGradient id={uid + '-rim'} x1="0" y1="0" x2="1" y2="1"><stop stopColor="#dfccff"/><stop offset=".5" stopColor="#a78bfa"/><stop offset="1" stopColor="#f472b6"/></linearGradient>
        </defs>
        <circle cx="56" cy="56" r="53" fill={url('metal')} stroke="#14101e"/>
        <circle cx="56" cy="56" r="49.5" fill="#080812" stroke="#b8a3d3" strokeOpacity=".35"/>
        <circle cx="56" cy="56" r="47" fill={url('glass')}/>
        <circle className="to-level-light" cx="56" cy="56" r="43" fill="#c891ff" opacity={.035 + amount * .19}/>
        <circle className="to-rim" cx="56" cy="56" r="50" fill="none" stroke={phase === 'error' ? '#ed8f9d' : url('rim')} strokeWidth="1.4" opacity={phase === 'idle' ? .38 : .65 + amount * .35}/>
        <path d="M22 43Q26 18 53 17Q74 16 89 34Q55 21 22 43Z" fill="#fff" opacity=".19"/>
        <path d="M27 86Q55 103 82 84" fill="none" stroke="#ef83cf" strokeOpacity=".45" strokeWidth="1"/>
        <ellipse cx="37" cy="29" rx="12" ry="3.3" transform="rotate(-30 37 29)" fill="#fff" opacity=".38"/>
        <g key={phase} className="to-glyph" stroke="#f4eaff" strokeWidth="3" strokeLinecap="round" fill="none">
          {phase === 'listening' ? [0.38, 0.75, 1, 0.75, 0.38].map((weight, i) => { return <path key={i} className="to-level-bar" style={{ '--to-weight': weight } as CSSProperties} d={`M${40 + i * 8} 38v36`} /> }) : phase === 'ready' ? <path d="M41 56l10 10 21-23"/> : phase === 'error' ? <><path d="M56 40v20"/><circle cx="56" cy="70" r="1.7" fill="#f4eaff" stroke="none"/></> : phase === 'writing' ? <><path d="M41 46h30M41 56h23M41 66h16"/><path className="to-write" d="M74 56v13" stroke="#f4a7d9"/></> : <><rect x="48" y="34" width="16" height="31" rx="8"/><path d="M41 55v4a15 15 0 0 0 30 0v-4M56 74v8M49 82h14"/></>}
        </g>
        {/* The state ring (9 Oct): one circle whose dash, colour and turn say the state (TalkOrb.css). An arc that turns
            slowly while the mic opens, a full ring that follows his level while it listens, a short arc that turns faster
            while it writes, a full ring as the words land, a still red ring on a problem; nothing while idle. */}
        <circle className="to-orbit" cx="56" cy="56" r="51" pathLength={100} fill="none" stroke="#f3b6e6" strokeWidth="2" strokeLinecap="round"/>
      </svg>
    </button>
    {showDetails && <div className="to-details">
      <span id={uid + '-status'} className="to-status" role="status">{STATUS[phase]}</span>
      {phase === 'listening' && <span className="to-level">Supplied input level {Math.round(amount * 100)}%</span>}
      {phase === 'error' && <p className="to-error" role="alert">{error || 'Voice could not continue. Retry or cancel.'}</p>}
      {phase === 'ready' && <div className="to-review"><span className="to-caption">Transcript for review</span><p className="to-transcript">{transcript?.trim() ? transcript : 'No transcript supplied.'}</p><button className="to-action to-accept" type="button" disabled={disabled || !transcript?.trim() || !onAccept} onClick={() => transcript && onAccept?.(transcript)}>Accept transcript</button></div>}
      {canCancel && <button className="to-action" type="button" disabled={disabled || !onCancel} onClick={onCancel}>Cancel</button>}
    </div>}
  </div>
}

export function TalkOrbDemo({ paused = false }: MotionBankDemoProps) {
  const { ref, motion } = useMotionGate<HTMLDivElement>(paused)
  const [phase, setPhase] = useState<TalkOrbPhase>('idle')
  const [level, setLevel] = useState(.48)
  const [transcript, setTranscript] = useState('Show the changed components in the review gallery.')
  const [receipt, setReceipt] = useState('No example callback received.')
  const demoId = useId()
  const request = (next: TalkOrbPhase, message: string) => { setPhase(next); setReceipt(message) }
  return <div ref={ref} className="to-demo" data-demo-id="talk-orb" data-motion={motion}>
    <div className="to-demo-heading"><LivingIcon name="siso-voice" size={28} variant="glyph" paused={!motion}/><div><strong>Talk orb</strong><span>Local synthetic voice example</span></div></div>
    <div className="to-hero-stage"><TalkOrb phase={phase} level={level} transcript={transcript} error="Example transcription failed. The take remains reviewable." size="hero" paused={!motion} onStart={() => request('starting', 'Example start callback received. Supply Listening to continue.')} onStop={() => request('writing', 'Example stop callback received. Supply Ready or Error to continue.')} onCancel={() => request('idle', 'Example cancel callback received.')} onRetry={() => request('starting', 'Example retry callback received. Supply the next phase.')} onAccept={text => setReceipt(`Example acceptance callback received: “${text}”`)}/></div>
    <div className="to-composer"><span>Example composer</span><TalkOrb phase={phase} level={level} size="small" showDetails={false} paused label="Quiet composer microphone" disabled/><TalkOrb phase={phase} level={level} size="compact" showDetails={false} paused label="Quiet compact microphone" disabled/></div>
    <div className="to-controls"><label htmlFor={demoId + '-phase'}>Supplied phase<select id={demoId + '-phase'} value={phase} onChange={event => { setPhase(event.target.value as TalkOrbPhase); setReceipt('Example phase supplied manually.') }}>{Object.entries(STATUS).map(([value, name]) => <option key={value} value={value}>{value} · {name}</option>)}</select></label><label htmlFor={demoId + '-level'}>Example input level · {Math.round(level * 100)}%<input id={demoId + '-level'} type="range" min="0" max="1" step=".01" value={level} onChange={event => setLevel(Number(event.target.value))}/></label><label htmlFor={demoId + '-text'}>Example supplied transcript<textarea id={demoId + '-text'} rows={2} value={transcript} onChange={event => { setTranscript(event.target.value); setReceipt('Example transcript edited; acceptance pending.') }}/></label></div>
    <p className="to-receipt" role="status">{receipt}</p>
  </div>
}
