# Mini UI work and after-ship QA

`tools/ui-soul/spawn --mini NAME TASK COMP SLUG PORT TITLE WORDS ASK` uses the explicit Mini adapter. The original eight-argument local path is unchanged. Mini uses the current `roles_model` from Agent Zero's routing file, requires the same policy on Mini, and passes `-m MODEL -e high` to `codex-run` under `heavy --`. No implicit fallback, standing seat, herdr control, remote pull, install or restart occurs.

The stable identity is `ui-soul-TASK-SLUG`; the branch is `codex/IDENTITY`, and its workspace is `~/SISO_Workspace/_data/worktrees/siso-internal-labs-agent-base/IDENTITY`. The requested full commit must already exist in the Mini repository. Use `--revision SHA` to recover against the original commit after local HEAD moves. An existing workspace without an accepted receipt is blocked and preserved. Different arguments for an existing identity are rejected. This bounded invocation waits for the worker (up to one hour) and reports its exit; exit zero proves runner completion, not accepted UI delivery.

A kernel-held admission lock serializes these jobs. Admission requires at least 10 GiB disk free and 2 GiB available memory (free, inactive and speculative macOS pages), then the existing `heavy` gate. Unresolved runs block subsequent admission. Receipts are durable in `~/.local/state/agent-base/mini-delivery/IDENTITY.json`, with source revision, machine/hostname, workspace, model/effort, PID, timestamps, log path and exit status. Local copies default to `.agents/runs/mini-delivery/IDENTITY.json`; `--receipt PATH` overrides that destination. Both commands accept `--host ALIAS` (default `mac-mini-herdr`).

After a disconnect, invoke the identical request to recover the existing receipt. A started run is never relaunched. If its supervisor was interrupted, it returns `unknown`; inspect its recorded owned PID/log before arranging a separately named replacement task. The helper never kills unrelated processes, clears unknown receipts, resets a worktree or adopts someone else's folder. Blocked preflight attempts may be retried with the same request once prerequisites are repaired.

## Release integration contract

The integrating release owner calls this after writing the successful ship/install receipt:

```sh
tools/ab-qa-walker --ship-receipt /absolute/path/release.json \
  --mirror ~/SISO_Workspace/_data/worktrees/siso-internal-labs-agent-base/qa-walker \
  --receipt /absolute/path/qa-mini-receipt.json
```

The release JSON must have `result: "shipped"` or `"installed"` and a full 40-character `merged_sha` (or `revision`). Refused, failed and already-merged events do not trigger a new walk. Exactly one started QA attempt is retained for each revision, including failed attempts. Repeated delivery returns its receipt. Preflight blockers may retry. Hook failure must be surfaced independently from ship success; do not roll back a healthy release because Mini is unreachable.

### Automatic post-install follow-up

`tools/ab-after-install-qa.py` is the reusable integration point. `ab-ship` records a durable deferred entry after a successful push, because a push supplies no installed artifact or API readback. `ab-live` calls the helper in each successful install branch after its rollback trap is disarmed. The helper separately verifies exact API revision and equality between the successful build and installed web-file hashes. A readback mismatch is a blocked follow-up, never an invented pass.

For the preserving installer, invoke this from its caller **only after the installer returns zero and durably writes `result: "installed"`**:

```sh
python3 tools/ab-after-install-qa.py \
  --install-receipt /absolute/path/living-install-TIMESTAMP/receipt.json \
  --acceptance /absolute/path/release-acceptance.json \
  --source /absolute/path/accepted-checkout \
  --dist /absolute/path/accepted-checkout/apps/web/dist
```

Do not put this invocation inside the installer's rollback-controlled `try`. Its install receipt must include exact `after.sha` and `newDistHashes`; the acceptance must include `acceptedCommit` and `distHashes`. The helper compares accepted and installed source trees, validates every artifact hash, and leaves the installation receipt unchanged. It emits a separate `after-install-FULL_SHA.json` in `~/.local/state/agent-base/mini-delivery`. CLI exit zero means the follow-up was handled; inspect the receipt's `state` for QA success, failure or a blocker. Unexpected validation errors also receive a separate `follow-up-error-*.json`.

