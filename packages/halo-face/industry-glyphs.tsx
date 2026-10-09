import type { IconGlyphProps, LivingIconDefinition } from './living-icon-types'
import './industry-glyphs.css'

/** Original 120-unit industry scenes. Paint servers are supplied by LivingIcon. */
function CarRental({ uid }: IconGlyphProps) {
  return <g className="ig-car">
    <ellipse cx="60" cy="86" rx="33" ry="5" fill={`url(#${uid}-glow)`} opacity=".6" />
    <path d="M27 64 34 58 42 42Q44 38 50 38H69Q74 38 78 43L85 57 92 63V78H27Z" fill="#050c15" />
    <path d="M27 60 34 55 42 40Q44 36 50 36H69Q75 36 78 41L85 55 93 61V74Q93 78 89 78H31Q27 78 27 74Z" fill={`url(#${uid}-accent)`} />
    <path d="m39 55 7-13h25l8 13Z" fill={`url(#${uid}-glass)`} stroke="#07121f" strokeWidth="2" />
    <path d="M48 43h20l-17 9H43Z" fill="#fff" opacity=".18" />
    <path d="M29 64q30-10 62 0v8H29Z" fill={`url(#${uid}-metal)`} />
    <path d="M46 66h28l-3 7H49Z" fill="#06101a" />
    <path d="m30 60 12 2-2 5-9-1Zm60 0-12 2 2 5 9-1Z" fill={`url(#${uid}-bright)`} />
    <g className="ig-wheel ig-wheel-left"><circle cx="39" cy="76" r="9" fill="#050a12" /><circle cx="39" cy="76" r="6" fill={`url(#${uid}-metal)`} /><path d="M39 71v10m-5-5h10" stroke={`url(#${uid}-accent)`} strokeWidth="2.5" /><circle cx="39" cy="76" r="2" fill="#e5f8ff" /></g>
    <g className="ig-wheel ig-wheel-right"><circle cx="81" cy="76" r="9" fill="#050a12" /><circle cx="81" cy="76" r="6" fill={`url(#${uid}-metal)`} /><path d="M81 71v10m-5-5h10" stroke={`url(#${uid}-accent)`} strokeWidth="2.5" /><circle cx="81" cy="76" r="2" fill="#e5f8ff" /></g>
    <path className="ig-headlight" d="M30 61h10m40 0h10" stroke="var(--li-pale)" strokeWidth="2" strokeLinecap="round" />
  </g>
}

function CreatorManagement({ uid }: IconGlyphProps) {
  return <g className="ig-creator">
    <path d="M34 32Q60 23 86 32V83L60 94 34 83Z" fill="#070b15" />
    <path d="M34 29Q60 21 86 29V79L60 90 34 79Z" fill={`url(#${uid}-accent)`} />
    <path d="M39 34Q60 28 81 34V75L60 84 39 75Z" fill={`url(#${uid}-glass)`} />
    <path d="M40 35q19-6 39 0L40 62Z" fill="#fff" opacity=".08" />
    <g className="ig-spotlight"><path d="M60 31 38 76Q60 84 82 76Z" fill={`url(#${uid}-glow)`} opacity=".72" /></g>
    <g className="ig-portrait">
      <path d="M44 73q0-15 16-15t16 15l-16 7Z" fill={`url(#${uid}-accent)`} />
      <path d="M51 59q9 8 18 0l-3 12H54Z" fill={`url(#${uid}-metal)`} />
      <ellipse cx="60" cy="48" rx="10" ry="12" fill={`url(#${uid}-bright)`} />
      <path d="M50 46q-1-12 10-12t10 12q-10-1-14-7-1 5-6 7Z" fill={`url(#${uid}-accent)`} />
      <path d="M46 72q2-9 7-10" fill="none" stroke="var(--li-pale)" strokeWidth="1.4" opacity=".7" />
    </g>
    <g className="ig-creator-star"><path d="m84 40 3 7 7 3-7 3-3 7-3-7-7-3 7-3Z" fill="#060c17" stroke="#060c17" strokeWidth="4" /><path d="m84 40 3 7 7 3-7 3-3 7-3-7-7-3 7-3Z" fill={`url(#${uid}-bright)`} /></g>
  </g>
}

