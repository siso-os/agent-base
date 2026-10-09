# Donor Work, t-0226

The read-only Work adapter links approved donor projects/tasks to existing Agent Base project/task viewers. It does not create or mutate canonical tasks, copy production records, infer ownership from names, run remote commands or open a donor terminal. The source schema is the `Work` class in `ops/siso/agents-hub/lib/work.mjs` at donor commit `4c6426646148d341b8ee150c1866ff4d0f5bcc25`.

## Identity and ownership

- Donor project identity is `(source.id, project.id)`. Task identity adds `task.id`, which is only unique within that project. Equal titles or task IDs in different projects never join.
- Each output record retains donor IDs, source-code revision and the SHA-256 of the exact reviewed data export. Source-code revision is not a data revision or deployed-asset claim.
- An owner-reviewed mapping supplies exact canonical project/task IDs. They must resolve in the existing registry and canonical task reader. No case folding, aliases, titles, agent-name matching or inferred relationships are used.
- Mapping is navigation authority only. It does not reassign a canonical task to a project or owner. Donor `todo/doing/done`, owner strings and project `active/backlog` remain distinct from canonical stage/owner semantics. Many-to-one mappings are refused; merging belongs to the owning writer.
- Missing/unavailable destinations are visible and cannot be opened. Snapshot/config changes are read on the next request; malformed/revoked input does not retain prior links. Staleness is based on capture time, not file mtime.

## Trusted configuration and export

`AB_DONOR_WORK_CONFIG` points to an absolute server-owned JSON file. With no setting, the endpoint reports `unconfigured` without reading donor data. No environment or live mapping is configured by this implementation. A browser cannot choose source paths, credentials, URLs or mappings.

Configuration shape (all names below are synthetic):

```json
{
  "schema": 1,
  "source": { "id": "synthetic-donor", "revision": "4c6426646148d341b8ee150c1866ff4d0f5bcc25" },
  "snapshot": { "path": "/absolute/private/reviewed-work.json", "sha256": "<64 lowercase hex characters over the exact export bytes>" },
  "maxAgeMs": 86400000,
  "projects": [{
    "donorProjectId": "alpha", "projectId": "exact-registry-project-id",
    "tasks": [{ "donorTaskId": "shared", "taskId": "t-exact-canonical-id" }]
  }]
}
```

The export envelope is `{schema:1, source:{id,revision}, capturedAt:<ISO date>, projects:[...]}`. Each project follows the donor's Work fields: `id`, `name`, `oneliner`, `goal`, `area`, `priority`, `stage`, `updated_at` and `tasks`. A task carries `id`, `title`, `state`, `owner`, `updated_at`. Older donor projects may omit stage (active) or priority (2), as in the source reader. The dedicated export must exclude private/personal projects; `area:personal` is rejected. Agents, profiles, repos, console events, timelines and transport fields are not projected. This slice has no automatic export or production-transfer job.

Files are bounded regular files, opened without following a final symlink: 256 KiB configuration, 2 MiB snapshot, 200 projects and 2,000 tasks. Source ID/revision and data hash must match the mapping. Invalid source bytes return an explicit unavailable state without a local path or source payload in the error. Keep approved live exports in their owned private runtime data plane, not in git. Changing the export requires an explicitly reviewed matching hash; updating configuration is an owner action, not an HTTP write endpoint.

## Route and view integration

`services/node/src/routes/donor-work.route.ts` exports the existing auto-discovered GET route:

- `GET /api/donor/work` reads the reviewed projection.
- `GET /api/donor/work/projects/:donorProjectId` narrows it by exact donor ID.
- No POST/PUT/DELETE or proxy route exists. Existing server authentication/origin policy is unchanged.

`DonorWork` is a leaf view accepting `{data, error, onOpenProject, onOpenTask}`. Reuse the parent's shared read (`useSharedResult('/api/donor/work', 30000)` while mounted), current project-opening callback and Tasks focus `{id: taskId}`. It uses the existing `TaskFold`, creates no transport/polling loop, mounts no task actions and never supplies a donor ID to a canonical writer. A failed parent refresh hides links until a successful read. Parent owns the App/Library/Project entry and callbacks; those files were not edited by this slice.

Full `TasksPage`/`ProjectSpace` wrappers were deliberately not embedded: they mount canonical writers/agent actions and interpret canonical schemas. The adapter opens those existing destinations with their exact IDs instead of pretending donor rows are canonical `TaskSummary` objects.

## Other three inventoried migrations

| Donor route | Existing reader/view to reuse | Distinct remaining contract |
|---|---|---|
| `:workspaceSlug/herdr` | `remote-inventory.ts`, RemoteInventory/Navigation, ServersSpace | Explicit donor machine ID to estate machineKey/session/user; configured read-only coverage. Pane/terminal/input controls are a separate runtime contract. |
| `:workspaceSlug/team` | The same remote reader plus Owners/OwnerSpaceWork and native health readers | Plane Project/Module/Issue IDs need a separately reviewed relation to canonical IDs. Do not inherit donor name/token joins. Health metadata does not establish task ownership. |
| `:workspaceSlug/fleet` | Same native Fleet/Servers readers; donor route defaults to FleetRoot | It is an Orca compatibility alias, not a fourth inventory. Paired Orca frame/bridge/terminal/auth stays separately owned. |

No extra inventory wrapper or health polling loop is justified by these three routes. The next independent Work increment is a bounded donor goal-to-project relation adapter (and then explicit goal ordering/writer ownership), not an invented mapping from labels. Donor project timeline/check-ins, source export automation and any actual record migration remain separate software increments; live mapping authority is not used as an excuse to call them implemented.

## Acceptance

Run only the focused checks through `heavy --`:

```sh
heavy -- node --experimental-strip-types --no-warnings --test services/node/test/donor-work.test.mjs
heavy -- node --experimental-strip-types --no-warnings services/node/test/donor-work-ui.mjs
```

Fixtures are synthetic and confined to owned temporary directories. The HTTP test exercises the actual route/dispatcher. The UI check renders the real component against the actual reader/route, records exact callback IDs at 1440/390, checks unavailable/stale/error states, and closes its browser/server. It does not operate the parent app, read production donor records or establish installed/live completeness of t-0226.
