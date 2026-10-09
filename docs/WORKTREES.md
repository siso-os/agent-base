# Owned workspaces at launch

New app chats choose Own worktree (default) or Shared checkout with a reason and a repository. A launchId is an immutable request identity; taskId, when supplied, is the workspace identity. Equivalent retries return the saved snapshot, changed inputs return 409. Receipt writes are atomic and protected by durable exclusive-create locks shared with `services/node/bin/ab-worktree`. Corrupt receipts and foreign Git paths/branches are retained and block launch.

Receipts live under `~/.local/state/agent-base/workspaces` (`AB_WORKSPACES_DIR` for fixtures), private mode 0600. Public snapshots contain stage metadata and branch/base facts; no prompt, script body, credential source, host token or raw subprocess output. The recipe and resolved base SHA are pinned before checkout. Worktrees are in `~/SISO_Workspace/_data/worktrees/<repo>/<name>-<identity>`; source may itself be a linked checkout. Base preference is origin/dev, dev, origin/main, main. No force, reset or automatic deletion/recreation.

A repository may declare `.agents/workspace.json`:

```json
{"version":1,"fetch":true,"submodules":"none","copyFiles":[{"relativePath":".env.local","required":true,"private":true}],"setup":[{"id":"install","label":"Install dependencies","argv":["heavy","--","pnpm","install","--frozen-lockfile","--prefer-offline"],"timeoutMs":600000,"required":true}]}
```

Without a declaration, pnpm-lock.yaml selects the existing jobcopy frozen install recipe; other repositories have no install step. Copy entries are exact repo-relative regular files; symlinks/traversal/.git/node_modules are refused, private destinations must be Git-ignored, existing files are preserved and required differences block startup. Successful setup steps have private exit receipts and are not replayed on retry. Setup timeout/cancellation stops only the owned process group. Cancel preserves the worktree. Shared mode does not prepare or change the existing checkout.

Both app routes accept `{launchId,taskId?,name,repo,project?,model,prompt?,workspace}` and return 202 with a snapshot, followed by GET `/api/workspaces/:id`, SSE `/events`, POST `/retry`, `/cancel`, `/archive`. Existing Agent Zero and established legacy restart routes keep their resident cwd. Host/runner guards validate the saved setup, machine, cwd/common Git dir and branch before provider spawn. Handoff intent is persisted before external launch; an unconfirmed handoff reconciles rather than retransmitting the prompt. Active means an observed matching host session, not a tab creation response.

Archive requires an inactive host, owned registered worktree, clean tracked/untracked status and `ls-remote origin` proving the current branch HEAD is pushed. It uses plain `git worktree remove`, retains branch and receipt, and never force-removes.

The provisioning CLI reads a launch JSON file (or stdin), prepares using the same lock/receipt contract and prints a ready cwd. Adapting Agent Zero's jobcopy is follow-on owner work outside this repo.

## Research provenance

Independently written implementation of mechanisms documented in Agent Zero `research/harness-rob/deep/worktree.md` (4 Oct 2026). No donor code copied. T3 Code (MIT, Copyright 2026 T3 Tools Inc., commit 00eb8f6183ba4b36a429db08767031ad8ca9d81d): `ThreadLaunchService.ts`, `WorktreeSetupTracker.ts`, `ProjectSetupScriptRunner.ts`, contracts/worktreeSetup.ts — preparation before provider, immutable command receipt, sequenced snapshots. Vibe Kanban (Apache-2.0, commit d5cbb5380fa0b32e98ef9b8d987f63decce4be3a): copy.rs, worktree_manager.rs and services/container.rs — containment, preserve-existing copies, registration validation and sequential setup.

Private copies use exclusive creation with mode 0600 and must be untracked as well as ignored. Archive refuses a worktree still containing private preparation copies. This first schema permits exact copies from the canonical repository; external credential-directory resolution is not implemented, and project config must not declare that unsupported source. The provider's actual native resume depends on its runtime; owned host guards reject a changed/missing bound session instead of silently starting another conversation. Workspace runner restart is covered with a fake provider; native Codex cold resume was not confirmed in the scratch diagnostic.
