import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';
import { ArrowLeft, ArrowRight, Home, Maximize2, Minus, Plus, X, Pin, PanelRight } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Agent, Org, Page } from '../lib/agents';
import { useStats, type WorkspaceStatus, completeLaunchDraft, draftLaunchId, requestWorkspace } from '../lib/agents';
import { every } from '../lib/poll';
import { canonName, isDone, useA0Tasks } from '../lib/a0-tasks';
import { useHubProject } from '../lib/hub';
import { AgentFace, accentRgb, faceFor } from '../lib/face';
import { minimapWidth } from '../lib/minimap';
import { ChatView, type People } from './ChatView';
import { AgentPanel } from './AgentPanel';
import { WorktreeSetupCard } from './WorktreeSetupCard';
import { AgentHoverCard } from './AgentHoverCard';
import { CodexWorkerPage } from './CodexWorkerPage';
import { TaskTree, taskFamily } from './panel/TaskTree';
import { Pair, Timeline, TimelinePage, type Moment } from './Timeline';
import { Hud } from './Hud';
import type { Point, SpaceLayout, SpacePin } from '../../../../services/node/src/spaces';
import './ProjectSpace.css';

type SpaceData = { project: string; agents: Agent[]; layout: SpaceLayout; pins: SpacePin[] };
type Frame = { id: string; a?: Agent; pin?: SpacePin; parent?: string; x: number; y: number; w: number; h: number };
type Camera = { x: number; y: number; z: number };
const agentKey = (a: Agent) => `agent:${a.key}`;
const clamp = (z: number) => Math.min(1.6, Math.max(.12, z));
const editable = (target: EventTarget | null) => target instanceof HTMLElement && !!target.closest('input,textarea,select,[contenteditable=true]');
async function request<T>(url: string, init?: RequestInit): Promise<T> { const r = await fetch(url, init); const d = await r.json(); if (!r.ok) throw Error(d.error ?? `Space unavailable (${r.status})`); return d; }
const body = (value: unknown) => ({ headers: { 'content-type': 'application/json' }, body: JSON.stringify(value) });

