# Usage display and quota admission

`GET /api/usage` returns immediately, including on a cold cache. `source` stays compatible with the
existing display (`stack-opt` or `pending`); `status`, `at`, `stale`, `refreshing`, and `attemptedAt`
distinguish waiting, unavailable, and last-good readings. A failed refresh keeps the previous data and
its original observation time. One refresh runs at a time, with the existing five-minute retry cadence.
Each owned command has a thirty-second hard deadline; failed optional split readings stay null.
STACK-OPT remains the producer of burn values. These spending estimates never authorize a launch.

`resource-admission.ts` preserves the existing hardware policy and additionally requires quota bound to
the exact launch host, account, model, and provider bucket. The pooled `tokens.json` Codex entry has no
host/account provenance and cannot grant admission.

`currentResourceAdmission` now supplies a real authenticated local producer. The existing server's
task-actions `admit: currentResourceAdmission` needs no replacement. The producer reads the exact
`roles_model` from routing, the private default Codex login's `tokens.account_id`, the local host/UID,
and the native executable resolved from the installed Codex package on the managed launch PATH.
Before and after each quota read it verifies a fingerprint of authentication, routing, effective config
files, package metadata, executable bytes, working directory and environment. Credentials and response
bodies are never logged. Account identity comes from the independent auth store and must match the
backend quota response; a response cannot nominate its own expected account.

The supported current route is deliberately limited to `gpt-6-astra`, the default local ChatGPT profile,
and the sole explicitly named `codex` provider bucket. An additional/specialized bucket, alternate
provider/profile, keychain-only login, remote host, API-key login or unsupported model fails closed.
No bucket is chosen by array order or copied from an untrusted browser field. Default-launch binding
also checks launchd's inherited profile/proxy environment; unknown overrides deny admission.

The existing managed host has no exposed read-only account RPC. `codex-quota-source.ts` therefore
starts one bounded, task-owned app-server metadata process from the pinned installed native executable.
Its only RPCs are `initialize`, `account/read` with `refreshToken:false`, and `account/rateLimits/read`
with `excludeResetCreditDetails:true` (plus the required `initialized` notification). It never starts
a thread or turn, opts into reserve, changes login, spends reset credits, attaches an agent or starts
a daemon. It kills only that child on success, failure, abort or the 4.5-second hard deadline, destroys
its streams and confirms closure. Admission also retains its five-second quota-read deadline.

For a different trusted transport, `createResourceAdmission({ quotaTarget, quota })` remains the
explicit injection point. `quotaTarget(context)` returns `{ hostId, accountId, model, limitId }` from
that launch authority and is checked again after the read.

`quota(target, signal)` uses that host's existing authenticated transport and returns:

```ts
{
  source: "codex-app-server/account/rateLimits/read",
  hostId: target.hostId, // verified transport identity, not a copied client claim
  observedAt,           // original completed provider read time in milliseconds
  stale: false,         // cached failures must retain their original timestamp and stale flag
  response,             // unmodified account/rateLimits/read response
}
```

The source shape was checked against the installed `@openai/codex` 0.159.2 generated protocol schema.
It supplies `accountId`, `ordinaryUsageAllowed`, `rateLimitsByLimitId`, explicit bucket IDs, and window
durations. Quota reset timestamps arrive in seconds. The adapter preserves 300- and 10080-minute
windows, converts timestamps once, rejects mismatches, and never projects a reset into fresh allowance.
A provider-declared null second window is valid; the current account exposes one weekly window.
At least one valid window and both declared primary/secondary fields are required. An omitted field
is incomplete, and every applicable window must be unexpired and have remaining allowance.
Missing permission, unknown/reached spend controls, stale readings, incomplete windows, exhaustion, or
expired resets deny admission. Credits and reset-credit availability do not override these checks.

For a read-only integration, use `account/rateLimits/read` with `excludeResetCreditDetails: true` and
do not opt into `supportsLunaReserve`. No login, token-refresh request, reset-credit consumption, provider
turn or refresh daemon is implemented here. The quota callback receives an abort signal
and admission enforces a maximum five-second deadline even if the callback does not settle.

The shared workspace adapter now repeats admission for **verified automatic task allocations only**,
using the actual resolved `worktreePath`. `task-actions.ts` owns this classification: it reads the saved
allocation and verifies its task/workspace/launch IDs, name and complete immutable input against the
workspace receipt. A missing, unreadable or contradictory automatic allocation fails closed. A browser
task ID or display name is not ownership. Existing-workspace reuse retains the original writer/input
binding, so a manual reuse request cannot strip automatic provenance.

The optional `LaunchAdapters.beforeStart` hook runs under the existing launch lock after preparation
and host lookup, **before** persisting `handoffAttempted`. A denied quota check has performed no handoff:
the failed receipt retains `handoffAttempted:false` and may safely retry. Once a handoff is attempted,
the existing reconciliation/no-repeat rule stays intact. Both the task-actions path and the general
workspace retry route use this shared hook; a task-actions-only wrapper would leave a retry bypass.

On allowance, the hook passes only `{AB_CODEX_BIN}` as an ephemeral third argument to `start`. The
service command receives that exact checked native executable after inherited environment variables.
The pin is never written into the receipt or accepted from browser input. Automatic allocation currently
uses the default local installed backend; contradictory automatic/catalog provenance is rejected.
Ordinary manual non-Astra, catalog-selected and Claude starts skip this automatic quota policy and
retain their existing launch/profile/selector behavior.

`services/node/test/codex-quota-handoff.mjs` exercises the real scheduler, durable ownership, workspace
reuse and direct retry route with the actual server adapter extracted into a fake executor. It checks
denial/retry, binary pinning, unchanged manual paths, reconciliation and lost/contradictory provenance.
`task-actions.mjs` also verifies that its adapter wrapper forwards the hook and pin. No real quota read,
agent start or service installation is used by those tests. Deployed acceptance remains with the parent.

The authenticated live probe at 2026-10-06 01:41:16 UTC matched the independent account and stable
profile. It returned `ordinaryUsageAllowed:false`, `rateLimitReachedType:rate_limit_reached`, and a
single weekly Codex window with exhausted allowance. Its quota outcome was **denied**.
The redacted timestamped receipt is `.agents/scratchpads/landing-20261006/codex-quota-current.json`.
That observation is not a future entitlement; each later admission reads current provider state.
