# Saved/fresh writer measurements

The t-0391 comparison is the same Dashboard redo on the same input, base revision and component dossier: resume the original DASH session (`mode: saved`) versus start a fresh session with the dossier (`mode: fresh`). A comparison is an evidence view; its screenshot verdict stays `unreviewed` until a person inspects the images.

`services/node/src/writer-measurements.ts` owns durable records under `AB_WRITER_MEASUREMENTS` or `~/.local/state/agent-base/writer-measurements`. The HTTP route accepts only `saved` and `fresh` run IDs. It does not accept measurement bodies or counters. Records are atomically written with private file permissions and the comparison resolver rechecks record integrity, source HEAD and the component's exact source inventory and screenshot bytes before returning them.

## Required host wiring

The node must create one private mode-0600 owner receipt per exact experiment job under a mode-0700 directory and pass its absolute path to that job host as `AB_WRITER_MEASUREMENT_RECEIPT`. The receipt JSON schema is `{version:1,issuer:"agent-base-node",runId,mode,taskId,jobDigest,baseRevision,dossierDigest,sourceRevision,sourcePath,workspaceId,hostName,expectedResumeSession,files:[{path,sha256}]}`. `files` comes from the component's bound `writerDossier.files`; the node must bind task/input/job identity, base, dossier, workspace, and session assignment from server-owned records. Use `expectedResumeSession` equal to the actual DASH session for saved mode and null for fresh mode. The host checks receipt ownership/modes, source and workspace identities, hashes the bounded dossier inventory, and compares the returned native thread and resume origin before arming. No receipt means the existing host path is unchanged.

`services/host/src/writer-measurement-observer.ts` owns native event observation; the host watches only the files named by that receipt. It treats duplicate filesystem notifications, repeated inventory writes, unmatched or incomplete command lifecycles, path loss, watch errors, and session mismatches as invalid evidence. The module does not scan the whole workspace or private files. The owner must still provide the following lifecycle:

1. The host begins the record only after launch/resume returns the native provider session identifier. It verifies the original saved session equals the owner receipt; it never creates a replacement and labels it saved.
2. The host counts an actual `commandExecution` only after both native item start and matching completion events; all other command lifecycle shapes invalidate the run.
3. The host records the first actual change to one file in the receipt inventory. If shell/file edits cannot be observed, the watch has gaps, or ordering is ambiguous, the run is invalid rather than estimated.
4. After the confirmed edit and once the result is committed, run `node --experimental-strip-types services/host/bin/writer-measurement.mjs bind <runId>`. It binds actual HEAD and hashes of only the listed inventory files.
5. Run each declared check through `node --experimental-strip-types services/host/bin/writer-measurement.mjs check <runId> -- <executable> [args...]`. The CLI records the process exit code and rejects inventory changes before or after the check.
6. After real screenshot capture, run `node --experimental-strip-types services/host/bin/writer-measurement.mjs shot <runId> <png-path> <width> <height>`. It verifies PNG dimensions and hashes bytes; later artifact changes invalidate resolution.
7. Run `node --experimental-strip-types services/host/bin/writer-measurement.mjs finalize <runId>` after all evidence is present. The comparison route is `GET /api/writer-jobs/compare?saved=<runId>&fresh=<runId>` and is auto-loaded by the existing `*.route.ts` registry.

The comparison route and host observer are wired in this worktree. The node's task allocator/launcher still needs the narrow opt-in receipt creation and environment injection described above before any real run can exist. The original DASH session and a matching task remain explicit prerequisites for the real experiment.
