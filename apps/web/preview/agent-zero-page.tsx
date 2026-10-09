import { createRoot } from "react-dom/client";
import { AgentZeroPage, type A0WidgetSet, type HubA0 } from "../src/components/AgentZeroPage";
import { ListWidget } from "../src/components/widgets/ListWidget";
import { NeedsWidget } from "../src/components/widgets/NeedsWidget";
import { ProgressWidget } from "../src/components/widgets/ProgressWidget";
import { SystemsWidget } from "../src/components/widgets/SystemsWidget";
import { TeamWidget } from "../src/components/widgets/TeamWidget";
import { UnknownWidget } from "../src/components/widgets/UnknownWidget";
import "../src/index.css";

// Let WebKit capture the entire scrollable dashboard rather than only the desktop viewport.
document.documentElement.style.height = "auto";
document.body.style.height = "auto";
document.body.style.overflow = "auto";
const root = document.getElementById("root")!;
root.style.height = "auto";
root.style.minHeight = "100vh";

const fixture: HubA0 = {
  current: { session: "092b7ffb", model: "Opus 5.5", effort: "max", state: "working" },
  sessions: [
    { id: "092b7ffb", started: "2026-10-02T01:24:00+07:00" },
    { id: "7c18d9e1", started: "2026-10-01T19:12:00+07:00" },
    { id: "c48d8720", started: "2026-10-01T09:45:00+07:00" },
  ],
  goals: [
    { day: "2026-10-02", title: "The hub: eyes on everything built in two years, every piece of work tracked", quote: "the bottleneck now the bottleneck is purely the system that i'm using to build all of this stuff and track all of this stuff" },
    { day: "2026-10-02", title: "Oracle gets two owners Shaan pins and asks directly", quote: "can we set an owner on the agent so it gets picked up on the agent base so i can pin it" },
    { day: "2026-10-02", title: "Optimise the agent stack from first principles", quote: "Use first principles is there not a better way on the table that we're missing out?" },
    { day: "2026-10-02", title: "Agents report up through owners; Agent Zero isn't spam-pinged", quote: "one owner that i talk to and he allocates work to the other agents within his node" },
    { day: "2026-10-01", title: "Main priority: streaming, live on Chaturbate by pressing a button", quote: "one of my main priorities is we need to get the streaming app looked at with the highest intelligence" },
    { day: "2026-10-01", title: "A persistent Agent Zero", quote: "I want a more persistent version of Agent Zero ... track every single Agent Zero new chat that was made" },
    { day: "2026-10-01", title: "A live view, not the chat", quote: "is there like any UI I can visually view, which kind of gives me an output of what's going on" },
  ],
  timeline: [
    { at: "2026-10-02 14:50", kind: "board", text: "Codex credits: ~60k, Luna 80% / Sol 20%, ~15k a day until 7 Oct" },
    { at: "2026-10-02 14:50", kind: "board", text: "Agent Base's queue split into parallel lanes" },
    { at: "2026-10-02 14:48", kind: "done", text: "Found the biggest load on HALO's server: a forgotten checker, stopped" },
    { at: "2026-10-02T06:55:00+07:00", kind: "checkpoint", text: "laptop dying (2%); resume here after the charger", points: ["Shaan's asks on his dashboard", "In flight when it died", "STREAMING resumes from its checkpoint"] },
    { at: "2026-10-02T05:05:00+07:00", kind: "checkpoint", text: "A0 092b7ffb, laptop on battery at 19%; it will sleep around 06:30 unless Shaan plugs in" },
    { at: "2026-10-02T03:00:00+07:00", kind: "checkpoint", text: "A0 092b7ffb mid-night checkpoint (after the 01:25 compaction)" },
    { at: "2026-10-02T01:25:00+07:00", kind: "checkpoint", text: "A0 checkpoint before compacting itself (Shaan asked)", points: ["No pings on every report", "Agents pick the images, not him", "We are HALO's devs"] },
    { at: "2026-10-02T01:24:00+07:00", kind: "done", text: "1-2 Oct night: HALO images replaced by HALO-UI from the real app; streaming steps 1 and 3 passed on the new route" },
    { at: "2026-10-02T00:20:00+07:00", kind: "done", text: "Mac mini back: exec OK, 10 cores, 16 GB, Codex, Node, Python 3 and Git available" },
    { at: "2026-10-01T19:45:00+07:00", kind: "checkpoint", text: "A0 092b7ffb after its self-compaction; waits re-armed" },
    { at: "2026-10-01T19:21:00+07:00", kind: "done", text: "Back from self-compaction; landed six HALO commits on the main branch" },
    { at: "2026-10-01T19:12:00+07:00", kind: "checkpoint", text: "A0 092b7ffb checkpoint before compacting itself (Shaan asked)" },
  ],
  needsYou: [
    { id: "n-01", title: "Read: HALO, what's next (about 10 min)" },
    { id: "n-02", title: "Look at Halo's dock round 7: the model app's own chat inside the dock, message box pinned to the bottom" },
    { id: "n-03", title: "Look: HALO's real pages, before and after" },
    { id: "n-04", title: "Stripchat sign-in for the model account" },
  ],
  tasks: {
    counts: { running: 9, done: 53, backlog: 8 },
    running: [
      { id: "T-0001", title: "Streaming: go live on Chaturbate with one press" },
      { id: "T-0026", title: "Auto test viewer: live tests stop waiting on you" },
      { id: "T-0069", title: "Operator plan tonight: CRM schedule and attendance" },
      { id: "T-0070", title: "Operator item 1: provision her VPS workspace with no hand work" },
      { id: "T-0071", title: "CamSoda + Stripchat on the server-only route" },
    ],
  },
  memory: [
    { title: "Agent app research (1 Oct 2026)", file: "agent-app-research.md", hook: "his own agent coding app to replace Agent Base: where the research and wireframes live" },
    { title: "Shaan's words to other agents", file: "voice-routes/", hook: "voice-routes + Agent Base intent/ folder" },
  ],
  gaps: [
    "Memory index holds 2 entries: the estate, the owners and his rules live in GOALS.md and the skills, not in memory.",
    "3 of A0's own plan items have no owner yet.",
    "tasks.json says 9 running; A0's plan says 6 building. Two lists, one truth needed.",
  ],
};

