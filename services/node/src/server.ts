import { claudeAccountId } from "./claude-accounts.ts";
import { serveAsleepChat } from './sleep-chat.ts';
import { parseConversationChatTarget, matchesConversationTarget, type ConversationPinTarget } from "./conversation-route.ts";
import { builtinRoutes } from "./routes/builtin.ts";
import { startSupervisedClaude, resumeSupervisedSession, confirmSupervisedResume, configuredClaudeProfile, receiptClaudeProfile } from "./claude-service-lifecycle.ts";
import { configDir as supervisedConfigDir } from "../../host/src/service.ts";
import { seedWorkspaces, editWorkspace, type Workspace } from "./workspace-registry.ts";
import { editAgentPins, isPinEdit, normalizePinRefs, renameAgentPins, type AgentPin, type PinRow } from "./agent-pins.ts";
import { MAIN_NAMES } from "./agent-nav.ts";
import { claudeUsageDirs } from "./tokens.ts";
import { claudeUsage, defaultClaudeDir, usageHud } from "./claude-usage.ts";
/**
 * The laptop node: the one process that talks to herdr for the window.
 *
 * It answers these and nothing else:
 *   GET  /api/agents          every agent herdr knows, with a status word, how long it has held it, and context %
 *   GET  /api/agents/:id/read the agent's recent terminal text (for its page)
 *   POST /api/agents/:id/{settle,unsettle,snooze?until=ms,unsnooze,seen}  what Shaan did to the row (kept by machine + name)
 *   POST /api/order {ids}     his own order of the rows, dragged in the sidebar (terminal ids in, kept by machine + name)
 *   POST /api/agents/start {name,project?,cwd?,prompt?,model?} a new agent in its own herdr tab, under siso-host
 *                          {say} instead: his words alone; the node names it and finds its project (t-0139)
 *   GET  /api/ended           agents that left herdr, newest first (R1.25); WS /ended/:id/ws reads one's chat back
 *   POST /api/registry {op,…} the agent table: who an agent is (domain, lead, role), his pins, saved pages
 *   GET  /api/voice/*         SISO Voice's history and stats, read-only (voice.ts)
 *   POST /api/voice/transcribe the chat mic's recording to text through Groq, with SISO Voice's key (voice-transcribe.ts)
 *   GET  /api/machines        every machine on the estate map, and which one this node's herdr runs on
 *   GET  /api/agents/:id/stats the chat's totals from its own Claude session file (tokens, cache, tools, skills, sub-agents)
 *   WS   /term/:terminalId/ws one live terminal, attached with `herdr terminal attach --takeover`
 *   WS   /shell/:id/ws        a plain login shell on this machine (the new-tab page's Terminal); ends with its socket
 *   WS   /chat/:terminalId/ws the live chat of an agent run by siso-host (services/host), passed through to its socket;
 *                             for an agent in the plain terminal, its chat read from its Claude session file (transcript.ts),
 *                             with what is typed sent to its pane
 *
 * Sockets accept only the app's own origin (this node's address, or AB_ALLOWED_ORIGINS): a browser lets any web page
 * open a WebSocket to 127.0.0.1, and these sockets type into agents and shells.
 *
 * The terminal socket speaks ttyd's framing (one command byte, then the payload) so the terminal
 * view lifted from the Labs fork works unchanged: client '0'+input, '1'+{columns,rows}; server
 * '0'+output. The first client message is the JSON handshake {columns, rows}.
 *
 * Every herdr call goes through AB_HERDR, a command prefix. The real app leaves it at `herdr`.
 * Tests point it at an isolated fixture because an attached view resizes the agent's terminal for every viewer (test 1), so tests must
 * never attach to live agents.
 */
