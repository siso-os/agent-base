import { execFile } from "node:child_process";
import type http from "node:http";
import os from "node:os";
import { promisify } from "node:util";

export type LaunchdJob = {
  label: string; health: string; program?: string; args?: string; schedule?: string;
  runs_per_day?: number; loaded?: boolean; pid?: number | null; last_exit?: number | null;
  log?: string; log_mb?: number | null; log_age_h?: number | null; owner?: string; plist?: string;
};
export type LaunchdSnapshot = { machine: string; at: number; jobs: LaunchdJob[] };
const run = promisify(execFile);
type Result = { data: LaunchdSnapshot } | { error: string };
let cached: { at: number; result: Result } | null = null;
let pending: Promise<Result> | null = null;

async function inventory(): Promise<Result> {
  try {
    const [command, ...args] = (process.env.AB_LAUNCHD_CMD ?? "launchd-inventory --json").trim().split(/\s+/);
    const { stdout } = await run(command, args, { timeout: 10_000, maxBuffer: 4 << 20, env: { ...process.env, PATH: `${process.env.PATH ?? ""}:${os.homedir()}/.local/bin` } });
    const data = JSON.parse(stdout);
    if (!data || typeof data.machine !== "string" || !Number.isFinite(data.at) || !Array.isArray(data.jobs) || !data.jobs.every((j: any) => j && typeof j.label === "string" && typeof j.health === "string" &&
      ["program", "args", "schedule", "log", "owner", "plist"].every((key) => j[key] == null || typeof j[key] === "string") &&
      ["runs_per_day", "pid", "last_exit", "log_mb", "log_age_h"].every((key) => j[key] == null || Number.isFinite(j[key])))) throw new Error("Invalid inventory");
    return { data };
  } catch {
    return { error: "Laptop jobs inventory unavailable; retrying on the next refresh." };
  }
}

export async function handleLaunchd(req: http.IncomingMessage, res: http.ServerResponse, url: URL): Promise<boolean> {
  if (url.pathname !== "/api/launchd") return false;
  if (req.method !== "GET") {
    res.writeHead(405, { "content-type": "application/json", allow: "GET" });
    res.end(JSON.stringify({ error: "GET only" }));
    return true;
  }
  if (!cached || Date.now() - cached.at >= 60_000) {
    pending ??= inventory().then((result) => { cached = { at: Date.now(), result }; return result; }).finally(() => { pending = null; });
    await pending;
  }
  const result = cached!.result;
  res.writeHead("data" in result ? 200 : 502, { "content-type": "application/json", "cache-control": "no-store" });
  res.end(JSON.stringify("data" in result ? result.data : result));
  return true;
}
