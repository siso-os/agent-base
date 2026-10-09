import { useEffect, useId, useRef, useState, type CSSProperties } from 'react'
import { markGeometry } from './mark-geometry'
import './workspace-mark.css'

export type WorkspaceBrand = 'agent-base' | 'siso-agency' | 'halo'
export type WorkspaceMarkLook = 'prism' | 'orbit' | 'relief'
export type WorkspaceMarkProps = {
  brand: WorkspaceBrand
  look?: WorkspaceMarkLook
  size?: number
  paused?: boolean
  interactive?: boolean
  replay?: number
  className?: string
}
const brands = {
  'agent-base': { name:'Agent Base', a:'#619aff', b:'#60e8ff', pale:'#d8eeff', deep:'#183c89' },
  'siso-agency': { name:'SISO Agency', a:'#ff624a', b:'#ffc171', pale:'#ffe6c1', deep:'#822432' },
  halo: { name:'HALO', a:'#e4ebf4', b:'#b4b6e5', pale:'#ffffff', deep:'#484766' },
} as const

/** Approved logo geometry, with optional Prism material and restrained motion. */
export function WorkspaceMark({brand,look='prism',size=48,paused=false,interactive=false,replay=0,className=''}:WorkspaceMarkProps) {
  const uid='wm-'+useId().replace(/[^a-zA-Z0-9_-]/g,''), ref=useRef<HTMLSpanElement>(null)
  const [visible,setVisible]=useState(false),[reduced,setReduced]=useState(false),[hidden,setHidden]=useState(false)
  const [pulse,setPulse]=useState(false),[tap,setTap]=useState(0),lastTrigger=useRef('0:0')
  const moving=visible&&!paused&&!reduced&&!hidden, portrait=size>48
  const b=brands[brand], geometry=markGeometry[brand==='halo'?'halo':'lion']
  const relief=look==='relief', round=look==='orbit'
  const plate=round?'M60 13A47 47 0 1 1 59.99 13Z':brand==='agent-base'?'M35 15H85L105 35V85L85 105H35L15 85V35Z':'M39 15H81Q105 15 105 39V81Q105 105 81 105H39Q15 105 15 81V39Q15 15 39 15Z'
  const box=brand==='halo'?{x:relief?32:36,y:relief?20:25,width:relief?56:48,height:relief?78:66}:{x:relief?10:20,y:relief?10:20,width:relief?100:80,height:relief?100:80}
  useEffect(()=>{
    const el=ref.current
    if(!el)return
    const media=matchMedia('(prefers-reduced-motion: reduce)')
    const sync=()=>{setReduced(media.matches);setHidden(document.hidden)}
    const observer=typeof IntersectionObserver==='undefined'?null:new IntersectionObserver(entries=>setVisible(entries[0]?.isIntersecting??false))
    sync();observer?.observe(el);if(!observer)setVisible(true)
    media.addEventListener('change',sync);document.addEventListener('visibilitychange',sync)
    return()=>{observer?.disconnect();media.removeEventListener('change',sync);document.removeEventListener('visibilitychange',sync)}
  },[])
  useEffect(()=>{
    const trigger=replay+':'+tap, changed=lastTrigger.current!==trigger
    lastTrigger.current=trigger
    if(!moving){setPulse(false);ref.current?.style.setProperty('--mx','0');ref.current?.style.setProperty('--my','0');return}
    if(!changed)return
    setPulse(true)
    const timer=setTimeout(()=>setPulse(false),1350)
    return()=>clearTimeout(timer)
  },[replay,tap,moving])
  const mark=(attrs:Record<string,string|number>)=><use href={'#'+uid+'-mark'} {...box} {...attrs}/>
  const style={width:size,height:size,'--wa':b.a,'--wb':b.b,'--wp':b.pale,'--wd':b.deep} as CSSProperties
  const release=()=>{ref.current?.style.setProperty('--mx','0');ref.current?.style.setProperty('--my','0')}
  return <span ref={ref} className={'wm '+className} style={style} data-brand={brand} data-look={look} data-motion={moving?'on':'off'} data-tier={portrait?'portrait':'nav'} data-pulse={pulse?'on':'off'} role={interactive?'button':'img'} aria-label={b.name+(interactive?' · replay light':' animated mark')} tabIndex={interactive?0:undefined}
    onPointerMove={interactive?e=>{if(!moving||!portrait)return;const r=e.currentTarget.getBoundingClientRect();e.currentTarget.style.setProperty('--mx',String((e.clientX-r.left)/r.width*2-1));e.currentTarget.style.setProperty('--my',String((e.clientY-r.top)/r.height*2-1))}:undefined}
    onPointerLeave={release} onBlur={release} onClick={interactive?()=>setTap(tap+1):undefined} onKeyDown={interactive?e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();setTap(tap+1)}}:undefined}>
    <svg viewBox="0 0 120 120" aria-hidden="true">
      <defs>
        <symbol id={uid+'-mark'} viewBox={geometry.viewBox}><path d={geometry.path} fillRule="evenodd"/></symbol>
        <linearGradient id={uid+'-rim'} x1="0" y1="0" x2="1" y2="1"><stop stopColor="var(--wp)"/><stop offset=".2" stopColor="var(--wa)"/><stop offset=".49" stopColor="var(--wd)"/><stop offset=".76" stopColor="var(--wb)"/><stop offset="1" stopColor="var(--wp)"/></linearGradient>
        <linearGradient id={uid+'-metal'} x1="0" y1="0" x2=".75" y2="1"><stop stopColor="white" stopOpacity=".72"/><stop offset=".24" stopColor="white" stopOpacity="0"/><stop offset=".51" stopColor="#040712" stopOpacity=".6"/><stop offset=".78" stopColor="white" stopOpacity=".2"/><stop offset="1" stopColor="#02050c" stopOpacity=".65"/></linearGradient>
        <linearGradient id={uid+'-body'} x1="0" y1="0" x2=".65" y2="1"><stop stopColor="#263643"/><stop offset=".45" stopColor="#101b28"/><stop offset="1" stopColor="#04080e"/></linearGradient>
        <linearGradient id={uid+'-logo'} x1=".1" y1="0" x2=".8" y2="1"><stop stopColor="var(--wp)"/><stop offset=".29" stopColor="var(--wa)"/><stop offset=".52" stopColor="var(--wp)"/><stop offset=".74" stopColor="var(--wb)"/><stop offset="1" stopColor="var(--wd)"/></linearGradient>
        <linearGradient id={uid+'-reflection'} x1="0" y1="0" x2="0" y2="1"><stop stopColor="white" stopOpacity=".23"/><stop offset="1" stopColor="white" stopOpacity="0"/></linearGradient>
        <linearGradient id={uid+'-shine'}><stop stopColor="white" stopOpacity="0"/><stop offset=".45" stopColor="white" stopOpacity=".03"/><stop offset=".5" stopColor="white" stopOpacity=".87"/><stop offset=".56" stopColor="white" stopOpacity=".05"/><stop offset="1" stopColor="white" stopOpacity="0"/></linearGradient>
        <radialGradient id={uid+'-ambient'}><stop stopColor="var(--wa)" stopOpacity=".27"/><stop offset="1" stopColor="var(--wb)" stopOpacity="0"/></radialGradient>
        <mask id={uid+'-mask'} maskUnits="userSpaceOnUse" x="0" y="0" width="120" height="120">{mark({fill:'white'})}</mask>
        <clipPath id={uid+'-clip'}><path d={plate}/></clipPath>
      </defs>
      <ellipse className="wm-floor" cx="60" cy="112" rx="48" ry="7" fill={'url(#'+uid+'-ambient)'}/>
      <g className="wm-event"><g className="wm-tilt"><g className="wm-float">
        {round&&<ellipse className="wm-orbit-back" cx="60" cy="64" rx="55" ry="20" fill="none" stroke="var(--wa)" strokeWidth=".8" opacity=".3"/>}
        {!relief&&<>
          <path d={plate} transform="translate(0 3)" fill="#03060c" stroke="var(--wd)" strokeWidth="2"/>
          <path d={plate} fill={'url(#'+uid+'-rim)'} stroke="var(--wp)" strokeWidth=".7" strokeOpacity=".55"/>
          <path d={plate} fill={'url(#'+uid+'-metal)'}/>
          <path d={plate} transform="translate(60 60) scale(.88) translate(-60 -60)" fill={'url(#'+uid+'-body)'} stroke="var(--wa)" strokeWidth="1.2" strokeOpacity=".55"/>
          <g clipPath={'url(#'+uid+'-clip)'}>
            <ellipse className="wm-ambient" cx="34" cy="84" rx="70" ry="49" fill={'url(#'+uid+'-ambient)'}/>
            <path d="M21 32Q62 3 101 34V55Q61 39 21 60Z" fill={'url(#'+uid+'-reflection)'}/>
          </g>
          <path className="wm-edge" d={plate} transform="translate(60 60) scale(.95) translate(-60 -60)" fill="none" stroke="var(--wp)" strokeWidth=".9" strokeOpacity=".45" pathLength="100" strokeDasharray="19 81"/>
        </>}
        <g className="wm-glyph">
          <g transform={'translate(0 '+(relief?3.2:1.7)+')'}>{mark({fill:'var(--wd)'})}</g>
          {mark({fill:'url(#'+uid+'-logo)'})}
          <g mask={'url(#'+uid+'-mask)'}><path className="wm-polish" d="M-60 -30H-10L60 150H10Z" fill={'url(#'+uid+'-shine)'}/></g>
        </g>
        {round&&<g className="wm-orbit-front"><path d="M6 62C9 91 109 93 114 62" fill="none" stroke={'url(#'+uid+'-rim)'} strokeWidth="1.2"/><ellipse className="wm-trail" cx="60" cy="64" rx="55" ry="20" fill="none" stroke="var(--wp)" strokeWidth="2" pathLength="100" strokeDasharray="4 96" strokeLinecap="round"/></g>}
      </g></g></g>
    </svg>
  </span>
}