import { execFile, spawn } from "node:child_process";
import { monitorEventLoopDelay } from "node:perf_hooks";
const eventLoopDelay = monitorEventLoopDelay({ resolution: 20 });
eventLoopDelay.enable();
setInterval(() => {
  console.log(JSON.stringify({ event: "event-loop-delay", p99Ms: +(eventLoopDelay.percentile(99) / 1e6).toFixed(2), maxMs: +(eventLoopDelay.max / 1e6).toFixed(2) }));
  eventLoopDelay.reset();
}, 60_000).unref();
import { appendFileSync, copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, createReadStream, writeFileSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { sendJson } from "./http-json.ts";
import { brotliCompressSync, createBrotliCompress, createGzip, constants as zlibConstants, gzipSync } from "node:zlib";
import http from "node:http";
import { open } from "node:fs/promises";
import { setImmediate as yieldIO } from "node:timers/promises";
import type { LaunchAdapters } from "./agent-launch.ts";
import { stopPreparations, getWorkspace, snapshot, WorkspaceError } from "./worktrees.ts";
import { uploadPath } from "../../host/src/uploads.ts";
import { homedir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import pty from "node-pty";
import { WebSocket, WebSocketServer } from "ws";
import { createSpaces } from "./spaces.ts";
import { warmServers } from "./servers.ts";
import { codexWorkerRows, roleLedger } from "./codex-workers.ts";
import { createRemoteInventory, remoteTargets } from "./remote-inventory.ts";
import { createDeliveryReader } from "./delight.ts";
import { createTaskActionsHandler } from "./task-actions.ts";
import { currentResourceAdmission } from "./resource-admission.ts";
import { ActivityCollector } from "./activity.ts";
import { jsonStore } from "./store.ts";
import { tokensTodayUsd } from "./tokens.ts";
import { listSubagents, subagentEvents } from "./subagents.ts";
import { readCodexRuns, runThread } from "./codex-runs.ts";
import { forkPoint } from "./context-mix.ts";
import { createA0Transcript } from "./a0-transcript.ts";
import { chatWindow, olderPage, sessionFile, transcriptOf, type ChatEv } from "./transcript.ts";
import { whatsappConfig } from "./whatsapp.ts";
import { lifeConfig } from "./life.ts";
import { setTodayCost } from "./spend.ts";
import { setAutomaticNotifications } from "./notifications.ts";
import { gitSha, readVersion, shouldRestart } from "./version.ts";
import { createA0TaskWriter, createA0TasksEvents, createA0TasksHandler } from "./a0-tasks.ts";
import { sessionFile as codexSessionFile, transcriptOf as codexTranscriptOf } from "./codex-transcript.ts";
import { buildOrg, migrate as orgMigrate, readers as orgReaders, seedProjects, type Project as OrgProj } from "./org.ts";
import { recoverOwnership } from "./dictation-owner.ts";
import { listServiceHosts, bindServiceRows } from "./service-hosts.ts";
import { recordUnplaced } from "./agent-records.ts";
import { codexAppRow, codexAppThread, codexAppThreads } from "./codex-app.ts";
import { createChangesService } from "./changes.ts";
import { sendDeliveredChat, type ChatDeliveryIdentity } from "./review-delivery.ts";
import { invalidateReviewsCache } from "./reviews.ts";
import { startVoiceWatch } from "./voice-health.ts";
import { dictationSettled } from "./dictation.ts";
import { seatHud, type SeatLimits } from "./seat-hud.ts";
import { ICON_NAMES, type IconName } from "../../../apps/web/src/lib/icon-names.ts";
import { dispatchRoute, loadRoutes } from "./routes/registry.ts";

const run = promisify(execFile);

/**
 * Opened from the Dock, Finder or at login, macOS gives an app only /usr/bin:/bin:/usr/sbin:/sbin, so `herdr` (in
 * ~/.local/bin) was not found and every agent showed "disconnected" (2 Oct, 12:06). The places his tools live go first.
 */
process.env.PATH = [path.join(homedir(), ".local/bin"), "/opt/homebrew/bin", "/usr/local/bin", ...(process.env.PATH ?? "").split(":")]
  .filter((d, i, all) => d && all.indexOf(d) === i)
  .join(":");
const PORT = Number(process.env.AB_PORT ?? 5401);
// The port the window and the hosts reach: 5401, the front (services/front), when this node runs in a release slot (t-0539).
const PUBLIC_PORT = Number(process.env.AB_PUBLIC_PORT ?? PORT);
const HOST = process.env.AB_HOST ?? "127.0.0.1";
const HERDR = (process.env.AB_HERDR ?? "herdr").split(" ").filter(Boolean);
const CTX_DIR = process.env.AB_CTX_DIR ?? path.join(homedir(), ".local/state/context-ping/ctx");
// Resolved, so a path given with ".." (the desktop app passes one) still matches the files it serves.
const WEB_DIST = path.resolve(process.env.AB_WEB_DIST ?? path.join(import.meta.dirname, "../../../apps/web/dist"));
const MACHINE = process.env.AB_MACHINE ?? "MB";
/** This node's machine on the estate map (SISO_Agents/siso-estate/plan/machines.json), and that file. */
const MACHINE_KEY = process.env.AB_MACHINE_KEY ?? "laptop";
const MACHINES_FILE = process.env.AB_MACHINES_FILE ?? path.join(homedir(), "SISO_Workspace/SISO_Agents/siso-estate/plan/machines.json");
const STATE_FILE = process.env.AB_STATE ?? path.join(homedir(), ".local/state/agent-base/rows.json");
/** t-0265: the open agent's every change (POST /api/selection), one JSON line each, beside the row state. */
const SELECTION_LOG = path.join(path.dirname(STATE_FILE), "selection.jsonl");
/**
 * Agents that left herdr (R1.25, Shaan: "when the agent gets spun down it's tracked somewhere"): one JSON line each,
 * appended when its terminal goes from herdr's list for good (no other terminal took its row over).
 */
const ENDED_FILE = process.env.AB_ENDED ?? path.join(path.dirname(STATE_FILE), "ended.jsonl");
type Ended = { id: string; name: string; pane: string; terminal: string; session: string | null; cwd: string; project: string | null; tool: string; started: number; ended: number; status: string; task: string; machine: string };
/** herdr-resurrect's snapshots of every pane (terminal id, title, cwd): used once to move old rows.json entries to names. */
const RESURRECT_DIR = process.env.AB_RESURRECT_DIR ?? path.join(homedir(), ".local/state/herdr-resurrect");
const REGISTRY_FILE = process.env.AB_REGISTRY ?? path.join(homedir(), ".local/state/agent-base/registry.json");
/** The browser's address-bar suggestions, built from his Chrome and Arc history on import (browser-import.ts). */
const BROWSER_STATE = process.env.AB_BROWSER_STATE ?? path.join(homedir(), ".local/state/agent-base/browser.json");
const BROWSER_HISTORY = process.env.AB_BROWSER_HISTORY ?? path.join(homedir(), ".local/state/agent-base/browser-history.json");
/** The SISO console's event log, read only: every page an agent posted carries its name and Claude session. */
const CONSOLE_EVENTS = process.env.AB_CONSOLE_EVENTS ?? path.join(homedir(), ".claude/console/state/events.jsonl");
const CONSOLE_URL = process.env.AB_CONSOLE_URL ?? "http://127.0.0.1:8891";
/** Route modules (routes/*.route.ts, from luna/ab-reg): tried after every built-in route, before the 404. */
const ROUTES = await loadRoutes(process.env.AB_ROUTES_DIR ?? path.join(import.meta.dirname, "routes"));
/** Where siso-host writes one file per running chat (its pane, port, token, session, name). */
const HOSTS_DIR = process.env.AB_HOSTS_DIR ?? path.join(homedir(), ".local/state/agent-base/hosts");
/** Images he pastes or drops into a chat: saved here, sent to the agent as a path (CLI) or an image block (siso-host). */
const UPLOADS = process.env.AB_UPLOADS ?? path.join(homedir(), ".local/state/agent-base/uploads");
const IMAGE_EXT: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/webp": "webp" };

/** herdr's own pane identity must not leak into what we spawn: it would point the child at this pane. */
const childEnv = (() => {
  const env: Record<string, string> = { ...process.env } as Record<string, string>;
  for (const k of ["HERDR_ENV", "HERDR_PANE_ID", "HERDR_TAB_ID", "HERDR_WORKSPACE_ID"]) delete env[k];
  env.TERM = "xterm-256color";
  return env;
})();

async function herdr(args: string[]): Promise<string> {
  const { stdout } = await run(HERDR[0], [...HERDR.slice(1), ...args], { env: childEnv, maxBuffer: 8 << 20, timeout: 8000 });
  return stdout;
}

// ---------------------------------------------------------------- agents

type HerdrAgent = {
  agent: string;
  agent_status: string;
  cwd: string;
  name?: string;
  pane_id: string;
  terminal_id: string;
  terminal_title_stripped?: string;
  agent_session?: { value?: string };
  workspace_id?: string;
};

/** One word per state, the vocabulary on screen ◐. herdr reports working, idle, done, blocked. */
const WORD: Record<string, "working" | "needs" | "done" | "idle" | "failed"> = {
  working: "working",
  blocked: "needs",
  waiting: "needs",
  done: "done",
  idle: "idle",
  failed: "failed",
  error: "failed",
};

/**
 * When each agent entered its current state: the timer in "Working 17m", by row key. Kept in the state file with the
 * rows, so a restart of the node, the app or herdr does not reset every timer to zero.
 */
const since = new Map<string, { status: string; at: number }>();
/** terminal id -> row key ("laptop/STREAMING-CLAUDE") from the last list: the app speaks terminal ids, the state is kept by key. */
const keyOf = new Map<string, string>();
/** terminal id -> pane id from the last list. `herdr agent read` takes a pane, and pane ids move when panes do. */
const paneOf = new Map<string, string>();
/** Terminal id to its Claude session id, as herdr last reported it. */
const sessionOf = new Map<string, string>();
/** Terminal id to its folder, name and status word from the last list (for chats read from session files). */
const cwdOf = new Map<string, string>();
const nameOf = new Map<string, string>();
const statusOf = new Map<string, string>();
/**
 * A terminal that went away -> the live terminal now holding its row (ab-151): Agent Zero's next session, say. A chat
 * still open on the old id is told it moved, and nothing is ever typed into a pane whose agent is gone.
 */
const successor = new Map<string, string>();
/**
 * The rows (base keys) each terminal held lately, with when: an agent's title changes as it exits, so its last key is
 * not its row. Only rows held in the last two minutes count for an heir (QA P0-1, A0 3 Oct; t-0265): a set that kept
 * every row ever held let a herdr blip hand a long-dead row to EFFICIENCY, and the open chats followed it.
 */
const rowsHeld = new Map<string, Map<string, number>>();
const HEIR_WINDOW_MS = 2 * 60_000;
/** Terminal id to its harness (claude, codex, siso) from the last list. */
const toolOf = new Map<string, string>();
/**
 * A Codex thread's session file (T8, ab-126). codex-transcript.ts walks ~/.codex/sessions on a miss and does not
 * cache misses (a new thread may not have written yet); the agent list asks every 1.5 s, so a miss is remembered 30 s.
 */
const codexMiss = new Map<string, number>();
function codexFile(session: string): string | null {
  if ((codexMiss.get(session) ?? 0) > Date.now()) return null;
  const f = codexSessionFile(session);
  if (!f) codexMiss.set(session, Date.now() + 30_000);
  return f;
}

/**
 * The agent's own Claude HUD, per session: the file siso-hud.mjs writes on every footer refresh
 * (~/.local/state/context-ping/ctx/<session>.json). Context and tokens are always there; model, cost and the 5-hour
 * and weekly limits are there once the HUD has refreshed since 2 Oct 01:50 (R-0009). Missing pieces stay null.
 */
type Hud = {
  accountId?: string | null;
  models?: { id: string; label: string; description: string; efforts: string[] }[];
  context: number | null;
  model: string | null;
  tokensIn: number | null;
  tokensOut: number | null;
  cachePct: number | null;
  costUsd: number | null;
  fiveHour: { pct: number; resetsAt: number | null } | null;
  week: { pct: number; resetsAt: number | null } | null;
  at: number | null;
  /** An SDK seat's effort (its host file), for the model picker. */
  effort?: string | null;
  limitsAt?: number | null;
  limitsStale?: boolean;
};
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
/** Claude Code gives resets_at as epoch seconds; accept ms or an ISO string too. */
const when = (v: unknown) => (typeof v === "number" ? (v < 1e12 ? v * 1000 : v) : typeof v === "string" && !Number.isNaN(Date.parse(v)) ? Date.parse(v) : null);
const limit = (l: any) => (l && num(l.used_percentage) !== null ? { pct: Math.round(l.used_percentage), resetsAt: when(l.resets_at) } : null);

function readHud(session?: string): Hud | null {
  if (!session) return null;
  try {
    const data = JSON.parse(readFileSync(path.join(CTX_DIR, `${session.replace(/[^A-Za-z0-9_-]/g, "_")}.json`), "utf8"));
    const hud = hudFrom(data)!;
    const accountId = claudeAccountId(data.profile);
    return { ...(accountId && accountId !== 'claude-fahmy' ? usageHud(hud, data.profile) : hud), accountId };
  } catch {
    return null;
  }
}
/** An SDK seat combines session context/tokens with the host's timestamped SDK account limits. */
function hostHud(host: Host | undefined, session?: string): Hud | null {
  const hud = hostHudLocal(host, session) ?? { context: null, model: host?.model ?? null, tokensIn: null, tokensOut: null, cachePct: null, costUsd: null, fiveHour: null, week: null, at: null };
  const accountId = claudeAccountId(host?.configDir);
  return { ...(accountId && accountId !== 'claude-fahmy' ? usageHud(hud, host!.configDir!) : hud), accountId, models: Array.isArray(host?.models) ? host.models : [] };
}
function hostHudLocal(host: Host | undefined, session?: string): Hud | null {
  const file = host && session ? sessionFile(session, host.cwd) : null;
  const d = file ? seatHud(file, CTX_DIR, host?.model, host?.rateLimits, { background: true }) : null;
  const hud = d ? hudFrom(d) : null;
  // a0-018: the host's own gauge (its file's `ctx`) knows the window it is measured on, so it wins over the estimate.
  const c = host?.ctx;
  if (!host) return hud;
  if (hud) hud.effort = host.effort ?? null;
  if (typeof c?.pct !== "number") return { effort: host.effort ?? null, context: hud?.context ?? null, at: hud?.at ?? null, tokensIn: null, tokensOut: null, cachePct: null, costUsd: null, fiveHour: null, week: null, ...hud, model: host.model ?? hud?.model ?? null };
  const none = { model: host.model ?? null, tokensIn: null, tokensOut: null, cachePct: null, costUsd: null, fiveHour: null, week: null };
  return { ...none, ...hud, model: host.model ?? hud?.model ?? null, effort: host.effort ?? null, context: c.pct, at: hud?.at ?? num(c.at) };
}
function hudFrom(d: any): Hud | null {
  {
    const u = d.current_usage ?? {};
    const read = num(u.cache_read_input_tokens) ?? 0;
    const all = read + (num(u.cache_creation_input_tokens) ?? 0) + (num(u.input_tokens) ?? 0);
    return {
      context: num(d.used_percentage) === null ? null : Math.round(d.used_percentage),
      model: d.model?.display_name ?? d.model?.id ?? null,
      tokensIn: num(d.total_input_tokens),
      tokensOut: num(d.total_output_tokens),
      cachePct: all > 0 ? Math.round((read / all) * 100) : null,
      costUsd: num(d.cost?.total_cost_usd),
      fiveHour: limit(d.rate_limits?.five_hour),
      week: limit(d.rate_limits?.seven_day),
      at: num(d.rate_limits?.at) ?? num(d.at),
    };
  }
}

/**
 * What Shaan did to each row, kept by this node so every window agrees: Settled (the dimmed shelf), Snoozed until a
 * time, when he last opened it (Done stays green until then), and his drag order. herdr's own state is never written.
 *
 * Keyed by machine and the agent's name ("laptop/STREAMING-CLAUDE"), never by herdr's terminal id: a herdr restart
 * gives every terminal a new id, and on 2 Oct that wiped his settled rows and order. `sessions` remembers each key's
 * Claude session, so an agent whose title changes mid-session (an unnamed chat's title is Claude's summary) keeps its
 * row. Files from before that are moved to names on load from herdr-resurrect's snapshots, then from the live list.
 */
type Rows = {
  settled: Record<string, number>;
  snoozed: Record<string, number>;
  seen: Record<string, number>;
  order: string[];
  since?: Record<string, { status: string; at: number }>;
  sessions: Record<string, string>;
  /** His order of the project folders, dragged in the side nav. */
  projectOrder?: string[];
};
const rowStore = jsonStore<Rows>(STATE_FILE, (d) => ({
  settled: d.settled ?? {},
  snoozed: d.snoozed ?? {},
  seen: d.seen ?? {},
  order: Array.isArray(d.order) ? d.order : [],
  since: d.since ?? {},
  sessions: d.sessions ?? {},
  projectOrder: Array.isArray(d.projectOrder) ? d.projectOrder : [],
}));
const rows = rowStore.data;
/** Picks up a change another writer made to rows.json (store.ts); run before every change. */
function freshRows() {
  if (!rowStore.fresh() && since.size) return;
  since.clear();
  for (const [id, v] of Object.entries(rows.since ?? {})) since.set(id, v);
}
freshRows();

const rowKey = (name: string) => `${MACHINE_KEY}/${name}`;
/** The name a row shows: siso-host's name, herdr's pane name, then the terminal title; Agent Zero by its title or folder. */
/** His names for agents (the agent table's aliases), set once the table is loaded further down. */
let aliasOf = (raw: string) => raw;
/** An unnamed Codex tab in a worktree goes by its lane's registered name (t7-announce → luna-t7-announce), else the lane. */
let laneName = (lane: string) => lane;
/** Agent Zero's keep-alive seat (~/.local/state/a0/seat.json, rewritten on every relay): the one session that is Agent Zero. */
const SEAT = process.env.AB_A0_SEAT ?? path.join(homedir(), ".local/state/a0/seat.json");
let seatAt = -1;
let seat: { session?: string; pane?: string } | null = null;
function a0Seat() {
  try {
    const m = statSync(SEAT).mtimeMs;
    if (m !== seatAt) { seat = JSON.parse(readFileSync(SEAT, "utf8")); seatAt = m; }
  } catch { seat = null; seatAt = -1; }
  return seat;
}
/** The seat, only while a running agent holds it (by session or pane): a stale seat, a relay in flight or a test's fake
 * agents fall back to the folder rule, so there is always an Agent Zero row. */
function liveSeat(agents: HerdrAgent[], sessionOf: (a: HerdrAgent) => string | undefined) {
  const s = a0Seat();
  if (!s?.session && !s?.pane) return null;
  return agents.some((a) => s.session ? sessionOf(a) === s.session : a.pane_id === s.pane) ? s : null;
}
function shownName(a: HerdrAgent, hostName?: string, session?: string, s: ReturnType<typeof a0Seat> = null) {
  const lane = !hostName && !a.name && a.agent === "codex" ? a.cwd.replace(/\\/g, "/").match(/\/worktrees\/[^/]+\/([^/]+)/)?.[1] : undefined;
  const raw = (hostName || a.name || (lane ? laneName(lane) : "") || a.terminal_title_stripped || a.terminal_id).trim();
  // Agent Zero is the seat's session (or pane); every other session in his folder (A0-DESK, say) keeps its own title.
  // No live seat: the old rule, its title or Claude in its folder (a Codex worker started there is not Agent Zero).
  // t-0264: every session of that kind is an Agent Zero (his "A0 CLI" and "A0 app"), the seat's the default one.
  // A Claude session in his folder, or one titled "A0" or "A0 <name>"; "A0-HELPER" and the like are his workers (t-0008).
  const inFolder = a.agent !== "codex" && /\/agent-zero\/(siso-firstmate|siso-agent-zero)$/.test(a.cwd);
  const kind = inFolder || /^A0(\s|$)/i.test(raw);
  const zero = s ? (s.session ? session === s.session : a.pane_id === s.pane) : /^A0\b/.test(raw) || inFolder;
  const own = aliasOf(raw);
  const name = zero ? "Agent Zero" : own;
  return { raw: name, name, zero, a0: (!!s && zero) || kind, own };
}
/**
 * t-0264 (Shaan 2 Oct 15:49: "you could have an agent zero cli and an agent zero thing and i could rename them"): one
 * default Agent Zero, the rest stay Agent Zeros under their own names. With no live seat the folder rule can match several;
 * siso-host's (the app's own chat) wins, then the one titled just A0, then herdr's order.
 */
function oneZero(agents: HerdrAgent[], names: Map<string, ReturnType<typeof shownName>>, hosted: (a: HerdrAgent) => boolean) {
  const zeros = agents.filter((a) => names.get(a.terminal_id)!.zero);
  if (zeros.length < 2) return;
  const keep = zeros.find(hosted) ?? zeros.find((a) => /^A0$/i.test((a.terminal_title_stripped ?? "").trim())) ?? zeros[0];
  for (const a of zeros) {
    if (a === keep) continue;
    const n = names.get(a.terminal_id)!;
    names.set(a.terminal_id, { ...n, raw: n.own, name: n.own, zero: false });
  }
}
const hasRow = (k: string) => k in rows.settled || k in rows.snoozed || k in rows.seen || rows.order.includes(k);
/** Moves one row's state to another key (whatever the new key already holds wins), or drops it when `to` is null. */
function renameRow(from: string, to: string | null) {
  for (const m of [rows.settled, rows.snoozed, rows.seen, rows.sessions]) {
    if (!(from in m)) continue;
    if (to !== null && !(to in m)) m[to] = m[from];
    delete m[from];
  }
  rows.order = rows.order.flatMap((k) => (k !== from ? [k] : to === null ? [] : [to])).filter((k, i, all) => all.indexOf(k) === i);
  const s = since.get(from);
  if (s && to !== null && !since.has(to)) since.set(to, s);
  since.delete(from);
}
const legacyKeys = () =>
  new Set([...Object.keys(rows.settled), ...Object.keys(rows.snoozed), ...Object.keys(rows.seen), ...rows.order, ...since.keys()].filter((k) => k.startsWith("term_")));
/** A rows.json written before names: each terminal id is looked up in the snapshots, newest last so it wins. */
(function migrateFromSnapshots() {
  const legacy = legacyKeys();
  if (!legacy.size) return;
  const found = new Map<string, string>();
  let files: string[] = [];
  try {
    files = readdirSync(RESURRECT_DIR).filter((f) => /^snapshot-.*\.json$/.test(f)).sort();
  } catch {
    /* no snapshots on this machine: the live list moves what it can */
  }
  for (const f of files) {
    try {
      // herdr-resurrect stores `herdr pane list`'s answer ({result: {panes}}); a bare list is accepted too.
      const l = JSON.parse(readFileSync(path.join(RESURRECT_DIR, f), "utf8")).live_pane_list;
      for (const a of (Array.isArray(l) ? l : l?.result?.panes ?? l?.result?.agents ?? []) as HerdrAgent[]) {
        if (legacy.has(a?.terminal_id) && a.cwd) found.set(a.terminal_id, rowKey(shownName(a, undefined, a.agent_session?.value).name));
      }
    } catch {
      /* a half-written snapshot */
    }
  }
  for (const [id, key] of found) renameRow(id, key);
  if (found.size) saveRows();
})();

function saveRows() {
  rows.since = Object.fromEntries(since);
  rowStore.save();
}
/** One action on one row, by its key. Settling clears a snooze and vice versa; a row has one place. */
function act(key: string, action: string, until?: number): boolean {
  freshRows();
  const now = Date.now();
  if (action === "settle") { rows.settled[key] = now; delete rows.snoozed[key]; }
  else if (action === "unsettle") delete rows.settled[key];
  else if (action === "snooze" && typeof until === "number" && until > now) { rows.snoozed[key] = until; delete rows.settled[key]; }
  else if (action === "unsnooze") delete rows.snoozed[key];
  else if (action === "seen") rows.seen[key] = now;
  else return false;
  saveRows();
  return true;
}

// ---------------------------------------------------------------- the agent table

/**
 * Who each agent is, keyed by the name it gives itself (Shaan, 2 Oct: "get them to name themselves … and have a db
 * to track them"): its domain, the lead it works for, its role. Plus what he set: pinned agents, pages saved to an
 * agent, and his own pinned pages. Agent metadata remains name-keyed; pinRefs instead preserve a configured owner
 * slot or a sealed conversation, independently of display names and terminal IDs. Agents write it through
 * POST /api/registry {op:"register"}; Agent Zero places domains; he moves and pins from the side nav.
 */
type Page = { url: string; title: string; at?: number; from?: "saved" | "console" };
/**
 * Projects and owners (projects-owners/SPEC.md, 2 Oct): an agent belongs to a project (HALO, SISO Internal Labs, …),
 * owns a domain in it (an owner) or works for an owner (a worker, hidden from the side nav behind its owner's count).
 */
type Who = { workspace?: string; zero?: boolean; main?: boolean; project?: string; domain?: string; owner?: string; kind?: "owner" | "worker"; role?: string; icon?: IconName; lead?: string; state?: "planned"; slot?: "bottom"; placed?: "auto"; /** Where the app last started it (t-0189), so its seat starts there again. */ cwd?: string; /** Its machine's estate key when not this node's (R1.4). */ machine?: string };
const WHO_KEYS = ["workspace", "zero", "main", "project", "domain", "owner", "kind", "role", "icon", "lead", "state", "slot", "placed", "cwd", "machine"] as const;
const isIconName = (value: unknown): value is IconName => typeof value === "string" && (ICON_NAMES as readonly string[]).includes(value);
function cleanWho(value: unknown): Who {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).filter(([key, field]) => WHO_KEYS.includes(key as (typeof WHO_KEYS)[number]) && (key !== "icon" || isIconName(field)) && (!["main", "zero"].includes(key) || typeof field === "boolean"))) as Who;
}
type Registry = {
  /** The projects (Luna L3's org.ts: id, name, group, path, shown, order); `domains` lists their names for older pages. */
  projects: OrgProj[];
  workspaces: Workspace[];
  domains: string[];
  agents: Record<string, Who>;
  /** Names he gave agents (raw herdr name or title -> his name). */
  aliases: Record<string, string>;
  /** The stub's view of the org before L3 (shown clients, order, names, removed); folded into `projects` on migrate. */
  orgView?: { shown?: string[]; order?: Record<string, string[]>; names?: Record<string, string>; removed?: string[] };
  pinned: string[];
  /** Authoritative ordered references. Absence alone denotes an unmigrated name-only registry. */
  pinRefs?: AgentPin[];
  pages: Record<string, Page[]>;
  pinnedPages: Page[];
  /** Pages he opened in the app, newest first, with how often: the new-tab page's Recents and Suggested. */
  recentPages: (Page & { count: number })[];
  /** Pages he removed from an agent's tabs (console posts cannot be deleted, so they are hidden). */
  hiddenPages: Record<string, string[]>;
  /** t-0264: his name for the default Agent Zero in the switcher ("A0 app"); it stays Agent Zero everywhere else. */
  a0Label?: string;
};
const registryStore = jsonStore<Registry>(REGISTRY_FILE, (d) => migrateRegistry({
  projects: [],
  workspaces: [],
  domains: [],
  agents: {},
  aliases: {},
  pinned: [],
  pages: {},
  pinnedPages: [],
  recentPages: [],
  hiddenPages: {},
  ...(d && typeof d === "object" && !Array.isArray(d) ? d : {}),
}));
/**
 * The table before projects: `domain` held "HALO · Streaming" and `lead` the agent's lead. Split into project and
 * domain; a lead becomes the owner of a worker; the rest are owners. Runs on every load; a no-op once done.
 */
