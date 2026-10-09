import { faceIdentity, featureNames, projectHue, type AgentStatus, type FaceDirection, type FaceFamily, type FaceFeatures } from './identity'

type Options = { name?: string; project?: string; hue?: number; size?: number; track?: boolean; interactive?: boolean; status?: AgentStatus; family?: FaceFamily; direction?: FaceDirection; features?: Partial<FaceFeatures>; secondHue?: number; paused?: boolean }
const live = new Set<PrismFace>()
let serial = 0, frame = 0, wakeTimer = 0, wakeDue = 0
const isAppSleeping = () => typeof document !== 'undefined' && (document.documentElement?.hasAttribute('data-doze') || document.documentElement?.hasAttribute('data-still'))
let appSleeping = isAppSleeping()
const media = typeof window === 'undefined' ? null : window.matchMedia('(prefers-reduced-motion: reduce)')
const observer = typeof IntersectionObserver === 'undefined' ? null : new IntersectionObserver(entries => {
  for (const entry of entries) for (const f of live) if (f.el === entry.target) { f.visible = entry.isIntersecting; f.syncMotion() }
  schedule()
}, { threshold: 0 })
function schedule() {
  if (document.hidden || media?.matches) { if (frame) { cancelAnimationFrame(frame); frame = 0 }; if (wakeTimer) { clearTimeout(wakeTimer); wakeTimer = 0; wakeDue = 0 }; return }
  const moving = [...live].filter(f => f.canMove())
  if (!moving.length) { if (frame) { cancelAnimationFrame(frame); frame = 0 }; if (wakeTimer) { clearTimeout(wakeTimer); wakeTimer = 0; wakeDue = 0 }; return }
  if (frame) return
  const now = performance.now()
  // Wake just before the next useful paint, not on every display frame. Portraits keep their 30 fps breath;
  // navigation faces need at most 15 fps, and settled faces sleep until a blink or glance.
  const delay = Math.max(0, Math.min(...moving.map(f => f.needsFrame() ? f.frameMs - (now-f.last) - 16 : f.nextWakeMs())))
  if (delay <= 0) {
    if (wakeTimer) { clearTimeout(wakeTimer); wakeTimer = 0; wakeDue = 0 }
    frame = requestAnimationFrame(tick)
    return
  }
  const due = now + delay
  if (!wakeTimer || due < wakeDue) {
    if (wakeTimer) clearTimeout(wakeTimer)
    wakeDue = due
    wakeTimer = window.setTimeout(() => { wakeTimer = 0; wakeDue = 0; frame = requestAnimationFrame(tick) }, delay)
  }
}
// t-0534: faces move at 30 fps. Each tick restyles every visible face, and at the display's rate (60-120 Hz) a nav full of
// faces kept WebKit repainting nonstop (38% idle CPU measured with tools/ab-idle-cpu.mjs). Nav-size faces (48 px or
// less: no breath or head roll, only gaze and blink) move at 15 fps. The springs use wall time.
const FRAME_MS = 1000 / 30
function tick(t: number) {
  frame = 0
  for (const f of live) if (f.canMove() && t - f.last >= f.frameMs - 2) f.tick(t)
  schedule()
}
function resetMotion() { for (const f of live) f.syncMotion(); schedule() }
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', resetMotion)
  // The app already freezes CSS when idle. Freeze this JS producer on that same state, preserving the held pose.
  if (typeof MutationObserver !== 'undefined' && document.documentElement) new MutationObserver(() => {
    const next = isAppSleeping()
    if (next !== appSleeping) { appSleeping = next; resetMotion() }
  }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-doze', 'data-still'] })
}
media?.addEventListener('change', resetMotion)
const shapes = [
  'M45 27H75Q103 27 103 55V83Q103 111 75 111H45Q17 111 17 83V55Q17 27 45 27Z',
  'M60 25C88 25 104 41 104 67C104 96 87 112 60 112C33 112 16 96 16 67C16 41 32 25 60 25Z',
  'M40 34H80Q108 34 108 61V82Q108 105 80 105H40Q12 105 12 82V61Q12 34 40 34Z',
  'M48 22H72Q97 22 97 48V87Q97 115 72 115H48Q23 115 23 87V48Q23 22 48 22Z',
  'M35 27H85L104 46V92L87 109H33L16 92V46Z',
  'M37 27H83Q103 27 103 47V81Q103 101 60 113Q17 101 17 81V47Q17 27 37 27Z',
]
const topPaths = [
  '<ellipse cx="60" cy="15" rx="23" ry="4.4" fill="none" stroke-width="2"/>',
  '<path d="M40 25L46 16L60 21L74 16L80 25Z" stroke-width="1.2"/>',
  '<path d="M33 29Q34 11 57 11Q78 11 80 28L97 31L91 35H30Z" stroke-width="1.2"/><path d="M40 24Q58 18 75 25" fill="none" stroke="white" opacity=".22"/>',
  '<path d="M34 28L38 12L52 25ZM68 25L82 12L86 28Z" stroke-width="1.2"/>',
  '<path d="M60 27V15" fill="none" stroke-width="3"/><circle cx="60" cy="12" r="5" stroke-width="1.5"/>',
  '',
  '<path class="pf-crown" d="M36 11L47 20L60 4L73 20L84 11L79 29Q60 33 41 29Z" stroke-width="1.2" stroke-linejoin="round"/><path d="M42 26Q60 30 78 26" fill="none" stroke="white" stroke-opacity=".52" stroke-width="1"/><path d="M60 17L64 22L60 27L56 22Z" fill="var(--pale)" stroke="var(--b)" stroke-width="1.4"/><path d="M38 13L46 22M60 7L67 18" fill="none" stroke="white" stroke-opacity=".6" stroke-width=".8"/>',
]
function sides(n: number) {
  const half = [
    '<rect x="9" y="55" width="9" height="27" rx="4"/><path d="M11 61H15M11 67H15M11 73H15" fill="none" stroke="white" opacity=".24"/>',
    '<path d="M18 49L8 57L8 84L18 78Z"/><path d="M11 61V77" fill="none" stroke="white" opacity=".35"/>',
    '<path d="M18 72H10V45" fill="none" stroke-width="3"/><circle cx="10" cy="43" r="4"/>',
    '<rect x="6" y="55" width="15" height="30" rx="7"/><rect x="9" y="59" width="5" height="22" rx="2" fill="#10151e"/>',
    '<path d="M20 48Q1 69 20 88L14 73V63Z"/>',
    '<path d="M19 58L3 47L9 78L18 84Z"/><path d="M8 56L13 72" fill="none" stroke="white" opacity=".35"/>',
  ][n]
  return `${half}<g transform="translate(120 0) scale(-1 1)">${half}</g>`
}
function eye(n: number, x: number, family: FaceFamily, u: string) {
  const y = 65, soft = family === 'claude'
  const forms = [
    `<rect x="${x - (soft ? 4.9 : 6)}" y="${y - (soft ? 8 : 6)}" width="${soft ? 9.8 : 12}" height="${soft ? 16 : 12}" rx="${soft ? 4.9 : 2.5}"/>`,
    `<circle cx="${x}" cy="${y}" r="7"/><circle cx="${x}" cy="${y}" r="2.3" fill="var(--dark)" opacity=".65"/>`,
    `<circle cx="${x}" cy="${y}" r="6.7"/>`,
    `<path d="M${x - 7} ${y + 3}Q${x} ${y - 10} ${x + 7} ${y + 3}" fill="none" stroke="url(#${u}eye)" stroke-width="4" stroke-linecap="round"/>`,
    `<rect x="${x - 7.5}" y="${y - 3.4}" width="15" height="6.8" rx="${soft ? 3.4 : 1.3}"/>`,
    `<path d="M${x} ${y - 8}L${x + 7} ${y}L${x} ${y + 8}L${x - 7} ${y}Z"/>`,
  ]
  return `<g class="pf-eye" style="transform-origin:${x}px ${y}px"><ellipse class="pf-eyeglow" cx="${x}" cy="${y}" rx="16" ry="19" fill="url(#${u}bloom)"/><g fill="url(#${u}eye)">${forms[n]}</g></g>`
}
function template(id: number, p: FaceFeatures, family: FaceFamily) {
  const u = `prism${id}-`, shape = shapes[p.head]
  const visor = family === 'claude' ? '<rect x="29" y="38" width="62" height="61" rx="20"' : '<path d="M39 38H81L91 48V88L80 99H40L29 88V48Z"'
  const screen = (attrs: string) => `${visor} ${attrs}/>`
  return `<svg viewBox="4 3 112 112" aria-hidden="true"><defs>
    <linearGradient id="${u}rim" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="var(--pale)"/><stop offset=".18" stop-color="var(--a)"/><stop offset=".48" stop-color="var(--a)"/><stop offset=".78" stop-color="var(--b)"/><stop offset="1" stop-color="var(--pale)"/></linearGradient>
    <linearGradient id="${u}metal" x1="0" y1="0" x2=".9" y2="1"><stop stop-color="white" stop-opacity=".84"/><stop offset=".18" stop-color="white" stop-opacity=".02"/><stop offset=".5" stop-color="#030712" stop-opacity=".68"/><stop offset=".78" stop-color="white" stop-opacity=".24"/><stop offset=".93" stop-color="#02050c" stop-opacity=".8"/><stop offset="1" stop-color="white" stop-opacity=".32"/></linearGradient>
    <linearGradient id="${u}glass" x1="0" y1="0" x2=".4" y2="1"><stop stop-color="#283442"/><stop offset=".48" stop-color="#0b1520"/><stop offset="1" stop-color="#020609"/></linearGradient>
    <linearGradient id="${u}eye" x1="0" y1="0" x2="0" y2="1"><stop stop-color="#fff"/><stop offset=".55" stop-color="#f1ffff"/><stop offset="1" stop-color="var(--pale)"/></linearGradient>
    <radialGradient id="${u}bloom"><stop stop-color="var(--pale)" stop-opacity=".75"/><stop offset=".38" stop-color="var(--a)" stop-opacity=".16"/><stop offset="1" stop-color="var(--a)" stop-opacity="0"/></radialGradient>
    <radialGradient id="${u}wash" cx=".15" cy=".8" r=".95"><stop stop-color="var(--a)" stop-opacity=".3"/><stop offset="1" stop-color="var(--b)" stop-opacity=".02"/></radialGradient>
    <radialGradient id="${u}ambient"><stop stop-color="var(--a)" stop-opacity=".17"/><stop offset="1" stop-color="var(--b)" stop-opacity="0"/></radialGradient>
    <linearGradient id="${u}reflect" x1="0" y1="0" x2="0" y2="1"><stop stop-color="#fff" stop-opacity=".26"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>
    <clipPath id="${u}clip">${screen('')}</clipPath>
  </defs>
  <ellipse class="pf-floor" cx="60" cy="113" rx="40" ry="7" fill="url(#${u}ambient)"/>
  <circle class="pf-ambient" cx="60" cy="69" r="60" fill="url(#${u}ambient)"/>
  <g class="pf-acting"><g class="pf-head">
    <g class="pf-sides" fill="url(#${u}rim)" stroke="var(--a)" stroke-width=".7">${sides(p.sides)}</g>
    <g class="pf-side-metal" fill="url(#${u}metal)" opacity=".55">${sides(p.sides)}</g>
    <path class="pf-outer" d="${shape}" fill="url(#${u}rim)" stroke="var(--pale)" stroke-opacity=".34" stroke-width="1"/>
    <path class="pf-metal" d="${shape}" fill="url(#${u}metal)"/>
    <path d="${shape}" transform="translate(60 69) scale(.88) translate(-60 -69)" fill="#061016" stroke="var(--a)" stroke-opacity=".75" stroke-width="1.2"/>
    <path class="pf-contour" d="${shape}" transform="translate(60 69) scale(.93) translate(-60 -69)" fill="none" stroke="var(--pale)" stroke-width=".8" opacity=".65"/>
    ${screen(`fill="url(#${u}glass)" stroke="var(--a)" stroke-opacity=".25" stroke-width="1.3"`)}
    ${screen(`fill="url(#${u}wash)"`)}
    <g clip-path="url(#${u}clip)"><path d="M28 36H93V55Q64 43 28 70Z" fill="url(#${u}reflect)"/>
      <path d="M32 49Q41 39 65 41" stroke="white" stroke-opacity=".18" stroke-width="1.1" fill="none"/>
      <g class="pf-gaze">${eye(p.eyes, 46, family, u)}${eye(p.eyes, 74, family, u)}
        <g class="pf-lids" fill="none" stroke="var(--pale)" stroke-width="3.2" stroke-linecap="round"><path d="M39 67Q46 71 53 67M67 67Q74 71 81 67"/></g>
        <g class="pf-happy" fill="none" stroke="url(#${u}eye)" stroke-width="4" stroke-linecap="round"><path d="M38 66Q46 55 54 66M66 66Q74 55 82 66"/></g>
        <g class="pf-brows" fill="none" stroke="var(--pale)" stroke-width="2" stroke-linecap="round"><path d="M38 52L51 56M69 56L82 52"/></g>
      </g>
      <g class="pf-work" fill="var(--pale)"><rect x="46" y="85" width="6" height="2.4" rx="1.2"/><rect x="57" y="85" width="6" height="2.4" rx="1.2"/><rect x="68" y="85" width="6" height="2.4" rx="1.2"/></g>
      <path class="pf-alert" d="M60 81V86M60 90V90.5" fill="none" stroke="var(--pale)" stroke-width="2.6" stroke-linecap="round"/>
      <path class="pf-check" d="M54 85L58 89L66 80" fill="none" stroke="var(--pale)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
    </g>
    <path class="pf-chin" d="M49 104H71" fill="none" stroke="var(--a)" stroke-width="1.9" stroke-linecap="round" opacity=".85"/>
    ${family === 'codex' ? '<path class="pf-signature" d="M34 34H42M78 34H86" stroke="var(--pale)" stroke-width="2" stroke-linecap="round"/>' : ''}
  </g><g class="pf-top" fill="url(#${u}rim)" stroke="url(#${u}rim)">${topPaths[p.top]}<g fill="url(#${u}metal)" stroke="none" opacity=".58">${topPaths[p.top]}</g>${family === 'codex' && p.top === 0 ? '<path d="M43 15H48M72 15H77" stroke="#e6ffff" stroke-width="2.4"/>' : ''}</g></g>
  <g class="pf-sparks" stroke="var(--pale)" stroke-width="2" stroke-linecap="round"><path d="M15 28V36M11 32H19"/><path d="M105 22V30M101 26H109"/><path d="M110 88V94M107 91H113"/></g>
  </svg>`
}

