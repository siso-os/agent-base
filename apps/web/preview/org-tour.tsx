import { createRoot } from "react-dom/client";
import type { HubAgent, HubOrg } from "../src/lib/hub-types";
import { OrgChart } from "../src/components/OrgChart";
import "../src/index.css";

const agent = (name: string, state: HubAgent["state"]): HubAgent => ({
  name, kind: "owner", project: "Agent Base", icon: "layout-panel-top", accent: "#FFA726", harness: "codex", model: "GPT Luna", machine: "mac-mini", state,
  holding: null, lastReport: null, plan: { checked: 4, total: 8, counts: { asked: 0, specced: 0, allocated: 0, building: 2, built: 2, checked: 4, parked: 0, dropped: 0 } },
  workers: { total: 3, working: 2 }, spunUp: state !== "off",
});
const owners = [agent("HALO-UI", "working"), agent("AGENT-BASE", "working"), agent("OPS-BUILD", "idle"), agent("EFFICIENCY", "idle"), agent("HEALTH", "done"), agent("BKY", "off")];
const org: HubOrg = {
  zero: { ...agent("A0", "done"), kind: "zero", project: "SISO", plan: { checked: 27, total: 106, counts: { asked: 16, specced: 0, allocated: 0, building: 0, built: 0, checked: 27, parked: 0, dropped: 0 } } },
  top: owners.map((owner) => owner.name),
  groups: [{ id: "agency", name: "SISO Agency", icon: "briefcase-business", projects: [{ name: "HALO", icon: "chess-king", accent: "#F5B400", domains: [{ name: "CRM", owner: owners[0] }, { name: "Ops", owner: owners[2] }, { name: "Client work", owner: null }] }] },
    { id: "labs", name: "SISO Labs", icon: "flask-conical", projects: [{ name: "Agent Base", icon: "layout-panel-top", accent: "#FFA726", domains: [{ name: "Agent Base", owner: owners[1] }, { name: "Efficiency", owner: owners[3] }, { name: "Health", owner: owners[4] }] }] },
    { id: "family", name: "SISO Family", icon: "house", projects: [{ name: "Fahmy's agency", icon: "heart", accent: "#60A5FA", domains: [{ name: "BKY", owner: owners[5] }, { name: "MelanoTresses", owner: null }] }] }],
};
const steps = [
  { node: "root", say: "I run 6 owners across 3 groups. 2 are working right now. My own plan is 27 of 106 checked." },
  { node: "HALO-UI", say: "HALO-UI is working. 3 workers under it, 2 working. Plan 4 of 8 checked." },
  { node: "AGENT-BASE", say: "AGENT-BASE is working. It holds AB-14, ‘Walk him through the org chart’. Its last report at 17:12: ‘Tour steps are being assembled.’ 3 workers under it, 2 working. Plan 4 of 8 checked." },
  { node: "OPS-BUILD", say: "OPS-BUILD is idle." }, { node: "EFFICIENCY", say: "EFFICIENCY is idle." },
  { node: "HEALTH", say: "HEALTH has finished its turn." }, { node: "BKY", say: "BKY isn't running." },
  { node: "ghost", say: "Not spun up yet: HALO · Client work, Fahmy's agency · MelanoTresses." },
];
window.fetch = async () => new Response(JSON.stringify(steps), { headers: { "content-type": "application/json" } });

function Preview() {
  return <div className="hub-preview"><header className="hub-commandbar"><b>Agent Zero　›　Org chart</b><span>Preview · walkthrough open to step 3 of 8</span></header><OrgChart org={org} onOpen={() => {}} /></div>;
}

createRoot(document.getElementById("root")!).render(<Preview />);