export function ProjectSpace({ project, focusId, people, org, onAppPage, onClose, onPage }: {
  project: string; focusId: string | null; people: People; org: Org | null; onAppPage: (page: 'stats' | 'orgchart' | 'tasks' | 'zero') => void; onClose: () => void; onPage: (p: Page) => void;
}) {
  const viewport = useRef<HTMLDivElement>(null), [size, setSize] = useState({ w: 1000, h: 700 });
  const [data, setData] = useState<SpaceData | null>(null), [error, setError] = useState<string | null>(null);
  const [layout, setLayout] = useState<SpaceLayout>({ positions: {}, collapsed: {} });
  const [focused, setFocused] = useState<string | null>(null), [panel, setPanel] = useState(true);
  const [camera, setCamera] = useState<Camera>({ x: 16, y: 16, z: 1 });
  const [add, setAdd] = useState<{ kind: 'agent' | 'pin'; at: Point } | null>(null);
  const [preparing, setPreparing] = useState<string | null>(null);
  const prepared = useCallback(() => setPreparing(null), []);
  const [empty, setEmpty] = useState<Point | null>(null), [timeline, setTimeline] = useState<Agent | null>(null);
  const pendingPlacement = useRef<{ name: string; at: Point } | null>(null), initialized = useRef(false);
  const dirty = useRef(new Map<string, number>()), saving = useRef(Promise.resolve());
  const { index } = useA0Tasks(), hub = useHubProject(project);
  const url = `/api/spaces/${encodeURIComponent(project)}`;
  const refresh = useCallback(async () => {
    try {
      const next = await request<SpaceData>(url); setData(next); setError(null);
      setLayout(old => ({ positions: { ...next.layout.positions, ...Object.fromEntries(Object.entries(old.positions).filter(([id]) => dirty.current.has(id))) }, collapsed: { ...next.layout.collapsed, ...Object.fromEntries(Object.entries(old.collapsed).filter(([id]) => dirty.current.has(id))) } }));
    } catch (e) { setError((e as Error).message); }
  }, [url]);
  useEffect(() => { let alive = true; const run = () => alive && void refresh(); const stop = every(run, 5000); return () => { alive = false; stop(); }; }, [refresh]);
  useEffect(() => {
    const el = viewport.current; if (!el) return;
    const observer = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight })); observer.observe(el); return () => observer.disconnect();
  }, []);
  const frameW = Math.min(1400, Math.max(580, size.w - 32)), frameH = Math.max(480, size.h - 32);
  const all = data?.agents ?? [];
  // Live agents are frames; finished ones (done or failed) fold behind one toggle, so the board isn't a wall of old work (5 Oct: 16 of 25 were finished).
  const [showDone, setShowDone] = useState(false);
  const finished = all.filter(a => (a.status === 'done' || a.status === 'failed') && !a.zero && a.kind !== 'owner');
  const members = showDone ? all : all.filter(a => !finished.includes(a));
  const owner = members.find(a => a.kind === 'owner' && !a.parentId) ?? members.find(a => a.zero) ?? members[0];
  const ownerStats = useStats(owner?.id ?? null, panel && camera.z >= .8 && !!owner && focused === agentKey(owner));
  const parentOf = (a: Agent) => members.find(p => p.id !== a.id && (a.parentId === p.id || a.owner === p.name || a.lead === p.name));
  const isResearch = (a: Agent) => /research|miner|scout/i.test(`${a.name} ${a.role ?? ''}`);
  const frames = useMemo(() => {
    const roots = members.filter(a => a.id !== owner?.id && !(parentOf(a) && isResearch(parentOf(a)!)));
    const ordered = owner ? [owner, ...roots.filter(a => !isResearch(a)), ...roots.filter(isResearch)] : [];
    const all: Frame[] = []; let left = 0, right = 0;
    for (const a of ordered) {
      const id = agentKey(a), isOwner = a.id === owner?.id;
      const at = layout.positions[id] ?? { x: isOwner ? 0 : isResearch(a) ? -(++left) * 1500 : (++right) * 1500, y: 0 };
      all.push({ id, a, ...at, w: frameW, h: frameH });
      if (!layout.collapsed[id]) members.filter(child => parentOf(child)?.id === a.id && isResearch(a)).forEach((child, i) => {
        const cid = agentKey(child); all.push({ id: cid, a: child, parent: id, ...(layout.positions[cid] ?? { x: at.x + i * 1500, y: at.y + 900 }), w: frameW, h: frameH });
      });
    }
    let nextPinX = Math.max(-1550, ...Object.entries(layout.positions).filter(([id]) => id.startsWith('pin:')).map(([,p]) => p.x)) + 900;
    for (const pin of data?.pins ?? []) { const id = `pin:${pin.id}`, saved = layout.positions[id], at = saved ?? { x: nextPinX, y: -430 }; if (!saved) nextPinX += 900; all.push({ id, pin, ...at, w: 370, h: 330 }); }
    return all;
  }, [data, layout, frameW, frameH]);
  const agentFrames = frames.filter(f => f.a), homeId = owner ? agentKey(owner) : null;
  const focus = useCallback((id: string, fit = false) => {
    const frame = frames.find(f => f.id === id); if (!frame) return;
    const z = fit ? Math.min(1, (size.w - 32) / frame.w, (size.h - 32) / frame.h) : 1;
    setFocused(id); setEmpty(null); setCamera({ z, x: (size.w - frame.w * z) / 2 - frame.x * z, y: (size.h - frame.h * z) / 2 - frame.y * z });
  }, [frames, size]);
  const fitAll = () => {
    if (!frames.length) return;
    const minX = Math.min(...frames.map(f => f.x)), minY = Math.min(...frames.map(f => f.y));
    const w = Math.max(...frames.map(f => f.x + f.w)) - minX, h = Math.max(...frames.map(f => f.y + f.h)) - minY;
    const z = clamp(Math.min((size.w - 80) / w, (size.h - 80) / h));
    setCamera({ z, x: (size.w - w * z) / 2 - minX * z, y: (size.h - h * z) / 2 - minY * z }); setEmpty(null);
  };
  const save = (patch: Partial<SpaceLayout>, id: string) => {
    const version = (dirty.current.get(id) ?? 0) + 1; dirty.current.set(id, version);
    const operation = saving.current.catch(() => {}).then(async () => {
      await request(url + '/layout', { method: 'PUT', ...body(patch) }); if (dirty.current.get(id) === version) dirty.current.delete(id); setError(null);
    });
    saving.current = operation; void operation.catch(e => setError(`Layout not saved: ${(e as Error).message}`));
  };
  const place = (id: string, at: Point) => { setLayout(old => ({ ...old, positions: { ...old.positions, [id]: at } })); save({ positions: { [id]: at } }, id); };
  useEffect(() => {
    // Freeze each pin's initial place so a newly sorted filename cannot displace shared context.
    for (const f of frames) if (f.pin && !layout.positions[f.id]) place(f.id, { x: f.x, y: f.y });
  }, [frames, layout.positions]);
  useEffect(() => {
    if (!initialized.current && homeId && size.w > 0) { initialized.current = true; focus(homeId); }
  }, [homeId, focus, size]);
  const previousSize = useRef(size);
  useEffect(() => { if (previousSize.current.w !== size.w || previousSize.current.h !== size.h) { previousSize.current = size; if (focused) focus(focused, camera.z < .8); } }, [size, focus, focused, camera.z]);
  const lastExternal = useRef<string | null>(null);
  useEffect(() => {
    if (focusId && focusId !== lastExternal.current) { const f = frames.find(f => f.a?.id === focusId); if (f) { lastExternal.current = focusId; focus(f.id); } }
  }, [focusId, frames, focus]);
  useEffect(() => {
    const pending = pendingPlacement.current; if (!pending) return;
    const a = members.find(a => canonName(a.name) === canonName(pending.name));
    if (a) { pendingPlacement.current = null; place(agentKey(a), pending.at); }
  }, [members]);
  const jump = (delta: number) => { const i = agentFrames.findIndex(f => f.id === focused); const f = agentFrames[(Math.max(0, i) + delta + agentFrames.length) % agentFrames.length]; if (f) focus(f.id); };
  const cameraNow = useRef(camera); cameraNow.current = camera;
  const zoom = (value: number, client?: Point) => {
    const rect = viewport.current?.getBoundingClientRect();
    const p = client && rect ? { x: client.x - rect.left, y: client.y - rect.top } : { x: size.w / 2, y: size.h / 2 };
    setCamera(c => { const z = clamp(value); return { z, x: p.x - (p.x - c.x) * z / c.z, y: p.y - (p.y - c.y) * z / c.z }; }); setEmpty(null);
  };
  useEffect(() => {
    const el = viewport.current; if (!el) return;
    const wheel = (e: WheelEvent) => {
      if (e.metaKey || e.ctrlKey) { e.preventDefault(); zoom(cameraNow.current.z * Math.exp(-e.deltaY * .01), { x: e.clientX, y: e.clientY }); }
      else if (!(e.target as HTMLElement).closest('[data-space-interactive]')) { e.preventDefault(); setCamera(c => ({ ...c, x: c.x - e.deltaX, y: c.y - e.deltaY })); setEmpty(null); }
    };
    el.addEventListener('wheel', wheel, { passive: false }); return () => el.removeEventListener('wheel', wheel);
  }, [size]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (editable(e.target) || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === '0' && homeId) { e.preventDefault(); focus(homeId); }
      else if (e.key.toLowerCase() === 'f') { e.preventDefault(); fitAll(); }
      else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { e.preventDefault(); jump(e.key === 'ArrowRight' ? 1 : -1); }
      else if (e.key === 'Escape') { if (add) setAdd(null); else if (timeline) setTimeline(null); else setEmpty(null); }
    };
    window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key);
  });
  const gesture = useRef<{ id?: string; start: Point; original: Point; moved: boolean } | null>(null);
  const touches = useRef(new Map<number, Point>()), pinch = useRef<{ distance: number; camera: Camera; center: Point } | null>(null);
  const pointerDown = (e: ReactPointerEvent, id?: string) => {
    if (e.button !== 0 || (!id && (e.target as HTMLElement).closest('[data-space-frame]'))) return;
    if (id && (e.target as HTMLElement).closest('button,a,input')) return;
    e.preventDefault(); viewport.current?.setPointerCapture(e.pointerId);
    touches.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (touches.current.size === 2) {
      const [a, b] = [...touches.current.values()], rect = viewport.current!.getBoundingClientRect();
      pinch.current = { distance: Math.hypot(a.x - b.x, a.y - b.y), camera, center: { x: (a.x + b.x) / 2 - rect.left, y: (a.y + b.y) / 2 - rect.top } }; gesture.current = null; return;
    }
    const frame = frames.find(f => f.id === id);
    gesture.current = { id, start: { x: e.clientX, y: e.clientY }, original: frame ? { x: frame.x, y: frame.y } : { x: camera.x, y: camera.y }, moved: false };
  };
  const pointerMove = (e: ReactPointerEvent) => {
    if (touches.current.has(e.pointerId)) touches.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch.current && touches.current.size === 2) {
      const [a, b] = [...touches.current.values()], p = pinch.current, z = clamp(p.camera.z * Math.hypot(a.x - b.x, a.y - b.y) / Math.max(1, p.distance)), rect = viewport.current!.getBoundingClientRect();
      setCamera({ z, x: (a.x + b.x) / 2 - rect.left - (p.center.x - p.camera.x) * z / p.camera.z, y: (a.y + b.y) / 2 - rect.top - (p.center.y - p.camera.y) * z / p.camera.z }); return;
    }
    const g = gesture.current; if (!g) return;
    const dx = e.clientX - g.start.x, dy = e.clientY - g.start.y;
    if (Math.hypot(dx, dy) > 4) g.moved = true;
    if (g.id) { dirty.current.set(g.id, (dirty.current.get(g.id) ?? 0) + 1); setLayout(old => ({ ...old, positions: { ...old.positions, [g.id!]: { x: g.original.x + dx / camera.z, y: g.original.y + dy / camera.z } } })); }
    else setCamera(c => ({ ...c, x: g.original.x + dx, y: g.original.y + dy }));
  };
  const pointerUp = (e: ReactPointerEvent) => {
    touches.current.delete(e.pointerId); if (pinch.current) { pinch.current = null; gesture.current = null; return; }
    const g = gesture.current; gesture.current = null; if (!g) return;
    if (g.id && g.moved) place(g.id, layout.positions[g.id]);
    else if (!g.id && !g.moved) { const r = viewport.current!.getBoundingClientRect(); setEmpty({ x: (e.clientX - r.left - camera.x) / camera.z, y: (e.clientY - r.top - camera.y) / camera.z }); }
  };
  const visible = (f: Frame) => f.x * camera.z + camera.x < size.w && (f.x + f.w) * camera.z + camera.x > 0 && f.y * camera.z + camera.y < size.h && (f.y + f.h) * camera.z + camera.y > 0;
  // Reserve one of three slots for the focused AgentPanel's drill-in ChatView. Plain App chats unmount in Space.
  const live = camera.z >= .8 ? agentFrames.filter(visible).sort((a, b) => Number(b.id === focused) - Number(a.id === focused) || Math.abs(a.x - (frames.find(f => f.id === focused)?.x ?? 0)) - Math.abs(b.x - (frames.find(f => f.id === focused)?.x ?? 0))).slice(0, 2).map(f => f.id) : [];
  const point = empty ?? { x: (size.w / 2 - camera.x) / camera.z, y: (size.h / 2 - camera.y) / camera.z };
  const toggleChildren = (id: string) => { const value = !layout.collapsed[id]; setLayout(old => ({ ...old, collapsed: { ...old.collapsed, [id]: value } })); save({ collapsed: { [id]: value } }, id); };
  const dropped = async (files: FileList, text: string) => {
    const file = files[0]; let markdown = text, kind: SpacePin['kind'] = /^https?:\/\//.test(text) ? 'link' : 'note';
    if (file?.type.startsWith('image/')) {
      if (file.size > 2_000_000) { setError('Use an image under 2 MB or pin its link.'); return; }
      const src = await new Promise<string>((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(String(r.result)); r.onerror = reject; r.readAsDataURL(file); }); markdown = `![${file.name}](${src})`; kind = 'image';
    } else if (file) markdown = await file.text();
    if (!markdown) return;
    try { const result = await request<{ id: string }>(url + '/pins', { method: 'POST', ...body({ title: file?.name ?? (kind === 'link' ? text : 'Saved note'), kind, markdown }) }); place(`pin:${result.id}`, point); await refresh(); } catch (e) { setError((e as Error).message); }
  };
  return <section className="ab-space" aria-label={`${project} space`} data-testid="project-space" data-ab-comp="space" data-zoom={camera.z} data-focused={focused}>
    <header className="ab-space__toolbar"><div><Pin size={16}/><strong>{hub?.name ?? project}</strong><span>{members.length - (showDone ? finished.length : 0)} live · {data?.pins.length ?? 0} pins</span>{finished.length > 0 && <button type="button" className="ab-space__done" aria-pressed={showDone} onClick={() => setShowDone(v => !v)}>{showDone ? 'Hide' : 'Show'} {finished.length} finished</button>}</div><nav aria-label="Space controls">
      <button onClick={() => homeId && focus(homeId)} title="Home · 0"><Home size={15}/>Home</button><button onClick={fitAll} title="Fit all · F"><Maximize2 size={15}/>Fit all</button>
      <button aria-label="Zoom out" onClick={() => zoom(camera.z * .8)}><Minus size={15}/></button><button className="ab-space__percent" onClick={() => focused && focus(focused)} aria-label="Reset zoom">{Math.round(camera.z * 100)}%</button><button aria-label="Zoom in" onClick={() => zoom(camera.z / .8)}><Plus size={15}/></button>
      <button onClick={() => setAdd({ kind: 'pin', at: point })}>+ Pin</button><button onClick={() => setAdd({ kind: 'agent', at: point })}>+ Agent</button><button aria-label="Close Space" onClick={onClose}><X size={17}/></button>
    </nav></header>
    {error && <p role="status" className="ab-space__error">{error}<button onClick={() => void refresh()}>Retry</button></p>}
    <div className="ab-space__viewport" ref={viewport} tabIndex={0} onPointerDown={e => pointerDown(e)} onPointerMove={pointerMove} onPointerUp={pointerUp} onPointerCancel={() => { gesture.current = null; touches.current.clear(); pinch.current = null; }} onDragOver={e => { if (!(e.target as HTMLElement).closest('[data-space-interactive]')) e.preventDefault(); }} onDrop={e => { if (!(e.target as HTMLElement).closest('[data-space-interactive]')) { e.preventDefault(); void dropped(e.dataTransfer.files, e.dataTransfer.getData('text/plain')); } }} onPaste={e => { if (!editable(e.target)) { e.preventDefault(); void dropped(e.clipboardData.files, e.clipboardData.getData('text/plain')); } }}>
      {!data && <p className="ab-space__loading">Opening the project's space…</p>}
      {data && !members.length && <p className="ab-space__loading">No agents in this project yet. Add an agent or pin to start its space.</p>}
      <div className="ab-space__world" style={{ transform: `translate(${camera.x}px,${camera.y}px) scale(${camera.z})` }}>
        <svg className="ab-space__connections" aria-hidden>{frames.filter(f => f.parent).map(f => { const p = frames.find(p => p.id === f.parent)!; const dot = camera.z < .35; const px = p.x + (dot ? 65 / camera.z : p.w / 2), py = p.y + (dot ? 95 / camera.z : p.h), cx = f.x + (dot ? 65 / camera.z : f.w / 2); return <path key={f.id} style={{ strokeWidth: 1.5 / camera.z }} d={`M ${px} ${py} V ${f.y - 40} H ${cx} V ${f.y}`}/>; })}</svg>
        {frames.map(f => {
          const mode = camera.z < .35 ? 'dot' : camera.z < .8 || f.a && !live.includes(f.id) ? 'card' : 'live';
          const a = f.a, children = a ? members.filter(c => parentOf(c)?.id === a.id && isResearch(a)) : [];
          return <article key={f.id} data-space-frame={f.id} data-agent={a?.id} data-mode={mode} className={`ab-space__frame is-${mode}${f.id === focused ? ' is-focused' : ''}${f.pin ? ' is-pin' : ''}`} style={{ left: f.x, top: f.y, width: mode === 'card' ? Math.min(f.w, 420 / camera.z) : f.w, height: mode === 'card' ? Math.min(f.h, 410 / camera.z) : f.h, '--space-accent': accentRgb(a?.project) ?? '34 211 238' } as CSSProperties} onDoubleClick={e => { if (!editable(e.target)) focus(f.id, true); }}>
            {mode === 'dot' ? <button className="ab-space__dot" style={{ transform: `scale(${1 / camera.z})`, width: f.pin ? Math.min(170, 900 * camera.z - 24) : 170 }} onClick={() => focus(f.id)}>{a ? <AgentFace {...faceFor(a)} size={24}/> : <Pin size={20}/>}<b>{a?.name ?? f.pin?.title}</b>{children.length > 0 && <small>{children.length} children</small>}</button> : <>
            <header className="ab-space__framehead" onPointerDown={e => { e.stopPropagation(); pointerDown(e, f.id); }}>
              <span className="ab-space__grip" title="Drag frame" aria-label="Drag frame">⠿</span>
              <button onClick={() => focus(f.id)}>{a ? <AgentFace {...faceFor(a)} size={24}/> : <Pin size={16}/>}<strong>{a?.name ?? f.pin?.title}</strong><small>{a ? a.id === owner?.id ? 'Owner · home' : a.role ?? (isResearch(a) ? 'Research base' : 'Builder') : f.pin?.by}</small></button>
              {children.length > 0 && <button aria-label={`${layout.collapsed[f.id] ? 'Expand' : 'Fold'} ${a?.name} children`} aria-expanded={!layout.collapsed[f.id]} onClick={() => toggleChildren(f.id)}>{layout.collapsed[f.id] ? '▸' : '▾'} {children.length} children</button>}
              {a && mode === 'live' && f.id === focused && <button aria-label="Space side panel" aria-pressed={panel} onClick={() => setPanel(!panel)}><PanelRight size={16}/></button>}
            </header>
            {f.pin ? <div className="ab-space__pinbody siso-md" data-space-interactive><small>{f.pin.kind} · {f.pin.by} · {new Date(f.pin.at).toLocaleDateString()}</small>{f.pin.error && <p role="status">{f.pin.error}</p>}<ReactMarkdown components={{ a: ({ href, children }) => <a href={href} onClick={e => { if (href) { e.preventDefault(); onPage({ url: new URL(href, location.origin).href, title: f.pin!.title }); } }}>{children}</a> }} remarkPlugins={[remarkGfm]} urlTransform={url => /^(https?:|data:image\/(png|jpeg|webp|gif);base64,|\/|#)/i.test(url) ? url : ''}>{f.pin.markdown}</ReactMarkdown></div> : a && mode === 'card' ? <CompactAgent a={a} tasks={index?.tasks ?? []} zoom={camera.z} onFocus={() => focus(f.id)}/> : a && <div className="ab-space__live" data-space-interactive>
              <div className="ab-space__chat">{a.codexWorker ? <CodexWorkerPage agent={a}/> : a.chat ? <ChatView agentId={a.id} active={f.id === focused} people={people} accent={accentRgb(a.project)} hud={<Hud a={a} crew={members.filter(c => parentOf(c)?.id === a.id)} onOpenCrew={c => focus(agentKey(c))} variant="rim"/>}/> : <CompactAgent a={a} tasks={index?.tasks ?? []} zoom={1} onFocus={() => focus(f.id)}/>}</div>
              {panel && f.id === focused && (a.id === owner?.id ? <AgentPanel a={a} agents={members} org={org} stats={ownerStats} people={people} focus={null} onOpenAgent={a => focus(agentKey(a))} onStatsPage={() => onAppPage('stats')} onOrgChart={() => onAppPage('orgchart')} onPage={onPage} onBoard={() => onAppPage('tasks')} onStanding={() => onAppPage('zero')} onClose={() => setPanel(false)}/> : <div className="ab-space__work"><AgentWork a={a} tasks={index?.tasks ?? []}/>{isResearch(a) && <ul className="ab-space__library">{hub?.library?.map(doc => <li key={doc.path}><strong>{doc.title}</strong><small>{doc.count} {doc.unit} · {doc.by}</small></li>)}</ul>}<Timeline a={a} onPage={onPage} onIntent={() => {}} onSubagent={() => {}} onOpen={() => setTimeline(a)}/></div>)}
            </div>}
            </>}
          </article>;
        })}
      </div>
      {empty && <button className="ab-space__empty-add" aria-label="Add agent here" style={{ left: empty.x * camera.z + camera.x, top: empty.y * camera.z + camera.y }} onClick={() => setAdd({ kind: 'agent', at: empty })}><Plus size={20}/></button>}
    </div>
    <footer className="ab-space__navigator"><button aria-label="Previous frame" onClick={() => jump(-1)}><ArrowLeft size={16}/></button><div>{agentFrames.map((f, i) => <button key={f.id} aria-pressed={f.id === focused} onClick={() => focus(f.id)}><i style={{ width: minimapWidth(Math.abs(i - agentFrames.findIndex(f => f.id === focused))) }}/>{f.a?.name}</button>)}</div><button aria-label="Next frame" onClick={() => jump(1)}><ArrowRight size={16}/></button><small>Pan the space · ⌘ scroll to zoom · 0 home · F fit</small></footer>
    {add && <SpaceAdd key={add.kind} kind={add.kind} at={add.at} project={project} url={url} onClose={() => setAdd(null)} onPin={async id => { place(`pin:${id}`, add.at); setAdd(null); await refresh(); }} onAgent={async launch => { pendingPlacement.current = { name: launch.name, at: add.at }; if (launch.phase !== 'active') setPreparing(launch.workspaceId); setAdd(null); await refresh(); }}/>} 
    {preparing && <div className="ab-space__preparing"><WorktreeSetupCard id={preparing} onActive={prepared} onClose={() => setPreparing(null)}/></div>}
    {timeline && <div className="ab-space__modal"><div className="ab-space__timeline" role="dialog" aria-label={`${timeline.name} achievements`}><button onClick={() => setTimeline(null)} aria-label="Close achievements"><X size={18}/></button><TimelinePage a={timeline} onIntent={() => {}} onSubagent={() => {}} onPage={onPage}/></div></div>}
  </section>;
}

import type { TaskSummary } from './widgets/TasksWidget';
function tasksFor(a: Agent, tasks: TaskSummary[]) { const direct = tasks.filter(t => canonName(t.agent ?? t.owner ?? '') === canonName(a.name)); const ids = new Set(direct.flatMap(t => taskFamily(t, tasks)).map(t => t.id)); return tasks.filter(t => ids.has(t.id)); }
function terminalTasks(tasks: TaskSummary[]) { const parents = new Set(tasks.map(t => t.parent)); return tasks.filter(t => !parents.has(t.id) && t.stage !== 'dropped'); }
function AgentWork({ a, tasks }: { a: Agent; tasks: TaskSummary[] }) {
  const assigned = tasksFor(a, tasks), leaves = terminalTasks(assigned), ids = new Set(assigned.map(t => t.id));
  return <section className="ab-space__tasks"><h3>Tasks <small>{leaves.filter(isDone).length}/{leaves.length}</small></h3>{assigned.filter(t => !t.parent || !ids.has(t.parent)).map(t => <div key={t.id} className="ab-space__task"><b>{isDone(t) ? '☑' : '○'} {t.short ?? t.title}</b><TaskTree task={t} all={tasks}/></div>)}{!assigned.length && <p>No assigned tasks.</p>}<h3>Achieved</h3>{assigned.filter(isDone).map(t => <p key={t.id}>☑ {t.short ?? t.title}</p>)}{!assigned.some(isDone) && <p>No landed tasks recorded yet.</p>}</section>;
}
function CompactAgent({ a, tasks, zoom, onFocus }: { a: Agent; tasks: TaskSummary[]; zoom: number; onFocus: () => void }) {
  const assigned = tasksFor(a, tasks), leaves = terminalTasks(assigned), [moment, setMoment] = useState<Moment | null>(null);
  useEffect(() => {
    let alive = true; const read = async () => { try { const r = await request<{ moments: Moment[] }>(`/api/timeline?agent=${encodeURIComponent(a.id)}`); if (alive) setMoment(r.moments.find(m => m.pair) ?? null); } catch { /* The card keeps observed agent state when the timeline is unavailable. */ } };
    const stop = every(() => void read(), 10000); return () => { alive = false; stop(); };
  }, [a.id]);
  return <div className="ab-space__compact" style={{ width: `${Math.min(1, zoom) * 100}%`, transform: `scale(${1 / Math.min(1, zoom)})` }} onClick={onFocus}>
    <AgentHoverCard preview agent={{ name: a.name, kind: a.zero ? 'zero' : a.kind ?? 'worker', project: a.project ?? '', owner: a.owner ?? undefined, role: a.role ?? undefined, accent: `rgb(${accentRgb(a.project)})`, harness: a.tool === 'codex' ? 'codex' : 'claude', model: a.hud?.model ?? a.workerSummary?.model ?? '', machine: a.machine, state: a.status === 'working' ? 'working' : a.status === 'done' ? 'done' : 'idle' }} details={<><p className="ab-space__step">{a.workerSummary?.message || a.role || a.title || 'No current step recorded'}</p><p>{leaves.filter(isDone).length}/{leaves.length} tasks landed</p>{moment && <><strong>{moment.title}</strong><Pair m={moment} small/></>}</>} extra={<button onClick={onFocus}>Open frame</button>}/>
  </div>;
}
function SpaceAdd({ kind, at, project, url, onClose, onPin, onAgent }: { kind: 'agent' | 'pin'; at: Point; project: string; url: string; onClose: () => void; onPin: (id: string) => Promise<void>; onAgent: (launch: WorkspaceStatus) => Promise<void> }) {
  const [name, setName] = useState(''), [text, setText] = useState(''), [pinKind, setPinKind] = useState<SpacePin['kind']>('note'), [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null);
  return <div className="ab-space__modal"><form className="ab-space__add" role="dialog" aria-label={kind === 'agent' ? 'Spawn agent' : 'Add pin'} data-world-x={at.x} data-world-y={at.y} onSubmit={async e => {
    e.preventDefault(); setBusy(true); setError(null);
    try {
      if (kind === 'pin') { const pin = await request<{ id: string }>(url + '/pins', { method: 'POST', ...body({ title: name, kind: pinKind, markdown: pinKind === 'image' ? `![${name}](${text})` : pinKind === 'doc' ? '' : text, ...(pinKind === 'doc' ? { path: text } : {}) }) }); await onPin(pin.id); }
      else {
        const draft = `space:${project}:${name}:${text}`, launch = await requestWorkspace('/api/agents/start', { name, project, repo: project, prompt: text, launchId: draftLaunchId(draft), workspace: { type: 'isolated' } });
        completeLaunchDraft(draft);
        // Provisioning can return before herdr lists the new agent; placement waits for the space poll.
        await onAgent(launch);
      }
    } catch (e) { setError((e as Error).message); setBusy(false); }
  }}><header><h2>{kind === 'agent' ? 'New agent' : 'Pin to this space'}</h2><button type="button" aria-label="Close sheet" onClick={onClose}><X size={18}/></button></header><label>{kind === 'agent' ? 'Name' : 'Title'}<input autoFocus required value={name} onChange={e => setName(e.target.value)}/></label>{kind === 'pin' && <label>Kind<select value={pinKind} onChange={e => setPinKind(e.target.value as SpacePin['kind'])}><option value="note">Note</option><option value="doc">Repo document</option><option value="image">Image link</option><option value="link">Link</option></select></label>}<label>{kind === 'agent' ? 'Brief' : pinKind === 'doc' ? 'Repo path (.md or .txt)' : pinKind === 'image' ? 'Image URL' : 'Markdown or link'}<textarea required value={text} onChange={e => setText(e.target.value)}/></label>{error && <p role="alert">{error}</p>}<button type="submit" disabled={busy}>{busy ? 'Saving…' : kind === 'agent' ? 'Spawn agent' : 'Save pin'}</button></form></div>;
}
