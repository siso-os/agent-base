import { useEffect, useId, useRef, useState } from 'react'
import { Peek } from '@siso/shell'
import { WorkspaceMark } from '../../../../packages/halo-face/living-assets'
import type { SpendResponse } from './SpendPanel'
import { useMotionGate, type MotionBankDemoProps } from './motion-bank-shared'
import './TodaySpendDial.css'

export type TodaySpendProject = { id: string; name: string; claudeUsdEquivalent: number | null; codexCredits: readonly [number, number] | null }
export type TodaySpendSnapshot = { id: string; day: string; observedAt: string; state: 'current' | 'stale'; claudeUsdEquivalent: number | null; codexCredits: readonly [number, number] | null; projects: readonly TodaySpendProject[]; note?: string }
export type TodaySpendHeadline = { day: string; usd: number | null; observedAt: string | null }
export type TodaySpendDialProps = { headline?: TodaySpendHeadline; snapshot: TodaySpendSnapshot | null; open: boolean; onOpen: () => void; onClose: () => void; onOpenDashboard?: (projectId: string | null) => void; selectedProjectId?: string | null; onSelectProject?: (projectId: string | null) => void; paused?: boolean; example?: boolean }

/** Boundary adapter only: the owner supplies freshness and observation identity. Never reads the API. */
export function todaySpendSnapshotFromResponse(response: SpendResponse | null, observation: Pick<TodaySpendSnapshot, 'id' | 'observedAt' | 'state'>): TodaySpendSnapshot | null {
  if (response?.source !== 'stack-opt') return null
  const data = response.data
  return { ...observation, day: data.day, claudeUsdEquivalent: data.claude_usd_equiv, codexCredits: data.codex_credits, projects: data.projects.map(project => ({ id: project.project, name: project.project, claudeUsdEquivalent: project.claude_usd_equiv, codexCredits: project.codex_credits })), note: data.note }
}
const dollars = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' })
const number = new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 })
const validAmount = (value: number | null | undefined): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0
const money = (value: number | null | undefined) => validAmount(value) ? dollars.format(value) : 'Unknown'
const credits = (range: readonly [number, number] | null | undefined) => range && validAmount(range[0]) && validAmount(range[1]) && range[1] >= range[0] ? `${number.format(range[0])}–${number.format(range[1])} credits` : 'Unknown'
const colours = ['#72c4fa', '#c1a6ff', '#70d7bb', '#e7b875']
/** "02:19" today, "8 Oct 19:06" another day; anything unparseable stays as supplied. */
const readable = (at: string | null | undefined) => { const t = at ? Date.parse(at) : NaN; if (!Number.isFinite(t)) return at ?? ''; const d = new Date(t), today = new Date().toDateString() === d.toDateString(); return d.toLocaleString([], today ? { hour: '2-digit', minute: '2-digit' } : { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) }
const share = (value: number | null, total: number | null) => validAmount(value) && validAmount(total) && total > 0 ? `${number.format(value / total * 100)}% of Claude total` : 'Share unavailable'

export function TodaySpendIcon({ snapshot, size = 32 }: { snapshot: TodaySpendSnapshot | null; size?: 24 | 32 }) {
  const id = useId().replace(/:/g, '')
  const total = snapshot?.claudeUsdEquivalent
  const projects = snapshot?.projects ?? []
  const sum = projects.reduce((value, project) => value + (validAmount(project.claudeUsdEquivalent) ? project.claudeUsdEquivalent : 0), 0)
  const denominator = validAmount(total) ? total : 0
  const showShares = denominator > 0 && sum <= denominator + 0.001
  let offset = 0
  return <svg className="td-icon" width={size} height={size} viewBox="0 0 40 40" aria-hidden="true">
    <defs><linearGradient id={`${id}-metal`} x2="1" y2="1"><stop stopColor="#9aa8b9" /><stop offset=".45" stopColor="#293447" /><stop offset="1" stopColor="#68788d" /></linearGradient></defs>
    <circle cx="20" cy="20" r="18.5" fill="#101826" stroke={`url(#${id}-metal)`} />
    <circle cx="20" cy="20" r="14" fill="none" stroke="#2c394b" strokeWidth="3" />
    {showShares && projects.map((project, index) => {
      const length = (validAmount(project.claudeUsdEquivalent) ? project.claudeUsdEquivalent : 0) / denominator * 87.965
      const start = offset; offset += length
      return <circle key={project.id} cx="20" cy="20" r="14" fill="none" stroke={colours[index % colours.length]} strokeWidth="3" strokeDasharray={`${Math.max(0, length - 1.4)} ${87.965 - Math.max(0, length - 1.4)}`} strokeDashoffset={-start} transform="rotate(-90 20 20)" />
    })}
    <path d="M14 15h12v11H14zM14 18h12M17 13v4M23 13v4" fill="none" stroke="#d9e4ef" strokeWidth="1.4" strokeLinejoin="round" />
    <path d="M17 22h2M21 22h2" stroke="#72c4fa" strokeWidth="1.8" />
  </svg>
}

export function TodaySpendDial({ headline, snapshot, open, onOpen, onClose, onOpenDashboard, selectedProjectId = null, onSelectProject, paused = false, example = false }: TodaySpendDialProps) {
  const { ref, motion } = useMotionGate(paused)
  const previousSnapshot = useRef(snapshot?.id)
  const [highlightId, setHighlightId] = useState<string | null>(null)
  useEffect(() => {
    if (!motion) setHighlightId(null)
    if (snapshot?.id !== previousSnapshot.current) {
      setHighlightId(snapshot && motion ? snapshot.id : null)
      previousSnapshot.current = snapshot?.id
    }
  }, [snapshot, motion])
  const selected = snapshot?.projects.find(project => project.id === selectedProjectId)
  const invalidSelection = selectedProjectId !== null && !selected
  const value = invalidSelection ? null : selected ? selected.claudeUsdEquivalent : snapshot?.claudeUsdEquivalent
  const range = invalidSelection ? null : selected ? selected.codexCredits : snapshot?.codexCredits
  return <div ref={ref} className="td-root" data-motion={motion ? 'on' : 'off'} onAnimationEnd={event => { if (event.animationName === 'td-reading-highlight') setHighlightId(null) }}>
    <Peek title={`Today’s spend · ${headline?.day ?? snapshot?.day ?? 'date unavailable'}`} className="td-peek" open={open} onOpenChange={next => next ? onOpen() : onClose()} content={() => <div className="td-panel" data-motion={motion ? 'on' : 'off'}>
      <header className="td-header"><WorkspaceMark brand="agent-base" size={24} paused={!motion} /><div><h3>Today’s spend</h3><p>{example ? 'Synthetic example · ' : ''}{headline?.day ?? snapshot?.day ?? 'Date unavailable'}</p></div></header>
      {headline && <div className="td-totals" data-testid="spend-total"><div><span>Today · Tokens scan · Claude at API prices</span><strong>{money(headline.usd)}</strong><small>{headline.observedAt ? `Read ${readable(headline.observedAt)}` : 'Today’s Tokens total unavailable'}</small></div></div>}
      {headline && <p className="td-observed">STACK-OPT attribution · {snapshot ? `report day ${snapshot.day}` : 'report unavailable'} · separate from today’s Tokens total</p>}
      {!snapshot ? <p className="td-notice">Pending — no spend snapshot supplied. Amounts and project shares are unknown.</p> : <>
        <p className="td-observed">{snapshot.state === 'stale' ? 'Stale reading' : 'Supplied reading'} · {readable(snapshot.observedAt)}</p>
        {snapshot.state === 'stale' && <p className="td-notice">Last known snapshot. Current attribution is unverified.</p>}
        {onSelectProject && <label className="td-filter">Project<select value={selectedProjectId ?? ''} onChange={event => onSelectProject(event.target.value || null)}><option value="">All projects</option>{invalidSelection && <option value={selectedProjectId ?? ''}>Unavailable project</option>}{snapshot.projects.map(project => <option value={project.id} key={project.id}>{project.name}</option>)}</select></label>}
        <div key={highlightId ?? 'initial'} className={`td-totals${highlightId ? ' td-value-highlight' : ''}`}><div><span>{headline ? `Report ${snapshot.day} · Claude USD-equivalent` : 'Claude · USD-equivalent'}</span><strong>{money(value)}</strong><small>{invalidSelection ? 'Project unavailable' : selected?.name ?? 'Supplied fleet total'}</small></div><div><span>Codex · reported range</span><strong>{credits(range)}</strong><small>Credits kept separate</small></div></div>
        {!selected && !invalidSelection && validAmount(snapshot.claudeUsdEquivalent) && snapshot.claudeUsdEquivalent > 0 && <div className="td-share" data-testid="spend-share" aria-hidden="true">{snapshot.projects.map((project, index) => validAmount(project.claudeUsdEquivalent) && project.claudeUsdEquivalent > 0 ? <i key={project.id} title={`${project.name} ${money(project.claudeUsdEquivalent)}`} style={{ flexGrow: project.claudeUsdEquivalent, background: colours[index % colours.length] }} /> : null)}</div>}
        <div className="td-projects" aria-label="Supplied project breakdown">{(selected ? [selected] : invalidSelection ? [] : snapshot.projects).map((project, index) => <div className="td-project" key={project.id}><span className="td-dot" style={{ background: colours[index % colours.length] }} /><div><b>{project.name}</b><small>{share(project.claudeUsdEquivalent, snapshot.claudeUsdEquivalent)}</small></div><div className="td-project-values"><span>{money(project.claudeUsdEquivalent)}</span><small>{credits(project.codexCredits)}</small></div></div>)}</div>
        {snapshot.projects.length === 0 && <p className="td-notice">Project attribution not supplied.</p>}
        {snapshot.note && <p className="td-note">{snapshot.note}</p>}
      </>}
      {onOpenDashboard && <button type="button" className="td-dashboard" onClick={() => onOpenDashboard(selectedProjectId)}>Open spend dashboard <span aria-hidden="true">↗</span></button>}
    </div>}>
    <button className="td-trigger" type="button" aria-label="Today spend: open supplied snapshot">
      <TodaySpendIcon snapshot={headline ? null : snapshot} />
      {/* t-0570: "Today" and the number; no "Unknown" twice. A missing figure is a dash, explained in the pop-up. */}
      {/* t-0532 item 7 (Shaan, 8 Oct ~10:15: "today's spend could be smaller with just the price"): the price alone; the label,
          the title and the pop-up say what it is. */}
      <span className="td-trigger-copy">{!headline && <span><small>{snapshot?.state === 'stale' ? 'Stale' : snapshot ? 'Snapshot' : 'Pending'}</small></span>}<b key={highlightId} className={highlightId ? 'td-value td-value-highlight' : 'td-value'}>{headline ? headline.usd === null ? '—' : money(headline.usd) : snapshot ? money(value) : 'Pending'}</b></span>
      <span className="td-chevron" aria-hidden="true">{open ? '−' : '+'}</span>
    </button>
    </Peek>
  </div>
}

const exampleSnapshot = (updated: boolean, stale: boolean): TodaySpendSnapshot => ({ id: updated ? 'example-update-2' : stale ? 'example-stale' : 'example-current', day: '2026-10-06', observedAt: updated ? '10:42 +07' : '10:40 +07', state: stale ? 'stale' : 'current', claudeUsdEquivalent: updated ? 15 : 12, codexCredits: updated ? [96, 120] : [80, 100], projects: [{ id: 'agent-base', name: 'Agent Base', claudeUsdEquivalent: updated ? 9 : 6, codexCredits: updated ? [56, 70] : [40, 50] }, { id: 'halo', name: 'HALO', claudeUsdEquivalent: 4, codexCredits: [32, 40] }, { id: 'library', name: 'Great Library', claudeUsdEquivalent: 2, codexCredits: [8, 10] }], note: 'USD-equivalent is a supplied estimate. Codex range is reported credits; these units are never added.' })
export function TodaySpendDialDemo({ paused = false }: MotionBankDemoProps) {
  const [state, setState] = useState<'pending' | 'current' | 'updated' | 'stale'>('current')
  const [open, setOpen] = useState(true)
  const [project, setProject] = useState<string | null>(null)
  const [receipt, setReceipt] = useState('No dashboard request yet.')
  const snapshot = state === 'pending' ? null : exampleSnapshot(state === 'updated', state === 'stale')
  return <div className="td-demo" data-demo-id="today-spend"><div className="td-demo-controls"><label>Example state<select value={state} onChange={event => { setState(event.target.value as typeof state); setProject(null) }}><option value="pending">Pending</option><option value="current">Current</option><option value="updated">Updated</option><option value="stale">Stale</option></select></label><div className="td-icon-samples"><TodaySpendIcon snapshot={snapshot} size={24} /><span>24 px</span><TodaySpendIcon snapshot={snapshot} size={32} /><span>32 px</span></div></div><TodaySpendDial snapshot={snapshot} open={open} onOpen={() => setOpen(true)} onClose={() => setOpen(false)} paused={paused} example selectedProjectId={project} onSelectProject={setProject} onOpenDashboard={id => setReceipt(`Example dashboard request received: ${id ? snapshot?.projects.find(item => item.id === id)?.name ?? id : 'All projects'}.`)} /><p className="td-receipt" role="status">{receipt}</p></div>
}
