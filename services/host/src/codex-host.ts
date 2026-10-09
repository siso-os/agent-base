import { createIdleSleep, readSleepHost } from './idle-sleep.ts';
import { CodexChildren, childIdentity, dynamicChildTools } from "./codex-children.ts";
import { recordChangesBoundary } from "./changes-checkpoint.ts";
/** Interactive Codex spike. siso-host --harness codex [--name N] [--resume THREAD] [--prompt TEXT].
 * Requires the installed Codex CLI (v2 app-server protocol; tested on 0.159.2) and its existing login.
 * Starts no Claude SDK, never uses the global model, and never attaches to a live terminal.
 */
import { guardWorkspace } from "./worktree-contract.ts";
import { spawn } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { diskMessage, diskState, dropTemp, isNoSpace, noteNoSpace, onDisk, persist } from "./disk.ts";
import http from "node:http";
import { homedir } from "node:os";
import path from "node:path";
import readline from "node:readline";
import { WebSocketServer, type WebSocket } from "ws";
import type { ChatEvent } from "./host.ts";
import { PromptQueue } from './prompt-queue.ts';
import { admitChildReturn, holdChildReturnDispatch } from './child-return.ts';
import { validatePrompt } from './delivery.ts';
import { Questions, normalizeQuestions } from './questions.ts';
import { AttentionCommands } from './attention-commands.ts';
import { ActivityJournal, classifyCodexTurn, type ActivityUsage } from './activity.ts';
import { codexItem } from "./codex-events.ts";
import { createBackendRuntime } from './backend-runtime.ts';
import { backendChildEnvironment } from './backend-version.ts';
import { createWriterMeasurementObserver, readWriterMeasurementReceipt } from './writer-measurement-observer.ts';

