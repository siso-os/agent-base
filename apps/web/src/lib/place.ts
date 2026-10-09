// t-0008 (Shaan, 2 Oct 15:16 and 15:49: "i still keep getting unsorted agents"): every live agent the org does not
// place gets a home in the side nav, never an "Unsorted" list. Pure, so the node check and the nav agree.
import type { Org, OrgProject, Team } from "./agents";

const ZERO = new Set(["Agent Zero", "A0"]);

/** The repo a worktree belongs to: `.../worktrees/<repo>/<lane>`. */
const worktreeRepo = (cwd: string) => cwd.replace(/\\/g, "/").match(/\/worktrees\/([^/]+)\/[^/]+/)?.[1] ?? null;

/**
 * Where an unplaced agent belongs, first match wins: its registry project; its owner's project; the project whose folder
 * holds its cwd (a worktree of a repo that sits in that project's folder counts); else Agent Zero, who runs everything.
 * Projects run from another slot (`elsewhere`: Efficiency, Estate, SISO) are not drawn, so they are not homes.
 */
export function homeOf(
  a: { name: string; project?: string | null; owner?: string | null; lead?: string | null; cwd?: string },
  org: Org,
): OrgProject | "zero" {
  const drawn = org.groups.flatMap((g) => g.projects).filter((p) => !p.elsewhere);
  const byName = (name?: string | null) => (name ? drawn.find((p) => p.name.toLowerCase() === name.toLowerCase()) : undefined);
  const boss = a.owner ?? a.lead;
  if (boss && ZERO.has(boss)) return "zero";
  const ofOwner = boss ? drawn.find((p) => p.owners.some((o) => o.name === boss)) : undefined;
  const cwd = (a.cwd ?? "").replace(/\\/g, "/");
  const repo = worktreeRepo(cwd);
  const ofCwd = cwd
    ? drawn.find((p) => {
        if (!p.path) return false;
        const dir = p.path.replace(/\\/g, "/").replace(/\/$/, "");
        if (cwd === dir || cwd.startsWith(`${dir}/`)) return true;
        // A worktree of a repo beside this project's folder (siso-internal-labs-agent-base next to …-agents).
        const parent = dir.split("/").at(-2) ?? "";
        return !!repo && (dir.split("/").includes(repo) || (parent.length >= 6 && repo.startsWith(parent)));
      })
    : undefined;
  return byName(a.project) ?? ofOwner ?? ofCwd ?? "zero";
}

/** Splits the teams the org did not place: by project id, and Agent Zero's own (his buttons under his card). */
export function placeStrays(strays: Team[], org: Org): { byProject: Map<string, Team[]>; zero: Team[] } {
  const byProject = new Map<string, Team[]>();
  const zero: Team[] = [];
  for (const t of strays) {
    const home = homeOf(t.lead, org);
    if (home === "zero") zero.push(t);
    else byProject.set(home.id, [...(byProject.get(home.id) ?? []), t]);
  }
  return { byProject, zero };
}
