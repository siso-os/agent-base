import { Fragment, useLayoutEffect, useId, useRef, type CSSProperties, type ReactNode } from 'react'
import { WorkspaceMark, type WorkspaceBrand } from '../../../../packages/halo-face/living-assets'
import { useMotionGate } from './motion-bank-shared'
import './TaskWorkspaceDeck.css'

export type WorkspaceDeckTask = { id: string; stage: string; needs?: boolean }
export type WorkspaceDeckTotals = { open: number; active: number; review: number }
export type WorkspaceDeckGroup<T extends WorkspaceDeckTask> = {
  id: string; name: string; color: string; brand?: WorkspaceBrand
  owners: readonly { id: string; name: string; tasks: readonly T[] }[]
  /** Optional producer-owned root totals; child/phase counts never enter this contract. */
  totals?: WorkspaceDeckTotals
  /** Concise current-work preview supplied by the caller, shown when folded. */
  summary?: string
}
export type TaskWorkspaceDeckProps<T extends WorkspaceDeckTask> = {
  groups: readonly WorkspaceDeckGroup<T>[]
  expandedIds: readonly string[]
  onExpandedChange: (ids: string[]) => void
  renderTask: (task: T) => ReactNode
  /** Optional sibling action; never placed inside the supplied task tree. */
  renderTaskAction?: (task: T) => ReactNode
  /** Keep real registry workspaces reachable even when this filter has no roots. */
  preserveEmptyGroups?: boolean
  variant?: 'compact' | 'expressive'; paused?: boolean; className?: string; emptyLabel?: string
}
const CLOSED = new Set(['done', 'live', 'integrated', 'happy', 'dropped'])
/** The caller owns grouping, registry order, root selection and the task renderer. */
export function TaskWorkspaceDeck<T extends WorkspaceDeckTask>({ groups, expandedIds, onExpandedChange, renderTask, renderTaskAction, preserveEmptyGroups = false, variant = 'expressive', paused = false, className = '', emptyLabel = 'No tasks in this view.' }: TaskWorkspaceDeckProps<T>) {
  const { ref, motion } = useMotionGate(paused)
  const uid = useId()
  const buttons = useRef(new Map<string, HTMLButtonElement>())
  const contents = useRef(new Map<string, HTMLDivElement>())
  useLayoutEffect(() => {
    for (const [id, content] of contents.current) {
      if (!expandedIds.includes(id) && content.contains(document.activeElement)) buttons.current.get(id)?.focus()
    }
  }, [expandedIds])
  const rootCount = groups.reduce((n, group) => n + group.owners.reduce((count, owner) => count + owner.tasks.length, 0), 0)
  return <div ref={ref} className={`twd-deck twd-${variant} ${className}`} data-motion={motion ? 'on' : 'off'} data-root-count={rootCount}>
    {rootCount === 0 && (!preserveEmptyGroups || !groups.length) ? <div className="twd-empty"><span className="twd-empty-ring" aria-hidden="true"/><strong>{emptyLabel}</strong><p>Choose another view to return to the workspace collection.</p></div> : groups.map((group, index) => {
      const roots = group.owners.flatMap(owner => [...owner.tasks])
      const totals = group.totals ?? { open: roots.filter(task => !CLOSED.has(task.stage)).length, active: roots.filter(task => task.stage === 'building').length, review: roots.filter(task => task.needs).length }
      const expanded = expandedIds.includes(group.id)
      const panelId = `${uid}-workspace-${index}`
      return <section key={group.id} className="twd-workspace" data-workspace={group.id} data-expanded={expanded} style={{ '--twd-color': group.color || '#9aabb8' } as CSSProperties}>
        <button ref={node => { if (node) buttons.current.set(group.id, node); else buttons.current.delete(group.id) }} className="twd-head" data-has-mark={variant === 'expressive' && !!group.brand} type="button" aria-expanded={expanded} aria-controls={panelId} onClick={() => onExpandedChange(expanded ? expandedIds.filter(id => id !== group.id) : [...expandedIds, group.id])}>
          {variant === 'expressive' && group.brand && <span className="twd-mark"><WorkspaceMark brand={group.brand} size={43} paused={!motion} /></span>}
          <span className="twd-identity"><strong>{group.name}</strong><small>{roots.length} root {roots.length === 1 ? 'task' : 'tasks'} · {group.owners.length} {group.owners.length === 1 ? 'owner' : 'owners'}</small>{!expanded && group.summary && <span className="twd-summary">{group.summary}</span>}</span>
          <span className="twd-totals"><span><b>{totals.open}</b> open</span><span><b>{totals.active}</b> active</span><span data-review={totals.review > 0}><b>{totals.review}</b> review</span></span><span className="twd-chevron" aria-hidden="true">›</span>
        </button>
        <div ref={node => { if (node) contents.current.set(group.id, node); else contents.current.delete(group.id) }} id={panelId} className="twd-fold" hidden={!expanded} inert={!expanded}>
          <div className="twd-content">{group.owners.map(owner => <section className="twd-owner" key={owner.id} data-owner={owner.id}>
            <div className="twd-owner-head"><span className="twd-owner-line"/><span>{owner.name}</span><small>{owner.tasks.length} root {owner.tasks.length === 1 ? 'task' : 'tasks'}</small></div>
            <ul className="ab-taskcard__rows twd-rows">{owner.tasks.map(task => {
              const action = renderTaskAction?.(task)
              return <Fragment key={task.id}>{renderTask(task)}{action && <li className="twd-task-action">{action}</li>}</Fragment>
            })}</ul>
          </section>)}{!roots.length && <p className="twd-group-empty">{emptyLabel}</p>}</div>
        </div>
      </section>
    })}
  </div>
}
