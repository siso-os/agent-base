import { createIdleSleep, readSleepHost } from './idle-sleep.ts';
import { readModelSettings, saveModelSettings } from "./model-settings.ts";
import { CodexChildren, childIdentity, childTools } from "./codex-children.ts";
import { createRequire } from "node:module";
import { recordChangesBoundary } from "./changes-checkpoint.ts";
/**
 * siso-host: Claude Code through the Agent SDK, inside a herdr pane (Shaan, 2 Oct: "I don't really want stuff to show
 * 1 to 5 seconds late … I would low-key want to own maybe the input box").
 *
 * The SDK runs the real `claude` program without its screen and hands every word over as data. This host:
 *   - prints a readable transcript into the pane and reads what is typed there, so herdr-send and a person at the
 *     pane both still work;
 *   - reports its state and session to herdr as agent "siso" (herdr's docs: report under your own name; its own
 *     Claude hook would otherwise claim the pane and call it idle forever, so the child runs with HERDR_ENV=0);
 *   - serves the same stream to Agent Base on a local socket (127.0.0.1, a random port and a token, written to
 *     ~/.local/state/agent-base/hosts/<pane>.json), which gets the live chat, its own input box, Stop and approvals.
 * The chat is an ordinary Claude session: `claude --resume <id>` opens it in the normal terminal any time.
 *
 *   siso-host [--name NAME] [--model MODEL] [--effort low|medium|high|xhigh|max] [--resume SESSION]
 *             [--permission-mode MODE] [--prompt "first message"] [--settings FILE] [--keep-herdr-env]
 *   --name also names the Claude session (claude -n), --settings loads a settings file into it (claude --settings: how
 *   Agent Zero's agent-boot.json and its hooks come along), --keep-herdr-env leaves HERDR_ENV as the pane set it so the
 *   child's own herdr hooks run (by default the child gets HERDR_ENV=0, see below).
 *   --account fuzeheritage|lordsisodia runs the session from the one config home (~/.claude) on that account's long-lived
 *   token (Keychain siso-claude-oauth/<account>, made once by claude-token-login); refuses without one, so ~/.claude's own
 *   login (Fahmy's) is never used. The stack plugin (repo stack/plugin: siso:worker, siso:specker, siso:reviewer) loads
 *   by default; --no-stack skips it. Native-agents plan steps 4-5 (siso-harness-lab/.agents/plans/2026-10-02-native-agents.md).
 *   siso-host --replay SESSION [--name NAME]   shows an existing session read-only (no Claude runs): for checks
 *
 * Proven first by the 2 Oct test (siso-internal-labs-agents/.agents/research/2026-10-01-agent-app/t3-chat/host.mjs):
 * typed text 58 ms to the host, first word ~1 s (the model), herdr idle → working → idle.
 */
import { guardWorkspace } from "./worktree-contract.ts";
import { type CanUseTool, type PermissionResult, type Query, type SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import { execFile, execFileSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import http from "node:http";
import { homedir } from "node:os";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";
import { WebSocketServer, type WebSocket } from "ws";
import { type ToolInput, apiError, peerMessage, summarize, toolInput, toolOut } from "./events.ts";
import { readSeatLimits, type SeatLimits } from "./limits.ts";
import { uploadPath } from "./uploads.ts";
import { PromptQueue } from './prompt-queue.ts';
import { admitChildReturn, holdChildReturnDispatch } from './child-return.ts';
import { validatePrompt, type QueuedPrompt } from './delivery.ts';
import { Questions, normalizeQuestions } from './questions.ts';
import { AttentionCommands } from './attention-commands.ts';
import { ActivityJournal, classifyClaudeResult } from './activity.ts';
import { diskMessage, diskState, dropTemp, isNoSpace, noteNoSpace, onDisk, persist } from "./disk.ts";
import { safeName, sourceLabel } from "./service.ts";

// AB_HOST_SDK: a check can swap in a fake SDK (test/fake-sdk.mjs); unset, it is the real one.
const { query, getSessionMessages } = await import(process.env.AB_HOST_SDK ?? "@anthropic-ai/claude-agent-sdk") as typeof import("@anthropic-ai/claude-agent-sdk");

// ---------------------------------------------------------------- arguments and identity

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const NAMED = flag("name");
const NAME = NAMED ?? path.basename(process.cwd());
const workspaceReceipt = guardWorkspace(process.cwd(), NAME, flag("resume"));
const SETTINGS = flag("settings");
const KEEP_HERDR_ENV = args.includes("--keep-herdr-env");
const MODEL = flag("model");
const REPLAY = flag("replay");
const RESUME = flag("resume") ?? REPLAY;
const EFFORT = flag("effort");
const FIRST = flag("prompt");
const MODE = flag("permission-mode") as "default" | "acceptEdits" | "bypassPermissions" | "plan" | undefined;
const PANE = process.env.HERDR_ENV === "1" ? process.env.HERDR_PANE_ID : undefined;
const HERDR = process.env.HERDR_BIN_PATH || "herdr";
const HOSTS_DIR = process.env.AB_HOSTS_DIR ?? path.join(homedir(), ".local/state/agent-base/hosts");
const TOKEN = randomBytes(18).toString("base64url");

// 3 Oct 00:47: `siso-host --help` run from inside A0's pane started a second host there, and its exit released the pane's
// agent in herdr, so Agent Zero vanished while alive. Nothing below may report to herdr until these pass.
const VALUE_FLAGS = ["name", "settings", "model", "replay", "resume", "effort", "prompt", "permission-mode", "account"];
const BOOL_FLAGS = ["keep-awake", "keep-herdr-env", "no-stack", "chrome", "no-chrome"];
const USAGE = `usage: siso-host [--name N] [--resume ID | --replay ID] [--model M] [--effort E] [--prompt TEXT] [--settings FILE]
                 [--permission-mode MODE] [--account fuzeheritage|lordsisodia] [--keep-herdr-env] [--no-stack]\n`;
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === "--help" || a === "-h") (process.stdout.write(USAGE), process.exit(0));
  if (!a.startsWith("-")) continue;
  const name = a.replace(/^--/, "");
  if (VALUE_FLAGS.includes(name)) {
    const value = args[i + 1];
    // A value is required; a following long/known short option is a missing value, while
    // ordinary single-hyphen text (for example a prompt "-example") remains literal.
    if (value === undefined || value.startsWith("--") || value === "-h") {
      (process.stderr.write(`siso-host: ${a} requires a value\n${USAGE}`), process.exit(2));
    }
    i++;
  }
  else if (!BOOL_FLAGS.includes(name)) (process.stderr.write(`siso-host: unknown option ${a}\n${USAGE}`), process.exit(2));
}
// A pane holds one host: a second one would take over its herdr agent and release it on exit.
if (PANE) {
  try {
    const held = JSON.parse(readFileSync(path.join(HOSTS_DIR, `${PANE.replace(/[^A-Za-z0-9_-]/g, "_")}.json`), "utf8")) as { pid?: number };
    if (held.pid && held.pid !== process.pid) {
      process.kill(held.pid, 0);
      process.stderr.write(`siso-host: pane ${PANE} already runs a host (pid ${held.pid}); not starting a second one\n`);
      process.exit(2);
    }
  } catch {
    /* no live host in this pane */
  }
}
const CLAUDE_BIN = process.env.CLAUDE_BIN; // optional: the SDK finds claude itself otherwise
const ACCOUNT = flag("account");
const STACK = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../stack/plugin");
const PLUGINS = args.includes("--no-stack") || !existsSync(STACK) ? [] : [{ type: "local" as const, path: STACK }];

// One config home: the account's own token in ~/.claude, never a per-login folder and never ~/.claude's own login.
if (ACCOUNT) {
  if (!["fuzeheritage", "lordsisodia"].includes(ACCOUNT)) {
    process.stderr.write(`siso-host: --account ${ACCOUNT} refused (fuzeheritage | lordsisodia)\n`);
    process.exit(2);
  }
  let tok = "";
  try {
    tok = execFileSync("security", ["find-generic-password", "-s", "siso-claude-oauth", "-a", ACCOUNT, "-w"], { encoding: "utf8" }).trim();
  } catch {}
  if (!tok) {
    process.stderr.write(`siso-host: no token for ${ACCOUNT}; run: claude-token-login ${ACCOUNT}\n`);
    process.exit(3);
  }
  delete process.env.CLAUDE_CONFIG_DIR;
  process.env.CLAUDE_CODE_OAUTH_TOKEN = tok;
  process.env.SISO_ACCOUNT = ACCOUNT;
}

// ---------------------------------------------------------------- the event log (what the app draws)

export type ChatEvent =
  | import('./questions.ts').QuestionEvent
  | import('./delivery.ts').PromptReceipt
  | { t: 'queue.snapshot'; snapshot: import('./delivery.ts').QueueSnapshot; capabilities: import('./delivery.ts').DeliveryCapabilities }
  | { t: "init"; session: string; model: string | null; cwd: string; name: string; apiKeySource?: string | null }
  /** `from: "peer"`: another agent's message (Claude Code's cross-session messaging), `name` its sender. */
  /** `mid`: taken while Claude worked, so it belongs inside the running turn, not at the start of a new one. */
  | { t: "user"; id?: string; text: string; at: number; from: "app" | "pane" | "history" | "peer"; name?: string; mid?: boolean }
  /** Claude's thinking (summarized; empty when the model keeps it to itself) and how long it thought. */
  | { t: "thinking"; id: string; text: string; ms: number | null; at: number }
  /** Output tokens this turn so far (the CLI's "↓ 2.2k tokens"); live only. */
  | { t: "usage"; out: number; total?: number; rate?: number }
  /** a0-018: the context gauge, tokens in the window now over the window (the terminal agents' "N% ctx"); live only. */
  | { t: "context"; used: number; window: number; pct: number }
  /** Sent while Claude works: waits under the input box until Claude takes it at the next tool boundary ("user"). */
  | { t: "queued"; id: string; text: string; at: number }
  | { t: "unqueued"; id: string }
  | { t: "unqueue_failed"; id: string; text: string }
  /** `parent`: the Agent/Task call a sub-agent's message belongs to (the SDK's parent_tool_use_id); absent in the main chat. */
  | { t: "text"; id: string; text: string; at: number; parent?: string }
  | { t: "tool"; id: string; name: string; summary: string; input?: ToolInput; at: number; parent?: string }
  /** `out` is the head of the tool's result (a few lines, byte-capped); `lines` how many it had in all. */
  | { t: "tool_done"; id: string; ok: boolean; out?: string; lines?: number; at?: number; parent?: string }
  /** A sub-agent or background job, latest state (sent whole each time; the app keeps the last per id). */
  | { t: "task"; task: Task }
  /** What is still running in the background (shells, monitors), as the CLI's footer counts it. */
  | { t: "bg"; list: { id: string; kind: string; description: string }[] }
  | { t: "note"; text: string; at: number; label?: string; bad?: boolean }
  /** R1.20c: a usage limit or an API error (events.ts `apiError`), drawn as a card, never as Claude's words. */
  | ReturnType<typeof apiError>
  | { t: "state"; state: "idle" | "working" | "blocked" }
  | { t: "approval"; id: string; tool: string; summary: string }
  | { t: "approval_done"; id: string; allow: boolean }
  | { t: "result"; turnId?: string; status?: string; ms: number; cost: number | null; at: number }
  | { t: "commands"; list: { name: string; description: string; hint: string }[] };

