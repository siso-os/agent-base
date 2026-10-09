// All tabs menu preview: 24-tab fixture across Agent Base, HALO, and pages.
import { useState } from "react";
import { TopTabs, type TopTab } from "../../../../packages/siso-shell/src";
import "../../../../packages/siso-shell/shell.css";
import "../src/index.css";

const allTabs: TopTab[] = [
  // Agent Base chat
  { kind: "chat", id: "chat-ab", label: "Agent Base", title: "AB Chat", close: () => {} },
  // Agent Base pages
  { kind: "page", id: "spec-card", label: "specs card", title: "Agent Base specs, built from a pack", address: "127.0.0.1:8891/card/ab-zero-specs", close: () => {} },
  { kind: "page", id: "pr-63", label: "PR #63", title: "Add search to all-tabs menu", address: "github.com/sisodias/siso-internal-labs-agent-base/pull/63", close: () => {} },
  { kind: "page", id: "board", label: "Board", title: "A0 Board", address: "localhost:8891/board", close: () => {} },
  { kind: "page", id: "tasks", label: "Tasks", title: "Open Tasks", address: "localhost:8891/tasks", close: () => {} },
  { kind: "page", id: "notes", label: "Notes", title: "Design notes", address: "localhost:8891/notes", close: () => {} },
  // HALO chat
  { kind: "chat", id: "chat-halo", label: "HALO", title: "HALO Chat", close: () => {} },
  // HALO pages
  { kind: "page", id: "streaming", label: "STREAMING chat", title: "Oracle streaming dashboard", address: "127.0.0.1:8892/streaming", close: () => {} },
  { kind: "page", id: "oracle-ops", label: "Oracle ops", title: "Oracle operations", address: "127.0.0.1:8892/oracle/ops", close: () => {} },
  { kind: "page", id: "crm-dashboard", label: "CRM dashboard", title: "HALO CRM dashboard", address: "crm.halo.local/dashboard", close: () => {} },
  { kind: "page", id: "calls", label: "Calls", title: "Call logs", address: "crm.halo.local/calls", close: () => {} },
  // Pages (no owner)
  { kind: "page", id: "github", label: "GitHub", title: "Github home", address: "github.com", close: () => {} },
  { kind: "page", id: "claude-docs", label: "Claude Docs", title: "Claude API documentation", address: "docs.anthropic.com", close: () => {} },
  { kind: "page", id: "slack", label: "Slack", title: "Slack workspace", address: "siso.slack.com", close: () => {} },
  { kind: "page", id: "calendar", label: "Calendar", title: "Work calendar", address: "calendar.google.com", close: () => {} },
  { kind: "page", id: "mail", label: "Mail", title: "Email inbox", address: "mail.google.com", close: () => {} },
  { kind: "page", id: "notion", label: "Notion", title: "Team wiki", address: "notion.so/siso", close: () => {} },
  { kind: "page", id: "docs", label: "Docs", title: "Shared documents", address: "docs.google.com", close: () => {} },
  { kind: "page", id: "sheets", label: "Sheets", title: "Project tracking", address: "sheets.google.com", close: () => {} },
  { kind: "page", id: "figma", label: "Figma", title: "Design file", address: "figma.com/file/abc", close: () => {} },
  { kind: "page", id: "linear", label: "Linear", title: "Bug tracker", address: "linear.app", close: () => {} },
  { kind: "page", id: "plane", label: "Plane", title: "Project management", address: "plane.siso.local", close: () => {} },
  { kind: "page", id: "vercel", label: "Vercel", title: "Deployment dashboard", address: "vercel.com/dashboard", close: () => {} },
  { kind: "page", id: "stripe", label: "Stripe", title: "Payment dashboard", address: "dashboard.stripe.com", close: () => {} },
];

export function AllTabsPreview() {
  const [activeId, setActiveId] = useState("chat-ab");
  const [tabs, setTabs] = useState(allTabs);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh", background: "var(--crm-color-canvas)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "0 18px", height: 48, borderBottom: "1px solid var(--crm-color-line-subtle)", background: "var(--crm-color-surface)" }}>
        <TopTabs
          tabs={tabs}
          activeId={activeId}
          onSelect={(id) => setActiveId(id)}
          onReorder={(id, before) => {
            const reordered = tabs.filter((t) => t.kind !== "gap");
            const moved = reordered.find((t) => t.kind !== "gap" && t.id === id);
            if (!moved) return;
            reordered.splice(
              reordered.indexOf(moved),
              1,
            );
            const idx = before ? reordered.findIndex((t) => t.kind !== "gap" && t.id === before) : reordered.length;
            reordered.splice(idx, 0, moved);
            setTabs(reordered);
          }}
        />
      </div>
      <div style={{ flex: 1, minHeight: 0, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--crm-color-text-muted)", fontSize: 14 }}>
        Active tab: <strong style={{ marginLeft: 8, color: "var(--crm-color-text-strong)" }}>{tabs.find((t) => t.kind !== "gap" && t.id === activeId)?.label}</strong>
      </div>
    </div>
  );
}

const { createRoot } = await import("react-dom/client");
createRoot(document.getElementById("root")!).render(<AllTabsPreview />);
