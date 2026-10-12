/**
 * GET /api/usage/tasks: plan-token cost per seat and per task over 24 h, with the waste named (fetch loops, files read
 * again, carried Bash output, finished-task context). Shaan, 13 Oct: "track the usage and usage per task and wasted tokens".
 * The numbers come from the harness's scripts/usage-tasks.py (same prices as token-where.py); this only serves its file.
 * Refreshed when the screen asks and the file is over 15 min old: one run at a time, no timer.
 */
import { spawn } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import type http from "node:http";

const FILE = process.env.AB_USAGE_TASKS_FILE ?? path.join(homedir(), ".local/state/agent-base/usage-tasks.json");
const SCRIPT = process.env.AB_USAGE_TASKS_SCRIPT ?? path.join(homedir(), "SISO_Workspace/SISO_Agents/siso-harness-lab/scripts/usage-tasks.py");
const FRESH_MS = 15 * 60_000;
let running: number | null = null;

function refresh() {
  if (running && Date.now() - running < 10 * 60_000) return;
  running = Date.now();
  try {
    const child = spawn("nice", ["-n", "10", "python3", SCRIPT, "--hours", "24", "--json", FILE], { stdio: "ignore", detached: true });
    child.on("exit", () => { running = null; });
    child.on("error", () => { running = null; });
    child.unref();
  } catch { running = null; }
}

export async function handleUsageTasks(req: http.IncomingMessage, res: http.ServerResponse, url: URL): Promise<boolean> {
  if (url.pathname !== "/api/usage/tasks" || req.method !== "GET") return false;
  let data: Record<string, unknown> | null = null, ageMs: number | null = null;
  try {
    ageMs = Date.now() - statSync(FILE).mtimeMs;
    data = JSON.parse(readFileSync(FILE, "utf8"));
  } catch {}
  if (ageMs === null || ageMs > FRESH_MS) refresh();
  res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
  res.end(JSON.stringify({ ...(data ?? {}), ready: !!data, ageMs, refreshing: running !== null }));
  return true;
}
