import React from "react";
import { createRoot } from "react-dom/client";
import { OwnerTasks } from "../src/components/OwnerTasks";
import type { OrgOwner, PlanItem } from "../src/lib/org-types";
import "../src/index.css";

const plan = (id: string, title: string, status: PlanItem["status"]): PlanItem => ({ id, title, status });
type PreviewTask = { id: string; title: string; state: string };
const owner = (name: string, checked: number, total: number, items: PlanItem[], tasks: PreviewTask[] = []) => ({
  name, state: "live" as const, working: 1, plan: { checked, total, asked: 0, items }, tasks,
});
const rows = [
  owner("STREAMING-CLAUDE", 4, 8, [plan("S-8", "Recover an interrupted stream", "building"), plan("S-9", "Operator recovery checklist", "asked")], [{ id: "OPS-BUILD", title: "Validate stream recovery", state: "review" }]),
  owner("OPS-BUILD", 3, 6, [plan("O-3", "Add stream health panel", "allocated")], [{ id: "ops-task", title: "Wire telemetry cards", state: "claimed" }]),
  owner("HALO-UI", 8, 8, [plan("H-2", "Polish account settings", "building")]),
  owner("FAHMY-AGENCY", 2, 5, [plan("F-1", "Client onboarding flow", "specced")]),
  owner("AGENT-BASE", 38, 111, [plan("AB-113", "Owner tasks in the side nav", "building"), plan("AB-114", "Keyboard navigation pass", "asked")], [{ id: "ab-task", title: "Connect task folder reader", state: "open" }]),
  owner("SISO-FAMILY", 0, 0, []),
];

function Preview() {
  return <main style={{ minHeight: "100vh", padding: 28, background: "#111318", color: "#ececf1", fontFamily: "Inter, system-ui, sans-serif" }}>
    <h1 style={{ fontSize: 18, margin: "0 0 8px" }}>Projects · Owners · Tasks</h1>
    <p style={{ color: "#9a9ba5", fontSize: 12, marginBottom: 18 }}>Select an owner to expand their open plan items and task folders.</p>
    <div style={{ width: 390, padding: 10, border: "1px solid #30313b", borderRadius: 12, background: "#191a21" }}>
      <h2 style={{ fontSize: 11, color: "#9a9ba5", textTransform: "uppercase", letterSpacing: ".1em", margin: "8px 8px 5px" }}>SISO Agency · HALO</h2>
      {rows.slice(0, 3).map((o) => <OwnerTasks key={o.name} owner={o} planItems={o.plan?.items} taskFolders={o.tasks} onOpenItem={(item) => alert(`Open ${item.id}`)} />)}
      <h2 style={{ fontSize: 11, color: "#9a9ba5", textTransform: "uppercase", letterSpacing: ".1em", margin: "18px 8px 5px" }}>SISO Agency · Fahmy's agency</h2>
      <OwnerTasks owner={rows[3]} onOpenItem={(item) => alert(`Open ${item.id}`)} />
      <h2 style={{ fontSize: 11, color: "#9a9ba5", textTransform: "uppercase", letterSpacing: ".1em", margin: "18px 8px 5px" }}>SISO Labs · Agent Base</h2>
      <OwnerTasks owner={rows[4]} planItems={rows[4].plan?.items} taskFolders={rows[4].tasks} onOpenItem={(item) => alert(`Open ${item.id}`)} />
      <h2 style={{ fontSize: 11, color: "#9a9ba5", textTransform: "uppercase", letterSpacing: ".1em", margin: "18px 8px 5px" }}>SISO Family</h2>
      <OwnerTasks owner={rows[5]} onOpenItem={(item) => alert(`Open ${item.id}`)} />
    </div>
  </main>;
}

createRoot(document.getElementById("root")!).render(<Preview />);
