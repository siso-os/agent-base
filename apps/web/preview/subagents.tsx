import { createRoot } from "react-dom/client";
import { SubagentsPopover } from "../src/components/SubagentsPopover";
import type { Agent } from "../src/lib/agents";
import "../src/index.css";

const agent = { id: "a0", name: "Agent Zero", session: "f77649c8", tool: "claude", machine: "laptop", status: "working", cwd: "/SISO_Agents/agent-zero/siso-agent-zero", hud: null } as Agent;
const now = Date.now();
const claude = ["Research SDK path for Agent Zero", "Research system-load sources across machines", "Review earlier Agent Zero handover", "Map existing token-spend tooling", "Mine Whitebox for hub ideas", "Identify current owner handoffs", "Review task routing contract", "Check session recovery behavior", "Map running context limits", "Compare operator chat flows", "Verify worktree boundaries", "Summarize acceptance criteria"];
const fixture = {
  rows: [
    ...claude.map((what, i) => ({ id: `agent-${i}`, kind: "claude", type: "general-purpose", what, spec: `Read-only research for Agent Zero. Review ${what.toLowerCase()} and return concise findings.`, start: new Date(now - (i ? (i + 4) * 60000 : 80000)).toISOString(), end: i ? new Date(now - (i + 3) * 60000).toISOString() : null, tools: 14 + i * 3, tokens: 83042 + i * 6250, running: i === 0, background: true })),
    { id: "a0w-003", agentId: "a0w-003", kind: "codex", type: "Luna · herdr · a0w-003", what: "a0w-003: Agent Zero runs on the SDK host, with compaction under our control", spec: "", start: new Date(now - 27 * 60000).toISOString(), end: new Date(now - 3 * 60000).toISOString(), tools: null, tokens: 2909777, running: false, background: true },
  ],
  running: 1,
  tokens: claude.reduce((n, _, i) => n + 83042 + i * 6250, 0) + 2909777,
};
(window as any).__subagentsFixture = fixture;
function Preview() {
  return <main style={{ minHeight: "100vh", background: "#171715", color: "#e8e5df", fontFamily: "var(--crm-font-sans)" }}>
    <header style={{ height: 48, display: "flex", alignItems: "center", padding: "0 28px", borderBottom: "1px solid rgba(255,255,255,.08)", color: "#aaa69e", fontSize: 12 }}>Agent Base <span style={{ marginLeft: 12, color: "#f0ede6" }}>Agent Zero</span><span style={{ marginLeft: 8 }}>· siso-agent-zero · laptop</span></header>
    <section style={{ maxWidth: 980, margin: "38px auto", padding: 26, color: "#d7d3cc", fontSize: 14, lineHeight: 1.65 }}><p>Can you compare how Claude displays its sub-agents and summarize the useful parts for Agent Base?</p><div style={{ marginTop: 30, color: "#a7a39a" }}>✻ Researching the session files…</div></section>
    <footer style={{ position: "fixed", bottom: 0, left: 0, right: 0, height: 36, display: "flex", alignItems: "center", gap: 14, padding: "0 18px 0 150px", borderTop: "1px solid rgba(255,255,255,.10)", background: "#1b1a18", fontFamily: "var(--crm-font-mono)", fontSize: 11, color: "#d5d1c9" }}>
      <span style={{ color: "#d9b38c" }}>Opus 5.5</span><span>ctx 45%</span><span>tok 34k↓ 12k↑</span><SubagentsPopover agent={agent} total={13} running={1} crew={[]} onOpenCrew={() => {}} />
    </footer>
  </main>;
}
createRoot(document.getElementById("root")!).render(<Preview />);
