import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { SpendChip } from "../src/components/SpendChip";
import { SpendPanel, type SpendResponse } from "../src/components/SpendPanel";
import fixture from "../../../services/node/test/fixtures/spend.json";
import "../src/index.css";

const report = { source: "stack-opt", data: fixture } as SpendResponse;
function Preview() {
  const [open, setOpen] = useState(true);
  useEffect(() => {
    const project = document.querySelector<HTMLDetailsElement>(".spend-panel__project");
    const owner = project?.querySelector<HTMLDetailsElement>(".spend-panel__owner");
    const agent = owner?.querySelector<HTMLDetailsElement>(".spend-panel__agent");
    if (project) project.open = true;
    if (owner) owner.open = true;
    if (agent) agent.open = true;
  }, []);
  return <main style={{ minHeight: "100vh", padding: 22, background: "var(--color-page)", color: "var(--color-foreground)", fontFamily: "var(--font-sans)" }}>
    <header style={{ display: "flex", alignItems: "center", gap: 12, paddingBottom: 14, borderBottom: "1px solid var(--color-border)" }}>
      <strong style={{ fontSize: 13 }}>Agent Base</strong><span style={{ flex: 1, color: "var(--color-muted-foreground)", fontSize: 11 }}>Operations overview</span>
      <SpendChip spend={report} onClick={() => setOpen((value) => !value)} />
    </header>
    <div style={{ paddingTop: 18, color: "var(--color-muted-foreground)", fontSize: 12 }}>Daily activity and project work</div>
    <SpendPanel spend={report} open={open} onClose={() => setOpen(false)} />
  </main>;
}
createRoot(document.getElementById("root")!).render(<Preview />);
