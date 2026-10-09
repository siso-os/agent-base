import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const checks = [
  ["Model account and context contracts", ["exec", "node", "--experimental-strip-types", "--no-warnings", "--test", "services/node/test/model-accounts.mjs"]],
  ["Claude billing reader boundary", ["exec", "python3", "tools/test/claude-account-readings.test.py"]],
  ["Typecheck apps/web", ["--filter", "@agent-base/web", "exec", "tsc", "--noEmit", "-p", "tsconfig.json"]],
  ["Typecheck services/node", ["--filter", "@agent-base/web", "exec", "tsc", "--noEmit", "--incremental", "--tsBuildInfoFile", "../../node_modules/.cache/tsc/node.tsbuildinfo", "--target", "ES2022", "--module", "NodeNext", "--moduleResolution", "NodeNext", "--allowImportingTsExtensions", "--skipLibCheck", "--types", "node", "--typeRoots", "../../services/node/node_modules/@types", "../../services/node/src/routes/donor-work.route.ts", "../../services/node/src/routes/remote-enrollment.route.ts", "../../services/node/src/routes/writer-measurements.route.ts"]],,
  ["Typecheck services/host", ["--filter", "@agent-base/web", "exec", "tsc", "--noEmit", "--incremental", "--tsBuildInfoFile", "../../node_modules/.cache/tsc/host.tsbuildinfo", "-p", "../../services/host/tsconfig.json"]],
  ["Build apps/web", ["--filter", "@agent-base/web", "build"]],
  ["Unit tests", ["dlx", "vitest@3.2.4", "run", "--config", "vitest.config.ts"]],
  ["Project page task and owner projection", ["exec", "node", "services/node/test/project-page.mjs"]],
  ["Working brief bounded reads", ["exec", "node", "--experimental-strip-types", "--no-warnings", "services/node/test/working-brief.mjs"]],
  ["Project page fixture interactions", ["exec", "node", "services/node/test/project-page-ui.mjs"]],
  ["Idle sleep eligibility", ["exec", "node", "--experimental-strip-types", "--no-warnings", "--test", "services/host/test/idle-sleep.mjs"]],
  ["Idle sleep/wake runner and node bridge", ["exec", "node", "--experimental-strip-types", "--no-warnings", "services/host/test/sleep-wake-lab.mjs"]],
  ["Sleep reader and control boundaries", ["exec", "node", "--experimental-strip-types", "--no-warnings", "services/node/test/host-sleep.mjs"]],
  ["Claude idle sleep/wake", ["exec", "node", "--experimental-strip-types", "--no-warnings", "services/host/test/sleep-wake-claude.mjs"]],
  ["Idle sleep UI", ["exec", "node", "services/node/test/idle-sleep-ui.mjs"]],
  ["Live helper rollback and preservation", ["exec", "node", "--test", "tools/test/ab-live-rollback.test.mjs"]],
  ["Agent panel ownership model", ["exec", "node", "--experimental-strip-types", "--no-warnings", "tools/agent-panel-model-check.mjs"]],
  ["Codex run summary cache", ["exec", "node", "--experimental-strip-types", "--no-warnings", "--test", "services/node/test/codex-runs.test.mjs", "services/node/test/codex-run-summaries.test.mjs", "services/node/test/codex-run-summary-callers.test.mjs", "services/node/test/codex-run-sidecars.test.mjs", "services/node/test/codex-run-sidecar-review.test.mjs"]],
  ["Subagent output rates and cached provenance", ["exec", "node", "--experimental-strip-types", "--no-warnings", "--test", "services/node/test/subagent-rate.test.mjs", "services/node/test/subagent-rate-reader.test.mjs", "services/node/test/codex-run-rate-cache.test.mjs"]],
  ["Codex run summary heap retention", ["exec", "node", "--expose-gc", "--experimental-strip-types", "--no-warnings", "services/node/test/codex-run-summary-memory.mjs"]],
  ["Codex run sidecar heap retention", ["exec", "node", "--expose-gc", "--experimental-strip-types", "--no-warnings", "services/node/test/codex-run-sidecar-memory.mjs"]],
  ["Workspace contract", ["exec", "node", "--experimental-strip-types", "--no-warnings", "services/node/test/worktrees.mjs"]],
  ["Owner status and live stream", ["exec", "node", "--experimental-strip-types", "--no-warnings", "services/node/test/owners.mjs"]],
  ["Working brief reader", ["exec", "node", "--experimental-strip-types", "--no-warnings", "--test", "services/node/test/agent-brief.mjs"]],
  ["Research answers stale at once", ["exec", "node", "--experimental-strip-types", "--no-warnings", "services/node/test/research-stale.mjs"]],
  ["Codex model picker", ["exec", "node", "--experimental-strip-types", "--no-warnings", "services/host/test/model-picker.mjs"]],
  ["SDK model and effort", ["exec", "node", "--experimental-strip-types", "--no-warnings", "--test", "--test-concurrency=1", "services/host/test/set-model.mjs", "services/host/test/setting-order.mjs"]],
  ["Managed child return admission", ["exec", "node", "--experimental-strip-types", "--no-warnings", "--test", "services/host/test/child-return-admission.mjs"]],
  ["Managed Codex children", ["exec", "node", "--experimental-strip-types", "--no-warnings", "services/host/test/subagents.mjs"]],
  ["Spotlight command palette", ["exec", "node", "services/node/test/cmdk-spotlight.mjs"]],
  ["Headless web check", ["exec", "node", "services/node/test/headless-page.test.mjs"]],
  ["Reply copy and prompt library", ["exec", "node", "apps/web/test/chat-controls-ui.mjs"]],
  ["Owner chat navigation", ["exec", "node", "--experimental-strip-types", "--no-warnings", "apps/web/test/owner-chat-navigation.mjs"]],
  ["Browser visibility and synthetic profiles", ["exec", "node", "apps/desktop/test/browser-visibility.mjs"], "browser-visibility"],
  ["Rail and instrument peeks", ["exec", "node", "services/node/test/rail-peek.mjs"]],
  ["Library document discovery", ["exec", "node", "--experimental-strip-types", "services/node/test/library-documents.mjs"], "library"],
  ["Library read lifecycle", ["exec", "node", "--experimental-strip-types", "--no-warnings", "--test", "apps/web/test/library-read.mjs"]],
  ["Library read route boundaries", ["exec", "node", "--experimental-strip-types", "services/node/test/library-route.mjs"]],
  ["Browser favicons from the site itself", ["exec", "node", "--experimental-strip-types", "--no-warnings", "services/node/test/favicon-route.mjs"]],
  ["Browser ad blocker rules", ["exec", "node", "--experimental-strip-types", "--no-warnings", "--test", "services/node/test/adblock.test.mjs"]],
  ["HTTP area dispatch parity", ["exec", "node", "--experimental-strip-types", "--no-warnings", "--test", "services/node/test/http-route-parity.mjs"]],
  ["Persistent owner and exact conversation pins", ["exec", "node", "--experimental-strip-types", "--no-warnings", "--test", "services/node/test/agent-pins.mjs"]],
  ["Delivered review capture", ["exec", "node", "--experimental-strip-types", "--no-warnings", "services/node/test/review-delivery.mjs"]],
  ["Sealed conversation routes", ["exec", "node", "--experimental-strip-types", "--no-warnings", "--test", "services/node/test/conversation-route.mjs"]],
  ["Chat session isolation", ["exec", "node", "--experimental-strip-types", "--no-warnings", "services/node/test/chat-session-isolation.mjs"]],
  ["Review transport identity", ["exec", "node", "--experimental-strip-types", "--no-warnings", "services/node/test/review-wiring-audit.mjs"]],
  ["Supervised exact-session resume", ["exec", "node", "--experimental-strip-types", "--no-warnings", "services/node/test/supervised-resume-route.mjs"]],
  ["Route registry contracts", ["exec", "node", "--experimental-strip-types", "--no-warnings", "services/node/test/route-registry.mjs"]],
  ["WhatsApp sending and private organisation", ["exec", "node", "--experimental-strip-types", "services/node/test/whatsapp-comms.mjs"], "whatsapp"],
  ["Component manifests", ["exec", "node", "--experimental-strip-types", "--no-warnings", "services/node/test/component-catalog.mjs"]],
  ["Task resource admission", ["exec", "node", "--experimental-strip-types", "--no-warnings", "services/node/test/resource-admission.mjs"]],
  ["Bounded usage reads", ["exec", "node", "--experimental-strip-types", "--no-warnings", "services/node/test/usage-bounded.mjs"]],
  ["Codex credit balance validity", ["exec", "node", "--experimental-strip-types", "--no-warnings", "--test", "services/node/test/tokens-credit-balance.mjs"]],
  ["Quota provenance", ["exec", "node", "--experimental-strip-types", "--no-warnings", "services/node/test/quota-provenance.mjs"]],
  ["Authenticated Codex quota source", ["exec", "node", "--experimental-strip-types", "--no-warnings", "services/node/test/codex-quota-source.mjs"]],
  ["Automatic quota handoff and retry", ["exec", "node", "--experimental-strip-types", "--no-warnings", "services/node/test/codex-quota-handoff.mjs"]],
  ["Task allocation and surface ownership", ["exec", "node", "--experimental-strip-types", "--no-warnings", "services/node/test/task-actions.mjs"]],
  ["Writer dossier and comparison gates", ["exec", "node", "--experimental-strip-types", "--no-warnings", "services/node/test/writer-gates.mjs"]],
  ["Writer measurements", ["exec", "node", "--experimental-strip-types", "--no-warnings", "services/node/test/writer-measurements.mjs"]],
  ["Native writer observation", ["exec", "node", "--experimental-strip-types", "--no-warnings", "services/host/test/writer-measurement-observer.mjs"]],
  ["Task surface projection", ["exec", "node", "--experimental-strip-types", "--no-warnings", "services/node/test/task-surface.mjs"]],
  ["Timeline and release source truth", ["exec", "node", "--experimental-strip-types", "--no-warnings", "services/node/test/timeline-release-truth.mjs"]],
  ["Release screenshot publication", ["exec", "node", "--experimental-strip-types", "--no-warnings", "services/node/test/release-evidence.mjs"]],
  ["Delivery timing provenance", ["exec", "node", "--experimental-strip-types", "--no-warnings", "services/node/test/delight.mjs"]],
  ["Supervised Claude lifecycle", ["exec", "node", "--experimental-strip-types", "--no-warnings", "services/host/test/service-lifecycle.mjs"]],
  ["Stopped host recovery", ["exec", "node", "--experimental-strip-types", "--no-warnings", "services/host/test/stopped-recovery.mjs"]],
  ["Backend fixture plist conversion", ["exec", "node", "--test", "services/host/test/plutil-fixture.test.mjs"]],
  ["Complete backend catalog producer", ["exec", "node", "--experimental-strip-types", "--no-warnings", "services/host/test/backend-producer.mjs"]],
  ["Retained backend version selection", ["exec", "node", "--experimental-strip-types", "--no-warnings", "services/host/test/backend-version.mjs"]],
  ["Backend management HTTP", ["exec", "node", "--experimental-strip-types", "--no-warnings", "services/node/test/backend-management-http.mjs"]],
  ["New chat launch identities", ["exec", "node", "--experimental-strip-types", "--no-warnings", "services/node/test/new-starts.mjs"]],
  ["Remote inventory sources", ["exec", "node", "--experimental-strip-types", "--no-warnings", "services/node/test/remote-inventory.mjs"]],
  ["Remote inventory coverage", ["exec", "node", "--experimental-strip-types", "--no-warnings", "services/node/test/remote-inventory-coverage.mjs"]],
  ["Remote inventory projection", ["exec", "node", "--experimental-strip-types", "--no-warnings", "services/node/test/remote-inventory-projection.mjs"]],
  ["Agent widget records and actions", ["exec", "node", "--experimental-strip-types", "--no-warnings", "services/node/test/widgets.mjs"]],
  ["Agent widget rendering", ["exec", "node", "--experimental-strip-types", "--no-warnings", "services/node/test/widgets-ui.mjs"]],
  ["VPS Work identity mapping", ["exec", "node", "--experimental-strip-types", "--no-warnings", "--test", "services/node/test/donor-work.test.mjs"]],
  ["VPS Work rendering", ["exec", "node", "--experimental-strip-types", "--no-warnings", "services/node/test/donor-work-ui.mjs"]],
  ["Remote enrollment and relay boundaries", ["exec", "node", "--experimental-strip-types", "--no-warnings", "services/node/test/remote-enrollment.mjs"]],
  ["Product map capture provenance", ["exec", "node", "--experimental-strip-types", "--no-warnings", "services/node/test/product-map.mjs"]],
  ["Estate synthetic companion", ["exec", "node", "--test", "tools/test/estate-fixture.test.mjs"]],
  ["Post-install QA acceptance", ["exec", "python3", "tools/test/after-install-qa.test.py"]],
  ["Mini delivery ownership", ["exec", "python3", "tools/test/mini-delivery.test.py"]],
  ["Live smoke stays read-only", ["exec", "node", "tools/test/ab-smoke-readonly.test.mjs"]],
  ["Release source mapping", ["exec", "node", "--test", "--test-name-pattern", "affected mapping", "tools/test/ab-queue.test.mjs"]],
];
if (process.env.CHECK_LAB === "1") checks.push(
  ["Lab: rows survive herdr restart (requires herdr lab)", ["exec", "node", "services/node/test/rows-survive.mjs"]],
  ["Lab: tabs and HUD (requires herdr lab)", ["exec", "node", "services/node/test/tabs-hud.mjs"]],
  ["Lab: terminal chat (requires herdr lab and real Claude)", ["exec", "node", "services/node/test/terminal-chat.mjs"]],
  ["Lab: host chat (requires herdr lab and real Claude)", ["exec", "node", "services/host/test/chat-lab.mjs"]],
);

