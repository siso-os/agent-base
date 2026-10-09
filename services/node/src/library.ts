/**
 * R1.24: the Library rail tool's data (ecosystem SPEC phase 1; Shaan 22:35: "i think we have a cloudfalre url which does
 * te lirbrary and template ready"). It reuses what is already live rather than rebuilding it:
 *   - Built: the estate register on disk (ESTATE keeps it; 247 buildings), else the Great Library site's /estate.json.
 *   - Live: ESTATE's plan/surfaces.json when it exists, else the seed rows beside this file; each URL is probed.
 *   - Works: the Great Library site's /catalog.json, plus the template bank's /templates.json (siso-shell.pages.dev).
 * Remote JSON is fetched with a timeout and cached for 10 minutes; the last good copy is kept on disk, so the tool still
 * reads (marked stale) when the laptop is offline. A request never waits on the network once there is a copy.
 */
import { catalogDocuments, documentUrl, domainDocuments, type CatalogWork } from "./library-documents.ts";
import { execFile } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

const HOME = homedir();
const WS = path.join(HOME, "SISO_Workspace");
const SITE = (process.env.AB_LIBRARY_SITE ?? "https://great-library-of-siso.pages.dev").replace(/\/$/, "");
const SHELL = (process.env.AB_SHELL_SITE ?? "https://siso-shell.pages.dev").replace(/\/$/, "");
const REGISTER = process.env.AB_ESTATE_REGISTER ?? path.join(WS, "SISO_Agents/siso-estate/machines/register.json");
const SURFACES = process.env.AB_SURFACES ?? path.join(WS, "SISO_Agents/siso-estate/plan/surfaces.json");
const SEED = path.join(import.meta.dirname, "library-surfaces.json");
const CACHE = process.env.AB_LIBRARY_CACHE ?? path.join(HOME, ".local/state/agent-base/library-cache");
const TTL = Number(process.env.AB_LIBRARY_TTL_MS ?? 10 * 60_000);
const TIMEOUT = Number(process.env.AB_LIBRARY_TIMEOUT_MS ?? 4000);

export type Building = {
  postcode: string;
  path: string;
  island: string;
  lifecycle: string;
  machines: string[];
  commits: number | null;
  sizeKb: number | null;
  seat: string | null;
  provenance: string | null;
  description: string;
  live: string | null;
};
export type Surface = {
  id: string;
  name: string;
  group: "agency" | "labs" | "family" | "stack";
  project?: string;
  url?: string;
  host: "cloudflare" | "vps" | "local" | "app";
  app?: string;
  machine?: string;
  path?: string;
  edit?: string;
  deploy?: string;
  owner_seat?: string;
  auth?: string;
  note?: string;
};
export type LiveRow = Surface & { status: "up" | "login" | "down" | "app" | "checking"; code: number | null; checkedAt: number | null };
export type Work = { id?: string; owner?: string | null; reference?: string; revision?: string | null; sourceLinks?: CatalogWork["source_links"]; slug: string; name: string; summary: string; kind: string; maturity: string; section: string; url: string };
export type Template = { id: string; name: string; status: string; url: string };
type Remote<T> = { data: T | null; fetchedAt: number | null; stale: boolean; error: string | null };

// ---------- remote JSON: timeout, 10-minute cache, last good copy on disk ----------

type Slot = { data: unknown; at: number; ok: boolean; error: string | null; pending: Promise<void> | null; diskAt: number | null };
const slots = new Map<string, Slot>();
const cacheFile = (url: string) => path.join(CACHE, `${url.replace(/^https?:\/\//, "").replace(/[^A-Za-z0-9.-]+/g, "_")}.json`);

function fromDisk(url: string): { data: unknown; at: number } | null {
  try {
    const f = cacheFile(url);
    return { data: JSON.parse(readFileSync(f, "utf8")), at: statSync(f).mtimeMs };
  } catch {
    return null;
  }
}

async function refresh(url: string, s: Slot) {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT), headers: { accept: "application/json" } });
    if (!r.ok) throw new Error(`${r.status}`);
    const data = await r.json();
    Object.assign(s, { data, at: Date.now(), ok: true, error: null });
    try {
      mkdirSync(CACHE, { recursive: true });
      writeFileSync(cacheFile(url), JSON.stringify(data));
    } catch {
      /* the copy in memory still serves */
    }
  } catch (e) {
    // Keep the last good copy; say why it is stale. Retry no sooner than a minute.
    const why = e instanceof Error ? (e.name === "TimeoutError" ? `no answer in ${TIMEOUT / 1000}s` : e.message) : String(e);
    Object.assign(s, { ok: false, error: why, at: Date.now() - TTL + 60_000 });
  }
}

