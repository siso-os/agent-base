import type { ChatEvent } from "./host.ts";
import { toolOut } from "./events.ts";

/** app-server v2 items -> the existing chat renderer's vocabulary. No Claude runtime is imported. */
export function codexItem(item: any, done: boolean, at = Date.now()): ChatEvent[] {
  const id = String(item.id);
  if (item.type === "userMessage") return done ? [{ t: "user", id, text: (item.content ?? []).filter((c: any) => c.type === "text").map((c: any) => c.text).join("\n"), at, from: "history" }] : [];
  if (item.type === "agentMessage") return done ? [{ t: "text", id, text: item.text ?? "", at }] : [];
  if (item.type === "reasoning") return done ? [{ t: "thinking", id, text: (item.summary ?? []).join("\n"), ms: null, at }] : [];
  if (item.type === "commandExecution") return done
    ? [{ t: "tool_done", id, ok: item.status === "completed" && item.exitCode === 0, ...toolOut(item.aggregatedOutput), at }]
    : [{ t: "tool", id, name: "Bash", summary: item.command, input: { command: item.command }, at }];
  if (item.type === "fileChange") return (item.changes ?? []).map((c: any, n: number): ChatEvent => done
    ? { t: "tool_done", id: `${id}-${n}`, ok: item.status === "completed", ...toolOut(c.diff), at }
    : { t: "tool", id: `${id}-${n}`, name: "Edit", summary: c.path, input: { path: c.path, description: c.kind?.type, old: c.diff.split("\n").filter((l: string) => l.startsWith("-") && !l.startsWith("---")).map((l: string) => l.slice(1)).join("\n").slice(0, 4000), new: c.diff.split("\n").filter((l: string) => l.startsWith("+") && !l.startsWith("+++")).map((l: string) => l.slice(1)).join("\n").slice(0, 4000) }, at });
  return [];
}