export type Task = {
  id: string;
  tool: string | null;
  kind: string;
  description: string;
  hostName?: string;
  model?: string;
  background: boolean;
  status: string;
  startedAt: number;
  endedAt: number | null;
  tokens: number | null;
  tools: number | null;
  last: string | null;
  summary: string | null;
};
const log: ChatEvent[] = [];
/** Sub-agents and background jobs by task id, and the background list: live state, sent whole on connect. */
let idleSleep: ReturnType<typeof createIdleSleep> | undefined;
const tasks = new Map<string, Task>();
const children = new CodexChildren({ name: NAME, session: () => session, emit, task: task => upsertTask(task.id, task), returned: async input => {
  const { receipt, fresh } = admitChildReturn(queueStore, input);
  if (!fresh) return receipt;
  const admittedQueue = queueStore;
  emit(receipt); publishQueue();
  // Admission and provider consumption are separate. A replay only reads the
  // receipt; a held queue, Stop or shutdown must never be bypassed by a return.
  setImmediate(() => {
    try {
      if (!queueStore || queueStore !== admittedQueue || queueStore.snapshot().held || shuttingDown || child !== "running") return;
      const active = rootEpoch && !compacting ? rootEpoch : null;
      if (active) { const entry = queueStore.claim(input.messageId); if (entry) offerClaude(entry.text, entry.from, entry.images, entry.id); }
      publishQueue(); drainNext();
    } catch {
      try { if (admittedQueue) holdChildReturnDispatch(admittedQueue, input.messageId); } catch { /* Storage remains unavailable. */ }
      try { publishQueue(); } catch { /* Reporting must not replay a dispatch. */ }
      try { emit({ t: 'note', text: 'Child return admitted; parent dispatch unconfirmed. Inspect the parent queue.', bad: true, at: Date.now() }); } catch { /* Do not crash or replay on a reporting failure. */ }
    }
  });
  return receipt;
} });
// Reuse the SDK's installed Zod dependency; no new schema package.
const sdk = await import("@anthropic-ai/claude-agent-sdk");
const { z } = createRequire(import.meta.resolve("@anthropic-ai/claude-agent-sdk"))("zod");
const childMcp = REPLAY || childIdentity() ? undefined : sdk.createSdkMcpServer({ name: "codex_children", tools: childTools.map(spec => {
  const shape = Object.fromEntries(Object.entries(spec.properties).map(([key, value]) => {
    const field = value.type === "boolean" ? z.boolean() : z.string();
    return [key, spec.required.includes(key) ? field : field.optional()];
  }));
  return sdk.tool(spec.name, spec.description, shape, async input => {
    try { return { content: [{ type: "text" as const, text: JSON.stringify(await children.call(spec.name, input)) }] }; }
    catch (e) { return { isError: true, content: [{ type: "text" as const, text: (e as Error).message }] }; }
  });
}) });
let background: { id: string; kind: string; description: string }[] = [];
function upsertTask(id: string, patch: Partial<Task>) {
  const cur: Task = tasks.get(id) ?? { id, tool: null, kind: "task", description: "", background: false, status: "running", startedAt: Date.now(), endedAt: null, tokens: null, tools: null, last: null, summary: null };
  for (const [k, v] of Object.entries(patch)) if (v !== undefined) (cur as any)[k] = v;
  tasks.set(id, cur); idleSleep?.changed();
  if (tasks.size > 200) tasks.delete(tasks.keys().next().value!);
  emit({ t: "task", task: cur }, false);
}
const partial = new Map<string, string>(); // text blocks still streaming: id -> text so far
const thinkingNow = new Map<string, { text: string; at: number }>(); // thinking blocks still streaming
const clients = new Set<WebSocket>();
const send = (ws: WebSocket, m: unknown) => ws.readyState === ws.OPEN && ws.send(JSON.stringify(m));
let activity: ActivityJournal;
function emit(e: ChatEvent, keep = true) {
  if (e.t === 'approval' || e.t === 'approval_done') activity?.request(e.id, 'approval', e.t === 'approval');
  if (e.t === 'question') activity?.request(e.request.id, 'input', true);
  if (e.t === 'question_done') activity?.request(e.id, 'input', false);
  if (keep) {
    log.push(e);
    if (log.length > 4000) log.splice(0, log.length - 4000);
  }
  for (const c of clients) send(c, e);
}
const delta = (id: string, text: string) => {
  for (const c of clients) send(c, { t: "delta", id, text });
};

// ---------------------------------------------------------------- the pane (a readable transcript)

const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
const gold = (s: string) => `\x1b[38;5;214m${s}\x1b[0m`;
const out = (s: string) => process.stdout.write(s);
const promptMark = () => out(`\n${gold("›")} `);

// ---------------------------------------------------------------- herdr

/** herdr ignores a report whose number is not higher than the last it took from this source: nanoseconds since 1970. */
let seq = BigInt(Date.now()) * 1_000_000n;
let session: string | null = RESUME ?? null;
let state: "idle" | "working" | "blocked" = "idle";
let reportInFlight: { key: string; repeated: boolean } | null = null;
function report(next: typeof state, message?: string, coalesce = false) {
  const changed = state !== next;
  state = next;
  if (changed) writeHostFile();
  emit({ t: "state", state: next }, false);
  publishQueue();
  if (!PANE) return;
  const key = JSON.stringify([next, session, message?.slice(0, 200) ?? null]);
  // Only stream starts share an identical outstanding report. Explicit lifecycle reports always
  // send, and the next stream start after completion sends immediately (no heartbeat timer/gate).
  if (coalesce && reportInFlight?.key === key) { reportInFlight.repeated = true; return; }
  function sendReport() {
    const flight = { key, repeated: false };
    reportInFlight = flight;
    const a = ["pane", "report-agent", PANE!, "--source", "siso-host", "--agent", "siso", "--state", next, "--seq", String(++seq)];
    if (session) a.push("--agent-session-id", session);
    if (message) a.push("--message", message.slice(0, 200));
    execFile(HERDR, a, { timeout: 3000 }, error => {
      if (reportInFlight !== flight) return; // a newer explicit report superseded this one
      reportInFlight = null;
      // A failed shared call must not swallow the repeats; retry once, unless new repeats arrive.
      if (error && flight.repeated) sendReport();
    });
  }
  sendReport();
}
/** herdr 0.9 records a session id only through report-agent-session (state reports carry it from 0.10). */
function reportSession() {
  if (PANE && session) {
    // Session reports can advance the same source watermark as state reports. A later stream
    // start must send above that sequence, even while the previous state callback is pending.
    reportInFlight = null;
    execFile(HERDR, ["pane", "report-agent-session", PANE, "--source", "siso-host", "--agent", "siso", "--seq", String(++seq), "--agent-session-id", session], { timeout: 3000 }, () => {});
  }
}
function release() {
  if (PANE) execFile(HERDR, ["pane", "release-agent", PANE, "--source", "siso-host", "--agent", "siso", "--seq", String(++seq)], { timeout: 3000 }, () => {});
}
/**
 * The session id moved (a compaction can start a new one, a0-018): the host file, herdr and the app follow it, so the
 * seat keeps its chat and `claude --resume` opens the right one.
 */
function adoptSession(id: unknown): boolean {
  if (typeof id !== "string" || !id || id === session) return false;
  session = id;
  settingsSaved = null;
  writeHostFile();
  report(state);
  reportSession();
  return true;
}

// ---------------------------------------------------------------- the context gauge (a0-018)

/** Tokens in the window now (the last main-thread request's input, cache included) over the window it is measured on. */
let ctx: { used: number; window: number; pct: number; at: number } | null = null;
/** From the CLI's own /context answer when it gives one; until then the model id says (1M) or the standard 200k. */
let ctxWindow: number | null = null;
const windowFor = () => ctxWindow ?? (/\[1m\]/i.test(seatModel ?? "") ? 1_000_000 : 200_000);
function setCtx(used: number, window?: number) {
  if (!Number.isFinite(used) || used < 0) return;
  if (window && window > 0) ctxWindow = window;
  const w = windowFor();
  const pct = Math.round((used / w) * 100);
  const moved = ctx?.pct !== pct || ctx?.window !== w;
  ctx = { used, window: w, pct, at: Date.now() };
  emit({ t: "context", used, window: w, pct }, false);
  if (moved) writeHostFile();
}
const inputOf = (u: any) => (Number(u?.input_tokens) || 0) + (Number(u?.cache_creation_input_tokens) || 0) + (Number(u?.cache_read_input_tokens) || 0);
/** After a turn: the CLI's measured total and window (summary detail: no token-count calls). */
function refreshCtx() {
  void (q as any)
    .getContextUsage({ detail: "summary" })
    .then((r: any) => typeof r?.totalTokens === "number" && setCtx(r.totalTokens, Number(r.rawMaxTokens) || undefined))
    .catch(() => {});
}
const kTok = (n: number | null | undefined) => (typeof n !== "number" ? "?" : n < 1000 ? String(n) : `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`);

