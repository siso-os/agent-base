import { execFile } from "node:child_process";
import { homedir } from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";



export const MOVE_TARGETS = ["opus", "fable", "sonnet", "luna", "sol", "deepseek"] as const;
export const MOVE_EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const;
export type MoveTarget = (typeof MOVE_TARGETS)[number];
export type MoveState = "queued" | "waiting-idle" | "moving" | "done" | "failed";
export type MoveStatus = { state: MoveState; message: string; to?: MoveTarget; stages?: string[]; result?: Record<string, unknown> };

const last = new Map<string, MoveStatus>();
const running = new Set<string>();

function messageFor(code: number, result: Record<string, unknown> | null) {
  if (code === 0) return "On the new model now";
  if (code === 3) return "Waiting for this agent to be idle";
  if (code === 2) return "That destination is not available";
  const detail = typeof result?.error === "string" ? result.error : "The move could not be completed";
  return detail;
}

/** Run a move for one agent. A second request for the same name is rejected until the CLI exits. */
export async function move(name: string, to: MoveTarget, effort?: string): Promise<MoveStatus> {
  if (!name.trim() || !MOVE_TARGETS.includes(to)) throw new Error("Agent name and a supported destination are required");
  effort ??= name.toLowerCase().replace(/[ _-]+/g, "-") === "agent-zero" ? "high" : "medium";
  if (!MOVE_EFFORTS.includes(effort as typeof MOVE_EFFORTS[number])) throw new Error("Unsupported effort");
  if (running.has(name)) return { state: "failed", message: "A move is already running for this agent", to };
  running.add(name);
  const stages: string[] = [];
  const report = (state: MoveState, message: string) => {
    if (stages.at(-1) !== message) stages.push(message);
    last.set(name, { state, message, to, stages: [...stages] });
  };
  report("moving", "Moving…");
  try {
    const env = { ...process.env, PATH: `${path.join(homedir(), ".local", "bin")}:${process.env.PATH ?? ""}` };
    let stdout = "";
    let code = 0;
    const idleDeadline = Date.now() + 15 * 60_000;
    do {
      code = 0;
      try {
        stdout = await new Promise<string>((resolve, reject) => {
          const child = execFile("agent-move", [name, "--to", to, "--effort", effort, "--json", "--progress-json"], { env, timeout: 300_000, maxBuffer: 1024 * 1024 }, (error, out) => error ? reject(Object.assign(error, { stdout: out })) : resolve(out));
          let pending = "";
          child.stderr?.on("data", (chunk: Buffer) => {
            pending += chunk.toString();
            const lines = pending.split("\n"); pending = lines.pop() ?? "";
            for (const line of lines) {
              try {
                const stage = JSON.parse(line);
                if (typeof stage.message === "string") report("moving", stage.message);
              } catch { /* Other stderr is not a progress event. */ }
            }
          });
        });
      } catch (error) {
        const e = error as NodeJS.ErrnoException & { code?: number; stdout?: string };
        stdout = e.stdout ?? "";
        code = typeof e.code === "number" ? e.code : 1;
        if (typeof e.code !== "number") throw error;
      }
      if (code === 3 && Date.now() < idleDeadline) {
        report("waiting-idle", "Waiting for idle: this agent is finishing its answer");
        await delay(Number(process.env.AB_MOVE_IDLE_POLL_MS ?? 2000));
      } else break;
    } while (true);
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(stdout.trim());
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Expected JSON object");
    } catch {
      const status = { state: "failed" as const, message: "Move command returned invalid JSON", to };
      last.set(name, status);
      return status;
    }
    const status: MoveStatus = {
      state: code === 0 ? "done" : "failed",
      message: code === 3 ? "Still busy after 15 minutes; try the move again" : messageFor(code, parsed), to,
      stages: [...stages],
      ...(parsed.ok === true ? { result: parsed } : {}),
    };
    last.set(name, status);
    return status;
  } catch {
    const status = { state: "failed" as const, message: "Could not start agent-move", to };
    last.set(name, status);
    return status;
  } finally {
    running.delete(name);
  }
}

export function status(name: string): MoveStatus | null {
  return last.get(name) ?? null;
}