const args = process.argv.slice(2);
const help = "siso-host --harness codex --model MODEL [--name N] [--cwd DIR] [--effort E] [--sandbox S] [--approval P] [--collaboration-mode plan|default] [--lead NAME] [--resume THREAD] [--prompt TEXT]";
if (args.includes("--help")) { console.log(help); process.exit(0); }
for (let i = 0; i < args.length; i += 2) {
  if (!["--collaboration-mode", "--name", "--model", "-m", "--cwd", "--effort", "--sandbox", "--approval", "--lead", "--resume", "--prompt"].includes(args[i]) || !args[i + 1] || args[i + 1].startsWith("-")) {
    console.error(help); process.exit(2);
  }
}
const flag = (n: string) => { const i = args.indexOf(`--${n}`); return i < 0 ? undefined : args[i + 1]; };
const exactResume = process.env.AB_EXACT_RESUME;
if (exactResume && (!/^[A-Za-z0-9_-]{1,128}$/.test(exactResume) || exactResume !== flag('resume'))) {
  console.error('Exact resume identity disagrees with --resume'); process.exit(2);
}
let model = flag("model") ?? (args.includes("-m") ? args[args.indexOf("-m") + 1] : "");
const collaborationMode = flag('collaboration-mode');
if (collaborationMode && !['plan','default'].includes(collaborationMode)) { console.error('Unknown collaboration mode'); process.exit(2); }
const name = flag("name") ?? "CODEX";
if (!model?.trim() || !/^[A-Za-z0-9][A-Za-z0-9 _.-]{0,127}$/.test(name)) {
  console.error("Codex requires an explicit model and a valid host name"); process.exit(2);
}
if (flag("cwd")) process.chdir(flag("cwd")!);
const workspaceReceipt = guardWorkspace(process.cwd(), name, flag("resume"));
// Explicit opt-in from the server-owned private job receipt. Ordinary hosts take the unchanged path.
const writerMeasurementReceiptFile = process.env.AB_WRITER_MEASUREMENT_RECEIPT;
if (workspaceReceipt && (process.env.AB_WORKSPACE_ID !== undefined && process.env.AB_WORKSPACE_ID !== workspaceReceipt.workspaceId || process.env.AB_TASK_ID !== undefined && process.env.AB_TASK_ID !== (workspaceReceipt.input.taskId ?? ''))) throw new Error('Workspace identity environment disagrees with validated receipt');
// Effort per turn (codex-run's default is medium). Sandbox and approvals come from the login's Codex config, exactly as every
// codex-run job gets them, unless named here: an unattended chat that asked for approval would wait for nobody.
let effort = flag("effort") ?? "medium";
// `--lead "Agent Zero"`: a chat Agent Zero started for itself (research, sub-agents): the app files it under Agent Zero.
const lead = flag("lead") ?? null;
const policy = { ...(flag("sandbox") ? { sandbox: flag("sandbox") } : {}), ...(flag("approval") ? { approvalPolicy: flag("approval") } : {}) };
if (!/^(none|minimal|low|medium|high|xhigh|max|ultra)$/.test(effort)) { console.error("Unknown --effort"); process.exit(2); }
const dir = process.env.AB_HOSTS_DIR ?? path.join(homedir(), ".local/state/agent-base/hosts");
const pane = process.env.HERDR_ENV === "1" ? process.env.HERDR_PANE_ID ?? null : null;
const file = path.join(dir, pane ? `${pane.replace(/[^A-Za-z0-9_-]/g, "_")}.json` : `name-${name}.json`);
try {
  const held = JSON.parse(readFileSync(file, "utf8"));
  let alive = false;
  try { process.kill(held.pid, 0); alive = true; } catch {}
  if (alive) { console.error("This seat already runs a host"); process.exit(2); }
  if (held.harness === "codex" && held.session && held.session === flag("resume")) {
    model = held.model ?? model; effort = held.effort ?? effort;
  }
} catch {}
type ModelChoice = { id: string; label: string; description: string; efforts: string[] };
let models: ModelChoice[] = [];
const token = randomBytes(18).toString("base64url");
const startedAt = Date.now();
let session: string | null = null;
let state: "idle" | "working" | "blocked" = "idle";
let child: "running" | "stopped" = "running";
let port = 0;
let turnId: string | null = null;
let turnAt = 0;
let ctx: { used: number; window: number; pct: number } | null = null;
let usage = 0;
let tokensIn: number | null = null, tokensOut: number | null = null, tokensPerSecond: number | null = null;
// Accounting is separate from live cumulative HUD counters. Only exact-turn provider
// snapshots may enter a run's durable cost; resumed history starts unknown.
let accountingBaseline: ActivityUsage | null = null;
let turnUsage: ActivityUsage | null = null;
const numberOrNull = (v: unknown) => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 ? v : null;
const usageSnapshot = (total: any): ActivityUsage | null => total && typeof total === 'object' ? {
  inputTokens: numberOrNull(total.inputTokens), outputTokens: numberOrNull(total.outputTokens),
  cacheReadInputTokens: numberOrNull(total.cachedInputTokens ?? total.cacheReadInputTokens),
  cacheCreationInputTokens: numberOrNull(total.cacheCreationInputTokens), cumulative: true,
} : null;
let closing = false;
const log: ChatEvent[] = [];
let idleSleep: ReturnType<typeof createIdleSleep> | undefined;
const managedTasks = new Map<string, import("./host.ts").Task>();
const children = new CodexChildren({ name, session: () => session, emit, task: task => { managedTasks.set(task.id, task); idleSleep?.changed(); emit({ t: "task", task }, false); }, returned: async input => {
  const { receipt, fresh } = admitChildReturn(queueStore, input);
  if (!fresh) return receipt;
  const admittedQueue = queueStore;
  emit(receipt); snapshot();
  setImmediate(async () => {
    try {
      if (!queueStore || queueStore !== admittedQueue || queueStore.snapshot().held || closing || child !== "running") return;
      const active = turnId && !starting ? turnId : null;
      if (active) await steer(input.messageId, active); else await drain();
    } catch (err) {
      try { if (admittedQueue) holdChildReturnDispatch(admittedQueue, input.messageId); } catch { /* Storage remains unavailable. */ }
      try { snapshot(); } catch { /* Reporting must not replay a dispatch. */ }
      try { error(err); } catch { /* Do not crash or replay on a reporting failure. */ }
    }
  });
  return receipt;
} });
const partial = new Map<string, string>();
const clients = new Set<WebSocket>();
const send = (ws: WebSocket, event: unknown) => ws.readyState === ws.OPEN && ws.send(JSON.stringify(event));
let activity: ActivityJournal;
function emit(event: ChatEvent, keep = true) {
  if (event.t === 'approval' || event.t === 'approval_done') activity?.request(event.id, 'approval', event.t === 'approval');
  if (event.t === 'question') activity?.request(event.request.id, 'input', true);
  if (event.t === 'question_done') activity?.request(event.id, 'input', false);
  if (keep) { log.push(event); if (log.length > 4000) log.splice(0, log.length - 4000); }
  for (const ws of clients) send(ws, event);
  if (event.t === "text") console.log(event.text);
}
function writeHost(extra: Record<string, unknown> = {}) {
  if (!port) return;
  const tmp = `${file}.${process.pid}.tmp`;
  const text = JSON.stringify({ pid: process.pid, runnerPid: Number(process.env.AB_RUNNER_PID) || undefined, port, token, name, pane, session, model, effort, models, harness: "codex", ...childIdentity(), taskId, workspaceId, backend: backendRuntime?.snapshot(session) ?? null, lead, label: process.env.AB_SERVICE_LABEL, cwd: process.cwd(), state, child, tokensIn, tokensOut, tokensPerSecond, ctx, context: ctx ? { used: ctx.used, cap: ctx.window } : null, startedAt, ...activity?.metadata(), updatedAt: Date.now(), disk: diskState(), ...idleSleep?.fields(), ...extra });
  // t-0504: a full disk keeps the last host file and retries; the run goes on.
  const write = () => {
    try { mkdirSync(dir, { recursive: true, mode: 0o700 }); writeFileSync(tmp, text, { mode: 0o600 }); renameSync(tmp, file); }
    catch (e) { dropTemp(tmp); throw e; }
  };
  if (extra.state === "asleep") write(); else persist("host-file", write);
}
process.on("uncaughtException", (e) => { if (isNoSpace(e)) { noteNoSpace(); return; } console.error(e); process.exit(1); });
process.on("unhandledRejection", (e) => { if (isNoSpace(e)) { noteNoSpace(); return; } console.error(e); process.exit(1); });
onDisk((d) => { emit({ t: "error", kind: "api", text: diskMessage(d), at: Date.now() } as ChatEvent); writeHost(); });
let queueStore: PromptQueue | null = null;
const pendingAuto = new Set<string>();
const capabilities = () => ({ version: 1 as const, auto: true, steer: 'native-turn' as const, images: false, activeTurnId: turnId, compacting: false });
function snapshot() { idleSleep?.changed(); if (queueStore) emit({ t: 'queue.snapshot', snapshot: queueStore.snapshot(), capabilities: capabilities() }, false); }
function report(next: typeof state) { state = next; writeHost(); emit({ t: "state", state }, false); snapshot(); }
const questions = new Questions(e => { emit(e); if (e.t === 'question') report('blocked'); else if (e.t === 'question_done' && !questions.size && !approvals.size) report(turnId ? 'working' : 'idle'); }, { directory: process.env.AB_QUESTION_JOURNAL_DIR ?? path.join(dir, 'questions'), owner: { seat: process.env.AB_SERVICE_NAME ?? pane ?? name, cwd: process.cwd(), provider: 'codex', workspaceId: workspaceReceipt?.workspaceId, serviceLabel: process.env.AB_SERVICE_LABEL } });
const taskId = workspaceReceipt ? workspaceReceipt.input.taskId ?? undefined : process.env.AB_TASK_ID;
if (taskId !== undefined && !/^[A-Za-z0-9_-]{1,128}$/.test(taskId)) throw new Error('Invalid explicit task identity');
const workspaceId = workspaceReceipt ? workspaceReceipt.workspaceId : process.env.AB_WORKSPACE_ID;
activity = new ActivityJournal(pane ?? name, questions.hostInstance, { ...(taskId ? { taskId } : {}), ...(workspaceId ? { workspaceId } : {}) });
const attentionCommands = new AttentionCommands(activity);
const completedTurns = new Set<string>();
let writerMeasurement: Awaited<ReturnType<ReturnType<typeof createWriterMeasurementObserver>>> | null = null;
function error(err: unknown) { emit({ t: "error", kind: "api", text: err instanceof Error ? err.message : String(err), at: Date.now() }); }

