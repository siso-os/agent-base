import { useEffect, useRef, useState } from "react";
import type { Agent } from "../lib/agents";
import { AgentFace, faceFor } from "../lib/face";
import { every } from "../lib/poll";
import { fmtDuration, type Call } from "../lib/chat";
import { Said, Thought, CallRow, Step } from "./ChatView";
import type { CodexWorker, WorkerRun } from "../../../../services/node/src/codex-workers";
import "./CodexWorkerPage.css";

function RunMessages({ run }: { run: WorkerRun }) {
  return <>{run.items.map(item => {
    if (item.kind === "command_output") return null; // The command's Claude tool row owns its output.
    if (item.kind === "agent_message") return <Said key={item.id} text={item.text} answer />;
    if (item.kind === "reasoning") return <Thought key={item.id} text={item.text} ms={null} />;
    const output = run.items.find(i => i.id === `${item.id}-output`)?.text;
    const call: Call = {
      id: item.id, name: item.kind === "command_execution" ? "Bash" : item.kind === "file_change" ? "Edit" : item.kind,
      summary: item.text, at: 0,
      ...(item.kind === "command_execution" ? { input: { command: item.text } } : {}),
      ...(item.status === "in_progress" && run.alive ? {} : { done: { ok: item.kind !== "error" && item.status !== "failed", out: output } }),
    };
    return <div key={item.id}><CallRow call={call} />{!call.done && <Step call={call} now={0} />}</div>;
  })}{run.result && <Said text={run.result} answer />}</>;
}

const duration = (run: WorkerRun, now: number) => fmtDuration(Math.max(0, (run.alive ? now : run.ended) - run.started));

/** A codex-run worker is observable here; no socket, terminal attachment or composer. */
export function CodexWorkerPage({ agent }: { agent: Agent }) {
  const [worker, setWorker] = useState<CodexWorker | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  const scroll = useRef<HTMLDivElement>(null);
  const follow = useRef(true);
  useEffect(() => every(() => setNow(Date.now()), 1000), []);
  useEffect(() => {
    let current = true;
    setWorker(null); setError(null); follow.current = true;
    const stop = every(() => {
      void fetch(`/api/codex-workers/${agent.id}`, { cache: "no-store" }).then(async r => {
        if (!r.ok) throw Error(`HTTP ${r.status}`);
        const data = await r.json();
        if (current) { setWorker(data); setError(null); }
      }).catch(() => { if (current) setError("Run refresh unavailable; showing the last read."); });
    }, 1000);
    return () => { current = false; stop(); };
  }, [agent.id]);
  const run = worker?.runs[0];
  const status = run?.alive ? "working" : "idle";
  useEffect(() => { if (follow.current && scroll.current) scroll.current.scrollTop = scroll.current.scrollHeight; }, [worker]);
  return <div className="ab-codex-page siso-chat" data-testid="codex-worker-page">
    <header>
      <AgentFace {...faceFor({ ...agent, status })} size={32} />
      <div className="ab-codex-heading"><h2>{agent.name}</h2>
        <div className="ab-codex-ticket">{run?.tickets.map(t => t.replace(": ", " · ")).join(" · ")}</div>
        <span>{run?.model ?? "Codex"}{run ? ` · ${duration(run, now)}` : ""} · Read only</span>
      </div>
      {run?.alive && run.tokensPerSecond >= 0.05 && <span className="ab-codex-rate" title={run.rateEstimated ? "Estimated from assistant text observed in the last 5 seconds" : "JSONL output token usage observed in the last 5 seconds"} data-testid="codex-worker-rate">{run.rateEstimated ? "~" : ""}{run.tokensPerSecond.toFixed(1)} tokens/s</span>}
    </header>
    {error && <p role="status">{error}</p>}
    <div ref={scroll} className="ab-codex-scroll" onScroll={() => { const el = scroll.current; if (el) follow.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80; }}>
      <div className="siso-chat__col">
        {(worker?.runs.slice(1) ?? []).map(earlier => <details className="ab-codex-earlier" key={earlier.id}>
          <summary><span>{earlier.name}</span><span className={`ab-codex-return is-${earlier.returnStatus ?? "unknown"}`} title={earlier.returned}>{earlier.returnStatus ?? "No RETURN"}</span><span className="ab-codex-duration">{duration(earlier, now)}</span></summary>
          <p className="ab-codex-run-label">{earlier.tickets.join(" · ")} · {new Date(earlier.started).toLocaleString()}</p>
          <RunMessages run={earlier} />
        </details>)}
        {run ? <RunMessages run={run} /> : <p>Reading worker runs…</p>}
      </div>
    </div>
  </div>;
}
