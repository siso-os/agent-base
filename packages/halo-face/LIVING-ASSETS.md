# SISO living assets

Preview: http://127.0.0.1:8891/card/agent-living-assets-20261006/html

This review kit adds to the approved blue Agent Base lion, copper SISO Agency lion, pearl HALO mark and crowned Claude/Codex family. Those components and their geometry are unchanged in this round. Beacon is an additional Agent Base logo candidate. The app's navigation has not been switched to it.

## Use in React

Keep the source files together and import `living-assets.ts`. React 19 and a bundler that loads CSS are required; there is no icon animation dependency. The standalone entry does not load the original HaloFace global controller. Existing Agent Base consumers can keep using `index.ts`, which retains that controller for compatibility.

```tsx
import { AgentFace, WorkspaceMark, LivingIcon } from './living-assets'

<AgentFace name="Astra" family="codex" size={32} features={{ top: 6 }} />
<WorkspaceMark brand="siso-agency" size={48} />
<LivingIcon name="car-rental" size={144} interactive />
```

For navigation, let the actual destination button or link own interaction. Pass its hover/focus state to the icon; leave the icon's `interactive` prop false so the link is the only keyboard stop.

```tsx
const [engaged, setEngaged] = useState(false)
<a href="/library" onPointerEnter={() => setEngaged(true)}
  onPointerLeave={() => setEngaged(false)} onFocus={() => setEngaged(true)}
  onBlur={() => setEngaged(false)}>
  <LivingIcon name="library" size={32} variant="glyph" active={engaged} />
  Great Library of SISO
</a>
```

`LivingIcon` props: `name`, `size` (32 default), `variant` (`tile` default or `glyph`), `active`, `paused`, `interactive`, numeric `replay`, `title`, and `className`. Increment `replay` for another 1–1.3 second gesture. `interactive` supplies hover, keyboard focus and click/Enter/Space replay on a standalone sample. `demo` loops only when explicitly enabled for comparison; leave it false in app navigation. Passing a descriptive `title` sets the accessible name.

The fifteen names are `car-rental`, `ofm`, `ecommerce`, `restaurants`, `tour-guides`, `crypto-trading`, `library`, `estate`, `web`, `whatsapp`, `lifelog`, `rolodex`, `siso-voice`, `agent-base`, and `maths-innovations`. `LIVING_ICONS` exposes each label, material palette, description and gesture. Estate and LifeLog deliberately use one icon in both their project card and sidebar entry. The WhatsApp design is a custom navigation treatment, not a replacement official brand asset.

## Motion contract

New icons are still at rest. Each engagement plays once and settles; no JavaScript frame loop runs for icons. Offscreen, hidden document, `paused` and native reduced-motion settings remove animation. Replay timeouts and observers are cleaned up on unmount. SVG IDs are unique within a React root. Applications with multiple independently mounted React roots should supply a distinct React `identifierPrefix` for each root. The earlier AgentFace and WorkspaceMark motion contracts are documented in README.md.

The glyph variant enlarges the object for 24/32/48 px navigation. The tile adds a machined glass housing for project and industry cards. `size` is the actual bounding box. SVG files in the download are still fallbacks for non-React surfaces; use the React component for gestures. If inserting an exported SVG's markup directly more than once, prefix its IDs; `<img src="...svg">` naturally isolates them.

## Export and review

`apps/web/preview/living-atlas.html` is the source gallery. With repository dependencies installed, run:

```sh
heavy -- node apps/web/preview/export-living-kit.mjs /absolute/existing/output-directory
```

`LIVING_ASSET_DEPS=/absolute/other/checkout` optionally reuses an existing checkout's dependencies without installing into an isolated worktree. The script uses existing Vite/esbuild, React, Node and Python 3's standard zip library. It writes a self-contained HTML gallery and a ZIP containing this package's source, fifteen tile SVGs, fifteen glyph SVGs, the three approved Prism marks, and a catalogue/receipt. It does not publish or contact live services. A host with a download sandbox can provide `LIVING_KIT_URL` pointing at its existing file-serving route; the console delivery uses a content-hashed ZIP in its static directory, opened only when the user clicks. No console sandbox policy is changed.

The five `MotionWorkbench` proposals use local synthetic data: context interpolation, model selection, composer acknowledgement, owner disclosure and task completion. Start with model confirmation, composer receipt and task checks. The production composer must confirm only after server acceptance; context must animate an actual reading; model changes need real available-model data. Counts in this preview are derived from its fixture. Live integration, production data and the packaged desktop app remain outside this review.
