import { WidgetCard, type WidgetFile, type WidgetSize } from "./WidgetCard";

export type MachineLevel = "ok" | "warn" | "bad";
export type MachineWidgetRow = {
  name: string;
  role: string;
  level: MachineLevel;
  cpus: number | null;
  load: number[] | null;
  memTotalGb: number | null;
  memAvailGb: number | null;
  diskFreeGb: number | null;
  why: string[];
};
export type SystemsWidgetFile = WidgetFile<"systems", { servers: MachineWidgetRow[]; heavy: string }>;

function percent(value: number | null | undefined) {
  return value === null || value === undefined || !Number.isFinite(value) ? null : Math.min(100, Math.max(0, Math.round(value)));
}

function cpuUsage(machine: MachineWidgetRow) {
  if (!machine.cpus || !machine.load?.length) return null;
  return percent(machine.load[0] / machine.cpus * 100);
}

function memoryUsage(machine: MachineWidgetRow) {
  if (!machine.memTotalGb || machine.memAvailGb === null) return null;
  return percent((1 - machine.memAvailGb / machine.memTotalGb) * 100);
}

function Meter({ label, value }: { label: string; value: number | null }) {
  return <label className="widget-systems__meter"><span>{label}</span><i><b style={{ width: `${value ?? 0}%` }} /></i><em>{value === null ? "—" : `${value}%`}</em></label>;
}

export function SystemsWidget({ widget, size }: { widget: SystemsWidgetFile; size: WidgetSize }) {
  const servers = widget.data.servers;
  const needsCare = servers.filter((server) => server.level === "bad").length;
  const warnings = servers.filter((server) => server.level === "warn").length;
  const healthy = servers.filter((server) => server.level === "ok").length;
  return <WidgetCard
    size={size}
    title="How the machines are"
    description="Load on every box, live for the laptop, every 15 min for the rest."
    icon="server"
    count={!servers.length ? "no readings" : needsCare ? <span className="is-critical">{needsCare} need care{warnings ? ` · ${warnings} warning${warnings === 1 ? "" : "s"}` : ""}</span> : warnings ? `${warnings} warning${warnings === 1 ? "" : "s"}` : "all OK"}
    metric={servers.length ? <>{healthy}<small>/{servers.length}</small></> : "—"}
    label={servers.length ? "machines OK" : "No machine readings"}
    tileExtra={<span className="widget-systems__dots">{servers.map((server) => <i key={server.name} className={`is-${server.level}`} title={`${server.name}: ${server.level}`} />)}</span>}
    className="widget-systems"
  >
    <ul className="widget-list widget-systems__list">{(size === "L" ? servers : servers.slice(0, 4)).map((server) => {
      const cpu = cpuUsage(server);
      const memory = memoryUsage(server);
      // Disk free shows once per machine (R1.14): the meter carries it, so the reasons drop their "N GB disk free".
      const why = server.why.filter((w) => !/disk free$/i.test(w));
      return <li key={server.name} className={`is-${server.level}`}>
        <div className="widget-systems__heading"><b>{server.name}</b><span>{server.role}</span></div>
        <div className="widget-systems__meters"><Meter label="CPU" value={cpu} /><Meter label="RAM" value={memory} /><span className={`widget-systems__disk${server.diskFreeGb !== null && server.diskFreeGb < 20 ? " is-low" : ""}`}>Disk free <b>{server.diskFreeGb === null ? "—" : `${server.diskFreeGb.toFixed(0)} GB`}</b></span></div>
        {why.length > 0 && <p className="widget-systems__why">{why.join(", ")}</p>}
      </li>;
    })}</ul>
    {!servers.length && <p className="siso-widget__empty">No machine readings available.</p>}
    <div className="widget-systems__heavy">heavy: {widget.data.heavy || "—"}</div>
  </WidgetCard>;
}
