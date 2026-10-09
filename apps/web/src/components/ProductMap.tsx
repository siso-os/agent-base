import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AgentFace } from '../../../../packages/halo-face/AgentFace';
import { LivingIcon } from '../../../../packages/halo-face/LivingIcon';
import { ProductMapManual } from './ProductMapManual';
import './ProductMap.css';

type Rating = { value: 'good' | 'ok' | 'shit'; at: string; note: string };
type Link = { id: string; title: string; url: string };
type Surface = { id: string; name: string; kind: string; summary: string; status: string; rating: Rating | null; lane: string | null; lastWorked: string | null; landedAt: string | null; screenshot: { url: string; file: string; modifiedAt: string; evidence: string } | null; feedback: Link | null; openFeedback: number | null; rounds: Link[]; pages: Link[]; tasks: (Link & { stage: string; agent: string | null })[]; active: (Link & { agent: string | null })[]; issues: string[] };
type Catalog = { rows: Surface[]; at: string; taskAvailability: string; taskError: string | null; ratingGate: string };
const when = (value: string | null) => value ? new Date(value).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : 'Not recorded';
const lenses = [['all', 'All surfaces'], ['unrated', 'Never reviewed'], ['shit', 'Shit first'], ['running', 'Running now'], ['week', 'Landed this week']] as const;
function SurfaceShot({ src, alt, className }: { src: string; alt: string; className?: string }) {
  const [failed,setFailed] = useState<string | null>(null);
  return failed === src ? <span className="pm-no-shot">Stored screenshot unavailable</span> : <img src={src} alt={alt} className={className} loading="lazy" onError={()=>setFailed(src)}/>;
}
export function ProductMap({ endpoint = '/api/product-map', onOpenUrl }: { endpoint?: string; onOpenUrl?: (url: string, title: string) => void }) {
  const [data,setData] = useState<Catalog | null>(null), [error,setError] = useState(''), [loading,setLoading] = useState(true);
  const [query,setQuery] = useState(''), [lens,setLens] = useState('all'), [lane,setLane] = useState('all'), [kind,setKind] = useState('all');
  const [selected,setSelected] = useState<string | null>(null), [note,setNote] = useState(''), [saving,setSaving] = useState(false), [saved,setSaved] = useState('');
  const [manual,setManual] = useState<'states' | 'animations' | 'edge-cases' | null>(null);
  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true); setError('');
    try { const r = await fetch(endpoint, { signal }); if (!r.ok) throw new Error('The product catalog is unavailable.'); const next = await r.json(); if (!Array.isArray(next.rows)) throw new Error('The product catalog is invalid.'); setData(next); }
    catch (e) { if (!(e instanceof DOMException && e.name === 'AbortError')) setError(e instanceof Error ? e.message : 'Unable to load product map'); }
    finally { if (!signal?.aborted) setLoading(false); }
  },[endpoint]);
  useEffect(() => { const c = new AbortController(); void load(c.signal); return () => c.abort(); },[load]);
  const visible = useMemo(() => (data?.rows ?? []).filter(s => {
    const search = `${s.name} ${s.summary} ${s.status} ${s.id}`.toLowerCase().includes(query.toLowerCase());
    return search && (kind === 'all' || s.kind === kind) && (lane === 'all' || (lane === 'unknown' ? !s.lane : s.lane === lane)) && (lens !== 'unrated' || !s.rating) && (lens !== 'running' || s.active.length > 0) && (lens !== 'week' || (!!s.landedAt && Date.parse(s.landedAt) >= Date.now() - 7*86400000));
  }).sort((a,b) => lens === 'shit' ? (a.rating?.value === 'shit' ? -1 : 0) - (b.rating?.value === 'shit' ? -1 : 0) : 0),[data,query,lens,kind,lane]);
  const detail = data?.rows.find(s => s.id === selected);
  const dialog = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (!selected) return;
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.focus();
    const trap = (event: KeyboardEvent) => {
      if (event.key !== 'Tab' || !dialog.current) return;
      const stops = Array.from(dialog.current.querySelectorAll<HTMLElement>('a[href], button:not(:disabled), textarea:not(:disabled), input:not(:disabled), select:not(:disabled)'));
      const first = stops[0], last = stops.at(-1);
      if (!first) { event.preventDefault(); dialog.current.focus(); return; }
      if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', trap);
    return () => { document.removeEventListener('keydown', trap); previous?.focus(); };
  },[selected]);
  const open = (url: string, title: string, e: React.MouseEvent<HTMLAnchorElement>) => { if (onOpenUrl) { e.preventDefault(); onOpenUrl(new URL(url, window.location.href).href,title); } };
  const link = (p: Link) => <a key={p.id} href={p.url} onClick={e => open(p.url,p.title,e)}>{p.title} <span aria-hidden>↗</span></a>;
  const rate = async (value: Rating['value']) => {
    if (!detail || saving) return;
    setSaving(true); setSaved('');
    try {
      const r = await fetch(`${endpoint}/${encodeURIComponent(detail.id)}/rating`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ rating:value, note }) });
      if (!r.ok) throw new Error('Rating was not saved. Your note is still here.');
      const result = await r.json();
      setData(current => current ? { ...current, rows:current.rows.map(s => s.id === detail.id ? { ...s, rating:result.rating } : s) } : current);
      setSaved(`Saved ${value} for ${detail.name}.`);
    } catch (e) { setSaved(e instanceof Error ? e.message : 'Rating was not saved.'); }
    finally { setSaving(false); }
  };
  const reviewed = data?.rows.filter(s => s.rating).length ?? 0;
  return <section className="product-map" aria-label="Product map">
    <header className="pm-header"><div className="pm-heading"><LivingIcon name="library" size={52}/><div><span className="pm-eyebrow">AGENT BASE · PRODUCT ATLAS</span><h1>What needs your eye?</h1><p>Every surface, its evidence, and your last verdict.</p></div></div><button onClick={() => void load()} disabled={loading}>↻ Refresh</button></header>
    <div className="pm-summary"><strong>{reviewed} <span>of {data?.rows.length ?? '—'} reviewed</span></strong><p>Your ratings are the starting point. Stored screenshots are evidence from their round; they do not establish what is live now.</p></div>
    <nav className="pm-manual-nav" aria-label="Component manuals"><span>Component manuals</span>{(['states','animations','edge-cases'] as const).map(id => <button key={id} aria-pressed={manual === id} onClick={() => setManual(manual === id ? null : id)}>{id === 'edge-cases' ? 'Edge cases' : id[0].toUpperCase()+id.slice(1)}</button>)}</nav>
    {manual && <ProductMapManual section={manual}/>}
    {error && <p className="pm-error" role="alert">{error} {data && 'Showing the last loaded catalog.'}</p>}
    {loading && !data && <p role="status">Loading the component catalog…</p>}
    {data && <>
      <div className="pm-controls"><label className="pm-search">Find a surface<input type="search" placeholder="Chat, Library, input bar…" value={query} onChange={e => setQuery(e.target.value)}/></label><label>Type<select value={kind} onChange={e => setKind(e.target.value)}><option value="all">All types</option><option value="page">Pages</option><option value="component">Shared parts</option></select></label><label>Planning lane<select value={lane} onChange={e => setLane(e.target.value)}><option value="all">All lanes</option><option value="now">Now</option><option value="next">Next</option><option value="later">Later</option><option value="unknown">Not assigned</option></select></label></div>
      <div className="pm-lenses" aria-label="Map lenses">{lenses.map(([id,label])=><button key={id} aria-pressed={lens===id} onClick={()=>setLens(id)}>{label}</button>)}<span>{visible.length} of {data.rows.length} surfaces</span></div>
      {data.taskAvailability !== 'available' && <p className="pm-source-note">Running work unavailable · {data.taskError}. A blank allocation is not proof that nobody is working.</p>}
      {!visible.length && <div className="pm-empty"><h2>No surfaces in this view</h2><p>Try another lens or clear the filters. Missing review and planning dates are never guessed.</p><button onClick={()=>{setQuery('');setLens('all');setLane('all');setKind('all');}}>Clear filters</button></div>}
      <div className="pm-grid">{visible.map(s => <article key={s.id} className="pm-tile" data-surface={s.id}><button className="pm-preview" aria-label={`Review ${s.name}`} onClick={()=>{setSelected(s.id);setNote(s.rating?.note ?? '');setSaved('');}}>{s.screenshot ? <SurfaceShot src={s.screenshot.url} alt={`${s.name}, stored hub screenshot`}/> : <span className="pm-no-shot"><span aria-hidden>▧</span>No stored screenshot</span>}<span className={`pm-verdict pm-verdict-${s.rating?.value ?? 'unrated'}`}>{s.rating?.value ?? 'Unrated'}</span></button><div className="pm-tile-body"><div className="pm-tile-title"><h2>{s.name}</h2><span>{s.kind === 'page' ? 'Page' : 'Shared part'}</span></div><p className="pm-description">{s.summary}</p><div className="pm-tile-meta"><span>{s.rounds.length} linked rounds</span><span>{s.openFeedback === null ? 'Feedback uncounted' : `${s.openFeedback} open feedback`}</span></div><div className="pm-tile-foot"><span>{s.rating ? `Rated ${when(s.rating.at)}` : 'Ready for your first rating'}</span>{s.active.length > 0 && <span className="pm-running" title={`Task reports running: ${s.active.map(t=>t.agent ?? t.title).join(", ")}`}><AgentFace name={s.active[0].agent ?? "Assigned work"} status="working" size={23}/>{s.active.length} running</span>}</div><button className="pm-review" onClick={()=>{setSelected(s.id);setNote(s.rating?.note ?? '');setSaved('');}}>View & rate <span aria-hidden>→</span></button></div></article>)}</div>
      <p className="pm-source-note">Catalog refreshed {new Date(data.at).toLocaleString()} · Status is recorded context, not a live deployment check.</p>
    </>}
    {detail && <div className="pm-overlay" onClick={e=>{if(e.target===e.currentTarget&&!saving)setSelected(null);}}><section className="pm-detail" role="dialog" aria-modal="true" aria-label={`Review ${detail.name}`} onKeyDown={e=>{if(e.key==='Escape'&&!saving)setSelected(null);}} ref={dialog} tabIndex={-1}>
      <header><div><span className="pm-eyebrow">SURFACE REVIEW</span><h2>{detail.name}</h2></div><button onClick={()=>setSelected(null)} disabled={saving} aria-label="Close surface review">✕</button></header>
      {detail.screenshot ? <><a href={detail.screenshot.url} onClick={e=>open(detail.screenshot!.url,detail.name,e)}><SurfaceShot className="pm-detail-shot" src={detail.screenshot.url} alt={`${detail.name} stored screenshot`}/></a><p className="pm-source-note">{detail.screenshot.evidence}. File modified {when(detail.screenshot.modifiedAt)}.</p></> : <div className="pm-empty">No stored screenshot for this surface. Open its documentation below where available.</div>}
      <p>{detail.summary}</p><dl><div><dt>Recorded status</dt><dd>{detail.status}</dd></div><div><dt>Last worked</dt><dd>{when(detail.lastWorked)}</dd></div><div><dt>Planning lane</dt><dd>{detail.lane ?? 'Not assigned'}</dd></div><div><dt>Your verdict</dt><dd>{detail.rating ? `${detail.rating.value} · ${when(detail.rating.at)}` : 'Unrated'}</dd></div></dl>
      <div className="pm-rating"><label>Feedback in your words<textarea value={note} onChange={e=>setNote(e.target.value)} maxLength={4000} placeholder="What works? What should change?" disabled={saving}/></label><div className="pm-rating-buttons">{(['good','ok','shit'] as const).map(value=><button key={value} disabled={saving} aria-pressed={detail.rating?.value === value} onClick={()=>void rate(value)}>{value === 'good' ? 'Good' : value === 'ok' ? 'OK' : 'Shit'}</button>)}</div><p className="pm-source-note">Choosing a rating saves your verdict and note. Automated checks never supply this rating.</p><p role="status">{saving ? 'Saving…' : saved}</p></div>
      <div className="pm-evidence"><h3>Feedback & round history</h3>{detail.feedback && link(detail.feedback)}{detail.rounds.map(link)}{!detail.feedback&&!detail.rounds.length&&<p>No feedback log or rounds linked yet.</p>}<h3>Linked work</h3>{detail.tasks.map(t=>link({...t,title:`${t.id} · ${t.title} · ${t.stage}${t.agent ? ` · ${t.agent}` : ''}`}))}{!detail.tasks.length&&<p>{data?.taskAvailability === 'available' ? 'No tasks explicitly linked to this surface.' : 'Task source unavailable.'}</p>}<h3>Component documents</h3>{detail.pages.filter(p=>p.id!==detail.feedback?.id&&!detail.rounds.some(r=>r.id===p.id)).map(link)}{!detail.pages.length&&<p>No component documents available.</p>}{detail.issues.map(issue=><p key={issue} className="pm-error">{issue}</p>)}</div>
    </section></div>}
  </section>;
}
