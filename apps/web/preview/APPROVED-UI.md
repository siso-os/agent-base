# Approved Agent Base UI pack

**15 of 15 reviewed components approved for integration by Shaan on 6 October 2026.** All 15 now have production callers backed by existing app data and actions. The approved source hashes below remain the historical design snapshot; [production-integration.json](./production-integration.json) records the callers and bounded adaptations. Installed release acceptance is recorded separately by the release process.

> yeah pretty good happy to integrate in all of these

> Maybe we save them so they can be integrated.

This approval supersedes earlier pending-design-approval notes. The latest Round 07 workbench is the selected revision for tasks, conversation and artifacts. Context, before/after, replay and the command palette retain his more tentative “could be useful” feedback; the overall approval includes them.

## Start here

- [Motion bank: 12 components](http://127.0.0.1:8891/card/agent-motion-bank-20261006/html) — includes the four chat-activity variants.
- [Selected workbench: 3 components](http://127.0.0.1:8891/card/agent-workspace-polish-20261006/html) — tasks, conversation and artifacts.
- [Machine-readable approval and source hashes](./approved-ui-manifest.json).
- Reviewed source commit: [`c2231117`](https://github.com/sisodias/siso-internal-labs-agent-base/commit/c2231117feaef7e955cd7385c391b9a755d3cdb0). Branch: `codex/agent-face-prism-20261005`.

## Approved components

| Component | Reviewed example | Source | Feedback |
| --- | --- | --- | --- |
| `WorkspaceArrival` | [Open](http://127.0.0.1:8891/card/agent-motion-bank-20261006/html#workspace-arrival) | [TSX](https://github.com/sisodias/siso-internal-labs-agent-base/blob/c2231117feaef7e955cd7385c391b9a755d3cdb0/apps/web/src/components/WorkspaceArrival.tsx) · [CSS](https://github.com/sisodias/siso-internal-labs-agent-base/blob/c2231117feaef7e955cd7385c391b9a755d3cdb0/apps/web/src/components/WorkspaceArrival.css) | love |
| `ContextStack` | [Open](http://127.0.0.1:8891/card/agent-motion-bank-20261006/html#context-stack) | [TSX](https://github.com/sisodias/siso-internal-labs-agent-base/blob/c2231117feaef7e955cd7385c391b9a755d3cdb0/apps/web/src/components/ContextStack.tsx) · [CSS](https://github.com/sisodias/siso-internal-labs-agent-base/blob/c2231117feaef7e955cd7385c391b9a755d3cdb0/apps/web/src/components/ContextStack.css) | useful |
| `ChangeLens` | [Open](http://127.0.0.1:8891/card/agent-motion-bank-20261006/html#change-lens) | [TSX](https://github.com/sisodias/siso-internal-labs-agent-base/blob/c2231117feaef7e955cd7385c391b9a755d3cdb0/apps/web/src/components/ChangeLens.tsx) · [CSS](https://github.com/sisodias/siso-internal-labs-agent-base/blob/c2231117feaef7e955cd7385c391b9a755d3cdb0/apps/web/src/components/ChangeLens.css) | useful |
| `SessionReplay` | [Open](http://127.0.0.1:8891/card/agent-motion-bank-20261006/html#session-replay) | [TSX](https://github.com/sisodias/siso-internal-labs-agent-base/blob/c2231117feaef7e955cd7385c391b9a755d3cdb0/apps/web/src/components/SessionReplay.tsx) · [CSS](https://github.com/sisodias/siso-internal-labs-agent-base/blob/c2231117feaef7e955cd7385c391b9a755d3cdb0/apps/web/src/components/SessionReplay.css) | useful |
| `WorkspaceCommandPalette` | [Open](http://127.0.0.1:8891/card/agent-motion-bank-20261006/html#workspace-palette) | [TSX](https://github.com/sisodias/siso-internal-labs-agent-base/blob/c2231117feaef7e955cd7385c391b9a755d3cdb0/apps/web/src/components/WorkspaceCommandPalette.tsx) · [CSS](https://github.com/sisodias/siso-internal-labs-agent-base/blob/c2231117feaef7e955cd7385c391b9a755d3cdb0/apps/web/src/components/WorkspaceCommandPalette.css) | useful |
| `ChatActivityRail` | [Open](http://127.0.0.1:8891/card/agent-motion-bank-20261006/html#chat-activity) | [TSX](https://github.com/sisodias/siso-internal-labs-agent-base/blob/c2231117feaef7e955cd7385c391b9a755d3cdb0/apps/web/src/components/ChatActivityRail.tsx) · [CSS](https://github.com/sisodias/siso-internal-labs-agent-base/blob/c2231117feaef7e955cd7385c391b9a755d3cdb0/apps/web/src/components/ChatActivityRail.css) | good |
| `ChatLinkPreview` | [Open](http://127.0.0.1:8891/card/agent-motion-bank-20261006/html#chat-link-preview) | [TSX](https://github.com/sisodias/siso-internal-labs-agent-base/blob/c2231117feaef7e955cd7385c391b9a755d3cdb0/apps/web/src/components/ChatLinkPreview.tsx) · [CSS](https://github.com/sisodias/siso-internal-labs-agent-base/blob/c2231117feaef7e955cd7385c391b9a755d3cdb0/apps/web/src/components/ChatLinkPreview.css) | good |
| `InfrastructurePopover` | [Open](http://127.0.0.1:8891/card/agent-motion-bank-20261006/html#infrastructure-popover) | [TSX](https://github.com/sisodias/siso-internal-labs-agent-base/blob/c2231117feaef7e955cd7385c391b9a755d3cdb0/apps/web/src/components/InfrastructurePopover.tsx) · [CSS](https://github.com/sisodias/siso-internal-labs-agent-base/blob/c2231117feaef7e955cd7385c391b9a755d3cdb0/apps/web/src/components/InfrastructurePopover.css) | good |
| `TalkOrb` | [Open](http://127.0.0.1:8891/card/agent-motion-bank-20261006/html#talk-orb) | [TSX](https://github.com/sisodias/siso-internal-labs-agent-base/blob/c2231117feaef7e955cd7385c391b9a755d3cdb0/apps/web/src/components/TalkOrb.tsx) · [CSS](https://github.com/sisodias/siso-internal-labs-agent-base/blob/c2231117feaef7e955cd7385c391b9a755d3cdb0/apps/web/src/components/TalkOrb.css) | good |
| `VersionPulse` | [Open](http://127.0.0.1:8891/card/agent-motion-bank-20261006/html#version-pulse) | [TSX](https://github.com/sisodias/siso-internal-labs-agent-base/blob/c2231117feaef7e955cd7385c391b9a755d3cdb0/apps/web/src/components/VersionPulse.tsx) · [CSS](https://github.com/sisodias/siso-internal-labs-agent-base/blob/c2231117feaef7e955cd7385c391b9a755d3cdb0/apps/web/src/components/VersionPulse.css) | good |
| `AgentNotificationStack` | [Open](http://127.0.0.1:8891/card/agent-motion-bank-20261006/html#agent-notifications) | [TSX](https://github.com/sisodias/siso-internal-labs-agent-base/blob/c2231117feaef7e955cd7385c391b9a755d3cdb0/apps/web/src/components/AgentNotificationStack.tsx) · [CSS](https://github.com/sisodias/siso-internal-labs-agent-base/blob/c2231117feaef7e955cd7385c391b9a755d3cdb0/apps/web/src/components/AgentNotificationStack.css) | good |
| `TodaySpendDial` | [Open](http://127.0.0.1:8891/card/agent-motion-bank-20261006/html#today-spend) | [TSX](https://github.com/sisodias/siso-internal-labs-agent-base/blob/c2231117feaef7e955cd7385c391b9a755d3cdb0/apps/web/src/components/TodaySpendDial.tsx) · [CSS](https://github.com/sisodias/siso-internal-labs-agent-base/blob/c2231117feaef7e955cd7385c391b9a755d3cdb0/apps/web/src/components/TodaySpendDial.css) | good |
| `TaskWorkspaceDeck` | [Open](http://127.0.0.1:8891/card/agent-workspace-polish-20261006/html#tasks) | [TSX](https://github.com/sisodias/siso-internal-labs-agent-base/blob/c2231117feaef7e955cd7385c391b9a755d3cdb0/apps/web/src/components/TaskWorkspaceDeck.tsx) · [CSS](https://github.com/sisodias/siso-internal-labs-agent-base/blob/c2231117feaef7e955cd7385c391b9a755d3cdb0/apps/web/src/components/TaskWorkspaceDeck.css) | love |
| `ChatResponseScene` | [Open](http://127.0.0.1:8891/card/agent-workspace-polish-20261006/html#chat) | [TSX](https://github.com/sisodias/siso-internal-labs-agent-base/blob/c2231117feaef7e955cd7385c391b9a755d3cdb0/apps/web/src/components/ChatResponseScene.tsx) · [CSS](https://github.com/sisodias/siso-internal-labs-agent-base/blob/c2231117feaef7e955cd7385c391b9a755d3cdb0/apps/web/src/components/ChatResponseScene.css) | good |
| `OutputInspectDock` | [Open](http://127.0.0.1:8891/card/agent-workspace-polish-20261006/html#outputs) | [TSX](https://github.com/sisodias/siso-internal-labs-agent-base/blob/c2231117feaef7e955cd7385c391b9a755d3cdb0/apps/web/src/components/OutputInspectDock.tsx) · [CSS](https://github.com/sisodias/siso-internal-labs-agent-base/blob/c2231117feaef7e955cd7385c391b9a755d3cdb0/apps/web/src/components/OutputInspectDock.css) | good |

The manifest keeps the exact feedback snippets. Spoken “Torque orb”, “total spend”, and “command ballot” map to the displayed Talk orb, Today & spend and Command palette entries. “Open a workspace” is WorkspaceArrival, including the connecting lines and nested workers Shaan singled out.

## Integration handoff

1. Use the primary exports, not their `Demo` components. Keep the shared motion helper and existing `packages/halo-face` identities. Do not copy the synthetic fixtures into production data paths.
2. Supply real state and actions through the existing controlled contracts: chat/tool receipts, link opening, voice phase/transcript, infrastructure observations, version confirmation, notification callbacks, spend snapshots, workspace selection, context ownership, supplied comparisons and recordings, and command actions. TaskWorkspaceDeck must keep the caller’s existing task renderer and root hierarchy.
3. Wire and check each owner adapter in an isolated app preview before release. Review approval does not establish microphone access, notification delivery, updater execution, live task data or production routing.

## Verification retained

The approved code still matches both saved source-hash sets. No UI source was changed to record this approval.

- [Motion bank contract and checks](./MOTION-BANK.md) · [proof](./motion-bank-proof.json).
- [Workbench contract and checks](./WORKSPACE-REVIEW.md) · [proof](./workspace-review-proof.json).

Existing evidence covers strict scoped typing, bundled previews, rendered widths, controlled interactions, keyboard/focus behavior, copy results, failure states, motion gates and cleanup. The workbench includes the checked task → conversation → artifact flow and mobile selection fix.
