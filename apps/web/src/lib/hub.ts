import { useEffect, useMemo, useState } from "react";
import { every, useShared } from "./poll";
import type { AgentHoverCardAgent } from "../components/AgentHoverCard";
import type { Agent } from "./agents";
import { accentRgb } from "./face";
import type { HubAgent, HubOrg, HubProject } from "./hub-types";

/** hub-1's name rule (services/node/src/hub.ts canon): the part after "Title | ", no luna-/sol- prefix, upper case. */
export const canon = (raw: string) => raw.split("| ").at(-1)!.trim().replace(/^(luna|sol)-/i, "").toUpperCase();

/** GET /api/hub/agents, read once and every 30 s: what each agent holds, its last report, its plan. */
export function useHubAgents() {
  // One read shared by the sidebar, the app and Agent Zero's page (lib/poll.ts).
  const d = useShared<{ agents?: HubAgent[] }>("/api/hub/agents", 30_000);
  return useMemo(() => new Map((d?.agents ?? []).map((a) => [a.name, a])), [d]);
}

/** The hover card's agent (hub-5): the live row first, the hub's plan and reports on top when it knows the agent. */
export function hoverAgent(a: Agent, hub: Map<string, HubAgent>): AgentHoverCardAgent {
  const h = hub.get(canon(a.name)) ?? (a.zero ? hub.get("A0") ?? hub.get("AGENT ZERO") : undefined);
  return {
    sleepPolicy: a.serviceHost,
    sleep: a.serviceHost?.state === "asleep" ? a.serviceHost : undefined,
    name: a.name,
    kind: a.zero ? "zero" : a.lead ? "worker" : "owner",
    project: a.project ?? "Unsorted",
    faceProject: a.project ?? undefined,
    owner: a.lead ?? h?.owner,
    role: h?.role ?? a.role ?? a.domain ?? undefined,
    accent: `rgb(${accentRgb(a.project).replace(/ /g, ",")})`,
    harness: a.host ? "siso" : a.tool === "codex" ? "codex" : a.tool === "claude" ? "claude" : "herdr",
    model: a.hud?.model ?? (h?.model && h.model !== "—" ? h.model : a.tool),
    machine: a.machine,
    machineKey: a.machineKey,
    state: a.status === "working" ? "working" : a.status === "done" ? "done" : "idle",
    holding: h?.holding ?? null,
    lastReport: h?.lastReport ?? null,
    plan: h?.plan ?? null,
  };
}

/** A project's dashboard (hub-4): undefined while it loads, null when hub-1 has none for it (the org page shows it). */
export function useHubProject(id: string | null) {
  const [project, setProject] = useState<HubProject | null | undefined>(undefined);
  useEffect(() => {
    setProject(undefined);
    if (!id) return;
    let live = true;
    const load = () =>
      fetch(`/api/hub/project/${encodeURIComponent(id)}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((p: HubProject | null) => live && setProject(p))
        .catch(() => live && setProject(null));
    const stop = every(load, 30_000);
    return () => {
      live = false;
      stop();
    };
  }, [id]);
  return project;
}

/** hub-7's org chart data (GET /api/hub/org): read while the chart is open, every 30 s. undefined while it loads. */
export function useHubOrg(on: boolean) {
  const [org, setOrg] = useState<HubOrg | null | undefined>(undefined);
  useEffect(() => {
    if (!on) return;
    let live = true;
    const load = () =>
      fetch("/api/hub/org")
        .then((r) => (r.ok ? r.json() : null))
        .then((o: HubOrg | null) => live && setOrg(o))
        .catch(() => live && setOrg(null));
    const stop = every(load, 30_000);
    return () => {
      live = false;
      stop();
    };
  }, [on]);
  return org;
}
