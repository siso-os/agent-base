/**
 * t-0139 (Shaan: "I don't like selecting projects I should be able to just tell the agent and he knows what project is
 * in"): a new agent from his words alone. The project is the one his words name (its name, or a domain one of its
 * agents owns); the name is the first words that say what it is for. No match is no project: the agent starts
 * unplaced and Agent Zero files it, as every unplaced agent is (agent-records.ts, POST /api/agent-records).
 */
export type SayContext = {
  projects: { id: string; name: string }[];
  agents: Record<string, { project?: string; domain?: string } | undefined>;
  /** Names already in use (running or in the table), upper case. */
  taken: Set<string>;
};
export type SayPick = { name: string; project: string | null; why: string };

const STOP = new Set([
  ..."a an the and or to for of in on at by with from into about my our me i we you it its is are be this that these those some any one new another agent agents start spin up make build fix do get please can could would should will just so then also there here".split(" "),
  // The verbs that open a request say nothing about what it is for.
  ..."check add help handle sort look run create set update improve finish write tidy clean someone something need want".split(" "),
]);
/** Words every project shares: they never pick one. */
const GENERIC = new Set(["siso", "labs", "lab", "agency", "app", "apps", "project", "projects", "work", "team"]);
const tokens = (s: string) => s.toLowerCase().match(/[a-z0-9]+/g) ?? [];
const keyWords = (s: string) => tokens(s).filter((w) => w.length >= 3 && !STOP.has(w) && !GENERIC.has(w));

export function fromWords(said: string, ctx: SayContext): SayPick {
  const words = tokens(said);
  const text = ` ${words.join(" ")} `;
  const have = new Set(words);
  let best: { name: string; score: number; why: string } | null = null;
  let tie = false;
  for (const p of ctx.projects) {
    const phrase = tokens(p.name).join(" ");
    let score = 0;
    const why: string[] = [];
    if (phrase && text.includes(` ${phrase} `)) (score += 3), why.push(`"${p.name}"`);
    else for (const w of keyWords(`${p.name} ${p.id}`)) if (have.has(w)) (score += 2), why.push(`"${w}"`);
    const domains = new Set(Object.values(ctx.agents).filter((a) => a?.project === p.name && a.domain).flatMap((a) => keyWords(a!.domain!)));
    for (const w of domains) if (have.has(w) && !why.includes(`"${w}"`)) (score += 1), why.push(`"${w}"`);
    if (!score) continue;
    if (!best || score > best.score) (best = { name: p.name, score, why: why.join(", ") }), (tie = false);
    else if (score === best.score) tie = true;
  }
  const project = best && !tie ? best.name : null;
  // Its name: the first two words that say what it is for, past the project's own name.
  const skip = new Set(project ? tokens(project) : []);
  const what = keyWords(said).filter((w) => !skip.has(w));
  let base = (what.slice(0, 2).join("-") || (project ? keyWords(project)[0] : "") || "agent").toUpperCase().slice(0, 36);
  if (!/^[A-Z0-9]/.test(base)) base = `A-${base}`;
  let name = base;
  for (let n = 2; ctx.taken.has(name); n++) name = `${base}-${n}`;
  return { name, project, why: project ? `your words named ${best!.why}` : tie ? "your words fit more than one project" : "your words named no project" };
}
