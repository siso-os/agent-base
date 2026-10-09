// A stand-in herdr for checks that need no real agents: `agent list` answers with one idle agent (LINKS, pane w1:p1);
// everything else answers {}. Use as AB_HERDR="node services/node/test/fake-herdr.mjs".
// Optional: FAKE_HERDR_PANES (`pane list`), FAKE_HERDR_AGENTS_FILE (the list, read on every call, so a check can change it), FAKE_HERDR_LOG (each call's
// args appended as a JSON line), FAKE_HERDR_FAIL_ONCE (a flag file: while it exists, the next `pane send-text` deletes
// it and fails, as a busy herdr does).
import { appendFileSync, existsSync, readFileSync, unlinkSync } from "node:fs";

const all = process.argv.slice(2);
if (process.env.FAKE_HERDR_LOG) appendFileSync(process.env.FAKE_HERDR_LOG, JSON.stringify(all) + "\n");
// `--remote <alias> --session <s> agent list` (the Servers page reading another machine): FAKE_HERDR_REMOTE, a JSON
// object of "<alias>/<session>" -> agents; a session not in it fails as an unreachable one does.
const flags = {};
let args = all;
while (args[0]?.startsWith("--")) (flags[args[0].slice(2)] = args[1]), (args = args.slice(2));
if (flags.remote) {
  const lists = JSON.parse(process.env.FAKE_HERDR_REMOTE ?? "{}");
  const list = lists[`${flags.remote}/${flags.session}`];
  if (!list) {
    console.error(`herdr: no session ${flags.session} on ${flags.remote}`);
    process.exit(1);
  }
  console.log(JSON.stringify({ result: { agents: list } }));
} else if (args[0] === "agent" && args[1] === "list") {
  // FAKE_HERDR_AGENTS (a JSON list) replaces the one agent, e.g. a working Claude agent with a session id.
  const src = process.env.FAKE_HERDR_AGENTS_FILE ? readFileSync(process.env.FAKE_HERDR_AGENTS_FILE, "utf8") : process.env.FAKE_HERDR_AGENTS;
  const agents = src ? JSON.parse(src) : [{ agent: "siso", agent_status: "idle", cwd: "/tmp", pane_id: "w1:p1", terminal_id: "term_links1", terminal_title_stripped: "LINKS" }];
  console.log(JSON.stringify({ result: { agents } }));
} else if (args[0] === "pane" && args[1] === "list" && process.env.FAKE_HERDR_PANES) {
  // FAKE_HERDR_PANES (a JSON list): every pane, agent or not (a pane whose agent herdr lost still has its terminal).
  console.log(JSON.stringify({ result: { panes: JSON.parse(process.env.FAKE_HERDR_PANES) } }));
} else if (args[0] === "pane" && args[1] === "send-text" && process.env.FAKE_HERDR_FAIL_ONCE && existsSync(process.env.FAKE_HERDR_FAIL_ONCE)) {
  unlinkSync(process.env.FAKE_HERDR_FAIL_ONCE);
  console.error("herdr: server busy");
  process.exit(1);
} else console.log("{}");
