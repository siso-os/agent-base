// uihub: arc:command-palette
// Adapted from https://uiarc.dev/r/command-palette.json (8 Oct 2026): combobox,
// option rows, active descendant and inline keys. Uses the existing SISO motion gate
// and HaloRim instead of adding Arc's motion runtime or another global shortcut.
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react'
import { HaloRim } from '@siso/shell'
import { Search, Command, ArrowUpRight } from 'lucide-react'
import { LivingIcon, type LivingIconName } from '../../../../packages/halo-face/living-assets'
import { filterCommands, type CommandKind } from '../lib/command-palette'
import { useMotionGate, type MotionBankDemoProps } from './motion-bank-shared'
import './WorkspaceCommandPalette.css'

export type WorkspaceCommandAction = {
  id: string; label: string; description: string; icon: LivingIconName; keywords?: string[];
  kind?: CommandKind; scope?: string; shortcut?: string[]; preview?: string;
  sourceLabel?: string; available?: boolean; matchQuery?: boolean;
}
export type WorkspaceCommandPaletteProps = {
  open: boolean; query: string; actions: WorkspaceCommandAction[]; activeActionId: string | null;
  onOpenChange: (open: boolean) => void; onQueryChange: (query: string) => void;
  onActiveActionChange: (id: string) => void; onSelect: (action: WorkspaceCommandAction) => void;
  paused?: boolean; triggerLabel?: string; sourceUnavailable?: string; recentIds?: string[];
  onRemember?: (id: string) => void;
}
const TYPES = ['all', 'chats', 'projects', 'pages', 'commands'] as const;

