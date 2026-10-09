// t-0579: in a pane's first seconds herdr lists it with no `agent` (it has not seen the CLI yet). /api/agents still gives
// that row a string `tool`; an absent one crashed the app's chat (ModelChip's `.replace`) for a stranger who opened a
// just-started agent. A sealed node: fake herdr, scratch HOME. Never the live node. Run with heavy:
//   node services/node/test/fresh-agent-tool-http.mjs
import { spawn } from "node:child_process";
import { mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { suitePort } from "./suite-runtime.mjs";

const REPO = path.join(import.meta.dirname, "../../..");
const PORT = await suitePort();
const scratch = realpathSync(mkdtempSync(path.join(process.env.TMPDIR ?? tmpdir(), ".siso-ephemeral-fresh-agent.")));
const agentsFile = path.join(scratch, "agents.json");
writeFileSync(agentsFile, JSON.stringify([
  { agent_status: "unknown", cwd: scratch, pane_id: "w1:p9", terminal_id: "term_new9", name: "NEW-ONE" },
  { agent: "claude", agent_status: "idle", cwd: scratch, pane_id: "w1:p8", terminal_id: "term_old8", name: "OLD-ONE" },
]));
const results = [];
const check = (name, ok, detail = {}) => { results.push(!!ok); console.log(JSON.stringify({ check: name, ok: !!ok, ...detail })); };
const node = spawn(process.execPath, ["--experimental-strip-types", "--no-warnings", "src/server.ts"], {
  cwd: path.join(REPO, "services/node"),
  env: { ...process.env, HOME: scratch, AB_PORT: String(PORT), AB_HERDR: `${process.execPath} ${path.join(REPO, "services/node/test/fake-herdr.mjs")}`,
    FAKE_HERDR_AGENTS_FILE: agentsFile, AB_HOSTS_DIR: path.join(scratch, "hosts"), AB_STATE: path.join(scratch, "rows.json"),
    AB_REGISTRY: path.join(scratch, "registry.json"), AB_OWNERS_DIR: path.join(scratch, "owners"), AB_CLAUDE_DIRS: path.join(scratch, "claude") },
  stdio: ["ignore", "ignore", "pipe"],
});
try {
  let body;
  for (let i = 0; i < 60 && !body; i++) { try { const r = await fetch(`http://127.0.0.1:${PORT}/api/agents`); if (r.ok) body = await r.json(); } catch {} if (!body) await new Promise(r => setTimeout(r, 250)); }
  const row = name => body?.agents.find(a => a.name === name);
  check("a pane herdr has not identified yet is listed", !!row("NEW-ONE"), { names: body?.agents.map(a => a.name) });
  check("its tool is a string, not missing", typeof row("NEW-ONE")?.tool === "string", { tool: row("NEW-ONE")?.tool ?? "<missing>" });
  check("an identified one keeps its tool", row("OLD-ONE")?.tool === "claude", { tool: row("OLD-ONE")?.tool });
} catch (error) {
  check("fresh-agent-tool suite completes", false, { error: String(error).slice(0, 300) });
} finally { node.kill(); }
console.log(JSON.stringify({ passed: results.filter(Boolean).length, of: results.length }));
process.exitCode = results.length && results.every(Boolean) ? 0 : 1;
