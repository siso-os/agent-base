# Changes JSON API (data only)

The panel imports `apps/web/src/lib/changes.ts`: `ReviewScope`, `ReviewIdentity`,
`ReviewRevision`, `ChangedFile`, `ReviewPreview`, `ReviewFile`, `DiffPoint`,
`ReviewComment`, `CreateReviewComment`, `ReviewFeedbackBatch`, `ReviewDelivery`,
`ChangesResult<T>`, `parseDiffHunks`, `changesUrl`, and `changesRequest`.
There are no UI components or new runtime dependencies in this lane.

## Identity and read routes

Prefix: `/api/agents/:agentId/changes`. Encode the agent row ID. The server
re-resolves that row against current private host registrations, machine, session,
canonical Git root/common directory, and (when present) workspace receipt.
`reviewKey` binds machine + canonical worktree + session; row labels can change.
Requests cannot provide cwd, a machine override, Git command arguments or host tokens.
Remote ownership, stale/ended/ambiguous rows, symlinked roots, missing receipts and
unavailable hosts fail explicitly. Never follow a successor with old comments.
Terminal rows without a supported host can be reviewed with `identity.readOnly=true`;
feedback requires a live, matching host.

| Method | Suffix | Input | Success |
| --- | --- | --- | --- |
| GET | empty | `sessionId`, optional `scope`, `targetRef`, `turnId` | 200 `ReviewPreview` |
| GET | `/files/:fileId` | `sessionId`, `revisionId` | 200 `ReviewFile` |
| GET | `/comments` | `sessionId` | 200 `{ comments: ReviewComment[] }` |
| POST | `/comments` | `CreateReviewComment` | 201 `ReviewComment` |
| POST | `/comments/:commentId/resolve` | `{sessionId, reviewKey}` | 200 `ReviewComment` |
| POST | `/feedback` | `ReviewFeedbackBatch` | 202 `ReviewDelivery` |
| GET | `/feedback/:clientKey` | `sessionId` | 200 `ReviewDelivery` |

