/* Agent faces: HaloFace (halo-face.js, load it first) per agent, coloured by project, state by status.
     const f = HaloFace.agent(host, { project: 'halo', status: 'working', size: 24 })
     f.status('needs-shaan')   f.project('agent-stack')   f.destroy()
   status: working | waiting | needs-shaan | blocked | done | offline. hue (0-360) overrides the project's; name labels it. */
(function (root) {
  'use strict';
  const HF = root.HaloFace;
  if (!HF) throw new Error('agent-face.js: load halo-face.js first');
  const STATUS = {
    working: { state: 'thinking' },
    waiting: { state: 'standby' },
    'needs-shaan': { state: 'standby', fact: 'heads-up' },
    blocked: { state: 'problem' },
    done: { state: 'asleep', gesture: 'nod' },
    offline: { state: 'asleep', variant: 'offline' },
  };
  // Agent Base's own project hash (apps/web/src/components/ChatView.tsx hueOf)
  const hueOf = (s) => { let h = 0; for (const ch of String(s)) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return h % 360; };
  // red, orange and amber mean "blocked" and "needs you", so no project may look like them: a project whose hue lands
  // there is turned to the opposite side of the wheel. Use projectHue() for the project's chat colour too, so they match.
  const projectHue = (s) => { const h = hueOf(s); return h >= 340 || h < 55 ? (h + 180) % 360 : h; };
  // four stops from one hue, shaped like HALO's own standby palette (strong, light, a neighbour hue, a pale)
  const tints = (h) => [`hsl(${h} 90% 55%)`, `hsl(${h} 95% 70%)`, `hsl(${(h + 35) % 360} 80% 62%)`, `hsl(${h} 90% 80%)`];
  function paint(el, hue) { tints(hue).forEach((c, i) => el.style.setProperty('--t' + (i + 1), c)); el.dataset.tint = String(hue); }
  HF.agent = function (host, o = {}) {
    const face = new HF(host, { size: o.size || 24, look: o.look || 'machined', state: 'standby', track: !!o.track, interactive: !!o.interactive });
    const el = face.el;
    let cur = null;
    const api = {
      face, el,
      project(name, hue) { paint(el, hue != null ? hue : projectHue(name || '')); return api; },
      status(s) {
        const m = STATUS[s] || STATUS.waiting;
        if (s === cur) return api;
        const was = cur; cur = s;
        el.dataset.agent = s in STATUS ? s : 'waiting';
        face.fact(m.fact || null);
        face.set(m.state, m.variant ? { variant: m.variant } : {});
        if (m.gesture && was) face.gesture(m.gesture);
        el.setAttribute('aria-label', (o.name || 'Agent') + ': ' + s.replace('-', ' '));
        return api;
      },
      destroy() { face.destroy(); },
    };
    api.project(o.project, o.hue).status(o.status || 'waiting');
    return api;
  };
  HF.agent.STATUS = Object.keys(STATUS);
  HF.agent.hueOf = hueOf;
  HF.agent.projectHue = projectHue;
})(window);
