import { useEffect, useId, useRef, useState } from 'react'
import { Peek } from '@siso/shell'
import type { AppVersion } from '../lib/useVersion'
import { LivingIcon } from '../../../../packages/halo-face/living-assets'
import { useMotionGate } from './motion-bank-shared'
import type { MotionBankDemoProps } from './motion-bank-shared'
import './VersionPulse.css'
import { ConnectedVersionsLine } from './VersionsLine'

export type VersionPulseStatus = 'checking' | 'current' | 'available' | 'applying' | 'failed' | 'unknown'
export type VersionPulseRelease = { version: AppVersion; kind: 'web' | 'desktop'; changes: readonly string[]; title?: string }
export type VersionPulseProps = {
  current: AppVersion
  available?: VersionPulseRelease
  status: VersionPulseStatus
  open: boolean
  onOpenChange: (open: boolean) => void
  onRequestApply?: (release: VersionPulseRelease) => void
  onDismiss?: () => void
  error?: string
  paused?: boolean
}
const labels: Record<VersionPulseStatus, string> = {
  checking: 'Checking versions', current: 'Current version confirmed', available: 'Update available',
  applying: 'Update requested · awaiting confirmation', failed: 'Update failed', unknown: 'Update status unknown',
}

export function VersionPulse({ current, available, status, open, onOpenChange, onRequestApply, onDismiss, error, paused = false }: VersionPulseProps) {
  const { ref, motion } = useMotionGate(paused)
  const id = useId()
  const previousStatus = useRef(status)
  const [gleam, setGleam] = useState(false)
  useEffect(() => {
    if (status === 'available' && previousStatus.current !== 'available' && motion) setGleam(true)
    if (status !== 'available' || !motion) setGleam(false)
    previousStatus.current = status
  }, [status, motion])
  const actionable = status === 'available' && available?.kind === 'web' && !!onRequestApply
  const pending = status === 'checking' || status === 'applying'
  return <div ref={ref} className={`vp-root vp-root--${status}`} data-motion={motion ? 'on' : 'off'}>
    <Peek title="Version details" hoverOpens={false} open={open} onOpenChange={onOpenChange} content={() => <div className={`vp-panel vp-panel--${status}`} data-motion={motion ? 'on' : 'off'}>
      <div className="vp-panel-head"><div><span className="vp-kicker">AGENT BASE / RELEASES</span><h3 id={`${id}-title`}>Version details</h3></div></div>
      <div className="vp-status" role="status" aria-live="polite"><span className="vp-status-dot"/><strong>{labels[status]}</strong></div>
      <ConnectedVersionsLine applying={status === 'applying'} />
      <dl className="vp-layers">{(['web', 'node', 'desktop'] as const).map(layer => <div key={layer}><dt>{layer === 'web' ? 'Web interface' : layer === 'node' ? 'Node service' : 'Desktop shell'}</dt><dd>{current[layer] || 'Not supplied'}</dd></div>)}</dl>
      <div className="vp-revision"><span>Current revision</span><code>{current.sha || 'Not supplied'}</code></div>
      {available && <div className="vp-release"><div className="vp-release-title"><span>SUPPLIED RELEASE</span><strong>{available.kind === 'web' ? available.version.web : available.version.desktop}</strong></div><h4>{available.title || 'Changes to review'}</h4>{available.changes.length ? <ul>{available.changes.map((change, index) => <li key={`${index}-${change}`}>{change}</li>)}</ul> : <p>No release notes supplied.</p>}
        <div className="vp-method"><LivingIcon name="web" size={25} variant="glyph" paused={!motion} /><p>{available.kind === 'desktop' ? 'Desktop shell changes require a separate rebuild or installer. Updating from this header is unsupported.' : 'Applies by reloading the web interface. The owner handles preserving your workspace and confirming the loaded version.'}</p></div>
      </div>}
      {status === 'failed' && <p className="vp-error" role="alert">{error || 'The update could not be confirmed. Your current version is still shown above.'}</p>}
      {status === 'unknown' && <p className="vp-note">No confirmed update check has been supplied.</p>}
      {pending && <p className="vp-note">{status === 'checking' ? 'Waiting for a supplied check result.' : 'Current version stays unchanged until the owner confirms the loaded release.'}</p>}
      <div className="vp-actions">{available?.kind === 'web' && <button type="button" className="vp-apply" disabled={!actionable} onClick={() => { if (actionable && available) onRequestApply?.(available) }}>{status === 'applying' ? 'Awaiting confirmation' : 'Request web reload'}</button>}{onDismiss && <button type="button" className="vp-dismiss" onClick={onDismiss}>Dismiss notice</button>}</div>
    </div>}>
    <button type="button" className="vp-trigger" aria-label={`Versions: ${labels[status]}`}>
      <span className={`vp-plates${gleam ? ' vp-plates--gleam' : ''}`} onAnimationEnd={() => setGleam(false)} aria-hidden="true">
        <svg viewBox="0 0 40 40" width="34" height="34">
          <defs><linearGradient id={`${id}-steel`} x1="0" y1="0" x2="1" y2="1"><stop stopColor="#899ba9"/><stop offset=".45" stopColor="#253c4e"/><stop offset="1" stopColor="#10202d"/></linearGradient><linearGradient id={`${id}-glass`} x1="0" y1="0" x2="0" y2="1"><stop stopColor="#224969"/><stop offset="1" stopColor="#101e2d"/></linearGradient></defs>
          <path d="M6 19 20 12 34 19 34 25 20 32 6 25Z" fill={`url(#${id}-steel)`} stroke="#728797" strokeWidth=".7"/>
          <path d="M6 15 20 8 34 15 34 21 20 28 6 21Z" fill={`url(#${id}-steel)`} stroke="#8d9eaa" strokeWidth=".7"/>
          <path d="M6 13 20 6 34 13 20 20Z" fill={`url(#${id}-glass)`} stroke="#76b8e8" strokeWidth=".9"/>
          <path d="m12 13 8-4 8 4-8 4Z" fill="#1b3347" stroke="#5293bf" strokeWidth=".6"/>
          <path d="m17 13 2 2 4-4" fill="none" stroke="#d3e7f8" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
        <span className="vp-dot"/>
      </span>
      <span className="vp-trigger-copy"><span>Version</span><strong>{current.web}</strong></span>
      <span className="vp-chevron" aria-hidden="true">⌄</span>
    </button>
    </Peek>
  </div>
}

