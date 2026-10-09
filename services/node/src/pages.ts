// The industry and client pages (project-pages spec v2, Shaan 3 Oct 01:05: "so it's actually got some information. We
// can see what the owners are"). One assembler for both: every value carries `src`, the file or command it came from;
// what nothing records goes to `missing`, never a made-up figure. Reads the item's own folder only (its AGENTS.md door,
// .agents/owners.log, README, git log, task folders, screenshots); never `code/` for images and never a personal/ path.
import { execFile } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { INDUSTRIES, type FolderItem } from "./org.ts";
import { readTasks } from "./tasks.ts";

const run = promisify(execFile);
type Tone = "good" | "working" | "needs" | "neutral";
export type Sourced<T> = T & { src: string };
export type EntityPage = {
  kind: "client" | "industry";
  id: string;
  name: string;
  /** "ACTIVE CLIENT · SINCE 31 AUG · HARRISON" or "INDUSTRY · 2 CLIENTS · 1 LIVE" (the hero's kicker). */
  kicker: string[];
  line: Sourced<{ text: string }> | null;
  since: Sourced<{ date: string }> | null;
  tags: { label: string; tone: Tone }[];
  owner: {
    mode: "running" | "record" | "domain";
    name: string | null;
    state: "working" | "idle" | "planned" | "none";
    sentence: string;
    why: Sourced<{ text: string }>;
    crew: { name: string; state: string }[];
    planned: string | null;
  };
  stats: Sourced<{ label: string; period: string; value: string | null; unit?: string; delta?: { text: string; tone: Tone }; line: string }>[];
  activity: Sourced<{ days: { date: string; n: number }[] }>;
  live: Sourced<{ url: string; code: number | null; at: number }>[];
  /** Screenshots for the hero, as GET /api/org/thumb?folder=&file= pairs (its own folder, else its template's or a client's). */
  thumbs: { folder: string; file: string; phone: boolean }[];
  work: Sourced<{ open: number; total: number; byState: Record<string, number>; items: { id: string; title: string; state: string }[] }>;
  clients: { id: string; name: string; stage?: string; line: string; thumb: string | null }[];
  built: { title: string; line: string; chip: string; tone: Tone }[];
  people: { name: string; note: string; contact: boolean }[];
  happened: Sourced<{ date: string; text: string }>[];
  assets: { name: string; files: number }[];
  notes: Sourced<{ text: string }>[];
  missing: { field: string; how: string }[];
};

const ws = (home: string, rel: string) => path.join(home, "SISO_Workspace", rel);
const read = (file: string) => {
  try {
    return readFileSync(file, "utf8");
  } catch {
    return "";
  }
};
/** The door's first table row named `key` ("| Owner | … |"), from the folder's AGENTS.md. */
const doorRow = (md: string, key: string) => md.match(new RegExp(`^\\|\\s*\\**${key}\\**\\s*\\|\\s*(.+?)\\s*\\|\\s*$`, "mi"))?.[1]?.replace(/[`*]/g, "").trim() ?? null;
/** The first sentence-y paragraph of a README or door ("**In one line:** …" first). */
function oneLine(md: string): string | null {
  const inOne = md.match(/\*\*In one line:\*\*\s*(.+)/i)?.[1];
  if (inOne) return inOne.replace(/\s*District:.*$/, "").trim();
  const para = md.split(/\n\s*\n/).map((p) => p.trim()).find((p) => p && !/^[#|>`<!-]/.test(p) && p.length > 30);
  return para ? para.replace(/\s+/g, " ").replace(/[*_`]/g, "").slice(0, 260) : null;
}
// A dev server's localhost URL is not a live site; a check that serves its own fixture sets AB_PAGES_LOCAL_URLS=1.
const urlsIn = (md: string) => [...new Set([...md.matchAll(/https?:\/\/[^\s)>\]"'`]+/g)].map((m) => m[0].replace(/[.,;:]+$/, "")))].filter((u) => !/github\.com|shields\.io|googleapis|schema\.org/.test(u) && (process.env.AB_PAGES_LOCAL_URLS === "1" || !/localhost|127\.0\.0\.1/.test(u))).slice(0, 4);