// Hosted children inherit the binary, but never claim their parent's service selection identity.
const backendSelection = childIdentity() ? undefined : process.env.AB_BACKEND_SELECTION;
const backendRuntime = createBackendRuntime(backendSelection, { name, label: process.env.AB_SERVICE_LABEL ?? '', cwd: process.cwd() }, workspaceReceipt?.workspaceId, process.env.AB_CODEX_BIN ?? 'codex');
const runtime = spawn(process.env.AB_CODEX_BIN ?? "codex", ["-m", model, "-c", "features.multi_agent=false", "-c", "features.multi_agent_v2=false", "app-server", "--listen", "stdio://"], {
  stdio: ["pipe", "pipe", "pipe"], env: { ...(backendSelection ? backendChildEnvironment(process.env, backendSelection, { name, label: process.env.AB_SERVICE_LABEL ?? '', cwd: process.cwd() }) : process.env), HERDR_ENV: "0", AB_HOST_NAME: name },
});
runtime.once('spawn', () => { backendRuntime?.spawned(runtime.pid); writeHost(); });
// Do not copy runtime stderr (may contain private config or prompts) into the app log.
runtime.stderr.resume();
let sequence = 0;
const requests = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }>();
const approvals = new Map<string, string>();
const write = (message: unknown) => runtime.stdin.write(`${JSON.stringify(message)}\n`);
function rpc(method: string, params: unknown, timeout = 30_000): Promise<any> {
  const id = ++sequence;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { requests.delete(id); reject(new Error(`${method} timed out`)); }, timeout);
    requests.set(id, { resolve, reject, timer });
    write({ id, method, params });
  });
}
async function refreshModels() {
  const next: ModelChoice[] = [];
  let cursor: string | null = null;
  do {
    const result = await rpc("model/list", { includeHidden: true, cursor }, 5000);
    for (const m of result.data ?? []) next.push({ id: m.model, label: m.displayName, description: m.description, efforts: m.supportedReasoningEfforts.map((e: any) => e.reasoningEffort) });
    cursor = result.nextCursor ?? null;
  } while (cursor);
  models = next; writeHost();
}
let settingsSwitch = Promise.resolve();
function switchSettings(m: { model?: string; effort?: string }, ws: WebSocket) {
  settingsSwitch = settingsSwitch.then(async () => {
    try {
      if (turnId || starting || child === "stopped") throw Error("Wait for the current turn to finish before changing model or effort");
      if (!models.length) await refreshModels();
      const nextModel = m.model ?? model;
      const nextEffort = m.effort ?? effort;
      const choice = models.find(x => x.id === nextModel);
      if (!choice) throw Error("Model is not offered by this Codex account");
      if (!choice.efforts.includes(nextEffort)) throw Error(`${choice.label} does not support ${nextEffort}; choose ${choice.efforts.join(", ")} first`);
      // These are the exact overrides sent on every turn/start. Never change an active turn's label.
      const previous = { model, effort };
      model = nextModel; effort = nextEffort;
      try { writeHost(); } catch (e) { model = previous.model; effort = previous.effort; throw e; }
      emit({ t: "init", session: session!, model, cwd: process.cwd(), name });
      emit({ t: "note", label: "Model and effort", text: `${model} · ${effort} · saved for the next turn`, at: Date.now() });
    } catch (e) { send(ws, { t: "note", label: "Settings unchanged", text: (e as Error).message, bad: true, at: Date.now() }); }
  });
}
function failedRuntime(err: Error) {
  backendRuntime?.stopped(!closing);
  child = "stopped";
  questions.suspend(); queueStore?.hold();
  for (const r of requests.values()) { clearTimeout(r.timer); r.reject(err); }
  requests.clear();
  if (!closing) { activity.runtimeFailed(session); error(err); report("blocked"); shutdown(); process.exitCode = 1; }
}
runtime.on("error", failedRuntime);
runtime.on("exit", (code) => failedRuntime(new Error(`Codex app-server exited (${code})`)));
runtime.stdin.on("error", () => {});
const lines = readline.createInterface({ input: runtime.stdout });
const startedTools = new Set<string>();
lines.on("line", async (line) => {
  let m: any;
  try { m = JSON.parse(line); } catch { return; }
  if (m.id !== undefined && !m.method) {
    const r = requests.get(m.id);
    if (r) { requests.delete(m.id); clearTimeout(r.timer); m.error ? r.reject(new Error(m.error.message)) : r.resolve(m.result); }
    return;
  }
  const p = m.params ?? {};
  if (m.id !== undefined) {
    if (m.method === 'item/tool/call') {
      try {
        if (childIdentity() || !session || p.threadId !== session || p.turnId !== turnId) throw Error('Child tool scope unavailable');
        const result = await children.call(p.tool, p.arguments);
        write({ id: m.id, result: { success: true, contentItems: [{ type: 'inputText', text: JSON.stringify(result) }] } });
      } catch (e) { write({ id: m.id, result: { success: false, contentItems: [{ type: 'inputText', text: (e as Error).message }] } }); }
    } else if (m.method === 'item/tool/requestUserInput') {
      try {
        if (!session || p.threadId !== session || typeof p.turnId !== 'string' || !p.turnId || p.turnId !== turnId || typeof p.itemId !== 'string' || !p.itemId || !(typeof m.id === 'string' || Number.isSafeInteger(m.id))) throw Error('Stale question turn');
        const specs = normalizeQuestions(p.questions, 'codex');
        // T3 Code CodexAdapterV2.toCodexUserInputAnswers (MIT): retain the original JSON-RPC envelope ID.
        questions.add({ session, turnId: p.turnId, toolId: p.itemId, nativeRequestId: JSON.stringify(m.id), provider: 'codex', questions: specs }, async answers => {
          await new Promise<void>((resolve, reject) => {
            if (closing || child === 'stopped' || session !== p.threadId || turnId !== p.turnId || runtime.stdin.destroyed || runtime.stdin.writableEnded) return reject(Error('Native question callback is no longer live'));
            runtime.stdin.write(JSON.stringify({ id: m.id, result: { answers: Object.fromEntries(Object.entries(answers ?? {}).map(([id, answers]) => [id, { answers }])) } }) + '\n', e => e ? reject(e) : resolve());
          });
        });
      } catch (e) {
        write({ id: m.id, error: { code: -32602, message: (e as Error).message } });
        emit({ t: 'note', text: 'Unsupported Codex question: ' + (e as Error).message, at: Date.now(), bad: true });
      }
    } else if (["item/commandExecution/requestApproval", "item/fileChange/requestApproval"].includes(m.method)) {
      const id = String(m.id);
      approvals.set(id, m.id);
      emit({ t: "approval", id, tool: m.method.includes("command") ? "Bash" : "Edit", summary: p.command ?? p.reason ?? "Codex requests permission" });
      report("blocked");
    } else {
      // Unsupported interactive requests fail closed, rather than silently hanging the model.
      write({ id: m.id, error: { code: -32601, message: "Unsupported request in Codex host spike" } });
      emit({ t: "note", text: `Unsupported Codex request: ${m.method}`, at: Date.now(), bad: true });
    }
    return;
  }
  if (p.threadId && session && p.threadId !== session) return;
  if (m.method === "item/agentMessage/delta") {
    partial.set(p.itemId, (partial.get(p.itemId) ?? "") + p.delta);
    for (const ws of clients) send(ws, { t: "delta", id: p.itemId, text: p.delta });
  } else if (m.method === "item/started" || m.method === "item/completed") {
    const done = m.method === "item/completed";
    if (p.item.type === "userMessage") return; // own prompt was already emitted
    writerMeasurement?.observe(m.method, p.item);
    if (!done) startedTools.add(p.item.id);
    else if (!startedTools.has(p.item.id)) for (const e of codexItem(p.item, false)) emit(e);
    for (const e of codexItem(p.item, done)) emit(e);
    if (done) { partial.delete(p.item.id); startedTools.delete(p.item.id); }
  } else if (m.method === "turn/started") {
    if (!p.turn?.id || completedTurns.has(p.turn.id) || activity.ref?.runId === p.turn.id) return;
    activity.start(session!, p.turn.id, accountingBaseline);
    turnId = p.turn.id; turnAt = Date.now(); usage = 0; turnUsage = null; tokensPerSecond = null; report("working");
  } else if (m.method === "thread/tokenUsage/updated") {
    if (p.turnId && p.turnId !== turnId) return;
    usage = p.tokenUsage.last.outputTokens;
    tokensIn = p.tokenUsage.total.inputTokens;
    tokensOut = p.tokenUsage.total.outputTokens;
    if (turnId && p.turnId === turnId && p.threadId === session) turnUsage = usageSnapshot(p.tokenUsage.total);
    tokensPerSecond = turnAt ? Math.round(10 * usage / Math.max(0.001, (Date.now() - turnAt) / 1000)) / 10 : null;
    emit({ t: "usage", out: usage, total: (tokensIn ?? 0) + (tokensOut ?? 0), rate: tokensPerSecond ?? undefined }, false);
    const window = p.tokenUsage.modelContextWindow;
    if (window > 0) {
      const used = p.tokenUsage.last.totalTokens;
      ctx = { used, window, pct: Math.round(100 * used / window) };
      emit({ t: "context", ...ctx }, false);
    }
    writeHost();
  } else if (m.method === "turn/completed") {
    if (!p.turn?.id || p.turn.id !== turnId || completedTurns.has(p.turn.id)) return;
    writerMeasurement?.turnCompleted();
    const terminalUsage = p.threadId === session ? (p.tokenUsage?.total ? usageSnapshot(p.tokenUsage.total) : turnUsage) : null;
    accountingBaseline = terminalUsage;
    activity.finish(classifyCodexTurn(p.turn), queueStore?.snapshot().entries.filter(e => e.phase === 'saved').length ?? 0, terminalUsage);
    completedTurns.add(p.turn.id);
    const reviewPrompt = reviewTurns.get(p.turn.id) ?? reviewStarting;
    if (reviewPrompt) await recordChangesBoundary(session, token, reviewPrompt, 'completion', p.turn.id, p.turn.status);
    reviewTurns.delete(p.turn.id);
    questions.cancel(p.turn.id);
    turnId = null;
    if (p.turn.status !== 'completed') queueStore?.hold();
    partial.clear(); startedTools.clear();
    for (const id of approvals.keys()) emit({ t: "approval_done", id, allow: false });
    approvals.clear();
    if (p.turn.status === "failed") error(p.turn.error?.message ?? "Codex turn failed");
    if (p.turn.status === "interrupted") emit({ t: "note", text: "Turn interrupted", at: Date.now() });
    emit({ t: "result", turnId: p.turn.id, status: p.turn.status, ms: p.turn.durationMs ?? Date.now() - turnAt, cost: null, at: Date.now() });
    idleSleep?.changed(true); report("idle"); void drain();
  } else if (m.method === "error") error(p.error?.message ?? "Codex error");
});