/** One modal owns focus; selection is always an exact ID supplied by its caller. */
export function WorkspaceCommandPalette({ open, query, actions, activeActionId, onOpenChange, onQueryChange, onActiveActionChange, onSelect, paused = false, triggerLabel = 'Search anything', sourceUnavailable, recentIds = [], onRemember }: WorkspaceCommandPaletteProps) {
  const { ref, motion } = useMotionGate(paused)
  const uid = 'wp-' + useId().replace(/[^a-zA-Z0-9_-]/g, '')
  const dialog = useRef<HTMLDialogElement>(null), trigger = useRef<HTMLButtonElement>(null), search = useRef<HTMLInputElement>(null)
  const returnFocus = useRef<HTMLElement | null>(null)
  const selection = useRef<[number | null, number | null]>([null, null])
  const rows = useRef(new Map<string, HTMLButtonElement>())
  const [kind, setKind] = useState<CommandKind | 'all'>('all')
  const commandMode = query.trimStart().startsWith('>')
  const filtered = open ? filterCommands(actions, query, kind, recentIds) : []
  const active = filtered.find(action => action.id === activeActionId) ?? filtered[0]
  const restore = () => {
    const target = returnFocus.current?.isConnected ? returnFocus.current : trigger.current
    target?.focus({ preventScroll: true })
    if ((target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) && selection.current[0] !== null) {
      try { target.setSelectionRange(...selection.current) } catch { /* Search/number inputs may not support selection. */ }
    }
  }
  useEffect(() => {
    const element = dialog.current
    if (!element) return
    if (open && !element.open) {
      const target = document.activeElement
      returnFocus.current = target instanceof HTMLElement && target !== document.body ? target : trigger.current
      selection.current = target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement ? [target.selectionStart, target.selectionEnd] : [null, null]
      setKind('all')
      element.showModal(); search.current?.focus()
    } else if (!open && element.open) { element.close(); restore() }
  }, [open])
  useEffect(() => { const element = dialog.current; return () => { if (element?.open) { element.close(); restore() } } }, [])
  useEffect(() => { if (active) rows.current.get(active.id)?.scrollIntoView({ block: 'nearest' }) }, [active?.id])

  useEffect(() => { if (active && active.id !== activeActionId) onActiveActionChange(active.id) }, [active?.id, activeActionId, onActiveActionChange])

  const select = (action: WorkspaceCommandAction) => {
    if (action.available === false) return
    onRemember?.(action.id); onActiveActionChange(action.id); onOpenChange(false); onSelect(action)
  }
  const keyboard = (event: KeyboardEvent<HTMLDialogElement>) => {
    event.stopPropagation() // App/browser bubble shortcuts must not navigate behind this modal.
    if (event.nativeEvent.isComposing) return
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onOpenChange(false); return }
    if (event.key === 'Tab') {
      const stops = [...(dialog.current?.querySelectorAll<HTMLElement>('input, button:not([disabled]), [tabindex="0"]') ?? [])].filter(el => el.tabIndex >= 0 && el.getClientRects().length > 0)
      const index = stops.indexOf(document.activeElement as HTMLElement)
      event.preventDefault()
      stops[(index + (event.shiftKey ? -1 : 1) + stops.length) % stops.length]?.focus()
      return
    }
    if (event.target !== search.current) return
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      if (!filtered.length) return
      const index = filtered.findIndex(action => action.id === active?.id)
      const next = filtered[(index + (event.key === 'ArrowDown' ? 1 : -1) + filtered.length) % filtered.length]
      onActiveActionChange(next.id)
    } else if (event.key === 'Enter') { event.preventDefault(); if (active) select(active) }
  }
  return <div className="wp-root" ref={ref} data-motion={motion ? 'on' : 'off'}>
    <button ref={trigger} type="button" className="wp-trigger" aria-haspopup="dialog" aria-expanded={open} aria-controls={uid} onClick={() => { trigger.current?.focus(); onOpenChange(true) }}>
      <Search size={18} /><span>{triggerLabel}</span><kbd>⌘ K</kbd>
    </button>
    <dialog id={uid} ref={dialog} role="dialog" className="wp-dialog" data-motion={motion ? 'on' : 'off'} aria-label="Spotlight" aria-describedby={uid + '-help'} onKeyDown={keyboard} onCancel={event => { event.preventDefault(); onOpenChange(false) }} onClick={event => { if (event.target === event.currentTarget) onOpenChange(false) }}>
      <HaloRim className="wp-glass" glow={false}>
        <header className="wp-heading"><span className="wp-eyebrow">AGENT BASE <span>/</span> SPOTLIGHT</span><kbd>⌘ K</kbd></header>
        <div className="wp-searchline">{commandMode ? <Command size={23} /> : <Search size={23} />}<input id={uid + '-search'} ref={search} className="wp-search" role="combobox" aria-label="Search or enter a URL" aria-autocomplete="list" aria-expanded={open} aria-controls={uid + '-results'} aria-activedescendant={active ? uid + '-' + active.id : undefined} value={query} placeholder="Search anything, or type > for commands" autoComplete="off" onChange={event => onQueryChange(event.target.value)} /><button type="button" className="wp-close" onClick={() => onOpenChange(false)} aria-label="Close Spotlight">Esc</button></div>
        <nav className="wp-types" aria-label="Result types">{TYPES.map(type => <button key={type} type="button" aria-pressed={(commandMode ? 'commands' : kind) === type} onClick={() => { setKind(type); if (commandMode) onQueryChange(query.trimStart().slice(1).trimStart()); search.current?.focus() }}>{type[0].toUpperCase() + type.slice(1)}</button>)}</nav>
        {sourceUnavailable && <div className="wp-source-warning" role="status">{sourceUnavailable}</div>}
        <div className="wp-body">
          <section className="wp-list-pane"><div className="wp-list-heading">{!query.trim() && kind === 'all' ? (recentIds.some(id => filtered.some(a => a.id === id)) ? 'Recent destinations' : 'Explore your workspace') : commandMode || kind === 'commands' ? 'Run a command' : 'Search results'}<span>{filtered.length}</span></div>
            <div id={uid + '-results'} className="wp-results" role="listbox" aria-label="Matching destinations">
              {filtered.map(action => <button key={action.id} id={uid + '-' + action.id} data-action-id={action.id} ref={node => { if (node) rows.current.set(action.id, node); else rows.current.delete(action.id) }} className="wp-action" data-active={active?.id === action.id} type="button" role="option" aria-selected={active?.id === action.id} aria-disabled={action.available === false} tabIndex={-1} onPointerMove={() => onActiveActionChange(action.id)} onFocus={() => onActiveActionChange(action.id)} onClick={() => select(action)}>
                <span className="wp-icon"><LivingIcon name={action.icon} size={30} variant="glyph" active={active?.id === action.id} paused={!motion} /></span><span className="wp-action-copy"><strong>{action.label}</strong><span>{action.available === false ? 'Source unavailable' : action.scope || action.description}</span></span><span className="wp-keys">{(action.shortcut?.length ? action.shortcut : ['↵']).map((key, i) => <kbd key={i}>{key}</kbd>)}</span>
              </button>)}
            </div>
            {!filtered.length && <div className="wp-empty"><Search size={24} /><strong>No matching destinations</strong><span>Try another name, or search all types.</span><button type="button" className="wp-clear" onClick={() => { setKind('all'); onQueryChange(''); search.current?.focus() }}>Clear search</button></div>}
          </section>
          <aside className="wp-preview" aria-label="Destination preview">{active ? <>
            <div className="wp-preview-meta"><span>{active.kind ?? 'commands'}</span><span>{active.available === false ? 'Unavailable' : active.sourceLabel || 'Destination'}</span></div>
            <LivingIcon name={active.icon} size={46} variant="glyph" paused={!motion} />
            <h2>{active.label}</h2><p className="wp-scope">{active.scope || active.description}</p>
            <div className="wp-excerpt"><span className="wp-eyebrow">{active.preview ? 'Preview' : 'About this destination'}</span><p>{active.available === false ? 'This source is unavailable. You can keep searching other destinations.' : active.preview || active.description}</p></div>
            <button type="button" className="wp-open" disabled={active.available === false} onClick={() => select(active)}>Open {active.kind === 'commands' ? 'command' : 'destination'}<ArrowUpRight size={14} /><kbd>↵</kbd></button>
          </> : <div className="wp-preview-empty">Choose a result to look inside.</div>}</aside>
        </div>
        <footer className="wp-footer"><span>Find your next step.</span><span id={uid + '-help'}><kbd>↑</kbd><kbd>↓</kbd> choose <kbd>↵</kbd> open <kbd>Esc</kbd> close</span></footer>
      </HaloRim>
    </dialog>
  </div>
}

