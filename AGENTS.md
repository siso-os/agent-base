# siso-internal-labs-agent-base: Shaan's own agent coding app

**In one line:** the Agent Base app: one Tauri window onto every agent herdr runs, with Agent Zero pinned on top, a
clean terminal and a page per agent. Part of SISO Internal Labs (`~/SISO_Workspace/SISO_Agency/apps/siso-internal-labs`).

Read **[docs/SPEC.md](docs/SPEC.md)** first: the decisions (with Shaan's words), the architecture, what is built and
verified, the parts list of what to lift, and the phase 1 plan. The wants and screens live in
`../siso-internal-labs-agents/.agents/research/2026-10-01-agent-app/` (`INTENT.md`, `wireframes.html`).

| | |
|---|---|
| Integrating owner | AB-RESEARCH; independent isolated file scopes run in parallel, shared integration through owner acceptance. Read [.agents/HANDOFF.md](.agents/HANDOFF.md), [.agents/TASK-TREE.md](.agents/TASK-TREE.md) and [.agents/OWNER-PLAN.md](.agents/OWNER-PLAN.md) before starting work. Existing owner/builder branches are preserved. |
| Run the app | `pnpm install && pnpm desktop` builds `apps/desktop/target/release/bundle/macos/Agent Base.app` (it starts the node itself) |
| Run the node | `cd services/node && pnpm start` (port 5401; `AB_HERDR` points it at a lab session for tests) |
| UI hub | `ui-hub/`: one folder per component (input bar, side nav, Agent Zero's board) with its pictures and its feedback, reasoning, ideas and improvements logs. Read `ui-hub/<component>/README.md` before touching that component's look. View it at `python3 ui-hub/serve.py` → http://127.0.0.1:8896/ |
| Reusable parts | `packages/` (`@siso/tokens`, `@siso/shell`, `@siso/side-nav`, `@siso/terminal`); read `packages/README.md`. Good new parts go there, with no agent knowledge |
| Test a terminal | `node services/node/test/term-probe.mjs <port> <terminal_id> <text> <expect>` against a **lab** session only |
| Not this repo | `sisodias/siso-agent-base` is the retired old Agent Base: read-only, never write to it |

Before messaging, drafting for, or acting on behalf of a person, run `bin/who <name>`; if they are not on the Rolodex, say so rather than guessing who they are.

Rules: tests never attach to live agents (an attached view resizes the agent for every viewer); builds and browsers
through `heavy --`; no windows on Shaan's screen; worktrees in `~/SISO_Workspace/_data/worktrees/siso-internal-labs-agent-base/<lane>`.
The main checkout's HEAD is NOT what runs: `tools/ab-live` swaps only the live paths, so read the live sha from `cat LIVE`,
`git rev-parse live` or `curl -s 127.0.0.1:5401/api/version`, never from `git status` ("N commits behind" is expected).

## The builder's rules: sprints

Shaan, 9 Oct 00:45: "any tasks I do have I can just tell him and they get done relatively instantly from one agent ...
we could give him like 10 things and he's gonna build it all in one sprint relatively quickly in the same context".

1. **One inbox.** What he types to the builder directly and every ask in `bin/ask queue AGENT-BASE` (siso-agent-zero) land
   on the one three-lane list (PRIORITY, PAPERCUTS, FEATURES; t-0541).
2. **A sprint** takes the top of Now, up to about 10 items. Read them all first, group them by the files they touch, and
   build them in one context on the one branch. Haiku helpers only read and research; the builder writes the code.
3. **Checks:** a fast smoke check per item; the full gate once per sprint, not per item.
4. **One release per sprint** through `tools/ab-switch` (and the app bundle when `apps/desktop` changed), with a note
   listing each item and a before/after shot, then the owner card (`~/.local/state/a0/owners/AGENT-BASE.json` on the
   laptop: what is live, what is next).
5. **No waiting:** no approvals, no asking Agent Zero. His newest words win where items overlap.
6. **Clean the list first:** close what is done or superseded with evidence (`bin/ask done ID --evidence ...`) and merge
   duplicates, so the list is only live work.
7. **Room:** autocompact at 35%. Between sprints, relaunch at 50% if the dial or ab-remote can resume the session.
