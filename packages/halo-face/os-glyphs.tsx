import type { IconGlyphProps, LivingIconDefinition } from './living-icon-types'
import './os-glyphs.css'

/** SISO OS rail marks (Shaan, 10 Oct: "make some icons for the app factory and for the agents hub"), drawn on the same
 * 120 grid and gradients as the navigation glyphs. Added beside the kit; the kit's own files are unchanged. */
function AppFactory({ uid }: IconGlyphProps) {
  return <g className="og-factory">
    <path d="M24 92V52L42 40V52L60 40V52L78 40V30H90V92Z" fill={`url(#${uid}-metal)`}/>
    <path d="M29 88V56L42 48V58L60 48V58L78 48V35H86V88Z" fill={`url(#${uid}-accent)`}/>
    <path d="M34 84V62L46 55V64L62 55V64L80 55V84Z" fill="#0a1424"/>
    <rect x="80" y="24" width="8" height="5" rx="1.5" fill={`url(#${uid}-bright)`}/>
    <g className="og-factory-smoke" fill="var(--li-pale)"><circle cx="86" cy="18" r="3" opacity=".55"/><circle cx="91" cy="12" r="2.2" opacity=".35"/></g>
    <path d="M30 92H94" stroke="#0a1424" strokeWidth="3"/>
    <g className="og-factory-tile"><rect x="50" y="64" width="18" height="18" rx="4.5" fill={`url(#${uid}-bright)`}/><path d="M55 70H63M55 75H60" stroke="#0a1424" strokeWidth="2.2" strokeLinecap="round"/></g>
    <path d="M38 70H46M38 76H46" stroke="var(--li-pale)" strokeWidth="2" strokeLinecap="round" opacity=".55"/>
  </g>
}
function AgentsHub({ uid }: IconGlyphProps) {
  return <g className="og-hub">
    <g fill="none" stroke={`url(#${uid}-accent)`} strokeWidth="3.4" strokeLinecap="round"><path d="M60 60 34 36M60 60 86 36M60 60 34 84M60 60 86 84"/></g>
    <g className="og-hub-pulse" fill="none" stroke="var(--li-pale)" strokeWidth="1.6" strokeLinecap="round" opacity="0"><path d="M60 60 34 36M60 60 86 36M60 60 34 84M60 60 86 84"/></g>
    <g fill={`url(#${uid}-metal)`}><rect x="22" y="24" width="22" height="22" rx="7"/><circle cx="86" cy="35" r="12"/><path d="M34 73 46 84 34 95 22 84Z"/><rect x="75" y="74" width="22" height="20" rx="4"/></g>
    <g fill="#0b1426"><path d="m33 29 2.2 4.6 5 .6-3.7 3.4 1 5-4.5-2.5-4.5 2.5 1-5-3.7-3.4 5-.6Z"/><circle cx="86" cy="35" r="6"/><rect x="80" y="79" width="12" height="10" rx="2"/></g>
    <path d="M83 31V39M89 31V39" stroke={`url(#${uid}-bright)`} strokeWidth="2.2" strokeLinecap="round"/>
    <circle cx="34" cy="84" r="4" fill={`url(#${uid}-bright)`}/>
    <circle cx="60" cy="60" r="16" fill={`url(#${uid}-metal)`}/>
    <circle cx="60" cy="60" r="12" fill={`url(#${uid}-accent)`}/>
    <circle className="og-hub-core" cx="60" cy="60" r="6.5" fill={`url(#${uid}-bright)`}/>
  </g>
}
export const OS_ICONS = {
  'app-factory': { label: 'App Factory', description: 'A machined factory with a sawtooth roof, an app tile on its floor and a light from its stack.', motion: 'The app tile rises off the floor as the stack breathes once.', colorA: '#8ec5ff', colorB: '#2563eb', pale: '#dcecff', Glyph: AppFactory },
  'agents-hub': { label: 'Agents Hub', description: 'A bright core joined to four parts: a skill, an MCP server, a plugin and a model.', motion: 'A pulse runs out from the core along all four spokes.', colorA: '#c4b5fd', colorB: '#6d28d9', pale: '#ede9fe', Glyph: AgentsHub },
} satisfies Record<string, LivingIconDefinition>