const EXAMPLE_ACTIONS: WorkspaceCommandAction[] = [
  { id: 'library', label: 'Great Library', description: 'Research, references and components', icon: 'library', keywords: ['knowledge', 'bank'] },
  { id: 'agent-base', label: 'Agent Base', description: 'Owners and their workers', icon: 'agent-base', keywords: ['agents', 'fleet'] },
  { id: 'estate', label: 'Estate', description: 'Machines, repositories and storage', icon: 'estate', keywords: ['infrastructure'] },
  { id: 'voice', label: 'SISO Voice', description: 'Voice workspace and transcripts', icon: 'siso-voice', keywords: ['audio'] },
  { id: 'halo-project', label: 'HALO project', description: 'Example project navigation', icon: 'web', keywords: ['project', 'operator'] },
]

export function WorkspaceCommandPaletteDemo({ paused = false, resetKey }: MotionBankDemoProps) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState<string | null>('library')
  const [receipt, setReceipt] = useState('No destination selected.')
  useEffect(() => { setOpen(false); setQuery(''); setActive('library'); setReceipt('No destination selected.') }, [resetKey])
  return <section className="wp-demo" data-demo-id="workspace-palette">
    <span className="wp-example">Local synthetic example</span>
    <WorkspaceCommandPalette open={open} query={query} actions={EXAMPLE_ACTIONS} activeActionId={active} onOpenChange={setOpen} onQueryChange={value => { setQuery(value); setActive(null) }} onActiveActionChange={setActive} onSelect={action => setReceipt('Example destination receipt: ' + action.label + ' (' + action.id + ').')} paused={paused} />
    <p className="wp-receipt" role="status">{receipt}</p>
  </section>
}
