import { useEffect, useRef, useState } from 'react';
import { HoverCard } from '@siso/shell';
import type { OutlineRow } from '../lib/chat-outline';
// uihub: conversation-tree — answer headings beside the existing minimap.
export function ChatOutline({ rows, current, onJump }: { rows: OutlineRow[]; current: number | null; onJump: (turn: number) => void }) {
  const [choice, setOpen] = useState<boolean | null>(null), [wide, setWide] = useState(false), [top, setTop] = useState(0);
  const open = choice ?? wide;
  const root = useRef<HTMLElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => { const parent = root.current?.parentElement; if (!parent) return; const ro = new ResizeObserver(() => setWide(parent.clientWidth >= 1100)); ro.observe(parent); return () => ro.disconnect(); }, [rows.length >= 3]);
  useEffect(() => { const key = (e: KeyboardEvent) => { if (e.key === 'Escape' && open) { setOpen(false); if (root.current?.contains(e.target as Node)) trigger.current?.focus(); } }; window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key); }, [open]);
  if (rows.length < 3) return null;
  const height = 60, from = Math.max(0, Math.floor(top / height) - 2), visible = rows.slice(from, from + 12);
  return <aside ref={root} className={`chat-outline${open ? ' is-open' : ''}`} aria-label="Answer outline">
    <button ref={trigger} type="button" className="chat-outline-toggle" aria-expanded={open} onClick={() => setOpen(!open)}>Outline <span>{rows.length}</span></button>
    {open && <nav className="chat-outline-list" aria-label="Answers" onScroll={e => setTop(e.currentTarget.scrollTop)}>
      <div style={{ height: rows.length * height, position: 'relative' }}>
        {visible.map((row, n) => <div key={row.key} style={{ position: 'absolute', top: (from + n) * height, height, width: '100%' }}>
          <HoverCard title={row.title} line={row.preview} meta={row.at ? new Date(row.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : undefined}>
            <button type="button" className={`chat-outline-row${row.heading ? '' : ' is-fallback'}`} aria-current={current === row.turn ? 'location' : undefined} onClick={() => onJump(row.turn)}>
              {row.sessionBreak && <small>New session</small>}<span>{current === row.turn ? '● ' : '○ '}{row.title}</span><time>{row.at ? new Date(row.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Earlier'}</time>
            </button>
          </HoverCard>
        </div>)}
      </div>
    </nav>}
  </aside>;
}
