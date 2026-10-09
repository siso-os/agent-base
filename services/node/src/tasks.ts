import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

export type TaskFolder = {
  id: string;
  title: string;
  state: string;
  holder?: string;
  branch?: string;
  updated?: string;
};

/** Read task folders from a repository's .agents/tasks directory. Invalid or incomplete folders are skipped. */
export function readTasks(repo: string): TaskFolder[] {
  const root = path.join(repo, ".agents", "tasks");
  let folders: string[];
  try {
    folders = readdirSync(root).sort();
  } catch {
    return [];
  }
  const tasks: TaskFolder[] = [];
  for (const id of folders) {
    const dir = path.join(root, id);
    try {
      if (!statSync(dir).isDirectory()) continue;
      const state = JSON.parse(readFileSync(path.join(dir, "STATE.json"), "utf8"));
      const markdown = readFileSync(path.join(dir, "TASK.md"), "utf8");
      const heading = markdown.split(/\r?\n/).find((line) => /^#\s+/.test(line));
      const title = heading?.replace(/^#\s+/, "").replace(/^\S+:\s*/, "").trim();
      if (!title || typeof state.state !== "string") continue;
      tasks.push({
        id,
        title,
        state: state.state,
        ...(typeof state.holder?.agent === "string" ? { holder: state.holder.agent } : {}),
        ...(typeof state.branch === "string" ? { branch: state.branch } : {}),
        ...(typeof state.updated === "string" ? { updated: state.updated } : {}),
      });
    } catch {
      // A partially written or malformed task should not prevent other tasks from appearing.
    }
  }
  return tasks;
}