// Explicit next remains owned by this host; steer uses the existing SDK input boundary.
let queueStore: PromptQueue | null = null;
const compactedAuto = new Set<string>();
let rootEpoch: string | null = null;
let rootPrompt: string | null = null;
let rootReviewBaseline = false;
const bootstrap: { text: string; from: 'app'|'pane'; images: unknown[] }[] = [];
const questions = new Questions(e => { emit(e); if (e.t === 'question') report('blocked'); else if (e.t === 'question_done' && !pending.size && !questions.size) report(rootEpoch ? 'working' : 'idle'); }, { directory: process.env.AB_QUESTION_JOURNAL_DIR ?? path.join(HOSTS_DIR, 'questions'), owner: { seat: process.env.AB_SERVICE_NAME ?? PANE ?? NAME, cwd: process.cwd(), provider: 'claude', workspaceId: workspaceReceipt?.workspaceId, serviceLabel: process.env.AB_SERVICE_LABEL ?? (process.env.AB_SERVICE_NAME ? `com.siso.${process.env.AB_SERVICE_NAME === 'A0' ? 'a0-host' : 'host-lab'}` : undefined) } });
activity = new ActivityJournal(PANE ?? NAME, questions.hostInstance);
const attentionCommands = new AttentionCommands(activity);
const deliveryCaps = () => ({ version: 1 as const, auto: true, steer: compacting || child === 'stopped' ? false as const : 'sdk-boundary' as const, images: true, activeTurnId: rootEpoch, compacting: !!compacting });
function publishQueue() { idleSleep?.changed(); if (queueStore) emit({ t: 'queue.snapshot', snapshot: queueStore.snapshot(), capabilities: deliveryCaps() }, false); }
function initQueue() {
  if (REPLAY || queueStore || !session) return;
  queueStore = new PromptQueue(PANE ?? NAME, session);
  for (const p of bootstrap.splice(0)) prompt(p.text, p.from, p.images);
  publishQueue();
}
function validQueuedImages(entry: QueuedPrompt) {
  if (imageBlocks(entry.images).ok.length === entry.images.length) return true;
  emit(queueStore!.record(entry.id, 'saved', undefined, 'invalid_upload'));
  queueStore!.hold(); publishQueue(); report('blocked'); return false;
}
function drainNext(id?: string, restartStopped = false) {
  if (!queueStore || rootEpoch || compacting || waiting.size || inbox.length || settingsHeld.length || held.length || pending.size || questions.size || (child === 'stopped' && !restartStopped)) return;
  const entry = queueStore.claim(id); if (!entry) return;
  if (!validQueuedImages(entry)) return;
  rootEpoch = randomUUID(); rootPrompt = entry.id;
  activity.start(session!, rootEpoch);
  offerClaude(entry.text, entry.from, entry.images, entry.id); publishQueue();
}
async function deliveryCommand(m: any, from: 'app'|'pane' = 'app') {
  try {
    if (!queueStore) throw Error('runtime_unavailable');
    if (m.t === 'prompt') {
      m = { ...m, key: m.key ?? randomUUID(), messageId: m.messageId ?? m.key ?? randomUUID(), images: m.images ?? [], delivery: m.delivery ?? 'next', from };
      validatePrompt(m, true);
      const prior = queueStore.prior(m); if (prior) { emit(prior); publishQueue(); return; }
    }
    if (m.t !== 'prompt') { const prior = queueStore.prior(m); if (prior) { emit(prior); publishQueue(); return; } }
    if ((m.t === 'prompt' && m.delivery === 'steer') || m.t === 'queue.steer') {
      if (!rootEpoch || m.expectedTurnId !== rootEpoch || compacting || child === 'stopped') throw Error('stale_turn');
    }
    if (m.images !== undefined && (!Array.isArray(m.images) || m.images.length > 20 || m.images.some((p: unknown) => !uploadPath(UPLOADS, p) || !MEDIA[path.extname(String(p)).slice(1).toLowerCase()]))) throw Error('invalid_upload');
    const r = queueStore.command(m); emit(r); publishQueue();
    if ((m.delivery === 'auto' || m.t === 'queue.send') && compacting) compactedAuto.add(r.id!);
    if (((m.delivery === 'auto' || m.t === 'queue.send') && rootEpoch && !compacting && child !== 'stopped') || m.delivery === 'steer' || m.t === 'queue.steer') {
      const entry = queueStore.claim(r.id!);
      if (entry && validQueuedImages(entry)) { offerClaude(entry.text, entry.from, entry.images, entry.id); publishQueue(); }
    } else {
      // A newly admitted prompt (or explicit Send) may restart its stopped child.
      // Claim only that message: interrupted/unknown and cancelled entries stay held,
      // and queue edits, automatic drains and idempotent retries cannot restart it.
      const restartStopped = child === 'stopped' && (m.t === 'prompt' || m.t === 'queue.send');
      drainNext(m.delivery === 'auto' || m.t === 'queue.send' || restartStopped ? r.id : undefined, restartStopped);
    }
  } catch (e) { emit({ t: 'prompt.receipt', key: m.key ?? '', id: m.id ?? m.messageId, phase: 'failed', queueRevision: queueStore?.snapshot().revision ?? 0, text: (e as Error).message, code: (e as Error).message }); publishQueue(); }
}
function prompt(text: string, from: 'app'|'pane', images: unknown[] = []) {
  if (!text.trim() && !images.length) return;
  if (!queueStore) { bootstrap.push({ text, from, images }); return; }
  void deliveryCommand({ t: 'prompt', text, images, delivery: 'auto' }, from);
}

// ---------------------------------------------------------------- compaction, relayed in process (a0-018)

/**
 * The SDK's PreCompact and PostCompact hooks run here, in the host: the chat says "Compacting at N%", then "Back,
 * summary of M tokens". What is sent meanwhile is held by the host (shown queued) and handed to Claude once it is back,
 * so nothing typed during a compaction can fall into it.
 */
let compacting: { at: number; pct: number | null } | null = null;
/** The relay already told this compaction, so the SDK's compact_boundary note would only say it twice. */
let compactTold = false;
let lastPostTokens: number | null = null;
const held: SDKUserMessage[] = [];
/** Held messages handed over after a compaction: one the turn ends without folding in starts the next turn instead. */
const released = new Set<string>();
function compactStart(trigger: unknown, sid?: unknown) {
  adoptSession(sid);
  if (compacting) return;
  compacting = { at: Date.now(), pct: ctx?.pct ?? null };
  compactTold = false;
  lastPostTokens = null;
  const text = `Compacting at ${compacting.pct ?? "?"}%${trigger === "manual" ? " (asked for)" : ""}`;
  emit({ t: "note", label: "Compacting", text, at: Date.now() });
  out(`\n${dim(`${text}…`)}`);
  writeHostFile();
}
function compactEnd(summaryTokens: number | null, sid?: unknown, failed?: string) {
  adoptSession(sid);
  if (!compacting) return;
  compacting = null;
  compactTold = true;
  const text = failed ? `Compaction failed: ${failed}` : `Back, summary of ${kTok(summaryTokens ?? lastPostTokens)} tokens`;
  emit({ t: "note", label: failed ? "Compaction failed" : "Compacted", text, at: Date.now(), ...(failed ? { bad: true } : {}) });
  out(`\n${dim(text)}`);
  // What was sent meanwhile goes to Claude now; if the turn already ended it starts the next one, so it is no longer
  // "waiting" for a fold-in.
  const idle = state === "idle";
  for (const m of held.splice(0)) {
    enqueueClaude(m);
    if (idle && m.uuid) lifecycle(m.uuid, "started");
    else if (m.uuid) released.add(m.uuid);
  }
  if (idle && inbox.length) report("working");
  // Compaction is a real delivery barrier; release composer messages into the continuing turn.
  for (const id of compactedAuto) {
    if (rootEpoch) {
      const entry = queueStore?.claim(id);
      if (entry && validQueuedImages(entry)) offerClaude(entry.text, entry.from, entry.images, entry.id);
    } else drainNext(id);
  }
  compactedAuto.clear();
  publishQueue(); wake?.();
  writeHostFile();
}
const summaryTokens = (s: unknown) => (typeof s === "string" && s ? Math.ceil(s.length / 4) : null);

// ---------------------------------------------------------------- prompts in (from the app or the pane)

const inbox: SDKUserMessage[] = [];
let wake: (() => void) | null = null;
// Keep controls independent of the provider's input iterator: a control acknowledgement
// must never wait on an input iterator that is itself awaiting that acknowledgement.
const settingsHeld: SDKUserMessage[] = [];
let settingsPending = 0;
function enqueueClaude(msg: SDKUserMessage) {
  const target = compacting ? held : settingsPending ? settingsHeld : inbox;
  target.push(msg);
  if (target === inbox) {
    if (child === "stopped") restartNow?.();
    else wake?.();
  }
}
function releaseSettingsHeld() {
  if (settingsPending) return;
  for (const msg of settingsHeld.splice(0)) enqueueClaude(msg);
}
let inputPauseRevision = 0;
/** Stop owns messages the SDK has not seen; keep their durable queue entries for explicit Send. */
function holdUnsent(msg: SDKUserMessage) {
  if (msg.uuid) {
    waiting.delete(msg.uuid);
    if (queueStore?.snapshot().entries.some(e => e.id === msg.uuid)) {
      try { emit(queueStore.record(msg.uuid, 'saved')); }
      catch { emit({ t: 'note', label: 'Queue paused', text: 'Could not save the held delivery state. The message was not sent.', bad: true, at: Date.now() }); }
    }
    if (msg.uuid === rootPrompt) {
      rootPrompt = null; rootEpoch = null; rootReviewBaseline = false;
      activity.finish('cancelled', queueStore?.snapshot().entries.filter(e => e.phase === 'saved').length ?? 0);
      idleSleep?.changed(true);
      report(pending.size || questions.size ? 'blocked' : 'idle');
    }
  }
  publishQueue();
}
function holdSettingsInputs() {
  ++inputPauseRevision;
  // All host-owned inputs are still unoffered, including controls released into compaction.
  for (const msg of [...settingsHeld.splice(0), ...inbox.splice(0), ...held.splice(0)]) holdUnsent(msg);
  // These saved entries must wait for a fresh explicit Send, not a delayed PostCompact.
  compactedAuto.clear();
}
/**
 * Messages sent while Claude works, by uuid, until it takes them. The CLI's way (Shaan, 2 Oct: "you should be able to
 * queue prompts … just put them in how it usually works"): the SDK folds a message sent mid-turn into the running turn
 * at the next tool boundary and says so with a command_lifecycle frame ("queued", then "started"), checked on the lab.
 */
