import type { Module } from "@siso/os";

/** The Great Library: every space uses it, so it sits at the foot of the rail; its search is ⌘K (siso-os.md §5). */
export default {
  id: "library", name: "Library", space: "os", icon: "library", order: 0,
  line: "The Great Library: docs, research and references",
  entry: { kind: "builtin", component: "library" },
  mirror: { data: ["docs"] },
} satisfies Module;