const reviewTurns = new Map<string,string>();
let reviewStarting: string | null = null;
let starting = false;
function receiptFailure(m: any, err: unknown) {
  emit({ t: 'prompt.receipt', key: m.key ?? '', id: m.id ?? m.messageId, phase: 'failed', queueRevision: queueStore?.snapshot().revision ?? 0, code: (err as Error).message, text: (err as Error).message }); snapshot();
}
async function steer(id: string, target: string) {
  if (!queueStore || starting || !turnId || turnId !== target) throw Error('stale_turn');
  const entry = queueStore.claim(id); if (!entry) return;
  snapshot();
  try {
    // T3 Code CodexAdapterV2.steerTurn (MIT, T3 Tools Inc., 2026): native exact-turn steering.
    const result = await rpc('turn/steer', { threadId: session, expectedTurnId: target, input: [{ type: 'text', text: entry.text }] });
    if (result.turnId !== target) throw Error('delivery_unknown');
    emit(queueStore.record(id, 'accepted', target));
    emit({ t: 'user', id, text: entry.text, from: entry.from, at: Date.now(), mid: true });
  } catch (err) {
    const ambiguous = /timed out|exited|delivery_unknown/.test((err as Error).message);
    emit(queueStore.record(id, ambiguous ? 'unknown' : 'saved', target, (err as Error).message));
  }
  snapshot();
}
async function drain(id?: string) {
  if (!queueStore || starting || turnId || child === 'stopped' || closing) return;
  await settingsSwitch;
  if (starting || turnId || closing) return;
  starting = true;
  const entry = queueStore.claim(id);
  if (!entry) { starting = false; return; }
  pendingAuto.delete(entry.id);
  snapshot(); report('working');
  try {
    const reviewBaseline = await recordChangesBoundary(session, token, entry.id, 'baseline');
    reviewStarting = reviewBaseline ? entry.id : null;
    const result = await rpc('turn/start', { threadId: session, model, effort, ...(collaborationMode ? { collaborationMode: { mode: collaborationMode, settings: { model, reasoning_effort: effort, developer_instructions: null } } } : {}), input: [{ type: 'text', text: entry.text }] });
    if (!result.turn?.id) throw Error('delivery_unknown');
    if (!completedTurns.has(result.turn.id)) { turnId = result.turn.id; if(reviewBaseline)reviewTurns.set(result.turn.id, entry.id); }
    emit(queueStore.record(entry.id, 'accepted', result.turn.id));
    emit({ t: 'user', id: entry.id, text: entry.text, from: entry.from, at: Date.now() });
  } catch (err) {
    const ambiguous = /timed out|exited|delivery_unknown/.test((err as Error).message);
    emit(queueStore.record(entry.id, ambiguous ? 'unknown' : 'saved', undefined, (err as Error).message));
    queueStore.hold(); error(err); report('blocked');
  } finally {
    reviewStarting = null; starting = false; snapshot();
    // Composer sends arriving during turn/start belong in that turn as soon as its ID exists.
    for (const id of [...pendingAuto]) {
      pendingAuto.delete(id);
      if (turnId) await steer(id, turnId);
      else if (state === 'idle') await drain(id);
    }
    if (!turnId && state === 'idle') void drain();
  }
}
async function command(m: any, from: 'app'|'pane' = 'app') {
  try {
    if (closing || !queueStore || child === 'stopped') throw Error('runtime_unavailable');
    if (m.t === 'prompt') {
      m = { ...m, key: m.key ?? randomUUID(), messageId: m.messageId ?? m.key ?? randomUUID(), images: m.images ?? [], delivery: m.delivery ?? 'next', from };
      validatePrompt(m, false);
      const prior = queueStore.prior(m); if (prior) { emit(prior); snapshot(); return; }
      // Explicit steer never silently becomes a successor turn.
      if (m.delivery === 'steer' && (starting || m.expectedTurnId !== turnId)) throw Error('stale_turn');
    }
    if (m.t !== 'prompt') { const prior = queueStore.prior(m); if (prior) { emit(prior); snapshot(); return; } }
    if (m.t === 'queue.edit' && m.images !== undefined && (!Array.isArray(m.images) || m.images.length)) throw Error('unsupported_images');
    if (m.t === 'queue.steer' && (starting || m.expectedTurnId !== turnId)) throw Error('stale_turn');
    const r = queueStore.command(m); emit(r); snapshot();
    if (m.delivery === 'auto' || m.t === 'queue.send') {
      if (turnId && !starting) await steer(r.id!, turnId);
      else { pendingAuto.add(r.id!); void drain(r.id); }
    }
    else if (m.delivery === 'steer' || m.t === 'queue.steer') await steer(r.id!, m.expectedTurnId);
    else void drain();
  } catch (err) { receiptFailure(m, err); }
}
function prompt(text: string, from: 'app'|'pane') { if (text.trim()) void command({ t: 'prompt', text, delivery: 'auto' }, from); }
const server = http.createServer((req, res) => {
  if (req.url === "/health") { res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify({ pid: process.pid, name, session, child, model, effort, backend: backendRuntime?.snapshot(session) ?? null })); }
  else res.writeHead(404).end();
});
const wss = new WebSocketServer({ noServer: true });
server.on("upgrade", (req, socket, head) => {
  const url = new URL(req.url ?? "/", "http://host");
  if (url.pathname !== "/ws" || url.searchParams.get("token") !== token) return socket.destroy();
  wss.handleUpgrade(req, socket, head, (ws) => {
    const parentControl = !!childIdentity() && !!process.env.AB_PARENT_CONTROL_TOKEN && url.searchParams.get("controller") === process.env.AB_PARENT_CONTROL_TOKEN;
    clients.add(ws);
    const questionRecovery = questions.recoverySnapshot(session);
    send(ws, { t: "hello", name, session, model, effort, models, state, child, ctx, log, partial: Object.fromEntries(partial), thinking: {}, tasks: [...managedTasks.values()], bg: [], queue: queueStore?.snapshot(), capabilities: capabilities(), hostInstance: questions.hostInstance, questionCapability: questionRecovery.status !== 'unavailable', pendingQuestions: questions.snapshot(), questionRecovery });
    send(ws, { t: "usage", out: usage });
    ws.on("message", (raw) => {
      let m: any; try { m = JSON.parse(String(raw)); } catch { return; }
      if (m.t === 'attention_command') {
        void attentionCommands.handle(m, () => attentionCommands.matches(m, session) && child !== 'stopped', async () => {
          const a = m.action;
          if (!a || !['approve','deny','reply','answer','dismiss'].includes(a.kind)) return 'unsupported';
          if (a.kind === 'approve' || a.kind === 'deny') {
            if (!approvals.has(a.requestId)) return 'stale';
            write({ id: approvals.get(a.requestId), result: { decision: a.kind === 'approve' ? 'accept' : 'decline' } }); approvals.delete(a.requestId); emit({ t: 'approval_done', id: a.requestId, allow: a.kind === 'approve' }); if (!approvals.size && !questions.size) report('working');
            return 'accepted';
          }
          if (a.kind === 'answer' || a.kind === 'dismiss') {
            const request = questions.snapshot().find(q => q.id === a.requestId);
            if (!request || request.session !== session) return 'stale';
            const result = await questions.answer({ t: 'answer_question', id: request.id, hostInstance: questions.hostInstance, session, submissionId: m.commandId, action: a.kind === 'dismiss' ? 'dismiss' : 'answer', answers: a.answers });
            return questions.snapshot().some(q => q.id === request.id) ? 'invalid' : result && result.t === 'question_done' && result.outcome === (a.kind === 'dismiss' ? 'dismissed' : 'answered') ? 'accepted' : 'unavailable';
          }
          const prompt = { t: 'prompt', key: m.commandId, messageId: m.commandId, text: a.text, images: [], delivery: 'next', from: 'app' };
          validatePrompt(prompt, false);
          if (!queueStore) return 'unavailable';
          emit(queueStore.command(prompt)); snapshot(); void drain();
          return 'queued';
        }).then(ack => send(ws, ack));
      }
      else if (m.t === "set_model" && typeof m.model === "string") switchSettings({ model: m.model }, ws);
      else if (m.t === "set_effort" && typeof m.effort === "string") switchSettings({ effort: m.effort }, ws);
      else if (m.t === 'keep_awake' && typeof m.value === 'boolean') { idleSleep?.keepAwake(m.value); writeHost(); send(ws, { t: "sleep.policy", ...idleSleep?.fields() }); }
      else if (m.t === 'stop_task' && managedTasks.has(m.id)) void children.call('stop_codex', { id: m.id }).catch(error);
      else if (m.t === 'prompt' || m.t?.startsWith('queue.')) void command(m, parentControl ? 'pane' : 'app');
      else if (m.t === 'answer_question') void questions.answer(m);
      else if (m.t === 'interrupt') {
        const target = turnId;
        if (m.key && m.expectedTurnId !== target) { send(ws, { t: 'child.stop_receipt', key: m.key, outcome: 'failed', text: 'stale_turn' }); return; }
        queueStore?.hold();
        if (parentControl && m.key && queueStore) {
          // Stop quarantines queued follow-ups for this attempt; a later fresh message can resume explicitly.
          for (const entry of queueStore.snapshot().entries.filter(e => e.phase === 'saved')) emit(queueStore.command({ t: 'queue.remove', key: randomUUID(), id: entry.id, expectedRevision: queueStore.snapshot().revision }));
        }
        snapshot();
        if (turnId) activity.interrupted = true;
        if (target) void rpc('turn/interrupt', { threadId: session, turnId: target }).then(() => { if (m.key) send(ws, { t: 'child.stop_receipt', key: m.key, outcome: 'stop_requested' }); }).catch(e => { if (m.key) send(ws, { t: 'child.stop_receipt', key: m.key, outcome: 'failed', text: (e as Error).message }); else error(e); });
        else if (m.key) send(ws, { t: 'child.stop_receipt', key: m.key, outcome: 'already_finished' });
      } else if (m.t === 'unqueue') {
        try { emit(queueStore!.command({ t: 'queue.remove', key: randomUUID(), id: m.id, expectedRevision: queueStore!.snapshot().revision })); emit({ t: 'unqueued', id: m.id }); snapshot(); }
        catch { send(ws, { t: 'unqueue_failed', id: m.id, text: 'Message already started' }); }
      } else if (m.t === "approve" && approvals.has(m.id)) {
        write({ id: approvals.get(m.id), result: { decision: m.allow ? "accept" : "decline" } });
        approvals.delete(m.id); emit({ t: "approval_done", id: m.id, allow: !!m.allow });
        if (!approvals.size && !questions.size) report("working");
      }
    });
    ws.on("close", () => clients.delete(ws));
  });
});
async function shutdown() {
  if (closing) return;
  idleSleep?.stop();
  await writerMeasurement?.close();
  backendRuntime?.stopped();
  closing = true; child = "stopped"; questions.suspend(); writeHost();
  for (const ws of clients) ws.close();
  await children.close(); runtime.kill("SIGTERM"); server.close();
  const timer = setTimeout(() => { runtime.kill("SIGKILL"); process.exit(0); }, 2000); timer.unref();
}
process.on("SIGTERM", shutdown); process.on("SIGINT", shutdown);
try {
  await rpc("initialize", { clientInfo: { name: "siso_agent_base", title: "Agent Base", version: "0.1.0" }, capabilities: { experimentalApi: true } });
  backendRuntime?.initialized();
  write({ method: "initialized" });
  const resume = flag("resume");
  const fresh = async () => { const created = await rpc("thread/start", { model, config: { model_reasoning_effort: effort }, cwd: process.cwd(), ...policy, dynamicTools: dynamicChildTools(), developerInstructions: childIdentity() ? "You are a read-only or isolated managed child. You have no child spawn tools. Reply to the brief; the host delivers your final answer to your parent automatically." : "Use spawn_codex for full hosted children. They return automatically as input messages. Use message_codex, codex_status and stop_codex to control your own children. Native bare collaboration workers are disabled." }); accountingBaseline = { inputTokens: 0, outputTokens: 0, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, cumulative: true }; return created; };
  // A thread that never had a turn has no rollout on disk, so it cannot be resumed (4 Oct, live: HEALTH crash-looped on
  // "no rollout found"). Nothing was said in it, so a fresh thread loses nothing.
  const result = !resume ? await fresh() : await rpc("thread/resume", { threadId: resume, model, config: { model_reasoning_effort: effort }, cwd: process.cwd(), ...policy })
    .catch((e: Error) => !exactResume && !workspaceReceipt && !childIdentity() && /no rollout found/i.test(e.message) ? fresh() : Promise.reject(e));
  if (exactResume && result.thread.id !== exactResume) throw new Error('Resumed Codex thread identity changed');
  if (workspaceReceipt?.agent?.session && result.thread.id !== workspaceReceipt.agent.session) throw new Error("Workspace resumed thread identity changed");
  session = result.thread.id;
  if (writerMeasurementReceiptFile) {
    if (!workspaceReceipt || childIdentity()) throw new Error('Writer measurement receipt requires a primary owned workspace');
    const writerReceipt = await readWriterMeasurementReceipt(writerMeasurementReceiptFile, workspaceReceipt, process.cwd());
    writerMeasurement = await createWriterMeasurementObserver()(writerReceipt, session!, resume ?? null);
  }
  queueStore = new PromptQueue(pane ?? name, session!);
  emit({ t: "init", session: session!, model, cwd: process.cwd(), name });
  for (const turn of result.thread.turns ?? []) {
    const at = (turn.startedAt ?? result.thread.createdAt) * 1000;
    for (const item of turn.items ?? []) {
      for (const e of [...codexItem(item, false, at), ...codexItem(item, true, at)]) log.push(e);
    }
    if (["completed", "failed", "interrupted"].includes(turn.status)) log.push({ t: "result", turnId: turn.id, status: turn.status, ms: turn.durationMs ?? 0, cost: null, at });
  }
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  port = (server.address() as { port: number }).port; writeHost();
  void refreshModels().catch(() => {}); // Older runtimes can still chat; the picker fails closed without a catalog.
  await children.restore();
  idleSleep = createIdleSleep({ name, file, keepAwake: args.includes('--keep-awake') || name === 'A0',
    busy: () => ({ state: closing || starting || turnId ? 'working' : state,
      queue: queueStore?.snapshot().entries.filter(e => ['saved', 'dispatching', 'offered', 'unknown'].includes(e.phase)).length ?? 1,
      questions: questions.size, approvals: approvals.size,
      children: [...managedTasks.values()].filter(t => !['done', 'completed', 'failed', 'stopped', 'cancelled'].includes(t.status)).length }),
    sleep: fields => {
      try { writeHost(fields); } catch { return; }
      // Disk-full persistence deliberately returns without writing. Never exit without the sleep receipt.
      const saved = readSleepHost(file);
      if (saved.pid !== process.pid || saved.state !== 'asleep' || saved.asleepAt !== fields.asleepAt) return;
      closing = true; idleSleep?.stop(); idleSleep?.record(fields);
      for (const ws of clients) ws.close();
      backendRuntime?.stopped(); runtime.kill('SIGTERM');
      process.exit(75); // The runner owns and reaps this isolated process group.
    },
  });
  if (result.thread.turns?.some((t: any) => t.status === "completed")) idleSleep.changed(true);
  writeHost();

  console.log(`Codex host ready: ${name} · ${model} · thread ${session}`);
  // No EOF shutdown: hosts also receive prompts from the app when stdin is closed.
  readline.createInterface({ input: process.stdin }).on("line", (text) => prompt(text, "pane"));
  if (!flag("resume") && workspaceReceipt?.input.prompt) prompt(workspaceReceipt.input.prompt, "pane");
  else if (flag("prompt")) prompt(flag("prompt")!, "pane");
} catch (err) { backendRuntime?.stopped(true); console.error(err instanceof Error ? err.message : String(err)); shutdown(); process.exitCode = 1; }
