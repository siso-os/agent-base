import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { CheckIcon, ChevronDownIcon, FolderGit2Icon, GitBranchIcon, UsersIcon } from 'lucide-react';
import { MenuList, useOutsideClose } from '@siso/shell';
import type { WorkspaceChoice } from '../lib/agents';
import './WorkspaceChoices.css';

type Repo = { id: string; name: string; path: string };
/** Presentation only: the caller retains the launch identity and single-flight request. */
export function WorkspaceChoices({ value, onChange, disabled }: { value: WorkspaceChoice; onChange: (v: WorkspaceChoice) => void; disabled?: boolean }) {
  const [repos, setRepos] = useState<Repo[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [attempt, setAttempt] = useState(0);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [position, setPosition] = useState<CSSProperties>({});
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const id = useId();
  const close = useCallback(() => setOpen(false), []);
  const finish = () => { setOpen(false); trigger.current?.focus(); };
  useOutsideClose(trigger, open, close, panel);
  useEffect(() => {
    let live = true;
    setLoading(true); setError(null);
    void fetch('/api/workspaces/repos').then(r => { if (!r.ok) throw Error('Cannot load repositories'); return r.json(); }).then(d => {
      if (!Array.isArray(d.repos) || !d.repos.every((r: Repo) => typeof r.id === 'string' && typeof r.name === 'string' && typeof r.path === 'string')) throw Error('Repository list is unavailable');
      if (live) setRepos([...new Map(d.repos.map((r: Repo) => [r.path, r])).values()] as Repo[]);
    }).catch(e => { if (live) setError(e.message); }).finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [attempt]);
  useEffect(() => { if (disabled) setOpen(false); }, [disabled]);
  useLayoutEffect(() => {
    if (!open || !trigger.current) return;
    const r = trigger.current.getBoundingClientRect();
    const width = Math.min(380, window.innerWidth - 24);
    const below = window.innerHeight - r.bottom - 12;
    setPosition({ width, left: Math.max(12, Math.min(r.left, window.innerWidth - width - 12)), ...(below >= 180 ? { top: r.bottom + 6, maxHeight: Math.min(350, below) } : { bottom: window.innerHeight - r.top + 6, maxHeight: Math.max(120, r.top - 18) }) });
    search.current?.focus();
    const dismiss = () => setOpen(false);
    window.addEventListener('resize', dismiss);
    return () => window.removeEventListener('resize', dismiss);
  }, [open]);
  const selected = repos.find(r => r.path === value.repo);
  const filtered = repos.filter(r => `${r.name} ${r.path}`.toLowerCase().includes(query.trim().toLowerCase()));
  return <div className="ab-workspace-choice" data-testid="workspace-choices" aria-busy={loading}>
    <label className="ab-workspace-choice__label" htmlFor={id}>Repository</label>
    <button id={id} ref={trigger} type="button" className="ab-workspace-choice__repo" aria-haspopup="dialog" aria-expanded={open} aria-controls={`${id}-picker`} disabled={disabled || loading} onClick={() => { setQuery(''); setOpen(v => !v); }}><FolderGit2Icon size={15} /><span>{loading ? 'Loading repositories…' : selected?.name ?? (value.repo ? 'Selected repository unavailable' : 'Choose a repository')}</span><ChevronDownIcon size={14} /></button>
    <fieldset className="ab-workspace-choice__mode" disabled={disabled}><legend>Checkout mode</legend><div role="group" aria-label="Checkout mode">{([{ type: 'isolated', label: 'Own worktree', Icon: GitBranchIcon }, { type: 'shared', label: 'Shared checkout', Icon: UsersIcon }] as const).map(({ type, label, Icon }) => <button key={type} type="button" aria-pressed={value.workspace.type === type} onClick={() => { if (value.workspace.type !== type) onChange({ ...value, workspace: type === 'isolated' ? { type } : { type, reason: '' } }); }}><Icon size={14} />{label}</button>)}</div></fieldset>
    <p className="ab-workspace-choice__hint">{value.workspace.type === 'isolated' ? 'A separate worktree for this chat.' : 'This chat will use the existing checkout. Explain why it needs to share.'}</p>
    {value.workspace.type === 'shared' && <label className="ab-workspace-choice__reason">Reason for sharing<input aria-label="Shared checkout reason" placeholder="Why share this checkout?" required disabled={disabled} value={value.workspace.reason} onChange={e => onChange({ ...value, workspace: { type: 'shared', reason: e.target.value } })} /></label>}
    {error && <p role="alert" className="ab-workspace-choice__error">{error} <button type="button" disabled={disabled || loading} onClick={() => setAttempt(n => n + 1)}>Retry</button></p>}
    {!loading && !error && !repos.length && <p role="status" className="ab-workspace-choice__hint">No repositories are available.</p>}
    {open && createPortal(<div ref={panel} id={`${id}-picker`} role="dialog" aria-label="Choose a repository" className="ab-workspace-picker" style={position} onPointerDown={e => e.stopPropagation()} onMouseDown={e => e.stopPropagation()} onClick={e => e.stopPropagation()} onKeyDown={e => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(); }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Home' || e.key === 'End') {
        const choices = [...(panel.current?.querySelectorAll<HTMLButtonElement>('[role=menuitem]:not(:disabled)') ?? [])];
        if (!choices.length) return;
        e.preventDefault(); e.stopPropagation();
        const current = choices.indexOf(document.activeElement as HTMLButtonElement);
        const next = e.key === 'Home' ? 0 : e.key === 'End' ? choices.length - 1 : e.key === 'ArrowDown' ? (current + 1) % choices.length : (current - 1 + choices.length) % choices.length;
        choices[next]?.focus();
      }
      if (e.key === 'Enter' && e.target === search.current) { e.preventDefault(); e.stopPropagation(); }
    }}><input ref={search} type="search" value={query} onChange={e => setQuery(e.target.value)} aria-label="Find a repository" placeholder="Find a repository" /><MenuList className="ab-workspace-picker__menu" empty={error ? 'Repositories could not be loaded.' : 'No repositories match.'} items={filtered.map(r => ({ key: r.path, current: value.repo === r.path, icon: value.repo === r.path ? <CheckIcon size={14} /> : <FolderGit2Icon size={14} />, label: <span><b>{r.name}</b><small>{r.path}</small></span>, onSelect: () => { if (!disabled) onChange({ ...value, repo: r.path }); finish(); } }))} /></div>, document.body)}
  </div>;
}
