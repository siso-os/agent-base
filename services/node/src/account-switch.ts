/**
 * Switch one Claude agent to another Claude login, same conversation (t-0577). Shaan, 9 Oct ~07:40: "there's a button on
 * the drop down so I can swap the accounts over the clawed accounts". The switch itself is the by-hand scripts that moved
 * real agents (a0-switch-login, owner-switch-login, mini-switch-login); the node picks one, runs it, and says "done" only
 * once the host records show the same chat, same session, live on the chosen login. Nothing here ever moves to Codex.
 */
import { execFile, spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { realpathSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { CLAUDE_ACCOUNTS, type ClaudeAccountId } from "./claude-accounts.ts";
import { readServiceHosts } from "./service-hosts.ts";

export type SwitchState = "queued" | "waiting-idle" | "moving" | "confirming" | "done" | "failed";
export type SwitchStatus = { state: SwitchState; message: string; to?: ClaudeAccountId; stages?: string[] };
/** One live host record, as much as the switch needs. `machine` is set only for a mirrored remote host (ab-remote). */
export type SwitchHost = { name: string; session: string | null; pane: string | null; configDir: string | null; pid: number; machine: string | null; harness: string | null; busy?: boolean };
export type SwitchAgent = { name: string; tool?: string; zero?: boolean; session?: string | null };
export type SwitchDeps = {
  agent: (name: string) => Promise<SwitchAgent | null>;
  readHosts: () => Promise<SwitchHost[]>;
  /** Runs a script. Detached resolves once spawned (code 0); otherwise once it exits. Rejects only when it cannot start. */
  exec: (file: string, args: string[], options: { detached: boolean }) => Promise<{ code: number; stderr: string }>;
  binDir?: string; home?: string;
  now?: () => number; sleep?: (ms: number) => Promise<void>;
  pollMs?: number; confirmMs?: number; remoteIdleMs?: number; idleMs?: number;
};

/** Where each switchable login lives, under the home of the machine the chat runs on. */
const ACCOUNT_DIRS: Partial<Record<ClaudeAccountId, string>> = { "claude-siso-3": ".config/claude-siso-3", "claude-siso": ".claude-siso" };
const accountOf = (id: unknown) => CLAUDE_ACCOUNTS.find(a => a.id === id);
const A0_AFTER = 3;

const last = new Map<string, SwitchStatus>();
const running = new Set<string>();

/** Unknown and read-only logins are refused before anything looks at an agent. */
export function accountSwitchError(to: unknown): string | null {
  const account = accountOf(to);
  if (!account) return "Choose one of the Claude accounts";
  if (account.readOnly || !ACCOUNT_DIRS[account.id]) return `${account.name} account is read-only; it is never a switch target`;
  return null;
}
export const accountSwitching = (name: string) => running.has(name);
export const accountSwitchStatus = (name: string): SwitchStatus | null => last.get(name) ?? null;

/** The account a config folder belongs to, by its folder name only (a remote host's path is on its own machine). */
function accountOfDir(dir: string | null): ClaudeAccountId | null {
  if (!dir) return null;
  const clean = dir.replace(/\/+$/, "");
  for (const [id, rel] of Object.entries(ACCOUNT_DIRS)) if (clean.endsWith(`/${rel}`)) return id as ClaudeAccountId;
  return null;
}
function sameDir(a: string | null, b: string) {
  if (!a) return false;
  const real = (p: string) => { try { return realpathSync(p); } catch { return path.resolve(p); } };
  return real(a) === real(b);
}

/** A short, specific failure line: the script's last stderr line, home paths as ~, nothing that reads as an email or token. */
export function failureLine(stderr: string, home = homedir()): string | null {
  const line = stderr.split("\n").map(l => l.trim()).filter(Boolean).at(-1);
  if (!line) return null;
  return line.split(home).join("~").replace(/\/(?:Users|home)\/[^/\s'"]+/g, "~")
    .replace(/[^\s@'"<>]+@[^\s@'"<>]+\.[A-Za-z]{2,}/g, "[hidden]")
    .replace(/\b(?:sk-[A-Za-z0-9_-]{8,}|[A-Za-z0-9_+/=-]{32,})/g, "[hidden]").slice(0, 240);
}

type Plan = { kind: "a0" | "owner" | "mini"; host: SwitchHost } | { blocked: string };
async function planFor(name: string, deps: SwitchDeps): Promise<{ agent: SwitchAgent | null; plan: Plan }> {
  const agent = await deps.agent(name);
  if (!agent) return { agent, plan: { blocked: "Unknown agent" } };
  if (agent.tool === "codex") return { agent, plan: { blocked: "Codex agents have no Claude account" } };
  if (agent.tool !== "claude" && agent.tool !== "siso") return { agent, plan: { blocked: "Only Claude agents have a Claude account" } };
  const hosts = (await deps.readHosts()).filter(h => h.harness !== "codex");
  const host = hosts.find(h => !!agent.session && h.session === agent.session) ?? hosts.find(h => h.name === agent.name);
  if (!host) return { agent, plan: { blocked: `${agent.zero ? "Agent Zero" : name} has no live hosted chat here; switch it by hand` } };
  if (agent.zero) return { agent, plan: { kind: "a0", host } };
  if (host.machine === "mini") return { agent, plan: { kind: "mini", host } };
  if (host.machine) return { agent, plan: { blocked: `${name} runs on ${host.machine}; only laptop and Mac mini owners switch from here` } };
  if (host.pane && /^w\d+:p\d+$/.test(host.pane)) return { agent, plan: { kind: "owner", host } };
  return { agent, plan: { blocked: `Can't tell where ${name} runs; switch it by hand` } };
}

/** Why this agent cannot switch from the app, or null when it can. */
export async function accountSwitchBlocked(name: string, deps: SwitchDeps): Promise<string | null> {
  try { const { plan } = await planFor(name, deps); return "blocked" in plan ? plan.blocked : null; }
  catch { return "Could not read this agent's host"; }
}

/**
 * One switch per agent at a time. The status is "queued" before the first await, so a caller can return it at once and
 * leave this running. Resolves with the final status; never throws.
 */
export async function switchAccount(name: string, to: ClaudeAccountId, deps: SwitchDeps): Promise<SwitchStatus> {
  const refused = accountSwitchError(to);
  if (refused) return { state: "failed", message: refused, to };
  if (running.has(name)) return { state: "failed", message: "A switch is already running for this agent", to };
  running.add(name);
  const account = accountOf(to)!;
  const stages: string[] = [];
  const report = (state: SwitchState, message: string) => {
    if (stages.at(-1) !== message) stages.push(message);
    const status = { state, message, to, stages: [...stages] };
    last.set(name, status);
    return status;
  };
  const finish = (state: "done" | "failed", message: string) => { const status = { state, message, to, stages: [...stages] }; last.set(name, status); return status; };
  report("queued", "Queued");
  const home = deps.home ?? homedir(), now = deps.now ?? Date.now;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>(r => setTimeout(r, ms)));
  const pollMs = deps.pollMs ?? 2000, confirmMs = deps.confirmMs ?? 180_000;
  const bin = deps.binDir ?? process.env.AB_SWITCH_BIN_DIR ?? path.join(home, "SISO_Workspace/SISO_Agents/agent-zero/siso-agent-zero/bin");
  try {
    const { agent, plan } = await planFor(name, deps);
    if ("blocked" in plan) return finish("failed", plan.blocked);
    const { kind, host: before } = plan;
    const who = agent?.zero ? "Agent Zero" : name;
    const remote = kind === "mini";
    const target = remote ? `~/${ACCOUNT_DIRS[to]}` : path.join(home, ACCOUNT_DIRS[to]!);
    const onTarget = (h: SwitchHost) => remote ? accountOfDir(h.configDir) === to : sameDir(h.configDir, target);
    if (onTarget(before)) return finish("done", `Already on ${account.name}`);
    const sameChat = (h: SwitchHost) => h.name === before.name && h.session === before.session && (h.machine ?? null) === (before.machine ?? null);
    const stillOld = (hosts: SwitchHost[]) => hosts.some(h => h.pid === before.pid && (h.machine ?? null) === (before.machine ?? null));
    const confirming = `Confirming on ${account.name}`;

    // a0-switch-login stops Agent Zero's host straight away (it was written to be run by A0 at the end of its own turn), so
    // the app waits for a clean break first, as owner-switch-login does for itself.
    if (kind === "a0") {
      const idleBy = now() + (deps.idleMs ?? 30 * 60_000);
      const busy = async () => (await deps.readHosts().catch(() => [before])).some(h => h.pid === before.pid && h.busy);
      while (await busy()) {
        if (now() >= idleBy) return finish("failed", "Agent Zero is still working after 30 minutes; switch at a clean break");
        report("waiting-idle", "Waiting for idle");
        await sleep(pollMs);
      }
    }
    const script = kind === "a0" ? "a0-switch-login" : kind === "mini" ? "mini-switch-login" : "owner-switch-login";
    const args = kind === "a0" ? [target, "--after", String(A0_AFTER)] : [before.name, target];
    report(kind === "a0" ? "moving" : "waiting-idle", kind === "a0" ? "Moving the conversation" : "Waiting for idle");
    let settled = false;
    const run = deps.exec(path.join(bin, script), args, { detached: kind === "a0" }).finally(() => { settled = true; });
    run.catch(() => {});
    // While the script waits for idle the old host stays up; once it stops, the conversation is moving.
    while (!settled) {
      await Promise.race([run.then(() => {}, () => {}), sleep(pollMs)]);
      if (settled) break;
      if (!stillOld(await deps.readHosts().catch(() => [before]))) report("moving", "Moving the conversation");
    }
    let result: { code: number; stderr: string };
    try { result = await run; } catch { return finish("failed", `Could not start ${script}`); }
    if (result.code !== 0) return finish("failed", failureLine(result.stderr, home) ?? `${script} failed (exit ${result.code})`);

    // The script's word is not enough: the host records must show this chat, same session, on the chosen login.
    if (kind === "owner") report("confirming", confirming);
    const deadline = now() + confirmMs + (kind === "a0" ? A0_AFTER * 1000 : 0) + (remote ? deps.remoteIdleMs ?? 30 * 60_000 : 0);
    for (;;) {
      const hosts = await deps.readHosts().catch(() => []);
      if (hosts.some(h => sameChat(h) && onTarget(h))) { report("confirming", confirming); return finish("done", `On ${account.name} now, same conversation`); }
      if (kind !== "owner" && !stillOld(hosts)) { report("moving", "Moving the conversation"); report("confirming", confirming); }
      if (now() >= deadline) break;
      await sleep(pollMs);
    }
    return finish("failed", kind === "a0"
      ? `The switch finished but Agent Zero is not on ${account.name}; check the pane (log ~/.local/state/a0/switch-login.log)`
      : `The script finished but ${who} is not on ${account.name}; check the pane`);
  } catch {
    return finish("failed", "The switch could not be completed");
  } finally {
    running.delete(name);
  }
}

/** Live host records from HOSTS_DIR through the node's reader, plus the config folder each one runs on. */
export async function readSwitchHosts(dir: string): Promise<SwitchHost[]> {
  const { hosts } = await readServiceHosts({ dir });
  const out: SwitchHost[] = [];
  for (const h of hosts) {
    if (h.state !== "live") continue;
    let raw: any = {};
    try { raw = JSON.parse(await readFile(h.file, "utf8")); } catch { continue; }
    const remotePid = Number.isInteger(raw?.remote?.pid) ? raw.remote.pid as number : null;
    out.push({ name: h.name, session: h.session, pane: h.pane, configDir: typeof raw.configDir === "string" ? raw.configDir : null,
      pid: h.remoteMachine && remotePid ? remotePid : h.pid, machine: h.remoteMachine ?? null, harness: h.harness ?? (typeof raw.harness === "string" ? raw.harness : null), busy: raw.state === "working" || raw.compacting === true });
  }
  return out;
}

function execScript(file: string, args: string[], { detached }: { detached: boolean }): Promise<{ code: number; stderr: string }> {
  const env = { ...process.env, PATH: `${path.join(homedir(), ".local", "bin")}:/opt/homebrew/bin:/usr/local/bin:${process.env.PATH ?? ""}` };
  if (detached) return new Promise((resolve, reject) => {
    const child = spawn(file, args, { detached: true, stdio: "ignore", env });
    child.once("error", reject);
    child.once("spawn", () => { child.unref(); resolve({ code: 0, stderr: "" }); });
  });
  return new Promise((resolve, reject) => {
    // The owner script waits up to 30 minutes for idle, then up to 2 minutes for the relaunch.
    execFile(file, args, { env, timeout: 40 * 60_000, maxBuffer: 1024 * 1024 }, (error, _out, stderr) => {
      if (!error) return resolve({ code: 0, stderr: String(stderr) });
      const e = error as NodeJS.ErrnoException & { code?: number | string };
      if (typeof e.code !== "number" && !(e as any).killed) return reject(error);
      resolve({ code: typeof e.code === "number" ? e.code : 1, stderr: String(stderr) });
    });
  });
}

/** The node's own wiring: its agent list and its HOSTS_DIR. */
export function accountSwitchDeps(options: { listAgents: (maxAgeMs?: number) => Promise<SwitchAgent[]>; hostsDir: string }): SwitchDeps {
  return {
    agent: async name => { const rows = (await options.listAgents(0)).filter(a => a.name === name); return rows.length === 1 ? rows[0] : null; },
    readHosts: () => readSwitchHosts(options.hostsDir),
    exec: execScript,
  };
}