function migrateRegistry(r: Registry): Registry {
  r.workspaces = seedWorkspaces(r.workspaces);
  if (Object.hasOwn(r, 'pinRefs')) r.pinRefs = normalizePinRefs(r.pinRefs);
  r.agents = Object.fromEntries(Object.entries(r.agents).map(([name, who]) => [name, cleanWho(who)]));
  for (const [name, who] of Object.entries(r.agents)) {
    if (who.main === undefined) who.main = MAIN_NAMES.includes(name.toUpperCase());
    if (who.domain && !who.project) {
      const [project, ...rest] = who.domain.split(" · ");
      who.project = project.trim();
      who.domain = rest.join(" · ").trim() || undefined;
    }
    if (who.lead && !who.owner) who.owner = who.lead;
    delete who.lead;
    if (!who.kind && who.project) who.kind = who.owner ? "worker" : "owner";
  }
  const names = () => (r.projects as unknown[]).map((p) => (typeof p === "string" ? p : (p as OrgProj)?.name)).filter(Boolean) as string[];
  if (!r.projects.length) (r.projects as unknown[]) = [...new Set(r.domains.map((d) => d.split(" · ")[0].trim()))];
  if ((r.projects as unknown[]).some((p) => typeof p === "string")) {
    // The three-group model (L3's migrate): once, after a backup of the file as it was.
    for (const who of Object.values(r.agents)) if (who.project && !names().includes(who.project)) (r.projects as unknown[]).push(who.project);
    const bak = `${REGISTRY_FILE}.bak-${new Date().toISOString().slice(0, 10)}-before-l3`;
    try {
      if (existsSync(REGISTRY_FILE) && !existsSync(bak)) copyFileSync(REGISTRY_FILE, bak);
    } catch {
      /* a backup is a convenience */
    }
    r = orgMigrate(r) as Registry;
    seedOrg(r);
  }
  for (const who of Object.values(r.agents)) if (who.project && !r.projects.some((p) => p.name === who.project)) addProject(r, who.project);
  // Projects he named on 3 Oct (Maths Innovations, Property, Trading for Dad): once, remembered in `seeded`.
  seedProjects(r);
  r.domains = [...r.projects].sort((a, b) => a.order - b.order).map((p) => p.name);
  return r;
}
// Function declarations, not consts: the table migrates while this module is still loading.
function slugOf(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}
/** Where each known project's plans and reports live (its folder on the estate). */
function projectPath(name: string): string | undefined {
  return ({
    HALO: "SISO_Agency/partners/halo",
    "Fahmy's agency": "SISO_Agency/partners/fahmy",
    "Agent Base": "SISO_Agency/apps/siso-internal-labs/siso-internal-labs-agents",
    Efficiency: "SISO_Agents/siso-harness-lab",
    Estate: "SISO_Agents/siso-estate",
  } as Record<string, string>)[name];
}
function addProject(r: Registry, name: string, extra: Partial<OrgProj> = {}) {
  if (r.projects.some((p) => p.name === name)) return;
  const rel = extra.path ?? projectPath(name);
  r.projects.push({ id: slugOf(name), name, group: name === "HALO" || name === "Fahmy's agency" ? "agency" : "labs", shown: true, order: r.projects.length, ...extra, ...(rel ? { path: path.isAbsolute(rel) ? rel : path.join(homedir(), "SISO_Workspace", rel) } : {}) });
}
/** After the migrate: each project's folder, the owners A0 drew but has not started, and the stub's view folded in. */
function seedOrg(r: Registry) {
  for (const p of r.projects) if (!p.path && projectPath(p.name)) p.path = path.join(homedir(), "SISO_Workspace", projectPath(p.name)!);
  for (const [project, name] of [["Agency base", "AGENCY-BASE"], ["Lifelog", "LIFELOG"]]) {
    addProject(r, project, { group: "labs" });
    r.agents[name] ??= { project, domain: project, kind: "owner", state: "planned" } as Who;
  }
  const v = r.orgView ?? {};
  for (const [group, order] of Object.entries(v.order ?? {})) order.forEach((n, i) => { const p = r.projects.find((x) => x.name === n && x.group === group); if (p) p.order = i; });
  for (const id of v.removed ?? []) r.projects = r.projects.filter((p) => p.name !== id || Object.values(r.agents).some((w) => w.project === id));
  delete r.orgView;
}
const registry = registryStore.data;
// His names first; then the table's own casing for the same name (herdr slugs names to lowercase: efficiency → EFFICIENCY).
// If the same name in another case is an owner while this entry is only a worker, the owner wins (a stale entry).
aliasOf = (raw) => {
  if (registry.aliases?.[raw]) return registry.aliases[raw];
  const variants = Object.keys(registry.agents).filter((k) => k.toLowerCase() === raw.toLowerCase());
  const owner = variants.find((k) => registry.agents[k].kind === "owner");
  if (registry.agents[raw] && (registry.agents[raw].kind === "owner" || !owner)) return raw;
  return owner ?? variants[0] ?? raw;
};
laneName = (lane) => Object.keys(registry.agents).find((k) => k === lane || k.endsWith(`-${lane}`)) ?? lane;
const saveRegistry = () => registryStore.save();
const str = (v: unknown, max = 300) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : undefined);
const isUrl = (v: unknown) => typeof v === "string" && /^https?:\/\/\S+$/.test(v);

/** One change to the table. Returns an error sentence, or null when applied. */
function edit(b: Record<string, unknown>, pinRows?: PinRow[]): string | null {
  registryStore.fresh();
  if (isPinEdit(b.op)) {
    // Inventory was awaited by the route; apply the latest registry membership only after fresh().
    const current = pinRows?.map(row => ({ ...row, workspace: registry.agents[row.name]?.workspace ?? row.workspace, kind: registry.agents[row.name]?.kind ?? row.kind, main: registry.agents[row.name]?.main ?? row.main, zero: !!(row.zero || registry.agents[row.name]?.zero) }));
    const error = editAgentPins(registry, b, current, () => `pin-${randomUUID()}`);
    if (error) return error;
    saveRegistry();
    return null;
  }
  const name = str(b.name, 80);
  const op = b.op;
  if (op === "workspace") {
    const error = editWorkspace(registry.workspaces, b);
    if (error) return error;
  } else if (op === "visit") {
    if (!isUrl(b.url)) return "url must be http(s)";
    const prev = registry.recentPages.find((p) => p.url === b.url);
    registry.recentPages = [
      { url: b.url as string, title: str(b.title, 120) ?? prev?.title ?? (b.url as string), at: Date.now(), count: (prev?.count ?? 0) + 1 },
      ...registry.recentPages.filter((p) => p.url !== b.url),
    ].slice(0, 60);
  } else if (op === "pin-page" || op === "unpin-page") {
    if (!isUrl(b.url)) return "url must be http(s)";
    registry.pinnedPages = registry.pinnedPages.filter((p) => p.url !== b.url);
    if (op === "pin-page") registry.pinnedPages.push({ url: b.url as string, title: str(b.title, 120) ?? (b.url as string) });
  } else if (!name) return "name is required";
  else if (op === "register" || op === "update" || op === "move") {
    if ((op === "register" || op === "update") && b.icon !== undefined && !isIconName(b.icon)) return "icon must be a supported icon name";
    if (b.main !== undefined && typeof b.main !== "boolean") return "main must be boolean";
    if (b.zero !== undefined && typeof b.zero !== "boolean") return "zero must be boolean";
    if (b.workspace !== undefined && (typeof b.workspace !== 'string' || !registry.workspaces.some(w => w.id === b.workspace))) return 'unknown workspace';
    const cur = (registry.agents[name] ??= { main: MAIN_NAMES.includes(name.toUpperCase()) });
    if (typeof b.workspace === "string") cur.workspace = b.workspace;
    if (typeof b.zero === "boolean") cur.zero = b.zero;
    if (typeof b.main === "boolean") cur.main = b.main;
    // `domain` as "Project · Domain" (the old form) is still understood.
    let project = str(b.project, 60);
    let domain = str(b.domain, 80);
    if (!project && domain?.includes(" · ")) [project, domain] = [domain.split(" · ")[0].trim(), domain.split(" · ").slice(1).join(" · ").trim()];
    if (!project && op === "move") project = domain;
    if (project) {
      cur.project = project;
      addProject(registry, project);
      registry.domains = [...registry.projects].sort((a, b) => a.order - b.order).map((p) => p.name);
    } else if (op === "move") return "project is required";
    if ((op === "register" || op === "update") && domain !== undefined) cur.domain = domain;
    if (op === "register" || op === "update") {
      const owner = b.owner !== undefined ? str(b.owner, 80) : b.lead !== undefined ? str(b.lead, 80) : cur.owner;
      cur.owner = owner || undefined;
      if (b.lead !== undefined) cur.lead = str(b.lead, 80) || undefined;
      cur.kind = b.kind === "owner" || b.kind === "worker" ? b.kind : cur.owner ? "worker" : "owner";
      if (b.role !== undefined) cur.role = str(b.role, 200);
      if (isIconName(b.icon)) cur.icon = b.icon;
    }
  } else if (op === "rename") {
    // His name for an agent (2 Oct 14:38: "rename by clicking the name"): what it is listed by, its table entry, pins,
    // pages and row state all follow.
    const to = str(b.to, 80);
    if (!to) return "to is required";
    if (to === name) return null;
    // The default Agent Zero keeps its name (its table entry, tasks and pages are filed under it); his name for it is a
    // label in the switcher. "Agent Zero" again clears it.
    if (name.toUpperCase() === "AGENT ZERO") {
      if (to === "Agent Zero") delete registry.a0Label;
      else registry.a0Label = to;
      saveRegistry();
      return null;
    }
    const canonical = (value: string) => value.trim().toUpperCase();
    const configured = registry.workspaces.filter(workspace => typeof workspace.owner === 'string' && canonical(workspace.owner) === canonical(name));
    let from = name;
    if (configured.length) {
      const sources = Object.keys(registry.agents).filter(key => canonical(key) === canonical(name));
      if (sources.length > 1) return "Owner source name is ambiguous";
      from = sources[0] ?? configured[0].owner;
      const occupied = [...Object.keys(registry.agents), ...registry.workspaces.map(workspace => workspace.owner).filter(owner => typeof owner === 'string')];
      if (occupied.some(owner => canonical(owner) === canonical(to) && canonical(owner) !== canonical(from))) return "Owner rename conflicts with an existing configured agent";
    }
    if (from === to) return null;
    const raw = Object.entries(registry.aliases).find(([, v]) => v === from)?.[0] ?? from;
    registry.aliases[raw] = to;
    if (registry.agents[from]) (registry.agents[to] = { ...registry.agents[from], ...registry.agents[to] }), delete registry.agents[from];
    for (const who of Object.values(registry.agents)) if (who.owner === from) who.owner = to;
    renameAgentPins(registry, from, to);
    for (const m of [registry.pages, registry.hiddenPages] as Record<string, unknown>[]) if (m[from]) (m[to] = m[from]), delete m[from];
    renameRow(rowKey(from), rowKey(to));
    saveRows();
  } else if (op === "describe") {
    // His words from an agent's card (t-0269): its role line and its domain; empty clears one. Nothing else moves.
    if (b.role === undefined && b.domain === undefined) return "role or domain is required";
    const cur = (registry.agents[name] ??= {});
    if (b.role !== undefined) cur.role = str(b.role, 200);
    if (b.domain !== undefined) cur.domain = str(b.domain, 80);
  } else if (op === "hide-page") {
    if (!isUrl(b.url)) return "url must be http(s)";
    registry.pages[name] = (registry.pages[name] ?? []).filter((p) => p.url !== b.url);
    registry.hiddenPages[name] = [...new Set([...(registry.hiddenPages[name] ?? []), b.url as string])].slice(-200);
  } else if (op === "save-page" || op === "forget-page") {
    if (!isUrl(b.url)) return "url must be http(s)";
    const list = (registry.pages[name] ?? []).filter((p) => p.url !== b.url);
    if (op === "save-page") list.unshift({ url: b.url as string, title: str(b.title, 120) ?? (b.url as string), at: Date.now() });
    registry.pages[name] = list.slice(0, 20);
  } else return `unknown op ${String(op)}`;
  saveRegistry();
  return null;
}

/** Pages each agent posted to the console, newest first, one per title. Re-read only when the log changes. */
let consoleCache: { key: string; byAgent: Map<string, Page[]>; bySession: Map<string, Page[]> } = { key: "", byAgent: new Map(), bySession: new Map() };
function consolePages() {
  let key = "";
  try {
    const st = statSync(CONSOLE_EVENTS);
    key = `${st.mtimeMs}:${st.size}`;
  } catch {
    return consoleCache;
  }
  if (key === consoleCache.key) return consoleCache;
  const byAgent = new Map<string, Page[]>();
  const bySession = new Map<string, Page[]>();
  const add = (m: Map<string, Page[]>, k: string, p: Page) => {
    const list = m.get(k) ?? [];
    if (!list.some((x) => x.title === p.title)) list.push(p);
    m.set(k, list);
  };
  let text: string;
  try {
    text = readFileSync(CONSOLE_EVENTS, "utf8");
  } catch {
    // The console can rotate or disappear between statSync above and this read; keep the last good index.
    return consoleCache;
  }
  const lines = text.split("\n").reverse();
  for (const line of lines) {
    if (!line.includes('"type":"post"')) continue;
    try {
      const e = JSON.parse(line);
      const url = e.kind === "html" ? `${CONSOLE_URL}/card/${e.id}/html` : isUrl(e.url) ? e.url : null;
      if (!url) continue;
      const p: Page = { url, title: str(e.title, 120) ?? e.id, at: typeof e.ts === "number" ? e.ts : undefined, from: "console" };
      if (typeof e.agent === "string") add(byAgent, e.agent.toLowerCase(), p);
      if (typeof e.session === "string" && e.session) add(bySession, e.session, p);
    } catch {
      /* a torn line while the console writes: skip it */
    }
  }
  consoleCache = { key, byAgent, bySession };
  return consoleCache;
}

/**
 * An agent's pages: the ones saved to it first, then what it posted to the console, newest first; at most 30 (the page
 * strip scrolls). Posts are matched by every name it goes by before its session (R1.22, tab bar spec §3.6): its row
 * name, the names he renamed from, and for Agent Zero "A0" (66 cards were posted as A0 with no session); a relay changes
 * the session, never the name, so its pages stay. The session still adds posts made under a name it no longer has.
 */
function pagesOf(name: string, session: string | null): Page[] {
  const c = consolePages();
  const names = [name, ...Object.entries(registry.aliases ?? {}).filter(([, to]) => to === name).map(([from]) => from), ...(name === "Agent Zero" ? ["A0", "agent-zero"] : [])];
  const keys = [...new Set(names.flatMap((n) => [n.toLowerCase(), n.toLowerCase().slice(0, 12)]))];
  const posted = [...keys.flatMap((k) => c.byAgent.get(k) ?? []), ...((session && c.bySession.get(session)) || [])].sort((a, b) => (b.at ?? 0) - (a.at ?? 0));
  const saved = (registry.pages[name] ?? []).map((p) => ({ ...p, from: "saved" as const }));
  const seen = new Set<string>(registry.hiddenPages[name] ?? []);
  return [...saved, ...posted].filter((p) => !seen.has(p.url) && seen.add(p.url)).slice(0, 30);
}

setTodayCost(tokensTodayUsd); // A0, 3 Oct: one "today $" everywhere, the Tokens scan
/** The estate world's page, read and compressed once per build (keyed by mtime + size). */
let worldCache: { key: string; raw: Buffer; gz: Buffer; br: Buffer } | null = null;
function worldBody(file: string) {
  const st = statSync(file);
  const key = `${Math.round(st.mtimeMs).toString(36)}-${st.size.toString(36)}`;
  if (worldCache?.key !== key) {
    const raw = readFileSync(file);
    worldCache = { key, raw, gz: gzipSync(raw, { level: 6 }), br: brotliCompressSync(raw, { params: { [zlibConstants.BROTLI_PARAM_QUALITY]: 5 } }) };
  }
  return worldCache;
}

// ---------------------------------------------------------------- chats run by siso-host

/** Supervised service hosts (name-*.json, sol/a0w-003) by app row id, and herdr's last good list for a failed read. */
const serviceByRow = new Map<string, string>();
let lastHerdrList: unknown[] | null = null;
/** `state`, `child` and `ctx` (a0-018): what the host last told herdr, whether its claude runs, its context gauge. */
type Host = {
  pid: number; port: number; token: string; session: string | null; pane: string | null; name: string; cwd: string; model?: string | null; effort?: string | null;
  startedAt?: number;
  configDir?: string;
  models?: { id: string; label: string; description: string; efforts: string[] }[];
  rateLimits?: SeatLimits | null;
  runnerPid?: number; state?: "idle" | "working" | "blocked" | "asleep"; child?: "running" | "stopped"; ctx?: { used: number; window: number; pct: number; at: number } | null;
};
/** The running hosts by herdr pane: a file whose process is gone is ignored (and left for the host to clean up). */
function hostsByPane(): Map<string, Host> {
  const out = new Map<string, Host>();
  let files: string[] = [];
  try {
    files = readdirSync(HOSTS_DIR).filter((f) => f.endsWith(".json"));
  } catch {
    return out;
  }
  for (const f of files) {
    try {
      const h = JSON.parse(readFileSync(path.join(HOSTS_DIR, f), "utf8")) as Host;
      process.kill(h.state === "asleep" && h.runnerPid && h.runnerPid > 1 ? h.runnerPid : h.pid, 0);
      if (h.pane) out.set(h.pane, h);
    } catch {
      /* not running, or a half-written file */
    }
  }
  return out;
}

/** hub-1's readers (hub.ts) behind a short cache: the hover cards and Agent Zero's page poll them. */
const hubCache = new Map<string, { at: number; value: Promise<unknown> }>();
const hubHome = process.env.AB_HUB_HOME ? { home: process.env.AB_HUB_HOME } : {};
/** Agent Zero's tasks (hub-12's reader): the index, one task with its spec, and live changes. */
const a0Tasks = createA0TasksHandler();
const a0TaskEvents = createA0TasksEvents(a0Tasks);
const a0TaskWrite = createA0TaskWriter(a0Tasks);
const a0Transcript = createA0Transcript();
/**
 * The hub's live rows from the app's own agent list, not herdr's raw one (QA #6, A0, 3 Oct: the org chart showed A0
 * "Not running" and AGENT-BASE "not running" while it worked with 5 workers: herdr's list omits SDK hosts and names a
 * host's pane by its terminal title). Shaped as herdr rows for hub.ts; Agent Zero is "A0" there.
 */
async function hubRows() {
  const list = await listAgents().catch(() => []);
  const HUB_STATE = { working: "working", needs: "working", done: "done", idle: "idle", failed: "idle" } as const;
  return list.map((a) => ({ name: a.zero ? "A0" : a.name, agent: a.host ? "siso" : a.tool, agent_status: HUB_STATE[a.status] ?? "idle", model: a.hud?.model ?? undefined, machine: a.machineKey ?? a.machine }));
}
function hubCached<T>(key: string, build: () => Promise<T>): Promise<T> {
  const hit = hubCache.get(key);
  if (hit && Date.now() - hit.at < 10_000) return hit.value as Promise<T>;
  const value = build().catch((e) => {
    hubCache.delete(key);
    throw e;
  });
  hubCache.set(key, { at: Date.now(), value });
  return value;
}

