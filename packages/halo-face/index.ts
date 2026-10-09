// The Opus ZeroFace uses the original controller for voice/build cues.
// Keep that entry point while AgentFace renders the Prism family.
import "./halo-face.css"
import "./agent-face.css"
import "./halo-face.js"
import "./agent-face.js"
export { AgentFace, projectHue } from "./AgentFace"
export type { AgentFaceProps, AgentStatus, FaceDirection, FaceFamily, FaceFeatures } from "./AgentFace"
export { WorkspaceMark } from "./WorkspaceMark"
export type { WorkspaceMarkProps, WorkspaceBrand, WorkspaceMarkLook } from "./WorkspaceMark"
export { LivingIcon } from './LivingIcon'
export type { LivingIconProps } from './LivingIcon'
export { LIVING_ICONS } from './icon-catalog'
export type { LivingIconName } from './icon-catalog'
