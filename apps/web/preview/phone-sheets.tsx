// uihub: arc:bottom-sheet
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { TasksSheet } from "../src/components/phone/TasksSheet";
import { SignInSheet } from "../src/components/browser/SignInSheet";
import type { Agent } from "../src/lib/agents";
import "../src/index.css";
import "../src/components/Phone.css";
import "../src/components/Browser.css";

const agent = { id: "fixture", name: "SHEET-FIXTURE", zero: false, kind: "worker", status: "idle", project: "Synthetic project" } as Agent;
function Fixture() {
  const [open, setOpen] = useState(true);
  const [draft, setDraft] = useState(false);
  const [action, setAction] = useState("");
  const signIn = new URLSearchParams(location.search).get("sheet") === "signin";
  const record = (value: string) => setAction(value);
  return <main style={{ height: "100dvh", display: "flex", flexDirection: "column", background: "var(--crm-color-bg)", color: "var(--crm-color-text-strong)" }}>
    <style>{`.ab-hub__sheet-page::after { content: "Synthetic native sign-in slot — no Google connection"; display: block; padding: 16px; color: var(--crm-color-text-muted); }`}</style>
    <header data-testid="chat-head" style={{ height: 64, flex: "none", padding: 12 }}>SHEET-FIXTURE · synthetic preview</header>
    <div style={{ flex: 1, minHeight: 0, display: "flex", padding: 12, gap: 12 }}>
      <div style={{ flex: 1, minWidth: 0 }}><p>Keep talking while checking the tasks.</p>
        <button onClick={() => setOpen(true)}>Reopen sheet</button><br />
        <button onClick={() => setDraft(!draft)}>Grow composer</button>
        <output data-testid="fixture-action">{action}</output>
      </div>
      {signIn && open && <SignInSheet account={{ id: "fixture-account", name: "Demo account", email: "demo@example.test", source: "default" }}
        onSignedIn={() => record("signed in")} onStop={(_, step) => record(`stopped: ${step}`)}
        onKeepAs={(_, email) => record(`keep: ${email}`)} onFresh={() => record("fresh store")}
        onClose={() => setOpen(false)} />}
    </div>
    <div className="siso-chat__composer" style={{ flex: "none", height: draft ? 210 : 96, padding: 12, background: "var(--crm-color-surface)" }}>
      <label>Message the fixture agent<input aria-label="Message the fixture agent" style={{ display: "block", width: "100%" }} /></label>
    </div>
    {!signIn && open && <TasksSheet a={agent} agents={[agent]} onClose={() => setOpen(false)} />}
  </main>;
}
createRoot(document.getElementById("root")!).render(<Fixture />);
