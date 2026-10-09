import type { QuestionEvent } from '../../../../services/host/src/questions';
/**
 * How a siso-host chat is laid out, as data (no React), so the rules can be read and checked on their own.
 *
 * Shaan, 2 Oct 13:00: "the CLI is really clean like it compacts its actions into one view … reverse engineer how the
 * Claude Code CLI works or how T3 code does it". The rules, from the CLI and T3 Code's MessagesTimeline:
 *   - a turn is his message and everything until the next one;
 *   - a finished turn folds its work into one "Worked for 3m 10s" line; the final answer stays visible under it;
 *   - inside the work, consecutive tool calls collapse to one line counted by kind ("Read 2 files, ran 1 shell
 *     command"); an edit, a failed call and a sub-agent stand on their own;
 *   - a sub-agent's own messages (tagged `parent` by the host) live under its card, not in the main chat.
 */

/** What siso-host sends (services/host/src/host.ts ChatEvent). */
export type ToolInput = {
  command?: string; description?: string; path?: string; old?: string; new?: string; created?: boolean;
  to?: string; text?: string; target?: string; wait?: number;
};
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
export type Bg = { id: string; kind: string; description: string };
export type Command = { name: string; description: string; hint: string };
export type State = "idle" | "working" | "blocked";
export type Ev =
  | QuestionEvent
  /** `images`: uploads (by name) a terminal agent got as pasted paths, which its file stores as "[Image #1]". */
  | { t: "user"; id?: string; text: string; at: number; from: string; name?: string; mid?: boolean; images?: string[] }
  | { t: "thinking"; id: string; text: string; ms: number | null; at: number; parent?: string }
  /** `fixed`: a terminal agent's queue (read from its session file); only its pane can take a line back. */
  | { t: "queued"; id: string; text: string; at: number; fixed?: boolean }
  | { t: "unqueued"; id: string }
  | { t: "unqueue_failed"; id: string; text: string }
  | { t: "text"; id: string; text: string; at: number; parent?: string }
  | { t: "tool"; id: string; name: string; summary: string; input?: ToolInput; at: number; parent?: string }
  | { t: "tool_done"; id: string; ok: boolean; out?: string; lines?: number; at?: number; parent?: string }
  /** `label`: what kind of line ("Compacted", "Stop hook error"); "Output" when absent. */
  | { t: "note"; text: string; at: number; label?: string; bad?: boolean }
  /** R1.20c (F4/F5): a limit or an API error, never the agent's own words. `resetsAt` in ms; `window` "five_hour", "seven_day"… */
  | { t: "error"; kind: "limit" | "api"; text: string; at: number; resetsAt?: number; window?: string; status?: number }
  | { t: "approval"; id: string; tool: string; summary: string }
  | { t: "approval_done"; id: string; allow: boolean }
  | { t: "result"; ms: number; cost: number | null; at: number }
  | { t: "init"; session: string; model: string | null }
  | { t: "commands"; list: Command[] };

export type Call = {
  id: string;
  name: string;
  summary: string;
  input?: ToolInput;
  at: number;
  done?: { ok: boolean; out?: string; lines?: number; at?: number };
  /** R1.20c: what the task, sub-agent or schedule a call acts on is (TaskStop, SendMessage to a sub-agent's id). */
  about?: string;
  /** Launched into the background (its id, for TaskStop): its tool result comes at once, its end with a notification. */
  bg?: string;
  /** The background run's end, from its task-notification. */
  end?: { ok: boolean; at: number; status: string };
};
export type Item =
  | { k: "said"; key: string; text: string; live?: boolean }
  | { k: "run"; key: string; calls: Call[] }
  | { k: "one"; key: string; call: Call }
  | { k: "agent"; key: string; call: Call }
  /** `keep`: a line the CLI prints inline (a `!` command's output, "Conversation compacted"): it never folds away. */
  | { k: "note"; key: string; text: string; label?: string; bad?: boolean; keep?: boolean; at?: number }
  | { k: "divider"; key: string; text: string }
  /** Claude's thinking: "Thought for 4s", opening to the text when there is any. */
  | { k: "thought"; key: string; text: string; ms: number | null; live?: boolean }
  /** A message taken mid-turn (his, or a peer's): inline where Claude read it, never a new turn. */
  | { k: "steer"; key: string; text: string; from?: string; name?: string }
  | { k: "ask"; key: string; id: string; tool: string; summary: string }
  | { k: "error"; key: string; kind: "limit" | "api"; text: string; at: number; resetsAt?: number; window?: string };
export type Turn = {
  key: string;
  me: { text: string; at: number; from?: string; name?: string; notice?: Notice; images?: string[] } | null;
  /** Everything Claude did before its final words; folded once the turn is done. */
  work: Item[];
  /** The final words (the text after the last tool call). */
  answer: Item[];
  done: boolean;
  /** How long the turn took (the host's result, else first to last event), and when it ended. */
  ms: number | null;
  endedAt: number | null;
};

