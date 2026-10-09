import type { IconGlyphProps, LivingIconDefinition } from './living-icon-types'
import './project-glyphs.css'

function MathsInnovations({ uid }: IconGlyphProps) {
  const ribbon = 'M60 60C49 43 42 34 34 38C17 46 26 79 40 79C49 79 54 67 60 60C70 43 77 35 85 40C100 50 92 79 79 79C71 79 66 69 60 60Z'
  return <g className="pg-maths">
    <path d="M29 34H91M29 87H91M33 30V91M87 30V91" stroke="var(--li-pale)" strokeWidth=".8" opacity=".12"/>
    <path d={ribbon} fill="none" stroke="#030911" strokeWidth="13" transform="translate(0 3)"/>
    <path d={ribbon} fill="none" stroke={`url(#${uid}-accent)`} strokeWidth="11" strokeLinecap="round"/>
    <path d={ribbon} fill="none" stroke={`url(#${uid}-metal)`} strokeWidth="6" opacity=".55"/>
    <path d="M29 48Q33 29 47 45L74 76Q86 88 92 66" fill="none" stroke={`url(#${uid}-bright)`} strokeWidth="1.6" strokeLinecap="round" opacity=".9"/>
    <path className="pg-maths-trace" d={ribbon} fill="none" stroke="var(--li-pale)" strokeWidth="2" pathLength="100" strokeDasharray="8 92" opacity="0"/>
    <g className="pg-maths-proof"><path d="m60 49 10 11-10 11-10-11Z" fill="#091626" stroke={`url(#${uid}-metal)`} strokeWidth="1.5"/><path d="m60 53 6 7-6 7-6-7Z" fill={`url(#${uid}-bright)`}/><path d="m60 53 6 7-6 7Z" fill="var(--li-b)" opacity=".6"/></g>
    <circle cx="33" cy="33" r="2.5" fill={`url(#${uid}-bright)`}/><circle cx="87" cy="87" r="2.5" fill={`url(#${uid}-bright)`}/>
  </g>
}

export const PROJECT_ICONS = {
  'maths-innovations': { label: 'Maths Innovations', description: 'An interwoven infinity ribbon with a crystalline proof at its centre.', motion: 'A point of light follows the ribbon once, then rests at the proof.', colorA: '#91c4ff', colorB: '#d8b36d', pale: '#f8efdb', Glyph: MathsInnovations },
} satisfies Record<string, LivingIconDefinition>
