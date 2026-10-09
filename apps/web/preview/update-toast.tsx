import { createRoot } from "react-dom/client";
import { RefreshCwIcon, XIcon } from "lucide-react";
import "../src/index.css";
import "../src/components/UpdateToast.css";

function Preview() {
  return <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", background: "var(--crm-color-canvas)", color: "var(--crm-color-text)", fontFamily: "var(--crm-font-sans)" }}>
    <div style={{ position: "absolute", top: 28, textAlign: "center" }}><h1>Update notices</h1><p>Preview the new web release and desktop rebuild states.</p></div>
    <div style={{ position: "fixed", right: 22, bottom: 146 }}><UpdateToastFixture kind="desktop" /></div>
    <UpdateToastFixture kind="web" />
  </main>;
}

function UpdateToastFixture({ kind }: { kind: "web" | "desktop" }) {
  return <aside className="ab-update-toast" role="status" style={kind === "desktop" ? { bottom: 146 } : undefined}>
    <div className="ab-update-toast__mark" aria-hidden="true"><RefreshCwIcon size={16} /></div>
    <div className="ab-update-toast__content"><strong>{kind === "web" ? "New in Agent Base" : "Needs an app rebuild"}</strong>
      {kind === "web" ? <ul><li>Keep the open chat when reloading</li><li>Group agent pages by project</li><li>Fix update checks after a node restart</li></ul> : <span>A newer desktop build is available. Rebuild the app to use it.</span>}
    </div>
    {kind === "web" && <button type="button" className="ab-update-toast__reload">Reload</button>}
    <button type="button" className="ab-update-toast__close" aria-label="Dismiss update notice"><XIcon size={15} /></button>
  </aside>;
}

createRoot(document.getElementById("root")!).render(<Preview />);