Preparation probes the existing Mini Git objects and sends an incremental bundle only when needed, plus the accepted web artifact. It creates an owned `qa-FULL_SHA` worktree and `preparation-FULL_SHA` directory, verifies the source tree and artifact hashes, and compares canonical HEAD, status and index bytes before/after. Existing unreceipted directories are refused. Transfers are bounded to 128 MiB compressed / 512 MiB extracted; admission requires 10 GiB disk and 2 GiB available memory. No broad sync, source reset, dependencies installation, symlinks, host restart or model worker launch occurs. The existing Mini Playwright/tool runtime serves the synthetic walk.

A local per-revision lock and started receipt prevent duplicate preparation and QA dispatch. Existing remote `qa-FULL_SHA` started receipts are returned unchanged. Failed attempts remain once-only; an interrupted local hook becomes `unknown` and needs owner inspection of the remote receipt instead of an automatic retry. `ab-mini-run.py` supplies its invocation with Mini's existing `~/.local/bin`, Homebrew and `/usr/local/bin` paths without changing shell configuration. QA runs under the existing bounded adapter; QA failure never rolls back the healthy release.

The initial hook verification is simulated and does not establish natural automatic deployment coverage. The legacy release scripts are inspected and syntax-checked only; their existing install/reset behavior is not executed on the shared checkout. The next newly accepted and installed revision supplies the first natural invocation of this reusable hook. The original 25e receipt remains immutable.

The walker serves only that mirror's static build on an ephemeral loopback port. It uses the existing synthetic `baseCardFixture`, intercepts API reads, aborts external traffic and writes, mocks the two named synthetic chat sockets locally and closes every other WebSocket without connecting upstream, and disables service workers. It never starts the real API. It walks 25 destinations at 1440 and 390 pixels: ten spaces, eleven app pages (including Canvas and Product map) and four Library lists. Every destination records a screenshot, render errors, missing fixture contracts and blocked request attempts. This is synthetic page coverage; real accounts, native Browser integration and live agents are outside its proof.

A missing fixture response returns explicit `blocked` coverage rather than invented data or a clean verdict. The fixture map covers shell, tasks, health, communications, Life, Library, Voice, servers, usage/tokens, release history, research and Product map. Pinboard evidence images are labelled synthetic data images. Unknown contracts return 503 and block coverage. Estate remains explicitly blocked because its companion bundle is outside this static application build. Canvas, Product map and each Library list have destination assertions so a fallback shell cannot pass for those views. Render exceptions, failed assets and broken images file local bug records in the Mini evidence store, deduplicated by destination/type/normalized symptom across viewport and revision. Each record retains first/latest revision and screenshot path. `walk.json` has the complete per-viewport inventory. These are evidence bug records, not automatic messages or external task-board writes.

`/api/delight` deliberately supplies no verified deliveries and an explicit synthetic-unavailable explanation. `/api/remote/agents` supplies disabled, unconfigured, read-only inventory with no sources. These responses exercise the readers without asserting live evidence or contacting machines. Estate's injected blocker has a dedicated marker: the walker checks that both the iframe and its marker are visible before accepting short outer-shell text. This still records `blocked`, never a full Estate pass. Hidden frames and independent render errors still fail.

### Estate companion boundary

Read-only inspection found the owning bundle at `SISO_Agents/siso-estate/plan/world/app/dist/world.html`. Its `src/data.ts` imports `../../world.json?gz`; `vite.config.ts` embeds that snapshot and model assets into the single HTML file, and `scripts/pack-html.mjs` compresses the module again. Mocking network API calls cannot replace the private snapshot already inside that artifact. No bundle, snapshot or estate source is copied or changed by this walker.

The retained `mini-estate-companion-audit.json` records the Estate source revision and separate source/artifact hashes. An accepted synthetic companion is still unavailable. The Estate owner must supply a synthetic-data build or a reviewed synthetic-input mechanism, with source revision, synthetic input hash, artifact hash and a rendered-readiness assertion. Only then can an explicit companion fixture path be supported; arbitrary HTML or the current placeholder cannot establish full Estate coverage.

## Checks and present gates

```sh
heavy -- python3 tools/test/mini-delivery.test.py
heavy -- python3 tools/test/after-install-qa.test.py
heavy -- node --test tools/test/ab-qa-walk.test.mjs
```

