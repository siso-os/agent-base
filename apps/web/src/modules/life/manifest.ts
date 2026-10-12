import type { Module } from "@siso/os";

/** LifeLog: his day. Opened from his avatar at the foot of the rail (idea 32). Private: never mirrored. */
export default {
  id: "life", name: "Life", space: "os", dock: "avatar", icon: "lifelog", order: 0,
  line: "Your day: morning routine, counters, checkout and XP",
  entry: { kind: "builtin", component: "life" },
  host: "local",
} satisfies Module;