const waiting = new Map<string, { text: string; from: "app" | "pane"; msg: SDKUserMessage; shown?: boolean }>();
/** Images he pasted in the app, as image blocks Claude sees (the node saved them under its uploads folder). */
const UPLOADS = process.env.AB_UPLOADS ?? path.join(homedir(), ".local/state/agent-base/uploads");
const MEDIA: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp" };
function imageBlocks(paths: unknown[]): { blocks: any[]; ok: string[] } {
  const blocks: any[] = [];
  const ok: string[] = [];
  for (const p of paths) {
    const file = uploadPath(UPLOADS, p);
    if (!file) continue;
    const media = MEDIA[path.extname(file).slice(1).toLowerCase()];
    try {
      if (media) (blocks.push({ type: "image", source: { type: "base64", media_type: media, data: readFileSync(file).toString("base64") } }), ok.push(file));
    } catch {
      /* gone */
    }
  }
  return { blocks, ok };
}
function offerClaude(text: string, from: "app" | "pane", images: unknown[] = [], id: string) {
  const { blocks, ok } = imageBlocks(images);
  // The chat shows the images by their paths (thumbnails); Claude gets them as image blocks.
  const t = [text.trim(), ...ok].filter(Boolean).join("\n");
  if (!t) return;
  const content = blocks.length ? [...blocks, ...(text.trim() ? [{ type: "text", text: text.trim() }] : [])] : t;
  const msg = { type: "user", message: { role: "user", content }, parent_tool_use_id: null, session_id: session ?? "", uuid: id } as SDKUserMessage;
  // A stopped Claude takes it as the first message of its restart; one compacting gets it once it is back.
  const now = (state === "idle" || child === "stopped") && !compacting;
  if (now) emit({ t: "user", id, text: t, at: Date.now(), from });
  else {
    waiting.set(id, { text: t, from, msg });
    emit({ t: "queued", id, text: t, at: Date.now() });
  }
  if (from === "app") out(now ? `${t}\n` : dim(`\n(queued) ${t}\n`)); // typed in the pane it is already on screen
  enqueueClaude(msg);
  report("working");
}
/** He took a waiting message back before Claude read it (the SDK's cancel_async_message; a no-op once taken). */
async function unqueue(id: string, ws: WebSocket) {
  const failed = (text: string) => send(ws, { t: "unqueue_failed", id, text });
  if (!waiting.has(id)) {
    failed("This message is no longer pending in the agent queue.");
    return;
  }
  try {
    const cancel = (q as any)?.cancelAsyncMessage;
    if (typeof cancel !== "function") {
      failed("This queued message cannot be taken back by the current agent runtime.");
      return;
    }
    if ((await cancel.call(q, id)) === true) lifecycle(id, "cancelled");
    else failed("Could not confirm removal; the message may still be sent.");
  } catch {
    failed("Could not confirm removal; the message may still be sent.");
  }
}
/** Claude took a waiting message (it now belongs in the chat where it was read), or it was dropped. */
function lifecycle(id: string, phase: string) {
  const w = waiting.get(id);
  if (!w) return;
  if (phase === "started") {
    waiting.delete(id);
    if (queueStore?.snapshot().entries.some(e => e.id === id)) { emit(queueStore.record(id, 'started')); publishQueue(); }
    if (!w.shown) emit({ t: "user", id, text: w.text, at: Date.now(), from: w.from, mid: true });
  } else if (phase === "cancelled") {
    waiting.delete(id);
    emit({ t: "unqueued", id });
  }
}
/** One per Claude started (`gen`): a stopped Claude's reader must never take a message meant for its successor. */
let gen = 0;
async function* prompts(mine: number): AsyncGenerator<SDKUserMessage> {
  for (;;) {
    while (inbox.length && mine === gen) {
      const msg = inbox.shift()!;
      const epoch = rootEpoch, isRoot = msg.uuid === rootPrompt, pauseRevision = inputPauseRevision;
      const baseline = isRoot ? await recordChangesBoundary(session, TOKEN, msg.uuid!, 'baseline', epoch ?? undefined) : false;
      // A checkpoint can yield while a setting starts or this query stops. Never let
      // the old reader consume its successor's input, or cross a new setting barrier.
      if (mine !== gen || child === 'stopped') return;
      if (pauseRevision !== inputPauseRevision) { holdUnsent(msg); continue; }
      if (isRoot && msg.uuid === rootPrompt && epoch === rootEpoch) rootReviewBaseline = baseline;
      if (settingsPending) {
        // Everything already in the inbox predates newly held offers. Transfer it
        // as one ordered batch; repeated unshift would reverse those messages.
        (compacting ? held : settingsHeld).unshift(msg, ...inbox.splice(0));
        continue;
      }
      if (msg.uuid && queueStore?.snapshot().entries.some(e => e.id === msg.uuid && e.phase === 'dispatching')) {
        emit(queueStore.record(msg.uuid, 'offered'));
        const w = waiting.get(msg.uuid);
        if (w && !w.shown) { w.shown = true; emit({ t: 'user', id: msg.uuid, text: w.text, at: Date.now(), from: w.from, mid: true }); }
        publishQueue();
      }
      yield msg;
    }
    if (mine !== gen) return;
    await new Promise<void>((r) => (wake = r));
    if (mine === gen) wake = null;
  }
}

// ---------------------------------------------------------------- approvals (only asked when the permission mode asks)

const pending = new Map<string, (r: PermissionResult) => void>();
const canUseTool: CanUseTool = (tool, input, { signal, toolUseID }) =>
  new Promise((resolve) => {
    if (tool === 'AskUserQuestion') {
      try {
        if (!session) throw Error('Session unavailable');
        const specs = normalizeQuestions(input.questions, 'claude');
        const mine = gen;
        questions.add({ session, turnId: rootEpoch ?? undefined, toolId: toolUseID ?? randomUUID(), ...(toolUseID ? { nativeRequestId: toolUseID } : {}), provider: 'claude', questions: specs }, async (answers, reason) => {
          if (answers && (signal.aborted || mine !== gen)) throw Error('Native question callback is no longer live');
          if (!answers) resolve({ behavior: 'deny', message: reason ?? 'Question unavailable' });
          // T3 Code ClaudeAdapterV2 (MIT): SDK answers are keyed by original question text.
          else resolve({ behavior: 'allow', updatedInput: { ...input, answers: Object.fromEntries(specs.map(q => [q.question, answers[q.id].join(', ')])) }, ...(toolUseID ? { toolUseID } : {}) });
        }, signal);
        out('\nAnswer the question in Agent Base.\n');
      } catch (e) { resolve({ behavior: 'deny', message: (e as Error).message }); }
      return;
    }
    // Shaan, 9 Oct ~23:05: "the operator UI got stuck on a permission ... they should be running on skip permissions". Under
    // bypass, Claude Code still asks about some compound Bash commands; an owner on bypass never waits on a card for those.
    // A real question (AskUserQuestion, above) still reaches him.
    if (MODE === "bypassPermissions") { resolve({ behavior: "allow", updatedInput: input }); return; }
    const id = randomBytes(6).toString("hex");
    const summary = summarize(tool, input);
    pending.set(id, resolve);
    emit({ t: "approval", id, tool, summary });
    out(`\n${gold("?")} Allow ${tool}: ${summary}  ${dim("[y/n]")} `);
    report("blocked", `${tool}: ${summary}`);
    signal.addEventListener("abort", () => decide(id, false));
  });
function decide(id: string, allow: boolean) {
  const r = pending.get(id);
  if (!r) return;
  pending.delete(id);
  emit({ t: "approval_done", id, allow });
  r(allow ? { behavior: "allow" } : { behavior: "deny", message: "Shaan said no." });
  if (!pending.size && !questions.size) report("working");
}

// ---------------------------------------------------------------- earlier history, when resuming

/**
 * What getSessionMessages leaves out, from the session's own file: when each message was written (by uuid), and the
 * messages that arrived while Claude worked (stored as `queued_command` attachments, not as user messages: every
 * message a peer typed into this pane mid-turn).
 */
type Extras = {
  times: Map<string, number>;
  queued: { text: string; at: number }[];
  /** R1.20c (H1): other agents' messages (meta lines with `origin.kind: "peer"`, which getSessionMessages leaves out). */
  peers: NonNullable<ReturnType<typeof peerMessage>>[];
  /** R1.20c (F4/F5): limit and API error messages by uuid, drawn as cards. */
  errors: Map<string, ReturnType<typeof apiError>>;
};
function sessionExtras(id: string): Extras {
  const times = new Map<string, number>();
  const queued: { text: string; at: number }[] = [];
  const peers: Extras["peers"] = [];
  const errors: Extras["errors"] = new Map();
  const dir = process.env.CLAUDE_CONFIG_DIR ?? path.join(homedir(), ".claude");
  try {
    const file = path.join(dir, "projects", process.cwd().replace(/[^A-Za-z0-9]/g, "-"), `${id}.jsonl`);
    for (const line of readFileSync(file, "utf8").split("\n")) {
      const u = line.match(/"uuid":"([^"]+)"/)?.[1];
      const ts = line.match(/"timestamp":"([^"]+)"/)?.[1];
      if (u && ts) times.set(u, Date.parse(ts) || 0);
      if (line.includes('"kind":"peer"') || line.includes('"isApiErrorMessage":true')) {
        try {
          const r = JSON.parse(line);
          const at = Date.parse(r.timestamp ?? "") || 0;
          if (r.isApiErrorMessage && r.uuid) errors.set(r.uuid, apiError(r, at));
          else {
            const p = peerMessage(r);
            if (p) peers.push(p);
          }
        } catch {
          /* a torn line */
        }
      }
      if (line.includes('"type":"queued_command"')) {
        try {
          const a = JSON.parse(line).attachment;
          if (typeof a?.prompt === "string" && a.prompt.trim()) queued.push({ text: a.prompt, at: Date.parse(a.timestamp ?? ts ?? "") || 0 });
        } catch {
          /* a torn line */
        }
      }
    }
  } catch {
    /* no file here (another machine's session): history without times */
  }
  return { times, queued, peers, errors };
}

