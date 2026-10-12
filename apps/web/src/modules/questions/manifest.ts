import type { Module } from "@siso/os";

/** New: every question an agent is waiting on him for, in one place; beside the Library at the foot of the rail. */
export default {
  id: "questions", name: "Questions", space: "os", icon: "questions", order: 1,
  line: "What your agents are waiting on you for",
  entry: { kind: "builtin", component: "questions" },
  attention: "/api/attention",
} satisfies Module;
