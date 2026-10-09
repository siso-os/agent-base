import { execFile } from "node:child_process";
import type http from "node:http";
import os from "node:os";
import { promisify } from "node:util";

export type CodexTab = { tab: string; pane: string; status: string; model: string; cwd: string; branch: string; worked: string; said: string[]; last_commit?: string; task?: string };
export type CodexPair = { pair: string; pane?: string | null; model?: string | null; done: number; open: number; blocked: string[]; next: string; commits: string[] };
export type CodexRun = { at: string; model?: string | null; dir: string; min: number; status?: string | null; task?: string | null; mtok: number };
export type CodexLanes = { at: number; tabs: CodexTab[]; pairs: CodexPair[]; runs: CodexRun[] };
const run = promisify(execFile);
type Result = { data: CodexLanes } | { error: string };
const readings = new Map<string, { cached: { at: number; result: Result } | null; pending: Promise<Result> | null }>();
const strings = (v: unknown) => Array.isArray(v) && v.every((s) => typeof s === "string");

async function readLanes(configured: string): Promise<Result> {
  try {
    const [command, ...args] = configured.trim().split(/\s+/);
    const { stdout } = await run(command, args, { timeout: 10_000, maxBuffer: 4 << 20, env: { ...process.env, PATH: `${process.env.PATH ?? ""}:${os.homedir()}/.local/bin` } });
    const data = JSON.parse(stdout);
    if (!data || !Number.isFinite(data.at) || !Array.isArray(data.tabs) || !Array.isArray(data.pairs) || !Array.isArray(data.runs) ||
      !data.tabs.every((t: any) => t && ["tab", "pane", "status", "model", "cwd", "branch", "worked"].every((key) => typeof t[key] === "string") && strings(t.said) && ["last_commit", "task"].every((key) => t[key] == null || typeof t[key] === "string")) ||
      !data.pairs.every((p: any) => p && typeof p.pair === "string" && typeof p.next === "string" && Number.isFinite(p.done) && Number.isFinite(p.open) && strings(p.blocked) && strings(p.commits) && ["pane", "model"].every((key) => p[key] == null || typeof p[key] === "string")) ||
      !data.runs.every((r: any) => r && typeof r.at === "string" && typeof r.dir === "string" && Number.isFinite(r.min) && Number.isFinite(r.mtok) && ["model", "status", "task"].every((key) => r[key] == null || typeof r[key] === "string"))) throw new Error("Invalid Codex work");
    return { data };
  } catch {
    return { error: "Codex work unavailable; retrying on the next refresh." };
  }
}

/** Shared by the full page and Agent Zero's Now view. */
export async function codexLanes(configured = process.env.AB_CODEX_LANES_CMD ?? "codex-lanes --json"): Promise<Result> {
  let reading = readings.get(configured);
  if (!reading) readings.set(configured, (reading = { cached: null, pending: null }));
  const r = reading;
  if (!r.cached || Date.now() - r.cached.at >= 10_000) {
    r.pending ??= readLanes(configured).then((result) => { r.cached = { at: Date.now(), result }; return result; }).finally(() => { r.pending = null; });
    await r.pending;
  }
  return r.cached!.result;
}

export async function handleCodexLanes(req: http.IncomingMessage, res: http.ServerResponse, url: URL): Promise<boolean> {
  if (url.pathname !== "/api/codex-lanes") return false;
  if (req.method !== "GET") {
    res.writeHead(405, { "content-type": "application/json", allow: "GET" });
    res.end(JSON.stringify({ error: "GET only" }));
    return true;
  }
  const result = await codexLanes();
  res.writeHead("data" in result ? 200 : 502, { "content-type": "application/json", "cache-control": "no-store" });
  res.end(JSON.stringify("data" in result ? result.data : result));
  return true;
}
