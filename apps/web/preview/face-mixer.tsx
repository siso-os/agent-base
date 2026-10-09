import React, { useState } from 'react'
import { AgentFace } from '../src/lib/face'
import { colourways, faceIdentity, featureNames, type AgentStatus, type FaceFamily, type FaceFeatures } from '../../../packages/halo-face/identity'

export const signature = (family: FaceFamily): FaceFeatures => family === 'claude' ? {head:0,eyes:0,sides:0,top:0} : {head:4,eyes:0,sides:1,top:0}
const families: FaceFamily[] = ['claude','codex']
const states: AgentStatus[] = ['working','waiting','needs-shaan','blocked','done','offline']
const stateNames = ['Working','Waiting','Needs Shaan','Blocked','Done','Offline']
const descriptions = ['Focused glances','A little curiosity','Amber · attention','Red · steady','Celebrates, then settles','Closed eyes · still']
const bankLabels = { eyes:'Eyes', sides:'Ears & side details', top:'Hats & head-tops', head:'Head shapes' }

export function ColourStudies({paused}:{paused:boolean}) {
  const [crown,setCrown]=useState(true)
  return <section id="colours"><div className="section-heading"><div><p className="eyebrow">THE FINISH COLLECTION</p><h2>Two signatures. Sixteen colour fades.</h2></div><button className="subtle-button" aria-pressed={crown} onClick={()=>setCrown(!crown)}>{crown?'Hide crowns':'Show crowns'}</button></div><div className="colour-grid">{colourways.map((c,i)=><article className={'colour-card '+(i>5?'new-finish':'')} key={c.name}><div className="palette-pair">{families.map(f=><AgentFace key={f} family={f} name={f} features={{...signature(f),top:crown&&f==='claude'?6:0}} size={70} hue={c.hue} secondHue={c.other} status="waiting" paused={paused}/>)}</div><p><span>{c.name}</span><i style={{background:`linear-gradient(120deg,hsl(${c.hue} 83% 65%),hsl(${c.other} 86% 66%))`}}/></p><small>{String(i+1).padStart(2,'0')} · {i>5?'NEW FINISH':'ORIGINAL FINISH'}</small></article>)}</div></section>
}
export function StateStudies({paused}:{paused:boolean}) {
  const [replay,setReplay]=useState(0)
  return <section id="all-states"><div className="section-heading"><h2>Six states. No guessing.</h2><button className="subtle-button" onClick={()=>setReplay(replay+1)}>Replay the done gesture ↻</button></div><div className="state-grid">{states.map((s,i)=><article key={s} className={'state-card state-'+s}><div className="state-card-title"><i className={'dot '+s}/><b>{stateNames[i]}</b></div><div className="palette-pair">{families.map(f=><StateFace key={f} family={f} state={s} replay={replay} paused={paused}/>)}</div><small>{descriptions[i]}</small></article>)}</div></section>
}
function StateFace({family,state,replay,paused}:{family:FaceFamily;state:AgentStatus;replay:number;paused:boolean}) {
  const [shown,setShown]=useState(state)
  React.useEffect(()=>{
    if (state!=='done' || !replay) return
    setShown('working');const timer=setTimeout(()=>setShown('done'),80);return()=>clearTimeout(timer)
  },[replay,state])
  return <AgentFace name={family} family={family} features={signature(family)} status={shown} size={62} hue={177} secondHue={234} paused={paused}/>
}
export function FaceMixer({state,paused}:{state:AgentStatus;paused:boolean}) {
  const [family,setFamily]=useState<FaceFamily>('claude'),[name,setName]=useState('CLAUDE-01'),[project,setProject]=useState('agent-base')
  const [parts,setParts]=useState<FaceFeatures>(()=>faceIdentity('CLAUDE-01','claude').features),[colour,setColour]=useState(0)
  const palette=colourways[colour]
  const colourProps=palette?{hue:palette.hue,secondHue:palette.other}:{project}
  const base={name,family,status:state,features:parts,...colourProps,paused}
  const applyName=(value:string)=>{setName(value);setParts(faceIdentity(value,family).features)}
  const swapFamily=(f:FaceFamily)=>{const n=`${f.toUpperCase()}-01`;setFamily(f);setName(n);setParts(faceIdentity(n,f).features)}
  const randomize=()=>{setParts(Object.fromEntries((Object.keys(parts) as (keyof FaceFeatures)[]).map(k=>[k,Math.floor(Math.random()*featureNames[k].length)])) as FaceFeatures);setColour(Math.floor(Math.random()*colourways.length))}
  return <section id="mixer"><div className="section-heading"><div><p className="eyebrow">PRISM / THE RECOMMENDED FAMILY</p><h2>Make it your agent.</h2></div><span>Sixteen finishes. Seven tops. Your own combination.</span></div><div className="mixer-layout"><div className="mixer-stage"><div className="family-toggle" aria-label="Agent family">{families.map(f=><button key={f} aria-pressed={family===f} onClick={()=>swapFamily(f)}>{f==='claude'?'Claude':'Codex'}</button>)}</div><div className="mixer-portrait"><AgentFace {...base} size={200} interactive track/></div><p className="mixer-caption"><i className={'dot '+state}/>{state.replace('-',' ')}<span>Move your pointer. Tap to greet.</span></p><div className="mixer-sizes">{[24,32,48].map(n=><div key={n}><AgentFace {...base} size={n}/><small>{n} px</small></div>)}</div><label className="field">Agent name<input value={name} aria-label="Agent name" onChange={e=>applyName(e.target.value)}/></label><label className="field">Project<select aria-label="Project" value={project} onChange={e=>setProject(e.target.value)}><option value="agent-base">Agent Base</option><option value="siso-agency">SISO Agency</option><option value="halo">HALO</option></select></label><div className="mixer-actions"><button className="primary-button" onClick={randomize}>Randomize look ↻</button><button className="subtle-button" onClick={()=>setParts(faceIdentity(name,family).features)}>Reset to name</button></div><p className="quiet">The name generates a stable face. Parts can be customised; changing the project keeps the same identity.</p></div><div className="banks"><div className="mixer-mobile-peek" aria-label="Current face"><AgentFace {...base} size={62}/><div><b>{name || 'Agent'}</b><small>{family} · {palette?.name ?? 'Project colour'}</small></div><button aria-label="Randomize current look" onClick={randomize}>↻</button></div><fieldset className="bank"><legend><span>01</span>Colour fades<button className="text-button" aria-pressed={colour===-1} onClick={()=>setColour(-1)}>Use project colour</button></legend><div className="bank-options">{colourways.map((c,i)=><button className="part-option" data-bank="colour" data-choice={i} key={c.name} aria-pressed={colour===i} onClick={()=>setColour(i)}><AgentFace {...base} size={54} hue={c.hue} secondHue={c.other} status="waiting"/><span>{c.name}</span><i className="part-swatch" style={{background:`linear-gradient(100deg,hsl(${c.hue} 83% 65%),hsl(${c.other} 86% 66%))`}}/></button>)}</div></fieldset>
  {(Object.keys(featureNames) as (keyof FaceFeatures)[]).map((axis,ai)=><fieldset className="bank" key={axis}><legend><span>0{ai+2}</span>{bankLabels[axis]}</legend><div className="bank-options">{featureNames[axis].map((label,i)=><button className="part-option" data-bank={axis} data-choice={i} key={label} aria-pressed={parts[axis]===i} onClick={()=>setParts({...parts,[axis]:i})}><AgentFace {...base} features={{...parts,[axis]:i}} size={54} status="waiting"/><span>{label}</span></button>)}</div></fieldset>)}</div></div></section>
}
