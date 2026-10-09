# Remote inventory coverage

`GET /api/remote/agents` remains a local, read-only endpoint. Both existing opt-ins are required: `AB_REMOTE_INVENTORY=1` and `AB_SERVERS_PROBE=1`. No collector starts providers, attaches terminals, reads conversations, or accepts request-supplied commands, paths or hosts.

The production reader expands existing configured scopes for two fixed mappings: `mini` through `mac-mini-herdr` under its existing SSH account, and `vps-siso` through `siso-vps` under the explicitly configured `siso` account. Removing the configured scope immediately revokes its derived sources and cached/in-flight results. No other host/account is inferred or discovered. Existing herdr IDs and session strings are unchanged.

| Source | Evidence | Bound |
| --- | --- | --- |
| `herdr` | Existing configured session's agent list | Independent processes and other sessions are outside this source. |
| `managed-hosts` (`ab-managed-hosts` group) | Owner-controlled JSON receipts in the selected account's default `.local/state/agent-base/hosts` directory, with explicit session and parent-session IDs | No custom `AB_HOSTS_DIR`, private Codex profiles, logs, journals or recursive directory traversal. Missing directory is explicitly counted. Invalid receipts are rejected and counted. |
| `codex-processes` (`codex-processes` group) | `ps` executable basename exactly `codex`, PID, parent PID and process start time under the selected account | A process is **not a verified task**. Session, model and task state remain unknown. Wrapper-only processes, other executables, other accounts and hosted desktop tasks without such a process are outside coverage. |

The top-level response sets `coverageComplete: false`. Consumers must not turn the total record count into an active-job count. Each source retains its own observation/error status, coverage text and diagnostic counts. Each new row has `identity` (`task-session`, `process-only`, or `conflict`), `source`, and independent `processState`. No full command line, prompt, model, display name from the receipt, private path, token or log content is projected.

A receipt's PID is correlated only with a same-account `node` process whose observed start matches the recorded host start within five seconds. This is receipt/process correlation, not executable attestation. `reportedState` preserves the last bounded state word; current `state` becomes unknown after 60 seconds or when that host process is not observed. Receipts with ambiguous sessions or overlapping native runtime claims become conflicts and cannot assert liveness or ownership.

Native process identity includes PID and start time, scoped to machine/account. Only a unique, currently observed host's direct Codex child can suppress an identical process row. Offline host observations cannot suppress a current process. A stale task-state receipt can still carry fresh process-presence evidence from the current collector invocation. Herdr/receipt names are never used to join sources: no reliable cross-source terminal/session identity is currently present, so possible overlap remains an explicit coverage limitation.

Backend parent metadata records explicit same-source session relations and observed direct Codex process parents. The UI nests only identified session/herdr children. Process ancestry does not establish task ownership, so process-only and conflicting records stay top-level; process ancestry remains available as metadata. Unknown parents and cycles cannot hide a row.

The remote Python read has a 12-second alarm; SSH uses the existing transport's 5-second connection timeout and a 15-second total deadline. Reads cap stdout at 1 MiB, account process metadata at 1 MiB/8,192 entries, eligible processes at 512, directory enumeration at 2,048 entries/512 JSON receipts, and each receipt at 64 KiB. The default cache TTL is 30 seconds with at most four reads in flight. The explicit Linux account switch drops UID/GID before reading. The fixed receipt directory rejects symlink components, unsafe owner/mode, nonregular files and symlink files.

Integration requires no server edit: `createRemoteInventory` automatically expands production scopes. Tests with an injected reader retain legacy behavior unless `expandCoverage: true` is explicit. Both existing leaf views (`RemoteInventory` and `RemoteInventoryNavigation`) display record/source counts, source kind, bounded coverage, absent-directory and rejected-receipt caveats, and independent process presence. The summary separates herdr records, identified sessions and process observations without presenting an active-job count. Process rows say task/session/model unverified, and the detail view keeps task session, task state, model and parent unverified. The safe seven-source fixture mirrors the live collector counts using synthetic identities only; no real messages or process IDs are rendered. Installed endpoint/rendered verification remains an integration-owner check. There is no separate RemoteInventoryWidget file in this checkout.

Focused checks:

```sh
heavy -- node --experimental-strip-types --no-warnings services/node/test/remote-inventory.mjs
heavy -- node --experimental-strip-types --no-warnings services/node/test/remote-inventory-coverage.mjs
heavy -- node --experimental-strip-types --no-warnings services/node/test/remote-inventory-projection.mjs
heavy -- node services/node/test/remote-inventory-ui.mjs
```
