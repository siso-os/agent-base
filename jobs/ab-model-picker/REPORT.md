# Model picker — 5 October 2026

Implementation and isolated real-Codex acceptance are complete. Live deployment is held: the job's final hard line says never deploy to production, while its earlier ship command enqueues an automatic live deployment. No real agent was changed or restarted.

## Causes

- Effort: the picker selected an optimistic local value and fell back to medium when remounted; Codex ignored `set_effort` and omitted effort from its descriptor, and service restarts reused original CLI flags. Fixed at `apps/web/src/components/ModelMenu.tsx:87`, `services/host/src/codex-host.ts:141`, and `services/host/src/service-runner.ts:91`.
- Astra: `ModelMenu` hardcoded only Sol and Luna, and the Codex socket had no `set_model` handler. Fixed by the runtime account catalog at `services/host/src/codex-host.ts:134`, its handler at line 362, and the dynamic picker at `apps/web/src/components/ModelMenu.tsx:84`.
- False reconnect warning: `WebSocket.send()` returns undefined, so successful model/effort sends were treated as failures. `apps/web/src/components/ChatView.tsx:1105` now returns an explicit boolean.

## Result

The picker displays only host-reported effort, exact Codex model identity, all models returned by the account's `model/list`, and each model's supported efforts. Unsupported settings and changes during an active Codex turn are explicitly rejected; no silent effort clamp. The host persists accepted settings and sends those exact overrides on each next turn. Host/runner restarts prefer saved settings over stale launch flags. Claude SDK hosts save settings by native session, including terminal hosts whose transient connection descriptor is removed at shutdown. Host metadata wins over an older transcript model in the HUD. Astra no longer incorrectly marks Luna as current in the move menu.

## Verification

- `heavy -- pnpm check`: web/node/host type checks, production web build, 18 Vitest files (141 passed, 1 skipped), 33 workspace contract checks, owner stream, both new settings regressions, managed Codex children and headless WebKit shell.
- `services/host/test/model-picker.mjs`: invalid and unsupported effort/model rejection; changes during an active turn rejected; exact native turn parameters; socket reconnect; host and runner restart; unchanged thread; host-to-node HUD projection; Sol/Astra/Sol with max retained.
- `services/host/test/set-model.mjs`: fake SDK acknowledgement/rejection and persistence across a fresh PID after deleting only the transient host descriptor. No Claude inference.
- `services/host/test/model-picker-live.mjs`: real Codex inference and actual WebKit picker clicks; leaving/reloading; host and runner restart with old Sol/medium CLI flags; native turn_context model/effort proof. The test explicitly resumes its own held queue after restart before sending the final turn.
- `LIVE-VERIFY.txt`: final real acceptance receipt. `astra-max-restarted.png`: inspected 1440x1000 screenshot of Astra and max after both restarts. Every test browser and owned host/node/Vite process was stopped.

To reproduce the real acceptance, run `heavy -- node services/host/test/model-picker-live.mjs jobs/ab-model-picker`. To see the result, open `astra-max-restarted.png`. After an authorized deployment and an ordinary restart of an existing soul's host, open that soul's chat, click its model chip, select Astra, then max. Existing host processes continue running their already-loaded version until restarted; this job did not restart them. Native terminal slash-command persistence and real Claude inference were not exercised.