/**
 * herdr's agent list, read at most once every 5 s however many ask (P0 performance, 2 Oct; HEALTH, 3 Oct: the node ran
 * `agent list` + `pane list` about twice a second, which a laptop on a weak charger cannot afford): the app's list, every
 * open chat's state watch and the routes each read it, and every read starts a herdr process. `maxAgeMs` 0 reads afresh
 * (before typing into a pane, i.e. on his own action); a lookup of an id this node has not seen yet reads within a second.
 */
let agentsRead: { at: number; p: ReturnType<typeof readAgents>; pending: boolean } | null = null;
/** How stale the shared agent list may be: 5 s live (HEALTH), AB_AGENTS_MS for checks (tools/ab-suites sets 1000, as the suites assume). */
const AGENTS_MS = Number(process.env.AB_AGENTS_MS) || 5000;
function listAgents(maxAgeMs = AGENTS_MS) {
  if (agentsRead && maxAgeMs > 0 && (agentsRead.pending || Date.now() - agentsRead.at < maxAgeMs)) return agentsRead.p;
  const p = readAgents(maxAgeMs === 0);
  const mine = { at: Date.now(), p, pending: true };
  agentsRead = mine;
  p.then(() => { mine.pending = false; if (agentsRead === mine) mine.at = Date.now(); }, () => { mine.pending = false; if (agentsRead === mine) agentsRead = null; });
  return p;
}
/** When a terminal's agent started: its session file's birth when there is one, else when this node first saw it. */
const startedOf = new Map<string, number>();
/** Its terminal title, the closest thing herdr has to what it was doing (Claude titles the terminal with its task). */
const taskOf = new Map<string, string>();
function startedAt(a: HerdrAgent, now: number): number {
  const v = a.agent_session?.value;
  const f = !v ? null : a.agent === "codex" ? codexFile(v) : sessionFile(v, a.cwd);
  try {
    return f ? statSync(f).birthtimeMs || now : now;
  } catch {
    return now;
  }
}
function recordEnded(id: string, now: number) {
  const name = nameOf.get(id);
  if (!name) return;
  const rec: Ended = {
    id: `e${now}-${id.replace(/[^A-Za-z0-9_-]/g, "-")}`, name, pane: paneOf.get(id) ?? "", terminal: id, session: sessionOf.get(id) ?? null,
    cwd: cwdOf.get(id) ?? "", project: registry.agents[name]?.project ?? null, tool: toolOf.get(id) ?? "", started: startedOf.get(id) ?? now,
    ended: now, status: statusOf.get(id) ?? "idle", task: (taskOf.get(id) ?? "").slice(0, 200), machine: MACHINE,
  };
  try {
    mkdirSync(path.dirname(ENDED_FILE), { recursive: true });
    appendFileSync(ENDED_FILE, JSON.stringify(rec) + "\n");
  } catch (e) {
    console.error("could not record an ended agent:", (e as Error).message);
  }
}
/** The record, newest first. A torn last line (a crash mid-write) is skipped, never fatal. */
function listEnded(limit = 200): Ended[] {
  let text = "";
  try {
    text = readFileSync(ENDED_FILE, "utf8");
  } catch {
    return [];
  }
  const out: Ended[] = [];
  for (const line of text.split("\n")) {
    try {
      if (line.trim()) out.push(JSON.parse(line));
    } catch {
      /* a torn line */
    }
  }
  return out.sort((a, b) => b.ended - a.ended).slice(0, limit);
}

/**
 * A running siso-host whose pane herdr no longer lists as an agent, as herdr would list it (3 Oct 00:51: a second host
 * started in A0's pane released the pane's agent on exit, and Agent Zero vanished from the app while alive). The host
 * file (its pid alive) is the proof it runs; herdr supplies terminal metadata when available.
 */
type PaneRow = { pane_id: string; terminal_id: string; cwd?: string; workspace_id?: string };
let paneList: { at: number; panes: PaneRow[] } | null = null;
async function unlistedHosts(agents: HerdrAgent[], hosts: Map<string, Host>): Promise<HerdrAgent[]> {
  const listed = new Set(agents.map((a) => a.pane_id));
  const missing = [...hosts.values()].filter((h) => h.pane && !listed.has(h.pane) && !agents.some((a) => h.session && a.agent_session?.value === h.session));
  if (!missing.length) return [];
  // The pane list only maps a pane to its terminal and workspace, which do not change while the pane lives: read it at most
  // every 30 s (it was read on every agent list while A0's host was unlisted, HEALTH 3 Oct), afresh when a pane is not in it.
  let panes = paneList && Date.now() - paneList.at < 30_000 && missing.every((h) => paneList!.panes.some((p) => p.pane_id === h.pane)) ? paneList.panes : null;
  if (!panes) {
    try {
      panes = JSON.parse(await herdr(["pane", "list"]))?.result?.panes ?? [];
      paneList = { at: Date.now(), panes };
    } catch {
      panes = [];
    }
  }
  const rows: PaneRow[] = panes;
  return missing.flatMap((h) => {
    const p = rows.find((x) => x.pane_id === h.pane) ?? { pane_id: h.pane!, terminal_id: `host-${h.pane}` };
    return [{ agent: "siso", agent_status: hostStates.get(h.pane!)?.state || h.state || "idle", cwd: h.cwd || p.cwd || "", name: h.name, pane_id: p.pane_id, terminal_id: p.terminal_id, terminal_title_stripped: h.name, agent_session: h.session ? { value: h.session } : undefined, workspace_id: p.workspace_id }];
  });
}
async function readAgents(requireFresh = false) {
  // A transient herdr failure keeps the last good rows (and their routing) rather than emptying the app (sol/a0w-003);
  // Explicit send-time reads must fail closed; cached display rows never authorize typing.
  let raw;
  try {
    raw = JSON.parse(await herdr(["agent", "list"]));
    if (!Array.isArray(raw?.result?.agents)) throw new Error("Invalid herdr agent list");
  } catch (e) {
    if (requireFresh) throw e;
    if (lastHerdrList) return withCodexApp(await withServiceRows(lastHerdrList)) as never;
    // On a cold start there is no terminal snapshot, but independently registered hosts
    // still own their chats. Compose those below; this never authorizes a terminal send.
    raw = { result: { agents: [] } };
  }
  freshRows();
  registryStore.fresh();
  const agents: HerdrAgent[] = raw?.result?.agents ?? [];
  const now = Date.now();
  let changed = false;
  const hosts = hostsByPane();
  agents.push(...(await unlistedHosts(agents, hosts)));
  // Each agent's row key; a second agent with the same name on this machine gets its terminal id appended.
  const keys = new Map<string, string>();
  const keyCounts = new Map<string, number>();
  const names = new Map<string, ReturnType<typeof shownName>>();
  const sessionOfAgent = (a: HerdrAgent) => hosts.get(a.pane_id)?.session ?? a.agent_session?.value;
  const seatNow = liveSeat(agents, sessionOfAgent);
  for (const a of agents) names.set(a.terminal_id, shownName(a, hosts.get(a.pane_id)?.name, sessionOfAgent(a), seatNow));
  oneZero(agents, names, (a) => hosts.has(a.pane_id));
  for (const a of agents) {
    const n = names.get(a.terminal_id)!;
    let k = rowKey(n.name);
    if (keyCounts.has(k)) k = `${k}#${a.terminal_id}`;
    const previous = keys.get(a.terminal_id);
    if (previous !== undefined) {
      const count = keyCounts.get(previous)!;
      if (count === 1) keyCounts.delete(previous); else keyCounts.set(previous, count - 1);
    }
    keys.set(a.terminal_id, k);
    keyCounts.set(k, (keyCounts.get(k) ?? 0) + 1);
  }
  // Terminals gone since the last list: hand their row to whoever holds it now, and forget their panes (ab-151).
  const before = new Map(keyOf);
  for (const [id, k] of keys) {
    if (!rowsHeld.has(id)) rowsHeld.set(id, new Map());
    rowsHeld.get(id)!.set(k.split("#")[0], now); // the same row ignores the "#<terminal>" a second agent of one name gets
  }
  for (const [old] of before) {
    if (keys.has(old)) continue;
    const held = new Set([...(rowsHeld.get(old) ?? new Map<string, number>())].filter(([, at]) => now - at < HEIR_WINDOW_MS).map(([row]) => row));
    rowsHeld.delete(old);
    // The heir must be the same agent, not just the same name (overnight QA, 3 Oct: a same-named agent on another session
    // took the chat): it carries the gone terminal's session, or it is the next session of the host in the gone pane, or
    // the gone terminal was the seat's Agent Zero and this is the seat's Agent Zero now.
    const oldSession = sessionOf.get(old);
    const oldPane = paneOf.get(old);
    const sameAgent = (a: HerdrAgent) =>
      (!!oldSession && sessionOfAgent(a) === oldSession) ||
      (!!oldPane && a.pane_id === oldPane && hosts.has(oldPane)) ||
      (!!seatNow && nameOf.get(old) === "Agent Zero" && !!names.get(a.terminal_id)?.zero);
    const byId = new Map(agents.map((a) => [a.terminal_id, a]));
    const heir = [...keys].find(([id, k]) => id !== old && held.has(k.split("#")[0]) && sameAgent(byId.get(id)!))?.[0];
    if (heir) {
      successor.set(old, heir);
      for (const [o, h] of successor) if (h === old) successor.set(o, heir);
    }
    // Gone for good (no heir): kept on record. An empty list is herdr restarting, not every agent ending at once.
    if (!heir && agents.length) recordEnded(old, now);
    for (const m of [paneOf, statusOf, sessionOf, cwdOf, nameOf, toolOf, startedOf, taskOf] as Map<string, unknown>[]) m.delete(old);
  }
  keyOf.clear();
  for (const [id, k] of keys) keyOf.set(id, k);
  const live = new Set(keys.values());
  // Old entries by terminal id: move the live ones to their key; the rest belonged to terminals that are gone for good.
  for (const old of legacyKeys()) {
    renameRow(old, keys.get(old) ?? null);
    changed = true;
  }
  // A title that changed mid-session: the row follows its Claude session from a key that is no longer live.
  for (const a of agents) {
    const k = keys.get(a.terminal_id)!;
    const s = hosts.get(a.pane_id)?.session ?? a.agent_session?.value;
    if (!s) continue;
    if (!hasRow(k)) {
      const old = Object.keys(rows.sessions).find((o) => o !== k && rows.sessions[o] === s && !live.has(o));
      if (old) renameRow(old, k);
    }
    if (rows.sessions[k] !== s) { rows.sessions[k] = s; changed = true; }
  }
  const list = agents.map((a) => {
    const host = hosts.get(a.pane_id);
    if (host?.session) a.agent_session = { value: host.session };
    const key = keys.get(a.terminal_id)!;
    const status = WORD[a.agent_status] ?? "idle";
    const prev = since.get(key);
    if (!prev || prev.status !== status) {
      since.set(key, { status, at: now });
      changed = true;
    }
    paneOf.set(a.terminal_id, a.pane_id);
    cwdOf.set(a.terminal_id, a.cwd);
    if (!startedOf.has(a.terminal_id)) startedOf.set(a.terminal_id, startedAt(a, now));
    taskOf.set(a.terminal_id, (a.terminal_title_stripped ?? "").replace(/^[^A-Za-z0-9]+\s*/, "").trim());
    nameOf.set(a.terminal_id, names.get(a.terminal_id)!.name);
    statusOf.set(a.terminal_id, status);
    toolOf.set(a.terminal_id, a.agent);
    if (a.agent_session?.value) sessionOf.set(a.terminal_id, a.agent_session.value);
    const { raw: name, zero: isZero, a0: isA0 } = names.get(a.terminal_id)!;
    const title = (a.terminal_title_stripped ?? "").replace(/^[^A-Za-z0-9]+\s*/, "").trim();
    const row = rows.settled[key] !== undefined ? "settled" : (rows.snoozed[key] ?? 0) > now ? "snoozed" : "live";
    return {
      id: a.terminal_id,
      key,
      pane: a.pane_id,
      name: isZero ? "Agent Zero" : name,
      title: title === name ? "" : title,
      row,
      snoozedUntil: row === "snoozed" ? rows.snoozed[key] : null,
      settledAt: rows.settled[key] ?? null,
      seenAt: rows.seen[key] ?? null,
      // Shaan's own order (dragged in the sidebar, as in herdr); agents he never placed sort after, newest last.
      order: rows.order.includes(key) ? rows.order.indexOf(key) : null,
      status,
      since: since.get(key)!.at,
      // herdr reports no agent for a pane's first seconds, before it sees the CLI; the row's tool is always a string (t-0579).
      tool: a.agent ?? "",
      cwd: a.cwd,
      folder: path.basename(a.cwd),
      machine: MACHINE,
      machineKey: MACHINE_KEY,
      session: a.agent_session?.value ?? null,
      ...(() => {
        const hud = host ? hostHud(host, a.agent_session?.value) : readHud(a.agent_session?.value);
        return { context: hud?.context ?? null, hud };
      })(),
      zero: isZero,
      /** t-0264: one of his Agent Zeros (the default one is `zero`), and the name the Agent Zero switcher shows. */
      a0: isA0,
      label: isZero ? registry.a0Label ?? "Agent Zero" : name,
      /** Run by siso-host: the app can show its live chat and own its input box (/chat/:id/ws). */
      host: !!host,
      /** The app can show a chat: siso-host's live one, or (a Claude agent in the terminal) one read from its session file. */
      /** When its session file last changed: its last event, so a "working" agent silent for 10 min reads "quiet". */
      chatStartedAt: host?.startedAt ?? startedOf.get(a.terminal_id) ?? null,
      lastEvent: (() => {
        const v = a.agent_session?.value;
        const f = !v ? null : a.agent === "codex" ? codexFile(v) : sessionFile(v, a.cwd);
        try {
          return f ? statSync(f).mtimeMs : null;
        } catch {
          return null;
        }
      })(),
      chat:
        !!host ||
        (a.agent === "claude" && !!a.agent_session?.value && !!sessionFile(a.agent_session.value, a.cwd)) ||
        (a.agent === "codex" && !!a.agent_session?.value && !!codexFile(a.agent_session.value)),
      ...(() => {
        const who = registry.agents[isZero ? "Agent Zero" : name] ?? {};
        const shown = isZero ? "Agent Zero" : name;
        // R1.4: herdr's host is this node's machine, unless the registry places the agent on another one.
        const away = who.machine && who.machine !== MACHINE_KEY ? { machine: who.machine, machineKey: who.machine, away: true } : {};
        return { project: who.project ?? null, domain: who.domain ?? null, owner: who.owner ?? null, lead: who.owner ?? null, kind: who.kind ?? null, role: who.role ?? null, icon: who.icon ?? null, pinned: false, pages: pagesOf(shown, a.agent_session?.value ?? null), ...away };
      })(),
    };
  });
  if (changed) saveRows();
  lastHerdrList = list;
  return withCodexApp(await withServiceRows(list));
}

/** His Codex desktop chats, read-only (codex-app.ts); a thread something here already hosts is not listed twice. */
function withCodexApp<T>(list: T[]): T[] {
  let threads: ReturnType<typeof codexAppThreads> = [];
  try { threads = codexAppThreads(); } catch { return list; }
  const hosted = new Set((list as unknown as { session?: string | null }[]).map((r) => r.session).filter(Boolean));
  return [...list, ...threads.filter((t) => !hosted.has(t.thread)).map((t) => codexAppRow(t, { machine: MACHINE, machineKey: MACHINE_KEY }) as unknown as T)];
}

/** herdr's rows with the service hosts joined on (and a row for a pane-less one, such as Agent Zero's). */
async function withServiceRows<T>(list: T[]): Promise<T[]> {
  const services = await listServiceHosts({ dir: HOSTS_DIR });
  if (!services.length && !serviceByRow.size) return list;
  const bound = bindServiceRows(list as unknown as Parameters<typeof bindServiceRows>[0], services, { machine: MACHINE, machineKey: MACHINE_KEY, registry: registry.agents });
  serviceByRow.clear();
  // Pane-backed chats keep their exact pane route, even when two hosts share a name.
  for (const row of bound) if (row.serviceHost && !row.pane) serviceByRow.set(row.id, row.serviceHost.name);
  // Pane-less service seats have no herdr HUD route; use their same private host file.
  for (const row of bound) {
    if (!row.serviceHost || row.pane) continue;
    const service = services.find((h) => h.name === row.serviceHost?.name);
    if (!service || service.harness === "codex") continue;
    try {
      const host = JSON.parse(readFileSync(service.file, "utf8")) as Host;
      (row as typeof row & { hud: Hud | null }).hud = hostHud(host, host.session ?? undefined);
    } catch { /* retain the service row when its file is being replaced */ }
  }
  for (const row of bound) {
    const host=services.find(h=>h.name===(row.serviceHost?.name ?? row.name) && (!row.pane || h.pane===row.pane));
    if(!host)continue;
    row.chatStartedAt = host.startedAt;
    try { const h=JSON.parse(readFileSync(host.file,"utf8")); if(h.workspaceId) { const r=getWorkspace(h.workspaceId);if(r.name===host.name && r.worktreePath===host.cwd)Object.assign(row,{workspaceId:r.workspaceId,branch:r.branch}); } }catch{}
  }
  return bound as unknown as T[];
}