/** The JSON at `url`: fresh within 10 minutes, else the last good copy at once while it refreshes behind. */
async function remote<T>(url: string): Promise<Remote<T>> {
  let s = slots.get(url);
  if (!s) {
    const disk = fromDisk(url);
    // A copy from disk is shown at once but refreshed on first use.
    s = { data: disk?.data ?? null, at: disk ? 0 : -Infinity, ok: !!disk, error: null, pending: null, diskAt: disk?.at ?? null };
    slots.set(url, s);
  }
  const slot = s;
  if (Date.now() - slot.at >= TTL && !slot.pending) slot.pending = refresh(url, slot).finally(() => (slot.pending = null));
  if (slot.data === null && slot.pending) await slot.pending;
    // When the copy was fetched: this run's last success, else the disk copy's time.
  if (slot.ok && slot.at > 0) slot.diskAt = slot.at;
  const fetchedAt = slot.diskAt;
  return { data: (slot.data as T) ?? null, fetchedAt: slot.data === null ? null : fetchedAt, stale: slot.data !== null && (!!slot.error || Date.now() - (fetchedAt ?? 0) >= TTL), error: slot.error };
}

// ---------- Built: the register ----------

let reg: { mtime: number; rows: Building[]; vps: number } | null = null;
const machineName = (m: string) => (m === "vps-siso" ? "siso-vps" : m);
/** A description as words: no leading emoji or symbols (a README's "🔥🔥🔥" line), no markdown emphasis. */
const plain = (s: string) => s.replace(/\*\*|`/g, "").replace(/^[^\p{L}\p{N}"'(]+/u, "").trim();

function readRegister(): { rows: Building[]; vps: number } | null {
  let mtime: number;
  try {
    mtime = statSync(REGISTER).mtimeMs;
  } catch {
    return null;
  }
  if (reg?.mtime === mtime) return reg;
  const r = JSON.parse(readFileSync(REGISTER, "utf8")) as { buildings?: Record<string, unknown>[] };
  const rows: Building[] = (r.buildings ?? []).map((b) => {
    const runs = Array.isArray(b.runs) ? (b.runs as { site?: string }[]).map((x) => x.site).filter((x): x is string => !!x) : [];
    return {
      postcode: String(b.postcode ?? b.path ?? "?"),
      path: String(b.path ?? ""),
      island: String(b.island ?? "unsorted"),
      lifecycle: String(b.lifecycle ?? "unscored"),
      machines: [...new Set([...((b.built_on as string[]) ?? []), ...runs].map(machineName))],
      commits: typeof b.commits_14d === "number" ? b.commits_14d : null,
      sizeKb: typeof b.size_kb === "number" ? b.size_kb : null,
      seat: typeof b.seat === "string" ? b.seat : null,
      provenance: typeof b.provenance === "string" ? b.provenance : null,
      description: plain(String(b.description ?? "")),
      live: null,
    };
  });
  reg = { mtime, rows, vps: rows.filter((b) => b.machines.includes("siso-vps")).length };
  return reg;
}

type SiteRepo = { repository?: string; url?: string; work_slug?: string; work_name?: string; lifecycle_status?: string };
const fromSite = (repos: SiteRepo[]): Building[] =>
  repos.map((x) => ({
    postcode: x.work_slug ?? x.repository ?? "?",
    path: x.url ?? "",
    island: "library",
    lifecycle: x.lifecycle_status ?? "unscored",
    machines: [],
    commits: null,
    sizeKb: null,
    seat: null,
    provenance: null,
    description: x.work_name ?? "",
    live: null,
  }));

// ---------- Live: surfaces, probed ----------

let surf: { file: string; mtime: number; rows: Surface[] } | null = null;
function readSurfaces(): { rows: Surface[]; source: "estate" | "seed" } {
  for (const file of existsSync(SURFACES) ? [SURFACES, SEED] : [SEED]) {
    try {
      const mtime = statSync(file).mtimeMs;
      if (surf?.file !== file || surf.mtime !== mtime) {
        const j = JSON.parse(readFileSync(file, "utf8")) as Surface[] | { surfaces?: Surface[] };
        surf = { file, mtime, rows: (Array.isArray(j) ? j : j.surfaces ?? []).filter((s) => s && s.id && s.name) };
      }
      return { rows: surf.rows, source: file === SEED ? "seed" : "estate" };
    } catch (e) {
      if (file === SEED) throw e;
    }
  }
  throw new Error("no Library surfaces");
}

const probes = new Map<string, { status: LiveRow["status"]; code: number | null; at: number; pending: Promise<void> | null }>();
async function probe(url: string) {
  const p = probes.get(url)!;
  try {
    const r = await fetch(url, { method: "GET", redirect: "manual", signal: AbortSignal.timeout(Math.min(TIMEOUT, 3000)) });
    void r.body?.cancel().catch(() => {});
    Object.assign(p, { code: r.status, status: r.status === 401 || r.status === 403 ? "login" : r.status < 400 ? "up" : "down", at: Date.now() });
  } catch {
    Object.assign(p, { code: null, status: "down", at: Date.now() });
  }
}
/** Each URL's last answer; one in flight per URL, again after 10 minutes. The first read waits for the probe (≤3 s). */
async function probed(rows: Surface[]): Promise<LiveRow[]> {
  const waits: Promise<void>[] = [];
  for (const s of rows) {
    if (s.host === "app" || !s.url) continue;
    let p = probes.get(s.url);
    if (!p) probes.set(s.url, (p = { status: "checking", code: null, at: 0, pending: null }));
    const slot = p;
    if (Date.now() - slot.at >= TTL && !slot.pending) slot.pending = probe(s.url).finally(() => (slot.pending = null));
    if (slot.at === 0 && slot.pending) waits.push(slot.pending);
  }
  await Promise.all(waits);
  return rows.map((s) => {
    if (s.host === "app" || !s.url) return { ...s, status: "app", code: null, checkedAt: null };
    const p = probes.get(s.url)!;
    return { ...s, status: p.status, code: p.code, checkedAt: p.at || null };
  });
}

// ---------- the whole answer ----------

type Catalog = { generated_at?: string; works?: CatalogWork[] };
type Templates = { templates?: { id: string; family?: string; status?: string }[] };

export async function library() {
  const [catalog, estate, templates] = await Promise.all([remote<Catalog>(`${SITE}/catalog.json`), remote<{ repositories?: SiteRepo[] }>(`${SITE}/estate.json`), remote<Templates>(`${SHELL}/templates.json`)]);
  const { rows: surfaces, source: liveSource } = readSurfaces();
  const live = await probed(surfaces);

  let built: Building[] = [];
  let builtSource: "register" | "site" | "none" = "none";
  let builtError: string | null = null;
  let vps = 0;
  try {
    const r = readRegister();
    if (r) ((built = r.rows), (builtSource = "register"), (vps = r.vps));
  } catch (e) {
    builtError = `Could not read the register (${e instanceof Error ? e.message : String(e)})`;
  }
  if (builtSource === "none" && estate.data?.repositories?.length) ((built = fromSite(estate.data.repositories)), (builtSource = "site"));
  // A building with a live page opens it.
  const byPath = new Map(live.filter((s) => s.path && s.url).map((s) => [s.path!, s.url!]));
  if (byPath.size) built = built.map((b) => (byPath.has(b.path) ? { ...b, live: byPath.get(b.path)! } : b));

  const works: Work[] = (catalog.data?.works ?? []).map((w) => ({
    id: w.id ?? w.slug,
    owner: w.owner_entry?.owner ?? null,
    reference: w.owner_entry?.reference ?? `catalog.json#${w.slug}`,
    revision: w.owner_entry?.source_revision ?? null,
    sourceLinks: w.source_links ?? [],
    slug: w.slug,
    name: w.name,
    summary: w.summary ?? "",
    kind: w.type ?? "work",
    maturity: w.maturity ?? "",
    section: w.section ?? "",
    url: documentUrl(w.library_url ?? `/works/${encodeURIComponent(w.slug)}/`, `${SITE}/`) ?? "",
  }));
  const tpl: Template[] = (templates.data?.templates ?? []).map((t) => ({ id: t.id, name: (t.family ?? t.id).split(/ \(|: /)[0], status: (t.status ?? "").split(/[.:;]/)[0], url: `${SHELL}/t/${encodeURIComponent(t.id)}/` }));

  const tally = (xs: string[]) => xs.reduce<Record<string, number>>((m, x) => ((m[x] = (m[x] ?? 0) + 1), m), {});
  return {
    at: Date.now(),
    documents: { rows: [...domainDocuments(), ...catalogDocuments(catalog.data?.works ?? [], SITE)], source: `${SITE}/catalog.json`, fetchedAt: catalog.fetchedAt, stale: catalog.stale, error: catalog.error, scope: "Catalogue reading pages and source documentation, plus the Agent Base domains. Historical documents outside these sources are not indexed yet." },
    counts: { built: built.length, live: live.length, works: works.length, templates: tpl.length, lifecycle: tally(built.map((b) => b.lifecycle)), islands: tally(built.map((b) => b.island)), vps },
    built: { rows: built, source: builtSource, error: builtError },
    live: { rows: live, source: liveSource },
    works: {
      rows: works,
      templates: tpl,
      site: SITE,
      shell: SHELL,
      generated: catalog.data?.generated_at ?? null,
      fetchedAt: catalog.fetchedAt,
      stale: catalog.stale,
      error: catalog.data ? null : catalog.error,
      templatesError: templates.data ? null : templates.error,
    },
  };
}