The tests stub remote process/worktree operations and exercise transport encoding, request identity, exactly-once completion/failure, interrupted-run recovery, model policy mismatch, resource refusal, existing workspace refusal and release/mirror gates. A local headless synthetic test attempts a POST, live-node read and WebSocket, checks screenshot/error receipts, and repeats the walk to check bug deduplication. It never contacts the live node.

The natural Mini receipt for installed `25e5837c08648f54818519f908e4de00b9444b12` and its 50 screenshots are retained unchanged: 24 passed, 25 blocked and 1 failed. Its missing delivery/remote fixtures and Estate outer-text false positive prompted the repairs above. Verification of the repaired runner uses a separate local output directory and the hash-verified accepted 25e assets; it neither overwrites `apps/web/dist` nor retries the once-per-revision Mini job. Source hashes and local results are recorded separately from that historical natural receipt.

No real Mini worker or QA browser is launched by implementation verification. Read-only capability inspection and remote natural-task acceptance are distinct proof stages. Integration requires an owner-installed release hook, synced revision/build in a dedicated Mini mirror, the Estate companion fixture if full coverage is required, and one authorized natural Mini QA run. A local dirty candidate walk is not exact shipped-revision or Mini runtime acceptance.


## Isolated sync plan (pending integrating owner revision)

No remote mutation is authorized by this plan alone. The integrating owner first writes `miniApprovedRevision` as a full 40-character accepted commit in `.agents/scratchpads/landing-20261006/INTEGRATION-STATE.json`, with `frozen: true`; the successful ship receipt must name that same commit. The current dirty candidate build is diagnostic only and must not be used as the shipped artifact.

1. Re-read both Git statuses, worktree inventories and routing hashes immediately before syncing. Mini's canonical main currently has other work; never switch, pull, reset, clean, stage or overwrite it. Use its object database only. Verify the approved commit and its necessary ancestor locally, then create an incremental Git bundle from that commit excluding the verified common Mini ancestor. Transfer only that bundle to the existing owned delivery scratch area; verify the bundle on Mini and import the commit to a new `refs/mini-delivery/FULL_SHA` ref. If ancestry is unavailable, stop for the integrating owner to select another known common base; do not clone the repository.
2. Reuse an already-owned, clean `qa-FULL_SHA` worktree only with its matching preparation receipt. Otherwise create a fresh detached worktree from the imported full SHA at `~/SISO_Workspace/_data/worktrees/siso-internal-labs-agent-base/qa-FULL_SHA`, refusing any existing unowned path. Preserve the canonical worktree, its dependencies, runtime data, agents and browser profiles. Record exact HEAD and tracked-clean checks.
3. Transfer only the owner's checked `apps/web/dist` artifact into the new mirror, with its `DEPLOYED_SHA` and file SHA-256 manifest. Require the marker to equal the approved full SHA and verify every transferred file hash. Do not copy the dirty diagnostic build, credentials, node_modules, profiles or private catalogues. The walker can read the canonical checkout's existing Playwright installation through Git common-dir resolution; no install or symlink is needed. If dependencies or WebKit are unavailable, return blocked.
4. QA itself does not select a model and does not need routing mutation. Before a UI worker is permitted, reconcile Mini's exact routing file with the approved 6 October policy (`roles_model: gpt-6-astra`). Owner reviews the policy delta; archive the previous file with a manifest, then perform a hash-guarded replacement only if it is unchanged since review. Require a matching approved policy hash and a second `roles_model` read. Preserve all other runtime settings and do not restart any agent. Local approved policy currently hashes to `1b3c7c330f9b33613f5a0a347ac0f288572d0ce54c4f0e859746bb119f5bafa5`; re-read before approval because routing changes independently.
5. Invoke `tools/ab-qa-walker --ship-receipt ABSOLUTE_SUCCESS_RECEIPT --mirror ABSOLUTE_QA_WORKTREE --receipt ABSOLUTE_LOCAL_RECEIPT` once. Preserve `qa-FULL_SHA` identity when recovering transport interruption. Check both runner and `walk.json`, retain screenshots and explicit blocked/failed destinations, then run the estate refresh and doctor for any newly created worktree. Release success and Mini QA outcome remain separate. A natural UI job under t-0386 still needs its own owned task/brief and acceptance receipt; this QA launch does not prove UI-worker delivery.