async function loadHistory(id: string) {
  try {
    const msgs = await getSessionMessages(id, { dir: process.cwd() } as never);
    const { times, queued, peers, errors } = sessionExtras(id);
    const peerIds = new Set(peers.map((p) => p.id));
    const from = log.length;
    let prevAt = 0;
    for (const m of msgs) {
      const c = (m.message as any)?.content;
      const at = times.get(m.uuid) ?? 0;
      const thoughtMs = at && prevAt && at > prevAt ? at - prevAt : null;
      if (at) prevAt = at;
      if (m.type === "user" && peerIds.has(m.uuid)) continue; // added below, as a peer's row
      if (m.type === "assistant" && errors.has(m.uuid)) {
        log.push({ ...errors.get(m.uuid)!, at: at || errors.get(m.uuid)!.at });
        continue;
      }
      if (m.type === "user") {
        const text = typeof c === "string" ? c : Array.isArray(c) ? c.filter((b: any) => b?.type === "text").map((b: any) => b.text).join("\n") : "";
        if (text && !text.startsWith("<")) log.push({ t: "user", id: m.uuid, text, at, from: "history" });
        if (Array.isArray(c)) for (const b of c) if (b?.type === "tool_result") log.push({ t: "tool_done", id: b.tool_use_id, ok: !b.is_error, ...toolOut(b.content), at });
      } else if (m.type === "assistant" && Array.isArray(c)) {
        for (const b of c) {
          // Stored thinking is often empty (omitted), and its time here includes the model's other latency: only
          // thinking with words in it is worth a line.
          if (b?.type === "thinking" && b.thinking?.trim()) log.push({ t: "thinking", id: `${m.uuid}:${log.length}`, text: b.thinking, ms: thoughtMs, at });
          if (b?.type === "text" && b.text) log.push({ t: "text", id: `${m.uuid}:${log.length}`, text: b.text, at });
          if (b?.type === "tool_use") log.push({ t: "tool", id: b.id, name: b.name, summary: summarize(b.name, b.input ?? {}), input: toolInput(b.name, b.input ?? {}), at });
        }
      }
    }
    // Messages taken mid-turn go back where Claude read them: before the first event written after them.
    const had = new Set(log.slice(from).flatMap((e) => (e.t === "user" ? [e.text.trim()] : [])));
    for (const qm of queued) {
      if (had.has(qm.text.trim())) continue; // some are stored both ways
      let i = from;
      while (i < log.length && !((log[i] as { at?: number }).at! > qm.at)) i++;
      log.splice(i, 0, { t: "user", text: qm.text, at: qm.at, from: "history", mid: true });
    }
    // Other agents' messages go back where they arrived, each as its sender's row.
    for (const p of peers) {
      let i = from;
      while (i < log.length && !((log[i] as { at?: number }).at! > p.at)) i++;
      log.splice(i, 0, { t: "user", id: p.id, text: p.text, at: p.at, from: "peer", name: p.name });
    }
    if (log.length > 4000) log.splice(0, log.length - 4000);
    out(dim(`(${msgs.length} earlier messages and ${queued.length} taken mid-turn loaded from session ${id})\n`));
  } catch (e) {
    out(dim(`(could not load earlier messages: ${(e as Error).message})\n`));
  }
}

// ---------------------------------------------------------------- the socket Agent Base connects to

const server = http.createServer((_req, res) => {
  if (_req.url === "/health") { res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify({ pid: process.pid, name: NAME, session })); return; }
  res.writeHead(404);
  res.end();
});
const wss = new WebSocketServer({ noServer: true });
server.on("upgrade", (req, socket, head) => {
  const u = new URL(req.url ?? "/", "http://host");
  if (u.pathname !== "/ws" || u.searchParams.get("token") !== TOKEN) return socket.destroy();
  wss.handleUpgrade(req, socket, head, (ws) => {
    clients.add(ws);
    const questionRecovery = REPLAY ? undefined : questions.recoverySnapshot(session);
    send(ws, { t: "hello", name: NAME, session, model: seatModel, effort: seatEffort, settingsSaved, state, ctx, compacting: !!compacting, child, log, partial: Object.fromEntries(partial), thinking: Object.fromEntries([...thinkingNow].map(([k, v]) => [k, v.text])), tasks: [...tasks.values()], bg: background, queue: queueStore?.snapshot(), capabilities: REPLAY ? undefined : deliveryCaps(), hostInstance: questions.hostInstance, questionCapability: !REPLAY && questionRecovery?.status !== 'unavailable', pendingQuestions: REPLAY ? [] : questions.snapshot(), questionRecovery });
    ws.on("message", (raw) => {
      let m: any;
      try {
        m = JSON.parse(String(raw));
      } catch {
        return;
      }
      // Replay serves a read-only history. It has no SDK query, so accepting a
      // command here would either mutate replay state or touch `q` before its
      // declaration below.
      if (REPLAY) return;
      if (m.t === 'attention_command') {
        void attentionCommands.handle(m, () => attentionCommands.matches(m, session) && child !== 'stopped', async () => {
          const a = m.action;
          if (!a || !['approve','deny','reply','answer','dismiss'].includes(a.kind)) return 'unsupported';
          if (a.kind === 'approve' || a.kind === 'deny') {
            if (!pending.has(a.requestId)) return 'stale';
            decide(a.requestId, a.kind === 'approve');
            return 'accepted';
          }
          if (a.kind === 'answer' || a.kind === 'dismiss') {
            const request = questions.snapshot().find(q => q.id === a.requestId);
            if (!request || request.session !== session) return 'stale';
            const result = await questions.answer({ t: 'answer_question', id: request.id, hostInstance: questions.hostInstance, session, submissionId: m.commandId, action: a.kind === 'dismiss' ? 'dismiss' : 'answer', answers: a.answers });
            return questions.snapshot().some(q => q.id === request.id) ? 'invalid' : result && result.t === 'question_done' && result.outcome === (a.kind === 'dismiss' ? 'dismissed' : 'answered') ? 'accepted' : 'unavailable';
          }
          const prompt = { t: 'prompt', key: m.commandId, messageId: m.commandId, text: a.text, images: [], delivery: 'next', from: 'app' };
          validatePrompt(prompt, true);
          if (!queueStore) return 'unavailable';
          emit(queueStore.command(prompt)); publishQueue(); drainNext();
          return 'queued';
        }).then(ack => send(ws, ack));
      }
      else if (m.t === 'prompt' || m.t?.startsWith('queue.')) void deliveryCommand(m);
      else if (m.t === 'answer_question') void questions.answer(m);
      else if (m.t === "set_model" && typeof m.model === "string") {
        // Await the SDK acknowledgement before publishing a changed model.
        void switchModel(m.model, ws);
      }
      else if (m.t === "set_effort" && typeof m.effort === "string") void switchEffort(m.effort, ws);
      else if (m.t === 'keep_awake' && typeof m.value === 'boolean') { idleSleep?.keepAwake(m.value); writeHostFile(); send(ws, { t: "sleep.policy", ...idleSleep?.fields() }); }
      else if (m.t === 'interrupt') { queueStore?.hold(); holdSettingsInputs(); publishQueue(); activity.interrupted = true; void q.interrupt().catch(() => {}); }
      else if (m.t === "approve" && typeof m.id === "string") decide(m.id, !!m.allow);
      else if (m.t === "unqueue" && typeof m.id === "string") void unqueue(m.id, ws);
      else if (m.t === "stop_task" && typeof m.id === "string") {
        if (tasks.get(m.id)?.hostName) void children.call("stop_codex", { id: m.id }).catch(e => send(ws, { t: "note", text: (e as Error).message, bad: true, at: Date.now() }));
        else void q.stopTask(m.id).catch(() => {});
      }
    });
    ws.on("close", () => clients.delete(ws));
  });
});
/** This host's accepted controls, published so the picker never guesses another harness's catalog. */
const SWITCH_CATALOG = [
  { id: "claude-opus-5-5[1m]", label: "Claude Opus 5.5 · 1M", description: "Deep work and long sessions", efforts: ["low", "medium", "high", "xhigh", "max"] },
  { id: "claude-sonnet-5-5", label: "Claude Sonnet 5.5", description: "Fast implementation and everyday work", efforts: ["low", "medium", "high", "xhigh", "max"] },
  { id: "claude-haiku-4-5-20251001", label: "Claude Haiku 4.5", description: "Quick reads and focused tasks", efforts: ["low", "medium", "high", "xhigh", "max"] },
];
const SWITCH_MODELS = new Set(SWITCH_CATALOG.map(model => model.id));
let modelSwitch = Promise.resolve();
let settingsStopped = Promise.resolve();
let stopSettings: (() => void) | null = null;
/** Controls retain their original runtime; a late acknowledgement cannot change its successor. */
function changeSetting(ws: WebSocket, label: string, apply: (target: Query) => Promise<void>, publish: () => void) {
  const target = q, generation = gen, stopped = settingsStopped;
  const current = () => child === 'running' && target === q && generation === gen;
  settingsPending++;
  modelSwitch = modelSwitch.then(async () => {
    try {
      if (!current()) throw Error('Claude stopped; send a message to restart it before changing settings.');
      await Promise.race([apply(target), stopped.then(() => { throw Error('Claude stopped before the setting was acknowledged.'); })]);
      if (!current()) throw Error('Claude stopped before the setting was acknowledged.');
    } catch (e) {
      send(ws, { t: "note", label: `${label} unchanged`, text: (e as Error).message, bad: true, at: Date.now() });
      return;
    }
    // A successful SDK acknowledgement is runtime truth even if persistence fails.
    publish();
    persistModelSettings();
    writeHostFile();
  }).catch(e => {
    // Publication errors must not poison later controls or be misreported as SDK rejection.
    send(ws, { t: 'note', label: 'Settings applied', text: `Could not publish the current settings: ${(e as Error).message}`, bad: true, at: Date.now() });
  }).finally(() => { settingsPending--; releaseSettingsHeld(); });
  return modelSwitch;
}
function switchModel(model: string, ws: WebSocket) {
  return changeSetting(ws, 'Model', async target => {
    if (!SWITCH_MODELS.has(model)) throw Error("Unsupported model");
    await target.setModel(model);
  }, () => {
    seatModel = model;
    ctxWindow = null;
    emit({ t: "init", session: session ?? "", model, cwd: process.cwd(), name: NAME, apiKeySource });
  });
}
/** The effort the SDK acknowledged, applied live at its own control boundary. */
function switchEffort(effort: string, ws: WebSocket) {
  return changeSetting(ws, 'Effort', async target => {
    if (!["low", "medium", "high", "xhigh", "max"].includes(effort)) throw Error("Unknown effort");
    await target.applyFlagSettings({ effortLevel: effort as never });
  }, () => {
    seatEffort = effort;
    emit({ t: "note", label: "Effort", text: effort, at: Date.now() });
  });
}
// Only the separate session settings file proves a durable picker selection.
let settingsSaved: boolean | null = null;
function persistModelSettings() {
  settingsSaved = false;
  try {
    if (!session) throw Error('No session is available for saving settings.');
    saveModelSettings(HOSTS_DIR, session, { model: seatModel, effort: seatEffort });
    settingsSaved = true;
  } catch (e) {
    emit({ t: 'note', label: 'Settings not saved', text: `The current model and effort are applied to this host, but could not be saved for a future host restart: ${(e as Error).message}`, bad: true, at: Date.now() });
  }
}
// A supervised service host (siso-host --service, under launchd) is found by name, not by pane, and its file outlives it.
const serviceName = process.env.AB_SERVICE_NAME;
let apiKeySource: string | null = null;
const hostFile = path.join(HOSTS_DIR, serviceName ? `name-${safeName(serviceName)}.json` : `${(PANE ?? `pid-${process.pid}`).replace(/[^A-Za-z0-9_-]/g, "_")}.json`);
let resumedAfterSleep = false;
let seatModel: string | null = MODEL ?? null;
/** The effort the seat runs at: --effort at launch, then whatever the app's model picker set (set_effort). */
let seatEffort: string | null = EFFORT ?? null;
try {
  const saved = JSON.parse(readFileSync(hostFile, "utf8"));
  if (RESUME && saved.session === RESUME) {
    resumedAfterSleep = saved.state === "asleep";
    seatModel = saved.model ?? seatModel; seatEffort = saved.effort ?? seatEffort;
  }
} catch {}
if (RESUME) {
  const saved = readModelSettings(HOSTS_DIR, RESUME);
  seatModel = saved?.model ?? seatModel; seatEffort = saved?.effort ?? seatEffort;
}
let rateLimits: SeatLimits | null = null;
let port = 0;
const startedAt = Date.now();
/** Whether the claude this host runs is alive: a stopped one leaves the seat (and its chat) up, honestly marked. */
let child: "running" | "stopped" = "running";
function writeHostFile(extra: Record<string, unknown> = {}) {
  if (!port) return; // not listening yet: the first write comes with the port
  // `model` (from init) lets the app's HUD name it and size its context window (R1.19); `ctx` is the host's own gauge,
  // `state` and `child` what it last told herdr and whether its claude runs (a0-018). Written whole, then renamed, so
  // the node never reads half a file.
  // `apiKeySource` (an SDK label only), `context` and `configDir` are what a service host's reader (node service-hosts.ts) needs.
  const body = {
    pid: process.pid, runnerPid: Number(process.env.AB_RUNNER_PID) || undefined, port, token: TOKEN, ...childIdentity(), workspaceId: workspaceReceipt?.workspaceId, ...activity?.metadata(), session, pane: PANE ?? null, name: NAME, cwd: process.cwd(), model: seatModel, effort: seatEffort, settingsSaved, startedAt, updatedAt: Date.now(), state, child, compacting: !!compacting, compactingSince: compacting?.at ?? null, ctx,
    models: SWITCH_CATALOG, rateLimits, apiKeySource, context: ctx ? { used: ctx.used, cap: ctx.window } : null, configDir: process.env.CLAUDE_CONFIG_DIR ?? path.join(homedir(), ".claude"),
    ...(serviceName ? { label: process.env.AB_SERVICE_LABEL ?? `com.siso.${serviceName === "A0" ? "a0-host" : "host-lab"}` } : {}),
  };
  const tmp = `${hostFile}.${process.pid}.tmp`;
  const text = JSON.stringify({ ...body, disk: diskState(), ...idleSleep?.fields(), ...extra });
  // t-0504: a full disk leaves the last host file in place and retries; the run goes on.
  const write = () => {
    try { mkdirSync(HOSTS_DIR, { recursive: true, mode: 0o700 }); writeFileSync(tmp, text, { mode: 0o600 }); renameSync(tmp, hostFile); }
    catch (e) { dropTemp(tmp); throw e; }
  };
  if (extra.state === "asleep") write(); else persist("host-file", write);
}

