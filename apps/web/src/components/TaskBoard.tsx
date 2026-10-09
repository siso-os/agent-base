// t-0567: the Agent Base task board (Shaan, 9 Oct: "I can see the tasks of what's being landed, what's on the to-do list and
// what's in the pipeline ... what's being specced out ... ideas ... and when I have ideas what I could tell it to do").
// Five lanes from one store, so the numbers match `bin/ask queue AGENT-BASE`; a box to tell it a task or an idea.
import { useEffect, useLayoutEffect, useRef, useState, type DragEvent, type KeyboardEvent, type ReactNode } from 'react';
import { ArrowUpRight, Lightbulb, ListChecks, X } from 'lucide-react';
import { age, useBoard, when, writeBoard, type Board, type BoardCard } from '../lib/board';
import type { CardTask } from './panel/LandedRows';
import './TaskBoard.css';

type Shots = Map<string, { before: string; after: string }>;

/** AGENT-BASE's current line from its owner card, in place of the old working brief. */
export function SprintLine({ sprint }: { sprint: Board['sprint'] | undefined }) {
  return <section className="tb-sprint" data-testid="sprint-line"><ListChecks size={20} aria-hidden="true"/>
    <small>AGENT-BASE · {sprint ? `${sprint.status || 'no status'}${sprint.updated ? ` · ${when(sprint.updated)}` : ''}` : 'no card yet'}</small>
    <p>{sprint?.summary || 'Nothing recorded on its card yet.'}</p>
    {sprint?.next && <p className="tb-sprint__next"><b>Next</b> {sprint.next}</p>}
  </section>;
}

