import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import type { HubAgent, HubZero } from "../apps/web/src/lib/hub-types";
import laneWorkers from "./zero-tabs-data.json";
import { ZeroTabs } from "../apps/web/src/components/ZeroTabs";
import { AgentZeroManagerPage } from "../apps/web/src/components/AgentZeroManagerPage";
import "../apps/web/src/index.css";

const owner = (name: string, project: string, role: string, count: number, working: number, state: HubAgent["state"] = "working"): HubAgent => ({ name, kind: "owner", project, role, icon: "brain", accent: "", harness: "claude", model: "Opus 5.5", machine: "mac-mini", state, spunUp: true, workers: { total: count, working } });
// Captured from hub-design/data.json agents: actual herdr labels, lane IDs, harnesses and states.
const agentBaseWorkers = laneWorkers as HubZero["controls"][number]["subAgents"];
const zero: HubZero = { id: "A0", label: "Agent Zero", harness: "claude", model: "Opus 5.5", cwd: "~/SISO_Agents/agent-zero/siso-firstmate", state: "working", controls: [
  { owner: owner("STREAMING-CLAUDE", "HALO", "Go-live", 3, 0, "done"), activity: "Operator live run and recovery checks", subAgents: [] },
  { owner: owner("OPS-BUILD", "HALO", "Operator", 2, 0, "done"), activity: "Reviewing operator onboarding", subAgents: [] },
  { owner: owner("HALO-UI", "HALO", "CRM", 1, 1), activity: "Checking the current CRM handoff", subAgents: [] },
  { owner: owner("BKY", "Fahmy's agency", "Bykonz Yard", 0, 0, "idle"), subAgents: [] },
  { owner: owner("MELANOTRESSES", "Fahmy's agency", "MelanoTresses", 0, 0, "idle"), subAgents: [] },
  { owner: { ...owner("AGENT-BASE", "Agent Base", "Agent Base", 12, 4), holding: { id: "hub-10", title: "Agent Zero control tabs", status: "building" } }, subAgents: agentBaseWorkers },
  { owner: owner("EFFICIENCY", "Efficiency", "Efficiency", 1, 0), activity: "Reviewing the worker queue", subAgents: [] },
  { owner: owner("HEALTH", "Health", "Laptop health", 1, 0, "done"), activity: "Last check completed", subAgents: [] },
] };
function Preview() {
  const [label, setLabel] = useState(zero.label);
  const [message, setMessage] = useState("AGENT-BASE chat selected");
  const [manager, setManager] = useState(new URLSearchParams(location.search).has("manager"));
  useEffect(() => {
    if (!new URLSearchParams(location.search).has("open")) return;
    const timer = window.setTimeout(() => {
      document.querySelector<HTMLButtonElement>(".zero-tab")?.click();
      window.setTimeout(() => document.querySelector<HTMLButtonElement>('[aria-label="Expand AGENT-BASE"]')?.click(), 80);
    }, 80);
    return () => window.clearTimeout(timer);
  }, []);
  const selected = { ...zero, label };
  return <main style={{ padding: 22, minHeight: "100vh", background: "var(--color-page)" }}>
    <div style={{ display: "flex", alignItems: "center", gap: 18, borderBottom: "1px solid var(--color-border)", paddingBottom: 12 }}><strong>Agent Base</strong><ZeroTabs zeros={[selected, { id: "A0-SDK", label: "Agent Zero SDK", harness: "siso", model: "GPT Sol", cwd: "~/SISO_Agents/agent-zero", state: "off", controls: [] }]} current="A0" onOpen={(agent) => setMessage(`${agent.name} chat selected`)} onRename={(_, name) => setLabel(name)} onSpawn={() => setMessage("Spawn callback")} onOpenManager={() => setManager(true)}/></div>
    {manager ? <AgentZeroManagerPage digest={{ mtimeMs: Date.now() - 4 * 60_000, markdown: "## Current focus\n\nThe manager digest is rendered read-only. Here is the current outcome and what the team is checking.\n\n- Review lane work and report status\n- Keep the shared Agent Base app stable\n- Record evidence in the handoff\n\n[Open Agent Base](https://example.com)\n\n### Note\n\nUse `hub-10` for the integration task.\n" }} /> : <p style={{ color: "var(--color-secondary-label)", marginTop: 18 }}>{message}</p>}
  </main>;
}

createRoot(document.getElementById("root")!).render(<StrictMode><Preview /></StrictMode>);
