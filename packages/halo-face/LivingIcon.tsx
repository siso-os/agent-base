import { useEffect, useId, useRef, useState, type CSSProperties } from 'react'
import { LIVING_ICONS, type LivingIconName } from './icon-catalog'
import './living-icon.css'

export type LivingIconProps = {
  name: LivingIconName
  size?: number
  variant?: 'tile' | 'glyph'
  /** External hover/focus state for a parent link or button. One gesture per entry. */
  active?: boolean
  paused?: boolean
  interactive?: boolean
  replay?: number
  /** Explicit comparison mode only; app navigation should leave this false. */
  demo?: boolean
  title?: string
  className?: string
}

/** Quiet by default. No frame loop; CSS gestures are gated by native visibility. */
export function LivingIcon({ name, size=32, variant='tile', active=false, paused=false, interactive=false, replay=0, demo=false, title, className='' }: LivingIconProps) {
  const uid='li-'+useId().replace(/[^a-zA-Z0-9_-]/g,''), host=useRef<HTMLSpanElement>(null)
  const [visible,setVisible]=useState(false), [reduced,setReduced]=useState(true), [hidden,setHidden]=useState(false)
  const [hovered,setHovered]=useState(false), [focused,setFocused]=useState(false), [burst,setBurst]=useState(false), [revision,setRevision]=useState(0)
  const lastReplay=useRef(replay), timer=useRef<ReturnType<typeof setTimeout>|undefined>(undefined)
  const moving=visible&&!reduced&&!hidden&&!paused
  const definition=LIVING_ICONS[name], Glyph=definition.Glyph
  useEffect(()=>{
    const el=host.current
    if(!el)return
    const media=matchMedia('(prefers-reduced-motion: reduce)')
    const sync=()=>{setReduced(media.matches);setHidden(document.hidden)}
    const observer=typeof IntersectionObserver==='undefined'?null:new IntersectionObserver(entries=>setVisible(entries[0]?.isIntersecting??false))
    sync();observer?.observe(el);if(!observer)setVisible(true)
    media.addEventListener('change',sync);document.addEventListener('visibilitychange',sync)
    return()=>{observer?.disconnect();media.removeEventListener('change',sync);document.removeEventListener('visibilitychange',sync);clearTimeout(timer.current)}
  },[])
  useEffect(()=>{
    const changed=lastReplay.current!==replay;lastReplay.current=replay
    if(!moving){clearTimeout(timer.current);setBurst(false);setHovered(false);setFocused(false);return}
    if(!changed)return
    setRevision(n=>n+1);setBurst(true);clearTimeout(timer.current)
    timer.current=setTimeout(()=>setBurst(false),1450)
  },[replay,moving])
  const trigger=()=>{
    if(!moving)return
    setRevision(n=>n+1);setBurst(true);clearTimeout(timer.current)
    timer.current=setTimeout(()=>setBurst(false),1450)
  }
  const style={width:size,height:size,'--li-a':definition.colorA,'--li-b':definition.colorB,'--li-pale':definition.pale} as CSSProperties
  const plate='M35 14H85Q91 14 96 21L103 30Q106 34 106 41V79Q106 86 101 92L93 101Q89 106 82 106H38Q31 106 26 101L18 93Q14 88 14 81V39Q14 32 19 26L27 18Q30 14 35 14Z'
  return <span ref={host} style={style} className={'li '+className} data-name={name} data-motion={moving?'on':'off'} data-active={moving&&(active||hovered||focused||burst||demo)?'true':'false'} data-demo={demo?'true':'false'} data-tier={size>48?'portrait':'nav'} data-variant={variant}
    role={interactive?'button':'img'} tabIndex={interactive?0:undefined} aria-label={title??definition.label+(interactive?' · replay animation':'')}
    onPointerEnter={interactive?()=>setHovered(true):undefined} onPointerLeave={()=>setHovered(false)} onFocus={interactive?()=>setFocused(true):undefined} onBlur={()=>setFocused(false)} onClick={interactive?trigger:undefined}
    onKeyDown={interactive?e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();if(!e.repeat)trigger()}}:undefined}>
    <svg viewBox="0 0 120 120" aria-hidden="true">
      <defs>
        <linearGradient id={uid+'-accent'} x1="0" y1="0" x2=".8" y2="1"><stop stopColor="var(--li-pale)"/><stop offset=".26" stopColor="var(--li-a)"/><stop offset=".67" stopColor="var(--li-b)"/><stop offset="1" stopColor="var(--li-a)"/></linearGradient>
        <linearGradient id={uid+'-metal'} x1="0" y1="0" x2=".8" y2="1"><stop stopColor="var(--li-pale)"/><stop offset=".23" stopColor="#a1b5c8"/><stop offset=".49" stopColor="#253b54"/><stop offset=".7" stopColor="var(--li-pale)"/><stop offset="1" stopColor="#324860"/></linearGradient>
        <linearGradient id={uid+'-glass'} x1="0" y1="0" x2=".8" y2="1"><stop stopColor="#314657"/><stop offset=".46" stopColor="#0e1c2a"/><stop offset="1" stopColor="#050a12"/></linearGradient>
        <linearGradient id={uid+'-bright'} x1="0" y1="0" x2=".6" y2="1"><stop stopColor="white"/><stop offset=".42" stopColor="var(--li-pale)"/><stop offset="1" stopColor="var(--li-a)"/></linearGradient>
        <linearGradient id={uid+'-rim'} x1="0" y1="0" x2=".85" y2="1"><stop stopColor="var(--li-pale)"/><stop offset=".18" stopColor="var(--li-a)"/><stop offset=".45" stopColor="#14263c"/><stop offset=".76" stopColor="var(--li-b)"/><stop offset="1" stopColor="var(--li-pale)"/></linearGradient>
        <linearGradient id={uid+'-reflection'} x1="0" y1="0" x2=".4" y2="1"><stop stopColor="white" stopOpacity=".18"/><stop offset="1" stopColor="white" stopOpacity="0"/></linearGradient>
        <radialGradient id={uid+'-glow'}><stop stopColor="var(--li-a)" stopOpacity=".42"/><stop offset="1" stopColor="var(--li-b)" stopOpacity="0"/></radialGradient>
        <clipPath id={uid+'-tile'}><path d={plate}/></clipPath>
      </defs>
      {variant==='tile'&&<g className="li-plate">
        <path d={plate} transform="translate(0 3)" fill="#02070d" stroke="#102035" strokeWidth="2"/>
        <path d={plate} fill={'url(#'+uid+'-rim)'} stroke="var(--li-pale)" strokeWidth=".65" strokeOpacity=".45"/>
        <path d={plate} transform="translate(60 60) scale(.88) translate(-60 -60)" fill={'url(#'+uid+'-glass)'} stroke="#020814" strokeWidth="1.4"/>
        <g clipPath={'url(#'+uid+'-tile)'}><ellipse cx="36" cy="84" rx="63" ry="46" fill={'url(#'+uid+'-glow)'} opacity=".45"/><path d="M21 28Q61 8 100 29V49Q65 34 20 55Z" fill={'url(#'+uid+'-reflection)'}/></g>
        <path className="li-edge" d={plate} transform="translate(60 60) scale(.94) translate(-60 -60)" fill="none" stroke="var(--li-pale)" strokeWidth=".9" opacity=".3" pathLength="100" strokeDasharray="15 85"/>
      </g>}
      <g transform={variant==='glyph'?'translate(60 60) scale(1.4) translate(-60 -60)':undefined}><g className="li-scene" key={name+':'+revision}><Glyph uid={uid}/></g></g>
    </svg>
  </span>
}
