import type { Module } from "@siso/os";

/** The agents: Agent Zero's org card in the side nav, each agent's chat as the page (agent-base.md §4). */
export default {
  id: "agents", name: "Agents", space: "agent-base", icon: "agents", order: 0, rail: false,
  line: "Agent Zero, his tree and every running agent",
  entry: { kind: "builtin", component: "agents" },
  sidenav: { kind: "builtin", component: "org-card" },
  pages: [{ id: "orgchart", name: "Org chart", icon: "network" }, { id: "stats", name: "Stats", icon: "bar-chart" }, { id: "starred", name: "Starred", icon: "pin" }],
  commands: [{ id: "agents.open-zero", title: "Open Agent Zero" }],
  attention: "/api/attention",
  host: "any",
} satisfies Module;
