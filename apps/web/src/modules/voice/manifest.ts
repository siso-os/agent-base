import type { Module } from "@siso/os";

/** SISO Voice: the bar, the history and stats. The hotkey and the dictation pill work in every space. */
export default {
  id: "voice", name: "Voice", space: "agent-base", icon: "siso-voice", order: 2,
  line: "Talk anywhere: the bar, your history and stats",
  entry: { kind: "builtin", component: "voice" },
  sidenav: { kind: "builtin", component: "voice-sidebar" },
  host: "local",
} satisfies Module;
