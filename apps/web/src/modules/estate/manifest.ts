import type { Module } from "@siso/os";

/** The land: machines, repos and worktrees; Servers and Tokens are its pages (siso-os.md §5). */
export default {
  id: "estate", name: "Estate", space: "agent-base", icon: "estate", order: 4,
  line: "Machines, repos, worktrees, servers and tokens",
  entry: { kind: "builtin", component: "estate" },
  pages: [{ id: "servers", name: "Servers", icon: "server" }, { id: "tokens", name: "Tokens", icon: "coins" }],
  host: "any",
} satisfies Module;
