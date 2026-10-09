import { useEffect, useRef } from 'react'
import { PrismFace } from './prism-engine'
import './prism-face.css'
import type { AgentStatus, FaceDirection, FaceFamily, FaceFeatures } from './identity'
export { projectHue } from './identity'
export type { AgentStatus, FaceDirection, FaceFamily, FaceFeatures } from './identity'

export type AgentFaceProps = {
  name?: string; project?: string; hue?: number; status?: AgentStatus; size?: number
  track?: boolean; interactive?: boolean; className?: string; title?: string
  /** Provider hint for agents whose names do not identify their harness. */
  family?: FaceFamily
  /** Optional review controls. App usage defaults to the Prism material. */
  direction?: FaceDirection; features?: Partial<FaceFeatures>; secondHue?: number; paused?: boolean
}
export function AgentFace({ name, project, hue, status = 'waiting', size = 24, track = false, interactive = false, className, title, family, direction = 'prism', features, secondHue, paused = false }: AgentFaceProps) {
  const host = useRef<HTMLSpanElement>(null), ctl = useRef<PrismFace | null>(null)
  const eyes = features?.eyes, sides = features?.sides, top = features?.top, head = features?.head
  useEffect(() => {
    if (!host.current) return
    const c = new PrismFace(host.current, { name, project, hue, status, size, track, interactive, family, direction, features: { eyes, sides, top, head }, secondHue, paused })
    ctl.current = c
    return () => { c.destroy(); ctl.current = null }
    // Identity and geometry rebuild; status and colour update in place below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name, size, track, interactive, family, direction, eyes, sides, top, head, secondHue])
  useEffect(() => { ctl.current?.project(project,hue) }, [project,hue])
  useEffect(() => { ctl.current?.status(status) }, [status])
  useEffect(() => { ctl.current?.pause(paused) }, [paused])
  return <span ref={host} className={className ? `pf ${className}` : 'pf'} title={title} style={{display:'inline-block',width:size,height:size,flexShrink:0,verticalAlign:'middle'}} />
}
