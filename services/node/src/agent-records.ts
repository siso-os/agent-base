// t-0562 (Shaan, 8 Oct ~23:10: "how do we make the back end link so you as agent 0 can actually control this and it actually
// works"): one record per agent. The registry holds identity and placement, the host files live runtime, the owner cards what
// an owner says about itself; this reconciles the three on every read, so `agent list` and the side nav read one thing.
// Placement is set, never guessed: a live agent with no entry is recorded as unplaced (the nav's Playground) until Agent Zero
// places it. Dead host files that a live record shadows are archived, not left behind.
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

export type Who = Record<string, any>;
export type LiveRow = Record<string, any> & { name: string };
export type Card = Record<string, any> & { name: string };
export type AgentState = "working" | "needs" | "idle" | "offline";
export type AgentRecord = {
  id: string; name: string; label: string | null; project: string | null; owner: string | null; kind: "owner" | "worker" | null;
  workspace: string | null; machine: string; harness: string | null; model: string | null; login: string | null;
  compactAt: number | null; mode: string | null; summary: string | null; needsYou: string[]; links: string[];
  state: AgentState; live: boolean; runtime: { pid: number | null; port: number | null; state: string | null } | null;
  placed: "set" | "unplaced" | "auto"; conflicts: string[];
};

const key = (name: unknown) => typeof name === "string" ? name.trim().toUpperCase() : "";
const str = (v: unknown) => typeof v === "string" && v.trim() ? v.trim() : null;
const strings = (v: unknown) => Array.isArray(v) ? v.map(str).filter((s): s is string => !!s).slice(0, 20) : [];
/** "Mac mini", "mini" and "MINI" are one machine. */
const machineOf = (v: unknown) => { const s = str(v); return s ? s.toLowerCase().replace(/^mac\s+/, "") : null; };
/** Rows that are views of something else: his Codex desktop threads and Agent Zero's own seat. */
const isView = (r: LiveRow) => String(r.key ?? "").startsWith("codexapp/") || !!r.zero;
/** A herdr pane runs; a pane-less host row runs only while its host does (a down host keeps a row so its chat stays readable). */
const running = (r: LiveRow) => !!r.pane || !r.host || ["live", "asleep", "restarting"].includes(r.host.state);

export function reconcile(input: { registry: Record<string, Who>; rows: LiveRow[]; cards: Card[]; machine: string }): { records: AgentRecord[]; stale: number } {
  const byKey = new Map<string, [string, Who]>();
  for (const [name, who] of Object.entries(input.registry)) if (who && typeof who === "object" && !byKey.has(key(name))) byKey.set(key(name), [name, who]);
  const cards = new Map(input.cards.map(c => [key(c.name), c]));
  // One name has one live record: a working row beats an idle one, a row with a host beats one without.
  const live = new Map<string, LiveRow>();
  const rank = (r: LiveRow) => (r.status === "working" ? 2 : 0) + (r.host ? 1 : 0);
  for (const r of input.rows) if (!isView(r) && running(r) && key(r.name)) { const k = key(r.name), had = live.get(k); if (!had || rank(r) > rank(had)) live.set(k, r); }
  const ids = new Set([...live.keys(), ...[...byKey].filter(([, [, who]]) => who.kind === "owner").map(([k]) => k)]);
  const stale = [...byKey.keys()].filter(k => !ids.has(k)).length;
  const records = [...ids].map((id): AgentRecord => {
    const row = live.get(id), [regName, who] = byKey.get(id) ?? [null, {} as Who], card = cards.get(id);
    const conflicts: string[] = [];
    // The live row is where the process actually runs; the registry and the card are claims about it.
    const seen = machineOf(row?.away ? row.machineKey : row ? input.machine : null), claimed = machineOf(who.machine), carded = machineOf(card?.machine);
    for (const [label, v] of [["registry", claimed], ["card", carded]] as const) if (seen && v && v !== seen) conflicts.push(`${label} says ${v}, it runs on ${seen}`);
    const status = row?.status === "working" ? "working" : row?.status === "needs" ? "needs" : row ? "idle" : "offline";
    const host = row?.host;
    return {
      id, name: regName ?? row!.name, label: str(who.label) ?? str(who.role), project: str(who.project), owner: str(who.owner) ?? str(row?.hostParent),
      kind: who.kind === "owner" || who.kind === "worker" ? who.kind : null, workspace: str(who.workspace),
      machine: seen ?? claimed ?? carded ?? machineOf(input.machine)!, harness: str(who.harness) ?? str(host?.conversationHarness) ?? str(row?.tool) ?? str(row?.agent),
      model: str(host?.model) ?? str(who.model) ?? str(card?.model), login: str(who.login), compactAt: typeof who.compactAt === "number" ? who.compactAt : null,
      mode: str(who.mode), summary: str(card?.summary), needsYou: strings(card?.needsYou ?? card?.asks), links: strings(card?.links ?? (card?.page ? [card.page] : [])),
      state: status, live: !!row, runtime: host ? { pid: host.pid ?? null, port: host.port ?? null, state: host.state ?? null } : null,
      placed: row?.hostParent && !who.project ? "set" : who.placed === "unplaced" || (!who.project && !who.owner && !who.workspace && !who.main) ? "unplaced" : who.placed === "auto" ? "auto" : "set",
      conflicts,
    };
  }).sort((a, b) => Number(b.live) - Number(a.live) || a.id.localeCompare(b.id));
  return { records, stale };
}