/** The estate's machines, minus retired and deleted ones. Only this node's own machine has a herdr it can read yet. */
function machines() {
  let m: Record<string, any> = {};
  try {
    m = JSON.parse(readFileSync(MACHINES_FILE, "utf8")).machines ?? {};
  } catch {
    /* no estate map on this machine: just this one */
  }
  const list = Object.entries(m)
    .filter(([, v]) => !/^(retired|deleted)/i.test(String(v?.status ?? "")))
    .map(([key, v]) => ({
      key,
      name: String(v?.host ?? key).split(" (")[0],
      role: String(v?.fleet?.role ?? "").split(/[.:(]/)[0].trim(),
      status: String(v?.status ?? "").split(/[:(;]/)[0].trim(),
      here: key === MACHINE_KEY,
    }));
  if (!list.some((x) => x.here)) list.unshift({ key: MACHINE_KEY, name: MACHINE, role: "", status: "", here: true });
  return list.sort((a, b) => Number(b.here) - Number(a.here));
}

// ---------------------------------------------------------------- a chat's stats

/**
 * Totals for one chat, read from Claude's own session file (`<profile>/projects/<folder>/<session>.jsonl`), which
 * Claude appends as it works. Read incrementally: only the bytes added since the last read are parsed. Counts the
 * main chat only; its in-chat sub-agents write their own files and are counted as sub-agents, not tokens.
 */
/** A Claude session's file in any of this machine's Claude folders (transcript.ts finds it). */
const findSession = (session: string): string | null => sessionFile(session, "");
type Tally = {
  offset: number; tail: Buffer; dev: number; ino: number; mtimeMs: number; usage: Map<string, number[]>; toolIds: Set<string>; tools: Record<string, number>;
  skills: Record<string, number>; agents: { at: string | null; type: string; what: string }[]; prompts: number;
  models: Record<string, number>; hours: Map<string, number>; first: string | null; last: string | null;
};
const tallies = new Map<string, Tally>();
const tallyReads = new Map<string, Promise<Tally>>();
function tally(file: string): Promise<Tally> {
  let pending = tallyReads.get(file);
  if (!pending) { pending = readTally(file).finally(() => tallyReads.delete(file)); tallyReads.set(file, pending); }
  return pending;
}
async function readTally(file: string): Promise<Tally> {
  const fd = await open(file, "r");
  try {
    const st = await fd.stat(), size = st.size;
    let t = tallies.get(file);
    if (!t || st.dev !== t.dev || st.ino !== t.ino || size < t.offset || (size === t.offset && st.mtimeMs !== t.mtimeMs)) {
      t = { offset: 0, tail: Buffer.alloc(0), dev: st.dev, ino: st.ino, mtimeMs: st.mtimeMs, usage: new Map(), toolIds: new Set(), tools: {}, skills: {}, agents: [], prompts: 0, models: {}, hours: new Map(), first: null, last: null };
      tallies.set(file, t);
    }
    const buf = Buffer.alloc(256 << 10);
    while (t.offset < size) {
      const { bytesRead } = await fd.read(buf, 0, Math.min(buf.length, size - t.offset), t.offset);
      if (!bytesRead) throw new Error("Session changed during stats read");
      const bytes = Buffer.concat([t.tail, buf.subarray(0, bytesRead)]), end = bytes.lastIndexOf(10);
      t.tail = Buffer.from(bytes.subarray(end + 1));
      t.offset += bytesRead;
      const lines = end < 0 ? [] : bytes.subarray(0, end).toString("utf8").split("\n");
      for (const line of lines) {
        if (!line) continue;
        let r: any;
        try {
          r = JSON.parse(line);
        } catch {
          continue;
        }
        const ts: string | null = typeof r.timestamp === "string" ? r.timestamp : null;
        if (ts) {
          t.first ??= ts;
          t.last = ts;
        }
        // His prompts: typed text, or text with images; not tool results, hook notes or command echoes ("<…>").
        if (r.type === "user" && !r.isMeta && !r.isSidechain && r.message) {
          const c = r.message.content;
          const text = typeof c === "string" ? c : Array.isArray(c) && !c.some((b: any) => b?.type === "tool_result") ? String(c.find((b: any) => b?.type === "text")?.text ?? "") : "";
          if (text && !text.startsWith("<")) t.prompts++;
        }
        if (r.type !== "assistant" || r.isSidechain || !r.message) continue;
        const m = r.message;
        if (m.id && m.usage) {
          const u = m.usage;
          const prev = t.usage.get(m.id);
          const now = [u.input_tokens ?? 0, u.output_tokens ?? 0, u.cache_read_input_tokens ?? 0, u.cache_creation_input_tokens ?? 0];
          t.usage.set(m.id, now);
          if (!prev && m.model) t.models[m.model] = (t.models[m.model] ?? 0) + 1;
          if (ts) {
            const h = ts.slice(0, 13);
            t.hours.set(h, (t.hours.get(h) ?? 0) + now[1] - (prev?.[1] ?? 0));
          }
        }
        for (const b of Array.isArray(m.content) ? m.content : []) {
          if (b?.type !== "tool_use" || !b.id || t.toolIds.has(b.id)) continue;
          t.toolIds.add(b.id);
          t.tools[b.name] = (t.tools[b.name] ?? 0) + 1;
          if (b.name === "Skill") {
            const sk = String(b.input?.skill ?? b.input?.command ?? "?");
            t.skills[sk] = (t.skills[sk] ?? 0) + 1;
          }
          if (b.name === "Task" || b.name === "Agent") t.agents.push({ at: ts, type: String(b.input?.subagent_type ?? "general-purpose"), what: String(b.input?.description ?? "").slice(0, 120) });
        }
      }
      await yieldIO();
    }
    const current = statSync(file);
    if (current.dev !== st.dev || current.ino !== st.ino || current.size < size ||
        (current.size === size && current.mtimeMs !== st.mtimeMs)) throw new Error("Session changed during stats read");
    t.mtimeMs = st.mtimeMs;
    return t;
  } finally { await fd.close(); }
}
async function statsOf(session: string | null) {
  if (!session) return { error: "herdr reports no Claude session for this agent" };
  const file = findSession(session);
  if (!file) return { error: "no session file found for this agent's session" };
  const t = await tally(file);
  const sum = [0, 0, 0, 0];
  for (const u of t.usage.values()) for (let i = 0; i < 4; i++) sum[i] += u[i];
  const [input, output, cacheRead, cacheWrite] = sum;
  const toolCalls = Object.values(t.tools).reduce((a, b) => a + b, 0);
  const hours = [...t.hours].sort(([a], [b]) => a.localeCompare(b)).slice(-48).map(([h, out]) => ({ hour: `${h}:00:00Z`, output: out }));
  return {
    file, bytes: t.offset, first: t.first, last: t.last, prompts: t.prompts, apiCalls: t.usage.size,
    tokens: { input, output, cacheRead, cacheWrite, total: input + output + cacheRead + cacheWrite, cachePct: input + cacheRead + cacheWrite > 0 ? Math.round((100 * cacheRead) / (input + cacheRead + cacheWrite)) : null },
    toolCalls, tools: t.tools, skills: t.skills, subagents: { count: t.agents.length, recent: t.agents.slice(-12).reverse() }, models: t.models, hours,
  };
}

// ---------------------------------------------------------------- http

const TYPES: Record<string, string> = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".woff2": "font/woff2", ".wasm": "application/wasm", ".webmanifest": "application/manifest+json" };

function sendStatic(req: http.IncomingMessage, res: http.ServerResponse, file: string, type: string, cache: string) {
  const bytes = readFileSync(file);
  const hash = createHash("sha1").update(bytes).digest("hex");
  const accepts = req.headers["accept-encoding"] ?? "";
  const encoding = /\bbr\b/.test(accepts) ? "br" : /\bgzip\b/.test(accepts) ? "gzip" : "identity";
  const etag = `W/"${hash}-${encoding}"`;
  const headers = { "content-type": type, "cache-control": cache, etag, vary: "Accept-Encoding" };
  if (req.headers["if-none-match"]?.split(/\s*,\s*/).includes(etag)) {
    res.writeHead(304, headers);
    return void res.end();
  }
  if (req.method === "HEAD") {
    res.writeHead(200, { ...headers, ...(encoding === "identity" ? { "content-length": bytes.length } : { "content-encoding": encoding }) });
    return void res.end();
  }
  res.writeHead(200, { ...headers, ...(encoding === "identity" ? { "content-length": bytes.length } : { "content-encoding": encoding }) });
  const stream = createReadStream(file);
  if (encoding === "br") stream.pipe(createBrotliCompress({ params: { [zlibConstants.BROTLI_PARAM_QUALITY]: 4 } })).pipe(res);
  else if (encoding === "gzip") stream.pipe(createGzip({ level: zlibConstants.Z_BEST_SPEED })).pipe(res);
  else stream.pipe(res);
}

/**
 * The org tree (L3's buildOrg over the table), with what only herdr knows filled in: an owner is live when its agent
 * runs (else a dim "not started"), and how many of its workers are working.
 */
async function liveOrg() {
  // Agent state and the disk-backed org tree do not depend on each other; start both reads together.
  const [agents, org] = await Promise.all([
    listAgents(),
    buildOrg(registry, orgReaders(process.env.AB_ORG_HOME ?? homedir())),
  ]);
  const live = agents.filter((a) => a.row !== "settled");
  const roleRuns = codexWorkerRows(MACHINE).filter(a => a.infrastructureRole);
  const fill = (o: any) => {
    const a = roleRuns.find(x => x.infrastructureRole === o.name) ?? live.find((x) => x.name === o.name || (o.name === "Agent Zero" && x.zero));
    // Not running: "planned" when A0 drew it and it never started, else "offline" (on record, shown dim in its project).
    o.state = a ? "live" : registry.agents[o.name]?.state === "planned" ? "planned" : "offline";
    o.working = live.filter((w) => w.owner === o.name && w.status === "working").length;
  };
  // The bottom slot is Agent Infrastructure (ab-148): HEALTH, EFFICIENCY and ESTATE, each with its live status.
  const aliasSources = new Set(Object.keys(registry.aliases ?? {}));
  const INFRA = ["HEALTH", "EFFICIENCY", "ESTATE"];
  const infra = Object.entries({ ...Object.fromEntries(INFRA.map(n => [n, { domain: n } as Who])), ...registry.agents })
    .filter(([n, w]) => !aliasSources.has(n) && (INFRA.includes(n) || w.slot === "bottom" || /^Agent Infrastructure/.test(w.role ?? "")))
    .sort(([a], [b]) => (INFRA.indexOf(a) + 1 || 9) - (INFRA.indexOf(b) + 1 || 9));
  const ledgers = new Map(await Promise.all(INFRA.map(async n => [n, await roleLedger(n)] as const)));
  org.bottom = infra.map(([n, w]) => ({ ledger: ledgers.get(n) ?? null, name: n, domain: w.domain ?? n, icon: w.icon ?? "stethoscope", state: "planned", working: 0, plan: null, status: (roleRuns.find((a) => a.infrastructureRole === n) ?? live.find((a) => a.name === n))?.status ?? null }));
  // Agent Zero and the infrastructure have their own slots, and a name he renamed (an alias source) is the same
  // agent: never a second row inside a project (2 Oct: "no owner renders twice").
  const pinnedSlots = new Set([...org.top, ...org.bottom].map((o: any) => o.name).concat([...aliasSources]));
  for (const g of org.groups) {
    for (const p of g.projects) {
      const away = p.owners.filter((o: any) => pinnedSlots.has(o.name));
      p.owners = p.owners.filter((o: any) => !pinnedSlots.has(o.name));
      // Its owner sits in a slot (Efficiency's EFFICIENCY in the footer): the project stays and links there. A project
      // with no owner at all stays too, as an empty seat (projects-nav spec A; it used to vanish from the nav).
      if (!p.owners.length && away.length) p.elsewhere = (away.find((o: any) => String(o.domain).toLowerCase() === p.name.toLowerCase()) ?? away[0]).name;
    }
    for (const p of g.projects) p.owners.forEach(fill);
  }
  [...org.top, ...org.bottom].forEach(fill);
  return org;
}
/**
 * t-0562 (Shaan, 8 Oct ~23:10; the spec: "Placement is set, not guessed"): a live agent with no entry is recorded unplaced,
 * which the nav shows in Playground until Agent Zero places it (POST /api/agent-records). The old guess (an owner in the same
 * workspace and repo) also rewrote agents already placed by hand, and filed AB-ZERO as AGENT-BASE's worker on 8 Oct.
 */
function placeNew(live: { name: string; cwd: string; pane: string }[]) {
  if (recordUnplaced(registry.agents, live).length) saveRegistry();
}

function readBody(req: http.IncomingMessage, limit = 64_000): Promise<string> {
  return new Promise((ok, fail) => {
    let b = "", oversized = false;
    req.on("data", (c) => {
      if (oversized) return;
      b += c;
      if (b.length > limit) { oversized = true; fail(new Error("body too large")); }
    });
    req.on("error", fail);
    req.on("end", () => ok(b));
  });
}

function json(res: http.ServerResponse, code: number, body: unknown) {
  sendJson(res, code, body);
}

/**
 * The update pop-up (ab-149): what this checkout holds now, read against what the node booted with. Under supervise.ts
 * (AB_SUPERVISED) a node whose own code changed exits 75 between requests and comes back on the new code; run any other
 * way (the desktop app before its lib.rs change) it never exits on its own, it only says so in the log once.
 */
const APP_ROOT = path.resolve(process.env.AB_APP_ROOT ?? path.join(import.meta.dirname, "../../.."));
const BOOT_SHA = gitSha(APP_ROOT);
const BOOT_NODE = readVersion(APP_ROOT, BOOT_SHA).node;
const inFlight = new Map<object, number>();
let saidStale = false;
setInterval(() => {
  const now = Date.now();
  const oldest = Math.max(0, ...[...inFlight.values()].map((at) => now - at));
  if (!shouldRestart(BOOT_NODE, readVersion(APP_ROOT, BOOT_SHA).node, oldest)) return;
  if (process.env.AB_SUPERVISED === "1") {
    console.log("node code changed; exiting 75 so supervise.ts starts the new one");
    process.exit(75);
  } else if (!saidStale) {
    saidStale = true;
    console.log("node code changed; restart the app to run it (not supervised, so not exiting)");
  }
}, 30_000).unref();

const attention = new ActivityCollector(HOSTS_DIR, process.env.AB_ATTENTION_DIR ?? path.join(path.dirname(STATE_FILE), 'attention'), h => {
  if (h.pane) return [...paneOf].find(([,pane]) => pane === h.pane)?.[0] ?? null;
  return [...serviceByRow].find(([,name]) => name === h.name)?.[0] ?? null;
}, fetch, h => { const who = registry.agents[h.name]; return who?.owner === 'Agent Zero' || who?.slot === 'bottom' || /^Agent Infrastructure/.test(who?.role ?? ''); });
setAutomaticNotifications(agent => attention.list().filter(i => i.agentId === agent).map(i => ({ id: i.id, at: i.at, title: i.agentName, body: i.headline, read: i.read, react: null, ...(i.phase === 'needs' ? { needs: i.headline } : {}) })));
process.on('exit', () => attention.close());
const changes = createChangesService({ rows: () => listAgents(0), machineId: MACHINE_KEY, hosts: () => listServiceHosts({dir:HOSTS_DIR}) });
const deliveredWork = createDeliveryReader(APP_ROOT);
const remoteInventory = createRemoteInventory({
  enabled: () => process.env.AB_REMOTE_INVENTORY === "1",
  targets: () => {
    const catalog = process.env.AB_SERVICES_FILE ?? path.join(path.dirname(MACHINES_FILE), "services.json");
    try {
      if (statSync(MACHINES_FILE).size > 1_048_576 || statSync(catalog).size > 1_048_576) return [];
      return remoteTargets(JSON.parse(readFileSync(MACHINES_FILE, "utf8")), JSON.parse(readFileSync(catalog, "utf8")), MACHINE_KEY);
    } catch { return []; }
  },
});
const spaces = createSpaces();

/** Type-only contract: route areas never import the running server at runtime. */
export type HttpRuntime = {
  ALLOWED_ORIGINS: typeof ALLOWED_ORIGINS;
  APP_ROOT: typeof APP_ROOT;
  BOOT_SHA: typeof BOOT_SHA;
  BROWSER_HISTORY: typeof BROWSER_HISTORY;
  BROWSER_STATE: typeof BROWSER_STATE;
  HERDR: typeof HERDR;
  HOSTS_DIR: typeof HOSTS_DIR;
  IMAGE_EXT: typeof IMAGE_EXT;
  LIFE: typeof LIFE;
  MACHINE: typeof MACHINE;
  MACHINE_KEY: typeof MACHINE_KEY;
  SELECTION_LOG: typeof SELECTION_LOG;
  TYPES: typeof TYPES;
  UPLOADS: typeof UPLOADS;
  WEB_DIST: typeof WEB_DIST;
  WHATSAPP: typeof WHATSAPP;
  a0TaskEvents: typeof a0TaskEvents;
  a0TaskWrite: typeof a0TaskWrite;
  a0Tasks: typeof a0Tasks;
  a0Transcript: typeof a0Transcript;
  act: typeof act;
  addProject: typeof addProject;
  attention: typeof attention;
  changes: typeof changes;
  cwdOf: typeof cwdOf;
  deliveredWork: typeof deliveredWork;
  edit: typeof edit;
  findSession: typeof findSession;
  forkChat: typeof forkChat;
  freshRows: typeof freshRows;
  herdr: typeof herdr;
  hubCached: typeof hubCached;
  hubHome: typeof hubHome;
  hubRows: typeof hubRows;
  json: typeof json;
  keyOf: typeof keyOf;
  launchRepo: typeof launchRepo;
  listAgents: typeof listAgents;
  listEnded: typeof listEnded;
  liveOrg: typeof liveOrg;
  machines: typeof machines;
  moveToHost: typeof moveToHost;
  nameOf: typeof nameOf;
  paneOf: typeof paneOf;
  placeNew: typeof placeNew;
  readBody: typeof readBody;
  readHud: typeof readHud;
  registry: typeof registry;
  registryStore: typeof registryStore;
  remoteInventory: typeof remoteInventory;
  rows: typeof rows;
  run: typeof run;
  saveRegistry: typeof saveRegistry;
  saveRows: typeof saveRows;
  sayTo: typeof sayTo;
  sendStatic: typeof sendStatic;
  sessionOf: typeof sessionOf;
  spaces: typeof spaces;
  startAgent: typeof startAgent;
  claudeLaunchProfile: () => ReturnType<typeof configuredClaudeProfile>;
  startZero: typeof startZero;
  statsOf: typeof statsOf;
  talkTo: typeof talkTo;
  taskActions: typeof taskActions;
  usageDirectories: typeof usageDirectories;
  workspaceAdapters: typeof workspaceAdapters;
  worldBody: typeof worldBody;
  zeroStarting: typeof zeroStarting;
};

const HTTP_ROUTES = builtinRoutes({
  get ALLOWED_ORIGINS() { return ALLOWED_ORIGINS; },
  get APP_ROOT() { return APP_ROOT; },
  get BOOT_SHA() { return BOOT_SHA; },
  get BROWSER_HISTORY() { return BROWSER_HISTORY; },
  get BROWSER_STATE() { return BROWSER_STATE; },
  get HERDR() { return HERDR; },
  get HOSTS_DIR() { return HOSTS_DIR; },
  get IMAGE_EXT() { return IMAGE_EXT; },
  get LIFE() { return LIFE; },
  get MACHINE() { return MACHINE; },
  get MACHINE_KEY() { return MACHINE_KEY; },
  get SELECTION_LOG() { return SELECTION_LOG; },
  get TYPES() { return TYPES; },
  get UPLOADS() { return UPLOADS; },
  get WEB_DIST() { return WEB_DIST; },
  get WHATSAPP() { return WHATSAPP; },
  get a0TaskEvents() { return a0TaskEvents; },
  get a0TaskWrite() { return a0TaskWrite; },
  get a0Tasks() { return a0Tasks; },
  get a0Transcript() { return a0Transcript; },
  get act() { return act; },
  get addProject() { return addProject; },
  get attention() { return attention; },
  get changes() { return changes; },
  get cwdOf() { return cwdOf; },
  get deliveredWork() { return deliveredWork; },
  get edit() { return edit; },
  get findSession() { return findSession; },
  get forkChat() { return forkChat; },
  get freshRows() { return freshRows; },
  get herdr() { return herdr; },
  get hubCached() { return hubCached; },
  get hubHome() { return hubHome; },
  get hubRows() { return hubRows; },
  get json() { return json; },
  get keyOf() { return keyOf; },
  get launchRepo() { return launchRepo; },
  get listAgents() { return listAgents; },
  get listEnded() { return listEnded; },
  get liveOrg() { return liveOrg; },
  get machines() { return machines; },
  get moveToHost() { return moveToHost; },
  get nameOf() { return nameOf; },
  get paneOf() { return paneOf; },
  get placeNew() { return placeNew; },
  get readBody() { return readBody; },
  get readHud() { return readHud; },
  get registry() { return registry; },
  get registryStore() { return registryStore; },
  get remoteInventory() { return remoteInventory; },
  get rows() { return rows; },
  get run() { return run; },
  get saveRegistry() { return saveRegistry; },
  get saveRows() { return saveRows; },
  get sayTo() { return sayTo; },
  get sendStatic() { return sendStatic; },
  get sessionOf() { return sessionOf; },
  get spaces() { return spaces; },
  get startAgent() { return startAgent; },
  claudeLaunchProfile: () => configuredClaudeProfile(NEW_AGENT_CLAUDE_DIR),
  get startZero() { return startZero; },
  get statsOf() { return statsOf; },
  get talkTo() { return talkTo; },
  get taskActions() { return taskActions; },
  get usageDirectories() { return usageDirectories; },
  get workspaceAdapters() { return workspaceAdapters; },
  get worldBody() { return worldBody; },
  get zeroStarting() { return zeroStarting; },
  set zeroStarting(value) { zeroStarting = value; },
});
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://node");
  inFlight.set(req, Date.now());
  const settle = () => inFlight.delete(req);
  res.once("finish", settle);
  res.once("close", settle);
  try {
    const origin = String(req.headers.origin ?? "");
    if (url.pathname.startsWith("/api/") && ["POST", "PUT", "PATCH", "DELETE"].includes(req.method ?? "") && origin && !ALLOWED_ORIGINS.has(origin))
      return json(res, 403, { error: "not this app" });
    if (await dispatchRoute(HTTP_ROUTES, req, res, url.pathname, url)) return;
    if (await dispatchRoute(ROUTES, req, res, url.pathname)) return;
    json(res, 404, { error: "not found" });
  } catch (e) {
    const why = (e as Error).message.split("\n")[0];
    console.error(`${new Date().toISOString()} ${req.method} ${url.pathname} failed: ${why}`);
    json(res, 502, { error: why });
  }
});

