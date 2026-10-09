import type { Agent } from "./agents";
import { projectHue } from "../../../../packages/halo-face";

export { AgentFace, projectHue } from "../../../../packages/halo-face";

type FaceStatus = "working" | "waiting" | "needs-shaan" | "blocked" | "done" | "offline";
const FACE_STATUS: Record<Agent["status"], FaceStatus> = {
  working: "working",
  needs: "needs-shaan",
  done: "done",
  idle: "waiting",
  failed: "blocked",
};

/** Map the node's live herdr state to the face package's visual state. */
export function faceFor(agent: Pick<Agent, "name" | "project" | "status"> & Partial<Pick<Agent, "tool" | "serviceHost">>) {
  const status = FACE_STATUS[agent.status] ?? "offline";
  const tool = (agent.tool ?? "").toLowerCase();
  const family = tool.includes("codex") ? "codex" as const : tool.includes("claude") ? "claude" as const : undefined;

  return { ...(agent.serviceHost?.state === "asleep" ? { paused: true } : {}), name: agent.name, project: agent.project ?? undefined, status, ...(family ? { family } : {}) };
}

/** The chat's accent in the face's colour ("r g b" for --crm-brand-rgb), so a chat and its agent's face match. */
export function accentRgb(project?: string | null) {
  const h = projectHue(project ?? ""), s = 0.85, l = 0.66;
  const k = (n: number) => (n + h / 30) % 12;
  const f = (n: number) => l - s * Math.min(l, 1 - l) * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
  return [f(0), f(8), f(4)].map((v) => Math.round(v * 255)).join(" ");
}
