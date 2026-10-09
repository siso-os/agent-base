# Codex host spike (t-0306)

## Choice (five lines)

1. Use `codex app-server` for this interactive host.
2. The TypeScript SDK supports starting, continuing and resuming threads with less client code.
3. App-server exposes persistent thread/turn RPCs, text deltas, interrupts and approval requests directly.
4. Keep the existing local host socket and chat event contract; no additional npm dependency or new renderer.
5. Trade-off: experimental protocol/version compatibility is ours to maintain; tested CLI is 0.159.2.

Sources: [app-server](https://learn.chatgpt.com/docs/app-server), [SDK](https://learn.chatgpt.com/docs/codex-sdk).

## Run

```sh
AB_HOSTS_DIR=/path/to/fixture/hosts services/host/bin/siso-host --harness codex --name CODEX-SPIKE --model gpt-6.1-sol
# After stopping that host, use its registration's session (the native thread ID):
AB_HOSTS_DIR=/path/to/fixture/hosts services/host/bin/siso-host --harness codex --name CODEX-SPIKE --model gpt-6.1-sol --resume THREAD_ID
```

`--harness codex` must be the first two arguments. This spike only accepts `gpt-6.1-sol`; it passes the model on the CLI,
thread start/resume and every turn. Existing CLI login/config supplies authentication. Workspace-write sandbox and
on-request approvals are explicit; command/file approval requests use the existing app cards. Unknown server requests
fail closed. The local socket keeps the existing random-token protection and atomic 0600 host-file writes.

Text, command results, file diffs, thinking summaries, output tokens and context are normalized for the existing
renderer. Prompts received during a turn queue for the next turn; taking a queued prompt back is supported.
Restart uses Codex's persisted thread history, without automatically resending a prompt. The stopped registration
is retained with `child: stopped`; it contains a private socket token and must not be committed.

## Checks

```sh
node --experimental-strip-types --no-warnings services/host/test/codex-events.mjs
heavy -- node services/host/test/codex-live.mjs /path/to/evidence
heavy -- pnpm check
```

The opt-in real check starts a fixture node with fake herdr, sends `say hi in 3 words` through the app's
`/chat/service-CODEX-SPIKE/ws` API, verifies deltas/tokens and the rendered reply, captures 1440x900, restarts the host,
verifies history and conversational recall using one further small prompt, and captures the resumed app.
It closes only its own hosts/node/Vite and its own Camofox tab. Evidence stays outside git.

## Limits

No images, mid-turn steering, slash commands, background-task control, launchd supervision or herdr reporting.
Real approval/interrupt behavior and real file writes are not acceptance-tested; command/file event normalization is
covered by the adapter check. The existing service-row status/HUD lacks Codex idle/model/cost attribution (the chat
itself receives idle and token/context events). The UI's service status may say Working while the chat is idle.
Native history has no token gauge until a new usage event. Runtime exit is reported as blocked/stopped, with no
automatic recovery. No production/live deployment or merge is included.


## Managed hosted children (4 October 2026)

Parents expose `spawn_codex`, `message_codex`, `codex_status`, and `stop_codex`: an in-process SDK MCP server for
Claude, and app-server dynamic tools for Codex CLI 0.159.2. Children are separate `service-runner` hosted chats,
with `--lead` for display and immutable parent-session/child identities for control. The current 4 October
`routing.json` selects `gpt-6.1-sol`; the existing CLI login supplies authentication. No launchd jobs are created.

Spawn returns a child ID immediately. Read-only is the default. `worktree: true` reuses the workspace preparation
and receipt contract for an isolated copy before starting a write-capable child. Message queues a follow-up on the
same thread. Stop targets the observed turn, cancels saved successor messages, and reports the runtime acknowledgment;
terminal state follows the actual completion event. A fresh message after Stop resumes the held child queue.

Each parent owns one private ledger under `AB_HOSTS_DIR/.children`, keyed by parent session. Reconnect reconciles the
observed hosted thread; a missing runtime remains unknown/unavailable. Completed children stay addressable and their
history stays in the provider thread; the popover folds children older than a day away. Children get no dynamic spawn
or control tools, and native Codex multi-agent features are disabled. The managed limit is one level, eight active
children and 200 retained children per parent. This is a tool-depth boundary, not an adversarial shell-process sandbox.

Task events and the existing fan-out rows/face flights show progress. Clicking a managed child opens its real chat
and composer in the existing split; human messages are attributed in the parent's task row. At a settled child turn,
the parent admits one correlated task notification containing up to 200 words of the final answer and a chat link.
The existing input queue prevents duplicate admission; returns hold while successor prompts remain queued. A return
steers a working parent at its native/SDK input boundary, so a waiting turn can consume it; idle parents start a
queued successor turn.

```sh
heavy -- node --experimental-strip-types --no-warnings services/host/test/subagents.mjs
heavy -- node services/host/test/subagents-live.mjs /path/to/evidence
```

The contract check covers parent ownership, absent child tools, human attribution, follow-up serialization, scoped
Stop, continuation, automatic returns and an isolated-worktree launch receipt. The opt-in app check uses a fake
Claude SDK parent invoking the real MCP handlers, a real Sol parent, four real read-only Codex children, and headless
WebKit at 1440x900 and 390x844. It closes its browser and all fixture hosts/dev processes. Real Claude inference,
parent/child crash recovery and write-capable provider execution are separate acceptance gates.