for (const [name, args, fixture] of checks) {
  console.log(`\n>>> ${name}`);
  const started = Date.now();
  const env = { ...process.env };
  // Each domain probe gets a fresh, caller-owned fixture. It cannot reach private
  // profiles or overwrite the reviewed screenshots kept in the source tree.
  const scratch = fixture ? mkdtempSync(path.join(tmpdir(), `.siso-ephemeral-${fixture}.`)) : null;
  if (fixture === "library") env.LIBRARY_TEST_ROOT = scratch;
  if (fixture === "browser-visibility") env.AB_BROWSER_TEST_TMP = scratch;
  if (fixture === "whatsapp") {
    env.AB_WHATSAPP_STATE = scratch;
    env.AB_ROLODEX_WA = path.join(scratch, "contacts.json");
  }
  let result;
  try { result = spawnSync(pnpm, args, { stdio: "inherit", env }); }
  finally { if (scratch) rmSync(scratch, { recursive: true }); }
  console.log(`<<< ${name}: ${((Date.now() - started) / 1000).toFixed(2)}s`);
  if (result.error) {
    console.error(`${name} could not start: ${result.error.message}`);
    process.exit(result.status ?? 1);
  }
  if (result.status !== 0) process.exit(result.status ?? 1);
}
if (process.env.CHECK_LAB !== "1") console.log("\nLab checks skipped. Set CHECK_LAB=1 to include checks requiring herdr or real Claude.");