// ---------------------------------------------------------------- terminals

const wss = new WebSocketServer({ noServer: true });

const WHATSAPP = whatsappConfig();
const LIFE = lifeConfig();
const ALLOWED_ORIGINS = new Set([`http://127.0.0.1:${PUBLIC_PORT}`, `http://localhost:${PUBLIC_PORT}`, ...(process.env.AB_ALLOWED_ORIGINS ?? "").split(",").filter(Boolean)]);
const SHELL = process.env.SHELL || "/bin/zsh";

server.on("upgrade", async (req, socket, head) => {
  if (!ALLOWED_ORIGINS.has(String(req.headers.origin ?? ""))) {
    console.error(`${new Date().toISOString()} refused a socket from origin ${String(req.headers.origin ?? "(none)")}`);
    return socket.destroy();
  }
  const m = (req.url ?? "").match(/^\/term\/([A-Za-z0-9_:-]+)\/ws/);
  if (m) return wss.handleUpgrade(req, socket, head, (ws) => attach(ws, (size) => pty.spawn(HERDR[0], [...HERDR.slice(1), "terminal", "attach", m[1], "--takeover"], { name: "xterm-256color", cols: size.columns, rows: size.rows, env: childEnv })));
  const ch = (req.url ?? "").match(/^\/chat\/([^/]+)\/ws/);
  if (ch) {
    try { ch[1] = decodeURIComponent(ch[1]); } catch { return socket.destroy(); }
    if (!/^[A-Za-z0-9_:-]+$/.test(ch[1])) return socket.destroy();
  }
  // A saved conversation is a sealed identity, not permission to follow this reusable row ID.
  // Validate before every legacy shortcut (successor and desktop transcript included).
  if (ch) {
    const parsed = parseConversationChatTarget(new URL(req.url ?? "/", "http://node").searchParams);
    if (!parsed.valid) return socket.destroy();
    const target = parsed.target;
    if (target) {
      let current: Awaited<ReturnType<typeof listAgents>>;
      try { current = await listAgents(0); } catch { return socket.destroy(); }
      if (!matchesConversationTarget(target, current, ch[1]) || target.machine !== MACHINE_KEY) return socket.destroy();
      const row = current.find(a => a.id === ch[1])!;
      const thread = codexAppThread(ch[1]);
      if (thread) {
        if (target.harness !== "codex" || thread !== target.session) return socket.destroy();
        const file = codexFile(thread);
        if (!file) return socket.destroy();
        return wss.handleUpgrade(req, socket, head, ws => serveTranscript(ws, ch[1], codexTranscriptOf(file), target));
      }
      const serviceHost = "serviceHost" in row ? row.serviceHost : null;
      const serviceName = !row.pane && serviceHost && typeof serviceHost === "object" && "name" in serviceHost && typeof serviceHost.name === "string" ? serviceHost.name : undefined;
      const hosts = await listServiceHosts({ dir: HOSTS_DIR }).catch(() => []);
      const matches = serviceName ? hosts.filter(h => h.name === serviceName && !h.pane) : hosts.filter(h => !!row.pane && h.pane === row.pane);
      if (matches.length) {
        // The native node and its actual host metadata must prove every identity dimension.
        if (matches.length !== 1 || !["live", "asleep"].includes(matches[0].state) || matches[0].session !== target.session || matches[0].conversationHarness !== target.harness) return socket.destroy();
        const host = matches[0];
        if (host.state === 'asleep') return wss.handleUpgrade(req, socket, head, ws => sleepingChat(ws, ch[1], host, target));
        return wss.handleUpgrade(req, socket, head, ws => passThrough(ws, `ws://127.0.0.1:${host.port}/ws?token=${encodeURIComponent(host.token)}`, host.pane ?? undefined, { adapter: 'native', agentId: ch[1], by: row.name, sessionId: target.session }, target));
      }
      // A disappearing or changed native host cannot fall back to a transcript or a same-name seat.
      if (row.host || serviceHost || (target.harness !== "claude" && target.harness !== "codex")) return socket.destroy();
      const file = target.harness === "codex" ? codexFile(target.session) : sessionFile(target.session, row.cwd ?? "", { fresh: true });
      if (!file) return socket.destroy();
      return wss.handleUpgrade(req, socket, head, ws => serveTranscript(ws, ch[1], target.harness === "codex" ? codexTranscriptOf(file) : transcriptOf(file), target));
    }
  }
  if (ch && !paneOf.has(ch[1]) && !serviceByRow.has(ch[1])) {
    try { await listAgents(); } catch { return socket.destroy(); }
  }
  if (ch && !paneOf.has(ch[1]) && successor.get(ch[1])) {
    // A chat reopened on a terminal that has gone: tell it where its row lives now (ab-151).
    const heir = successor.get(ch[1])!;
    return wss.handleUpgrade(req, socket, head, (ws) => {
      ws.send(JSON.stringify({ t: "moved", id: heir }));
      ws.close();
    });
  }
  if (ch && codexAppThread(ch[1])) {
    // A Codex desktop chat: followed live from its rollout file, read-only (the app holds the thread's writer).
    const file = codexFile(codexAppThread(ch[1])!);
    if (!file) return socket.destroy();
    return wss.handleUpgrade(req, socket, head, (ws) => serveTranscript(ws, ch[1], codexTranscriptOf(file)));
  }
  if (ch) {
    const serviceName = serviceByRow.get(ch[1]) ?? (ch[1].startsWith("service-") ? ch[1].slice(8) : undefined);
    if (serviceName) {
      // A service row represents a pane-less seat. A same-named pane host owns a different chat.
      // Fail closed when more than one registered seat could own this identity, including during replacement.
      const matches = (await listServiceHosts({ dir: HOSTS_DIR }).catch(() => [])).filter(h => h.name === serviceName && !h.pane);
      if (matches.length !== 1 || !["live", "asleep"].includes(matches[0].state)) return socket.destroy();
      const service = matches[0];
      if (service.state === 'asleep') return wss.handleUpgrade(req, socket, head, ws => sleepingChat(ws, ch[1], service));
      return wss.handleUpgrade(req, socket, head, ws => passThrough(ws, `ws://127.0.0.1:${service.port}/ws?token=${encodeURIComponent(service.token)}`, undefined, { adapter: 'native', agentId: ch[1], by: service.name, sessionId: null }));
    }
    const host = hostsByPane().get(paneOf.get(ch[1]) ?? "");
    if (host) {
      // Cached terminal routing must not open a new owner's host after a pane is reused.
      // The regular agent refresh can establish a new session before the client reconnects.
      const session = sessionOf.get(ch[1]);
      if (!session || host.session !== session) return socket.destroy();
      if (host.state === 'asleep') {
        const matches = (await listServiceHosts({dir:HOSTS_DIR})).filter(h => h.pane === host.pane && h.session === session && h.state === 'asleep');
        if (matches.length !== 1) return socket.destroy();
        return wss.handleUpgrade(req, socket, head, ws => sleepingChat(ws, ch[1], matches[0]));
      }
      return wss.handleUpgrade(req, socket, head, (ws) => passThrough(ws, `ws://127.0.0.1:${host.port}/ws?token=${encodeURIComponent(host.token)}`, host.pane ?? undefined, { adapter: 'native', agentId: ch[1], by: nameOf.get(ch[1]) ?? ch[1], sessionId: null }));
    }
    const session = sessionOf.get(ch[1]);
    // A Codex worker's chat comes from its own session file (T8), a Claude agent's from Claude's.
    const codex = toolOf.get(ch[1]) === "codex";
    // Opening a chat re-checks every Claude folder: the newest copy of a moved session wins.
    const file = session ? (codex ? codexFile(session) : sessionFile(session, cwdOf.get(ch[1]) ?? "", { fresh: true })) : null;
    if (!file) return socket.destroy();
    return wss.handleUpgrade(req, socket, head, (ws) => serveTranscript(ws, ch[1], codex ? codexTranscriptOf(file) : transcriptOf(file)));
  }
  // An ended agent's chat, read back from its session file: read-only (only "older" pages are answered).
  const en = (req.url ?? "").match(/^\/ended\/([A-Za-z0-9_-]+)\/ws/);
  if (en) {
    const rec = listEnded(500).find((r) => r.id === en[1]);
    const file = !rec?.session ? null : rec.tool === "codex" ? codexFile(rec.session) : sessionFile(rec.session, rec.cwd, { fresh: true });
    if (!rec || !file) return socket.destroy();
    return wss.handleUpgrade(req, socket, head, (ws) => {
      const t: ChatSource = rec.tool === "codex" ? codexTranscriptOf(file) : transcriptOf(file);
      t.catchUp();
      const win = chatWindow(t.log as ChatEv[], t.older ? t : null);
      const send = (m: unknown) => sendDeliveredChat(ws, m, { adapter: 'legacy', agentId: `ended-${rec.id}`, sessionId: rec.session!, by: rec.name }, reviewDeliveryOptions);
      send({ t: "hello", name: rec.name, session: rec.session, state: "idle", log: win.shown, before: win.before, more: win.more, partial: {}, tasks: [], bg: [], source: "ended" });
      ws.on("message", (raw) => {
        try {
          const m = JSON.parse(String(raw));
          if (m?.t === "older") send(olderPage(m, win.stash, t.older ? t : null));
        } catch {
          /* not JSON: ignored, nothing is ever sent to an ended agent */
        }
      });
    });
  }
  const sh = (req.url ?? "").match(/^\/shell\/([A-Za-z0-9_-]+)\/ws/);
  if (sh) return wss.handleUpgrade(req, socket, head, (ws) => attach(ws, (size) => pty.spawn(SHELL, ["-l"], { name: "xterm-256color", cols: size.columns, rows: size.rows, cwd: homedir(), env: childEnv })));
  socket.destroy();
});

/**
 * A terminal agent's chat, read from its session file: the same events siso-host sends, so the app draws it the same.
 * What he types goes into the agent's pane through herdr as if typed there (several lines as one bracketed paste, so
 * Claude Code takes them as one message); Stop is Escape. The state comes from herdr, refreshed while anyone watches.
 */
const watching = new Set<() => void>();
let watchTimer: NodeJS.Timeout | null = null;
function watchStates(fn: () => void) {
  watching.add(fn);
  watchTimer ??= setInterval(async () => {
    try {
      await listAgents();
    } catch {
      /* herdr busy: next tick */
    }
    for (const f of watching) f();
  }, AGENTS_MS);
  return () => {
    watching.delete(fn);
    if (!watching.size && watchTimer) (clearInterval(watchTimer), (watchTimer = null));
  };
}
// Shared by every viewer of a pane: a paste and its delayed Enter are one send.
const paneSends = new Map<string, Promise<void>>();
/**
 * R1.20 (Shaan 21:30: a message "sometimes never sends"): a herdr call that fails is tried once more before the send
 * is called failed, and a send's outcome (sent / unsent) is kept for 10 minutes and told to every socket of that chat,
 * including one opened after the socket that sent it closed; the app matches it to its pending row by key.
 */