/** A background task's end, delivered as a user turn (`<task-notification>…`): one quiet line, never the XML. */
export type Notice = { title: string; status: string; ms: number | null; tool: string | null; event?: string };
export function noticeOf(text: string): Notice | null {
  if (!text.includes("<task-notification>")) return null;
  const tag = (n: string) => text.match(new RegExp(`<${n}>([\\s\\S]*?)</${n}>`))?.[1]?.trim();
  return { title: tag("summary") ?? "A background task finished", status: tag("status") ?? "", ms: Number(tag("duration_ms")) || null, tool: tag("tool-use-id") ?? null, event: tag("event") };
}
/** One background event in a quiet run: when, what kind ("Monitor", "task done"), its one line, the work it set off and how long that took. */
export type QuietEvent = { key: string; at: number; kind: string; line: string; tool: string | null; bad: boolean; work: Item[]; ms: number | null };
export type Block = { k: "turn"; i: number; turn: Turn } | { k: "quiet"; key: string; i: number; events: QuietEvent[] };

const unescape = (s: string) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&amp;/g, "&");
function quietEvent(turn: Turn, work: Item[]): QuietEvent {
  const n = turn.me!.notice!;
  const bad = /fail|stop|kill|error/i.test(n.status);
  const quoted = n.title.match(/"([^"]+)"/)?.[1];
  const kind = /^Monitor event/i.test(n.title) ? "Monitor" : /^Agent\b/.test(n.title) ? (bad ? "sub-agent failed" : "sub-agent done") : bad ? "task failed" : "task done";
  const line = unescape((kind === "Monitor" && n.event ? n.event.split("\n")[0] : quoted ?? n.title).trim());
  return { key: turn.key, at: turn.me!.at, kind, line, tool: n.tool, bad, work, ms: work.length ? turn.ms : null };
}
/**
 * What stays in sight when a turn's work folds: his messages taken mid-turn and the agent's own prose. Only tool calls
 * fold. Shaan 21:20: "I was just reading something and the text just collapsed ... the output seemed to get cut off".
 */
// R1.20c: also a limit/API error card, a message the agent sent another, and a background sub-agent still running (its
// Stop must stay in reach).
// t-0245: also the CLI's "Interrupted" line, which it never hides.
export const staysOpen = (it: Item) =>
  it.k === "steer" || it.k === "error" || it.k === "divider" || (it.k === "said" && !!it.text.trim()) || (it.k === "note" && !!it.keep) ||
  (it.k === "one" && !!peerOut(it.call)) || (it.k === "agent" && !!it.call.bg && !it.call.end);
/** A turn shown without the event that started it: its reply alone (memoised, so TurnView's memo holds). */
const bare = new WeakMap<Turn, Turn>();
function replyOnly(turn: Turn): Turn {
  let t = bare.get(turn);
  if (!t) {
    t = { ...turn, me: null, work: turn.work.some((it) => it.k === "steer") ? turn.work : turn.work.filter(staysOpen) };
    bare.set(turn, t);
  }
  return t;
}
/**
 * Screen 14, quiet events (Shaan 16:18 + 17:40: "i click on the agents and low key it's illegible ... just getting
 * pinged monitor events"). A run of finished background turns (Monitor events, task and sub-agent notifications, with
 * the work each set off) folds into one quiet block. An event the agent answered in prose shows only as its reply:
 * the event joins the run before it and the reply stands as a turn without it. A live turn is never folded.
 * Blocks carry the turn index `i` (the first turn's, for a quiet block) so the minimap and lazy loading still count turns.
 */
