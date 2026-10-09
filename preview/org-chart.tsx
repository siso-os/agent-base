import { useState } from "react";
import { createRoot } from "react-dom/client";
import type { HubAgent, HubOrg } from "../apps/web/src/lib/hub-types";
import { CommandBar } from "../apps/web/src/components/CommandBar";
import { OrgChart } from "../apps/web/src/components/OrgChart";
import "../apps/web/src/index.css";

const counts = (values: Partial<Record<"asked" | "specced" | "allocated" | "building" | "built" | "checked" | "parked" | "dropped", number>>) => ({
  asked: 0, specced: 0, allocated: 0, building: 0, built: 0, checked: 0, parked: 0, dropped: 0, ...values,
});

function owner(name: string, project: string, domain: string, accent: string, workers: number, working: number, checked: number, total: number, state: HubAgent["state"] = "idle"): HubAgent {
  const open = Math.max(0, total - checked);
  const asked = Math.floor(open * 0.1);
  const specced = Math.floor(open * 0.2);
  const allocated = Math.floor(open * 0.2);
  const building = Math.floor(open * 0.15);
  return {
    name, kind: "owner", project, domain, role: domain, icon: "radio-tower", accent,
    harness: "claude", model: "Opus 5.5", machine: "laptop", state,
    holding: null, lastReport: null, spunUp: true,
    workers: { total: workers, working },
    plan: { checked, total, counts: counts({ asked, specced, allocated, building, built: open - asked - specced - allocated - building, checked }) },
  };
}

const streaming = owner("STREAMING-CLAUDE", "HALO", "Streaming go-live", "#F5B400", 3, 0, 6, 26, "done");
const ops = owner("OPS-BUILD", "HALO", "Ops Hub", "#F5B400", 2, 0, 6, 17);
const crm = owner("HALO-UI", "HALO", "CRM", "#F5B400", 1, 0, 10, 19, "done");
const agentBase = owner("AGENT-BASE", "Agent Base", "The app", "#FB923C", 14, 2, 38, 123, "working");
const stack = owner("STACK-OPT", "Efficiency", "Agent stack", "#A78BFA", 0, 0, 12, 16, "done");
const health = owner("HEALTH", "Health", "Machines", "#34D399", 0, 0, 2, 9, "working");
const solo = (name: string, project: string, accent: string): HubAgent => ({
  name, kind: "owner", project, domain: name, role: name, icon: "briefcase-business", accent,
  harness: "claude", model: "Opus 5.5", machine: "laptop", state: "idle", spunUp: true,
  workers: { total: 0, working: 0 }, holding: null, lastReport: null,
});
const bky = solo("BKY", "Fahmy's agency", "#60A5FA");
const melano = solo("MELANOTRESSES", "Fahmy's agency", "#60A5FA");
const unspun = (name: string, project: string, accent: string): HubAgent => ({
  name, kind: "owner", project, domain: name, role: name, icon: "circle-dashed", accent,
  harness: "herdr", model: "—", machine: "—", state: "off", spunUp: false,
});
const none = (domain: string) => ({ name: domain, icon: "circle-dashed", accent: "var(--crm-color-text-faint)", domains: [{ name: domain, owner: null }] });

const fixture: HubOrg = {
  zero: {
    name: "A0", kind: "zero", project: "Agent Zero", icon: "sparkles", accent: "#FFA726",
    harness: "claude", model: "Opus 5.5", machine: "laptop", state: "working", spunUp: true,
  },
  top: [streaming.name, ops.name, crm.name, agentBase.name, stack.name, health.name],
  groups: [
    {
      id: "agency", name: "SISO Agency", icon: "building-2",
      projects: [
        { name: "HALO", icon: "radio-tower", accent: "#F5B400", domains: [
          { name: "Streaming", owner: streaming }, { name: "Ops Hub", owner: ops }, { name: "CRM", owner: crm },
        ] },
        { name: "Fahmy's agency", icon: "briefcase-business", accent: "#60A5FA", domains: [
          { name: "Whole project", owner: unspun("Whole project", "Fahmy's agency", "#60A5FA") },
          { name: "BKY", owner: bky }, { name: "MelanoTresses", owner: melano },
        ] },
      ],
    },
    {
      id: "labs", name: "SISO Labs", icon: "flask-conical",
      projects: [
        { name: "Agent Base", icon: "panels-top-left", accent: "#FB923C", domains: [{ name: "The app", owner: agentBase }] },
        { name: "Efficiency", icon: "gauge", accent: "#A78BFA", domains: [{ name: "Agent stack", owner: stack }] },
        { name: "Health", icon: "activity", accent: "#34D399", domains: [{ name: "Machines", owner: health }] },
        { name: "Agency base", icon: "layers", accent: "#85858D", domains: [{ name: "Whole project", owner: null }] },
        { name: "Lifelog", icon: "book-open", accent: "#85858D", domains: [{ name: "Whole project", owner: null }] },
      ],
    },
    {
      id: "family", name: "SISO Family", icon: "heart",
      projects: [none("Finance"), none("Legal"), none("Study"), none("Goals"), none("Property")],
    },
  ],
};

function Preview() {
  const [current, setCurrent] = useState("AGENT-BASE");
  const [notice, setNotice] = useState("Select an owner to switch the chat.");
  return (
    <div className="hub-preview">
      <CommandBar org={fixture} current={current} onSelect={(name) => { setCurrent(name); setNotice(`Selected ${name}`); }} onOpen={() => setNotice("Org chart is open")} />
      <OrgChart org={fixture} onOpen={(name) => setNotice(`Open ${name}`)} />
      <span className="hub-preview__notice" role="status">{notice}</span>
    </div>
  );
}

createRoot(document.getElementById("preview-root")!).render(<Preview />);