function Ecommerce({ uid }: IconGlyphProps) {
  return <g className="ig-commerce">
    <path d="m29 48 31-17 31 17v34L60 98 29 82Z" fill="#060b13" />
    <path d="m29 44 31-17 31 17v34L60 94 29 78Z" fill={`url(#${uid}-accent)`} />
    <path d="M33 49 58 62v26L33 75Z" fill={`url(#${uid}-glass)`} />
    <path d="m62 62 25-13v26L62 88Z" fill={`url(#${uid}-metal)`} />
    <path d="m62 62 25-13v26L62 88Z" fill="var(--li-b)" opacity=".23" />
    <g className="ig-parcel-lid">
      <path d="m29 44 31-17 31 17-31 18Z" fill={`url(#${uid}-accent)`} />
      <path d="m34 44 26-14 26 14-26 14Z" fill={`url(#${uid}-metal)`} opacity=".45" />
      <path d="m48 34 31 17-9 5-31-17Z" fill={`url(#${uid}-bright)`} />
      <path d="m30 44 30 17 30-17" fill="none" stroke="var(--li-pale)" strokeWidth="1.3" opacity=".8" />
    </g>
    <path d="M70 56v15l9-5V51Z" fill={`url(#${uid}-bright)`} />
    <path d="m39 65 12 6v6l-12-6Z" fill={`url(#${uid}-accent)`} opacity=".8" />
    <path d="M60 62v29" stroke="var(--li-pale)" strokeWidth="1.4" opacity=".7" />
  </g>
}

function Restaurants({ uid }: IconGlyphProps) {
  return <g className="ig-restaurant">
    <ellipse cx="60" cy="86" rx="32" ry="5" fill={`url(#${uid}-glow)`} opacity=".45" />
    <g className="ig-steam" fill="none" stroke={`url(#${uid}-bright)`} strokeWidth="2.4" strokeLinecap="round"><path d="M48 58q-5-5 0-10t0-10" /><path d="M62 58q-5-5 0-10t0-10" /><path d="M76 58q-5-5 0-10t0-10" /></g>
    <g className="ig-cloche">
      <path d="M30 73q0-30 30-30t30 30Z" fill="#050b12" />
      <path d="M30 69q0-30 30-30t30 30Z" fill={`url(#${uid}-accent)`} />
      <path d="M36 66q2-21 22-23-10 7-9 23Z" fill={`url(#${uid}-bright)`} opacity=".72" />
      <path d="M61 43q23 2 24 23H61Z" fill={`url(#${uid}-glass)`} opacity=".85" />
      <path d="M32 68h56v6H32Z" fill={`url(#${uid}-metal)`} />
      <path d="M31 68h58" stroke="var(--li-pale)" strokeWidth="1.5" />
      <path d="M56 40v-5h8v5" fill={`url(#${uid}-accent)`} />
      <ellipse cx="60" cy="33" rx="8" ry="4" fill={`url(#${uid}-bright)`} />
    </g>
    <path d="M26 77h68l-8 9H34Z" fill={`url(#${uid}-accent)`} />
    <path d="M29 78h62l-3 3H32Z" fill={`url(#${uid}-bright)`} />
    <path d="M37 86h46" stroke="#060b14" strokeWidth="2" />
  </g>
}

function TourGuides({ uid }: IconGlyphProps) {
  return <g className="ig-tour">
    <path d="M53 29v-4h14v4" fill="none" stroke={`url(#${uid}-metal)`} strokeWidth="4" />
    <circle cx="60" cy="63" r="32" fill="#030914" />
    <circle cx="60" cy="60" r="32" fill={`url(#${uid}-accent)`} />
    <circle cx="60" cy="60" r="27" fill={`url(#${uid}-glass)`} stroke={`url(#${uid}-metal)`} strokeWidth="2" />
    <path d="M38 45Q60 28 82 45L38 64Z" fill="#fff" opacity=".07" />
    <path d="M60 35v6m25 19h-6M60 85v-6M35 60h6" stroke={`url(#${uid}-bright)`} strokeWidth="2" />
    <path d="m43 43 3 3m31-3-3 3m3 31-3-3m-31 3 3-3" stroke="var(--li-pale)" opacity=".35" strokeWidth="1.5" />
    <g className="ig-compass-needle">
      <path d="m73 40-5 28-22 15 6-29Z" fill="#030914" />
      <path d="m74 37-6 28-22 15 6-28Z" fill={`url(#${uid}-bright)`} />
      <path d="m74 37-14 23-8-8Z" fill="var(--li-pale)" />
      <path d="m60 60 8 5-22 15Z" fill={`url(#${uid}-accent)`} />
      <path d="m60 60-8-8-6 28Z" fill={`url(#${uid}-metal)`} />
    </g>
    <circle cx="60" cy="60" r="5" fill={`url(#${uid}-accent)`} stroke="#07111c" strokeWidth="2" />
    <circle cx="59" cy="59" r="1.5" fill="var(--li-pale)" />
  </g>
}

