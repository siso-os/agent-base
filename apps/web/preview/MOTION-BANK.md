# Agent Base motion bank

Twelve reusable React components, specified and built by twelve GPT-6.1 Sol workers, with one parent-reviewed local gallery. The five earlier workspace ideas and seven chat/header ideas are implemented beside the existing approved faces, marks, icons and previews.

[Open the review gallery](http://127.0.0.1:8891/card/agent-motion-bank-20261006/html). Each sidebar item has a stable URL fragment, working fixture controls, Pause motion and Reset example. Only the selected demo is mounted. Mobile navigation scrolls horizontally.

The concrete briefs are in [MOTION-BANK-BRIEFS.md](./MOTION-BANK-BRIEFS.md). [motion-bank-manifest.json](./motion-bank-manifest.json) indexes the source, style, exported demo and review URL for every component. [motion-bank-proof.json](./motion-bank-proof.json) records parent verification and source hashes. The HTML entry is `motion-bank.html`; the React gallery entry is `motion-bank.tsx`.

## Components and boundaries

| Component | Job and caller-owned state | User interaction |
| --- | --- | --- |
| `ChatActivityRail` | Thinking, command execution, compaction and delegation; status, output, exit code, checkpoint counts and assignment/start/return receipts are supplied separately | Expand results, inspect a worker; failed operations stay still |
| `ChatLinkPreview` | Supplied title, destination and metadata status in a small browser frame; no fetch on disclosure | Expand, retry metadata, request the destination through the existing page-tab owner |
| `TalkOrb` | Idle, starting, listening, writing, ready and error; phase, normalized level and transcript come from the voice owner | Start, stop, cancel, retry and explicitly accept the supplied transcript; 32/40/104px variants |
| `InfrastructurePopover` | Health, Efficiency and Estate with separate agent status and machine observations | Hover into the panel, pin it, use keyboard/touch disclosure, request the selected agent's chat |
| `VersionPulse` | Supplied web, node and desktop versions; checking/current/available/applying/failed/unknown | Review release changes, request a web reload, wait for the caller's confirmed loaded version |
| `AgentNotificationStack` | Supplied unread/reaction records and owner identity; async mark/reply callbacks | Read, react, type multiline replies, explicitly send, retain draft after rejection |
| `TodaySpendDial` | Supplied snapshot, freshness, date and project amounts; Claude USD-equivalent and Codex credit ranges remain separate | Open the breakdown, select a project, request its dashboard; 24/32px icon variants |
| `WorkspaceArrival` | Selected owner/worker, collapsed crews and destination identity | Switch workspaces while preserving worker nesting and selection |
| `ContextStack` | Source identity, kind and caller-supplied loading/ready/failed state | Inspect and remove sources; the demo explicitly supplies completion/failure |
| `ChangeLens` | Two supplied views and their supplied changed lines | Drag or keyboard-scrub before/after, switch to code, inspect a replacement comparison |
| `SessionReplay` | An immutable recorded event sequence and controlled cursor | Step or scrub through normal/failure recordings; handle an empty recording |
| `WorkspaceCommandPalette` | Supplied destinations, query, active result and open state | Search, move with arrows, choose with Enter, close with Escape and restore trigger focus |

Import individual primary components from `apps/web/src/components/<Name>`. Each file also exports its data/prop types and `<Name>Demo`. Demos share `MotionBankDemoProps` from `motion-bank-shared.ts`:

```tsx
<ChatActivityRailDemo paused={paused} resetKey={resetKey} />
```

The gallery remounts the selected demo on reset. Primary component callbacks are requests to the caller, not a substitute for application routing or service state.

## Existing source reused

The components import the actual `AgentFace`, `LivingIcon` and `WorkspaceMark` exports from `packages/halo-face/living-assets`. The blue Agent Base lion, copper SISO lion, pearl HALO mark, face geometry, palettes, crowns, navigation icons and previous previews are preserved.

The workers reviewed existing sidebar/worker, chat, context, notification, version, spend and voice contracts. Read-only reference inspection included the current `ui-opus` voice and header implementations where this branch was older. The reusable voice control does not import that live runtime. Notification callbacks retain the existing `NotificationBellProps` contract; version data uses `AppVersion`; the spend boundary adapter accepts `SpendResponse` without importing its polling store.

Each worker ran one bounded UI-bank lookup and recorded its selected references. The twelve reports, rankings and original dispatch receipt are saved in `_data/faces/original-evolved-20261005/round5-*`.

## Truth and motion

Animation never creates a successful command, compacted checkpoint, child return, loaded page, transcript, accepted notification, applied release or spend observation. Demo result buttons explicitly supply synthetic state. The main gallery labels these as examples and marks live wiring pending.

- A completed chat operation does not invent a delegation return. Assignment pending, child started and result returned remain distinct supplied receipts.
- A link disclosure uses supplied metadata and accepts only HTTP(S) destinations without credentials. It sends an open request to its caller. It does not fetch a thumbnail or open a browser itself.
- TalkOrb requests no microphone access. Only the supplied level drives its listening response. Accept passes the exact supplied transcript to its caller.
- Version requests leave the current version unchanged until the caller confirms application. Desktop updates are identified as requiring the separate installer/rebuild path.
- Notification actions lock while pending. Read/reaction state follows supplied records; rejection keeps the draft and permits retry. Enter inserts a newline; Send reply is explicit. A completed outside click dismisses the panel without consuming the clicked action.
- Spend pending is not zero. Dollars and credits are never added. Stale and unavailable data remains labelled.
- Replay moves a read-only cursor; it cannot dispatch or replay real commands. ChangeLens displays supplied evidence and does not reconstruct repository diffs from chat telemetry.

`useMotionGate` supplies one shared policy: paused, offscreen, hidden document or reduced motion suppresses presentation movement. New animations use finite CSS gestures. The components add no polling, frame loop or timer that advances business state. Observers and event listeners are removed on unmount. Existing asset scheduler ownership remains unchanged.

## Verification and reuse

Parent checks cover the combined strict TypeScript build, one self-contained esbuild bundle, all twelve components at 1440/1008/390px, opened mobile states, unique SVG IDs, controlled callbacks, keyboard controls, failures and draft retention. Lifecycle checks cover pause, live reduced-motion changes, hidden documents, offscreen state, listener/observer cleanup and no frames after unmount. Gallery checks cover pause/resume, reset, deep links, browser back and keyboard skip navigation. Opened desktop and mobile captures were visually inspected.

The saved `round5-build.mjs`, `tsconfig-round5.json`, `round5-smoke.mjs`, `round5-interactions.mjs` and `round5-lifecycle.mjs` reproduce the checks using existing installed dependencies. Heavy commands run through `heavy --`; test-owned browsers and temporary servers close in `finally`. Detailed receipts and screenshots live beside those scripts. Failed development receipts are retained; the proof file identifies the passing receipts for each final component.

This delivery is a reviewed component bank on the isolated `codex/agent-face-prism-20261005` branch. Main-application wiring, real microphone integration, real page-tab opening, live notification delivery, updater execution and live spend data are pending. The supplied examples prove presentation and callback behavior, not those integrations.