/**
 * A running agent with no entry gets one, unplaced: never filed under an owner by itself. A row whose host names the agent
 * that started it (`hostParent`) is already placed by that spawner and needs no entry. Returns the names it recorded.
 */
export function recordUnplaced(registry: Record<string, Who>, rows: LiveRow[], now = Date.now()): string[] {
  const known = new Set(Object.keys(registry).map(key));
  const added: string[] = [];
  for (const r of rows) if (!isView(r) && running(r) && !r.hostParent && key(r.name) && !known.has(key(r.name))) {
    registry[r.name] = { placed: "unplaced", seen: new Date(now).toISOString() };
    known.add(key(r.name)); added.push(r.name);
  }
  return added;
}

/**
 * What the side nav draws, read from the records (spec point 5): a running agent nobody placed is an owner in Playground, a
 * helper is a +N on its owner's face (Agent Zero's too) rather than a row, and an owner whose host stopped reads offline,
 * not idle. Stamps the rows in place; card words are not needed for this, so no files are read.
 */
export function navFromRecords(all: LiveRow[], registry: Record<string, Who>, machine: string): void {
  // A codex-run job's row has no pane and no host, so it would read as running; its card and fold already show it (9 Oct: 180
  // finished jobs landed in Playground). Only rows that are agents count.
  const rows = all.filter(r => !r.codexWorker);
  const { records } = reconcile({ registry, rows, cards: [], machine });
  const byId = new Map(records.map(r => [r.id, r]));
  const rowOwners = new Set(rows.filter(r => r.navOwner).map(r => key(r.name)));
  const helpers = new Map<string, number>();
  for (const r of records) if (r.live && r.owner && r.kind !== "owner" && !rowOwners.has(r.id)) helpers.set(key(r.owner), (helpers.get(key(r.owner)) ?? 0) + 1);
  for (const row of rows) {
    const n = helpers.get(key(row.name)), rec = byId.get(key(row.name));
    if (n) row.navHelpers = n;
    if (!rec || isView(row)) continue;
    // Only what recordUnplaced wrote: a running agent with an "unplaced" entry, never a row that merely lacks one.
    const who = registry[rec.name] ?? {};
    if (rec.live && rec.placed === "unplaced" && who.placed === "unplaced" && (!!row.pane || ["live", "asleep", "restarting"].includes(row.host?.state))) row.navOwner = true;
    if (row.navOwner && !rec.live) row.navOffline = true;
  }
}

