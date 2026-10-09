# @siso/composer

The existing input-bar presentation extracted from Agent Base for reuse by SISO apps. This is the same rim material,
model cast, context ring, usage card, activity pill/grouped popup and artifact shelf. Application facades now render
these components; this package is not a parallel mockup.

## Boundary

The package has **no requests, sockets, account readers, storage, application event bus, provider catalog or agent/session types**.
React and React DOM are its only peer dependencies. The application supplies data and callbacks. `ComposerFrame`
receives the existing `HaloRim` component from `@siso/shell` through its `surface` prop: the glow is not copied or redrawn.
Identity visuals are ReactNode slots, so an application can use `AgentFace` with an explicit family or its own identity component.
The existing CSS class names are retained to preserve the rendered material and current app selectors.

## Public components

| Component | Inputs | Owns |
| --- | --- | --- |
| `ComposerFrame` | `surface`, `state`, `hue`, input `children`, `hud`, `acceptedReceipt` | Input/HUD composition and a bounded acceptance receipt |
| `ComposerHud` | `identity`, `context`, `usage`, `metrics`, `rate`, `activity`; or `variant="strip"`, `items`, `trailing` | Existing responsive row and strip layout |
| `ContextMeter` | measured `value: number \| null`, optional `label`, `compactAt` | One 650 ms cubic transition shared by arc and number |
| `ContextPopover` | measured `value`, `title`, `children`, `onOpenChange` | Context summary and hover/tap details surface |
| `UsagePopover` | `windows`, optional `freshness: {label, detail}`, card `children` | Threshold-colored compact limits and details surface |
| `UsageRingCard` / `UsageRing` | raw percentages, labels, supplied reset descriptions, note/footer slots | Existing ring geometry/material; no clock/account inference |
| `ModelPicker` | observed `selection.model`, `selectedId`, real model `options`, effort options, callbacks; identity/actions/footer slots | Cast, card, keyboard navigation, portal positioning and acknowledged-value arrival |
| `ActivityPill` | projected faces, counts, status/rate labels, controlled `open`, `onOpenChange`, optional refs | Face stack, existing ring motion, hover/click affordance |
| `ActivityPopover` | projected groups, items, progress tones, utilities, finished items, heading, note/loading, position, callbacks | Group cards, item tiles, utility controls and finished-row expansion |
| `ArtifactShelfView` | visible `items`, `onOpen`, `onHide` | Shelf chips and local more/less expansion |

### A data-only usage window

```tsx
const windows = [
  { id: "short", label: "5 hours", shortLabel: "5h", pct: usage.fiveHour?.pct ?? null,
    resetDescription: usage.fiveHour?.resetText ?? "not reported" },
  { id: "week", label: "Week", shortLabel: "wk", pct: usage.week?.pct ?? null,
    resetDescription: usage.week?.resetText ?? "not reported" },
];
```

`null` remains unknown. Do not supply zero in place of unavailable telemetry. Supply stale/unknown freshness explicitly.
The package does not guess an account identity, available model, token count, current turn or reset time.

### Compose it in another app

```tsx
import { HaloRim } from "@siso/shell";
import { ComposerFrame, ComposerHud, ContextPopover, UsagePopover, UsageRingCard,
  ModelPicker, ArtifactShelfView } from "@siso/composer";

<>
  <ArtifactShelfView items={visibleArtifacts} onOpen={openArtifact} onHide={dismissArtifact} />
  <ComposerFrame surface={HaloRim} state={working ? "working" : "idle"}
    acceptedReceipt={acceptedReceipt}
    hud={<ComposerHud
      identity={<ModelPicker label={observedModelLabel} selection={modelSelection} />}
      context={<ContextPopover value={contextPct}>{contextDetails}</ContextPopover>}
      usage={<UsagePopover windows={windows} freshness={freshness}>
        <UsageRingCard windows={windows}>{accountDetails}</UsageRingCard>
      </UsagePopover>}
      metrics={tokenAndCostLabels}
      activity={activityControl}
    />}>
    {commandMenu}
    <div className="siso-chat__inputrow">{attachmentControl}{input}{sendOrVoiceControl}</div>
  </ComposerFrame>
</>
```

The application retains its textarea/draft/attachment and send controls. The rim styles an input-row textarea to two
lines by default; the current app's explicit drag-resize overrides remain supported. Commands can be placed immediately
above the input row with `className="siso-chat__menu"` to share the rim. Keep the application-specific chat viewport,
floating composer position and reserved assistant-face padding outside the package.

### Activity details

`ActivityPopover` accepts optional `metrics` (label/value/title) and `onClose`. Items may supply `stateLabel`, `metric`, `metricLabel` and `expandedDetail`; row selection still invokes the supplied `onSelect`. Titled groups are collapsible, with `initiallyCollapsed` applied on mount. Keep attention/failure groups expanded in the adapter. The component does not compute rates, freshness or task completion.

## Acceptance and identity contracts

- `acceptedReceipt: {key, text?, label?}` must come from a matching accepted acknowledgement. Never set it on a local
  click or a saved/queued/offered/failed/unknown event. The package suppresses an initial mounted snapshot, deduplicates
  the current key, hides receipts when the document hides, and returns to rest after 2400 ms. The app owns session resets.
- `selection.model` is the reported current model. `onSelect(id)` requests a change, and may return `false` when an
  application confirmation was declined. Selection stays unchanged until new props arrive. A changed observed model
  gets a brief 220 ms arrival, rather than an optimistic success claim. Key the picker by recipient/session identity.
- Context animation starts from the currently painted reading, cancels on a newer measurement, and snaps when reduced
  motion, document visibility or intersection requires stillness. Both the ring and number use that one value.
- Activity counts, rates (including any estimate marker), batches, stop eligibility, status and callbacks come from the
  app. The package does not group or deduplicate runtime records, poll, or decide which session a stop/open action targets.
- Artifact IDs are opaque. URL parsing, permission checks, persistence and opening belong to the consumer.

## Agent Base adapters

`apps/web/src/components/Composer.tsx`, `Hud.tsx`, `ModelMenu.tsx`, `SubagentsPopover.tsx`, `ArtifactShelf.tsx` and
`ContextMeter.tsx` retain their existing import names/props. They own the provider catalog, account/session readers,
command events, worker polling and saved shelf state. They import the package source directly during this landing so
ChatView wiring requires no churn. Parent integration can add `"@siso/composer": "workspace:*"` to the web workspace
and run its normal install once manifests/lockfile are unfrozen, then use the package-name export.

## Validation

The focused checks exercise the package through both the existing app adapter fixture and a separate package-only
fixture. The latter imports no Agent Base components and supplies all model/activity/artifact projections directly.
No check attaches to a real agent or sends a live prompt. Source-bound evidence is recorded in
`.agents/scratchpads/landing-20261006/composer-package-checks.json` by the package check script.
