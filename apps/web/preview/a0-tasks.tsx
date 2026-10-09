import { createRoot } from "react-dom/client";
import { AgentCard } from "../src/components/AgentCard";
import { TasksPage } from "../src/components/TasksPage";
import type { Agent } from "../src/lib/agents";
import "../src/index.css";

// The Tasks page on its own (?card shows Agent Zero's summary card with its live Tasks row). Data comes from a lab node.
const zero = { id: "w1:p1", name: "A0", zero: true, project: "SISO", status: "working", since: Date.now() - 3_600_000, tool: "claude", context: 41, machine: "laptop", hud: { model: "Opus 5.5" } } as unknown as Agent;
const root = createRoot(document.getElementById("root")!);
root.render(location.search.includes("card")
  ? <div style={{ position: "relative", height: "100vh", display: "flex", justifyContent: "flex-end", background: "var(--crm-color-canvas)" }}>
      <AgentCard a={zero} crew={[]} stats={null} onOpen={(s) => { document.body.dataset.opened = s; }} onCrew={() => {}} />
    </div>
  : <div style={{ height: "100vh" }}><TasksPage onBack={() => { document.body.dataset.back = "1"; }} backLabel="Where things stand" /></div>);