Mutation routes retain the node's origin checks. All responses use `cache-control:
no-store`. Errors are `{error:{code,detail,retryable}}`, never an empty clean diff.
Typical codes: `mapping-unavailable`, `stale-recipient`, `remote-unavailable`,
`read-only`, `not-git`, `target-unavailable`, `unstable-source`,
`snapshot-unavailable`, `output-limit`, `invalid-input`, `host-unavailable`,
`store-unavailable`. Expect 400 for invalid input, 403 for invalid origin/host
credentials, 404 for unknown comment/key, and 409 for unavailable/stale sources.

`scope` is `workspace` by default. Its base is merge-base(HEAD, target), and its
new side is captured workspace bytes. Without `targetRef`, a receipt's pinned
`baseSha` is used; a legacy workspace requires `origin/dev`. A missing target is
an error. `uncommitted` uses HEAD (or an explicit empty tree on unborn HEAD).
`committed` compares the merge base to HEAD's tree. `turn` requires `turnId` and
both recorded trees. A provider turn ID or host prompt ID can select a turn.
Failed/stopped turns with observed completions retain their captured edits;
missing or timed-out boundaries return `snapshot-unavailable`.

Each preview pins source bytes in Git objects and owned
`refs/agent-base/changes/<objectOid>` refs, including base/HEAD/target retention.
This is the intentional snapshot side effect; it never stages the user's index,
changes HEAD/branch, fetches, commits, rebases, merges or runs repository helpers.
A private index is seeded empty, literal NUL paths are inserted with
`update-index`, and raw bytes use `hash-object --no-filters`. Ignored untracked
files are excluded. Two captures plus HEAD/target rechecks reject a moving source
with bounded retries. This is a checked observation, not a filesystem-wide atomic
transaction with other writers. Refs are retained for the review lifetime; this
version has no automatic pruning or public deletion endpoint.

Files have separate old/new paths, blob OIDs, Git modes, change kind, untracked
flag, additions/deletions, and content status. Renames, deletes and mode-only
changes remain inventory entries. Selected-file expansion reads pinned blobs,
never current disk or a newly computed base. Blob-to-blob patches prevent a
file-to-directory replacement from accidentally including descendant files.

Limits: 120,000-byte preview, 1 MiB per expanded side, 16 KiB captured hunk,
48 KiB assembled feedback, 4 KiB comment/user text, 50 comments per batch,
500 retained revisions/comments, 1,000 feedback batches, 16 MiB metadata/store,
16 MiB single captured file, 64 MiB total captured bytes, 10,000 files and 10s
per Git subprocess. Binary/invalid UTF-8/oversized text is inventory-only.
Exceeding the capture budget rejects the observation. Preview truncation omits
whole patches while preserving the full independent inventory. Symlink escapes
and nested repositories are rejected. Gitlinks are retained from the index;
submodule working content is excluded and `sourceComplete=false` when gitlinks
exist. No inline comments on binary, omitted, mode-only or oversized content.

## Comments and exact ranges

Coordinates are 1-based `{side:"old"|"new",line}`. The optional `end` defaults to
`start`. Endpoints must exist in the displayed hunks; a range must include a
changed row. Mixed-side selections within one hunk are supported. The server constructs the
hunk, old/new ranges and SHA-256 semantic content hash; client-supplied captured
code is ignored. `parseDiffHunks` retains separate counters and newline markers.

State is private JSON beside receipts:
`$AB_WORKSPACES_DIR/changes/<workspaceId-or-worktreeId>/<reviewKey>/review.json`.
Parent directory is 0700; state and backup files are 0600. One filesystem lock
per worktree serializes capture and mutations across processes. Corrupt state is
retained and blocks review operations. Persisted snapshots and drafts survive
panel unmount, service restart and agent renaming within the same identity.

An unrelated rebase can change revision IDs and coordinates. For the same review
scope, a preview searches exact selected semantic content at the same file paths.
Only a unique match sets `comment.anchor` to the new revision/file/coordinates.
`revisionId`, original coordinates, content hash and captured hunk stay immutable.
No match or multiple matches produces `obsolete` with a null anchor. Renames to a
new path require another comment; matching line numbers alone never moves one.
Changing source modes does not obsolete comments from a different scope. A sent
comment remains unresolved until the explicit resolve operation.

```json
{
  "sessionId": "thread-123",
  "reviewKey": "<preview.identity.reviewKey>",
  "revisionId": "<preview.revision.id>",
  "fileId": "<preview.files[0].id>",
  "start": {"side":"old","line":12},
  "text":"Keep this validation when replacing the old implementation."
}
```

## Feedback and receipts

Send IDs, not browser-authored hunks. Capture a preview, create comments, refresh
and inspect anchors, then submit:

```json
{
  "version":1,
  "clientKey":"review-20261004-001",
  "sessionId":"thread-123",
  "reviewKey":"<preview.identity.reviewKey>",
  "revisionId":"<current preview.revision.id>",
  "commentIds":["<comment.id>","<another comment.id>"],
  "text":"Please address these together.",
  "delivery":"next"
}
```

`next` is the default. `steer` also requires the current `expectedTurnId`; the
host's existing capability/turn validation remains authoritative. Exactly one
host prompt contains the bounded JSON envelope with identity, original and
current revision/anchor, old/new file paths/ranges, text, content hash and captured
hunks. Backticks/XML/mentions are JSON data, without current-file attachments.
Sending rejects obsolete/resolved/missing comments and stale workspace revisions.
Historical turn feedback uses its immutable recorded source.

The outbox is saved before socket I/O. Repeating the same key and same input
returns its recorded outcome without another send; different input under that
key conflicts. `queued` means the host durably saved/offered the prompt.
`submitted` means its native turn/SDK handoff receipt was observed; it does not
mean completed work. Poll the feedback GET route to reconcile a queued/uncertain
batch with the host's durable queue and obtain `providerTurnId` when available.
`failed` and `uncertain` preserve the drafts; there is no automatic replay after
ambiguous acceptance or restart. Exactly-once provider execution is not promised.
The ordinary body limit remains 64,000 characters; assembled context is checked
before runtime submission.

## Host boundaries (internal)

`POST /api/changes/turns` requires `Authorization: Bearer <owning-host-token>` and
JSON `{sessionId,turnId,phase:"baseline"|"completion",providerTurnId?,status?}`.
The node rechecks host ownership and captures a snapshot before responding.
Do not expose the token to the panel. Calls are idempotent per prompt/boundary.

New Claude/Codex hosts with a workspace receipt await the baseline before provider
handoff, then record completion before draining the next turn. Legacy hosts can
opt in with `AB_CHANGES_URL=http://127.0.0.1:<node-port>`; receipt hosts default to
5401. The helper only accepts loopback HTTP, times out after 5s, and never blocks
chat indefinitely. Completion is recorded only if the baseline response succeeded;
a late baseline after timeout cannot produce a misleading complete turn diff.
Old running hosts need their ordinary restart to gain these hooks. No hosts or
launchd services were restarted/deployed by this lane.

## Panel handoff and remaining boundaries

Use `reviewKey`/`revision.id` to discard late responses. Refresh explicitly while
open; there is no watcher/WebSocket invalidation channel in this JSON-only lane.
Use the file inventory even when `truncated=true`, and load one file by its ID.
Show omission/error reasons and `sourceComplete`; do not turn them into “clean”.
Show original hunk and current anchor distinctly; obsolete comments need renewed
selection. Keep the client key stable for retries and poll receipts. There is no
readiness or merge API, no UI acceptance, no remote review transport, and no live
Claude/Codex-provider or fleet-wide acceptance claim. Gitlink inner edits and
large-file inline review are outside the first contract.

Provenance: independent implementation of the contract, private-index snapshot,
semantic coordinates and captured context concepts documented in Agent Zero's
`research/harness-rob/deep/changes.md`. T3 Code commit
`00eb8f6183ba4b36a429db08767031ad8ca9d81d` is MIT (T3 Tools Inc., 2026);
OpenCode commit `907b3bc518fa48e90e8ec24dd327d13eee71c36c` is MIT (opencode, 2025).
No donor source expressions/blocks or third-party dependencies were copied.
