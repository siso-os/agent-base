# Release screenshot evidence

A release note may include `evidence`, an array of before/after screenshot pairs. Evidence belongs to the exact full release SHA; an inherited prose note never lends its screenshots to a later release. Missing historical evidence remains unavailable.

Each pair has `id` (letters, digits, `_` or `-`), `title`, optional `viewport: {width,height}`, and `before` / `after` objects with `path`, `sha` and optional ISO `capturedAt`. `after.sha` and the note's `sha` must equal the full release SHA. `before.sha` names the revision actually rendered for the baseline. Paths are repository-relative raster files under `ui-hub/`, `domain-base/` or `services/node/releases/assets/`. Absolute paths, traversal, symlinks, SVG, files above 8 MiB, and non-image bytes are rejected.

1. Capture and inspect both views using the same viewport and state. Record the actual revisions and screenshot provenance; a fixture proves fixture rendering, not a live installation.
2. Freeze the candidate revision. Add its exact SHA to the release note and each `after.sha` only after checking that the captures show that candidate. Release metadata can be appended after the candidate commit is known; never invent a future SHA or attach these images to an older installed build.
3. Include the image assets when publishing the release. Append the completed record to the checkout-specific `releasePublicationFile(repo)` journal after the accepted full release SHA is known (or the explicit `AB_RELEASE_PUBLISHED` journal). This lives under `~/.local/state/agent-base/live/`, outside the commit it describes. The reader combines it with legacy `notes.jsonl`; explicit `AB_RELEASE_NOTES` fixtures remain isolated unless they also opt into a publication journal. Do not rewrite historical notes to make absent evidence appear complete.
4. Check `/api/releases`: the intended release must return `evidence.state: available`. Open both `/api/releases/<sha>/evidence/<id>/before` and `/after`, then inspect the pair and modal in What's new. This read does not itself establish installed UI proof.

The 6 October worktree candidate manifest is `.agents/scratchpads/landing-20261006/release-evidence-candidate.json`. It identifies existing real captures and their hashes, with the unfrozen after revision explicitly null. It is a review handoff, not published release evidence.

## Delivery timing provenance

An optional `delivery` record associates a release with one actual prompt: `{taskId, agentKey, session, prompt: {id, at, source}}`. Use the exact recorded agent key and session and the original prompt timestamp and provenance. The delivery endpoint joins this record to an actual successful live log entry for the same full release SHA; a later rollback revokes that delivery until a subsequent successful install. It never substitutes task creation, task update, commit or build times for the original prompt. Missing provenance leaves the timing metric unavailable. Do not backfill inferred prompt identities or timestamps.