const widgets: A0WidgetSet = {
  needs: { id: "needs", agent: "a0", title: "What needs you", shape: "needs", updated, data: { items: fixture.needsYou.map((item, index) => ({ ...item, detail: ["About ten minutes", "Review the latest dock", "Compare the real pages", "Sign in to the model account"][index], minutes: [10, 5, 5, 3][index] })) } },
  progress: { id: "progress", agent: "a0", title: "How far the plan is", shape: "progress", updated, data: { checked: 2, total: 21, counts: { asked: 5, specced: 2, allocated: 4, building: 8, checked: 2 }, items: [{ title: "Ship the A0 widget renderers", status: "building", owner: "AGENT-BASE" }, { title: "Wire the live widget endpoint", status: "allocated", owner: "a0w-002" }, { title: "Confirm the rendered page with Shaan", status: "asked" }] } },
  team: { id: "team", agent: "a0", title: "Who A0 runs", shape: "team", updated, data: { members: [
    { name: "AGENT-BASE", state: "working", model: "Opus", task: "Build Agent Base's Agent Zero widgets", lastReport: { at: updated, text: "Widget refactor in progress" } },
    { name: "STREAMING", state: "working", model: "Opus", task: "Prove the attended live stream flow" },
    { name: "HALO", state: "done", model: "Opus", task: "Reconcile the release work" },
    { name: "EFFICIENCY", state: "idle", model: "Luna", task: "Own the agent stack" },
  ] } },
  systems: { id: "systems", agent: "a0", title: "How the machines are", shape: "systems", updated, data: { servers: [
    { name: "MacBook", role: "Here · live", level: "warn", cpus: 8, load: [4.2, 3.8, 2.9], memTotalGb: 32, memAvailGb: 5.1, diskFreeGb: 82, why: ["Streaming soak running"] },
    { name: "Mac mini", role: "Build runner", level: "ok", cpus: 10, load: [1.1, 1.4, 1.2], memTotalGb: 16, memAvailGb: 8.7, diskFreeGb: 144, why: [] },
  ], heavy: "2/5 slots in use" } },
  list: { id: "goals", agent: "a0", title: "What you told A0 you want", shape: "list", updated, data: { rows: fixture.goals.map((goal) => ({ meta: goal.day, title: goal.title, quote: goal.quote })) } },
};

const unknownWidget = { id: "forecast", agent: "a0", title: "What the forecast says", shape: "forecast-v2", updated, data: { confidence: 0.84, note: "This shape is not installed yet; the plain card stays useful." } };
const widgetSheet = <main className="agent-zero-widget-sheet" data-testid="agent-zero-widget-sheet">
  <header><small>Agent Zero · API-shaped fixture</small><h1>One shape, three sizes</h1><p>Each card reads one widget JSON envelope. Unknown shapes keep their payload visible.</p></header>
  <div className="a0-widget-sheet__row"><div className="a0-widget-sheet__name"><b>needs</b><span>What needs you</span></div><NeedsWidget widget={widgets.needs} size="S" /><NeedsWidget widget={widgets.needs} size="M" /><NeedsWidget widget={widgets.needs} size="L" /></div>
  <div className="a0-widget-sheet__row"><div className="a0-widget-sheet__name"><b>progress</b><span>Plan progress</span></div><ProgressWidget widget={widgets.progress} size="S" /><ProgressWidget widget={widgets.progress} size="M" /><ProgressWidget widget={widgets.progress} size="L" /></div>
  <div className="a0-widget-sheet__row"><div className="a0-widget-sheet__name"><b>team</b><span>Owners and work</span></div><TeamWidget widget={widgets.team} size="S" /><TeamWidget widget={widgets.team} size="M" /><TeamWidget widget={widgets.team} size="L" /></div>
  <div className="a0-widget-sheet__row"><div className="a0-widget-sheet__name"><b>systems</b><span>Machine health</span></div><SystemsWidget widget={widgets.systems} size="S" /><SystemsWidget widget={widgets.systems} size="M" /><SystemsWidget widget={widgets.systems} size="L" /></div>
  <div className="a0-widget-sheet__row"><div className="a0-widget-sheet__name"><b>list</b><span>Goals</span></div><ListWidget widget={widgets.list} size="S" /><ListWidget widget={widgets.list} size="M" /><ListWidget widget={widgets.list} size="L" /></div>
  <div className="a0-widget-sheet__unknown"><div className="a0-widget-sheet__name"><b>unknown</b><span>forecast-v2</span></div><UnknownWidget widget={unknownWidget} size="M" /></div>
</main>;

const rootElement = document.getElementById("root")!;
createRoot(rootElement).render(window.location.search.includes("widgets") ? widgetSheet : <AgentZeroPage data={fixture} widgets={widgets} />);