export function quietRuns(turns: Turn[], from = 0): Block[] {
  const out: Block[] = [];
  let run: Extract<Block, { k: "quiet" }> | null = null;
  for (let i = from; i < turns.length; i++) {
    const turn = turns[i];
    if (!turn.me?.notice || !turn.done) {
      run = null;
      out.push({ k: "turn", i, turn });
      continue;
    }
    // His words taken mid-turn keep the work in the reply's turn (its fold keeps them in sight); else the event holds it.
    const steers = turn.work.some((it) => it.k === "steer");
    const replied = steers || turn.answer.some(staysOpen) || turn.work.some(staysOpen);
    const ev = quietEvent(turn, steers ? [] : turn.work);
    if (!run) out.push((run = { k: "quiet", key: `q${turn.key}`, i, events: [] }));
    run.events.push(ev);
    if (replied) {
      run = null;
      out.push({ k: "turn", i, turn: replyOnly(turn) });
    }
  }
  return out;
}
/** "5 background events · Monitor ×3, task done ×2 · 17:12–17:18". */
export function quietLabel(events: QuietEvent[]): string {
  const counts = new Map<string, number>();
  for (const e of events) counts.set(e.kind, (counts.get(e.kind) ?? 0) + 1);
  const kinds = [...counts].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ×${n}`).join(", ");
  const first = fmtClock(events[0].at);
  const last = fmtClock(events.at(-1)!.at);
  return `${plural(events.length, "background event")} · ${kinds} · ${first === last ? first : `${first}–${last}`}`;
}

/**
 * Prompts that are not him talking but the harness or a checkpoint (2 Oct 14:37: "checkpoint input prompts should have
 * drop downs because they look quite ugly"): each shows as one quiet line that opens to its text.
 */
export function promptKind(text: string): string | null {
  if (/^\/compact\b/.test(text)) return "Checkpoint";
  if (/^This session is being continued from a previous conversation/.test(text)) return "Earlier conversation, summarized";
  if (/^You are [A-Z][\s\S]{300,}/.test(text)) return "Start prompt";
  return null;
}

/** His words without the harness's wrappers (system reminders, notification preambles). */
export function cleanUser(text: string): string {
  return text
    .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, "")
    .replace(/^\[SYSTEM NOTIFICATION[^\]]*\][\s\S]*/m, "")
    .trim();
}

const ALONE = new Set(["Edit", "Write", "NotebookEdit", "MultiEdit"]);
export const isAgentTool = (name: string) => name === "Agent" || name === "Task";

/**
 * R1.20c (C10/H3/E4): tools whose name says nothing ("used 1 tool" was ~1,200 calls in 6 days). Each stands on its own
 * line and says what it did (`ownLine`); a message to another agent is a → peer row.
 */
const OWN = new Set(["SendMessage", "ScheduleWakeup", "Monitor", "TaskStop", "TaskOutput", "TaskCreate", "TaskUpdate", "TaskGet", "TaskList", "ToolSearch", "ListAgents", "CronCreate", "CronDelete", "CronList", "PushNotification"]);
/** What the chat knows about calls beyond their own events: results, decided approvals, background ids and ends. */
type Known = {
  done: Map<string, Call["done"]>;
  decided: Set<string>;
  /** call id → the background id its result gave (agentId, shell ID). */
  launched: Map<string, string>;
  /** background id → what that call was ("Design side nav"). */
  named: Map<string, string>;
  /** call id → its task-notification. */
  ended: Map<string, NonNullable<Call["end"]>>;
};
/**
 * The id a background launch's result gives: "agentId: a2a7…" or "running in background with ID: bbww…". A foreground
 * sub-agent's result also ends "agentId: … (for resuming …)" (t-0245: its card read "Working…" for good), so an agent
 * id counts only when the result says it was launched to the background.
 */
const launchId = (out?: string) =>
  out?.match(/running in background with ID: ([A-Za-z0-9_-]+)/)?.[1] ?? (/\b(async|background)\b/i.test(out ?? "") ? out?.match(/agentId: ([A-Za-z0-9_-]+)/)?.[1] : undefined);

/** One list of events (the main chat, or one sub-agent's) as items: runs of quiet tool calls collapse to one item. */
function itemize(events: Ev[], known: Known): Item[] {
  const { done, decided } = known;
  const items: Item[] = [];
  for (const [i, e] of events.entries()) {
    if (e.t === "user" && e.mid) items.push({ k: "steer", key: e.id ?? `s${i}`, text: e.text, from: e.from, name: e.name });
    else if (e.t === "user") items.push({ k: "divider", key: `d${i}`, text: "Interrupted" });
    // Thinking with nothing to show and under 2s is not worth a line (history's omitted thinking is mostly that).
    else if (e.t === "thinking" && (e.text.trim() || (e.ms ?? 0) >= 2000)) items.push({ k: "thought", key: e.id, text: e.text, ms: e.ms });
    else if (e.t === "thinking") continue;
    else if (e.t === "text" && /^No response requested\.?$/.test(e.text.trim())) continue; // harness noise (Orca drops it too)
    else if (e.t === "text") items.push({ k: "said", key: e.id, text: e.text });
    else if (e.t === 'question') items.push({ k:'note',key:e.request.id,text:e.request.questions.map(q => q.question).join(' · '),label:'Question',keep:true });
    else if (e.t === 'question_done') items.push({ k:'note',key:'done-'+e.id,text:e.reason === 'delivery-unconfirmed' ? 'Answer delivery unconfirmed · old question closed' : e.outcome === 'answered' ? 'Answer sent' : `Question ${e.outcome}`,label:'Question',keep:true });
    else if (e.t === "note") items.push({ k: "note", key: `n${i}`, text: e.text, label: e.label, bad: e.bad, at: e.at, keep: e.bad === true || e.label === undefined || e.label === "Error" || e.label === "Shell" || e.label === "Compacted" || e.label === "Compacting" || e.label === "Claude stopped" || e.label === "New session" });
    else if (e.t === "error") items.push({ k: "error", key: `e${i}`, kind: e.kind, text: e.text, at: e.at, resetsAt: e.resetsAt, window: e.window });
    else if (e.t === "approval" && !decided.has(e.id)) items.push({ k: "ask", key: e.id, id: e.id, tool: e.tool, summary: e.summary });
    else if (e.t === "tool") {
      const call: Call = { id: e.id, name: e.name, summary: e.summary, input: e.input, at: e.at, done: done.get(e.id) };
      const bg = known.launched.get(e.id);
      if (bg) Object.assign(call, { bg, end: known.ended.get(e.id) });
      const target = e.input?.target ?? e.input?.to;
      if (target && known.named.has(target)) call.about = known.named.get(target);
      const last = items.at(-1);
      if (isAgentTool(e.name)) items.push({ k: "agent", key: e.id, call });
      else if (ALONE.has(e.name) || OWN.has(e.name) || peerOut(call) || call.done?.ok === false) items.push({ k: "one", key: e.id, call });
      else if (last?.k === "run") last.calls.push(call);
      else items.push({ k: "run", key: e.id, calls: [call] });
    }
  }
  return items;
}

export type Queued = { id: string; text: string; fixed?: boolean };
export type Chat = { turns: Turn[]; children: Map<string, Item[]>; queued: Queued[] };
export type PreparedChat = { turns: Turn[]; final: Turn | null; children: Map<string, Item[]>; queued: Queued[] };

/** Event-derived chat state; live text is projected separately so repeated deltas do not reparse history. */
export function prepareChat(events: Ev[]): PreparedChat {
  const done = new Map<string, Call["done"]>();
  const decided = new Set<string>();
  const known: Known = { done, decided, launched: new Map(), named: new Map(), ended: new Map() };
  const what = new Map<string, string>();
  const taken = new Set<string>();
  const queuedEv: Queued[] = [];
  const main: Ev[] = [];
  const sub = new Map<string, Ev[]>();
  for (const e of events) {
    if (e.t === "tool") what.set(e.id, e.input?.description || e.summary);
    if (e.t === "tool_done") {
      done.set(e.id, { ok: e.ok, out: e.out, lines: e.lines, at: e.at });
      const bg = launchId(e.out);
      if (bg) (known.launched.set(e.id, bg), known.named.set(bg, what.get(e.id) ?? ""));
    }
    if (e.t === "user" && e.text.includes("<task-notification>")) {
      const n = noticeOf(e.text);
      if (n?.tool) known.ended.set(n.tool, { ok: !/fail|kill|stop|error/i.test(n.status), at: e.at, status: n.status || "completed" });
    }
    else if (e.t === "approval_done") decided.add(e.id);
    else if (e.t === "unqueued") taken.add(e.id);
    else if (e.t === "queued") queuedEv.push({ id: e.id, text: e.text, fixed: e.fixed });
    if (e.t === "user" && e.id) taken.add(e.id);
    // A queued line shows exactly once: when his words land as a message (a dequeue writes no id), the row goes.
    if (e.t === "user") for (const q of queuedEv) if (!taken.has(q.id) && norm(cleanUser(e.text)) === norm(q.text)) taken.add(q.id);
    const parent = "parent" in e ? e.parent : undefined;
    if (parent) {
      if (!sub.has(parent)) sub.set(parent, []);
      sub.get(parent)!.push(e);
    } else main.push(e);
  }

  // Split the main chat into turns at each of his messages.
  const groups: { me: Turn["me"]; evs: Ev[]; result: { ms: number; at: number } | null }[] = [{ me: null, evs: [], result: null }];
  for (const e of main) {
    if (e.t === "user") {
      const notice = noticeOf(e.text);
      const text = notice ? "" : cleanUser(e.text);
      // A Stop marker or a message taken mid-turn stays inside the running turn; only a fresh prompt starts one.
      if (!notice && (/^\[Request interrupted/.test(text) || e.mid)) groups.at(-1)!.evs.push({ ...e, text });
      else if (notice || text) groups.push({ me: { text, at: e.at, from: e.from, name: e.name, notice: notice ?? undefined, images: e.images }, evs: [], result: null });
    }
    else if (e.t === "result") groups.at(-1)!.result = { ms: e.ms, at: e.at };
    else groups.at(-1)!.evs.push(e);
  }
  if (!groups[0].evs.length) groups.shift();

  // A turn's key is its first moment, not its index: older turns arrive at the top as he scrolls up (lazy chats), and
  // an index key would remount every turn on screen each time.
  const seen = new Map<string, number>();
  const turnKey = (g: (typeof groups)[number]) => {
    const first = g.evs.find((e) => "at" in e && typeof e.at === "number") as { at?: number } | undefined;
    const base = `t${g.me?.at ?? first?.at ?? 0}`;
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    return n ? `${base}.${n}` : base;
  };
  const turns: Turn[] = groups.map((g) => {
    const items = itemize(g.evs, known);
    // His `!` command (bash mode): its output reads as the CLI prints it, "Ran git status · 3 lines", opening to the text.
    const bang = g.me?.text.match(/^! (.+)/)?.[1];
    if (bang) for (const [j, it] of items.entries()) if (it.k === "note" && it.label === "Shell") items[j] = { ...it, label: `Ran ${bang.length > 60 ? `${bang.slice(0, 59)}…` : bang} · ${plural(it.text.split("\n").length, "line")}` };
    // The answer is the run of words after the last thing Claude did (a live turn folds nothing, but its trailing
    // words already read as the answer).
    let cut = items.length;
    while (cut > 0 && items[cut - 1].k === "said") cut--;
    const times = g.evs.map((e) => ("at" in e && typeof e.at === "number" ? e.at : 0)).filter((t) => t > 0);
    const lastAt = Math.max(0, ...times, ...g.evs.flatMap((e) => (e.t === "tool" && done.get(e.id)?.at ? [done.get(e.id)!.at!] : [])));
    const ms = g.result?.ms ?? (g.me?.at && lastAt > g.me.at ? lastAt - g.me.at : null);
    return {
      key: turnKey(g),
      me: g.me,
      work: items.slice(0, cut),
      answer: items.slice(cut),
      done: true,
      ms,
      endedAt: g.result?.at ?? (lastAt || null),
    };
  });

  // Setup events before his first message make no turn of their own; retain the raw final group for live projection.
  const final = turns.pop() ?? null;
  const shown = turns.filter((t) => t.me || t.work.length || t.answer.length);
  const children = new Map<string, Item[]>();
  for (const [parent, evs] of sub) children.set(parent, itemize(evs, known));
  return { turns: shown, final, children, queued: queuedEv.filter((q) => !taken.has(q.id)) };
}

/** Project live thought/text onto the retained final turn. Earlier turns and event-derived maps are shared. */
export function projectChat(base: PreparedChat, partial: Record<string, string>, working: boolean, thinking: Record<string, string> = {}): Chat {
  if (!base.final) return { turns: base.turns, children: base.children, queued: base.queued };
  const all = [...base.final.work, ...base.final.answer];
  for (const [id, text] of Object.entries(thinking)) all.push({ k: "thought", key: id, text, ms: null, live: true });
  for (const [id, text] of Object.entries(partial)) if (text) all.push({ k: "said", key: id, text, live: true });
  let cut = all.length;
  while (cut > 0 && all[cut - 1].k === "said") cut--;
  const final = !base.final.me && all.length === 0 ? null : { ...base.final, work: all.slice(0, cut), answer: all.slice(cut), done: !working };
  return { turns: final ? [...base.turns, final] : base.turns, children: base.children, queued: base.queued };
}

/** Compatibility wrapper for callers that still provide the complete input tuple. */
export function buildChat(events: Ev[], partial: Record<string, string>, working: boolean, thinking: Record<string, string> = {}): Chat {
  return projectChat(prepareChat(events), partial, working, thinking);
}

// ---------------------------------------------------------------- words

/**
 * What kind of quiet call this is, for the run's one line. The CLI's rule (chat-study/claude-cli.md): a shell
 * command that only reads counts as a read, a search or a listing, not as "ran".
 */
function kindOf(c: Call): string {
  const n = c.name;
  if (n === "Read") return "read";
  if (n === "LS") return "list";
  if (n === "Grep" || n === "Glob") return "search";
  if (n === "WebFetch") return "fetch";
  if (n === "WebSearch") return "web";
  if (n === "Skill") return "skill";
  if (n === "TodoWrite") return "todo";
  if (n === "Bash") {
    const first = (c.input?.command ?? c.summary ?? "").trim().replace(/^cd [^&;]+(&&|;)\s*/, "").split(/\s+/)[0];
    if (/^(cat|head|tail|wc|stat|file)$/.test(first)) return "read";
    if (/^(grep|rg|find|fd|ag)$/.test(first)) return "search";
    if (/^(ls|tree)$/.test(first)) return "list";
    return "shell";
  }
  if (n === "BashOutput" || n === "KillShell") return "shell";
  return "tool";
}
/** The CLI's fixed order: searched → read → listed → … → other tools → ran shells. */
const ORDER = ["search", "read", "list", "fetch", "web", "skill", "tool", "shell"];
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const PHRASE: Record<string, [done: (n: number) => string, live: (n: number) => string]> = {
  search: [(n) => `searched for ${plural(n, "pattern")}`, (n) => `searching for ${plural(n, "pattern")}`],
  read: [(n) => `read ${plural(n, "file")}`, (n) => `reading ${plural(n, "file")}`],
  list: [(n) => `listed ${plural(n, "directory", "directories")}`, (n) => `listing ${plural(n, "directory", "directories")}`],
  fetch: [(n) => `fetched ${plural(n, "page")}`, (n) => `fetching ${plural(n, "page")}`],
  web: [(n) => `searched the web ${n === 1 ? "once" : `${n} times`}`, () => "searching the web"],
  skill: [(n) => `used ${plural(n, "skill")}`, (n) => `using ${plural(n, "skill")}`],
  tool: [(n) => `used ${plural(n, "tool")}`, (n) => `using ${plural(n, "tool")}`],
  shell: [(n) => `ran ${plural(n, "shell command")}`, (n) => `running ${plural(n, "shell command")}`],
};
/**
 * "Searched for 1 pattern, read 2 files, ran 1 shell command": counted by kind in the CLI's order (reads by distinct
 * file), present tense while running. To-do updates stay silent unless they are all the run did.
 */
export function runLabel(calls: Call[], live = false): string {
  const counts = new Map<string, Set<string>>();
  for (const c of calls) {
    const k = kindOf(c);
    if (k === "todo") continue;
    if (!counts.has(k)) counts.set(k, new Set());
    counts.get(k)!.add(k === "read" && c.name === "Read" ? (c.summary || c.id) : c.id);
  }
  if (!counts.size) return live ? "Updating the to-do list" : "Updated the to-do list";
  const s = ORDER.filter((k) => counts.has(k)).map((k) => PHRASE[k][live ? 1 : 0](counts.get(k)!.size)).join(", ");
  return s.charAt(0).toUpperCase() + s.slice(1);
}
/** What one running call is doing, for the live status line: "Running git status", "Reading chat.ts". */
export function doing(c: Call): string {
  const arg = (c.input?.description || c.input?.command || c.summary || "").replace(/\s+/g, " ");
  const file = arg.split("/").pop() ?? arg;
  const k = kindOf(c);
  if (isAgentTool(c.name)) return `Sub-agent: ${arg}`;
  const own = ownLine(c, true);
  if (own) return own;
  if (c.name === "Edit" || c.name === "Write") return `Editing ${file}`;
  if (k === "read") return `Reading ${file}`;
  if (k === "search" || k === "list") return `Searching ${arg}`;
  if (k === "shell") return c.input?.description || `Running ${c.input?.command ?? arg}`;
  if (k === "fetch") return `Fetching ${arg}`;
  if (k === "web") return `Searching the web for ${arg}`;
  return `${c.name} ${arg}`.trim();
}
/** The call still running in a turn, latest first. */
export function runningCall(items: Item[]): Call | undefined {
  for (let i = items.length - 1; i >= 0; i--) {
    const it = items[i];
    const calls = it.k === "run" ? it.calls : it.k === "one" || it.k === "agent" ? [it.call] : [];
    const c = [...calls].reverse().find((x) => x.done === undefined);
    if (c) return c;
  }
  return undefined;
}

export function fmtDuration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`;
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m ${s % 60}s`;
}
export const fmtClock = (at: number) => new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });

/** A tool call as the CLI's one line: Bash(git status), Read(src/a.ts); a wordless tool says what it did instead. */
export function callLine(c: Call): string {
  const own = ownLine(c);
  if (own) return own;
  const arg = c.input?.command ?? c.summary;
  return arg ? `${c.name}(${arg.replace(/\s+/g, " ")})` : c.name;
}

const quote = (s?: string, n = 60) => (s ? `“${s.length > n ? `${s.slice(0, n - 1)}…` : s}”` : "");
/**
 * What a wordless tool did, in the chat-edges spec's words (C10, E4, E5): "Sleeping until 21:40", "Watching the
 * build", "Stopped “Design side nav”", "Loaded WebSearch, WebFetch". `live`: present tense, for the status line.
 */
export function ownLine(c: Call, live = false): string | null {
  const i = c.input ?? {};
  const thing = c.about ? quote(c.about) : "";
  switch (c.name) {
    case "SendMessage":
      return `${live ? "Messaging" : "Messaged"} ${c.about ? `sub-agent ${quote(c.about)}` : (i.to ?? "an agent")}`;
    case "ScheduleWakeup": {
      if (i.wait === -1) return "Stopped its wake-up loop";
      const until = i.wait ? fmtClock(c.at + i.wait * 1000) : "";
      return `Sleeping${until ? ` until ${until}` : ""}${i.description ? ` · ${i.description}` : ""}`;
    }
    case "Monitor":
      return `Watching ${i.description ?? "a stream"}`;
    case "TaskStop":
      return `Stopped ${thing || "a background task"}`;
    case "TaskOutput":
      return `${live ? "Checking" : "Checked"} ${thing || "a background task"}`;
    case "TaskCreate":
      return `Added a task${i.description ? `: ${i.description}` : ""}`;
    case "TaskUpdate":
      return `Task ${i.target ?? ""}${i.description ? ` → ${i.description}` : " updated"}`.replace(/\s+/g, " ");
    case "TaskGet":
      return `Read task ${i.target ?? ""}`.trim();
    case "TaskList":
      return "Listed its tasks";
    case "ToolSearch": {
      const sel = i.description?.match(/^select:(.+)$/)?.[1];
      return sel ? `Loaded ${sel.split(",").map((x) => x.trim()).join(", ")}` : `Looked for tools${i.description ? `: ${i.description}` : ""}`;
    }
    case "ListAgents":
      return "Listed agents";
    case "CronCreate":
      return `Scheduled ${i.description ?? "a job"}`;
    case "CronDelete":
      return "Removed a schedule";
    case "CronList":
      return "Listed schedules";
    case "PushNotification":
      return `Sent a notification${i.description ? `: ${i.description}` : ""}`;
  }
  return null;
}

/**
 * A message this agent sent another (H3): SendMessage, or a shell `a0-tell [--queue] TARGET "…"` / `herdr-send TARGET "…"`.
 * `to` is the name, pane or sub-agent it went to.
 */
export function peerOut(c: Call): { to: string; text: string } | null {
  if (c.name === "SendMessage") return { to: c.about ? `sub-agent ${quote(c.about, 40)}` : (c.input?.to ?? "an agent"), text: c.input?.text ?? c.input?.description ?? "" };
  if (c.name !== "Bash") return null;
  const m = (c.input?.command ?? "").trim().match(/^(?:\S*\/)?(?:a0-tell|herdr-send)\s+(?:--\S+\s+)*([^\s"']+)\s+(["'])([\s\S]*)\2\s*$/);
  return m ? { to: m[1], text: m[3] } : null;
}

// ---------------------------------------------------------------- an edit as a diff

export type DiffLine = { t: " " | "-" | "+"; s: string };
/** A line diff of an edit's old and new text (longest common subsequence; both sides are capped by the host). */
export function lineDiff(oldText = "", newText = ""): DiffLine[] {
  const a = oldText ? oldText.split("\n") : [];
  const b = newText ? newText.split("\n") : [];
  if (a.length * b.length > 250_000) return [...a.map((s) => ({ t: "-" as const, s })), ...b.map((s) => ({ t: "+" as const, s }))];
  const L = Array.from({ length: a.length + 1 }, () => new Uint32Array(b.length + 1));
  for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--) L[i][j] = a[i] === b[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) (out.push({ t: " ", s: a[i] }), i++, j++);
    else if (L[i + 1][j] >= L[i][j + 1]) out.push({ t: "-", s: a[i++] });
    else out.push({ t: "+", s: b[j++] });
  }
  while (i < a.length) out.push({ t: "-", s: a[i++] });
  while (j < b.length) out.push({ t: "+", s: b[j++] });
  return out;
}

/** The background list as the CLI's pill says it: "1 shell, 1 monitor". */
export function bgLabel(list: Bg[]): string {
  const counts = new Map<string, number>();
  for (const b of list) {
    const k = /bash|shell/i.test(b.kind) ? "shell" : /monitor/i.test(b.kind) ? "monitor" : /agent/i.test(b.kind) ? "agent" : "task";
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  return [...counts].map(([k, n]) => plural(n, k)).join(", ");
}

/**
 * Another agent's message rather than his: Claude Code's peer messages (`from: "peer"`), or a line typed into the pane
 * as "NAME: …" (herdr-send's habit). He types in the app, so his own messages never come this way.
 */
/**
 * Claude Code delivers teammate and cross-session messages as a user turn wrapped in XML, followed by its own
 * "This came from another Claude session" note: `<teammate-message teammate_id="X" summary="S">body</teammate-message>`
 * or `<cross-session-message from="X">body</cross-session-message>`. Idle notices carry JSON whose `result` is the text.
 */
const WRAPPED = /<(teammate-message|cross-session-message)\b([^>]*)>([\s\S]*?)<\/\1>/g;
const attr = (attrs: string, key: string) => new RegExp(`\\b${key}="([^"]*)"`).exec(attrs)?.[1];
export function wrappedPeer(text: string): { name: string; text: string } | null {
  const blocks = [...text.matchAll(WRAPPED)];
  // Delivered while the session was idle, the entry starts "Another Claude session sent a message:" before the tag.
  const lead = text.trimStart().replace(/^(?:another claude session sent (?:a message|messages)|a message from another (?:claude )?session)\s*:?\s*/i, "");
  if (!blocks.length || lead.indexOf("<") !== 0) return null;
  const names = [...new Set(blocks.map(([, , attrs]) => attr(attrs, "teammate_id") ?? attr(attrs, "from") ?? "another agent"))];
  const name = names.join(", ");
  const parts = blocks.map(([, , attrs, raw]) => {
    let body = raw.trim();
    if (body.startsWith("{")) {
      try {
        const j = JSON.parse(body) as { type?: string; result?: string; idleReason?: string };
        body = j.result ?? (j.type === "idle_notification" ? `idle${j.idleReason ? ` (${j.idleReason})` : ""}` : body);
      } catch { /* not JSON: keep it */ }
    }
    const summary = attr(attrs, "summary");
    return summary && !body.startsWith(summary) ? `${summary}\n\n${body}` : body;
  });
  return { name, text: parts.join("\n\n") };
}