async function herdrOnceMore(args: string[], before?: () => Promise<unknown>): Promise<string> {
  try {
    return await herdr(args);
  } catch {
    await new Promise((r) => setTimeout(r, 400));
    // The pane may have changed hands while the first try failed (overnight QA retry-identity): look again first.
    await before?.();
    return herdr(args);
  }
}
const ACK_MS = 600_000;
const acks = new Map<string, { id: string; at: number; msg: { t: string; key: string; error?: string } }>();
const ackSubs = new Set<(id: string, msg: unknown) => void>();
function ack(id: string, msg: { t: string; key: string; error?: string }) {
  for (const [k, a] of acks) if (Date.now() - a.at > ACK_MS) acks.delete(k);
  acks.set(msg.key, { id, at: Date.now(), msg });
  for (const fn of ackSubs) fn(id, msg);
}
type ChatSource = { log: Record<string, unknown>[]; turnOut?: number; catchUp(): void; subscribe(fn: (e: any) => void): () => void; expectImages?(names: string[]): void; file?: string; head?: number; older?(before: number, want?: number): { events: ChatEv[]; before: number } };
const reviewDeliveryOptions = { onCaptured: invalidateReviewsCache, onError: () => console.warn('A delivered review link could not be recorded; review history may be incomplete.') };
function serveTranscript(ws: WebSocket, id: string, t: ChatSource, conversationTarget?: ConversationPinTarget) {
  t.catchUp();
  const word = () => (statusOf.get(id) === "working" ? "working" : statusOf.get(id) === "needs" ? "blocked" : "idle");
  let state = word();
  const reviewIdentity: ChatDeliveryIdentity = { adapter: 'legacy', agentId: id, sessionId: conversationTarget?.session ?? sessionOf.get(id) ?? codexAppThread(id) ?? null, by: nameOf.get(id) ?? id };
  const send = (m: unknown) => sendDeliveredChat(ws, m, reviewIdentity, reviewDeliveryOptions);
  let win = chatWindow(t.log as ChatEv[], t.older ? t : null);
  const snapshot = (replaced = false) => {
    if (replaced) win = chatWindow(t.log as ChatEv[], t.older ? t : null);
    send({ t: "hello", name: nameOf.get(id) ?? "", session: conversationTarget?.session ?? sessionOf.get(id) ?? null, state, log: win.shown, before: win.before, more: win.more, partial: {}, tasks: [], bg: [], source: "terminal", replaced });
    send({ t: "usage", out: t.turnOut ?? 0 }); // R1.19: the live line's ↓ tokens this turn
  };
  snapshot();
  const off = t.subscribe((e) => e.t === "reset" ? snapshot(true) : send(e));
  // Sends this chat made that the socket closed before it could hear about: told now (R1.20, a send must not vanish).
  for (const a of acks.values()) if (a.id === id && Date.now() - a.at < ACK_MS) send(a.msg);
  const onAck = (who: string, msg: unknown) => who === id && send(msg);
  ackSubs.add(onAck);
  // R1.20: a resume, a /clear or a relay gives the pane a new session (or a siso-host): close with a code, and the app
  // reopens the chat on the new one (it reconnects on any close). The socket used to stay on the file it opened with.
  const opened = conversationTarget?.session ?? sessionOf.get(id) ?? null;
  // A file that stops growing while its agent works may have been left behind (the session moved to another login):
  // look again, and if a newer copy exists close this socket, so the chat reopens on it.
  const STALE = Number(process.env.AB_STALE_MS ?? 20_000);
  let size = -1;
  let still = Date.now();
  const unwatch = watchStates(() => {
    const s = word();
    if (s !== state) send({ t: "state", state: (state = s) });
    const nowSession = sessionOf.get(id) ?? null;
    if ((opened && nowSession && nowSession !== opened) || hostsByPane().has(paneOf.get(id) ?? "")) return void ws.close(4002, "the agent moved to a new session");
    if (!t.file || toolOf.get(id) === "codex") return;
    let now = -1;
    try {
      now = statSync(t.file).size;
    } catch {}
    if (now !== size) (size = now), (still = Date.now());
    else if (state === "working" && Date.now() - still > STALE) {
      still = Date.now();
      const session = sessionOf.get(id);
      const newest = session ? sessionFile(session, cwdOf.get(id) ?? "", { fresh: true }) : null;
      if (newest && newest !== t.file) ws.close(4001, "the session moved to a newer file");
    }
  });
  ws.on("message", async (raw) => {
    let m: any;
    try {
      m = JSON.parse(String(raw));
    } catch {
      return;
    }
    if (m.t === "older") return void send(olderPage(m, win.stash, t.older ? t : null));
    // R1.20c (D8): Stop on a terminal agent's sub-agent. Nothing outside Claude Code can stop one of its background
    // tasks, so the agent is asked in its own pane to TaskStop it by id; it reads the line at its next step.
    if (m.t === "stop_task") {
      if (typeof m.id !== "string" || !/^[A-Za-z0-9_-]{4,64}$/.test(m.id)) return;
      const what = typeof m.name === "string" ? m.name.replace(/["\s]+/g, " ").trim().slice(0, 80) : "";
      m = { t: "prompt", text: `Stop the background task ${m.id}${what ? ` ("${what}")` : ""} now with TaskStop: Shaan stopped it from Agent Base.` };
    }
    // Controls need the same fresh identity as prompts, even before the next display refresh.
    if (m.t === "prompt" || m.t === "interrupt") {
      try {
        await listAgents(0);
      } catch {
        const error = "Could not verify this agent is still running; nothing was typed. Try sending again.";
        send({ t: "note", text: error, at: Date.now() });
        if (m.key) ack(id, { t: "unsent", key: String(m.key).slice(0, 64), error });
        return;
      }
    }
    let pane = paneOf.get(id);
    if (!pane) {
      const heir = successor.get(id);
      if (!conversationTarget && heir && paneOf.get(heir)) {
        send({ t: "moved", id: heir });
        pane = paneOf.get(heir)!;
      } else {
        send({ t: "note", text: "This agent has ended; nothing was typed.", at: Date.now() });
        if (m.t === "prompt" && m.key) send({ t: "unsent", key: m.key, error: "This agent has ended; nothing was typed." });
        return;
      }
    }
    // The recipient is its pane and its session: a new session in the same pane (or the same terminal) is someone else.
    const ownerNow = () => (paneOf.get(id) ? id : conversationTarget ? undefined : successor.get(id));
    const verifyRecipient = async () => {
      const agents = await listAgents(0);
      const who = ownerNow();
      // Bind to the session this chat opened, not a replacement adopted at message arrival.
      // Use the fresh row: sessionOf may retain the last known session when herdr omits it.
      const current = agents.find((a) => a.id === who);
      if ((conversationTarget && !matchesConversationTarget(conversationTarget, agents, id)) || !opened || current?.pane !== pane || current.session !== opened || current.host) throw new Error("This agent moved or ended while the message waited; nothing more was typed. Try sending again.");
    };
    const deliver = async () => {
      try {
        const images = (Array.isArray(m.images) ? m.images : []).map((p: unknown) => uploadPath(UPLOADS, p)).filter((p: string | null): p is string => p !== null);
        if (m.t === "prompt" && typeof m.text === "string" && (m.text.trim() || images.length)) {
          // A queued paste can outlive the agent that was checked when it arrived.
          await verifyRecipient();
          // Images go in as their paths, pasted: Claude Code reads an image path the way it takes a dragged-in file.
          const text = [m.text.slice(0, 100_000), ...images].filter(Boolean).join("\n");
          t.expectImages?.(images.map((p: string) => path.basename(p)));
          // Long or several-line messages (his dictation runs to thousands of characters) go in as one bracketed paste,
          // and Enter waits for the paste to settle: sent at once, Enter landed mid-paste and cut him off (2 Oct 14:20).
          const paste = text.length > 200 || text.includes("\n") || images.length > 0;
          await herdrOnceMore(["pane", "send-text", pane, paste ? `\x1b[200~${text}\x1b[201~` : text], verifyRecipient);
          await new Promise((r) => setTimeout(r, paste ? Math.min(4000, 300 + text.length / 4) : 60));
          await verifyRecipient();
          await herdrOnceMore(["pane", "send-keys", pane, "Enter"], verifyRecipient);
          // The app shows the message at once and needs to know it reached the pane (t-0105).
          if (m.key) ack(id, { t: "sent", key: String(m.key).slice(0, 64) });
        } else if (m.t === "interrupt") {
          await verifyRecipient();
          await herdr(["pane", "send-keys", pane, "esc"]);
        }
      } catch (e) {
        const error = `Could not type into the pane: ${String((e as Error).message).slice(0, 200)}`;
        send({ t: "note", text: error, at: Date.now() });
        if (m.t === "prompt" && m.key) ack(id, { t: "unsent", key: String(m.key).slice(0, 64), error });
      }
    };
    if (m.t === "prompt") {
      const next = (paneSends.get(pane) ?? Promise.resolve()).then(deliver);
      paneSends.set(pane, next);
      await next;
      if (paneSends.get(pane) === next) paneSends.delete(pane);
    } else await deliver(); // Escape must remain immediate while a paste settles.
  });
  ws.on("close", () => {
    off();
    unwatch();
    ackSubs.delete(onAck);
  });
}

/** siso-host, the SDK chat (services/host). AB_HOST_BIN points checks at a fake that records its argv. */
const SISO_HOST = process.env.AB_HOST_BIN ?? path.resolve(import.meta.dirname, "../../host/bin/siso-host");
/** The lean boot every herdr agent's launcher adds (siso-harness-lab agent-boot.sh): its settings and hooks, as R1.18. */
const AGENT_BOOT = process.env.AB_AGENT_BOOT ?? path.join(homedir(), "SISO_Workspace/SISO_Agents/siso-harness-lab/config/agent-boot.json");
/** The Claude login a new agent starts on: the node's own, else the agents' launcher's (claude-siso-3). */
const NEW_AGENT_CLAUDE_DIR = process.env.AB_NEW_AGENT_CLAUDE_DIR ?? process.env.CLAUDE_CONFIG_DIR ?? path.join(homedir(), ".config/claude-siso-3");
const q = (v: string) => `'${v.replace(/'/g, `'\\''`)}'`;

/**
 * The one siso-host command line the app types into a pane, for a new agent and for a move alike: the agent boot settings
 * (--settings) and herdr's env kept (--keep-herdr-env), so its hooks run and SendMessage/a0-tell reach it as in the CLI.
 */
function hostCommand(o: { name: string; resume?: string; model?: string; bypass?: boolean; settings?: string; claudeDir?: string; promptFile?: string; receipt?: string }): string {
  const settings = o.settings ?? (existsSync(AGENT_BOOT) ? AGENT_BOOT : undefined);
  const env = ["env", "-u", "CLAUDE_CODE_CHILD_SESSION", "CLAUDE_CODE_FORCE_SESSION_PERSISTENCE=1", "ENABLE_CLAUDEAI_MCP_SERVERS=false", ...(o.claudeDir ? [`CLAUDE_CONFIG_DIR=${o.claudeDir}`] : []), ...(o.receipt ? [`AB_WORKSPACE_RECEIPT=${o.receipt}`] : [])];
  const argv = [
    SISO_HOST, ...(o.resume ? ["--resume", o.resume] : []), "--name", o.name, ...(o.model ? ["--model", o.model] : []),
    ...(o.bypass ? ["--permission-mode", "bypassPermissions"] : []), ...(settings ? ["--settings", settings] : []), "--keep-herdr-env",
  ];
  return [...env, ...argv].map(q).join(" ") + (o.promptFile ? ` --prompt "$(cat ${q(o.promptFile)})"` : "");
}

/**
 * "Move to the app's chat" (2 Oct 14:10): a Claude agent running in the plain terminal moves under siso-host in the
 * same pane, the same session: at a clean break (not while it works) the CLI is sent /exit, and once the shell is back
 * `siso-host --resume <session>` starts there with the name, the flags and the Claude login the CLI had. Returns why
 * not, or null.
 */
async function moveToHost(id: string): Promise<string | null> {
  await listAgents();
  const pane = paneOf.get(id);
  const session = sessionOf.get(id);
  if (!pane || !session) return "no Claude session for this agent";
  if (hostsByPane().has(pane)) return "already in the app's chat";
  if (statusOf.get(id) === "working") return "it is working: move it at a clean break";
  // The CLI among the pane's foreground processes (it starts children, caffeinate first among them).
  const isClaude = (x: any) => x?.argv0 === "claude" || /\/claude$/.test(x?.argv?.[0] ?? "");
  const fg = async () => {
    const list: any[] = JSON.parse(await herdr(["pane", "process-info", "--pane", pane])).result?.process_info?.foreground_processes ?? [];
    return list.find(isClaude) ?? null;
  };
  const p = await fg();
  const argv: string[] = p?.argv ?? [];
  if (!p) return "the pane is not running the Claude CLI";
  const after = (f: string) => (argv.includes(f) && !argv[argv.indexOf(f) + 1]?.startsWith("-") ? argv[argv.indexOf(f) + 1] : undefined);
  const model = after("--model");
  const bypass = argv.includes("--dangerously-skip-permissions") || argv.join(" ").includes("--permission-mode bypassPermissions");
  // The CLI's own settings file (its launcher's agent boot), relative to where it runs; else the agent boot.
  const set = after("--settings");
  const settings = set ? path.resolve(cwdOf.get(id) ?? homedir(), set) : undefined;
  // The login whose folder holds the session: a shell's own CLAUDE_CONFIG_DIR is not the launcher's, so --resume
  // would look in the wrong folder.
  const file = sessionFile(session, cwdOf.get(id) ?? "", { fresh: true });
  const claudeDir = file ? path.dirname(path.dirname(path.dirname(file))) : undefined;
  await herdr(["pane", "send-text", pane, "/exit"]);
  await new Promise((r) => setTimeout(r, 150));
  await herdr(["pane", "send-keys", pane, "Enter"]);
  for (let i = 0; i < 50; i++) {
    await new Promise((r) => setTimeout(r, 300));
    const now = await fg().catch(() => p);
    if (!now) {
      await herdr(["pane", "run", pane, hostCommand({ name: nameOf.get(id) ?? "agent", resume: session, model, bypass, settings, claudeDir })]);
      return null;
    }
  }
  return "the CLI did not exit within 15 s";
}

let zeroStarting = false;
async function startZero() {
  throw new WorkspaceError("Create a distinct Claude chat with a name and explicit workspace. Replacing the standing Agent Zero seat is unavailable here.", 409);
}

/** Copy the chosen Claude turn under its original login, then supervise that exact copied session. */
async function forkChat(id: string, back: number): Promise<{ error: string; code: number } | { ok: true; name: string; started: boolean }> {
  const agents = await listAgents(0);
  const a = agents.find((x) => x.id === id);
  const session = sessionOf.get(id);
  const file = session ? sessionFile(session, cwdOf.get(id) ?? "", { fresh: true }) : null;
  if (!a || !session || !file) return { error: "no Claude session to fork", code: 404 };
  const cut = forkPoint(file, back);
  if (!cut) return { error: "no such turn", code: 404 };
  const claudeDir = file.includes(`${path.sep}projects${path.sep}`) ? file.slice(0, file.indexOf(`${path.sep}projects${path.sep}`)) : null;
  const cwd = cwdOf.get(id);
  const loginLauncher = claudeDir && ["claude", "claude-siso", "claude-siso-3"].find(login => path.resolve(supervisedConfigDir(login)) === path.resolve(claudeDir));
  const model = (await listServiceHosts({dir:HOSTS_DIR})).find(h => h.state === 'live' && (h.harness ?? 'claude') === 'claude' && h.session === session && h.cwd && cwd && path.resolve(h.cwd) === path.resolve(cwd))?.model;
  if (!cwd || !path.isAbsolute(cwd) || !existsSync(cwd) || !model || !claudeDir || !loginLauncher) return { error: "Fork requires the original working directory, model and supported Claude login", code: 409 };
  let fresh: string;
  try {
    fresh = (await run(path.resolve(import.meta.dirname, "../../host/bin/siso-fork"), [session, ...(cut.upTo ? [cut.upTo] : [""]), `${a.name} (fork)`], { timeout: 30000, cwd, env: { ...process.env, CLAUDE_CONFIG_DIR: claudeDir } })).stdout.trim().split("\n").at(-1) ?? "";
  } catch (e) {
    return { error: `could not fork: ${String((e as Error).message).split("\n")[0].slice(0, 160)}`, code: 502 };
  }
  if (!/^[A-Za-z0-9-]+$/.test(fresh)) return { error: "the fork gave no session", code: 502 };
  const base = a.name.replace(/[^A-Za-z0-9_-]+/g, "-").slice(0, 32);
  let name = `${base}-FORK`;
  for (let n = 2; agents.some((x) => x.name === name); n++) name = `${base}-FORK${n}`;
  try {
    const options = { name, harness: 'claude' as const, session: fresh, cwd, model, hostsDir: path.resolve(HOSTS_DIR), loginLauncher, transcriptFile: path.join(path.dirname(file), `${fresh}.jsonl`), permissionMode: 'bypassPermissions' as const };
    await resumeSupervisedSession(options, ({command,args,env}) => run(command,args,{timeout:10000,env:{...process.env,...env}}));
    await confirmSupervisedResume(options);
  } catch (e) {
    return { error: `Fork session ${fresh} retained: ${String((e as Error).message).split("\n")[0].slice(0, 160)}`, code: 409 };
  }
  agentsRead = null;
  return { ok: true, name, started: true };
}

/** One message to a chat by name: its host's socket if it runs, else reopen the parent's worker of that name with it. */
async function sayTo(parentId: string, name: string, text: string): Promise<{ error: string; code: number } | { ok: true; name: string; started: boolean }> {
  let host: Host | null = null;
  try {
    for (const f of readdirSync(HOSTS_DIR).filter((x) => x.endsWith(".json"))) {
      try { const h = JSON.parse(readFileSync(path.join(HOSTS_DIR, f), "utf8")) as Host; if (h.name.toUpperCase() === name.toUpperCase()) { process.kill(h.pid, 0); host = h; break; } } catch { /* gone or partial */ }
    }
  } catch { /* no hosts yet */ }
  if (host) {
    const h = host;
    const sent = await new Promise<boolean>((done) => {
      const ws = new WebSocket(`ws://127.0.0.1:${h.port}/ws?token=${h.token}`);
      const t = setTimeout(() => { ws.terminate(); done(false); }, 5000);
      ws.on("open", () => ws.send(JSON.stringify({ t: "prompt", text }), (e) => { clearTimeout(t); setTimeout(() => ws.close(), 200); done(!e); }));
      ws.on("error", () => { clearTimeout(t); done(false); });
    });
    return sent ? { ok: true, name: h.name, started: false } : { error: `${h.name}'s chat did not take the message`, code: 502 };
  }
  if (!parentId) return { error: `no open chat named ${name}`, code: 404 };
  const parent = (await listAgents(0)).find((a) => a.id === parentId);
  if (!parent) return { error: "no such agent", code: 404 };
  const row = listSubagents(parent, await listAgents(0)).rows.find((r) => (r.name ?? "").toUpperCase() === name.toUpperCase());
  if (!row) return { error: `${parent.name} has no worker named ${name}`, code: 404 };
  return talkTo(parentId, row.toolUseId ?? row.id, text);
}

