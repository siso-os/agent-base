import { createRoot } from "react-dom/client";
import { MoveMenu } from "../src/components/MoveMenu";
import "../src/index.css";

createRoot(document.getElementById("root")!).render(
  <main style={{ padding: 36, display: "flex", gap: 360, alignItems: "flex-start", minHeight: "100vh", background: "var(--siso-canvas)", color: "var(--siso-text)" }}>
    <style>{`.move-preview__moving .move-menu__status { position: absolute; top: 43px; left: 250px; z-index: 32; white-space: nowrap; }`}</style>
    <section className="move-preview__moving"><p style={{ color: "var(--siso-text-muted)", fontSize: 11 }}>AGENT · RESEARCH</p><h2>Agent Zero</h2><MoveMenu current="opus" status={{ state: "moving", message: "Moving…", to: "luna" }} onMove={() => {}} defaultOpen /></section>
    <section><p style={{ color: "var(--siso-text-muted)", fontSize: 11 }}>FAILED MOVE</p><h2>Docs Worker</h2><MoveMenu current="sonnet" status={{ state: "failed", message: "The destination could not start", to: "deepseek" }} onMove={() => {}} /></section>
  </main>,
);