export function peerOf(me: NonNullable<Turn["me"]>): { name: string; text: string } | null {
  if (me.from === "peer") return { name: me.name ?? "another agent", text: wrappedPeer(me.text)?.text ?? me.text };
  const wrapped = wrappedPeer(me.text);
  if (wrapped) return wrapped;
  if (me.from !== "pane" && me.from !== "history") return null;
  const m = /^([A-Z][A-Z0-9_-]{1,40}):\s+([\s\S]+)$/.exec(me.text.trim());
  return m ? { name: m[1], text: m[2] } : null;
}

/** Count whitespace-delimited words in text pasted into the chat. */
export function wordCount(text: string): number {
  return text.trim() ? text.trim().split(/\s+/).length : 0;
}

/** Match the grouped counts used elsewhere in the chat HUD. */
export function formatWordCount(count: number): string {
  return new Intl.NumberFormat("en-US").format(count);
}

// ---------------------------------------------------------------- the live line, the CLI's way

/**
 * The CLI's live line (chat-study/claude-cli.md §3): `✻ Mulling… (40s · ↓ 2.2k tokens · thinking more)`. The words
 * are the to-do list's task in progress if there is one, else a verb from the CLI's kind of list, turning every few
 * seconds; elapsed shows after 16 s or once tokens flow; thinking escalates with time.
 */
