import type { Module } from "@siso/os";

/** Agent Zero's task board; it replaces the rail's duplicate ListChecks icon (siso-os.md §5). */
export default {
  id: "tasks", name: "Tasks", space: "agent-base", icon: "tasks", order: 1, rail: false,
  line: "The task board: building, to do, specced, ideas, landed",
  entry: { kind: "builtin", component: "tasks" },
  commands: [{ id: "tasks.open", title: "Open the task board" }],
} satisfies Module;
