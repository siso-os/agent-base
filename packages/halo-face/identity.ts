export type AgentStatus = 'working' | 'waiting' | 'needs-shaan' | 'blocked' | 'done' | 'offline'
export type FaceFamily = 'claude' | 'codex'
export type FaceDirection = 'prism' | 'contour' | 'facet'
export type FaceFeatures = { eyes: number; sides: number; top: number; head: number }
export const featureNames = {
  eyes: ['Lens', 'Aperture', 'Round', 'Arc', 'Dash', 'Diamond'],
  sides: ['Dock', 'Fins', 'Aerials', 'Pads', 'Crescents', 'Winglets'],
  top: ['Orbit', 'Crest', 'Cap', 'Twin fins', 'Beacon', 'Bare', 'Crown'],
  head: ['Original', 'Pebble', 'Wide', 'Tall', 'Chamfer', 'Shield'],
} as const
export const colourways = [
  { name: 'Aurora', hue: 177, other: 234 },
  { name: 'Ion', hue: 217, other: 275 },
  { name: 'Orchid', hue: 278, other: 323 },
  { name: 'Lagoon', hue: 153, other: 210 },
  { name: 'Glacier', hue: 198, other: 267 },
  { name: 'Iris', hue: 251, other: 191 },
  { name: 'Solar', hue: 44, other: 315 },
  { name: 'Sunset', hue: 19, other: 332 },
  { name: 'Ember', hue: 5, other: 38 },
  { name: 'Rose', hue: 336, other: 272 },
  { name: 'Citron', hue: 78, other: 170 },
  { name: 'Candy', hue: 311, other: 188 },
  { name: 'Jade', hue: 133, other: 58 },
  { name: 'Cobalt', hue: 228, other: 195 },
  { name: 'Royal', hue: 265, other: 44 },
  { name: 'Cherry', hue: 350, other: 226 },
] as const
/** Agent Base's existing project colour contract, including the alert exclusion band. */
export function projectHue(name: string): number {
  let h = 0
  for (const ch of String(name)) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  h %= 360
  return h >= 340 || h < 55 ? (h + 180) % 360 : h
}
export function nameHash(name: string): number {
  let h = 2166136261
  for (const c of name.normalize('NFKC').trim().toLowerCase().replace(/\s+/g, ' ')) h = Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0
  return h
}
export function faceIdentity(name = 'Agent', family?: FaceFamily) {
  const key = nameHash(name)
  const kind = family ?? (/codex|gpt|\bsol\b/i.test(name) ? 'codex' : /claude|opus|sonnet|haiku/i.test(name) ? 'claude' : key % 2 ? 'claude' : 'codex')
  // Keep the original six-way hash stable when optional accessories are added.
  const pick = (axis: string) => nameHash(`${key}:${axis}`) % 6
  const features: FaceFeatures = { eyes: pick('eyes'), sides: pick('sides'), top: pick('top'), head: pick('head') }
  features.head = kind === 'claude' ? [0, 1, 2][pick('head') % 3] : [3, 4, 5][pick('head') % 3]
  features.eyes = kind === 'claude' ? [0, 2, 3][pick('eyes') % 3] : [0, 1, 4][pick('eyes') % 3]
  return { key, family: kind, features }
}