const VERBS = ["Mulling", "Cogitating", "Pondering", "Brewing", "Churning", "Noodling", "Percolating", "Ruminating", "Simmering", "Musing", "Tinkering", "Conjuring", "Crunching", "Deliberating", "Puzzling", "Synthesizing", "Wrangling", "Marinating", "Untangling", "Forging"];
export function liveVerb(seed: string, elapsedMs: number): string {
  let h = 0;
  for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return VERBS[(h + Math.floor(elapsedMs / 8000)) % VERBS.length];
}
export function thinkingWord(ms: number): string {
  const s = ms / 1000;
  return s < 10 ? "thinking" : s < 20 ? "still thinking" : s < 30 ? "thinking more" : s < 45 ? "thinking some more" : "deep in thought";
}
/** The to-do list's task in progress in this turn, in its own present tense, if Claude keeps one. */
export function activeTask(items: Item[]): string | undefined {
  for (let i = items.length - 1; i >= 0; i--) {
    const it = items[i];
    const calls = it.k === "run" ? it.calls : it.k === "one" ? [it.call] : [];
    const todo = [...calls].reverse().find((c) => c.name === "TodoWrite");
    if (todo) return todo.input?.description;
  }
  return undefined;
}
export const fmtTokens = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : `${n}`);

/**
 * A message he sent from the box, shown at once (t-0105, "clicking send isn't actually clicking send"; t-0023 "queued
 * messages don't show up for like a second or two"). It stays until the chat itself shows it: his turn in the log, or
 * the host's own queued row. sending → the node has it; sent → typed into the pane (a terminal agent reads it at its
 * next step); failed → nothing was typed (Retry or take it back).
 */
