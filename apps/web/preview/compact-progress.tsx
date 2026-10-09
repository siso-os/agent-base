import { ChatActivityRail, type ChatActivityRailProps } from '../src/components/ChatActivityRail'
import type { CSSProperties } from 'react'

/**
 * Preview: Compacting progress bar states
 * Shows five states: starting (3s), mid (42s), long (151s), failed, done
 */
export function CompactProgressPreview() {
  const P50 = 78000;
  const P90 = 136000;
  const now = Date.now();

  const states: { label: string; props: ChatActivityRailProps }[] = [
    {
      label: "Starting (3 s)",
      props: {
        kind: "compacting",
        status: "running",
        summary: "Compacting",
        output: "Back, summary of 12k tokens",
        startedAt: now - 3000,
        typicalMs: P50,
        longMs: P90,
      }
    },
    {
      label: "Mid (42 s)",
      props: {
        kind: "compacting",
        status: "running",
        summary: "Compacting",
        output: "Back, summary of 12k tokens",
        startedAt: now - 42000,
        typicalMs: P50,
        longMs: P90,
      }
    },
    {
      label: "Long (151 s)",
      props: {
        kind: "compacting",
        status: "running",
        summary: "Compacting",
        output: "Back, summary of 12k tokens",
        startedAt: now - 151000,
        typicalMs: P50,
        longMs: P90,
      }
    },
    {
      label: "Failed (51 s)",
      props: {
        kind: "compacting",
        status: "failed",
        summary: "Compaction failed",
        output: "Compaction failed: operation timed out",
        startedAt: now - 51000,
        typicalMs: P50,
        longMs: P90,
        details: "The compaction operation did not complete in time"
      }
    },
    {
      label: "Done (65 s took)",
      props: {
        kind: "compacting",
        status: "succeeded",
        summary: "Compacted · took 1:05 · summary 12k tokens",
        output: "Back, summary of 12k tokens",
        startedAt: now - 65000,
        typicalMs: P50,
        longMs: P90,
      }
    }
  ];

  return (
    <div style={{ padding: "20px", background: "#0d1418", color: "#dce6f1", fontFamily: "system-ui, sans-serif", minHeight: "100vh" }}>
      <h1 style={{ margin: "0 0 30px", fontSize: "18px" }}>Compact Progress Bar States</h1>

      {states.map((state) => (
        <div key={state.label} style={{ marginBottom: "30px", maxWidth: "620px" }}>
          <div style={{ fontSize: "12px", color: "#a9bdd4", marginBottom: "8px", fontWeight: 500 }}>
            {state.label}
          </div>
          <div style={{ borderRadius: "8px", overflow: "hidden" }}>
            <ChatActivityRail {...state.props} expanded={false} />
          </div>
        </div>
      ))}
    </div>
  );
}