/**
 * A finished Codex worker resumes its exact thread through the supervised native host. Name alone
 * is never conversation identity. Claude subagents still require a separate fresh workspace launch.
 */
async function talkTo(parentId: string, key: string, say?: string): Promise<{ error: string; code: number } | { ok: true; name: string; started: boolean }> {
  const agents = await listAgents(0);
  const parent = agents.find((a) => a.id === parentId);
  if (!parent) return { error: "no such agent", code: 404 };
  const clean = (n: string) => n.replace(/[^A-Za-z0-9_.-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "WORKER";
  if (key.startsWith("run:")) {
    const workerRun = readCodexRuns().find((r) => `run:${r.id}` === key);
    if (!workerRun) return { error: "no such Codex run", code: 404 };
    const name = clean(workerRun.worker ?? workerRun.name).replace(/\./g, '-');
    if (workerRun.running) return { error: `${name} is still working; you can talk to it as soon as it finishes`, code: 409 };
    const thread = runThread(workerRun.id);
    if (!thread) return { error: `${name} left no Codex thread to reopen`, code: 410 };
    const cwd = workerRun.dir;
    const model = workerRun.model;
    if (!cwd || !path.isAbsolute(cwd) || !existsSync(cwd) || !model?.trim() || model.startsWith('-')) return { error: `${name} needs its original working directory and model before it can resume`, code: 409 };
    const existing = (await listServiceHosts({dir:HOSTS_DIR})).find(h => h.name === name);
    if (!existing && agents.some(a => a.name === name)) return { error: `${name} is already owned by another chat`, code: 409 };
    try {
      const options = { name, harness: 'codex' as const, session: thread, cwd, model, hostsDir: path.resolve(HOSTS_DIR) };
      if (!existing) await resumeSupervisedSession(options, ({command,args,env}) => run(command,args,{timeout:10000,env:{...process.env,...env}}));
      await confirmSupervisedResume(options, say);
    } catch (e) {
      return { error: `${name}: ${String((e as Error).message).split("\n")[0].slice(0, 180)}`, code: 409 };
    }
    agentsRead = null;
    return { ok: true, name, started: !existing };
  }
  const rows = (await listSubagents(parent, agents)).rows;
  const row = rows.find((r) => r.toolUseId === key || r.id === key);
  if (!row) return { error: "no such sub-agent", code: 404 };
  if (row.agentId) return { ok: true, name: agents.find((a) => a.id === row.agentId)?.name ?? row.name ?? key, started: false };
  return { error: "This Claude subagent has no standalone resumable session. Start a new chat with an explicit workspace choice to carry its context forward.", code: 409 };
}

function launchRepo(b: any): string {
  const p=registry.projects.find(p=>p.id===b.repo || p.name===b.project);
  const repo=p?.path ?? (typeof b.repo === "string" ? b.repo : undefined);
  if(!repo)throw new WorkspaceError("Choose a repository for this editing task",400);
  return repo;
}
const fixtureHosts = new Set<ReturnType<typeof spawn>>();
// A take being written when a deploy stops this node finishes first (up to 15 s, inside launchd's 20 s): 9 Oct 04:38 a
// 3-minute note was cut mid-write and waited an hour.
for(const signal of ["SIGTERM","SIGINT"] as const)process.once(signal,()=>{stopPreparations();for(const child of fixtureHosts)child.kill("SIGTERM");void dictationSettled(15_000).then(()=>setTimeout(()=>process.exit(0),2500).unref());});
const workspaceAdapters: LaunchAdapters = {
  beforeStart: async r => {
    if (await taskActions.automaticAllocationOwnership(r) === 'ordinary') return undefined;
    if (r.input.harness !== 'codex' || r.input.backendCatalogId || !r.input.writer) throw new WorkspaceError('Automatic allocation provenance changed',409);
    const gate = await currentResourceAdmission({repo:r.worktreePath,model:r.input.model});
    if (!gate.ok || !('launchEnvironment' in gate)) throw new WorkspaceError(gate.reason || 'Current resource admission denied the launch',429);
    return gate.launchEnvironment;
  },
  find: async r=> {
    const host=(await listServiceHosts({dir:HOSTS_DIR})).find(h=>h.name===r.name && h.state==="live" && h.session && h.cwd && path.resolve(h.cwd)===path.resolve(r.worktreePath));
    if(!host)return null;
    // Workspace reference in the host file is the ownership proof, rather than a display-name match.
    const saved=JSON.parse(readFileSync(host.file,"utf8"));
    if(saved.workspaceId!==r.workspaceId)throw new WorkspaceError("Host belongs to a different workspace");
    return {id:host.pane ? (await listAgents(0)).find(a=>a.pane===host.pane)?.id ?? `service-${host.name}` : `service-${host.name}`,session:host.session!,...(host.pane?{pane:host.pane}:{})};
  },
  start: async (r,file,trustedEnvironment)=> {
    const existing=(await listServiceHosts({dir:HOSTS_DIR})).find(h=>h.name===r.name);
    if(existing)throw new WorkspaceError("A chat with that name already exists; existing host preserved");
    if(r.input.harness==="claude") {
      if (process.env.AB_WORKTREE_FIXTURE === "1") throw new WorkspaceError("Claude supervised launch needs an explicit isolated lifecycle fixture");
      const profile = receiptClaudeProfile(r) ?? configuredClaudeProfile(NEW_AGENT_CLAUDE_DIR);
      return startSupervisedClaude(r, file, { loginLauncher: profile.loginLauncher, hostsDir: path.resolve(HOSTS_DIR), permissionMode: profile.permissionMode },
        ({command,args,env}) => run(command,args,{timeout:10000,env:{...process.env,...env}}));
    }
    const label=`com.siso.host-${r.name}`;
    if(process.env.AB_WORKTREE_FIXTURE === "1") {
      if(!process.env.AB_HOSTS_DIR || !process.env.AB_WORKSPACES_DIR || !process.env.AB_FIXTURE_REPO || r.repoPath!==path.resolve(process.env.AB_FIXTURE_REPO))throw new WorkspaceError("Fixture host isolation is required");
      const child=spawn(process.execPath,["--experimental-strip-types","--no-warnings",path.resolve(import.meta.dirname,"../../host/src/codex-host.ts"),"--name",r.name,"--model",r.input.model,"--cwd",r.worktreePath,"--sandbox","danger-full-access","--approval","never"],{stdio:"ignore",env:{...process.env,...trustedEnvironment,AB_WORKSPACE_RECEIPT:file,HERDR_ENV:"0"}});
      fixtureHosts.add(child);child.once("exit",()=>fixtureHosts.delete(child));child.once("error",()=>fixtureHosts.delete(child));return {};
    }
    await run(path.resolve(import.meta.dirname,"../../host/bin/siso-host-service"),["install","--harness","codex","--name",r.name,"--label",label,"--model",r.input.model,"--cwd",r.worktreePath],{timeout:10000,env:{...process.env,...trustedEnvironment,AB_WORKSPACE_RECEIPT:file}});
    return {label};
  },
};
const taskActions = createTaskActionsHandler({
  read: a0Tasks, write: a0TaskWrite, projects: () => registry.projects,
  adapters: workspaceAdapters, admit: currentResourceAdmission,
});

async function startAgent(_body: unknown): Promise<{ error: string; code: number }> {
  return { error: "Choose a repository and an explicit workspace, then start with a durable launch identity. Legacy no-workspace starts are unavailable.", code: 409 };
}

/**
 * A host seat's live state, from the chats open on it (QA P0-3, A0 3 Oct): herdr stopped listing Agent Zero's pane at
 * 00:47, and a seat herdr does not list was drawn "idle" while it worked. The host's hello and its {t:"state"} messages
 * say what it is doing; with no chat open on it nothing is known and it reads idle as before.
 */
const hostStates = new Map<string, { state: string; n: number }>();
function watchHostState(pane: string) {
  const cur = hostStates.get(pane) ?? { state: "", n: 0 };
  cur.n++;
  hostStates.set(pane, cur);
  const set = (s: unknown) => {
    if (s === "idle" || s === "working" || s === "blocked") cur.state = s;
  };
  let open = true;
  return {
    set,
    saw: (text: string) => { try { set(JSON.parse(text).state); } catch { /* not JSON */ } },
    done: () => { if (open && !--cur.n) hostStates.delete(pane); open = false; },
  };
}

/** The app's chat socket, joined to a host's: messages pass both ways; either side closing closes the other. */
function sleepingChat(ws: WebSocket, id: string, host: import('./service-hosts.ts').ServiceHost, target?: ConversationPinTarget) {
  const file = host.session ? host.harness === 'codex' ? codexFile(host.session) : sessionFile(host.session, host.cwd ?? '', { fresh: true }) : null;
  let log: unknown[] = [], source: ChatSource | null = null;
  if (file) { source = host.harness === 'codex' ? codexTranscriptOf(file) : transcriptOf(file); source.catchUp(); log = source.log; }
  if (!file) log = [{ t: 'note', text: 'History not available while asleep; wake to load', at: Date.now() }];
  serveAsleepChat(ws, host, log, (next, frames) => passThrough(ws, `ws://127.0.0.1:${next.port}/ws?token=${encodeURIComponent(next.token)}`, next.pane ?? undefined, { adapter: 'native', agentId: id, by: host.name, sessionId: host.session }, target, frames), source?.older ? source : null);
}
function passThrough(ws: WebSocket, target: string, pane: string | undefined, reviewIdentity: ChatDeliveryIdentity, conversationTarget?: ConversationPinTarget, initialFrames: string[] = []) {
  const up = new WebSocket(target);
  const seat = pane ? watchHostState(pane) : null;
  const early: string[] = [...initialFrames];
  // The host's hello carries its whole log (up to 4000 events): the chat gets its last page, the rest waits here.
  let stash: ChatEv[] | null = null;
  let reviewSession: string | null = null;
  let verified = !conversationTarget;
  let rejected = false;
  const reject = () => {
    rejected = true;
    early.length = 0;
    ws.close(4003, "Pinned conversation changed or is unavailable");
    up.close();
  };
  up.on("open", () => { if (verified) early.splice(0).forEach((m) => up.send(m)); });
  up.on("message", (d) => {
    if (rejected || ws.readyState !== ws.OPEN) return;
    let text = d.toString();
    let frame: unknown = null;
    try { frame = JSON.parse(text); } catch { /* Malformed wire data is forwarded without capture. */ }
    if (conversationTarget) {
      const message = frame && typeof frame === 'object' ? frame as Record<string, unknown> : null;
      // No history, state, capture or client controls cross the metadata-to-socket race before proof.
      // Re-check hello and init, including a session reset on an existing host connection.
      if (!message || (!verified && message.t !== 'hello') || message.t === 'moved' || message.t === 'hello' && (message.session !== conversationTarget.session || message.replaced) || message.t === 'init' && message.session !== conversationTarget.session) return reject();
      if (message.t === 'hello') verified = true;
    }
    if (frame && typeof frame === 'object' && 't' in frame) {
      const message = frame as Record<string, unknown>;
      if (message.t === 'state') seat?.set(message.state);
      if (message.t === 'hello') {
        // Session and older-page stash belong to the same parsed hello, regardless of JSON key order.
        reviewSession = typeof message.session === 'string' ? message.session : null;
        seat?.set(message.state);
        const win = chatWindow(Array.isArray(message.log) ? message.log : [], null);
        stash = win.stash;
        frame = { ...message, log: win.shown, before: win.before, more: win.more };
        text = JSON.stringify(frame);
      }
    }
    if (Buffer.byteLength(text) > 2 * 1024 * 1024) frame = null;
    sendDeliveredChat(ws, frame, { ...reviewIdentity, sessionId: reviewSession }, reviewDeliveryOptions, text);
    if (verified && up.readyState === up.OPEN) early.splice(0).forEach(m => up.send(m));
  });
  ws.on("message", (d) => {
    if (rejected) return;
    const text = d.toString();
    if (!verified) { early.push(text); return; }
    if (text.startsWith('{"t":"older"')) {
      try {
        return sendDeliveredChat(ws, olderPage(JSON.parse(text), stash ?? [], null), { ...reviewIdentity, sessionId: reviewSession }, reviewDeliveryOptions);
      } catch {
        return;
      }
    }
    if (up.readyState === up.OPEN) up.send(text);
    else early.push(text);
  });
  const end = () => {
    try { ws.close(); } catch { /* gone */ }
    try { up.close(); } catch { /* gone */ }
  };
  up.on("close", end);
  if (seat) up.on("close", seat.done);
  up.on("error", end);
  ws.on("close", end);
}

/** One terminal over one socket: `start` makes the pty at the client's size (an agent's terminal, or a shell). */
function attach(ws: WebSocket, start: (size: { columns: number; rows: number }) => pty.IPty) {
  let term: pty.IPty | null = null;
  ws.on("message", (data: Buffer, isBinary) => {
    if (!term) {
      // The handshake: the client's measured size, so the agent draws at the width it will be shown.
      let size = { columns: 120, rows: 36 };
      try { size = { ...size, ...JSON.parse(data.toString()) }; } catch { /* keep the default */ }
      term = start(size);
      term.onData((chunk) => ws.readyState === ws.OPEN && ws.send(Buffer.concat([Buffer.from("0"), Buffer.from(chunk, "utf8")])));
      term.onExit(() => ws.close());
      return;
    }
    const buf = isBinary ? data : Buffer.from(data.toString(), "utf8");
    const cmd = String.fromCharCode(buf[0]);
    // Typed text arrives as a text frame (UTF-8); mouse reports arrive as binary frames of raw bytes.
    if (cmd === "0") term.write(buf.subarray(1).toString(isBinary ? "latin1" : "utf8"));
    else if (cmd === "1") {
      try { const { columns, rows } = JSON.parse(buf.subarray(1).toString()); if (columns > 0 && rows > 0) term.resize(columns, rows); } catch { /* ignore a bad resize */ }
    }
  });
  ws.on("close", () => { try { term?.kill(); } catch { /* already gone */ } });
}

/**
 * Started by the desktop app, the node lives only as long as the app: AB_PARENT_PID is the app's pid, and once it is
 * gone (quit, crash or kill) the node exits too, so no orphan keeps the port or an attached terminal.
 */
const PARENT = Number(process.env.AB_PARENT_PID);
if (PARENT > 0) {
  setInterval(() => {
    try {
      process.kill(PARENT, 0);
    } catch {
      process.exit(0);
    }
  }, 1000).unref();
}

function usageDirectories() {
  const dirs = [defaultClaudeDir(), ...claudeUsageDirs()];
  try { for (const file of readdirSync(HOSTS_DIR)) { try { const h = JSON.parse(readFileSync(path.join(HOSTS_DIR, file), "utf8")); if (h.configDir) dirs.push(h.configDir); } catch {} } } catch {}
  return [...new Set(dirs)];
}
claudeUsage.start(usageDirectories);
server.listen(PORT, HOST, () => (warmServers(), console.log(`agent-base node on http://${HOST}:${PORT} · herdr: ${HERDR.join(" ")}`)));
// SISO Voice stays up while Agent Base is open (t-0271): launchd checked now and every 60 s (voice-health.ts).
void recoverOwnership().finally(startVoiceWatch);
