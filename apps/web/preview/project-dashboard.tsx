import React from "react";
import { createRoot } from "react-dom/client";
import { ProjectDashboard, type DashboardAgent, type HubProject } from "../src/components/ProjectDashboard";
import type { PlanState } from "../src/lib/org-types";
import "../src/index.css";

const emptyCounts = (): Record<PlanState, number> => ({ asked: 0, specced: 0, allocated: 0, building: 0, built: 0, checked: 0, parked: 0, dropped: 0 });
const owner = (name: string, domain: string, plan?: DashboardAgent["plan"]): DashboardAgent => ({
  name, kind: "owner", project: "HALO", domain, role: "Owner", icon: "radio-tower", accent: "var(--accent-tasks)",
  harness: "claude", model: "Opus", machine: "mac-mini", state: "working", spunUp: true, plan: plan ?? null,
  workers: { total: 2, working: 1 }, holding: { id: "sg-027", title: "Prove the operator stream flow", status: "building" },
  lastReport: { at: "2026-10-02T16:37:00+07:00", ageMin: 5, text: "Core flow checked; verifying recovery next.", log: "owners.log" },
});
const streaming = owner("STREAMING-CLAUDE", "Go-live", { checked: 4, total: 8, counts: { ...emptyCounts(), specced: 1, allocated: 1, building: 2, checked: 4 } });
const ops = owner("OPS-BUILD", "Operator", { checked: 2, total: 5, counts: { ...emptyCounts(), asked: 1, allocated: 1, building: 1, checked: 2 } });
const planless = owner("HALO-UI", "CRM", undefined);
ops.lastReport = { at: "2026-10-02T16:32:00+07:00", ageMin: 10, text: "Operator shell changes are ready for review.", log: "owners.log" };
planless.lastReport = null;
streaming.workers = { total: 2, working: 0 };
ops.state = "idle";
ops.workers = { total: 1, working: 0 };
planless.state = "idle";
planless.workers = { total: 0, working: 0 };
const project: HubProject = {
  id: "halo", name: "HALO", group: "agency", line: "The operator cockpit for live work.", accent: "var(--accent-tasks)", icon: "radio-tower",
  owners: [streaming, ops, planless],
  counts: { ...emptyCounts(), asked: 1, specced: 1, allocated: 2, building: 3, checked: 6 },
  open: [
    { id: "sg-027", title: "Prove the attended live stream and its recovery path", status: "building", owner: streaming.name, to: { agent: streaming.name } },
    { id: "op-014", title: "Make the operator state readable", status: "allocated", owner: ops.name, to: { agent: "OPS-BUILD" } },
  ], needsYou: [], timeline: [
    { at: "2026-10-02T16:37:00+07:00", kind: "report", who: "STREAMING-CLAUDE", text: "Core flow checked; verifying recovery next." },
    { at: "", kind: "board", who: "HALO-UI", text: "Reviewed the recovery flow; the handoff needs one more pass." },
  ], health: [], spendToday: null,
};

createRoot(document.getElementById("root")!).render(<ProjectDashboard project={project} onOpen={() => {}} />);
