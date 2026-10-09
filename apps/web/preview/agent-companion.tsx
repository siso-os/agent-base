import React, { useState, type CSSProperties } from "react";
import { createRoot } from "react-dom/client";
import { PanelRight, ArrowUpRight, Layers, MessageSquare } from "lucide-react";
import { AgentPanel } from "../src/components/AgentPanel";
import { AgentFace, faceFor } from "../src/lib/face";
import type { Agent, Org, Stats } from "../src/lib/agents";
import type { TaskIndex, TaskSummary } from "../src/components/widgets/TasksWidget";
import type { Moment } from "../src/components/Timeline";
import { localDay } from "../src/lib/spend";
import "../../../packages/siso-tokens/siso.css";
import "../../../packages/siso-shell/shell.css";
import "../../../packages/siso-shell/src/halo-rim/halo-rim.css";
import "./agent-companion.css";

const now = Date.now(), day = localDay(), at = (minutes = 0) => new Date(now - minutes * 60_000).toISOString();
const params = new URLSearchParams(location.search);
const scenario = params.get("state") || "working";
const baseAgent = (id: string, name: string, extra: Partial<Agent> = {}): Agent => ({
  id, name, key: `example/${id}`, pane: `example-${id}`, title: "", status: "working", since: now - 900_000,
  row: "live", snoozedUntil: null, settledAt: null, seenAt: null, order: null, tool: "codex", cwd: "/synthetic/workspace", folder: "workspace", machine: "Example Mac", session: null, context: 28, project: "agent-base", ...extra,
} as Agent);
const zero = baseAgent("example-zero", "Agent Zero", { zero: true, tool: "claude", title: "Keep each workspace moving" });
const owner = baseAgent("example-base", "AGENT BASE", { kind: "owner", navOwner: true, title: "Simplify the companion panel", workspace: "agent-base" });
const halo = baseAgent("example-halo", "HALO", { kind: "owner", navOwner: true, project: "halo", workspace: "halo", title: "Review the Operator’s stream controls", status: "needs" });
const agency = baseAgent("example-agency", "SISO AGENCY", { kind: "owner", navOwner: true, project: "siso-agency", title: "Prepare the next client handoff", status: "idle" });
const rows = [zero, owner, halo, agency,
  baseAgent("example-design", "PANEL DESIGN", { kind: "worker", lead: owner.name, parentId: owner.id, title: "Fit the task tree inside the narrow panel" }),
  baseAgent("example-qa", scenario === "long" ? "RESPONSIVE ACCESSIBILITY AND INTERACTION REVIEW" : "INTERACTION QA", { kind: "worker", lead: owner.name, parentId: owner.id, title: "Check keyboard focus, wrapping and empty states", status: "idle" }),
  baseAgent("example-stream", "STREAM QUALITY", { kind: "worker", lead: halo.name, parentId: halo.id, project: "halo", title: "A preview is waiting for review", status: "needs" }),
  baseAgent("example-ended", "SOURCE REVIEW", { kind: "worker", parentId: owner.id, lead: owner.name, title: "Mapped the existing components", status: "done" }),
];
if (scenario === "long") for (let n = 0; n < 14; n++) rows.push(baseAgent(`example-extra-${n}`, `WORKER ${n + 1} · LONG REPORTING NAME`, { parentId: owner.id, lead: owner.name, kind: "worker", title: "A long task description remains readable when expanded", status: n % 3 === 0 ? "needs" : "working" }));
const agents = scenario === "empty" ? [zero] : rows;
const org: Org = { top: [], bottom: [], groups: [{ id: "labs", name: "Workspaces", icon: "layers", order: 0, folders: [], projects: (scenario === "empty" ? [] : [
  { id: "agent-base", name: "Agent Base", color: "#78b8d1", owner: owner.name }, { id: "halo", name: "HALO", color: "#b5a4e6", owner: halo.name }, { id: "siso-agency", name: "SISO Agency", color: "#d5ad77", owner: agency.name }, { id: "library", name: "Great Library", color: "#7bc5aa", owner: "LIBRARY" },
]).map((p, n) => ({ id: p.id, name: p.name, group: "labs", shown: true, order: n, owners: [{ name: p.owner, domain: p.name, icon: "bot", state: n === 3 ? "offline" : "live", working: n < 2 ? 1 : 0, plan: null }] })) }] } as Org;
const task = (id: string, title: string, stage: TaskSummary["stage"], extra: Partial<TaskSummary> = {}): TaskSummary => ({ id, title, stage, project: "Agent Base", workspace: "agent-base", priority: "P1", owner: owner.name, model: "Example model", updated: at(2), ...extra });
const tasks: TaskSummary[] = scenario === "empty" ? [] : [
  task("demo-panel", "A quieter agent panel that fits beside the chat", "building", { next: "NOW: Connect the team view and check the narrow layout", agent: "PANEL DESIGN" }),
  task("demo-01-discover", "Understand the current panel", "live", { parent: "demo-panel" }),
  task("demo-01-discover-1", "Read the current routes and component contracts", "live", { parent: "demo-01-discover" }),
  task("demo-01-discover-2", "Recover the approved task tree", "live", { parent: "demo-01-discover" }),
  task("demo-02-build", "Build the compact views", "building", { parent: "demo-panel" }),
  task("demo-02-build-1", "Move spend and session stats into the dashboard", "live", { parent: "demo-02-build" }),
  task("demo-02-build-2", "Show owners and workers together without clipping their names", "building", { parent: "demo-02-build", next: "NOW: Inspect long names at 320 pixels" }),
  task("demo-02-build-3", "Check keyboard navigation and restore focus after closing details", "specced", { parent: "demo-02-build" }),
  task("demo-03-check", "Review the finished experience", "specced", { parent: "demo-panel" }),
  task("demo-03-check-1", "Inspect the task tree on a small display", "specced", { parent: "demo-03-check" }),
  task("demo-halo", "Review the Operator controls before the next preview", "preview", { project: "HALO", workspace: "halo", owner: halo.name, needs: true, next: "Compare the preview with the last accepted layout" }),
  task("demo-agency", "Prepare the client handoff and its supporting links", "specced", { project: "SISO Agency", workspace: "siso-agency", owner: agency.name }),
  task("demo-unknown", "Assign an owner to the new research brief", "allocated", { project: "Unplaced", workspace: null, owner: "RESEARCH" }),
  task("demo-done", "Document the component contracts", "live", { live_at: at(40) }),
];
const index: TaskIndex = { updated: at(2), tasks, counts: {} };
const stats: Stats = { first: at(185), last: at(1), prompts: 12, apiCalls: 42, tokens: { input: 218000, output: 36400, cacheRead: 127000, cacheWrite: 7000, total: 388400, cachePct: 63 }, toolCalls: 78, tools: { Read: 38, Edit: 24, Bash: 16 }, skills: { "UI bank": 4 }, subagents: { count: 3, recent: [] }, models: { "Example model": 42 }, hours: [4000, 9800, 6200, 14200, 8600, 17300, 11900, 7800].map((output, i) => ({ hour: at((7 - i) * 60), output })), costUsd: null };
const pending: Moment[] = scenario === "empty" ? [] : [
  { id: "example-pipe-1", k: "soul", state: "Branch · 2 commits", title: "Compact team tree", text: "Ready for a rendered layout check.", who: "PANEL DESIGN", t: at(4), branch: "example/compact-team" },
  { id: "example-pipe-2", k: "task", state: "tested", title: "Keyboard and focus behavior", text: "Example checks recorded; awaiting preview review.", who: "INTERACTION QA", t: at(10), task: "demo-panel" },
  { id: "example-pipe-3", k: "task", state: "preview", title: "Operator controls ready to inspect", text: "Compare the recorded preview before deciding the next step.", who: "HALO", t: at(15), task: "demo-halo" },
  { id: "example-pipe-4", k: "shipped", state: "queued", title: "Workspace naming cleanup", text: "Queued for the next integration check.", who: "AGENT BASE", t: at(21), branch: "example/workspace-labels" },
];
const moments: Moment[] = scenario === "empty" ? [] : [
  { id: "example-moment-1", k: "task", state: "tested", title: "Task hierarchy keeps its parent context", note: { title: "Task hierarchy keeps its parent context", why: "You can find a step without losing the project it belongs to.", what: ["Wrapped task names", "Kept completed steps in the plan"] }, text: "Synthetic example record.", who: "PANEL DESIGN", t: at(8), task: "demo-panel" },
  { id: "example-moment-2", k: "page", state: "Posted", title: "Companion review is ready", text: "Synthetic review link", who: "AGENT BASE", t: at(35), url: "https://example.test/panel-review" },
];
const launched = scenario === "empty" ? [] : [
  { id: "example-sub-1", kind: "codex", type: "worker", name: "CHECK THE NARROW LAYOUT", what: "Check names, task steps and focus at each width", spec: "Synthetic review task", start: at(15), end: null, tokens: 12200, tools: 14, running: true, background: true },
  { id: "example-sub-2", kind: "claude", type: "worker", name: "SOURCE MAP", what: "Read the existing panel boundaries", spec: "Synthetic read task", start: at(48), end: at(25), tokens: 5300, tools: 12, running: false, background: true, status: "done" },
  { id: "example-sub-3", kind: "codex", type: "worker", name: "PREVIEW CHECK", what: "Waiting for a source to reconnect", spec: "Synthetic blocked task", start: at(19), end: null, tokens: 4300, tools: 8, running: false, background: true, status: "blocked" },
];
const registry = { workspaces: [ { id: "agent-base", name: "Agent Base", color: "#78b8d1", nav: true, order: 0, owner: owner.name }, { id: "halo", name: "HALO", color: "#b5a4e6", nav: true, order: 1, owner: halo.name }, { id: "siso-agency", name: "SISO Agency", color: "#d5ad77", nav: true, order: 2, owner: agency.name } ] };
const requests: string[] = [];
const fixture = window as unknown as { __companionFixture: { scenario: string; requests: string[]; writes: string[] }; EventSource: typeof EventSource | undefined };
fixture.__companionFixture = { scenario, requests, writes: [] };
fixture.EventSource = undefined;
// This entry point has no production transport. Every read and write is served by this local fixture.
window.fetch = async (input, init) => {
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, location.origin);
  const route = url.pathname;
  requests.push(route);
  if (init?.method && init.method !== "GET") { fixture.__companionFixture.writes.push(route); return Response.json({ error: "Preview is read-only" }, { status: 409 }); }
  if (scenario === "unavailable") return Response.json({ error: "Synthetic source unavailable" }, { status: 503 });
  if (route === "/api/a0/tasks") return Response.json(index);
  if (route.startsWith("/api/a0/tasks/")) return Response.json({ ...tasks.find(t => t.id === route.split("/").at(-1)), history: [{ at: at(2), stage: "building", by: "Example", note: "A synthetic task step" }] });
  if (route === "/api/workspace-registry") return Response.json(registry);
  if (route.endsWith("/subagents")) return Response.json({ rows: launched, running: 1, tokens: 21800 });
  if (route.endsWith("/stats")) return Response.json(stats);
  if (route === "/api/pipeline") return Response.json({ pending });
  if (route === "/api/timeline") return Response.json({ day: url.searchParams.get("day") || day, moments: url.searchParams.get("day") === day ? moments : [], unavailable: [] });
  if (route === "/api/spend") return Response.json({ source: "stack-opt", today: scenario === "stale" ? undefined : { usd: 10.66, from: "tokens", day, observedAt: now }, attribution: { source: "stack-opt", scope: "report-day", state: scenario === "stale" ? "stale" : "fresh", observedAt: now - (scenario === "stale" ? 86400_000 : 0), attemptedAt: now, day, reason: scenario === "stale" ? "timeout" : null }, data: { day, claude_usd_equiv: 10.66, codex_credits: [72, 96], attributed_to_plan_items: 0, plan_items: [], projects: [] } });
  return Response.json({ error: "No synthetic data for this view" }, { status: 503 });
};