/**
 * Host files the resolver set aside (an older dead copy of a live or newer record), dead for 10 minutes, move to the archive.
 * So does a codex helper's own file (it names its lead) a day after its process died: its job is over, and its row would sit
 * in the Agents list for good. An owner's file is never archived this way, read from the registry, not the file: Agent Zero
 * starts owners too, so FAHMY's file names a lead (9 Oct: it was archived and restored). A stopped owner keeps its place.
 */
export function archiveShadowed(dir: string, kept: Set<string>, options: { archive?: string; now?: number; alive?: (pid: number) => boolean; registry?: Record<string, Who> } = {}): string[] {
  const owners = new Set(Object.entries(options.registry ?? {}).filter(([, w]) => w?.kind === "owner" || w?.main === true).map(([n]) => key(n)));
  const now = options.now ?? Date.now();
  const alive = options.alive ?? ((pid: number) => { try { process.kill(pid, 0); return true; } catch (e) { return (e as NodeJS.ErrnoException).code === "EPERM"; } });
  const archive = options.archive ?? path.join(path.dirname(dir), "hosts-archive", new Date(now).toISOString().slice(0, 10));
  let files: string[]; try { files = readdirSync(dir).filter(f => f.endsWith(".json") && !f.startsWith("remote-")); } catch { return []; }
  const moved: string[] = [];
  for (const f of files) {
    const full = path.join(dir, f);
    try {
      const age = now - statSync(full).mtimeMs;
      if (age < 10 * 60_000) continue;
      const raw = JSON.parse(readFileSync(full, "utf8"));
      if (kept.has(full) && !(age > 24 * 3600_000 && raw?.harness === "codex" && (str(raw.lead) || str(raw.parentName)) && options.registry && !owners.has(key(raw.name)))) continue;
      if (!Number.isInteger(raw?.pid) || alive(raw.pid) || Number.isInteger(raw?.runnerPid) && alive(raw.runnerPid)) continue;
      mkdirSync(archive, { recursive: true });
      renameSync(full, path.join(archive, f)); moved.push(f);
    } catch { /* unreadable or raced: leave it */ }
  }
  return moved;
}

export const ownersDir = () => process.env.AB_OWNERS_DIR ?? path.join(homedir(), ".local/state/a0/owners");
const cardFile = (dir: string, name: string) => path.join(dir, `${name.replaceAll("/", "--")}.json`);
const CARD_NAME = /^[A-Za-z0-9][A-Za-z0-9_.-]*(?:\/[A-Za-z0-9][A-Za-z0-9_.-]*)?$/;

export function readCards(dir = ownersDir()): Card[] {
  let files: string[]; try { files = readdirSync(dir).filter(f => f.endsWith(".json") && !f.startsWith("_")).slice(0, 400); } catch { return []; }
  return files.flatMap(f => { try { const c = JSON.parse(readFileSync(path.join(dir, f), "utf8")); return c && typeof c.name === "string" ? [c as Card] : []; } catch { return []; } });
}

/** An owner's own words on its card (summary, needs-you, links), merged into the file it already has, written whole. */
export function writeCard(name: string, fields: { summary?: string; needsYou?: string[]; links?: string[] }, options: { dir?: string; title?: string; now?: number } = {}): string | null {
  if (!CARD_NAME.test(name)) return "that name cannot have a card";
  const dir = options.dir ?? ownersDir(), file = cardFile(dir, name);
  let card: Card = { name, title: options.title || name };
  if (existsSync(file)) { try { card = JSON.parse(readFileSync(file, "utf8")); } catch { return "the card on disk is unreadable; not overwriting it"; } }
  if (fields.summary !== undefined) card.summary = fields.summary.slice(0, 2000);
  if (fields.needsYou !== undefined) card.needsYou = fields.needsYou.map(s => s.slice(0, 500)).slice(0, 20);
  if (fields.links !== undefined) card.links = fields.links.slice(0, 20);
  card.updated = new Date(options.now ?? Date.now()).toISOString();
  mkdirSync(dir, { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(card, null, 2)}\n`); renameSync(tmp, file);
  return null;
}
