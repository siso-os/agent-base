import type { ComponentType } from 'react'

export type IconGlyphProps = { uid: string }
export type LivingIconDefinition = {
  label: string
  description: string
  motion: string
  colorA: string
  colorB: string
  pale: string
  Glyph: ComponentType<IconGlyphProps>
}
