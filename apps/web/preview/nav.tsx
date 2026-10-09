import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { createPageHistory } from "../src/lib/nav";
import { HistoryButtons } from "../src/components/HistoryButtons";
import { PagesNav, type HubPage } from "../src/components/PagesNav";
import { StatsPage } from "../src/components/StatsPage";
import { StarredPage } from "../src/components/StarredPage";
import type { Agent, Page } from "../src/lib/agents";
import "../src/components/HistoryButtons.css";
import "../src/index.css";

type PreviewPage = HubPage | "a0" | "agency";
function Preview() {
  const [page, setPage] = useState<PreviewPage>(() => location.hash.slice(1) as PreviewPage || "a0");
  const current = useRef(page);
  current.current = page;
  const [agents, setAgents] = useState<Agent[]>([{ id: "ab-1", key: "laptop/AGENT-BASE", name: "AGENT-BASE", title: "Building page history", status: "working", since: Date.now(), row: "live", snoozedUntil: null, settledAt: null, seenAt: null, order: 0, tool: "claude", cwd: "/Agent-Base", folder: "Agent-Base", machine: "laptop", session: "session", context: 24, hud: null, zero: false, project: "Agent Base", owner: null, kind: "owner", icon: null, domain: "Agent Base", lead: null, role: null, pinned: true, pages: [] }]);
  const [pages, setPages] = useState<Page[]>([{ url: "https://example.test/brief", title: "Launch brief", from: "saved" }]);
  const router = useRef<ReturnType<typeof createPageHistory<PreviewPage>> | null>(null);
  if (!router.current) router.current = createPageHistory({ current: () => current.current, change: setPage, target: window });
  useEffect(() => { router.current?.start(); return () => router.current?.stop(); }, []);
  const navigate = (next: PreviewPage) => router.current?.push(next);
  const label = page === "a0" ? "Agent Zero" : page === "agency" ? "Agency" : page === "org" ? "Org chart" : page[0].toUpperCase() + page.slice(1);
  return <div style={{ display: "flex", minHeight: "100vh", background: "var(--crm-color-background)", color: "var(--crm-color-text)" }}>
    <aside style={{ width: 190, borderRight: "1px solid var(--crm-color-line-subtle)", padding: 16 }}>
      <b style={{ display: "block", margin: "4px 10px 15px" }}>Agent Base</b>
      <PagesNav active={(["home", "tasks", "stats", "starred", "org"].includes(page) ? page : "home") as HubPage} onNavigate={navigate} />
      <div style={{ marginTop: 18, borderTop: "1px solid var(--crm-color-line-subtle)", paddingTop: 12 }}>
        <button onClick={() => navigate("a0")}>Agent Zero</button><br />
        <button onClick={() => navigate("agency")}>Agency</button>
      </div>
    </aside>
    <main style={{ flex: 1, minWidth: 0 }}>
      <header style={{ height: 48, display: "flex", alignItems: "center", gap: 12, borderBottom: "1px solid var(--crm-color-line-subtle)", padding: "0 18px" }}>
        <HistoryButtons canBack={router.current?.canBack} canForward={router.current?.canForward} onBack={() => router.current?.back()} onForward={() => router.current?.forward()} />
        <span style={{ color: "var(--crm-color-text-muted)", fontSize: 12 }}>Agent Base</span><span>›</span><b style={{ fontSize: 12 }}>{label}</b>
      </header>
      <section style={{ maxWidth: 940, margin: "0 auto", padding: 24 }}>
        {page === "a0" ? <><h1>Agent Zero</h1><p>What you want and what happened.</p></>
          : page === "agency" ? <><h1>Agency</h1><p>Group dashboard · #agency</p></>
          : page === "stats" ? <StatsPage stats={null} />
          : page === "starred" ? <StarredPage agents={agents} pages={pages} onOpenAgent={() => navigate("a0")} onOpenPage={() => navigate("agency")} onUnstar={(agent) => setAgents((old) => old.map((a) => a.id === agent.id ? { ...a, pinned: false } : a))} onUnpinPage={(target) => setPages((old) => old.filter((p) => p.url !== target.url))} />
          : <><h1>{label}</h1><p>Standalone {label.toLowerCase()} page.</p></>}
      </section>
    </main>
  </div>;
}

createRoot(document.getElementById("root")!).render(<Preview />);
