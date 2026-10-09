import { useMemo, useRef } from "react";
import { useSharedState } from "./poll";
import type { A0WidgetSet, HubA0 } from "../components/AgentZeroPage";
import type { MachineWidgetRow } from "../components/widgets/SystemsWidget";
import type { HubAgent } from "./hub-types";

/**
 * Agent Zero's page fed from today's data (16:40) until a0w-002's widget endpoint lands: GET /api/hub/a0 (goals,
 * timeline, needs you, tasks), /api/hub/agents (who he runs, the plan) and
 * /api/servers (the machines). Independent source states distinguish pending/unavailable data from empty results.
 */
type Server = { name: string; role: string; health?: { level?: string; cpus?: number; load?: number[]; memTotalGb?: number; memAvailGb?: number; diskFreeGb?: number; why?: string[] } | null };

export function a0Widgets(a0: HubA0, agents: HubAgent[], servers: Server[], updated = new Date().toISOString()): A0WidgetSet {
  const env = <S extends string, D>(id: string, title: string, shape: S, data: D) => ({ id, agent: "a0", title, shape, updated, data });
  const owners = agents.filter((a) => a.kind === "owner");
  const zero = agents.find((a) => a.kind === "zero");
  const plan = zero?.plan ?? null;
  const level = (l?: string): MachineWidgetRow["level"] => (l === "bad" ? "bad" : l === "warn" ? "warn" : "ok");
  return {
    needs: env("needs", "What needs you", "needs", { items: a0.needsYou.map((n) => ({ id: n.id, title: n.title, link: n.link })) }),
    progress: env("progress", "How far the plan is", "progress", {
      checked: plan?.checked ?? owners.reduce((n, o) => n + (o.plan?.checked ?? 0), 0),
      total: plan?.total ?? owners.reduce((n, o) => n + (o.plan?.total ?? 0), 0),
      counts: plan?.counts ?? owners.reduce<Record<string, number>>((acc, o) => {
        for (const [k, v] of Object.entries(o.plan?.counts ?? {})) acc[k] = (acc[k] ?? 0) + v;
        return acc;
      }, {}),
      items: a0.tasks.running.map((t) => ({ title: t.title, status: "building", owner: t.id })),
    }),
    team: env("team", "Who A0 runs", "team", {
      members: owners.map((o) => ({ name: o.name, state: o.state, model: o.model, task: o.holding?.title ?? o.role ?? o.project, lastReport: o.lastReport ? { at: o.lastReport.at, text: o.lastReport.text } : null })),
    }),
    systems: env("systems", "How the machines are", "systems", {
      servers: servers
        .filter((s) => s.health)
        .map((s) => ({ name: s.name, role: s.role, level: level(s.health?.level), cpus: s.health?.cpus ?? null, load: s.health?.load ?? null, memTotalGb: s.health?.memTotalGb ?? null, memAvailGb: s.health?.memAvailGb ?? null, diskFreeGb: s.health?.diskFreeGb ?? null, why: s.health?.why ?? [] })),
      heavy: "",
    }),
    list: env("goals", "What you told A0 you want", "list", { rows: a0.goals.map((g) => ({ meta: g.day, title: g.title, quote: g.quote })) }),
  };
}

type SourceState = "loading" | "unavailable" | "ready" | "stale";
export type A0SourceStates = { team: SourceState; systems: SourceState };
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const isA0 = (value: unknown): value is HubA0 => object(value) && !value.error && object(value.current)
  && ["working", "done", "idle", "off"].includes(String(value.current.state))
  && Array.isArray(value.goals) && Array.isArray(value.timeline) && Array.isArray(value.needsYou)
  && Array.isArray(value.gaps) && object(value.tasks) && Array.isArray(value.tasks.running);
const isHub = (value: unknown): value is { agents: HubAgent[] } => object(value) && !value.error && Array.isArray(value.agents);
const isServers = (value: unknown): value is { servers: Server[] } => object(value) && !value.error && Array.isArray(value.servers);

/** Keep readable data and its observation time through transport and HTTP-200 error responses. */
function useReadable<T>(source: { data: unknown; error: string | null }, accepts: (value: unknown) => value is T) {
  const last = useRef<{ data: T | null; updated: string }>({ data: null, updated: "" });
  const readable = useMemo(() => {
    if (accepts(source.data) && source.data !== last.current.data) last.current = { data: source.data, updated: new Date().toISOString() };
    return last.current;
  }, [source.data, accepts]);
  const error = source.error || (source.data !== null && !accepts(source.data)
    ? object(source.data) && typeof source.data.error === "string" ? source.data.error : "The node's answer could not be read"
    : "");
  const state: SourceState = error ? readable.data ? "stale" : "unavailable" : readable.data ? "ready" : "loading";
  return { ...readable, error, state };
}

/** Read only while open, reusing shared warm sources. A slow machine probe never holds up A0's own content. */
export function useA0Page(on: boolean) {
  const a0 = useReadable(useSharedState<unknown>(on ? "/api/hub/a0" : null, 30_000), isA0);
  const hub = useReadable(useSharedState<unknown>(on ? "/api/hub/agents" : null, 30_000), isHub);
  const servers = useReadable(useSharedState<unknown>(on ? "/api/servers" : null, 30_000), isServers);
  const page = useMemo(() => {
    if (!a0.data) return null;
    const widgets = a0Widgets(a0.data, hub.data?.agents ?? [], servers.data?.servers ?? [], a0.updated);
    widgets.team.updated = widgets.progress.updated = hub.updated;
    widgets.systems.updated = servers.updated;
    return { data: a0.data, widgets };
  }, [a0.data, a0.updated, hub.data, hub.updated, servers.data, servers.updated]);
  const errors = [a0.error && `Agent Zero: ${a0.error}`, hub.error && `Team: ${hub.error}`, servers.error && `Machines: ${servers.error}`].filter(Boolean);
  const loading = [hub.state === "loading" && "team", servers.state === "loading" && "machines"].filter(Boolean);
  return {
    page,
    sources: { team: hub.state, systems: servers.state } satisfies A0SourceStates,
    error: errors.join(" · "),
    loading: !on ? "" : !page ? (a0.error ? "" : "Reading Agent Zero's page…") : loading.length ? `Loading ${loading.join(" and ")}…` : "",
  };
}
