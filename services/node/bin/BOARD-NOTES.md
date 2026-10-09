# Agent Zero board Notes writer

Agent Zero changes Notes with this local CLI. The board remains a reader: tell Zero to add,
change, retire or restore a note. There are no forms and no new agent-message transport.
Existing To-do uses `a0-task`; Ideas uses Zero's existing `bin/idea` writer. Neither store is
changed by this writer. The Notes spec's previously proposed source-tree JSONL did not have
an existing writer; this implementation keeps its open/retired semantics in private runtime data.

Run from the current Agent Base release directory (Node 22 with type stripping):

```sh
node --experimental-strip-types services/node/bin/ab-note.mjs list
node --experimental-strip-types services/node/bin/ab-note.mjs apply < /private/path/request.json
```

Supply note text through stdin, not command arguments. Do not save actual request bodies or
`list` output in Git, task logs or public evidence. `apply` prints a receipt containing only
`ok`, `replayed`, `id`, `revision`, `status`, and `requestId`. `list` intentionally returns the
private open and retired notes to its caller, plus freshness/error metadata.

A create request (synthetic example):

```json
{"action":"create","requestId":"request-unique-once","by":"Agent Zero","source":"session:EXACT_SESSION/task:t-EXAMPLE","text":"A synthetic pending decision","why":"Reason this is being kept"}
```

Use a stable request ID for an exact retry, including after a process restart. Never reuse it
for a different command. The returned `note-…` ID is stable. `by` and `source` are mandatory
caller-supplied provenance, not verified authentication or a claim that Shaan gave a verdict.
The local process/filesystem owner is the write authority; there is no network mutation endpoint.
An idempotent retry returns the original receipt's revision/status, even if later edits exist;
use `list` to observe the current state. Commands reject unknown fields, and stdin is capped at
100,000 bytes before JSON parsing.

Read the latest revision before changing a note:

```json
{"action":"update","requestId":"request-unique-update","by":"Agent Zero","source":"session:EXACT_SESSION/task:t-EXAMPLE","id":"note-RETURNED_ID","expectedRevision":1,"text":"Revised synthetic decision","why":"Updated reason"}
{"action":"retire","requestId":"request-unique-retire","by":"Agent Zero","source":"session:EXACT_SESSION/task:t-EXAMPLE","id":"note-RETURNED_ID","expectedRevision":2}
{"action":"restore","requestId":"request-unique-restore","by":"Agent Zero","source":"session:EXACT_SESSION/task:t-EXAMPLE","id":"note-RETURNED_ID","expectedRevision":3}
```

Send one JSON object per invocation. Update requires `text` and/or `why`; `why:""` clears the
current explanation without deleting old revisions. Retire and restore change only status.
Retired notes cannot be edited until restored. A stale revision, mismatched retry or unknown
ID returns `conflict`, exit 1, and preserves the store. Read again and decide whether the new
state still permits the intended change; use a new request ID for the resulting command.

## Storage and recovery

Default: `~/.local/state/agent-base/board-notes/`. `AB_A0_NOTES_ROOT` can select another private
absolute runtime directory; the CLI and node reader must receive the same value. Roots within
Git checkouts, task-controlled symlinks, hardlinked journals and group/world-readable stores
are refused. The writer creates its directory as 0700 and files as 0600. No real store is
created by a board read. A missing, never-initialized store is a fresh empty Notes lane.

- `notes.jsonl`: canonical schema-1 hash-chained journal. Every create/update/retire/restore
  keeps the previous revisions. No delete, compaction or automatic import operation exists.
- `notes.last-good.jsonl`: private durable recovery checkpoint. Both writes use same-directory
  atomic rename, file sync and directory sync. A successful retry also seals the checkpoint.
- `.writer-lock`: serializes CLI processes. A busy lock fails closed; it is never force-stolen.
  A naturally stopped/crashed writer may leave a lock. Inspect its PID and the owning operation
  before moving that lock into a private recovery archive. Never interrupt a live owner.

The journal is bounded to 2 MiB and 5,000 events. At the bound the writer fails with `too-large`
and preserves every note. Retention/archive changes require an explicit owned migration;
this writer never silently prunes history.

A malformed, truncated, missing-after-initialization or changed primary returns last-good notes
with a stale/error state, including after reader restart. Mutations refuse that damaged primary.
Recovery is an explicit owner operation: preserve the damaged file and checkpoint in a private
archive, validate the checkpoint and outstanding request receipts, then atomically restore the
reviewed checkpoint. This CLI does not auto-repair damage or hide an uncertain write. Replaying
the original request after recovery either returns its durable receipt or applies it once.

The board reads only this canonical Notes store. It does not scan Life, WhatsApp, old Zero notes
or other private folders. Open Notes show current revision/provenance; retired Notes remain in
a folded section and can be restored by Zero using the same writer.

## Validation and integration

Focused tests use temporary synthetic stores, an actual local CLI subprocess, isolated HTTP
GETs and a sealed browser fixture. They never write real notes or attach to an agent.

`routes/a0-board.route.ts` remains the existing auto-loaded GET `/api/a0/board`; no server wiring
or write route is required. `createA0BoardReader` keeps idea reads on the configured Zero task
root and uses the private Notes root separately. The new writer must be included with the
node source when the release is installed. Adopting this command in Zero's own tool/skill
instructions is an Agent Zero owner step; this change does not edit that repository or send
the owner a message.
