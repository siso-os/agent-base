import { useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { AgentFace } from '../src/lib/face'
import { type AgentStatus, type FaceDirection, type FaceFamily, type FaceFeatures } from '../../../packages/halo-face/identity'
import '../../../packages/halo-face/halo-face.js'
import '../../../packages/halo-face/agent-face.js'
import '../../../packages/halo-face/halo-face.css'
import '../../../packages/halo-face/agent-face.css'
import './face-study.css'
import { ColourStudies, StateStudies, FaceMixer, signature } from './face-mixer'
import { CrownEdition, LogoStudies, approvedMarkSource } from './face-round-two'

const STATES: AgentStatus[] = ['working','waiting','needs-shaan','blocked','done','offline']
const labels: Record<AgentStatus,string> = { working:'Working',waiting:'Waiting','needs-shaan':'Needs Shaan',blocked:'Blocked',done:'Done',offline:'Offline' }
const moods: Record<AgentStatus,string> = {working:'Eyes on the task. Small, deliberate glances.',waiting:'Attentive. A blink, a glance, a little curiosity.','needs-shaan':'Amber means your attention is needed.',blocked:'Steady red. Waiting for the blocker to clear.',done:'A short celebration, then a contented settle.',offline:'Eyes closed. Lights low. At rest.'}
type Old = { status(s: string):void; project(n?:string,h?:number):void; destroy():void }
function Original({size=104,status='waiting',hue=177}:{size?:number;status?:AgentStatus;hue?:number}) {
  const host=useRef<HTMLSpanElement>(null),ctl=useRef<Old|null>(null)
  useEffect(()=>{if(!host.current)return;const c=(window as any).HaloFace.agent(host.current,{name:'Original',size,status,hue});ctl.current=c;return()=>c.destroy()},[size])
  useEffect(()=>{ctl.current?.status(status)},[status]);useEffect(()=>{ctl.current?.project(undefined,hue)},[hue])
  return <span ref={host} style={{width:size,height:size,display:'inline-block'}}/>
}
const initial: FaceFeatures = {head:0,eyes:0,sides:0,top:0}
const directions = [
  {id:'prism' as const,name:'Prism',tag:'01 / THE EVOLUTION',body:'The original, with a deeper visor, a polished rim and two colours meeting in the light.',parts:initial},
  {id:'contour' as const,name:'Contour',tag:'02 / THE QUIETER ONE',body:'A softer ceramic body. A fine illuminated contour instead of a broad metal edge.',parts:{...initial,head:1,sides:4}},
  {id:'facet' as const,name:'Facet',tag:'03 / THE INSTRUMENT',body:'Cut corners, squared lenses and segmented highlights. More machine, less companion.',parts:{...initial,head:4,sides:1,top:1}},
]
function Pair({size=104,status='waiting',direction='prism',parts=initial,hue=177,other=234,paused=false}:{size?:number;status?:AgentStatus;direction?:FaceDirection;parts?:FaceFeatures;hue?:number;other?:number;paused?:boolean}) {
  return <div className="pair">{(['claude','codex'] as FaceFamily[]).map(f=><div key={f}><AgentFace name={f==='claude'?'Claude':'Codex'} family={f} status={status} direction={direction} features={f==='codex' && direction==='prism' && parts.head===0 ? {...parts,head:4,sides:1} : parts} hue={hue} secondHue={other} size={size} paused={paused}/><span className="family-label">{f}</span></div>)}</div>
}
function App(){
  const [state,setState]=useState<AgentStatus>('waiting'),[paused,setPaused]=useState(false),[chosen,setChosen]=useState<FaceDirection>('prism'),[story,setStory]=useState(false)
  useEffect(()=>{ (window as any).HaloFace.setReducedMotion(paused || matchMedia('(prefers-reduced-motion: reduce)').matches) },[paused])
  useEffect(()=>{if(!story || paused)return;const storyStates:AgentStatus[]=['waiting','working','needs-shaan','working','done','waiting','blocked','offline'];let i=0;setState(storyStates[0]);const t=setInterval(()=>{i=(i+1)%storyStates.length;setState(storyStates[i])},3600);return()=>clearInterval(t)},[story,paused])
  const marks=(window as any).FACE_MARKS as Record<string,string>|undefined
  const chooseState=(s:AgentStatus)=>{setStory(false);setState(s)}
  return <><header><a href="#top" className="wordmark"><span className="brand-dot"/>Agent Base <span>/ Face atelier</span></a><nav><a href="#crowns">Crown edition</a><a href="#colours">16 finishes</a><a href="#logos">Living logos</a><a href="#mixer">Mix a face</a><a href="#directions">Original studies</a></nav><div className="approved-marks" aria-label="Approved workspace marks">{marks && ['agent-base','siso-agency','halo'].map(m=><img src={approvedMarkSource(marks[m],paused)} key={m} alt={m} title={m} width="28" height="28"/>)}</div></header>
  <main id="top"><div className="intro"><div><p className="eyebrow">THE NEXT CHAPTER / CLAUDE & CODEX</p><h1>Good faces.<br/><em>More character.</em></h1><p className="intro-copy">The pair you liked. Now with a crown, sixteen colour fades,<br/>and three workspace marks cut from the same material.</p></div><div className="intro-aside"><span className="mini-label">KEPT FROM YOUR PICK</span><p>Rounded Claude.<br/>Angular Codex.</p><span className="quiet">Same glass. More ways to make it yours.</span></div></div>
  <div className="toolbar"><div className="states" aria-label="Preview state">{STATES.map(s=><button key={s} data-state-button={s} aria-pressed={state===s} onClick={()=>chooseState(s)}><i className={'dot '+s}/>{labels[s]}</button>)}</div><div className="motion-actions"><button className="motion-control" aria-pressed={story} onClick={()=>setStory(!story)}>{story?'Stop story':'Play state story'}</button><button className="motion-control" aria-pressed={paused} onClick={()=>setPaused(!paused)}>{paused?'Play motion':'Pause motion'}</button></div></div>
  <CrownEdition state={state} paused={paused}/><ColourStudies paused={paused}/><LogoStudies paused={paused}/>
  <section id="directions"><div className="section-heading"><h2>Three directions. One original.</h2><span>Same light. Same scale. Real animation.</span></div><div className="direction-grid"><article className="direction original"><p className="mini-label">00 / THE REFERENCE</p><div className="direction-stage"><Original status={state}/></div><h3>Original</h3><p>The machined face you preferred. Preserved here as the control.</p><div className="size-line">{[24,32,48].map(n=><div key={n}><Original status={state} size={n}/><small>{n} px</small></div>)}</div><div className="direction-foot">Original design · preserved</div></article>
  {directions.map(d=><article key={d.id} className={'direction '+(chosen===d.id?'selected':'')}><p className="mini-label">{d.tag}</p><div className="direction-stage"><Pair status={state} direction={d.id} parts={d.parts} paused={paused}/></div><h3>{d.name}</h3><p>{d.body}</p><div className="size-line">{[24,32,48].map(n=><div key={n}><AgentFace name="Claude" family="claude" direction={d.id} features={d.parts} status={state} hue={177} secondHue={234} size={n} paused={paused}/><AgentFace name="Codex" family="codex" direction={d.id} features={d.id==='prism'?{...d.parts,head:4,sides:1}:d.parts} status={state} hue={177} secondHue={234} size={n} paused={paused}/><small>{n} px</small></div>)}</div><button className="direction-foot" aria-pressed={chosen===d.id} onClick={()=>setChosen(d.id)}>{chosen===d.id?'Selected for close-up ↘':'Explore '+d.name+' ↗'}</button></article>)}</div></section>
  <div className="recommendation"><span className="recommend-badge">MY PICK · PRISM</span><p>The clearest continuation of the original. Rounded glass for Claude; a cut-corner visor for Codex. Rich enough close up, quiet enough in a sidebar.</p></div><section className="closeup" id="states"><div><p className="eyebrow">WATCH FOR FIVE SECONDS</p><h2>{chosen[0].toUpperCase()+chosen.slice(1)} in motion.</h2><p>{moods[state]}</p><p className="quiet">Change state above. The old gesture yields immediately.</p></div><Pair size={170} status={state} direction={chosen} parts={directions.find(d=>d.id===chosen)!.parts} paused={paused}/></section>
  <FaceMixer state={state} paused={paused}/><StateStudies paused={paused}/><section id="scale"><div className="section-heading"><h2>At home in the navigation.</h2><span>24 / 32 / 48 pixels</span></div><div className="nav-demos">{[24,32,48].map(n=><div className="nav-demo" key={n}><p className="mini-label">{n} PX / ACTUAL SIZE</p>{(['claude','codex'] as FaceFamily[]).map(f=><div className="agent-row" key={f}><AgentFace name={f} family={f} features={signature(f)} size={n} status={state} paused={paused} hue={177} secondHue={234}/><span><b>{f==='claude'?'Claude':'Codex'}</b><small>{labels[state]}</small></span><i className={'dot '+state}/></div>)}</div>)}</div></section>
  <div className="review-notes"><p><b>Kept:</b> the original silhouette, luminous lens eyes, dark glass and colour fades. The approved workspace marks stay available in the logo comparison.</p><p><b>Developed:</b> two clear agent signatures, sixteen two-tone palettes, a crown and fitted metal accessories, and motion that yields to state.</p><p><b>Design choice:</b> the hats behave like fitted hardware. They share the face’s rim, bevel and light; no separate cartoon material.</p><p><a href="http://127.0.0.1:8891/card/agent-faces-earlier-20261005/html">Earlier feature studies ↗</a> <a href="http://127.0.0.1:8891/card/agent-faces-20261005/html">Previous soft-glass direction ↗</a></p></div><footer>Agent faces / original language, evolved. <span>Isolated component preview · no live agents connected</span></footer></main></>
}
createRoot(document.getElementById('root')!).render(<App/> )
