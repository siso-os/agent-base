// The chat's Send path against a fake socket (never a live agent): the node's acks and the transcript are simulated.
// ?down starts disconnected; ?old puts Agent Zero's face where it was before t-0105 (bottom 40 px, 48 px). window.__sent collects what the box sent;
type Msg = { t: string; text?: string; key?: string; images?: string[] };
const sent: Msg[] = [];
(window as unknown as { __sent: Msg[] }).__sent = sent;
class FakeSocket {
  static CONNECTING = 0; static OPEN = 1; static CLOSING = 2; static CLOSED = 3;
  readyState = FakeSocket.CONNECTING;
  onopen: (() => void) | null = null; onclose: (() => void) | null = null; onmessage: ((m: { data: string }) => void) | null = null;
  constructor() {
    if (location.search.includes("down")) return;
    setTimeout(() => {
      this.readyState = FakeSocket.OPEN;
      this.onopen?.();
      const at = Date.now() - 60_000;
      this.emit({ t: "hello", state: "working", log: [
        { t: "user", text: "Build the Tasks page", at, from: "app" },
        { t: "text", id: "a1", text: "On it. Reading hub-12's parts first.", at: at + 2000 },
        { t: "tool", id: "c1", name: "Bash", summary: "git log --oneline -5", at: at + 4000 },
      ] });
    }, 50);
  }
  emit(e: unknown) { this.onmessage?.({ data: JSON.stringify(e) }); }
  send(raw: string) {
    const m = JSON.parse(raw) as Msg;
    sent.push(m);
    if (m.t !== "prompt") return;
    const fail = /FAIL/.test(m.text ?? "");
    // The node types it into the pane (≈ the paste settle), then Claude reads it at its next step.
    setTimeout(() => this.emit(fail ? { t: "unsent", key: m.key, error: "Could not type into the pane: lab" } : { t: "sent", key: m.key }), 300);
    if (!fail) setTimeout(() => this.emit({ t: "user", text: [m.text, ...(m.images ?? [])].filter(Boolean).join("\n"), at: Date.now(), from: "app" }), 1500);
  }
  close() { this.readyState = FakeSocket.CLOSED; }
}
(window as unknown as { WebSocket: unknown }).WebSocket = FakeSocket;

const { createRoot } = await import("react-dom/client");
const { ChatView } = await import("../src/components/ChatView");
const { AgentFace } = await import("../../../packages/halo-face");
await import("../src/index.css");

createRoot(document.getElementById("root")!).render(
  <div style={{ display: "flex", height: "100vh", flexDirection: "column", background: "var(--crm-color-canvas)" }}>
    <div style={{ position: "relative", minHeight: 0, flex: 1 }}><ChatView agentId="lab-agent" active people={{}} /></div>
    {/* The HUD row as App draws it (Hud.tsx): 32 px, its right end kept clear for the face. */}
    <div className="flex h-8 shrink-0 items-center gap-4 border-t border-[var(--crm-color-line-subtle)] pl-4 pr-16 text-[11.5px] text-muted-foreground" data-testid="hud">
      <span>Opus 5.5</span><span className="ml-auto font-mono">laptop</span>
    </div>
    <button type="button" className="siso-zero-face" style={location.search.includes("old") ? { right: 16, bottom: 40 } : undefined} aria-label="Agent Zero, working" data-testid="zero-face" onClick={() => { document.body.dataset.face = String(Number(document.body.dataset.face ?? 0) + 1); }}>
      <AgentFace name="A0" project="SISO" status="working" size={location.search.includes("old") ? 48 : 40} track interactive />
    </button>
  </div>,
);
