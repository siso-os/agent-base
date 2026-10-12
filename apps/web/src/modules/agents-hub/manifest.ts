import type { Module } from "@siso/os";

/** New (t-0601): our skills, MCP servers and plugins with their usage; Benchmarks becomes its Models page. A0 fills it. */
export default {
  id: "agents-hub", name: "Agents Hub", space: "agent-base", icon: "agents-hub", order: 5,
  line: "Skills, MCP servers, plugins and models, with their usage",
  entry: { kind: "builtin", component: "agents-hub" },
  pages: [{ id: "skills", name: "Skills", icon: "sparkles" }, { id: "mcp", name: "MCP servers", icon: "plug" }, { id: "plugins", name: "Plugins", icon: "puzzle" }, { id: "models", name: "Models", icon: "gauge" }, { id: "usage", name: "Usage", icon: "bar-chart" }],
  mirror: { data: ["skills", "mcp", "plugins", "models"] },
} satisfies Module;
