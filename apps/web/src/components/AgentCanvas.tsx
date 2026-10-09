import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';
import { ArrowLeft, Grip, Home, LayoutList, Maximize2, Minus, Plus, RotateCcw, Search, SquareDashed } from 'lucide-react';
import { usePageVisible } from '../lib/poll';
import type { Agent, Page } from '../lib/agents';
import type { Research, ResearchSelection } from '../../../../services/node/src/research';
import { AgentFace, faceFor, projectHue } from '../lib/face';
import { CANVAS_STORAGE_KEY, canvasNodes, fitCanvas, readCanvasLayout, saveCanvasLayout, zoomCanvas, type CanvasCamera, type CanvasNode, type CanvasPoint } from '../lib/agent-canvas';
import { reportedTokens, researchFaceName, researchFaceStatus, researchFleetUsage, researchJobName, researchTokenLabel } from '../lib/research-display';
import { useLive } from '../lib/chatLive';
import './AgentCanvas.css';

export type AgentCanvasProps = {
  agents: Agent[]; research?: Research | null; researchError?: string | null;
  /** Already-read summaries only; this surface never mounts chat transports. Keys are stable Agent.key values. */
  chatPreviews?: Record<string, { text: string; at?: number }>;
  onOpenAgent: (agent: Agent) => void; onOpenResearch: (selection?: ResearchSelection) => void;
  onOpenPage?: (page: Page, agent: Agent) => void; onClose?: () => void; storageKey?: string;
};
const store = () => { try { return window.localStorage; } catch { return null; } };
const editable = (target: EventTarget | null) => target instanceof HTMLElement && !!target.closest('input,textarea,select,[contenteditable=true]');
const movement = (key: string, step: number): CanvasPoint | null => key === 'ArrowLeft' ? { x: -step, y: 0 } : key === 'ArrowRight' ? { x: step, y: 0 } : key === 'ArrowUp' ? { x: 0, y: -step } : key === 'ArrowDown' ? { x: 0, y: step } : null;

function CanvasChatPreview({ agentId, fallback }: { agentId: string; fallback?: { text: string; at?: number } }) {
  const preview = useLive(agentId)?.preview ?? fallback;
  return <div className="ab-canvas__preview"><small>Last read reply</small><p>{preview?.text || 'Open Agent Zero’s chat to see the conversation.'}</p>{preview?.at != null && <small>{new Date(preview.at).toLocaleTimeString()}</small>}</div>;
}

