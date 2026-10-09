import type { HubAgent, HubOrg } from "../../../apps/web/src/lib/hub-types.ts";

export type OrgTourStep = { node: string; say: string };

const clean = (value: string, limit: number) => {
  const text = value.trim();
  if (text.length <= limit) return text;
  return `${text.slice(0, limit).replace(/\s+\S*$/, "").replace(/[,;:]$/, "")}…`;
};

function ownerStep(owner: HubAgent): OrgTourStep {
  const state = owner.state === "working" ? "is working" : owner.state === "done" ? "has finished its turn" : owner.state === "idle" ? "is idle" : "isn't running";
  const facts: string[] = [];
  if (owner.holding) facts.push(`it holds ${owner.holding.id}, “${clean(owner.holding.title, 70)}”`);
  if (owner.lastReport) facts.push(`its last report at ${owner.lastReport.at}: “${clean(owner.lastReport.text, 110)}”`);
  if (owner.workers?.total) facts.push(`${owner.workers.total} worker${owner.workers.total === 1 ? "" : "s"} under it, ${owner.workers.working} working`);
  if (owner.plan) facts.push(`plan ${owner.plan.checked} of ${owner.plan.total} checked`);
  return { node: owner.name, say: `${owner.name} ${state}.${facts.length ? ` ${facts.join("; ")}.` : ""}` };
}

/** Build the walkthrough from the same registry, plan and report facts as the org chart. */
export function buildOrgTour(org: HubOrg, needsYou = 0): OrgTourStep[] {
  const owners = org.groups.flatMap((group) => group.projects.flatMap((project) => project.domains.map((domain) => domain.owner)))
    .filter((owner): owner is HubAgent => owner !== null);
  const unique = [...new Map(owners.map((owner) => [owner.name, owner])).values()];
  const ordered = unique.sort((a, b) => Number(b.state === "working") - Number(a.state === "working") || a.name.localeCompare(b.name));
  const working = ordered.filter((owner) => owner.state === "working").length;
  const steps: OrgTourStep[] = [{
    node: "root",
    say: `I run ${org.top?.length ?? ordered.length} owners across ${org.groups.length} groups. ${working} ${working === 1 ? "is" : "are"} working right now.${needsYou ? ` ${needsYou} thing${needsYou === 1 ? "" : "s"} wait on you.` : ""}${org.zero?.plan ? ` My own plan is ${org.zero.plan.checked} of ${org.zero.plan.total} checked.` : ""}`,
  }, ...ordered.map(ownerStep)];

  const ghosts = org.groups.flatMap((group) => group.projects.flatMap((project) =>
    project.domains.filter((domain) => !domain.owner).map((domain) => `${project.name} · ${domain.name}`),
  ));
  if (ghosts.length) steps.push({ node: "ghost", say: `Not spun up yet: ${ghosts.join(", ")}.` });
  return steps;
}
