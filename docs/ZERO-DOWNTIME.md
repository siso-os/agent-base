# Zero-downtime deploys (t-0539)

Shaan, 8 Oct 19:17: "my agent base keeps reloading like every 60 seconds, it takes 60 to 120 seconds to reload every
single time and it takes down the voice app as well ... we need to compartmentalise all of these".

## What runs where

| Part | Runs as | Survives |
|---|---|---|
| Front, `services/front/front.mjs` | launchd `com.siso.agent-base.front`, 127.0.0.1:5401, copied to `~/.local/share/agent-base/front.mjs` | everything; changed only by `tools/ab-switch install-front` |
| Node | launchd `com.siso.agent-base.node.5411` or `.5412`, from its release worktree `_data/worktrees/siso-internal-labs-agent-base/release-<sha12>` | app restarts; a crash restarts it in 5 s while the front holds connections |
| Voice, `Agent Base Voice.app` | launchd `com.siso.agent-base.voice`, from `~/Applications/Agent Base Voice.app` | app restarts and deploys; launchd keeps exactly one |
| Agents (siso-host) | their own processes | already survived app restarts before this (hosts started 19:01 lived through two deploys) |
| The app | the window only | it finds 5401 answering and starts nothing; if node fails it logs and opens anyway |

`~/.local/state/agent-base/live/active.json` names the live slot (`port`, `sha`, `dir`). The front reads it for every
new connection.

## A deploy

`tools/ab-switch <sha>` (ab-live and ab-queue hand web and node ships to it once `active.json` exists):

1. Release dir: a worktree at the sha, `pnpm install --offline` (3 s), web build (about 85 s, through `heavy`).
2. Start its node in the free slot, beside the live one.
3. Health: `/api/version` says the sha. Then warm what the first page asks for (`/`, `/api/releases`, `/api/agents`,
   `/api/fleet-board`, `/api/org`, `/api/attention`); each must answer 200, and `/api/version` must still answer in
   under 2 s afterwards. Any failure stops the candidate, logs `failed` with the reason, and exits 1. Live is untouched
   and nothing retries.
4. Write `active.json`. New connections go to the new node.
5. Wait 3 s, then stop the old slot. Open sockets close and the page reconnects to the new node. The old release dir
   stays for `tools/ab-switch --rollback <sha>`.

The app is never quit. The page offers the reload for new screens (`useVersion.ts`).

## Measured (8 Oct, worktree `t0539-zero-downtime`)

- `tools/test/ab-switch.test.sh` (real launchd, test labels, ports 5480-5482):
  - 60 requests through the front during a switch: 0 failed, slowest 0.19 s.
  - A broken sha: fails with "node exited during startup: Error: fixture: broken node", live stays put, and it is not
    running 8 s later.
  - Rollback: 6 s.
- First page load against a node beside live (sandboxed, real data, headless):
  - Before: one 35.9 s event-loop block (`/api/releases`: ~3,800 synchronous `git merge-base` calls), and
    `/api/version` took up to 35 s.
  - After the fixes and ab-switch's warm-up: `/api/version` answered in 1.8 s once, then about 0.02 s.

## The one cutover (only when Shaan says)

The installed app still starts its own node and voice. One planned deploy moves them out; the window restarts once
(a few seconds), and the agents keep running throughout.

1. `tools/ab-switch install-front`. It cannot bind 5401 yet (the app's node holds it), so it keeps retrying every 250 ms.
2. `tools/ab-switch <sha>`: node X comes up in 5411, is warmed, and `active.json` names it. The front check warns,
   because 5401 is still the app's node.
3. Stop the app's own node (`lsof -tiTCP:5401 -sTCP:LISTEN`, the one whose parent is the app). The front takes 5401
   within 250 ms and the page reconnects to node X.
4. Quit the app, install the new build (setup no longer panics; it starts no voice when the voice plist exists), run
   `tools/ab-switch install-voice`, and open the app.
5. Check: `tools/ab-switch status`; `/api/version` through 5401 says X; one `agent-base-dictation` launcher, run by
   launchd.

Undo: `launchctl bootout gui/$(id -u)/com.siso.agent-base.front` and the node slot, move `active.json` aside, and
`open` the previous app (kept in `~/.local/state/agent-base/live/_archive/`). The app then starts its own node as
before.
