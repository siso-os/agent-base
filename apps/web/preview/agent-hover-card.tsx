import { createRoot } from "react-dom/client";
import { AgentHoverCard, type AgentHoverCardAgent } from "../src/components/AgentHoverCard";
import "../src/index.css";

const owner: AgentHoverCardAgent = {
  name: "STREAMING-CLAUDE", kind: "owner", project: "HALO Go-live", accent: "#F5B400", harness: "claude", model: "Opus 5.5", machine: "halo-vps", state: "working",
  holding: { id: "S-8", title: "Recover an interrupted stream and prove the operator can restart cleanly", status: "building" },
  lastReport: { at: "15:04", ageMin: 14, text: "Recovery test passes; documenting the attended restart and reconnect path.", log: "owners.log" },
  plan: { checked: 4, total: 8, counts: { asked: 1, specced: 0, allocated: 1, building: 2, built: 0, checked: 4, parked: 0, dropped: 0 } },
};
const fixtures: { label: string; agent: AgentHoverCardAgent }[] = [
  { label: "Owner · working", agent: owner },
  { label: "Crew · idle", agent: { name: "OPS-BUILD", kind: "worker", project: "HALO Go-live", owner: "STREAMING-CLAUDE", accent: "#F5B400", harness: "codex", model: "GPT Luna", machine: "laptop", state: "idle", holding: null, lastReport: { at: "14:49", ageMin: 29, text: "Build is green; waiting for the owner to pick the live validation window.", log: "inbox.log" } } },
  { label: "Codex Sol", agent: { ...owner, name: "HALO-UI", harness: "codex", model: "GPT Sol", machine: "mac-mini", state: "done", holding: { id: "H-12", title: "Polish the operator status view", status: "built" } } },
  { label: "Owner · no report", agent: { ...owner, name: "AGENT-BASE", project: "Agent Base", accent: "var(--crm-color-brand)", state: "idle", lastReport: null, holding: null } },
];

function Preview() {
  return <main style={{ minHeight: "100vh", padding: 28, background: "var(--crm-color-canvas)", color: "var(--crm-color-text)", fontFamily: "var(--crm-font-sans)" }}>
    <h1 style={{ margin: "0 0 6px", fontSize: 18 }}>Agent hover card</h1>
    <p style={{ margin: "0 0 24px", color: "var(--crm-color-text-muted)", fontSize: 12 }}>Hover or keyboard-focus a name to open its card. Press Escape to dismiss.</p>
    <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 18, maxWidth: 1120 }}>
      {fixtures.map(({ label, agent }) => <section key={label} style={{ minWidth: 0, padding: 10, border: "1px solid var(--crm-color-line-subtle)", borderRadius: 14, background: "var(--crm-color-surface)" }}>
        <div style={{ margin: "3px 4px 10px", color: "var(--crm-color-text-faint)", fontSize: 10, letterSpacing: ".08em", textTransform: "uppercase" }}>{label}</div>
        <AgentHoverCard agent={agent} preview />
      </section>)}
    </div>
  </main>;
}

createRoot(document.getElementById("root")!).render(<Preview />);
