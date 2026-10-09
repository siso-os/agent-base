import { Laptop } from "lucide-react";
import type { LaunchdSnapshot } from "../../../../services/node/src/launchd";
import { useSharedState } from "../lib/poll";
import { HubPage, Widget, WidgetGrid } from "./page/HubPage";
import { StatBar } from "./page/Figures";

const unhealthy = (health: string) => health !== "ok" && health !== "running";
const shown = (value: number | null | undefined, unit = "") => value == null ? "—" : `${value.toLocaleString()}${unit}`;

export function LaptopJobsPage({ onBack }: { onBack: () => void }) {
  const { data, error } = useSharedState<LaunchdSnapshot>("/api/launchd", 15_000);
  const jobs = [...(data?.jobs ?? [])].sort((a, b) => Number(unhealthy(b.health)) - Number(unhealthy(a.health)) || (b.runs_per_day ?? 0) - (a.runs_per_day ?? 0) || a.label.localeCompare(b.label));
  return (
    <HubPage id="laptop-jobs" icon={Laptop} kicker="Machines" title="Laptop jobs" back={{ label: "Machines", onClick: onBack }} blurb={data ? `${data.machine} · read ${new Date(data.at * 1000).toLocaleTimeString()} · unhealthy jobs first` : "Launch agents, their schedules and health"}>
      {data && <StatBar label="Laptop job totals" cells={[
        { id: "jobs", label: "Jobs", value: jobs.length },
        { id: "running", label: "Running", value: jobs.filter((j) => j.health === "running").length },
        { id: "unhealthy", label: "Unhealthy", value: jobs.filter((j) => unhealthy(j.health)).length },
        { id: "runs", label: "Scheduled runs/day", value: shown(jobs.reduce((n, j) => n + (j.runs_per_day ?? 0), 0)) },
      ]} />}
      {error && <p role="alert" className="text-sm text-red-300">Could not read laptop jobs. Trying again every 15 seconds.</p>}
      <WidgetGrid label="Launch agents">
        {!data ? <Widget id="launchd-loading" size="XL" title="Reading laptop jobs…" loading={!error} failed={error} /> : jobs.length === 0 ? <Widget id="launchd-empty" size="XL" title="Laptop jobs" empty="No launch agents reported." /> : jobs.map((job) => (
          <Widget key={job.label} id={`launchd-${job.label}`} size="XL" title={<span className="break-all">{job.label}</span>} tone={unhealthy(job.health) ? "bad" : "ok"} stat={{ value: job.health }} sub={job.owner ?? "Owner not reported"}>
            <div data-testid="launchd-job" data-label={job.label} className="flex min-w-0 flex-col gap-2 text-xs text-muted-foreground">
              <p className="m-0 break-all text-foreground">{job.program || "Program not reported"}{job.args ? ` ${job.args}` : ""}</p>
              <div className="flex flex-wrap gap-x-5 gap-y-1">
                <span>{job.schedule ?? "Schedule not reported"} · {shown(job.runs_per_day)} runs/day</span>
                <span>Last exit {shown(job.last_exit)}{job.pid ? ` · PID ${job.pid}` : ""}</span>
                <span>Log {shown(job.log_mb, " MB")} · updated {shown(job.log_age_h, " hours ago")}</span>
              </div>
              {job.log && <span className="break-all">{job.log}</span>}
            </div>
          </Widget>
        ))}
      </WidgetGrid>
    </HubPage>
  );
}