function Review() {
  const [width, setWidth] = useState(Number(params.get("width")) || 360);
  const [open, setOpen] = useState(true);
  const [receipt, setReceipt] = useState("Preview uses synthetic agents and tasks.");
  const selected = scenario === "owner" ? owner : zero;
  const pages = [{ url: "https://example.test/companion-review", title: "Agent panel · component review", at: now }, { url: "https://example.test/workspace-map", title: "Workspace map and task ownership", at: now - 180000 }, { url: "https://example.test/operator-preview", title: "HALO Operator · latest preview", at: now - 360000 }];
  return <main className="pr-review"><header className="pr-review-head"><div><p>AGENT BASE / COMPONENT REVIEW</p><h1>The agent panel</h1><span>Five places, sized for the right side of chat.</span></div><div className="pr-controls"><label>Panel width<select aria-label="Panel width" value={width} onChange={e => setWidth(Number(e.target.value))}>{[320, 360, 440, 520].map(w => <option key={w} value={w}>{w}px</option>)}</select></label><label>Example state<select aria-label="Example state" value={scenario} onChange={e => { const u = new URL(location.href); u.searchParams.set("state", e.target.value); u.searchParams.set("width", String(width)); location.href = u.href; }}><option value="working">Working</option><option value="owner">One owner</option><option value="long">Long names & teams</option><option value="empty">Empty</option><option value="stale">Stale spend</option><option value="unavailable">Sources unavailable</option></select></label></div></header>
    <div className="pr-stage" style={{ "--review-width": `${width}px` } as CSSProperties}>
      <div className="pr-chat"><header><AgentFace {...faceFor(selected)} size={30} /><strong>{selected.name}</strong><span>Example workspace</span><button type="button" data-testid="chat-panel-toggle" aria-label={open ? "Close agent panel" : "Open agent panel"} onClick={() => setOpen(!open)}><PanelRight size={18} /></button></header><div className="pr-chat-content"><span className="pr-chat-kicker"><Layers size={15} /> THE COMPANION, REWORKED</span><h2>Keep the conversation.<br />Find the work beside it.</h2><p>The panel now has one clear home for the dashboard, the task tree and the team. Details open where you are.</p><div className="pr-decisions"><span><b>12 → 5</b> primary tabs</span><span><b>1</b> team & org view</span><span><b>{width}px</b> panel width</span></div><div className="pr-change-note"><MessageSquare size={16} /><span>Try Team, expand a worker, then open Tasks and unfold Agent Base. Activity shows the delivery pipeline.</span></div><p className="pr-receipt" role="status" data-testid="preview-receipt">{receipt}</p></div><div className="pr-input"><span>Message {selected.name}…</span><ArrowUpRight size={16} /></div></div>
      <AgentPanel open={open} a={selected} agents={agents} org={scenario === "unavailable" ? null : org} stats={scenario === "unavailable" ? null : stats} workspaces={registry.workspaces} focus={null} people={{}} onOpenAgent={a => setReceipt(`Open conversation requested: ${a.name}`)} onStatsPage={() => setReceipt("Full Stats requested")} onOrgChart={() => setReceipt("Full org graph requested")} onPage={p => setReceipt(`Open page requested: ${p.title}`)} onBoard={() => setReceipt("Task board requested")} onStanding={() => setReceipt("Workspace dashboard requested")} onClose={() => setOpen(false)} pages={{ pinned: [pages[0]], dropped: pages.slice(1), open: new Set<string>(), onOpen: p => setReceipt(`Open page requested: ${p.title}`), onUnpin: p => setReceipt(`Unpin requested: ${p.title}`), onHide: p => setReceipt(`Hide requested: ${p.title}`) } as React.ComponentProps<typeof AgentPanel>["pages"]} />
    </div><footer className="pr-footer">Real AgentPanel components · synthetic data · integration preview <span>Changes, Board and Widgets remain under Overview → More. Infrastructure stays in the app’s Infrastructure area.</span></footer></main>;
}
createRoot(document.getElementById("root")!).render(<Review />);