/*
 * t-0504: the disk filling must not end the run. A write we wrapped retries by itself; anything else that throws ENOSPC
 * is caught here and the host carries on. Every other error still ends the process, as Node would.
 */
process.on("uncaughtException", (e) => {
  if (isNoSpace(e)) { noteNoSpace(); return; }
  console.error(e);
  process.exit(1);
});
process.on("unhandledRejection", (e) => {
  if (isNoSpace(e)) { noteNoSpace(); return; }
  console.error(e);
  process.exit(1);
});
/** The agent says so: a card in its chat, a line in herdr (A0's tree), and the host file once it can be written. */
onDisk((d) => {
  emit({ t: "error", kind: "api", text: diskMessage(d), at: Date.now() } as ChatEvent);
  report(state, d.full ? "disk full · retrying saves" : d.low ? "disk low" : undefined);
  writeHostFile();
});

// ---------------------------------------------------------------- run

if (RESUME) await loadHistory(RESUME);
await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
port = (server.address() as { port: number }).port;
writeHostFile();
out(`${gold("siso-host")} ${dim(`· ${NAME} · Claude through the Agent SDK · the app connects on 127.0.0.1:${port}`)}\n`);
out(dim("Type a message, or /commands. Ctrl-C twice to quit.\n"));
report("idle");

let closeQuery: (() => void) | null = null;
let shuttingDown = false;
async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  idleSleep?.stop();
  questions.suspend();
  try {
    closeQuery?.();
  } catch {
    /* SDK close must not prevent herdr release or descriptor cleanup */
  }
  await children.close();
  release();
  try {
    if (!serviceName) rmSync(hostFile);
  } catch {
    /* gone */
  }
  process.exit(0);
}
process.on("SIGTERM", shutdown);
if (!REPLAY) idleSleep = createIdleSleep({ name: NAME, file: hostFile, keepAwake: args.includes('--keep-awake') || NAME === 'A0',
  busy: () => ({ state: shuttingDown || rootEpoch || compacting ? 'working' : state,
    queue: (queueStore?.snapshot().entries.filter(e => ['saved', 'dispatching', 'offered', 'unknown'].includes(e.phase)).length ?? 1) + inbox.length + held.length + settingsHeld.length + waiting.size,
    questions: questions.size, approvals: pending.size,
    children: [...tasks.values()].filter(t => !['done', 'completed', 'failed', 'stopped', 'cancelled'].includes(t.status)).length }),
  sleep: fields => {
    try { writeHostFile(fields); } catch { return; }
    const saved = readSleepHost(hostFile);
    if (saved.pid !== process.pid || saved.state !== 'asleep' || saved.asleepAt !== fields.asleepAt) return;
    shuttingDown = true; idleSleep?.stop(); idleSleep?.record(fields);
    try { closeQuery?.(); } catch {}
    release(); process.exit(75);
  },
});
if (resumedAfterSleep) idleSleep?.changed(true);
writeHostFile();

// --replay: the history and the socket, nothing else (a check renders a real long session without running Claude).
if (REPLAY) {
  process.on("SIGINT", shutdown);
  out(dim("(replay: read-only, no Claude runs)\n"));
  report("idle");
  await new Promise(() => {});
}

