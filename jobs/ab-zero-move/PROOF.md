# Agent Zero model move proof

5 October 2026. Real Agent Zero and Agent Base were not moved.

- `heavy -- pnpm check`: exit 0; 14 unit files / 119 tests, 33 workspace checks, managed children, typechecks, build and headless WebKit passed.
- `heavy -- node services/node/test/zero-follows-ui.mjs jobs/ab-zero-move/ui`: 8/8; enabled Move, high default, confirmation cancel/accept, selected effort forwarding, forced error visibility, retained seat and Codex seat identity. Browser closed.
- Harness `tests/agent-move.test.mjs`: 5/5; boot references, high effort, atomic seat rewrite, concurrent-seat retention, reply-before-close, Claude wrapper same-session resume, Codex lock fallback and failed-fallback retention.
- `real-proof.mjs`: isolated guarded workspace wG, Luna -> Sol -> Luna via POST /api/agents/Agent%20Zero/move. Both HTTP 200 / done with resume-locked passport fallback. Rows stayed Agent Zero; herdr names agent-zero; SISO_A0=1 recorded. Close guard required new seat holder idle/done after the move's transcript reply check. Final agent stopped and awaited input without project work.
- Local receipts: `seat-before.json`, `seat-sol.json`, `seat-luna.json`, `row-sol.json`, `row-luna.json`, `move-sol.json`, `move-luna.json`, `events.jsonl`, `real-proof.log`, and `passports/agent-zero/`. Runtime receipts stay local.
- Real-seat dry-runs: `dry-run.json` prepares Claude -> Sol with high effort, SISO_A0=1 and AGENTS.md / PRINCIPLES.md / HANDOFF.md boot list. `dry-run-resume.json` prepares Sonnet with the existing conversation's --resume. Neither launches an agent.
- Initial attempts found two corrected faults: boot context replaced the disposable assignment; closing the old tab removed the new herdr name. The passing run preserves the latest assignment and restores the name after closure. Idle disposable tabs from initial attempts were closed; receipt `cleanup.json`.

Live menu proof follows deployment with `heavy -- node jobs/ab-zero-move/live-shot.mjs`: WebKit blocks terminal sockets and move POSTs, observes and dismisses the exact native confirmation, captures the enabled menu to `live.png`, and closes the browser. Claude live moves remain for Shaan's own click.
