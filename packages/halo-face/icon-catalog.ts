import { INDUSTRY_ICONS } from './industry-glyphs'
import { NAVIGATION_ICONS } from './navigation-glyphs'
import { PROJECT_ICONS } from './project-glyphs'

export const LIVING_ICONS = { ...INDUSTRY_ICONS, ...NAVIGATION_ICONS, ...PROJECT_ICONS }
export type LivingIconName = keyof typeof LIVING_ICONS
export const INDUSTRY_ICON_NAMES = Object.keys(INDUSTRY_ICONS) as (keyof typeof INDUSTRY_ICONS)[]
export const NAVIGATION_ICON_NAMES = Object.keys(NAVIGATION_ICONS) as (keyof typeof NAVIGATION_ICONS)[]