/** Phase 1 §7: launch a desktop app row (Lifelog = SISO Internal). Only `host: "app"` rows in the surfaces file; no free text. */
export function openApp(id: unknown): Promise<{ ok: boolean; status: number; error?: string }> {
  const row = readSurfaces().rows.find((s) => s.id === id && s.host === "app" && s.app);
  if (!row) return Promise.resolve({ ok: false, status: 403, error: "not a Library app" });
  const [cmd, ...args] = process.env.AB_OPEN_APP ? [process.env.AB_OPEN_APP] : ["open", "-a"];
  return new Promise((resolve) =>
    execFile(cmd, [...args, row.app!], { timeout: 10_000 }, (err) => resolve(err ? { ok: false, status: 500, error: `could not open ${row.app}` } : { ok: true, status: 200 })),
  );
}

// ---------- a building's card (§3.1 #8) and its menu (#7) ----------

const git = (cwd: string, args: string[]) =>
  new Promise<string>((resolve) => execFile("git", ["-C", cwd, ...args], { timeout: 2000 }, (err, out) => resolve(err ? "" : String(out).trim())));
/** Only buildings the register names, and only inside the workspace: the browser never sends a path. */
function buildingDir(postcode: unknown): { b: Building; dir: string } | null {
  const b = readRegister()?.rows.find((x) => x.postcode === postcode);
  if (!b?.path) return null;
  const dir = path.resolve(WS, b.path);
  return dir.startsWith(WS + path.sep) && existsSync(dir) ? { b, dir } : null;
}
/** Door text: the first paragraph of its AGENTS.md (else README.md), as plain words, cut at a word. */
function doorText(dir: string): { text: string; from: string } | null {
  for (const f of ["AGENTS.md", "README.md"]) {
    let md: string;
    try {
      md = readFileSync(path.join(dir, f), "utf8");
    } catch {
      continue;
    }
    const para = md
      .split(/\n\s*\n/)
      .map((p) => p.trim())
      .find((p) => p && !/^(#|<|!\[|\||```|---|@)/.test(p));
    if (!para) continue;
    const text = plain(para.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1").replace(/\s+/g, " "));
    return { text: text.length > 360 ? `${text.slice(0, 360).replace(/\s+\S*$/, "")}…` : text, from: f };
  }
  return null;
}
const githubUrl = (remote: string) => {
  const m = remote.match(/github\.com[:/]([^/\s]+)\/([^/\s]+?)(?:\.git)?$/);
  return m ? `https://github.com/${m[1]}/${m[2]}` : null;
};
export async function buildingCard(postcode: unknown) {
  const hit = buildingDir(postcode);
  if (!hit) return null;
  const [last, remote] = await Promise.all([git(hit.dir, ["log", "-1", "--format=%h%x09%cI%x09%s"]), git(hit.dir, ["remote", "get-url", "origin"])]);
  const [sha, at, subject] = last.split("\t");
  const live = readSurfaces().rows.filter((s) => s.path === hit.b.path).map((s) => ({ id: s.id, name: s.name, url: s.url ?? null }));
  return { postcode: hit.b.postcode, door: doorText(hit.dir), lastCommit: sha ? { sha, at, subject } : null, github: githubUrl(remote), live };
}
/** ⋯ Reveal in Finder: the building's folder, nothing else. */
export function revealBuilding(postcode: unknown): Promise<{ ok: boolean; status: number; error?: string }> {
  const hit = buildingDir(postcode);
  if (!hit) return Promise.resolve({ ok: false, status: 404, error: "not a building on this machine" });
  const [cmd, ...args] = process.env.AB_OPEN_APP ? [process.env.AB_OPEN_APP, "-R"] : ["open", "-R"];
  return new Promise((resolve) => execFile(cmd, [...args, hit.dir], { timeout: 10_000 }, (err) => resolve(err ? { ok: false, status: 500, error: "could not reveal it" } : { ok: true, status: 200 })));
}
