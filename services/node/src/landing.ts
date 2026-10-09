import { execFile } from "node:child_process";
import type http from "node:http";
import { readdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { gitSha } from "./version.ts";

/**
 * Not landed (Shaan, 3 Oct 14:15: "we clearly don't have a good way of seeing what was achieved last night"): every
 * origin branch still holding commits main does not, newest first, and how far live is behind main. Counted with
 * `git cherry`, so a commit cherry-picked onto main (same patch, new sha) counts as landed. Read from the app's own
 * checkout; `git fetch` runs in the background at most every five minutes, never on the request's path.
 */
export type Branch = { branch: string; lane: string | null; commits: number; at: string; author: string; subject: string; sha: string; why?: string };
/** `branches` is work someone means to land (an open PR, or its lane's owner is live), so its count is true by
 * construction (9 Oct: 21 shown, 2 real); `parked` is everything else with its reason, folded in the UI. */
export type Landing = { branches: Branch[]; parked: Branch[]; live: { sha: string; main: string | null; behind: number | null }; fetchedAt: string | null };
/** Who means to land a branch: open PRs by head branch, and the owners alive now (lower case). */
export type Intent = { prs: () => Promise<Map<string, number> | null>; owners: () => Promise<Set<string>> };

/** Evidence, archives, backups and mocks are never work waiting to ship. */
const NEVER: [RegExp, string][] = [[/^harvest\//, "harvest evidence"], [/^archive\//, "archived"], [/^backup\//, "backup"], [/^mock\//, "design mock"]];

const prCache = new Map<string, { at: number; value: Map<string, number> | null }>();
/** Open PRs from `gh`, read at most every five minutes; null when gh is missing or not signed in. */
async function openPrs(repo: string, now = Date.now()): Promise<Map<string, number> | null> {
  const hit = prCache.get(repo);
  if (hit && now - hit.at < FETCH_EVERY_MS) return hit.value;
  let value: Map<string, number> | null = null;
  try {
    const { stdout } = await run("gh", ["pr", "list", "--state", "open", "--limit", "200", "--json", "number,headRefName"],
      { cwd: repo, timeout: 20_000, env: { ...process.env, GH_PROMPT_DISABLED: "1", PATH: `${process.env.PATH ?? ""}:/opt/homebrew/bin:/usr/local/bin` } });
    value = new Map((JSON.parse(stdout) as { number: number; headRefName: string }[]).map((p) => [p.headRefName, p.number]));
  } catch { /* unknown: owners alone decide */ }
  prCache.set(repo, { at: now, value });
  return value;
}
const DAY = 24 * 3600_000;
/** Owners alive now: a host whose process runs (this laptop), or an owner card written in the last day (any machine). */
async function liveOwners(now = Date.now()): Promise<Set<string>> {
  const names = new Set<string>();
  const hosts = process.env.AB_HOSTS_DIR ?? path.join(homedir(), ".local/state/agent-base/hosts");
  const cards = process.env.AB_OWNER_CARDS ?? path.join(homedir(), ".local/state/a0/owners");
  for (const f of await readdir(hosts).catch(() => [] as string[])) {
    if (!f.endsWith(".json")) continue;
    const d = JSON.parse(await readFile(path.join(hosts, f), "utf8").catch(() => "{}")) as { name?: string; pid?: number };
    try { if (d.name && d.pid) { process.kill(d.pid, 0); names.add(d.name.toLowerCase()); } } catch { /* not running */ }
  }
  for (const f of await readdir(cards).catch(() => [] as string[])) {
    if (!f.endsWith(".json") || f.startsWith("_")) continue;
    const c = JSON.parse(await readFile(path.join(cards, f), "utf8").catch(() => "{}")) as { name?: string; updated?: string; status?: string };
    if (now - Date.parse(c.updated ?? "") < DAY && !/^(done|retired|stopped)$/i.test(c.status ?? "")) names.add((c.name ?? f.slice(0, -5)).toLowerCase());
  }
  return names;
}
const defaultIntent = (repo: string): Intent => ({ prs: () => openPrs(repo), owners: () => liveOwners() });

/** `codex/x` → codex, `cloud/not-landed` → cloud; a branch with no `/` names no lane. */
export const laneOf = (branch: string) => (branch.includes("/") ? branch.slice(0, branch.indexOf("/")).toLowerCase() : null);

const FETCH_EVERY_MS = 5 * 60_000;
const MAIN = "origin/main";

const run = promisify(execFile);
async function git(repo: string, args: string[]): Promise<string | null> {
  try { return (await run("git", args, { cwd: repo, encoding: "utf8", maxBuffer: 8 << 20, timeout: 30_000 })).stdout; }
  catch { return null; }
}

const fetches = new Map<string, { at: number; running: boolean; done: number | null }>();

/** Start a `git fetch --prune origin` when the last one is five minutes old; the caller never waits for it. */
export function fetchSoon(repo: string, now = Date.now()) {
  if (process.env.AB_LANDING_FETCH === "0") return;
  const f = fetches.get(repo) ?? { at: 0, running: false, done: null };
  if (f.running || now - f.at < FETCH_EVERY_MS) return;
  f.at = now;
  f.running = true;
  fetches.set(repo, f);
  execFile("git", ["fetch", "--quiet", "--prune", "origin"], { cwd: repo, timeout: 60_000, env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } }, (err) => {
    f.running = false;
    if (!err) f.done = Date.now();
  });
}

const FMT = "%(refname:short)%1f%(objectname)%1f%(committerdate:iso-strict)%1f%(authorname)%1f%(subject)";
let cache: { key: string; value: Omit<Landing, "fetchedAt"> } | null = null;

const reads = new Map<string, Promise<Landing>>();
/** Coalesce the first report too: hundreds of git cherry processes must never hold up herdr or sockets. */
export function readLanding(repo: string, intent: Intent = defaultIntent(repo)): Promise<Landing> {
  let pending = reads.get(repo);
  if (!pending) {
    pending = buildLanding(repo, intent).finally(() => reads.delete(repo));
    reads.set(repo, pending);
  }
  return pending;
}
async function buildLanding(repo: string, intent: Intent): Promise<Landing> {
  const [rawRefs, rawMain, prs, owners] = await Promise.all([
    git(repo, ["for-each-ref", `--format=${FMT}`, "refs/remotes/origin"]),
    git(repo, ["rev-parse", "--verify", "--quiet", `${MAIN}^{commit}`]),
    intent.prs(),
    intent.owners(),
  ]);
  const refs = rawRefs ?? "";
  const main = rawMain?.trim() || null;
  const live = gitSha(repo);
  // Branches retired on purpose (services/node/retired-branches.txt: name + why) don't count as not landed (5 Oct: 14 shown, 3 real).
  const retiredText = await readFile(path.join(repo, "services/node/retired-branches.txt"), "utf8").catch(() => "");
  const retired = new Map(retiredText.split("\n").map(l => l.trim()).filter(l => l && !l.startsWith("#")).map(l => [l.split(/\s+/)[0], l.slice(l.split(/\s+/)[0].length).trim() || "retired"] as const));
  const key = JSON.stringify([repo, refs, main, live, retiredText, prs && [...prs], [...owners].sort()]);
  const fetchedAt = fetches.get(repo)?.done ?? null;
  const at = fetchedAt ? new Date(fetchedAt).toISOString() : null;
  if (cache?.key === key) return { ...cache.value, fetchedAt: at };

  const branches: Branch[] = [], parked: Branch[] = [];
  for (const row of refs.split("\n")) {
    const [ref, sha, when = "", author = "", subject = ""] = row.split("\x1f");
    if (!ref || !sha || !ref.startsWith("origin/") || ref === MAIN || ref === "origin/HEAD" || ref === "origin") continue;
    // `+ sha` is a commit main has no equivalent of; `- sha` one it already carries under another sha.
    const out = await git(repo, main ? ["cherry", MAIN, sha] : ["rev-list", "--count", sha]);
    if (out === null) continue;
    const commits = main ? out.split("\n").filter((l) => l.startsWith("+")).length : Number(out.trim()) || 0;
    if (!commits) continue;
    const branch = ref.slice("origin/".length), lane = laneOf(branch), pr = prs?.get(branch);
    const found: Branch = { branch, lane, commits, at: when, author, subject, sha };
    const never = NEVER.find(([re]) => re.test(branch))?.[1];
    // An open PR beats a retired line (someone means to land it again); evidence and archives never count.
    if (never) parked.push({ ...found, why: retired.get(branch) ?? never });
    else if (pr) branches.push({ ...found, why: `PR #${pr} open` });
    else if (retired.has(branch)) parked.push({ ...found, why: retired.get(branch) });
    else if (lane && owners.has(lane)) branches.push({ ...found, why: `${lane.toUpperCase()} is live` });
    else parked.push({ ...found, why: lane ? `no open PR, and no live ${lane.toUpperCase()}` : "no open PR, and no lane owner" });
  }
  const newest = (a: Branch, b: Branch) => Date.parse(b.at) - Date.parse(a.at) || a.branch.localeCompare(b.branch);
  branches.sort(newest); parked.sort(newest);

  let behind: number | null = null;
  if (main && /^[0-9a-f]{7,40}$/i.test(live)) {
    const n = await git(repo, ["rev-list", "--count", `${live}..${main}`]);
    behind = n === null ? null : Number(n.trim());
  }
  const value = { branches, parked, live: { sha: live, main, behind } };
  cache = { key, value };
  return { ...value, fetchedAt: at };
}

export async function handleLanding(req: http.IncomingMessage, res: http.ServerResponse, url: URL, repo: string): Promise<boolean> {
  if (url.pathname !== "/api/not-landed") return false;
  const code = req.method === "GET" ? 200 : 405;
  if (code === 200) fetchSoon(repo);
  res.writeHead(code, { "content-type": "application/json", "cache-control": "no-store" });
  res.end(JSON.stringify(code === 200 ? await readLanding(repo) : { error: "GET only" }));
  return true;
}
