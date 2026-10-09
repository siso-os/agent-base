# Service-owned Codex backends

Codex backend selection is local and explicit. Claude remains pinned by `services/host/package.json`. The backend management API never downloads a package, rewrites an existing unmanaged service definition, restarts a service, or chooses an implicit default version.

## Retaining an installed Codex package

An administrator can snapshot an already installed `@openai/codex` package with the producer below. Supply absolute canonical paths and the currently observed catalog revision; use revision `0` only when creating a catalog. This operation copies the complete platform vendor layout, including resources, PATH helpers and native sidecars. It does not execute the source binary or contact a package registry.

```sh
node --experimental-strip-types --no-warnings services/host/bin/backend-catalog.mjs \
  --source-package /absolute/installed/node_modules/@openai/codex \
  --artifacts-dir /absolute/private/backend-artifacts \
  --catalog /absolute/private/backend-catalog.json \
  --expected-catalog-revision 0
```

The parent package, platform package and vendor layout must agree on version and platform. The native executable must match this machine's architecture. Symlinks, special files, writable shared paths, package changes during copying, and catalog revision conflicts fail closed. Retained artifacts use content-based IDs. A change to a resource also produces a new ID. Existing bundles and catalog revisions remain available for rollback; interrupted staging is retained with a failure marker. Repeating the same snapshot with the current catalog revision is idempotent.

Provenance records **existing local installed package**, full file hashes, local staging time and `upstreamVerified: false`. This is neither evidence of a download by Agent Base nor verification of the upstream publisher. Version execution is deferred until explicit selection, using a bounded `--version` probe without inherited credentials or config. Each service start and initialization rechecks the selected bundle.

## Initial launch binding

A fresh Codex workspace launch can carry `LaunchInput.backendCatalogId`. The launch input must retain only this trusted catalog ID; the browser cannot supply executable paths or hashes. The existing install controller reads `AB_WORKSPACE_RECEIPT` while its parent holds the existing `launch-<workspaceId>.lock`. It verifies the durable launch phase, model, name, CWD, Git ownership, local lock owner, catalog, and exact unloaded launchd state before selecting revision 1 at `<receipt>.backend-selection`.

The controller then writes `AB_BACKEND_SELECTION` into the existing service definition. The runner resolves the current selection on every service child start and holds its exclusive selection lease across restarts. A saved host, selection or service definition is preserved for owner reconciliation; fresh launch does not overwrite it. Existing unbound services require a separate explicit lifecycle transition. A launch without `backendCatalogId` retains its existing legacy path.

The producer's catalog defaults to `~/.local/state/agent-base/backend-catalog.json` for readers, or can be supplied through `AB_BACKEND_CATALOG`. A custom path must be present in the Node/controller environment when launching. Catalog and owner files are private local state and must not be committed.

## Selection, rollback and runtime evidence

`GET /api/backends` and `GET /api/backends/<workspaceId>` separate catalog, selected version, recorded validation, loaded launchd state and running version. `POST /api/backends/select` accepts `serviceId`, `catalogId` and `expectedRevision`; `/api/backends/rollback` accepts `serviceId`, `targetRevision` and `expectedRevision`. Both require existing durable workspace/service ownership and an inactive service, recheck ownership under the launch lock, validate all retained bytes, and append selection history. Unknown launchctl results remain unknown.

For bundle-managed services, the Codex host records a unique run ID, native child PID, host PID, workspace/session, selection revision and hashes. It marks initialization only after the native app-server initialize response. The management reader requires a fresh bounded loopback `/health` response matching that private host proof and current selection, plus live host/native PIDs. A label, selected version, stale host file, stopped process, mismatched run, or mismatched session cannot supply a running version.

The resulting evidence is `spawned-validated-local-bundle`. `providerReportedVersion` remains null because the app-server initialization response is not treated as an independent version report. Hosted children inherit the native binary but do not claim or lock their parent's service selection. Their runtime version remains unattested by this service-owned API.

The retained service environment removes global `CODEX_MANAGED_PACKAGE_ROOT` and `CODEX_MANAGED_BY_*` updater flags. This prevents a retained service from inheriting the global npm wrapper's update ownership.

## Bounded verification

`heavy -- node --experimental-strip-types --no-warnings services/host/test/backend-producer.mjs` builds a tiny synthetic native provider and exercises the snapshot producer, catalog revisions, resource tampering, real install controller with fake launchctl, real supervised runner and host, and actual management HTTP registry. It makes no provider calls or real service/catalog changes. Existing `backend-version.mjs` and `backend-management-http.mjs` cover inactive selection and rollback ownership separately.

Actual package staging, real service adoption and live provider initialization are operational acceptance steps. Passing the fixture does not claim that any existing service is upgraded or version-attested.