export type Pending = { key: string; text: string; images: string[]; at: number; status: "sending" | "sent" | "failed" | "unknown"; note?: string };

const norm = (s: string) => s.replace(/\s+/g, " ").trim();
/** Unconfirmed sends stay visible. Age and similar words are not delivery evidence. */
export function settlePending(pending: Pending[], events: Ev[], _now = Date.now()): Pending[] {
  if (!pending.length) return pending;
  const settled = new Set<Pending>();
  for (const e of events) {
    if (e.t !== "queued" && (e.t !== "user" || !["app", "me", "pane", "history"].includes(e.from))) continue;
    const text = cleanUser(e.text);
    const matches = pending.filter((p) => {
      // Older history cannot acknowledge a later attempt, even a few milliseconds later.
      if (p.status === "failed" || p.status === 'unknown' || !Number.isFinite(e.at) || e.at < p.at) return false;
      if (e.t === "user" && e.images?.length) {
        // Terminal transcripts carry upload names plus numbered image markers, not pasted paths.
        if (e.images.length !== p.images.length || !e.images.every((im, i) => im === p.images[i] || im === p.images[i].split("/").pop())) return false;
        let body = text;
        for (let i = 0; i < e.images.length; i++) body = body.replace(`[Image #${i + 1}]`, "");
        return body.trim() === p.text.trim();
      }
      // Legacy hosts and terminal queues echo the complete text followed by every image path.
      const sent = [p.text.trim(), ...p.images].filter(Boolean).join("\n");
      return !!sent && text === sent;
    });
    // Repeated identical attempts have no reliable identity in legacy events. Keep them visible
    // until an event distinguishes one; replaying the same history must not eat another row.
    if (matches.length === 1) settled.add(matches[0]);
  }
  return settled.size ? pending.filter((p) => !settled.has(p)) : pending;
}
