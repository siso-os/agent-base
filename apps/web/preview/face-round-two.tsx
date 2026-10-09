import { useState } from 'react'
import { AgentFace } from '../src/lib/face'
import { colourways, type AgentStatus, type FaceFamily } from '../../../packages/halo-face/identity'
import { WorkspaceMark, type WorkspaceBrand, type WorkspaceMarkLook } from '../../../packages/halo-face/WorkspaceMark'
import { signature } from './face-mixer'
import './face-round-two.css'

export function approvedMarkSource(src:string,paused:boolean) {
  if(!paused)return src
  return 'data:image/svg+xml;base64,'+btoa(atob(src.split(',')[1]).replace('<svg ','<svg class="paused" '))
}

export function CrownEdition({state,paused}:{state:AgentStatus;paused:boolean}) {
  const [crowned,setCrowned]=useState<FaceFamily>('claude'),[finish,setFinish]=useState(6)
  const c=colourways[finish]
  return <section id="crowns" className="crown-edition">
    <div className="crown-copy"><p className="eyebrow">ROUND 02 / THE CROWN EDITION</p><h2>A little more <br/><em>royalty.</em></h2><p>A polished crown, a jewel of light, and the same face underneath.</p><div className="crown-switch" aria-label="Give the crown to">{(['claude','codex'] as FaceFamily[]).map(f=><button key={f} data-crown-family={f} aria-pressed={crowned===f} onClick={()=>setCrowned(f)}>Crown {f==='claude'?'Claude':'Codex'}</button>)}</div><a className="crown-mix-link" href="#mixer">Make your own combination ↗</a></div>
    <div className="crown-portraits">{(['claude','codex'] as FaceFamily[]).map(f=><div className="crown-agent" key={f}><AgentFace name={f} family={f} features={{...signature(f),top:crowned===f?6:0}} size={190} hue={c.hue} secondHue={c.other} status={state} paused={paused} track interactive/><h3>{f==='claude'?'Claude':'Codex'}</h3><span>{crowned===f?'CROWN / POLISHED METAL':'ORBIT / ORIGINAL TOP'}</span><div className="crown-scale">{[24,32,48].map(n=><AgentFace key={n} name={f} family={f} features={{...signature(f),top:crowned===f?6:0}} size={n} hue={c.hue} secondHue={c.other} status={state} paused={paused}/>)}</div></div>)}</div>
    <div className="crown-finishes"><span>TRY A FINISH</span>{[6,11,7,10,0,14].map(i=><button key={i} aria-pressed={finish===i} data-crown-finish={i} onClick={()=>setFinish(i)}><i style={{background:`linear-gradient(120deg,hsl(${colourways[i].hue} 83% 63%),hsl(${colourways[i].other} 86% 66%))`}}/>{colourways[i].name}</button>)}</div>
  </section>
}
const brandList: {id:WorkspaceBrand;name:string;finish:string;number:string}[]=[
  {id:'agent-base',name:'Agent Base',finish:'Cobalt & ice',number:'01'},
  {id:'siso-agency',name:'SISO Agency',finish:'Copper & flame',number:'02'},
  {id:'halo',name:'HALO',finish:'Pearl & moonlight',number:'03'},
]
const looks: {id:WorkspaceMarkLook;name:string;description:string}[]=[
  {id:'prism',name:'Glass badge',description:'The face material, made into a workspace badge.'},
  {id:'orbit',name:'Orbit',description:'A quiet disc, with a ring of light passing around it.'},
  {id:'relief',name:'Metal relief',description:'The original shape, lifted off the background.'},
]
export function LogoStudies({paused}:{paused:boolean}) {
  const [look,setLook]=useState<WorkspaceMarkLook>('prism'),[compare,setCompare]=useState(false),[replay,setReplay]=useState(0)
  const originals=(window as any).FACE_MARKS as Record<string,string>|undefined
  return <section id="logos"><div className="section-heading"><div><p className="eyebrow">WORKSPACE MARKS / NEW MATERIAL STUDIES</p><h2>Same identity. New light.</h2></div><span>The original shapes, in the face family’s glass and metal.</span></div>
    <div className="logo-controls"><div className="logo-looks" aria-label="Logo finish">{looks.map(l=><button key={l.id} data-mark-look={l.id} aria-pressed={look===l.id} onClick={()=>setLook(l.id)}><WorkspaceMark brand="agent-base" size={32} look={l.id} paused/>{l.name}</button>)}</div><div className="logo-actions"><button className="subtle-button" aria-pressed={compare} onClick={()=>setCompare(!compare)}>{compare?'Show new marks':'Compare with originals'}</button><button className="subtle-button" onClick={()=>setReplay(replay+1)}>Replay light ↻</button></div></div>
    <p className="logo-direction-copy">{looks.find(l=>l.id===look)!.description} <span>Move over a mark, or click it.</span></p>
    <div className="logo-grid">{brandList.map(b=><article className={'logo-card brand-'+b.id} key={b.id}><div className="logo-card-heading"><span className="mini-label">{b.number} / {b.finish.toUpperCase()}</span><i/></div><div className={'logo-stage '+(compare?'is-compare':'')}>
      {compare&&originals&&<div className="mark-comparison"><img src={approvedMarkSource(originals[b.id],paused)} alt={b.name+' approved mark'} width="132" height="132"/><small>APPROVED</small></div>}
      <div className="mark-comparison"><WorkspaceMark brand={b.id} look={look} size={compare?132:198} paused={paused} interactive replay={replay}/>{compare&&<small>NEW FINISH</small>}</div>
    </div><h3>{b.name}</h3><p>{b.finish} · {look==='prism'?'glass badge':look==='orbit'?'orbital disc':'metal relief'}</p><div className="mark-sizes">{[24,32,48].map(n=><div key={n}><WorkspaceMark brand={b.id} look={look} size={n} paused={paused}/><span>{n}</span></div>)}</div></article>)}</div>
    <div className="logo-context"><p className="mini-label">IN THE WORKSPACE SWITCHER / 32 PX</p><div>{brandList.map(b=><button className={'workspace-example '+(b.id==='agent-base'?'active':'')} key={b.id} onClick={()=>document.querySelector('.brand-'+b.id)?.scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth',block:'center'})}><WorkspaceMark brand={b.id} look={look} size={32} paused={paused}/><span>{b.name}</span><span aria-hidden="true">⌄</span></button>)}</div></div>
    <p className="logo-verdict"><b>I’d use the glass badges in Agent Base.</b> Metal relief is the strongest standalone brand treatment. Orbit works when the mark has room to breathe.</p>
  </section>
}