export function AgentCanvas({ agents, research, researchError, chatPreviews = {}, onOpenAgent, onOpenResearch, onOpenPage, onClose, storageKey = CANVAS_STORAGE_KEY }: AgentCanvasProps) {
  const pageVisible = usePageVisible();
  const [reducedMotion, setReducedMotion] = useState(() => window.matchMedia('(prefers-reduced-motion:reduce)').matches);
  useEffect(() => { const media = window.matchMedia('(prefers-reduced-motion:reduce)'); const changed = () => setReducedMotion(media.matches); media.addEventListener('change', changed); return () => media.removeEventListener('change', changed); }, []);
  const [saved] = useState(() => readCanvasLayout(store(), storageKey));
  const [positions, setPositions] = useState(saved.layout.positions), [camera, setCamera] = useState<CanvasCamera>(saved.layout.camera ?? { x: 24, y: 24, z: 1 });
  const [storageError, setStorageError] = useState(saved.error), [search, setSearch] = useState(''), [selected, setSelected] = useState<string | null>(null);
  const [mode, setMode] = useState<'map' | 'list'>(() => window.matchMedia('(max-width:640px)').matches ? 'list' : 'map');
  const [size, setSize] = useState({ w: 0, h: 0 }), [dragging, setDragging] = useState(false);
  const viewport = useRef<HTMLDivElement>(null), cameraNow = useRef(camera), positionsNow = useRef(positions), searchInput = useRef<HTMLInputElement>(null);
  cameraNow.current = camera; positionsNow.current = positions;
  const drag = useRef<{ pointer: number; x: number; y: number; camera: CanvasCamera; id?: string; at?: CanvasPoint } | null>(null);
  const ready = useRef(false), previousStorageKey = useRef(storageKey);
  const nodes = useMemo(() => canvasNodes(agents, research?.fleets.data ?? [], positions), [agents, research?.fleets.data, positions]);
  useEffect(() => {
    const fresh = nodes.filter(n => !positions[n.id]);
    if (!fresh.length) return;
    setPositions(old => ({ ...old, ...Object.fromEntries(fresh.map(n => [n.id, { x: n.x, y: n.y }])) }));
    for (const node of fresh) {
      const error = saveCanvasLayout(store(), { id: node.id, point: { x: node.x, y: node.y } }, storageKey);
      if (error) { setStorageError(error); break; }
    }
  }, [nodes, positions, storageKey]);
  const matches = nodes.filter(n => `${n.label} ${n.agent?.role ?? ''} ${n.agent?.title ?? ''} ${n.fleet?.jobs.map(researchJobName).join(' ') ?? ''} ${n.crew?.map(a=>a.name).join(' ') ?? ''}`.toLowerCase().includes(search.trim().toLowerCase()));
  const persistCamera = useCallback((next: CanvasCamera) => { setCamera(next); setStorageError(saveCanvasLayout(store(), { camera: next }, storageKey)); }, [storageKey]);
  useEffect(() => {
    if (previousStorageKey.current === storageKey) return;
    previousStorageKey.current = storageKey;
    const next = readCanvasLayout(store(), storageKey); setPositions(next.layout.positions); setCamera(next.layout.camera ?? { x: 24, y: 24, z: 1 }); setStorageError(next.error); setSelected(null);
  }, [storageKey]);
  useEffect(() => {
    const el = viewport.current; if (!el) return;
    const observer = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight })); observer.observe(el); return () => observer.disconnect();
  }, []);
  const focusNode = (node: CanvasNode) => {
    const z = Math.min(1, Math.max(.08,(size.w - 40)/node.w), Math.max(.08,(size.h - 40)/node.h));
    setSelected(node.id); setSearch(''); setMode('map');
    persistCamera({ z, x: (size.w - node.w*z)/2 - node.x*z, y: (size.h - node.h*z)/2 - node.y*z });
    viewport.current?.focus();
  };
  useEffect(() => {
    if (ready.current || !nodes.length || size.w <= 0 || size.h <= 0) return;
    ready.current = true;
    if (!saved.layout.camera) {
      const home = nodes.find(n => n.agent?.zero) ?? nodes[0];
      const z = Math.min(1,(size.w - 40)/home.w,(size.h - 40)/home.h);
      setCamera({ z, x: (size.w - home.w*z)/2 - home.x*z, y: (size.h - home.h*z)/2 - home.y*z });
    }
  }, [nodes, size]);
  useEffect(() => {
    if (!ready.current || drag.current) return;
    const timer = window.setTimeout(() => setStorageError(saveCanvasLayout(store(), { camera }, storageKey)), 250);
    return () => window.clearTimeout(timer);
  }, [camera, storageKey]);
  useEffect(() => {
    const el = viewport.current; if (!el) return;
    const wheel = (event: WheelEvent) => {
      if (mode !== 'map' || (event.target as HTMLElement).closest('[data-canvas-interactive]') && !event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      const r = el.getBoundingClientRect();
      setCamera(current => event.ctrlKey || event.metaKey ? zoomCanvas(current, current.z*Math.exp(-event.deltaY*.005), { x: event.clientX-r.left, y: event.clientY-r.top }) : { ...current, x: current.x-event.deltaX, y: current.y-event.deltaY });
    };
    el.addEventListener('wheel', wheel, { passive: false }); return () => el.removeEventListener('wheel', wheel);
  }, [mode]);
  const place = (id: string, at: CanvasPoint) => {
    const next = { x: Math.max(-1_000_000,Math.min(1_000_000,at.x)), y: Math.max(-1_000_000,Math.min(1_000_000,at.y)) };
    setPositions(old => ({ ...old, [id]: next })); setStorageError(saveCanvasLayout(store(), { id, point: next }, storageKey));
  };
  const begin = (event: ReactPointerEvent, node?: CanvasNode) => {
    if (mode !== 'map' || event.button !== 0 || !node && (event.target as HTMLElement).closest('[data-canvas-interactive]')) return;
    event.preventDefault(); event.stopPropagation(); event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { pointer: event.pointerId, x: event.clientX, y: event.clientY, camera: cameraNow.current, ...(node ? { id: node.id, at: { x: node.x, y: node.y } } : {}) };
    setDragging(true); if (node) setSelected(node.id);
  };
  const move = (event: ReactPointerEvent) => {
    const d = drag.current; if (!d || d.pointer !== event.pointerId) return;
    const x = event.clientX-d.x, y = event.clientY-d.y;
    if (d.id && d.at) setPositions(old => ({ ...old, [d.id!]: { x: Math.max(-1_000_000,Math.min(1_000_000,d.at!.x+x/d.camera.z)), y: Math.max(-1_000_000,Math.min(1_000_000,d.at!.y+y/d.camera.z)) } }));
    else setCamera({ ...d.camera, x: d.camera.x+x, y: d.camera.y+y });
  };
  const end = (event: ReactPointerEvent) => {
    const d = drag.current; if (!d || d.pointer !== event.pointerId) return;
    if (d.id) setStorageError(saveCanvasLayout(store(), { id: d.id, point: positionsNow.current[d.id] ?? d.at }, storageKey));
    else setStorageError(saveCanvasLayout(store(), { camera: cameraNow.current }, storageKey));
    drag.current = null; setDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };
  const onScreen = (n: CanvasNode) => mode === 'list' || n.x*camera.z+camera.x < size.w+100 && (n.x+n.w)*camera.z+camera.x > -100 && n.y*camera.z+camera.y < size.h+100 && (n.y+n.h)*camera.z+camera.y > -100;
  const paused = reducedMotion || !pageVisible || mode === 'map' && camera.z < .35;
  const openAgent = (agent: Agent) => onOpenAgent(agent);
  const renderNode = (node: CanvasNode) => <article key={node.id} className={`ab-canvas__card${mode === 'map' && camera.z < .35 ? ' is-overview' : ''}${node.agent?.zero ? ' is-zero' : ''}${node.fleet ? ' is-fleet' : ''}${selected === node.id ? ' is-selected' : ''}`} data-canvas-node={node.id}
    style={{ ...(mode === 'map' ? { left: node.x, top: node.y, width: node.w, height: node.h } : {}), '--canvas-hue': projectHue(node.agent?.project ?? node.fleet?.name ?? '') } as CSSProperties}>
    <header className="ab-canvas__cardhead" data-canvas-interactive>
      {node.agent ? <AgentFace paused={paused} {...faceFor(node.agent)} size={node.agent.zero ? 40 : 34} /> : <AgentFace paused={paused} name={`fleet:${node.id}`} project={node.fleet!.name} status={node.fleet!.jobs.some(j=>j.status==='running') ? 'working' : node.fleet!.finished ? 'done' : 'waiting'} size={34} family="codex" />}
      <div><small>{node.agent ? node.agent.role || node.agent.infrastructureRole || (node.agent.zero ? 'Coordinator' : node.agent.kind === 'owner' ? 'Owner' : 'Agent') : 'Research batch'}</small><h2>{node.label}</h2></div>
      {mode === 'map' && <button type="button" className="ab-canvas__grip" aria-label={`Move ${node.label}`} title="Drag to move; arrow keys move 20, Shift moves 100" onPointerDown={e=>begin(e,node)} onPointerMove={move} onPointerUp={end} onPointerCancel={end}
        onKeyDown={event => { const delta = movement(event.key,event.shiftKey ? 100 : 20); if (!delta) return; event.preventDefault(); event.stopPropagation(); setSelected(node.id); place(node.id,{ x: node.x+delta.x, y: node.y+delta.y }); }}><Grip size={16} aria-hidden /></button>}
    </header>
    <div className="ab-canvas__cardbody" data-canvas-interactive>
      {node.agent ? <>
        <div className="ab-canvas__state"><span>{node.agent.status === 'needs' ? 'Needs you' : node.agent.status}</span><span>{reportedTokens(node.agent.hud?.tokensIn) && reportedTokens(node.agent.hud?.tokensOut) ? `${(node.agent.hud.tokensIn+node.agent.hud.tokensOut).toLocaleString()} reported tokens` : 'Tokens unavailable'}</span></div>
        <p className="ab-canvas__step">{node.agent.title || 'Current step not reported'}</p>
        {node.agent.zero && <CanvasChatPreview agentId={node.agent.id} fallback={chatPreviews[node.agent.key]} />}
        {!!node.crew?.length && <div className="ab-canvas__crew" aria-label={`${node.label} workers`}>{node.crew.map(a=><button type="button" key={a.key} onClick={()=>openAgent(a)} title={a.title} aria-label={`Open ${a.label || a.name}`}><AgentFace paused={paused} {...faceFor(a)} size={22}/><span>{a.label || a.name}</span></button>)}</div>}
        <div className="ab-canvas__open"><button type="button" onClick={()=>openAgent(node.agent!)}>Open {node.agent.zero ? 'chat' : node.label}</button>{onOpenPage && !!node.agent.pages?.length && <button type="button" onClick={()=>onOpenPage(node.agent!.pages[0],node.agent!)} title={node.agent.pages[0].title}>Open page</button>}</div>
      </> : <>
        <div className="ab-canvas__state"><span>{node.fleet!.jobs.length} jobs</span><span>{researchFleetUsage(node.fleet!)}</span></div>
        <div className="ab-canvas__jobs">{node.fleet!.jobs.map(job=><button type="button" key={job.id} onClick={()=>onOpenResearch({ fleet: node.fleet!.name, job: job.id })} aria-label={`Open ${researchJobName(job)} research`}>
          <AgentFace paused={paused} name={researchFaceName(node.fleet!,job)} project={node.fleet!.name} status={researchFaceStatus(job.status)} family="codex" size={26}/><span><b>{researchJobName(job)}</b><small>{researchTokenLabel(job)} · {job.status}</small></span>
        </button>)}</div><div className="ab-canvas__open"><button type="button" onClick={()=>onOpenResearch({ fleet: node.fleet!.name })}>Open research batch</button></div>
      </>}
    </div>
  </article>;
  return <section className={`ab-canvas is-${mode}${dragging ? ' is-dragging' : ''}`} aria-label="Agent canvas" data-testid="agent-canvas">
    <header className="ab-canvas__toolbar"><div className="ab-canvas__title">{onClose && <button type="button" aria-label="Leave canvas" onClick={onClose}><ArrowLeft size={16} aria-hidden /></button>}<div><strong>Agent canvas</strong><small>{agents.length} agents · {research?.fleets.data?.length ?? 0} research batches</small></div></div>
      <div className="ab-canvas__controls"><button type="button" aria-label="Home canvas" title="Home · H" onClick={()=>{ const home=nodes.find(n=>n.agent?.zero)??nodes[0]; if(home) focusNode(home); }}><Home size={16} aria-hidden /></button><button type="button" aria-label="Fit canvas" title="Fit all · F" onClick={()=>{setMode('map');persistCamera(fitCanvas(nodes,size.w,size.h));}}><Maximize2 size={16} aria-hidden /></button>
        <button type="button" aria-label="Zoom out canvas" disabled={mode==='list' || camera.z <= .08} onClick={()=>persistCamera(zoomCanvas(camera,camera.z/1.2,{x:size.w/2,y:size.h/2}))}><Minus size={16} aria-hidden /></button><span className="ab-canvas__zoom">{mode==='list'?'List':`${Math.round(camera.z*100)}%`}</span><button type="button" aria-label="Zoom in canvas" disabled={mode==='list' || camera.z >= 1.8} onClick={()=>persistCamera(zoomCanvas(camera,camera.z*1.2,{x:size.w/2,y:size.h/2}))}><Plus size={16} aria-hidden /></button>
        <button type="button" aria-label="Reset canvas view" title="Reset view; keeps widget positions" onClick={()=>{setMode('map');persistCamera(fitCanvas(nodes,size.w,size.h));}}><RotateCcw size={16} aria-hidden /></button><button type="button" aria-label={mode==='map'?'Show canvas list':'Show canvas map'} onClick={()=>setMode(mode==='map'?'list':'map')}>{mode==='map'?<LayoutList size={16} aria-hidden/>:<SquareDashed size={16} aria-hidden/>}</button>
      </div>
    </header>
    <div className="ab-canvas__find"><label><Search size={14} aria-hidden/><input ref={searchInput} type="search" placeholder="Find an agent or research batch…" aria-label="Search canvas" value={search} onChange={e=>setSearch(e.target.value)}/></label><select aria-label="Jump to canvas widget" value={selected??''} onChange={e=>{const node=nodes.find(n=>n.id===e.target.value);if(node)focusNode(node);}}><option value="">Jump to…</option>{nodes.map(n=><option key={n.id} value={n.id}>{n.label}</option>)}</select></div>
    {(researchError || research?.fleets.error) && <p className="ab-canvas__notice" role="status">Research batches unavailable; retrying.</p>}
    {storageError && <p className="ab-canvas__notice" role="status">{storageError}</p>}
    {search.trim() && <div className="ab-canvas__matches" aria-label="Canvas search results">{matches.length ? matches.map(n=><button type="button" key={n.id} aria-label={`Locate ${n.label}`} onClick={()=>focusNode(n)}>{n.label}<small>{n.agent ? 'Agent' : 'Research batch'}</small></button>) : <p>No matching agents or research batches</p>}</div>}
    <div ref={viewport} className="ab-canvas__viewport" tabIndex={0} aria-label="Movable canvas" onPointerDown={e=>begin(e)} onPointerMove={move} onPointerUp={end} onPointerCancel={end}
      onKeyDown={event=>{
        if(editable(event.target) || event.target !== event.currentTarget)return;
        if(mode==='list'){if(event.key==='Escape'&&onClose){event.preventDefault();onClose();}return;}
        const delta=movement(event.key,event.shiftKey?100:40);if(delta){event.preventDefault();persistCamera({...camera,x:camera.x-delta.x,y:camera.y-delta.y});return;}
        if(event.key==='f'||event.key==='F'){event.preventDefault();persistCamera(fitCanvas(nodes,size.w,size.h));}
        if(event.key==='h'||event.key==='Home'){event.preventDefault();const home=nodes.find(n=>n.agent?.zero)??nodes[0];if(home)focusNode(home);}
        if(event.key==='+'||event.key==='='||event.key==='-'){event.preventDefault();persistCamera(zoomCanvas(camera,camera.z*(event.key==='-'?1/1.2:1.2),{x:size.w/2,y:size.h/2}));}
        if(event.key==='/' ){event.preventDefault();searchInput.current?.focus();}
        if(event.key==='Escape'&&onClose){event.preventDefault();onClose();}
      }}>
      {!nodes.length && <div className="ab-canvas__empty"><h2>No agents reported yet</h2><p>The canvas fills from the current roster and reported research batches.</p></div>}
      <div className="ab-canvas__world" style={mode==='map'?{transform:`translate(${camera.x}px,${camera.y}px) scale(${camera.z})`}:undefined}>{(mode==='list'&&search.trim()?matches:nodes).filter(onScreen).map(renderNode)}</div>
    </div>
    <footer className="ab-canvas__hint">{mode==='map'?'Drag empty space to pan · drag a grip to move · Ctrl/⌘ scroll to zoom · F fit · H home':'Every widget is readable here. Use Map to arrange it.'}</footer>
  </section>;
}