function CryptoTrading({ uid }: IconGlyphProps) {
  return <g className="ig-trading">
    <path d="M28 31h6v53h58v7H28Z" fill="#040a12" />
    <path d="M28 28h6v53h58v7H28Z" fill={`url(#${uid}-metal)`} />
    <path d="M34 43h57M34 61h57" stroke="var(--li-pale)" strokeWidth="1" opacity=".13" />
    <g className="ig-candle ig-candle-one"><path d="M45 34v41" stroke={`url(#${uid}-bright)`} strokeWidth="3" /><rect x="38" y="43" width="14" height="23" rx="2" fill={`url(#${uid}-accent)`} /><path d="M40 64V45h4" fill="none" stroke="var(--li-pale)" strokeWidth="1.5" opacity=".8" /><path d="M48 45h2v19h-2Z" fill="#07111b" opacity=".4" /></g>
    <g className="ig-candle ig-candle-two"><path d="M65 27v43" stroke={`url(#${uid}-metal)`} strokeWidth="3" /><rect x="58" y="34" width="14" height="24" rx="2" fill={`url(#${uid}-metal)`} /><rect x="61" y="37" width="8" height="18" rx="1" fill={`url(#${uid}-glass)`} /><path d="M60 56V36h8" fill="none" stroke="var(--li-pale)" opacity=".6" /></g>
    <g className="ig-candle ig-candle-three"><path d="M85 44v32" stroke={`url(#${uid}-bright)`} strokeWidth="3" /><rect x="78" y="52" width="14" height="15" rx="2" fill={`url(#${uid}-accent)`} /><path d="M80 65V54h4" fill="none" stroke="var(--li-pale)" strokeWidth="1.5" opacity=".8" /><path d="M88 54h2v11h-2Z" fill="#07111b" opacity=".4" /></g>
    <path d="M29 29v53h62" fill="none" stroke="var(--li-pale)" strokeWidth="1" opacity=".65" />
  </g>
}

export const INDUSTRY_ICONS = {
  'car-rental': { label: 'Car rental', description: 'A low coupe cast in ice-blue alloy, with inset glass and machined wheels.', motion: 'The wheels take a short turn; headlights answer once.', colorA: '#74c6ff', colorB: '#4268d7', pale: '#d8f6ff', Glyph: CarRental },
  ofm: { label: 'Creator management', description: 'A portrait medallion with a soft spotlight and a polished editorial star.', motion: 'The portrait spotlight opens gently and the star gives one restrained glint.', colorA: '#e9a8ef', colorB: '#8653c0', pale: '#ffedff', Glyph: CreatorManagement },
  ecommerce: { label: 'Ecommerce', description: 'An isometric parcel with folded metal faces and a luminous packing ribbon.', motion: 'The parcel lid lifts slightly, then closes into its original seam.', colorA: '#ffcc8b', colorB: '#c67c44', pale: '#fff0d3', Glyph: Ecommerce },
  restaurants: { label: 'Restaurants', description: 'A polished service cloche over a sculpted serving tray.', motion: 'The cloche lifts to release a small wisp of steam, then settles.', colorA: '#ffbc87', colorB: '#ce624e', pale: '#fff0d8', Glyph: Restaurants },
  'tour-guides': { label: 'Tour guides', description: 'A pocket compass with a faceted navigation needle in deep glass.', motion: 'The needle searches a few degrees, overshoots, and finds its bearing.', colorA: '#78e3d2', colorB: '#269b98', pale: '#dcfff2', Glyph: TourGuides },
  'crypto-trading': { label: 'Crypto trading', description: 'Three mixed market candles on a machined instrument axis; an illustrative symbol, not market data.', motion: 'The candles briefly redraw in place and recover; no rising-price or profit signal.', colorA: '#b4b0ff', colorB: '#626bd6', pale: '#f0eeff', Glyph: CryptoTrading },
} satisfies Record<string, LivingIconDefinition>

export type IndustryIconName = keyof typeof INDUSTRY_ICONS
