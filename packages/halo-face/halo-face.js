/* Halo's face engine: framework-free reference for the React port (<HaloFace/>).
   One face for every HALO app: the square screen face (Shaan's pick, 1 Oct 19:28) with a halo ring over it.
   new HaloFace(host, { size: 48, state: 'standby', eyes: true, halo: true, track: false, interactive: false, look: 'r2' | 'machined' | 'glass' | 'midnight' | 'split' | 'signal' })
   face.set(state, { variant, level, hold })   face.fact('heads-up' | 'problem' | null)
   face.gesture('shake' | 'tilt' | 'nod' | 'glint')   face.voice(0..1)  (real audio level; else simulated) */
(function (root) {
  'use strict';
  const STATES = ['standby', 'listening', 'thinking', 'talking', 'celebrating', 'heads-up', 'problem', 'asleep'];
  const GESTURE_MS = { shake: 450, tilt: 1300, nod: 520, glint: 720, cock: 1800, boop: 700 };
  const EYE = { lx: 39, rx: 61, y: 59, r: 6.2, g: 13 };
  // Where the eyes look in each state, in face units (100 = face width). null = idle saccades.
  const GAZE = { standby: null, listening: [0, 1], thinking: [-2.6, -2.6], talking: [0, 0], celebrating: [0, -1],
                 'heads-up': null, problem: [0, 2.2], asleep: [0, 1.2] };
  let uid = 0;
  const faces = new Set();
  const reduced = () => document.documentElement.classList.contains('rm') ||
    (root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const tierOf = (px) => (px < 22 ? 'xs' : px < 44 ? 'sm' : px < 112 ? 'md' : 'lg');
  const rand = (a, b) => a + Math.random() * (b - a);

  function template(u) {
    const e = EYE;
    const eye = (x) => `<g class="hf-eye"><g class="hf-eyein">
        <circle class="hf-eyeglow" cx="${x}" cy="${e.y}" r="${e.g}" fill="url(#hfeye${u})"/>
        <circle class="hf-pupil" cx="${x}" cy="${e.y}" r="${e.r}"/>
        <rect class="hf-pupil hf-pill" fill="url(#hfpill${u})" x="${x - 4.4}" y="${e.y - 7.6}" width="8.8" height="15.2" rx="4.4"/>
        <rect class="hf-pupil hf-sq" x="${x - 5.6}" y="${e.y - 5.6}" width="11.2" height="11.2" rx="3"/></g></g>`;
    const arc = (x) => `M${x - e.r * 1.25} ${e.y + 1.5} Q${x} ${e.y - e.r * 1.5} ${x + e.r * 1.25} ${e.y + 1.5}`;
    let grid = '';
    for (const v of [36.5, 50, 63.5]) grid += `<line x1="${v}" y1="32" x2="${v}" y2="86"/><line x1="23" y1="${v + 9}" x2="77" y2="${v + 9}"/>`;
    let parts = '';
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2 - Math.PI / 2, d = 44 + (i % 3) * 7;
      parts += `<circle class="hf-part ${i % 2 ? 'p2' : ''}" cx="50" cy="59" r="${i % 2 ? 1.7 : 2.5}" style="--dx:${(Math.cos(a) * d).toFixed(1)}px;--dy:${(Math.sin(a) * d).toFixed(1)}px;animation-delay:${(i % 3) * 40}ms"/>`;
    }
    const square = (cls, inset, extra = '') => `<rect class="${cls}" x="${10 - inset}" y="${19 - inset}" width="${80 + 2 * inset}" height="${80 + 2 * inset}" rx="${25 + inset}" ${extra}/>`;
    return `<svg viewBox="0 0 100 100" aria-hidden="true">
  <defs>
    <linearGradient id="hfband${u}" x1="0" y1="0" x2="1" y2="1">
      <stop class="c1" offset="0"/><stop class="c2" offset=".33"/><stop class="c3" offset=".62"/><stop class="c4" offset=".85"/><stop class="c1" offset="1"/>
      <animateTransform attributeName="gradientTransform" type="rotate" from="0 .5 .5" to="360 .5 .5" dur="9s" repeatCount="indefinite"/>
    </linearGradient>
    <linearGradient id="hfgloss${u}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".26"/><stop offset=".45" stop-color="#fff" stop-opacity="0"/></linearGradient>
    <linearGradient id="hfmetal${u}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#f3f2f6"/><stop offset=".28" stop-color="#8e8c97"/><stop offset=".5" stop-color="#e4e3e9"/><stop offset=".74" stop-color="#5c5a66"/><stop offset="1" stop-color="#c8c6cf"/></linearGradient>
    <linearGradient id="hfpill${u}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff"/><stop class="pl" offset="1"/></linearGradient>
    <linearGradient id="hfsheen${u}" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset=".5" stop-color="#fff" stop-opacity=".17"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>
    <linearGradient id="hfscr${u}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#25232d"/><stop offset="1" stop-color="#050508"/></linearGradient>
    <radialGradient id="hfwash${u}" cx=".5" cy=".62" r=".7"><stop class="w0" offset="0"/><stop class="w1" offset="1"/></radialGradient>
    <radialGradient id="hfglow${u}"><stop class="g0" offset=".35"/><stop class="g1" offset="1"/></radialGradient>
    <radialGradient id="hfeye${u}"><stop class="e0" offset="0"/><stop class="e1" offset="1"/></radialGradient>
    <linearGradient id="hfscan${u}" x1="0" y1="0" x2="0" y2="1"><stop class="w1" offset="0"/><stop class="c2" offset=".5" stop-opacity=".35"/><stop class="w1" offset="1"/></linearGradient>
    <radialGradient id="hffloor${u}"><stop offset="0" stop-color="#000" stop-opacity=".55"/><stop offset="1" stop-color="#000" stop-opacity="0"/></radialGradient>
    <radialGradient id="hfspill${u}"><stop class="g0" offset="0"/><stop class="g1" offset="1"/></radialGradient>
    <radialGradient id="hfvig${u}" cx=".5" cy=".5" r=".72"><stop offset=".6" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".32"/></radialGradient>
    <radialGradient id="hfhl${u}"><stop offset="0" class="hl0"/><stop offset="1" class="hl1"/></radialGradient>
    <clipPath id="hfwclip${u}"><rect x="35" y="66" width="30" height="20" rx="3"/></clipPath>
    <clipPath id="hfclip${u}"><rect x="23" y="32" width="54" height="54" rx="13"/></clipPath>
  </defs>
  <ellipse class="hf-spill" cx="50" cy="104" rx="40" ry="6" fill="url(#hfspill${u})"/>
  <ellipse class="hf-floor" cx="50" cy="104" rx="30" ry="3.4" fill="url(#hffloor${u})"/>
  <circle class="hf-glow" cx="50" cy="59" r="52" fill="url(#hfglow${u})"/>
  <g class="hf-ripples">${square('hf-rip', 0, 'fill="none" stroke-width="2"')}${square('hf-rip', 0, 'fill="none" stroke-width="2"')}${square('hf-rip', 0, 'fill="none" stroke-width="2"')}</g>
  ${square('hf-rim', 3.5, 'fill="none" stroke-width="2.2"')}
  <g class="hf-head"><g class="hf-lean"><g class="hf-bodyg">
    <rect class="hf-ear" x="3.5" y="50" width="8" height="18" rx="3"/><rect class="hf-ear" x="88.5" y="50" width="8" height="18" rx="3"/>
    <g class="hf-grooves"><path d="M5.5 55.5h4M5.5 59h4M5.5 62.5h4M90.5 55.5h4M90.5 59h4M90.5 62.5h4" stroke-width=".8" stroke-linecap="round"/></g>
    ${square('hf-shell', 0, 'fill="#121219"')}
    <rect class="hf-band" x="14.5" y="23.5" width="71" height="71" rx="21" fill="none" stroke="url(#hfband${u})"/>
    <rect class="hf-gloss" x="14.5" y="23.5" width="71" height="71" rx="21" fill="none" stroke="url(#hfgloss${u})"/>
    <rect class="hf-metal" x="14.5" y="23.5" width="71" height="71" rx="21" fill="none" stroke="url(#hfmetal${u})"/>
    <ellipse class="hf-halolight" cx="50" cy="23.5" rx="22" ry="3.2" fill="url(#hfhl${u})"/>
    <rect class="hf-bezel" x="20" y="29" width="60" height="60" rx="16" fill="#08080c" stroke="#2b2a33" stroke-width=".8"/>
    <rect x="23" y="32" width="54" height="54" rx="13" fill="url(#hfscr${u})"/>
    <rect class="hf-wash" x="23" y="32" width="54" height="54" rx="13" fill="url(#hfwash${u})"/>
    <rect class="hf-vig" x="23" y="32" width="54" height="54" rx="13" fill="url(#hfvig${u})"/>
    <g class="hf-grid" stroke-width=".55" clip-path="url(#hfclip${u})">${grid}</g>
    <g clip-path="url(#hfclip${u})"><rect class="hf-scan" x="23" y="26" width="54" height="10" fill="url(#hfscan${u})"/></g>
    <g clip-path="url(#hfclip${u})"><rect class="hf-level" x="23" y="32" width="54" height="54"/></g>
    <rect class="hf-led" x="45" y="93.2" width="10" height="2.2" rx="1.1"/>
    <rect class="hf-edge" x="20" y="29" width="60" height="60" rx="16" fill="none" stroke="url(#hfband${u})"/>
    <g class="hf-disp" clip-path="url(#hfclip${u})">
      <g class="hf-eq">${[41, 45.5, 50, 54.5, 59].map((x, i) => `<rect x="${x - 1.3}" y="70" width="2.6" height="10" rx="1.3" style="--k:${[.55, .85, 1, .8, .5][i]}"/>`).join('')}</g>
      <g class="hf-wave" clip-path="url(#hfwclip${u})"><path d="M10 76 ${Array.from({ length: 16 }, (_, i) => `q2.5 ${i % 2 ? 5 : -5} 5 0`).join(' ')}" fill="none" stroke-width="1.6" stroke-linecap="round"/></g>
      <g class="hf-dots"><circle cx="44" cy="76" r="1.9"/><circle cx="50" cy="76" r="1.9"/><circle cx="56" cy="76" r="1.9"/></g>
      <g class="hf-bar"><rect x="32" y="77" width="36" height="2" rx="1" class="hf-bar-track"/><rect x="32" y="77" width="11" height="2" rx="1" class="hf-bar-run"/></g>
      <g class="hf-brows"><path d="M31.5 49.5 L43 46.5 M57 46.5 L68.5 49.5" fill="none" stroke-width="2.2" stroke-linecap="round"/></g>
      <g class="hf-zz"><text x="58" y="49" font-size="9" class="z1">z</text><text x="65" y="42" font-size="6.5" class="z2">z</text></g>
      <g class="hf-stars">${[[31, 41, 1], [69, 44, .8], [64, 78, .7], [34, 76, .9]].map(([x, y, k], i) => `<path class="hf-star" style="--d:${i * 0.18}s" d="M${x} ${y - 3 * k} l${0.8 * k} ${2.2 * k} ${2.2 * k} ${0.8 * k} ${-2.2 * k} ${0.8 * k} ${-0.8 * k} ${2.2 * k} ${-0.8 * k} ${-2.2 * k} ${-2.2 * k} ${-0.8 * k} ${2.2 * k} ${-0.8 * k}z"/>`).join('')}</g>
      <rect class="hf-sheen" x="5" y="20" width="20" height="80" fill="url(#hfsheen${u})"/>
    </g>
    <rect class="hf-glass" x="23.6" y="32.6" width="52.8" height="52.8" rx="12.4" fill="none" stroke="#fff" stroke-opacity=".09" stroke-width="1.2"/>
    <g class="hf-eyes">${eye(e.lx)}${eye(e.rx)}
      <path class="hf-happy" d="${arc(e.lx)} ${arc(e.rx)}" fill="none" stroke-width="3.6" stroke-linecap="round"/></g>
    <g class="hf-glassfx" clip-path="url(#hfclip${u})">
      <path class="hf-refl" d="M24 41 Q30 33.5 47 33.2 L62 33.2 Q44 35.5 33 39.5 Q27 42 24 47 Z" fill="#fff"/>
    </g>
    <g clip-path="url(#hfclip${u})"><rect class="hf-lid" x="23" y="32" width="54" height="54"/></g>
    <path class="hf-glint" d="M82 22 l1.6 4.4 4.4 1.6 -4.4 1.6 -1.6 4.4 -1.6 -4.4 -4.4 -1.6 4.4 -1.6z"/>
  </g></g></g>
  <g class="hf-halofollow"><g class="hf-halo"><g class="hf-haloin">
    <ellipse class="hf-halo-soft" cx="50" cy="8" rx="25" ry="5.8" fill="none" stroke-width="7"/>
    <ellipse class="hf-halo-line" cx="50" cy="8" rx="25" ry="5.8" fill="none" stroke-width="3"/>
    <ellipse class="hf-trail" cx="50" cy="8" rx="25" ry="5.8" fill="none" stroke-width="3.2" stroke-linecap="round" pathLength="100"/>
    <circle class="hf-spark" r="2.4" fill="#fff"><animateMotion dur="1.6s" repeatCount="indefinite" path="M25 8 a25 5.8 0 1 0 50 0 a25 5.8 0 1 0 -50 0"/></circle>
  </g></g></g>
  <g class="hf-parts">${parts}</g>
</svg>`;
  }

  class HaloFace {
    constructor(host, opts = {}) {
      this.o = Object.assign({ size: 48, state: 'standby', eyes: true, halo: true, look: 'r2', track: false, interactive: false }, opts);
      this.u = ++uid;
      this.el = host;
      host.classList.add('hf');
      host.style.width = host.style.height = this.o.size + 'px';
      host.dataset.tier = tierOf(this.o.size);
      host.dataset.look = this.o.look;
      if (!this.o.eyes) host.dataset.eyes = 'off';
      if (!this.o.halo) host.dataset.halo = 'off';
      host.setAttribute('role', 'img');
      host.innerHTML = template(this.u);
      byEl.set(host, this);
      this.svg = host.querySelector('svg');
      // Agent Base P0 (2 Oct): a page of small faces animating every frame pinned WebKit at ~90% CPU and churned
      // ~1 GB a minute. Only a face that follows the pointer, takes clicks or is large stays alive; the rest are still.
      // (Patched in the vendored copy for the incident; port to @halo/ui/agent-face before the next sync.)
      this.still = !this.o.track && !this.o.interactive && this.o.size < 64;
      if (this.still) { host.classList.add('rm'); this.svg.pauseAnimations(); }
      this.base = 'standby';
      this.lvl = 0; this.target = 0; this.ext = null;
      this.nextBlink = performance.now() + rand(1500, 4500);
      this.nextGaze = 0; this.nextSyll = 0;
      // springs: eyes (ex, ey) chase the gaze target; the head follows the eyes; the halo lags the head
      this.tx = 0; this.ty = 0; this.ex = 0; this.ey = 0; this.evx = 0; this.evy = 0;
      this.lx = 0; this.ly = 0; this.lvx = 0; this.lvy = 0; this.last = performance.now(); this.wrote = '';
      host.dataset.spring = '';
      if (this.o.interactive) {
        host.style.cursor = 'pointer';
        host.addEventListener('pointerdown', () => this.boop());
      }
      this.set(this.o.state, this.o);
      faces.add(this);
      this.visible = true;
      if (seen) seen.observe(host);
      if (reduced()) this.svg.pauseAnimations();
      if (dozing && !this.still) { host.dataset.doze = ''; this.svg.pauseAnimations(); }
      kick();
    }
    set(state, o = {}) {
      if (!STATES.includes(state)) throw new Error('HaloFace: unknown state ' + state);
      clearTimeout(this.backT);
      const el = this.el;
      if (state === 'celebrating') {
        // restart the one-shot animations, then return to the looping state underneath
        el.dataset.state = 'standby'; void el.getBoundingClientRect();
        const hold = o.hold || (o.variant === 'big' ? 5200 : 3200);
        if (!o.stay) this.backT = setTimeout(() => this.set(this.base), hold);
      } else {
        this.base = state;
      }
      if (el.dataset.state === 'asleep' && state !== 'asleep') {
        // waking: the screen powers on from a line, like an old monitor
        delete el.dataset.wake; void el.getBoundingClientRect(); el.dataset.wake = '';
        clearTimeout(this.wT); this.wT = setTimeout(() => delete el.dataset.wake, 520);
      }
      el.dataset.state = state;
      if (o.variant) el.dataset.variant = o.variant; else delete el.dataset.variant;
      if (o.level != null) el.style.setProperty('--level', Math.max(0, Math.min(1, o.level)));
      el.setAttribute('aria-label', 'Halo: ' + state + (o.variant ? ' (' + o.variant + ')' : ''));
      const g = GAZE[state];
      this.look(g ? g[0] : 0, g ? g[1] : 0);
      this.nextGaze = performance.now() + rand(1200, 2500);
      return this;
    }
    fact(kind) { if (kind) this.el.dataset.fact = kind; else delete this.el.dataset.fact; return this; }
    gesture(name) {
      const el = this.el;
      delete el.dataset.gesture; void el.getBoundingClientRect();
      el.dataset.gesture = name;
      clearTimeout(this.gT);
      this.gT = setTimeout(() => delete el.dataset.gesture, GESTURE_MS[name] || 600);
      return this;
    }
    // A real level keeps the faces awake: he is talking, not idle (Agent Base t-0271; patched in the vendored copy).
    voice(level) { this.ext = level; if (level != null) awake(); return this; }
    look(x, y) {
      this.tx = x; this.ty = y;
      if (reduced()) { this.ex = x; this.ey = y; this.paint(true); }
    }
    blink() {
      const el = this.el;
      if (el.dataset.state === 'asleep' || el.dataset.state === 'celebrating') return;
      el.dataset.blink = ''; setTimeout(() => delete el.dataset.blink, 170);
    }
    boop() {
      // a tap: squash and stretch, happy eyes for a moment
      const el = this.el;
      this.gesture('boop');
      el.dataset.boop = ''; clearTimeout(this.bT); this.bT = setTimeout(() => delete el.dataset.boop, 750);
      return this;
    }
    paint(still) {
      const el = this.el, f = (v) => v.toFixed(2);
      const hx = this.ex * 0.32, hy = this.ey * 0.22;
      const key = f(this.ex) + f(this.ey) + f(this.lx) + f(this.ly);
      if (key === this.wrote) return;
      this.wrote = key;
      el.style.setProperty('--gx', f(this.ex)); el.style.setProperty('--gy', f(this.ey));
      el.style.setProperty('--hx', f(still ? 0 : hx)); el.style.setProperty('--hy', f(still ? 0 : hy));
      el.style.setProperty('--lx', f(still ? 0 : this.lx)); el.style.setProperty('--ly', f(still ? 0 : this.ly));
      // big faces turn a little in 3D toward where they look
      el.style.transform = !still && el.dataset.tier === 'lg' ? `perspective(800px) rotateY(${f(this.ex * 1.7)}deg) rotateX(${f(-this.ey * 1.5)}deg)` : '';
    }
    destroy() { faces.delete(this); if (seen) seen.unobserve(this.el); clearTimeout(this.backT); clearTimeout(this.gT); this.el.innerHTML = ''; }
    tick(now) {
      const st = this.el.dataset.state;
      if (now > this.nextBlink) {
        this.nextBlink = now + rand(3200, 6800);
        this.blink();
        if (Math.random() < 0.18) setTimeout(() => this.blink(), 240); // now and then a double blink
      }
      if (this.o.track && pointer.t && now - pointer.t < 2500 && (st === 'standby' || st === 'listening' || st === 'talking')) {
        // eyes follow the pointer while it is moving nearby
        const r = this.el.getBoundingClientRect(), dx = pointer.x - (r.left + r.width / 2), dy = pointer.y - (r.top + r.height / 2);
        const d = Math.hypot(dx, dy) || 1, k = Math.min(1, d / 300);
        this.look((dx / d) * 3.4 * k, (dy / d) * 2.6 * k);
        // a pointer close to the face gets noticed: eyes widen a touch
        if (d < r.width * 0.85) this.el.dataset.notice = ''; else delete this.el.dataset.notice;
        this.nextGaze = now + 1800;
      } else if (now > this.nextGaze) {
        if (this.el.dataset.notice != null) delete this.el.dataset.notice;
        if (st === 'standby') {
          // idle life: mostly small saccades, sometimes a look around, a head tilt or a glance up at the halo
          const r = Math.random(), alive = () => this.el.dataset.state === 'standby';
          if (r < 0.14) {
            this.look(-3, 0.4);
            setTimeout(() => alive() && this.look(3, 0.2), 950);
            setTimeout(() => alive() && this.look(0, 0), 1900);
            this.nextGaze = now + rand(4200, 6500);
          } else if (r < 0.22) {
            this.gesture('cock'); this.look(1.4, -0.6); this.nextGaze = now + rand(2600, 4200);
          } else if (r < 0.28) {
            this.look(0, -3); setTimeout(() => alive() && this.look(0, 0), 900); this.nextGaze = now + rand(2600, 4200);
          } else { this.look(rand(-1.6, 1.6), rand(-1, 1)); this.nextGaze = now + rand(2200, 5000); }
        }
        else if (st === 'heads-up') {
          // glance toward the issue, then back
          this.look(3, 0.5); setTimeout(() => this.el.dataset.state === 'heads-up' && this.look(0, 0), 700);
          this.nextGaze = now + 3000;
        } else if (st === 'thinking') { this.look(rand(-3.2, -1.8), rand(-3, -2)); this.nextGaze = now + rand(500, 900); }
        else this.nextGaze = now + 1000;
      }
      // springs, integrated per frame: eyes slightly underdamped (they overshoot and settle), halo looser still
      // fixed 4 ms sub-steps, so the springs feel the same at 30, 60 or 120 fps
      const span = Math.min(0.1, (now - this.last) / 1000); this.last = now;
      const n = Math.ceil(span / 0.004), dt = span / Math.max(1, n);
      for (let i = 0; i < n; i++) {
        let a = 240 * (this.tx - this.ex) - 19.5 * this.evx; this.evx += a * dt; this.ex += this.evx * dt;
        a = 240 * (this.ty - this.ey) - 19.5 * this.evy; this.evy += a * dt; this.ey += this.evy * dt;
        a = 80 * (this.ex * 0.55 - this.lx) - 7.5 * this.lvx; this.lvx += a * dt; this.lx += this.lvx * dt;
        a = 80 * (this.ey * 0.4 - this.ly) - 7.5 * this.lvy; this.lvy += a * dt; this.ly += this.lvy * dt;
      }
      this.paint(false);
      if (st === 'talking' || st === 'listening') {
        if (this.ext != null) this.target = this.ext;
        else if (now > this.nextSyll) {
          // simulated voice: syllables ~110-200 ms, a pause every so often
          this.target = Math.random() < 0.12 ? 0 : rand(st === 'talking' ? 0.35 : 0.15, st === 'talking' ? 1 : 0.7);
          this.nextSyll = now + rand(110, 200);
        }
        this.lvl += (this.target - this.lvl) * 0.35;
        this.el.style.setProperty('--lvl', this.lvl.toFixed(3));
      } else if (this.lvl) { this.lvl = 0; this.el.style.setProperty('--lvl', 0); }
    }
  }

  const pointer = { x: 0, y: 0, t: 0 };
  // Agent Base t-0237 (2 Oct 21:21: the app idle on screen held WebKit at ~27-40% CPU): a live face (Agent Zero's,
  // bottom-right) ran its springs, CSS and SMIL every frame forever. Now the faces doze once nobody has touched the
  // window for DOZE_MS (or it is hidden): every animation holds its frame and the frame loop stops; the first pointer
  // move, key or scroll wakes them. The loop also stops whenever no face needs a frame.
  // (Patched in the vendored copy for the incident; port to @halo/ui/agent-face before the next sync.)
  const DOZE_MS = 20000;
  let input = performance.now(), dozing = false, running = false;
  const doze = (on) => {
    if (on === dozing) return;
    dozing = on;
    for (const f of faces) {
      if (f.still) continue;
      if (on) { f.el.dataset.doze = ''; f.svg.pauseAnimations(); }
      else { delete f.el.dataset.doze; f.last = performance.now(); if (f.visible && !reduced()) f.svg.unpauseAnimations(); }
    }
    if (!on) kick();
  };
  const awake = () => { input = performance.now(); if (dozing && !document.hidden) doze(false); };
  root.addEventListener('pointermove', (e) => { pointer.x = e.clientX; pointer.y = e.clientY; pointer.t = performance.now(); awake(); }, { passive: true });
  for (const t of ['pointerdown', 'keydown', 'wheel']) root.addEventListener(t, awake, { passive: true, capture: true });
  document.addEventListener('visibilitychange', () => (document.hidden ? doze(true) : awake()));
  // an off-screen face costs nothing: its CSS and SMIL animations pause and its per-frame work stops
  const byEl = new WeakMap();
  const seen = root.IntersectionObserver ? new IntersectionObserver((entries) => {
    for (const en of entries) {
      const f = byEl.get(en.target); if (!f) continue;
      f.visible = en.isIntersecting;
      if (f.visible) { delete f.el.dataset.off; f.last = performance.now(); if (!reduced() && !f.still && !dozing) f.svg.unpauseAnimations(); kick(); }
      else { f.el.dataset.off = ''; f.svg.pauseAnimations(); }
    }
  }, { rootMargin: '120px' }) : null;
  function loop(now) {
    if (now - input > DOZE_MS) doze(true);
    let live = false;
    if (!dozing && !reduced()) for (const f of faces) if (f.visible && !f.still) { f.tick(now); live = true; }
    running = live;
    if (live) requestAnimationFrame(loop);
  }
  function kick() {
    if (running || dozing) return;
    running = true;
    requestAnimationFrame(loop);
  }
  HaloFace.STATES = STATES;
  HaloFace.setReducedMotion = function (on) {
    document.documentElement.classList.toggle('rm', on);
    if (!on) kick();
    for (const f of faces) {
      on || !f.visible || f.still || dozing ? f.svg.pauseAnimations() : f.svg.unpauseAnimations();
      if (on) { const g = GAZE[f.el.dataset.state]; f.look(g ? g[0] : 0, g ? g[1] : 0); f.el.style.setProperty('--lvl', 0); f.wrote = ''; f.paint(true); }
    }
  };
  root.HaloFace = HaloFace;
})(window);