let q!: Query;
let startedClaudeAt = 0;
let limitsPending = false;
async function refreshLimits() {
  if (limitsPending || child !== "running") return;
  limitsPending = true;
  const current = q;
  try {
    const limits = await readSeatLimits(current);
    if (limits && current === q) { rateLimits = limits; writeHostFile(); }
  } finally { limitsPending = false; }
}
// Also refresh idle seats: usage can change in another session on this login.
setInterval(() => { void refreshLimits(); }, 120_000).unref();
/** Starts (or restarts, on the session it had) the claude this host runs. */
function startClaude() {
  const mine = ++gen;
  settingsStopped = new Promise<void>(resolve => { stopSettings = resolve; });
  const resume = session ?? RESUME;
  // The SDK may emit init only after its first input. Pin the fresh native UUID up front (SDK sessionId),
  // so the durable bootstrap prompt can be admitted without waiting on its own delivery.
  const freshSessionId = resume ? null : randomUUID();
  if (freshSessionId) session = freshSessionId;
  child = "running";
  startedClaudeAt = Date.now();
  q = query({
    prompt: prompts(mine),
    options: {
      cwd: process.cwd(),
      ...(childMcp ? { mcpServers: { codex_children: childMcp } } : {}),
      ...(seatModel ? { model: seatModel } : {}),
      ...(seatEffort ? { effort: seatEffort as never } : {}),
      ...(resume ? { resume } : { sessionId: freshSessionId! }),
      ...(MODE ? { permissionMode: MODE, ...(MODE === "bypassPermissions" ? { allowDangerouslySkipPermissions: true } : {}) } : {}),
      ...(CLAUDE_BIN ? { pathToClaudeCodeExecutable: CLAUDE_BIN } : {}),
      settingSources: ["user", "project", "local"],
      ...(SETTINGS ? { settings: path.resolve(SETTINGS) } : {}),
      ...(NAMED ? { extraArgs: { name: NAMED } } : {}),
      ...(PLUGINS.length ? { plugins: PLUGINS } : {}),
      // Thinking as readable summaries (Shaan, 2 Oct 13:21: "see what's thinking chains"); Opus omits it otherwise.
      thinking: { type: "adaptive", display: "summarized" },
      systemPrompt: { type: "preset", preset: "claude_code", append: "Use codex_children spawn_codex for full hosted children, and message_codex/codex_status/stop_codex to control them. Their answers are delivered automatically as new input messages." },
      includePartialMessages: true,
      canUseTool,
      // a0-018: compaction told in the chat and held messages kept out of it, in process (no shell hook, no file).
      hooks: {
        PreCompact: [{ hooks: [async (i: any) => (compactStart(i?.trigger, i?.session_id), { continue: true })] }],
        PostCompact: [{ hooks: [async (i: any) => (compactEnd(summaryTokens(i?.compact_summary), i?.session_id), { continue: true })] }],
      },
      env: { ...childEnv(), ...(KEEP_HERDR_ENV ? {} : { HERDR_ENV: "0" }) },
    },
  });
  closeQuery = () => q.close();
  initQueue();
  writeHostFile();
}
/**
 * The child's environment. Every hosted chat auto-compacts at 30% of its window unless its launcher said otherwise
 * (FLEET-COST, 7 Oct; Shaan's brief: "compaction that actually happens at about 30% in every chat"). Only bin/opus-chat
 * set CLAUDE_AUTOCOMPACT_PCT_OVERRIDE before, so chats started any other way ran to 40-82% on 6 Oct, and every call
 * re-reads the whole context (OPERATOR-UI averaged 394k per call). An explicit value, "" included, still wins.
 */
function childEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  if (env.CLAUDE_AUTOCOMPACT_PCT_OVERRIDE === undefined) env.CLAUDE_AUTOCOMPACT_PCT_OVERRIDE = "30";
  return env;
}
startClaude();
await children.restore();

// A first message given on the command line (how agents are started with their brief).
if (FIRST) prompt(FIRST, "app");

// The /command list, asked for at start (no message is sent for it), so the app's menu works before the first prompt.
q.supportedCommands()
  .then((list: any[]) => emit({ t: "commands", list: list.map((c) => ({ name: c.name, description: c.description ?? "", hint: c.argumentHint ?? "" })) }))
  .catch(() => {});

readline.createInterface({ input: process.stdin }).on("line", (line) => {
  const t = line.trim();
  const first = [...pending.keys()][0];
  if (first && /^(y|yes|n|no)$/i.test(t)) return decide(first, /^y/i.test(t));
  prompt(line, "pane");
});
let quitArmed = 0;
process.on("SIGINT", () => {
  if (state === "working" && Date.now() - quitArmed > 1500) {
    queueStore?.hold(); holdSettingsInputs(); publishQueue();
    activity.interrupted = true; void q.interrupt().catch(() => {});
    out(dim("\n(stopped; Ctrl-C again to quit)"));
  } else if (Date.now() - quitArmed < 1500) shutdown();
  quitArmed = Date.now();
});

/** The SDK's system messages the CLI shows on screen, as one chat note each (R1.20). */
const SHOWN_SYSTEM = new Set(["compact_boundary", "hook_response", "local_command_output", "informational", "api_retry", "permission_denied", "model_refusal_fallback"]);
function systemNote(m: any): { label: string; text: string; bad?: boolean } | null {
  const k = (n: unknown) => (typeof n === "number" ? `${Math.round(n / 1000)}k` : "?");
  switch (m.subtype) {
    case "compact_boundary": {
      const c = m.compact_metadata ?? {};
      return { label: "Compacted", text: `Conversation compacted (${c.trigger ?? "auto"}, ${k(c.pre_tokens)} → ${k(c.post_tokens)} tokens)` };
    }
    case "hook_response": {
      const text = String(m.output || m.stdout || m.stderr || "").trim();
      if (m.outcome === "error") return { label: `${m.hook_name} hook error`, text: text || `exit ${m.exit_code ?? "?"}`, bad: true };
      return text ? { label: `${m.hook_name} hook`, text } : null;
    }
    case "local_command_output":
      return String(m.content ?? "").trim() ? { label: "Output", text: String(m.content).trim() } : null;
    case "informational":
      // 'info' is the CLI's transcript-only level; the rest it prints.
      return m.level === "info" || !String(m.content ?? "").trim() ? null : { label: m.prevent_continuation ? "Stopped" : "Notice", text: String(m.content).trim(), bad: m.level === "warning" || !!m.prevent_continuation };
    case "api_retry":
      return { label: "Retrying", text: `API ${m.error_status ?? "error"}: attempt ${m.attempt} of ${m.max_retries}, next in ${Math.round((m.retry_delay_ms ?? 0) / 1000)}s`, bad: true };
    case "permission_denied":
      return { label: "Denied", text: [m.tool_name, m.message ?? m.decision_reason].filter(Boolean).join(": "), bad: true };
    case "model_refusal_fallback":
      return { label: "Model fell back", text: `${m.original_model} → ${m.fallback_model}` };
  }
  return null;
}