const probes = new Map<string, { code: number | null; at: number }>();
/** HEAD, 5 s timeout, cached 10 min in memory (spec: "HTTP probes of live URLs"). */
async function probe(url: string): Promise<{ code: number | null; at: number }> {
  const hit = probes.get(url);
  if (hit && Date.now() - hit.at < 600_000) return hit;
  let code: number | null = null;
  try {
    code = (await fetch(url, { method: "HEAD", redirect: "follow", signal: AbortSignal.timeout(5000) })).status;
  } catch {
    code = null;
  }
  const out = { code, at: Date.now() };
  probes.set(url, out);
  return out;
}

/** Commit days and subjects for a folder from git; empty when it is not in a repo. */
async function gitLog(dir: string): Promise<{ date: string; text: string }[]> {
  if (!existsSync(dir)) return [];
  try {
    const { stdout } = await run("git", ["-C", dir, "log", "--format=%as%x09%s", "-n", "400", "--", "."], { timeout: 4000, maxBuffer: 2_000_000 });
    return stdout.split("\n").filter(Boolean).map((l) => {
      const [date, ...rest] = l.split("\t");
      return { date, text: rest.join("\t") };
    });
  } catch {
    return [];
  }
}

/** Screenshots the page may show: `.agents/runs/live-*.png`, then a `desktop.png` under `runs/` in a `qa` folder; never `code/`. */
export function thumbsOf(dir: string): { file: string; phone: boolean }[] {
  const out: { file: string; phone: boolean }[] = [];
  const runs = path.join(dir, ".agents/runs");
  try {
    for (const f of readdirSync(runs).filter((f) => /^live-.*\.(png|jpe?g)$/i.test(f)).sort()) out.push({ file: `.agents/runs/${f}`, phone: /mobile|phone/i.test(f) });
  } catch {}
  const walk = (rel: string, depth: number) => {
    if (depth > 5 || out.length >= 4) return;
    let names: string[] = [];
    try {
      names = readdirSync(path.join(dir, rel));
    } catch {
      return;
    }
    for (const n of names) {
      if (n === "code" || n.startsWith(".") || n === "node_modules") continue;
      const r = path.join(rel, n);
      if (n === "desktop.png" && /\/qa\//.test(`/${r}`)) out.push({ file: r, phone: false });
      else if (!/\.\w+$/.test(n)) walk(r, depth + 1);
    }
  };
  walk("runs", 0);
  return out.slice(0, 4);
}
/** The one image file GET /api/org/thumb may serve for an item: inside its folder and one of `thumbsOf`. */
export function thumbPath(home: string, folder: string, file: string): string | null {
  if (/(^|\/)personal(\/|$)/.test(folder)) return null;
  const dir = ws(home, folder);
  return thumbsOf(dir).some((t) => t.file === file) ? path.join(dir, file) : null;
}

const STAGE_WORD: Record<string, string> = { active: "Active client", friends: "Friend", leads: "Lead", unsure: "Not sure", past: "Past client" };
const STAGE_TONE: Record<string, Tone> = { active: "good", friends: "working", leads: "neutral", unsure: "needs", past: "neutral" };
const TASK_OPEN = new Set(["open", "claimed", "building", "review", "allocated", "specced", "todo"]);

export async function buildEntityPage(
  item: FolderItem,
  ctx: {
    home: string;
    items: FolderItem[];
    /** registry.agents entries, and what herdr runs now. */
    agents: [string, any][];
    live: { name: string; cwd: string; status: string }[];
    people: { name: string; note: string; whatsapp?: string; contactId?: string }[];
  },
): Promise<EntityPage> {
  const industry = item.kind === "industry";
  const folder = item.folder ?? (industry ? undefined : item.id);
  const dir = folder ? ws(ctx.home, folder) : "";
  const door = dir ? read(path.join(dir, "AGENTS.md")) : "";
  const readme = dir ? read(path.join(dir, "README.md")) : "";
  const tdir = industry && item.template ? ws(ctx.home, item.template) : "";
  const tdoor = tdir ? read(path.join(tdir, "AGENTS.md")) : "";
  const missing: EntityPage["missing"] = [];
  const rel = (f: string) => (folder ? `${folder}/${f}` : f);

  // Line: the door's "In one line", the README's first paragraph, else the CLIENTS.json note.
  const lineText = oneLine(door) ?? oneLine(readme) ?? (industry ? oneLine(tdoor) : null);
  const line = lineText
    ? { text: lineText, src: oneLine(door) ? rel("AGENTS.md") : oneLine(readme) ? rel("README.md") : `${item.template}/AGENTS.md` }
    : item.note && !/^fixture/.test(item.note)
      ? { text: item.note, src: "SISO_Agency/clients/CLIENTS.json" }
      : null;
  if (!line) missing.push({ field: "a one-line description", how: "AGENTS.md “In one line”, or the README's first paragraph" });

  // Git: since, activity (last 11 days), what happened.
  const log = dir ? await gitLog(dir) : [];
  const since = log.length ? { date: log[log.length - 1].date, src: `git log -- ${folder}` } : null;
  const today = new Date();
  const days = Array.from({ length: 11 }, (_, i) => {
    // Local days, as git's %as prints them (UTC would put a +07 morning's commit on yesterday).
    const t = new Date(today.getTime() - (10 - i) * 86_400_000);
    const d = `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`;
    return { date: d, n: log.filter((c) => c.date === d).length };
  });
  const happened = log.slice(0, 6).map((c) => ({ ...c, src: `git log -- ${folder}` }));

  // The owner (spec "The owner, resolved"): a running seat, else the one on record, else the Agency's domain owner.
  const seats = ctx.agents.filter(([name, a]) => (item.project && a?.project && a.project === item.project) || ctx.live.some((l) => l.name === name && dir && (l.cwd === dir || l.cwd.startsWith(`${dir}/`))));
  const liveOf = (n: string) => ctx.live.find((l) => l.name === n);
  const domain = ctx.agents.find(([, a]) => a?.project === "Agency base" && a?.kind === "owner")?.[0] ?? null;
  const recordRow = doorRow(door, "Owner");
  const logLine = dir ? read(path.join(dir, ".agents/owners.log")).trim().split("\n").filter(Boolean).at(-1) ?? null : null;
  let owner: EntityPage["owner"];
  const running = seats.filter(([n]) => liveOf(n));
  if (running.length) {
    const [lead] = running;
    const st = liveOf(lead[0])!.status;
    owner = {
      mode: "running", name: lead[0], state: st === "working" ? "working" : "idle", planned: null,
      sentence: st === "working" ? "Working on it now" : "Running, idle",
      why: { text: running.length > 1 ? `${running.length} seats work here; ${lead[0]} leads.` : `${lead[0]} works in this folder.`, src: "registry.json · herdr" },
      crew: running.slice(1).map(([n]) => ({ name: n, state: liveOf(n)!.status })),
    };
  } else if (recordRow || logLine) {
    const holder = recordRow ? recordRow.replace(/\s*\(.*$/, "") : (logLine!.split(" · ")[1] ?? "");
    owner = {
      mode: "record", name: holder || null, state: "none", planned: domain,
      sentence: /agent zero|A0/i.test(holder) ? "A0 holds it" : `${holder || "Someone"} is on record`,
      why: { text: recordRow ? `Its door says: “${recordRow}”.` : `Last owners.log line: ${logLine!.slice(0, 120)}`, src: recordRow ? rel("AGENTS.md") : rel(".agents/owners.log") },
      crew: [],
    };
  } else {
    owner = {
      mode: "domain", name: domain, state: domain ? "planned" : "none", planned: domain,
      sentence: domain ? "Planned, not started · the Agency's one owner" : "Nobody placed yet",
      why: { text: "No door and no owners.log in this folder; the Agency's domain owner takes it.", src: "registry.json" },
      crew: [],
    };
    missing.push({ field: "an owner on record", how: "an Owner row in the folder's AGENTS.md, or .agents/owners.log" });
  }

  // Live pages from the README and door, each probed.
  const urls = urlsIn(`${readme}\n${door}${industry ? `\n${tdoor}` : ""}`);
  const live = await Promise.all(urls.map(async (url) => ({ url, ...(await probe(url)), src: `${rel("README.md")} · HEAD probe` })));
  if (!live.length) missing.push({ field: "a live URL", how: "a URL in the folder's README" });

  // Work: the folder's own task folders (.agents/tasks), by state.
  const tasks = dir ? readTasks(dir) : [];
  const byState: Record<string, number> = {};
  for (const t of tasks) byState[t.state] = (byState[t.state] ?? 0) + 1;
  const openTasks = tasks.filter((t) => TASK_OPEN.has(t.state));
  const work = { open: openTasks.length, total: tasks.length, byState, items: openTasks.slice(0, 5).map((t) => ({ id: t.id, title: t.title, state: t.state })), src: rel(".agents/tasks") };

  // Industry: the clients in it. Client: what it is made of (its live pages and its code repos).
  const clients = industry
    ? (item.clients ?? []).map((cid) => ctx.items.find((i) => i.id === cid || i.folder === cid)).filter((c): c is FolderItem => !!c).map((c) => {
        const t = c.folder ? thumbsOf(ws(ctx.home, c.folder))[0] : undefined;
        return { id: c.id, name: c.name, stage: c.stage, line: [c.kind.replace("-", " "), c.people[0]].filter(Boolean).join(" · "), thumb: t && c.folder ? `${c.folder}|${t.file}` : null };
      })
    : [];
  const repos = dir ? (() => {
    try {
      return readdirSync(path.join(dir, "code")).filter((n) => statSync(path.join(dir, "code", n)).isDirectory());
    } catch {
      return [];
    }
  })() : [];
  const built: EntityPage["built"] = industry ? [] : [
    ...live.map((l) => ({ title: new URL(l.url).host, line: l.url, chip: l.code ? `${l.code === 200 ? "live" : l.code === 401 ? "gated" : "http"} · ${l.code}` : "no answer", tone: (l.code === 200 ? "good" : l.code === 401 ? "needs" : "neutral") as Tone })),
    ...repos.map((r) => ({ title: r, line: `code/${r}`, chip: "repo", tone: "neutral" as Tone })),
  ];

  // People: the Rolodex for each name CLIENTS.json gives it.
  const people = item.people.map((n) => {
    const p = ctx.people.find((x) => x.name === n);
    return { name: n, note: p?.note ?? "", contact: !!(p?.whatsapp || p?.contactId) };
  });

  // Assets: the folder's own sub-folders, by name and file count (never their contents).
  const assets = dir ? (() => {
    try {
      return readdirSync(dir).filter((n) => !n.startsWith(".") && n !== "code" && n !== "node_modules" && statSync(path.join(dir, n)).isDirectory()).slice(0, 6).map((n) => {
        let files = 0;
        try {
          files = readdirSync(path.join(dir, n)).length;
        } catch {}
        return { name: n, files };
      });
    } catch {
      return [];
    }
  })() : [];
  const notes = item.note && !/^fixture/.test(item.note) ? [{ text: item.note, src: "SISO_Agency/clients/CLIENTS.json" }] : [];
  // The stat bar: 4 figures (the 5th place is the activity chart).
  const liveUp = live.filter((l) => l.code === 200).length;
  const stats: EntityPage["stats"] = [
    { label: "Open work", period: folder ? "task folders" : "", value: tasks.length ? String(work.open) : null, unit: tasks.length ? `/${work.total}` : undefined, ...(byState.building ? { delta: { text: `${byState.building} building`, tone: "working" as Tone } } : {}), line: tasks.length ? Object.entries(byState).map(([k, v]) => `${v} ${k}`).join(" · ") : "no task folders here", src: work.src },
    industry
      ? { label: "Clients", period: "in this industry", value: String(clients.length), line: clients.map((c) => c.name).join(" · ") || "none placed yet", src: "CLIENTS.json (inferred: it has no industry field)" }
      : { label: "Delivered", period: since ? `since ${new Date(since.date).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}` : "", value: String(built.length), line: built.map((b) => b.title).slice(0, 3).join(" · ") || "nothing recorded", src: `${rel("README.md")} · ${rel("code/")}` },
    { label: "Live", period: live.length ? `probed ${new Date(Math.max(...live.map((l) => l.at))).toTimeString().slice(0, 5)}` : "", value: String(liveUp), ...(live.length ? { delta: { text: live.map((l) => l.code ?? "—").join(" · "), tone: (liveUp === live.length ? "good" : "needs") as Tone } } : {}), line: live.map((l) => new URL(l.url).host).join(" · ") || "no URL yet", src: live[0]?.src ?? rel("README.md") },
    { label: "Revenue", period: "all time", value: null, delta: { text: "not recorded", tone: "neutral" }, line: "no money field in CLIENTS.json", src: "SISO_Agency/clients/CLIENTS.json" },
  ];
  missing.push({ field: "revenue", how: "CLIENTS.json `money` ({fee, paid, owed, currency, src})" });
  if (industry) missing.push({ field: "offer copy", how: "SISO_Agency/hq/industries/INDUSTRIES.json `offer`" });

  const tags: EntityPage["tags"] = industry
    ? [...(item.template ? [{ label: `template · ${item.template.split("/").at(-1)}`, tone: "neutral" as Tone }] : [])]
    : [{ label: STAGE_WORD[item.stage ?? ""] ?? item.kind, tone: STAGE_TONE[item.stage ?? ""] ?? "neutral" }];
  const indOf = industry ? null : INDUSTRIES.find((ind) => ctx.items.find((i) => i.id === `industry:${ind.id}`)?.clients?.includes(item.id));
  if (!industry) tags.push(indOf ? { label: indOf.name, tone: "neutral" } : { label: "no industry placed", tone: "needs" });
  const kicker = industry
    ? ["INDUSTRY", `${clients.length} ${clients.length === 1 ? "CLIENT" : "CLIENTS"}`, `${liveUp} LIVE`]
    : [(STAGE_WORD[item.stage ?? ""] ?? item.kind).toUpperCase(), ...(since ? [`SINCE ${new Date(since.date).toLocaleDateString("en-GB", { day: "numeric", month: "short" }).toUpperCase()}`] : []), ...(item.people[0] ? [item.people[0].toUpperCase()] : [])];

  // The hero's screenshots: its own folder's, else (an industry) its template's, else its first client's that has one.
  const heroThumbs = () => {
    const from = [folder, item.template, ...clients.map((c) => ctx.items.find((i) => i.id === c.id)?.folder)].filter((f): f is string => !!f);
    for (const f of from) {
      const t = thumbsOf(ws(ctx.home, f));
      if (t.length) return t.map((x) => ({ folder: f, ...x }));
    }
    return [];
  };
  return {
    kind: industry ? "industry" : "client", id: item.id, name: item.name, kicker, line, since, tags, owner, stats,
    activity: { days, src: `git log -- ${folder ?? "(no folder)"}` }, live, thumbs: heroThumbs(),
    work, clients, built, people, happened, assets, notes, missing,
  };
}
