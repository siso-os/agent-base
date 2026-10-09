import { useEffect, useId, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { AgentFace } from '../../../packages/halo-face/AgentFace'
import { WorkspaceMark, type WorkspaceBrand } from '../../../packages/halo-face/WorkspaceMark'
import './motion-workbench.css'

const groups: { name: string; brand: WorkspaceBrand; color: string; tasks: string[] }[] = [
  { name: 'HALO', brand: 'halo', color: '#bca5ff', tasks: ['Review the welcome screen', 'Check the mobile layout'] },
  { name: 'Agent Base', brand: 'agent-base', color: '#75b5ff', tasks: ['Polish the model picker', 'Review the task rail'] },
  { name: 'SISO Agency', brand: 'siso-agency', color: '#ecad76', tasks: ['Review the brand marks'] },
]
const format = (n: number) => n.toLocaleString('en-US')
function Proposal({ number, title, priority, reason, children, className = '' }: { number: string; title: string; priority: string; reason: string; children: ReactNode; className?: string }) {
  return <article className={'mw-proposal ' + className}><header className="mw-proposal-head"><span className="mw-index">{number}</span><h3>{title}</h3><span className="mw-priority">{priority}</span></header>{children}<p className="mw-reason">{reason}</p></article>
}

/** Review-only controls. Every count is derived from local synthetic data. */
export function MotionWorkbench({ paused }: { paused: boolean }) {
  const uid = 'mw-' + useId().replace(/:/g, '')
  const [reduced, setReduced] = useState(true)
  const [hidden, setHidden] = useState(false)
  const [visible, setVisible] = useState(false)
  const host = useRef<HTMLElement>(null)
  useEffect(() => {
    const media = matchMedia('(prefers-reduced-motion: reduce)')
    const sync = () => { setReduced(media.matches); setHidden(document.hidden) }
    sync(); media.addEventListener('change', sync); document.addEventListener('visibilitychange', sync)
    const observer = new IntersectionObserver(entries => setVisible(entries[0]?.isIntersecting ?? false))
    if (host.current) observer.observe(host.current)
    return () => { observer.disconnect(); media.removeEventListener('change', sync); document.removeEventListener('visibilitychange', sync) }
  }, [])
  const still = paused || reduced || hidden || !visible
  const [used, setUsed] = useState(64000)
  const [painted, setPainted] = useState(64000)
  const current = useRef(64000)
  useEffect(() => {
    if (still) { current.current = used; setPainted(used); return }
    const from = current.current, start = performance.now()
    let frame = 0
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / 650)
      const value = Math.round(from + (used - from) * (1 - Math.pow(1 - t, 3)))
      current.current = value; setPainted(value)
      if (t < 1) frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [used, still])
  const [model, setModel] = useState('Astra')
  const [modelRevision, setModelRevision] = useState(0)
  const [draft, setDraft] = useState('Review the Agent Base task panel')
  const [queue, setQueue] = useState<string[]>([])
  const [ownerOpen, setOwnerOpen] = useState(true)
  const [selectedOwner, setSelectedOwner] = useState<WorkspaceBrand>('agent-base')
  const [opened, setOpened] = useState<string[]>(['Agent Base'])
  const [done, setDone] = useState<string[]>([])
  const submit = () => { const text = draft.trim(); if (!text) return; setQueue(q => [...q, text]); setDraft('') }
  const selected = groups.find(g => g.brand === selectedOwner)!
  const total = groups.reduce((n, g) => n + g.tasks.length, 0)
  return <section id="motion-lab" className="mw" ref={host} data-still={still}>
    <header className="mw-heading"><div><span className="mw-eyebrow">THE APP, WITH INTENT</span><h2>Movement that means something.</h2><p>Five small refinements. Try each one; everything comes back to rest.</p></div><span className="mw-preview-label">Synthetic preview · local only</span></header>
    <div className="mw-grid">
      <Proposal number="01" title="Context, made legible" priority="Ship second" reason="650 ms · A single measured transition makes a new context reading easy to follow. In the app, animate only when a fresh reading arrives.">
        <div className="mw-surface mw-context"><div className="mw-donut" role="img" aria-label={`${used / 2000}% context used: ${format(used)} of 200,000 preview tokens`}>
          <svg viewBox="0 0 160 160" aria-hidden="true"><defs><linearGradient id={uid + '-ring'} x1="0" y1="0" x2="1" y2="1"><stop stopColor="#a2e5ff"/><stop offset=".52" stopColor="#679ffd"/><stop offset="1" stopColor="#b8a0ec"/></linearGradient></defs><circle cx="80" cy="80" r="66" className="mw-ring-rim"/><circle cx="80" cy="80" r="58" className="mw-ring-track"/><circle cx="80" cy="80" r="58" pathLength="100" className="mw-ring-value" stroke={`url(#${uid}-ring)`} strokeDasharray={`${painted / 2000} 100`} transform="rotate(-90 80 80)"/></svg>
          <div aria-hidden="true"><strong>{(painted / 2000).toFixed(1)}<small>%</small></strong><span>context used</span></div></div>
          <div className="mw-context-info"><span className="mw-kicker">PREVIEW CAPACITY</span><strong>200,000 tokens</strong><p><b>{format(used)}</b> used<br/><b>{format(200000 - used)}</b> remaining</p><span className="mw-muted">Controlled reading, no live feed</span></div>
          <fieldset className="mw-presets"><legend>Try a context reading</legend>{[64000, 136000, 184000].map(n => <button key={n} type="button" aria-pressed={used === n} onClick={() => setUsed(n)}>{n / 2000}%</button>)}</fieldset>
        </div>
      </Proposal>
      <Proposal number="02" title="A confident model change" priority="Ship first" reason="220 ms · The identity and confirmation change together. Keep native keyboard selection; a brief arrival replaces a noisy celebration.">
        <div className="mw-surface mw-model"><div className="mw-model-label"><span className="mw-kicker">AGENT ZERO</span><span>Model for your next task</span></div><div className="mw-model-control"><AgentFace name={model} family="codex" hue={model === 'Astra' ? 44 : model === 'Sol' ? 211 : 266} secondHue={model === 'Astra' ? 315 : 180} size={64} status="waiting" paused track={false}/><label className="mw-select-label" htmlFor={uid + '-model'}>Preview model<select id={uid + '-model'} value={model} onChange={e => { setModel(e.target.value); setModelRevision(v => v + 1) }}><option>Astra</option><option>Sol</option><option>Luna</option></select></label></div><div className="mw-confirm" key={modelRevision} role="status"><span className="mw-check">✓</span><span>{modelRevision ? `${model} selected for this preview` : 'Astra selected for this preview'}<small>No running task or real model changes.</small></span></div></div>
      </Proposal>
      <Proposal number="03" title="A task feels received" priority="Ship first" reason="180–280 ms · Focus reveals one rim of light. A local receipt confirms the exact task; in production, show this acknowledgement only after acceptance." className="mw-composer-proposal">
        <form className="mw-surface mw-composer" onSubmit={e => { e.preventDefault(); submit() }}><label htmlFor={uid + '-draft'}>Give Agent Zero a task</label><div className="mw-input-wrap"><textarea id={uid + '-draft'} rows={3} value={draft} maxLength={1000} placeholder="What should we work on?" onChange={e => setDraft(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && !e.nativeEvent.isComposing) { e.preventDefault(); submit() } }}/><div className="mw-input-footer"><span>{model} <i>·</i> Local preview</span><button type="submit" disabled={!draft.trim()}>Queue preview <span aria-hidden="true">↑</span></button></div></div><div className="mw-receipt" role="status">{queue.length ? <div key={queue.length} className="mw-receipt-entry"><span className="mw-check">✓</span><span><strong>{queue.length} {queue.length === 1 ? 'task' : 'tasks'} queued locally</strong><small>{queue[queue.length - 1]}</small></span></div> : <span className="mw-muted">⌘ / Ctrl + Enter to queue · nothing is sent</span>}</div></form>
      </Proposal>
      <Proposal number="04" title="An owner, then their world" priority="Ship second" reason="240 ms · The tree opens from its owner. Selecting a workspace moves the emphasis, preserving Zero above HALO, Agent Base and SISO Agency.">
        <div className="mw-surface mw-owner"><button type="button" className="mw-owner-title" aria-expanded={ownerOpen} aria-controls={uid + '-owners'} onClick={() => setOwnerOpen(v => !v)}><AgentFace name="Agent Zero" family="claude" hue={177} secondHue={217} size={52} status="waiting" paused track={false} features={{ top: 0, eyes: 0, head: 0 }}/><strong>Agent Zero</strong><span className="mw-chevron" data-open={ownerOpen}>›</span></button><div className="mw-fold" data-open={ownerOpen} id={uid + '-owners'} inert={!ownerOpen}><div className="mw-fold-inner"><div className="mw-owner-tree">{groups.map(g => <button type="button" key={g.brand} className="mw-owner-row" style={{ '--mw-accent': g.color } as CSSProperties} aria-pressed={selectedOwner === g.brand} onClick={() => setSelectedOwner(g.brand)}><WorkspaceMark brand={g.brand} size={38} paused={still} replay={selectedOwner === g.brand ? 1 : 0}/><strong>{g.name}</strong><span>{selectedOwner === g.brand ? 'Selected' : 'View'} <b aria-hidden="true">›</b></span></button>)}</div></div></div><div className="mw-owner-detail" role="status"><span className="mw-kicker">WORKSPACE PREVIEW</span><p key={selectedOwner}>{selected.name}<span>{selected.tasks.length} example tasks · owner stays in place</span></p></div></div>
      </Proposal>
      <Proposal number="05" title="Tasks settle into place" priority="Ship first" reason="240 ms · Expand only the group you need. A check draws once and the open count changes immediately; the finished row stays visible so nothing disappears." className="mw-tasks-proposal">
        <div className="mw-surface mw-tasks"><div className="mw-tasks-heading"><strong>Tasks</strong><span aria-live="polite">{total - done.length} open <small>of {total}</small></span></div>{groups.map((g, gi) => { const isOpen = opened.includes(g.name), count = g.tasks.filter(t => !done.includes(t)).length; return <div key={g.name} className="mw-task-group" style={{ '--mw-accent': g.color } as CSSProperties}><button type="button" className="mw-task-toggle" aria-expanded={isOpen} aria-controls={uid + '-group-' + gi} onClick={() => setOpened(v => isOpen ? v.filter(n => n !== g.name) : [...v, g.name])}><span className="mw-chevron" data-open={isOpen}>›</span><strong>{g.name}</strong><span>{count} open</span></button><div className="mw-fold" data-open={isOpen} id={uid + '-group-' + gi} inert={!isOpen}><div className="mw-fold-inner"><div className="mw-task-items">{g.tasks.map(task => <label key={task} className="mw-task" data-done={done.includes(task)}><input type="checkbox" checked={done.includes(task)} onChange={() => setDone(v => v.includes(task) ? v.filter(t => t !== task) : [...v, task])}/><span className="mw-task-check" aria-hidden="true"><svg viewBox="0 0 20 20"><path d="m4 10 4 4 8-8"/></svg></span><span>{task}</span></label>)}</div></div></div></div> })}<footer className="mw-task-foot"><span>Synthetic tasks · changes stay here</span><button type="button" disabled={!done.length} onClick={() => setDone([])}>Reset checks</button></footer></div>
      </Proposal>
    </div>
  </section>
}