const streamedByMsg = new Map<string, string>(); // what streamed per message, so the final copy is not drawn twice
let msgId = "";
let blockIds = new Map<number, string>();
let turnOut = 0; // output tokens of this turn's finished messages
let msgOut = 0; // and of the message streaming now
let turnStart = Date.now();
let streamChars = 0, streamTold = 0;
/** Reads one claude's stream until it ends; says why it ended. */
async function drive(): Promise<string> {
  try {
  for await (const m of q as AsyncIterable<any>) {
    if (m.type === "system" && m.subtype === "init") {
      seatModel = m.model ?? seatModel;
      const fresh = adoptSession(m.session_id);
      persistModelSettings();
      initQueue();
      apiKeySource = sourceLabel(m.apiKeySource);
      void refreshLimits();
      writeHostFile();
      emit({ t: "init", session: m.session_id, model: m.model ?? null, cwd: process.cwd(), name: NAME, apiKeySource });
      if (fresh) {
        // Named once herdr already counts the pane as an agent (a rename before the first report has nothing to name).
        // herdr names are lowercase letters, digits, - and _ (1-32); the app shows NAME as given, from the host file.
        const slug = NAME.toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^[^a-z]+/, "").slice(0, 32);
        if (PANE && flag("name") && slug) execFile(HERDR, ["agent", "rename", PANE, slug], { timeout: 3000 }, () => {});
      }
    } else if (m.type === "stream_event") {
      if (m.parent_tool_use_id) continue; // a sub-agent's words arrive whole, tagged, with its assistant message
      const ev = m.event;
      // R1.19: the live line's ↓ ticks while a message streams (its usage only comes at the message's end): every
      // delta (words, thinking, a tool's input) counts at ~4 characters a token, told at most once a second.
      if (ev.type === "content_block_delta") {
        streamChars += String(ev.delta?.text ?? ev.delta?.thinking ?? ev.delta?.partial_json ?? "").length;
        if (Date.now() - streamTold > 1000) {
          streamTold = Date.now();
          emit({ t: "usage", out: turnOut + Math.max(msgOut, Math.round(streamChars / 4)) }, false);
        }
      }
      if (ev.type === "message_delta" && typeof ev.usage?.output_tokens === "number") {
        msgOut = ev.usage.output_tokens;
        emit({ t: "usage", out: turnOut + msgOut }, false);
      } else if (ev.type === "message_stop") {
        turnOut += msgOut;
        msgOut = 0;
      } else if (ev.type === "message_start") {
        streamChars = 0;
        if (ev.message?.usage && inputOf(ev.message.usage) > 0) setCtx(inputOf(ev.message.usage));
        msgId = ev.message?.id ?? `m${Date.now()}`;
        blockIds = new Map();
        if ((state as string) !== "blocked") report("working", undefined, true);
      } else if (ev.type === "content_block_start" && ev.content_block?.type === "thinking") {
        const id = `${msgId}:${ev.index}`;
        blockIds.set(ev.index, id);
        thinkingNow.set(id, { text: "", at: Date.now() });
      } else if (ev.type === "content_block_delta" && ev.delta?.type === "thinking_delta") {
        const id = blockIds.get(ev.index);
        const th = id ? thinkingNow.get(id) : undefined;
        if (!id || !th) continue;
        th.text += ev.delta.thinking ?? "";
        for (const c of clients) send(c, { t: "tdelta", id, text: ev.delta.thinking ?? "" });
      } else if (ev.type === "content_block_start" && ev.content_block?.type === "text") {
        const id = `${msgId}:${ev.index}`;
        blockIds.set(ev.index, id);
        partial.set(id, "");
        out("\n");
      } else if (ev.type === "content_block_delta" && ev.delta?.type === "text_delta") {
        const id = blockIds.get(ev.index);
        if (!id) continue;
        partial.set(id, (partial.get(id) ?? "") + ev.delta.text);
        streamedByMsg.set(msgId, (streamedByMsg.get(msgId) ?? "") + ev.delta.text);
        delta(id, ev.delta.text);
        out(ev.delta.text);
      } else if (ev.type === "content_block_stop") {
        const id = blockIds.get(ev.index);
        const th = id ? thinkingNow.get(id) : undefined;
        if (id && th) {
          thinkingNow.delete(id);
          emit({ t: "thinking", id, text: th.text, ms: Date.now() - th.at, at: Date.now() });
          continue;
        }
        if (id && partial.has(id)) {
          emit({ t: "text", id, text: partial.get(id)!, at: Date.now() });
          partial.delete(id);
        }
      }
    } else if (m.type === "assistant" && m.error && !m.parent_tool_use_id) {
      // R1.20c: the SDK marks a limit or API failure on the message; the chat draws a card, not Claude's words.
      const e = apiError(m, Date.now());
      emit(e);
      out(`\n${dim(`${e.kind === "limit" ? "Limit" : "API error"}: ${e.text}`)}`);
    } else if (m.type === "assistant") {
      const parent = m.parent_tool_use_id ?? undefined;
      for (const b of m.message?.content ?? []) {
        if (b.type === "tool_use") {
          const summary = summarize(b.name, b.input ?? {});
          emit({ t: "tool", id: b.id, name: b.name, summary, input: toolInput(b.name, b.input ?? {}), at: Date.now(), parent });
          if (!parent) out(`\n${dim(`● ${b.name} · ${summary}`)}`);
        } else if (b.type === "text" && b.text && (parent || !(streamedByMsg.get(m.message.id) ?? "").includes(b.text))) {
          emit({ t: "text", id: `${m.message.id}:${b.text.length}`, text: b.text, at: Date.now(), parent });
          if (!parent) out(`\n${b.text}`);
        }
      }
    } else if (m.type === "system" && m.subtype === "task_started") {
      upsertTask(m.task_id, { tool: m.tool_use_id ?? null, kind: m.subagent_type ?? m.task_type ?? "task", description: m.description ?? "", background: !!m.is_backgrounded, status: "running", startedAt: Date.now() });
    } else if (m.type === "system" && m.subtype === "task_progress") {
      upsertTask(m.task_id, { tokens: m.usage?.total_tokens, tools: m.usage?.tool_uses, last: m.last_tool_name ?? null, summary: m.summary ?? undefined, description: m.description || undefined });
    } else if (m.type === "system" && m.subtype === "task_updated") {
      const p = m.patch ?? {};
      upsertTask(m.task_id, { status: p.status, description: p.description, background: p.is_backgrounded, endedAt: p.end_time ?? undefined });
    } else if (m.type === "system" && m.subtype === "task_notification") {
      upsertTask(m.task_id, { status: m.status, summary: m.summary ?? undefined, endedAt: Date.now(), tokens: m.usage?.total_tokens, tools: m.usage?.tool_uses });
    } else if (m.type === "system" && m.subtype === "background_tasks_changed") {
      background = (m.tasks ?? []).filter((x: any) => !x.ambient).map((x: any) => ({ id: x.task_id, kind: x.task_type, description: x.description }));
      emit({ t: "bg", list: background }, false);
    } else if (m.type === "user" && m.origin?.kind === "peer" && !m.parent_tool_use_id) {
      const c = m.message?.content;
      const text = m.origin.body ?? (typeof c === "string" ? c : Array.isArray(c) ? c.filter((b: any) => b?.type === "text").map((b: any) => b.text).join("\n") : "");
      emit({ t: "user", text, at: Date.now(), from: "peer", name: m.origin.name ?? m.origin.from });
      out(`\n${dim(`from ${m.origin.name ?? m.origin.from}:`)} ${text}\n`);
    } else if (m.type === "user") {
      const c = m.message?.content;
      const parent = m.parent_tool_use_id ?? undefined;
      if (Array.isArray(c)) for (const b of c) if (b?.type === "tool_result") emit({ t: "tool_done", id: b.tool_use_id, ok: !b.is_error, ...toolOut(b.content), at: Date.now(), parent });
      if (typeof c === "string" && c.includes("<local-command-stdout>")) {
        const text = c.replace(/<\/?local-command-stdout>/g, "").trim();
        emit({ t: "note", text, at: Date.now() });
        out(`\n${text}`);
      }
    } else if (m.type === "system" && m.subtype === "status") {
      // The CLI's own compaction status: the relay's backstop when a hook did not fire, and its failure.
      if (m.status === "compacting") compactStart("auto", m.session_id);
      else if (m.compact_result === "failed") compactEnd(null, m.session_id, String(m.compact_error ?? "no reason given"));
      else if (m.compact_result === "success" && compacting) setTimeout(() => compactEnd(null), 2000); // PostCompact's turn first
    } else if (m.type === "system" && m.subtype === "compact_boundary") {
      const c = m.compact_metadata ?? {};
      adoptSession(m.session_id);
      if (typeof c.post_tokens === "number") (lastPostTokens = c.post_tokens), setCtx(c.post_tokens);
      if (compacting || compactTold) compactTold = false; // the relay says it
      else {
        const n = systemNote(m)!;
        emit({ t: "note", ...n, at: Date.now() });
        out(`\n${dim(`${n.label}: ${n.text}`)}`);
      }
    } else if (m.type === "system" && SHOWN_SYSTEM.has(m.subtype)) {
      // R1.20: what the CLI prints that the chat used to drop (compaction, hook output, retries, refusals, denials).
      const n = systemNote(m);
      if (n) {
        emit({ t: "note", ...n, at: Date.now() });
        out(`\n${dim(`${n.label}: ${n.text.split("\n")[0]}`)}`);
      }
    } else if (m.type === "command_lifecycle") {
      lifecycle(m.command_uuid, m.state);
    } else if (m.type === "result" && !m.parent_tool_use_id) {
      activity.finish(classifyClaudeResult(m, activity.interrupted), (queueStore?.snapshot().entries.filter(e => e.phase === 'saved').length ?? 0) + held.length + waiting.size);
      const cost = typeof m.total_cost_usd === "number" ? m.total_cost_usd : null;
      if (m.is_error || (m.subtype && m.subtype !== "success")) {
        const why = [m.result, ...(Array.isArray(m.errors) ? m.errors : [])].filter((x) => typeof x === "string" && x.trim()).join("\n");
        emit({ t: "note", label: "Turn ended with an error", text: why || String(m.subtype ?? "error"), bad: true, at: Date.now() });
      }
      emit({ t: "result", ms: m.duration_ms ?? Date.now() - turnStart, cost, at: Date.now() });
      out(`\n${dim(`done · ${((m.duration_ms ?? 0) / 1000).toFixed(1)}s${cost !== null ? ` · $${cost.toFixed(2)} so far` : ""}`)}`);
      if (m.is_error || (m.subtype && m.subtype !== 'success')) queueStore?.hold();
      if (rootPrompt && queueStore) emit(queueStore.record(rootPrompt, 'accepted'));
      if (rootPrompt && rootReviewBaseline) await recordChangesBoundary(session, TOKEN, rootPrompt, 'completion', rootEpoch ?? undefined, m.is_error ? 'failed' : 'completed');
      rootPrompt = null; rootEpoch = null; rootReviewBaseline = false;
      idleSleep?.changed(true);
      report(pending.size || questions.size ? 'blocked' : 'idle');
      compactEnd(null); // a compaction the turn outlived (no PostCompact): over, and its held messages go on
      // Handed over too late to fold into this turn: they are the next turn's, so they show as sent, and Claude works on.
      for (const id of released) if (waiting.has(id)) (lifecycle(id, "started"), report("working"));
      released.clear();
      drainNext(); publishQueue();
      refreshCtx();
      void refreshLimits();
      turnOut = 0;
      msgOut = 0;
      promptMark();
      turnStart = Date.now();
    }
  }
  return "its process ended";
  } catch (e) {
    return (e as Error).message || "its process ended";
  }
}

/**
 * a0-018: the claude under this host died (killed, crashed, ran out of memory). The host stays: the seat, its chat and
 * its herdr agent are its own and stay up, marked honestly (blocked when a turn was cut off, else idle), nothing it
 * holds is released, and every message Claude had not taken yet goes to the next claude, which starts on the same
 * session with the next message (at once when messages are owed, unless the last start was moments ago).
 */
let restartNow: (() => void) | null = null;
function childStopped(why: string) {
  if (!shuttingDown) activity.runtimeFailed(session);
  const midTurn = state !== "idle";
  child = 'stopped';
  ++gen; stopSettings?.(); stopSettings = null;
  questions.suspend(); queueStore?.hold(); rootEpoch = null;
  for (const e of queueStore?.snapshot().entries ?? []) if (['dispatching','offered'].includes(e.phase)) emit(queueStore!.record(e.id, 'unknown'));
  for (const [id, text] of partial) if (text) emit({ t: "text", id, text, at: Date.now() });
  partial.clear();
  thinkingNow.clear();
  for (const [id, r] of [...pending]) (pending.delete(id), emit({ t: "approval_done", id, allow: false }), r({ behavior: "deny", message: "Claude stopped." }));
  // Owed, oldest first: what it was handed but never took, what a compaction held, what it never read.
  const owed = [...[...waiting.values()].map((w) => w.msg), ...held.splice(0), ...inbox.splice(0), ...settingsHeld.splice(0)];
  inbox.push(...owed.filter((m, i) => owed.indexOf(m) === i && !queueStore?.snapshot().entries.some(e => e.id === m.uuid)));
  publishQueue();
  for (const id of [...waiting.keys()]) lifecycle(id, "started");
  if (compacting) (compacting = null), (compactTold = false);
  const text = `Claude stopped${midTurn ? " mid-turn" : ""} (${why}).${inbox.length ? ` Starting it again on this session for ${inbox.length} waiting message${inbox.length === 1 ? "" : "s"}.` : " Your next message starts it again on this session."}`;
  emit({ t: "note", label: "Claude stopped", text, bad: true, at: Date.now() });
  out(`\n${dim(text)}\n`);
  report(midTurn ? "blocked" : "idle", `Claude stopped: ${why}`.slice(0, 200));
  writeHostFile();
}

promptMark();
for (;;) {
  const why = await drive();
  childStopped(why);
  const soon = inbox.length && Date.now() - startedClaudeAt > 10_000;
  if (!soon) await new Promise<void>((r) => (restartNow = r));
  restartNow = null;
  startClaude();
  if (soon) report("working"); // a message sent meanwhile already said so
}