export class PrismFace {
  el: HTMLElement; visible = true; o: Options; state: AgentStatus = 'waiting'; elapsed = 0; gesture = 0; last = 0
  x = 0; y = 0; vx = 0; vy = 0; ax = 0; ay = 0; avx = 0; avy = 0; tx = 0; ty = 0; pointer = false; nextLook = 1100; nextBlink = 1700; blinkStart = -1000
  seed: number; faceId: number; destroyed = false; reduced = false; paused = false; doubleBlink = false
  // Motion targets are resolved once; paint changes only their non-inherited transforms and each eye's blink.
  private targets: Record<string, Element> = {}; private eyes: Element[] = []; private written: Record<string, string> = {}
  get frameMs() { return (this.o.size ?? 24) <= 48 ? 1000 / 15 : FRAME_MS }
  needsFrame() {
    const nav = (this.o.size ?? 24) <= 48
    const blinking = this.blinkStart >= 0 && this.elapsed - this.blinkStart < 155
    return !nav || blinking || this.gesture > 0 || Math.abs(this.x-this.tx) > .01 || Math.abs(this.y-this.ty) > .01 || Math.abs(this.vx) > .01 || Math.abs(this.vy) > .01
  }
  nextWakeMs() { const elapsed = this.elapsed + Math.max(0, performance.now()-this.last); return Math.max(0, Math.min(this.pointer ? Infinity : this.nextLook-elapsed, this.nextBlink-elapsed)) }
  private onMove = (e: PointerEvent) => { if (!this.o.track || !this.canMove()) return; const r = this.el.getBoundingClientRect(); this.pointer = true; this.tx = Math.max(-4, Math.min(4, (e.clientX-r.left-r.width/2)/r.width*7)); this.ty = Math.max(-3, Math.min(3, (e.clientY-r.top-r.height/2)/r.height*5)); schedule() }
  private onLeave = () => { this.pointer = false; this.nextLook = this.elapsed + Math.max(0, performance.now()-this.last) + 200; this.tx = 0; this.ty = 0; schedule() }
  private onPress = () => this.boop()
  private onKey = (e: KeyboardEvent) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); this.boop() } }
  constructor(host: HTMLElement, options: Options) {
    this.el = host; this.o = options; this.paused = !!options.paused
    const identity = faceIdentity(options.name, options.family); this.seed = identity.key; this.faceId = ++serial
    const parts = { ...identity.features }
    for (const key of Object.keys(parts) as (keyof FaceFeatures)[]) { const n = options.features?.[key]; if (n !== undefined && Number.isFinite(n)) parts[key] = Math.max(0,Math.min(featureNames[key].length-1,Math.trunc(n))) }
    host.classList.add('pf'); host.dataset.family = identity.family; host.dataset.direction = options.direction ?? 'prism'; host.dataset.identity = String(identity.key)
    host.dataset.parts = JSON.stringify(parts); host.dataset.tier = (options.size ?? 24) <= 48 ? 'nav' : 'portrait'
    host.style.width = host.style.height = `${options.size ?? 24}px`
    host.innerHTML = template(this.faceId, parts, identity.family)
    const group = (c: string) => host.querySelector(`.pf-${c}`) ?? host
    const head = group('head'), top = group('top'), gaze = group('gaze')
    this.targets = { gaze, head, top }; this.eyes = Array.from(host.querySelectorAll('.pf-eye'))
    host.setAttribute('role', options.interactive ? 'button' : 'img')
    if (options.interactive) { host.tabIndex = 0; host.addEventListener('pointerdown', this.onPress); host.addEventListener('keydown', this.onKey) }
    if (options.track) { window.addEventListener('pointermove', this.onMove, { passive: true }); window.addEventListener('pointerleave', this.onLeave) }
    this.project(options.project, options.hue); this.status(options.status ?? 'waiting', true)
    live.add(this); observer?.observe(host); this.syncMotion(); schedule()
  }
  canMove() { return this.visible && !isAppSleeping() && !this.paused && !this.reduced && !document.hidden && this.state !== 'blocked' && this.state !== 'offline' && !this.destroyed }
  syncMotion() {
    this.reduced = !!media?.matches; this.el.dataset.motion = this.canMove() ? 'on' : 'off'; this.last = performance.now()
    if (this.reduced || this.paused || this.state === 'blocked' || this.state === 'offline') {
      this.gesture = 0; delete this.el.dataset.gesture
      this.x = this.y = this.vx = this.vy = this.ax = this.ay = this.avx = this.avy = 0
      this.paint({gx:0,gy:0,hx:0,hy:0,roll:0,ax:0,ay:0,blink:1,breath:0})
    }
    schedule()
  }
  pause(value: boolean) { this.paused = value; this.syncMotion() }
  project(name?: string, hue?: number) {
    const h = Number.isFinite(hue) ? ((hue! % 360) + 360) % 360 : projectHue(name ?? '')
    const h2 = this.o.secondHue ?? ((h + 56) % 360 < 55 ? h - 55 : (h + 56) % 360)
    this.el.style.setProperty('--project-a', `hsl(${h} 83% 63%)`)
    this.el.style.setProperty('--project-b', `hsl(${h2} 86% 66%)`)
    this.el.style.setProperty('--project-pale', `hsl(${h} 80% 88%)`)
    this.el.dataset.hue = String(h)
  }
  status(state: AgentStatus, initial = false) {
    if (!initial && this.state === state) return
    this.state = state; this.elapsed = 0; this.gesture = 0; this.blinkStart = -1000; this.nextBlink = 1300 + this.seed % 1100; this.nextLook = 900; this.doubleBlink = false
    this.pointer = false; this.tx = state === 'working' ? -1.5 : 0; this.ty = state === 'working' ? 1.2 : 0
    this.el.dataset.state = state; delete this.el.dataset.gesture
    this.el.setAttribute('aria-label', `${this.o.name || 'Agent'}: ${state.replace('-', ' ')}${this.o.interactive ? '. Tap to greet.' : ''}`)
    this.syncMotion()
    if (state === 'done' && !initial && this.canMove()) { this.gesture = 1550; this.el.dataset.gesture = 'celebrate' }
  }
  boop() { if (!this.o.interactive || !this.canMove() || this.state === 'needs-shaan') return; const now = performance.now(); this.elapsed += Math.max(0, now-this.last); this.last = now; this.gesture = 780; this.el.dataset.gesture = 'boop'; schedule() }
  random() { this.seed = (Math.imul(this.seed,1664525)+1013904223) >>> 0; return this.seed / 4294967296 }
  tick(time: number) {
    const elapsed = Math.max(0,time-this.last)
    const dt = Math.min(80,elapsed); this.last = time; this.elapsed += elapsed
    // Acting follows wall time; only physics is capped when the browser drops frames.
    if (this.gesture > 0) { this.gesture -= elapsed; if (this.gesture <= 0) delete this.el.dataset.gesture }
    if (this.elapsed >= this.nextLook && !this.pointer) {
      const focus = this.state === 'working'
      this.tx = (this.random()-.5) * (focus ? 3 : 5); this.ty = focus ? .5 + this.random() : (this.random()-.5)*2
      this.nextLook = this.elapsed + (focus ? 1200 : 2100) + this.random()*1700
    }
    if (this.elapsed >= this.nextBlink) {
      this.blinkStart = this.elapsed
      this.doubleBlink = !this.doubleBlink && this.random() < .18
      this.nextBlink = this.elapsed + (this.doubleBlink ? 260 : 2600 + this.random()*2400)
    }
    const age = this.elapsed - this.blinkStart, nav = (this.o.size ?? 24) <= 48
    // 4ms substeps preserve the damped spring response across frame rates.
    for (let remaining = dt / 1000; remaining > 0;) {
      const step = Math.min(.004,remaining); remaining -= step
      this.vx += (240*(this.tx-this.x)-19.5*this.vx)*step; this.vy += (240*(this.ty-this.y)-19.5*this.vy)*step
      this.x += this.vx*step; this.y += this.vy*step
      this.avx += (80*(this.x*.35-this.ax)-7.5*this.avx)*step; this.avy += (80*(this.y*.3-this.ay)-7.5*this.avy)*step
      this.ax += this.avx*step; this.ay += this.avy*step
    }
    const values = {gx:this.x,gy:this.y,hx:nav?0:this.x*.28,hy:nav?0:this.y*.2,roll:nav?0:this.x*.25,ax:nav?0:this.ax,ay:nav?0:this.ay,blink:age<155 ? 1-.93*Math.sin(age/155*Math.PI) : 1,breath:nav?0:Math.sin(this.elapsed/1050)*.8}
    // A fifth of a screen pixel (blink: 4% of the eye): finer steps cannot be seen, and a settled spring stops writing.
    const px = 112 / (this.o.size ?? 24) / 5
    const rounded: Record<string, number> = {}
    for (const [key,value] of Object.entries(values)) { const q = key === 'blink' ? .04 : key === 'roll' ? .1 : px; rounded[key] = Number((Math.round(value/q)*q).toFixed(3)) }
    this.paint(rounded)
  }
  private paint(v: Record<string, number>) {
    // Transforms do not inherit. Motion custom properties on an SVG group force WebKit to restyle its descendants.
    const transforms = { gaze: `translate(${v.gx}px,${v.gy}px)`, head: `translate(${v.hx}px,${v.hy+v.breath}px) rotate(${v.roll}deg)`, top: `translate(${v.ax}px,${v.ay}px)` }
    for (const [key,value] of Object.entries(transforms)) {
      if (this.written[key] === value) continue
      this.written[key] = value; (this.targets[key] as HTMLElement).style.transform = value
    }
    const blink = v.blink.toFixed(3)
    if (this.written.blink !== blink) { this.written.blink = blink; for (const eye of this.eyes) (eye as HTMLElement).style.setProperty('--blink', blink) }
  }
  destroy() {
    this.destroyed = true; live.delete(this); observer?.unobserve(this.el)
    window.removeEventListener('pointermove',this.onMove); window.removeEventListener('pointerleave',this.onLeave); this.el.removeEventListener('pointerdown',this.onPress); this.el.removeEventListener('keydown',this.onKey)
    this.el.innerHTML = ''; this.el.classList.remove('pf'); this.el.removeAttribute('tabindex')
    if (!live.size) { if (frame) { cancelAnimationFrame(frame); frame = 0 }; if (wakeTimer) { clearTimeout(wakeTimer); wakeTimer = 0; wakeDue = 0 } }
  }
}
