# Round 07 — Agent Base workbench

Source refinement of the three existing controlled components and their synthetic review. The earlier Round 06 gallery remains the immutable before view at [the original review](http://127.0.0.1:8891/card/agent-workspace-review-20261006/html). The checked Round 07 page is published at [the workbench review](http://127.0.0.1:8891/card/agent-workspace-polish-20261006/html), with before/after captures for all three views. The served HTML returned HTTP 200 and matched the local bundle plus the console service's single trailing newline.

The before screenshots showed a demo starting 594px down at 1440px, 560px at 390px and 620px at 2000px. Oversized introduction and explanation consumed the first screen; repeated blue panels flattened hierarchy, and the output shelf put roughly 190px of mostly empty cards ahead of the useful preview. Round 07 replaces that framing with a compact application header, section tabs, controls and one work surface. Explanation stays in a native disclosure below the work. The small visible synthetic/live-wiring note appears once.

## What changed

- **Tasks:** graphite workspace headers, active color edge and inset open tray; folded current/review previews; accurate root-only overview; stronger Needs review action. A sibling Open conversation handoff follows the featured task. The original SourceTaskCard remains in the render slot with its phases, steps, current-phase selection and local folds.
- **Conversation:** the prompt, owner and answer follow one quiet thread line. Play 10s example leads the stage controls; all manual states stay accessible. The unchanged activity rail gets a darker command inset and readable metadata. Full supplied Markdown arrives together on a document surface with a 400–440ms settle and a clearer Inspect outputs action.
- **Artifacts:** supplied task/code/log excerpts form decorative covers next to the existing LivingIcons. Desktop uses a narrow selectable rail and dominant inspector on one surface; at 800px and below, choices form an accessible horizontal filmstrip above the inspector. Compact uses shorter covers, smaller rail and denser toolbar. The host removes ChangeLens's outer material and duplicate heading while retaining its protected comparison content. Empty checks occupy one truthful line; raw PASS text never becomes structured success.

## Controlled component contracts

`TaskWorkspaceDeck<T>` receives ordered workspace groups, owner/root arrays, optional explicit root totals, controlled expansion and the unchanged `renderTask` contract. Optional `WorkspaceDeckGroup.summary` supplies concise folded-header text. Optional `renderTaskAction(task)` renders a sibling list item after the task; it does not wrap or nest controls inside the supplied task/tree. Default totals use root arrays only. Registry order, Unsorted placement and task actions belong to the caller. Native disclosure buttons, multi-fold behavior and focus return remain.

`ChatResponseScene` receives prompt, owner, operational activity, full Markdown, status, revision and pause state. `outputSummary` optionally describes caller-owned artifacts beside the existing `onInspectOutputs` callback; the component infers no count and does not import OutputInspectDock. ConfirmedCopy and code copying retain their original promise, stale-request and unmount guards. Links remain local callbacks. The command-kind guard `.cr-scene .ca-rail.ca-command { display: block; margin: 0 0 15px; }` remains because the outer activity and inner command row share a class.

`OutputInspectDock` receives original body, kind, availability, optional interactive preview, optional structured checks and controlled selection. Optional `thumbnail` is caller-supplied noninteractive content; its wrapper is inert and aria-hidden, and tab names contain only title/kind/availability. The demo derives all covers from the protected fixture, with no interactive renderer cloned into a tab. Arrow keys, Home/End, Escape, focus return, inspector keyboard access and clipboard feedback stay in the existing contract. `checks: []` remains explicitly absent metadata, without a large box or success inference. Pending and failed output retain their original text. When controlled selection changes on mobile, the selected tab is revealed by scrolling only its filmstrip; document scroll and keyboard focus are preserved.

## Fixture and identity preservation

`workspace-review-fixtures.ts` is unchanged: 7 roots, 2 building roots, 2 review roots and a fixed synthetic display time. Workspace registry order is HALO, Agent Base, SISO Agency, then Unsorted. Root/owner ordering is unchanged, and Agent Base plus the first task open by default. All/review/empty filters remain; the overview labels collection totals separately from displayed-root count.

`workspace-review-task-source.tsx/css` is unchanged and remains preview-only. Its captured TaskTree/CardRow provenance and current-phase logic are preserved. Existing WorkspaceMark, AgentFace, LivingIcon, ChatActivityRail and ChangeLens sources are unchanged. No new dependency, network/font fetch, live API, production route or agent action is introduced.

The Round 07 JSON preserves the complete supplied 21-idea specification: 18 chosen ideas and 3 parked ideas. Drag-and-drop reassignment, delayed token typing and live filesystem discovery remain parked. Idea status distinguishes source implementation from rendered verification.

## Motion and review support

Each animated component uses the existing useMotionGate for pause, reduced motion, hidden document and offscreen state. Task opening is a short directional reveal; answer arrival is 400–440ms; artifact selection/inspection is 320–380ms. Failed output and failed responses remain static, including their identity glyphs. Full text remains selectable in every state.

The explicitly started chat replay uses the existing 2.4s, 5s and 10s progression. It cancels timers on stop, manual stage selection, motion-gate changes, route changes, reset or unmount, and never resumes itself after visibility returns. This remains a synthetic replay, not live work.

Hash routes `#tasks`, `#chat` and `#outputs`, data-review-demo/data-stage/data-replay/data-motion/data-root-count/data-workspace and the protected task hooks remain. Only the active demo mounts. Compact / Expressive, Pause / Resume motion and Reset example remain accessible.

Before/After still accepts `window.WORKSPACE_REVIEW_SHOTS` by route with optional before/after/beforeOpen/afterOpen PNG or JPEG data URLs. Native evidence dialogs retain Escape, focus trapping and return. Missing evidence gets a short placeholder. No raster files are stored in Git. Six native JPEG captures are embedded for this round; the original PNG captures and additional state views remain in the evidence directory.

## Verification

The strict scoped TypeScript check and self-contained esbuild bundle pass. The gallery was served over HTTP and inspected at all four widths. There were no page errors, unexpected outside requests, duplicate IDs or horizontal page overflow in the 12-view render check.

| Width | Round 06 demo starts | Round 07 demo starts |
|---|---:|---:|
| 2000px | 620px | 239px |
| 1440px | 594px | 239px |
| 1008px | Not captured | 239px |
| 390px | 560px | 298px |

All six interaction groups pass: tasks, chat, outputs, the task-to-chat-to-output flow, replay and gallery. These exercise root counts, preserved phase/step behavior, folds and focus return, manual chat states, complete selectable Markdown, clipboard pending/failure/confirmation, code inspection, original raw output, pending/failed states, keyboard selection and evidence dialogs. The full 10-second replay was observed; pause, reduced motion, hidden document and offscreen changes cancel it without restarting.

All three component lifecycle checks pass for pause, reduced motion, hidden document, offscreen state, listener/observer cleanup and no frames after unmount. The output lifecycle check was repeated after the mobile selection correction. Clipboard checks use a controlled browser API; they do not claim operating-system clipboard permission.

Visual inspection covered all four widths plus compact, review, expanded command, code and failure views. Mobile inspection led to two final refinements: remove the extra frame around the nested task preview, and reveal an externally selected artifact in the filmstrip without scrolling the document. The initially failing mobile-selection receipt is retained beside the passing regression check.

The final publication, receipt hashes, source hashes and preservation counts are recorded in `workspace-review-proof.json`. Source implementation and visual review are separate from approval of the design by Shaan.

## Remaining integration boundary

This is a local synthetic review of reusable components. Live task/chat/output wiring and full-app integration remain pending. No full-app build, production route or live-agent mutation is claimed. The original task renderer, protected fixtures and earlier component collection remain unchanged.