export function TaskBoard({ tasks, onTask }: { tasks: CardTask[]; onTask: (id: string) => void }) {
  const [days, setDays] = useState(7);
  const { data, error } = useBoard(days);
  const [words, setWords] = useState(''), [kind, setKind] = useState<'task' | 'idea'>('task');
  const [telling, setTelling] = useState(false), [told, setTold] = useState<{ ok: boolean; text: string; id?: string } | null>(null);
  const [busy, setBusy] = useState<Record<string, boolean>>({}), [errors, setErrors] = useState<Record<string, string>>({});
  const [order, setOrder] = useState<string[] | null>(null), [dragging, setDragging] = useState<string | null>(null);
  const [open, setOpen] = useState<BoardCard | null>(null), [spec, setSpec] = useState<string | null>(null);
  const dialog = useRef<HTMLDialogElement>(null), trigger = useRef<HTMLButtonElement | null>(null);
  const shots: Shots = new Map(tasks.flatMap(t => t.shots ? [[t.id, t.shots] as const] : []));

  const served = data?.lanes.todo ?? [];
  // His drag shows at once; once a read carries the same order, the read is the truth again.
  useEffect(() => { if (order && served.map(c => c.id).join() === order.join()) setOrder(null); }, [served, order]);
  const todo = order ? order.flatMap(id => served.find(c => c.id === id) ?? []).concat(served.filter(c => !order.includes(c.id))) : served;

  useLayoutEffect(() => { if (open && !dialog.current?.open) dialog.current?.showModal(); }, [open]);
  useEffect(() => {
    setSpec(null);
    if (!open || open.kind !== 'task' || !open.spec) return;
    let live = true;
    fetch(`/api/board/agent-base/spec/${encodeURIComponent(open.id)}`).then(r => r.ok ? r.json() : null).then(b => { if (live) setSpec(b?.text ?? ''); }).catch(() => { if (live) setSpec(''); });
    return () => { live = false; };
  }, [open]);
  const close = () => { dialog.current?.close(); setOpen(null); trigger.current?.focus(); };

  const act = async (id: string, write: Parameters<typeof writeBoard>[0]) => {
    setBusy(b => ({ ...b, [id]: true })); setErrors(({ [id]: _, ...rest }) => rest);
    const r = await writeBoard(write, days);
    if (!r.ok) setErrors(e => ({ ...e, [id]: r.error }));
    setBusy(({ [id]: _, ...rest }) => rest);
    return r;
  };
  const tell = async () => {
    const text = words.trim();
    if (!text || telling) return;
    setTelling(true); setTold(null);
    const r = await writeBoard({ op: 'tell', words: text, kind }, days);
    setTelling(false);
    if (!r.ok) return setTold({ ok: false, text: r.error });
    setWords('');
    setTold({ ok: true, id: r.id, text: kind === 'idea' ? `${r.id} is in Ideas.` : `${r.id} is at the top of To do. The next sprint takes it.` });
  };
  const reorder = async (ids: string[]) => {
    const before = todo.map(c => c.id);
    setOrder(ids);
    const r = await writeBoard({ op: 'order', ids }, days);
    if (!r.ok) { setOrder(before); setErrors(e => ({ ...e, todo: r.error })); }
  };
  const moveTo = (id: string, beforeId: string | null) => {
    const ids = todo.map(c => c.id).filter(x => x !== id);
    const at = beforeId ? ids.indexOf(beforeId) : ids.length;
    ids.splice(at < 0 ? ids.length : at, 0, id);
    if (ids.join() !== todo.map(c => c.id).join()) void reorder(ids);
  };
  const drop = (e: DragEvent, beforeId: string | null) => { e.preventDefault(); const id = e.dataTransfer.getData('text/plain') || dragging; setDragging(null); if (id) moveTo(id, beforeId); };
  const nudge = (e: KeyboardEvent, id: string) => {
    if (!e.altKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
    e.preventDefault();
    const ids = todo.map(c => c.id), i = ids.indexOf(id), j = i + (e.key === 'ArrowUp' ? -1 : 1);
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    void reorder(ids);
    requestAnimationFrame(() => document.querySelector<HTMLButtonElement>(`[data-card="${id}"] .tb-card__open`)?.focus());
  };

  const card = (c: BoardCard, extra?: ReactNode, opts: { drag?: boolean; landed?: boolean } = {}) => {
    const shot = opts.landed ? shots.get(c.id) : undefined;
    return <article key={c.id} className={`tb-card${dragging === c.id ? ' is-dragging' : ''}${told?.id === c.id ? ' is-new' : ''}`} data-card={c.id}
      draggable={opts.drag || undefined}
      onDragStart={opts.drag ? e => { e.dataTransfer.setData('text/plain', c.id); e.dataTransfer.effectAllowed = 'move'; setDragging(c.id); } : undefined}
      onDragEnd={opts.drag ? () => setDragging(null) : undefined}
      onDragOver={opts.drag ? e => e.preventDefault() : undefined}
      onDrop={opts.drag ? e => drop(e, c.id) : undefined}>
      <button type="button" className="tb-card__open" title={opts.drag ? 'Drag, or Alt+Up/Down, to reorder' : undefined}
        onClick={e => { trigger.current = e.currentTarget; setOpen(c); }} onKeyDown={opts.drag ? e => nudge(e, c.id) : undefined}>
        <small>{c.id}{c.kind === 'idea' ? ` · ${c.by}` : ''} · {opts.landed ? when(c.live_at ?? null) : age(c.at)}</small>
        <strong>{c.title}</strong>
      </button>
      {c.folds?.length ? <p className="tb-card__note">Replaces {c.folds.join(', ')}</p> : null}
      {shot && <div className="tb-card__shots"><img src={shot.before} alt={`${c.id} before`} loading="lazy"/><img src={shot.after} alt={`${c.id} after`} loading="lazy"/></div>}
      {(extra || c.link) && <div className="tb-card__acts">
        {c.link && <a href={c.link.url} target="_blank" rel="noreferrer">{c.link.label} <ArrowUpRight size={12}/></a>}
        {extra}
      </div>}
      {errors[c.id] && <p className="tb-card__error" role="alert">{errors[c.id]}</p>}
    </article>;
  };
  const button = (c: BoardCard, label: string, write: Parameters<typeof writeBoard>[0]) =>
    <button type="button" className="tb-act" disabled={busy[c.id]} onClick={() => void act(c.id, write)}>{label}</button>;
  const lane = (name: string, count: number, body: ReactNode, hint?: string) => <section className="tb-lane" aria-label={name} data-lane={name}>
    <h2>{name}<span data-testid={`count-${name}`}>{count}</span></h2>
    {hint && <p className="tb-hint">{hint}</p>}
    <div className="tb-lane__cards">{body}</div>
  </section>;

  if (!data) return <div className="tb" data-testid="task-board"><p role="status" className="tb-hint">{error ? `The board could not be read (${error}).` : 'Reading the board…'}</p></div>;
  const { ideas, specced, building, landed } = data.lanes;
  const now = todo.slice(0, data.size), next = todo.slice(data.size);
  const landedCount = landed.reduce((n, g) => n + g.cards.length, 0);
  const empty = (text: string) => <p className="tb-empty">{text}</p>;
  return <div className="tb" data-testid="task-board">
    <form className="tb-tell" onSubmit={e => { e.preventDefault(); void tell(); }}>
      <textarea aria-label="Tell Agent Base" placeholder={kind === 'idea' ? 'An idea for later…' : 'Tell Agent Base…'} rows={2} value={words}
        onChange={e => setWords(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void tell(); } }}/>
      <div className="tb-tell__row">
        <div role="radiogroup" aria-label="It is" className="tb-kind">
          {(['task', 'idea'] as const).map(k => <button key={k} type="button" role="radio" aria-checked={kind === k} onClick={() => setKind(k)}>
            {k === 'idea' ? <><Lightbulb size={13}/> Idea</> : <><ListChecks size={13}/> Task</>}</button>)}
        </div>
        <span className="tb-tell__where">{kind === 'idea' ? 'Lands in Ideas' : 'Lands at the top of To do, word for word'}</span>
        <button type="submit" className="tb-tell__send" disabled={!words.trim() || telling}>{telling ? 'Telling…' : 'Tell'}</button>
      </div>
      {told && <p className={told.ok ? 'tb-told' : 'tb-card__error'} role={told.ok ? 'status' : 'alert'}>{told.text}</p>}
    </form>
    <p className="tb-total" data-testid="board-total"><b>{data.queue}</b> open asks, the same list as <code>bin/ask queue AGENT-BASE</code> · {todo.length} to do, {specced.length} specced, {building.length} building
      {error && <span className="tb-card__error"> · refresh failed ({error}); showing the last read</span>}</p>
    <div className="tb-lanes">
      {lane('Ideas', ideas.length, ideas.length ? ideas.map(c => card(c, button(c, 'Make it a task', { op: 'make-task', id: c.id }))) : empty('No ideas yet. Flip the box to Idea.'))}
      {lane('Specced', specced.length, specced.length ? specced.map(c => card(c, button(c, 'To do', { op: 'todo', id: c.id, on: true }))) : empty('Nothing specced waiting.'))}
      {lane('To do', todo.length, <>
        <h3 className="tb-sub">Now <span>the sprint takes these {data.size}</span></h3>
        <div className="tb-drop" onDragOver={e => e.preventDefault()} onDrop={e => drop(e, now[0]?.id ?? null)}>
          {now.length ? now.map(c => card(c, button(c, 'Not now', { op: 'todo', id: c.id, on: false }), { drag: true })) : empty('Nothing to do. Tell it something, or move a specced ask here.')}
        </div>
        {next.length > 0 && <><h3 className="tb-sub">Next</h3>{next.map(c => card(c, button(c, 'Not now', { op: 'todo', id: c.id, on: false }), { drag: true }))}</>}
        {todo.length > 0 && <div className="tb-drop tb-drop--end" onDragOver={e => e.preventDefault()} onDrop={e => drop(e, null)} aria-hidden="true"/>}
        {errors.todo && <p className="tb-card__error" role="alert">{errors.todo}</p>}
      </>, todo.length > 1 ? 'Drag to reorder' : undefined)}
      {lane('Building', building.length, building.length ? building.map(c => card(c)) : empty('Nothing building right now.'))}
      {lane('Landed', landedCount, <>
        {landed.map(g => <div key={g.version ?? 'earlier'} className="tb-release">
          <h3 className="tb-sub">{g.version ? `v${g.version}` : 'Before the release log'} <span>{when(g.at)} · {g.cards.length}</span></h3>
          {g.cards.map(c => card(c, undefined, { landed: true }))}
        </div>)}
        {!landed.length && empty(`Nothing landed in the last ${data.days} days.`)}
        <button type="button" className="tb-act tb-older" onClick={() => setDays(d => d === 7 ? 60 : 7)}>{days === 7 ? 'Show older' : 'Last 7 days only'}</button>
      </>, `Last ${data.days} days, by release`)}
    </div>
    <dialog ref={dialog} className="tb-dialog" aria-labelledby="tb-dialog-title" onCancel={e => { e.preventDefault(); close(); }} onClose={() => setOpen(null)}>
      <button type="button" className="tb-dialog__close" aria-label="Close" onClick={close}><X size={18}/></button>
      {open && <>
        <small>{open.id} · {open.kind === 'idea' ? `idea by ${open.by}` : open.stage}{open.at ? ` · ${when(open.at)}` : ''}</small>
        <h2 id="tb-dialog-title">{open.title}</h2>
        <h3>His words</h3>
        <p className="tb-dialog__his">{open.his || 'No words recorded.'}</p>
        {open.kind === 'task' && open.spec && <><h3>Spec</h3><pre className="tb-dialog__spec">{spec === null ? 'Reading the spec…' : spec || 'The spec could not be read.'}</pre></>}
        <div className="tb-card__acts">
          {open.link && <a href={open.link.url} target="_blank" rel="noreferrer">{open.link.label} <ArrowUpRight size={12}/></a>}
          {open.kind === 'task' && <button type="button" className="tb-act" onClick={() => { const id = open.id; close(); onTask(id); }}>Open full task</button>}
        </div>
      </>}
    </dialog>
  </div>;
}

/** The rail icon's peek: what is building now and the top three to do, never a stale priority. */
export function AgentBasePeek({ onOpen }: { onOpen: () => void }) {
  const { data } = useBoard();
  const row = (c: BoardCard) => <p key={c.id}><span>{c.id}</span>{c.title}</p>;
  return <div className="tb-peek" data-testid="agent-base-peek">
    {!data ? <p>Reading the board…</p> : <>
      <small>BUILDING</small>
      {data.lanes.building.length ? data.lanes.building.map(row) : <p className="tb-peek__none">Nothing building.</p>}
      <small>TO DO</small>
      {data.lanes.todo.length ? data.lanes.todo.slice(0, 3).map(row) : <p className="tb-peek__none">Nothing to do.</p>}
      <small>{data.queue} open asks</small>
    </>}
    <button type="button" className="tb-peek__open" onClick={onOpen}>Open the board</button>
  </div>;
}
