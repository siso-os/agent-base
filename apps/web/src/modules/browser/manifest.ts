import type { Module } from "@siso/os";

/** Web pages as tabs beside the agents. */
export default {
  id: "browser", name: "Browser", space: "agent-base", icon: "web", order: 3,
  line: "Web pages as tabs beside the agents",
  entry: { kind: "builtin", component: "browser" },
  commands: [{ id: "browser.new-tab", title: "New web tab", keys: "⌘T" }],
  host: "local",
} satisfies Module;
