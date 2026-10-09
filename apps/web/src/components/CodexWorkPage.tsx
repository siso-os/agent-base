import { Bot } from "lucide-react";
import type { CodexLanes } from "../../../../services/node/src/codex-lanes";
import { useSharedState } from "../lib/poll";
import { HubPage, Widget, WidgetGrid } from "./page/HubPage";
import { StatBar } from "./page/Figures";

export function CodexWorkPage() {
  const { data, error } = useSharedState<CodexLanes>("/api/codex-lanes", 15_000);
  return (
    <HubPage id="codex-work" icon={Bot} kicker="Agent Zero" title="Codex work" blurb={data ? `Read ${new Date(data.at * 1000).toLocaleTimeString()} · refreshes every 15 seconds` : "Codex tabs, paired work and the last 24 hours of jobs"}>
      {error && <p role="alert" className="text-sm text-red-300">Could not read Codex work. Trying again every 15 seconds.</p>}
      {!data ? <WidgetGrid><Widget id="codex-work-loading" size="XL" title="Reading Codex work…" loading={!error} failed={error} /></WidgetGrid> : <>
        <StatBar label="Codex work totals" cells={[
          { id: "tabs", label: "Tabs", value: data.tabs.length },
          { id: "pairs", label: "Pairs", value: data.pairs.length },
          { id: "runs", label: "Jobs in 24 hours", value: data.runs.length },
        ]} />
        <h3 className="my-3 text-sm font-medium">Codex tabs</h3>
        <WidgetGrid label="Codex tabs">
          {data.tabs.length === 0 && <Widget id="codex-tabs-empty" size="XL" title="Codex tabs" empty="No Codex tabs reported." />}
          {data.tabs.map((tab) => <Widget key={tab.pane} id={`codex-tab-${tab.pane}`} size="XL" title={<span className="break-all">{tab.tab}</span>} stat={{ value: tab.status }} sub={tab.model || "Model not reported"}>
            <div data-testid="codex-tab" className="flex min-w-0 flex-col gap-2 text-xs text-muted-foreground">
              <span className="break-all">{tab.cwd}{tab.branch ? ` · ${tab.branch}` : ""}</span>
              <span>{tab.worked || "Last turn duration not reported"}</span>
              <pre className="m-0 whitespace-pre-wrap break-words font-sans text-foreground">{tab.said.join("\n") || "No recent words reported."}</pre>
              {tab.last_commit && <span className="break-words">{tab.last_commit}</span>}
            </div>
          </Widget>)}
        </WidgetGrid>
        <h3 className="my-3 text-sm font-medium">Pairs</h3>
        <WidgetGrid label="Paired work">
          {data.pairs.length === 0 && <Widget id="codex-pairs-empty" size="XL" title="Pairs" empty="No pairs reported." />}
          {data.pairs.map((pair) => <Widget key={pair.pair} id={`codex-pair-${pair.pair}`} size="XL" title={`Pair ${pair.pair}`} tone={pair.blocked.length ? "warn" : "none"} sub={`${pair.done} done · ${pair.open} open · ${pair.blocked.length} blocked`}>
            <div data-testid="codex-pair" className="flex min-w-0 flex-col gap-2 text-xs text-muted-foreground">
              <span>{pair.model || "Model not reported"}{pair.pane ? ` · ${pair.pane}` : ""}</span>
              <span className="break-words text-foreground">{pair.next ? `Next: ${pair.next}` : "No open item."}</span>
              {pair.blocked.length > 0 && <pre className="m-0 whitespace-pre-wrap break-words font-sans text-amber-300">{pair.blocked.map((item) => `Blocked: ${item}`).join("\n")}</pre>}
              <pre className="m-0 whitespace-pre-wrap break-words font-sans">{pair.commits.join("\n") || "No commits reported."}</pre>
            </div>
          </Widget>)}
        </WidgetGrid>
        <h3 className="my-3 text-sm font-medium">Jobs · last 24 hours</h3>
        <WidgetGrid label="Jobs in the last 24 hours">
          {data.runs.length === 0 && <Widget id="codex-runs-empty" size="XL" title="Jobs" empty="No jobs reported in the last 24 hours." />}
          {[...data.runs].reverse().map((run, i) => <Widget key={`${run.at}-${i}`} id={`codex-run-${i}`} size="XL" title={`${run.at} · ${run.model ?? "Model not reported"}`} stat={{ value: run.status ?? "Status not reported" }}>
            <div data-testid="codex-run" className="flex min-w-0 flex-col gap-2 text-xs text-muted-foreground">
              <span className="break-all">{run.dir || "Folder not reported"}</span>
              <span>{run.min.toLocaleString()} minutes · {run.mtok.toLocaleString()}M input tokens</span>
              {run.task && <span className="break-words text-foreground">{run.task}</span>}
            </div>
          </Widget>)}
        </WidgetGrid>
      </>}
    </HubPage>
  );
}