const demoCurrent: AppVersion = { web: '0.8.4', node: '0.8.2', desktop: '0.6.1', sha: '8bbbbe8' }
const demoRelease: VersionPulseRelease = { kind: 'web', version: { ...demoCurrent, web: '0.8.5', sha: 'c91a204' }, title: 'A calmer workspace', changes: ['Keep the selected chat after a web reload.', 'Show release details for each application layer.', 'Clarify pending and failed update requests.'] }
export function VersionPulseDemo({ paused = false }: MotionBankDemoProps) {
  const [current, setCurrent] = useState(demoCurrent)
  const [available, setAvailable] = useState<VersionPulseRelease | undefined>()
  const [status, setStatus] = useState<VersionPulseStatus>('unknown')
  const [open, setOpen] = useState(false)
  const [receipt, setReceipt] = useState('No request recorded.')
  const fixture = (next: VersionPulseStatus, release?: VersionPulseRelease) => { setStatus(next); setAvailable(release); setReceipt(`Supplied example: ${labels[next]}.`) }
  return <div className="vp-demo" data-demo-id="version-pulse"><div className="vp-demo-heading"><div><span className="vp-kicker">LOCAL SYNTHETIC EXAMPLE</span><h3>VersionPulse</h3></div><span className="vp-demo-caption">Header / release detail</span></div>
    <div className="vp-demo-controls" aria-label="Supply version example state">
      <button type="button" onClick={() => fixture('checking', available)}>Check example</button><button type="button" onClick={() => fixture('current')}>Confirm current</button><button type="button" onClick={() => fixture('available', demoRelease)}>Supply update</button><button type="button" onClick={() => fixture('failed', available)}>Supply failure</button><button type="button" onClick={() => { fixture('available', { ...demoRelease, kind: 'desktop', version: { ...current, desktop: '0.6.2' }, changes: ['Desktop shell packaging refresh.'] }); setOpen(true) }}>Desktop example</button><button type="button" onClick={() => setOpen(true)}>Review changes</button><button type="button" disabled={status !== 'applying' || available?.kind !== 'web'} onClick={() => { if (available) { setCurrent(available.version); setAvailable(undefined); setStatus('current'); setReceipt('Explicit example confirmation supplied: current record updated to 0.8.5.') } }}>Confirm applied</button>
    </div>
    <div className="vp-demo-header"><span className="vp-demo-app">Agent Base <small>Workspace</small></span><VersionPulse current={current} available={available} status={status} open={open} onOpenChange={setOpen} paused={paused} error="Example failure: the loaded web version was not confirmed." onRequestApply={release => { setStatus('applying'); setReceipt(`Callback recorded: request ${release.kind} update to ${release.version.web}. No reload performed.`) }} onDismiss={() => { setOpen(false); setReceipt('Dismiss callback recorded. Supplied version and status retained.') }}/></div>
    <p className="vp-demo-receipt" role="status">{receipt}</p>
  </div>
}
