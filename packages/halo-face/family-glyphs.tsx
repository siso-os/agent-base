import type { IconGlyphProps, LivingIconDefinition } from './living-icon-types'
import './family-glyphs.css'

/** SISO Family (Shaan, 10 Oct: "the SISO family should have his own logo"): a faceted home holding three figures, two
 * parents and a child, drawn on the same 120 grid and gradients as the navigation glyphs. Added beside the kit. */
function Family({ uid }: IconGlyphProps) {
  return <g className="fg-family">
    <path d="M60 22 96 50 92 56 88 53V92H32V53L28 56 24 50Z" fill={`url(#${uid}-metal)`}/>
    <path d="M60 28 84 47V88H36V47Z" fill={`url(#${uid}-accent)`}/>
    <path d="M60 34 79 49V84H41V49Z" fill="#1a0d17"/>
    <g className="fg-family-people">
      <circle cx="51" cy="56" r="5" fill={`url(#${uid}-bright)`}/>
      <path d="M43 80V71Q43 63 51 63Q59 63 59 71V80Z" fill={`url(#${uid}-bright)`}/>
      <circle cx="69" cy="56" r="5" fill={`url(#${uid}-metal)`}/>
      <path d="M61 80V71Q61 63 69 63Q77 63 77 71V80Z" fill={`url(#${uid}-metal)`}/>
      <circle className="fg-family-child" cx="60" cy="68" r="3.6" fill="var(--li-pale)"/>
      <path className="fg-family-child" d="M54.5 82V78Q54.5 73 60 73Q65.5 73 65.5 78V82Z" fill="var(--li-pale)"/>
    </g>
    <path className="fg-family-roof" d="M33 48 60 27 87 48" fill="none" stroke="var(--li-pale)" strokeWidth="1.6" strokeLinecap="round" opacity=".7"/>
  </g>
}
export const FAMILY_ICONS = {
  family: { label: 'SISO Family', description: 'A faceted home holding three figures: two parents and a child.', motion: 'The roof light runs across once and the child lifts into place.', colorA: '#f9a8d4', colorB: '#db2777', pale: '#ffe4f1', Glyph: Family },
} satisfies Record<string, LivingIconDefinition>
