import { AsleepLine, type SleepView } from './AsleepLine';
import { ChatOutline } from './ChatOutline';
import { ChatFind, ChatFindQuery, useFindOpen } from './ChatFind';
import { RecoveryStrip } from './RecoveryStrip';
import { initialRecovery, recover, type Boundary, type RecoveryEvent } from '../lib/chat-recovery';
import { outline } from '../lib/chat-outline';
import { callText, itemText, findDocuments, findMatches, textRanges } from '../lib/chat-find';
import './ChatNavigation.css';
import { useChatAttachments } from "../lib/chat-attachments";
import { readSeen, writeSeen } from "../lib/chat-seen";
import { conversationChatQuery, type ConversationPinTarget } from "../../../../services/node/src/conversation-route";
import { FlightLedger } from "../lib/delight";
import { DeliveryEvidence } from "./DeliveryEvidence";
import { CodexWorkerFlights } from "./CodexWorkerFlights";
import { QueuedPrompts } from './QueuedPrompts';
import { QuestionCard } from './QuestionCard';
import { QuestionRecoveryHistory } from './QuestionRecoveryHistory';
import { PromptLibrary } from './PromptLibrary';
import { buildAnswers, matchingQuestionRecovery, type QuestionDraft } from '../lib/questions';
import type { QueueSnapshot, DeliveryCapabilities } from '../../../../services/host/src/delivery';
import type { OwnerQuestionConnection, NativeQuestionMessage } from './OwnerSpaceModel';
import type { QuestionEvent, QuestionRequest, QuestionRecoverySnapshot } from '../../../../services/host/src/questions';
import { ArrowDownIcon, ArrowLeftIcon, ArrowUpIcon, PaperclipIcon, CheckIcon, ChevronRightIcon, CopyIcon, RotateCwIcon, SquareIcon, XIcon } from "lucide-react";
import { PAGE_DRAG } from "@siso/shell";
import { Icon } from "../lib/Icon";
import { AgentFace, faceFor } from "../lib/face";
import type { Agent } from "../lib/agents";
import type { IconName } from "../lib/Icon";
import { Fragment, createContext, isValidElement, memo, useCallback, useContext, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode, type Ref } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  type Bg,
  type Call,
  type Command,
  type Ev,
  type Pending,
  type Item,
  type State,
  type Task,
  type Turn,
  prepareChat,
  projectChat,
  buildChat,
  activeTask,
  doing,
  fmtTokens,
  liveVerb,
  runningCall,
  thinkingWord,
  fmtClock,
  fmtDuration,
  formatWordCount,
  lineDiff,
  peerOf,
  peerOut,
  promptKind,
  wordCount,
  quietLabel,
  quietRuns,
  staysOpen,
  type QuietEvent,
  runLabel,
  settlePending,
} from "../lib/chat";
import { clock, every, usePageVisible } from "../lib/poll";
import { WINDOW, minimapCurrent, minimapWidth, minimapWindow } from "../lib/minimap";
import { ArtifactShelf } from "./ArtifactShelf";
import { ContextStack, type ContextSource } from './ContextStack';
import { ChatActivityRail, type ChatActivityRailProps } from './ChatActivityRail';
import { RecordedSessionDisclosure } from './RecordedSessionReplay';
import { ChatResponseScene, ConfirmedCopy } from './ChatResponseScene';
import { callActivity, responseReceipt, resultReceipts, safeChatDestination, suppliedToolOutputs } from '../lib/chat-bank';
import { TurnDivider } from "./TurnDivider";
import { ChatRim } from "./Composer";
import { lastReadReply, publishLive } from "../lib/chatLive";
import { FanOutRow, agentGroup } from "./FanOut";
import { useSubagentMeta } from "./SubagentRow";
import { MicButton } from "./MicButton";
import { useSpeakReplies } from "../lib/speak";
import type { VoiceHow } from "../lib/voice";
import { clearPrefill, onPrefill, readPrefill } from "../lib/prefill";
import { setTurnStart } from "../lib/turn-clock";

// ---------------------------------------------------------------- pieces

function CodeBlock({ children }: { children?: ReactNode }) {
  const code = isValidElement<{ className?: string; children?: ReactNode }>(children) ? children : null;
  const lang = code?.props.className?.replace(/^language-/, "") ?? "";
  const text = String(code?.props.children ?? "").replace(/\n$/, "");
  return (
    <div className="siso-md__code">
      <div className="siso-md__codehead">
        <span>{lang || "text"}</span>
        <ConfirmedCopy text={text} label="Copy code" />
      </div>
      <pre>{children}</pre>
    </div>
  );
}
/** Markdown as a document: real headings, roomy lists, bordered tables; status symbol lines stay plain text, as in the CLI. */
/**
 * Every link in a chat opens on click (ab-152; 2 Oct 15:55: "when I click on URLs in the chat … they don't open up"):
 * in the desktop app as a page tab of its own browser, in the profile he last chose; in a plain browser, a new tab.
 */
/** The window event openLink raises in the desktop app; App opens a page tab for it. */
export const OPEN_PAGE = "agent-base:open-page";
export function openLink(raw: string) {
  const url = safeChatDestination(raw);
  if (!url) return;
  const w = window as unknown as Record<string, unknown>;
  // In the desktop app the link opens as Agent Base's own page tab (16:25, A0: "the browser first"); App takes the
  // event and cancels it. /api/open (his default browser) is only the fallback when nothing took it.
  if (w.__TAURI_INTERNALS__ && !window.dispatchEvent(new CustomEvent(OPEN_PAGE, { detail: { url }, cancelable: true }))) return;
  if (w.__TAURI_INTERNALS__ || w.__TAURI__) {
    void fetch("/api/open", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ url }) }).catch(() => {});
  } else window.open(url, "_blank", "noopener,noreferrer");
}
const Link = ({ href, children, ...p }: { href?: string; children?: ReactNode }) => (
  <a
    {...p}
    href={href ? safeChatDestination(href) ?? undefined : undefined}
    target="_blank"
    rel="noopener noreferrer"
    onClick={(e) => {
      e.preventDefault();
      if (href) openLink(href);
    }}
    // R1.22: a link drags like a tab: onto the top row (a tab there), beside the chat, onto an agent or the page strip.
    onDragStart={(e) => {
      const url = href ? safeChatDestination(href) : null;
      if (!url) { e.preventDefault(); return; }
      e.dataTransfer.setData(PAGE_DRAG, JSON.stringify({ url, title: e.currentTarget.textContent?.trim() || url }));
      e.dataTransfer.effectAllowed = "copy";
    }}
  >
    {children}
  </a>
);
const MD_PARTS = {
  a: ({ node: _n, ...p }: any) => <Link {...p} />,
  pre: ({ children }: any) => <CodeBlock>{children}</CodeBlock>,
};

/**
 * Claude's words, behind the CLI's "●". The answer (the words a turn ends on) is a document, Notion-like, full contrast
 * (Shaan, 2 Oct 13:21: "formatted output. Kind of like how Notion is. So it just … stands out"); the narration between
 * tool calls is a step: smaller, dimmer, behind a "●".
 */
export const Said = memo(function Said({ text, live, answer }: { text: string; live?: boolean; answer?: boolean }) {
  return (
    <div className={`siso-chat__said${answer ? " is-answer" : ""}${live ? " is-live" : ""}`}>
      {/* Every row hangs its mark in one gutter, as the CLI does: ❯ his words, ● Claude's, ✻ thinking and folds, ⎿ the running step. */}
      <span className="siso-chat__bullet" aria-hidden>
        ●
      </span>
      <div className={`siso-md${answer ? " siso-md--doc" : ""}`}>
        <ReactMarkdown remarkPlugins={[remarkGfm]} components={MD_PARTS}>
          {text}
        </ReactMarkdown>
      </div>
    </div>
  );
});

/** "Thought for 4s ›", opening to the thinking (italic, dim); no chevron when the model kept it to itself. */
export function Thought({ text, ms, live }: { text: string; ms: number | null; live?: boolean }) {
  const [open, setOpen] = useState(false);
  const found = useFindOpen(text);
  // Seen while live, it stays open when it ends: collapsing mid-turn would jump the page (the turn's fold tidies it).
  const seenLive = useRef(false);
  if (live) seenLive.current = true;
  useEffect(() => {
    if (!live && seenLive.current) setOpen(true);
  }, [live]);
  const has = !!text.trim();
  const label = live ? "Thinking…" : ms ? `Thought for ${fmtDuration(ms)}` : "Thought";
  return <ChatActivityRail kind="thinking" status={live ? 'running' : 'idle'} summary={label}
    details={has ? text : undefined} expanded={open || !!live || found} onExpandedChange={setOpen} />;
}

/** A message taken while Claude worked, shown where Claude read it: his as a quiet ❯ line, a peer's as "from X". */
function Steer({ text, from, name }: { text: string; from?: string; name?: string }) {
  const peer = peerOf({ text, at: 0, from, name });
  if (peer) return <PeerRow name={peer.name} text={peer.text} />;
  return (
    <div className="siso-chat__steer is-me">
      <img className="siso-chat__steerface" src="/siso-mark.png" alt="" aria-hidden />
      <span>
        <UserText text={text} />
      </span>
    </div>
  );
}

/** His message, quoted with "❯"; a long one folds to its first lines and "… +N lines". */
/**
 * His words as written, minus the harness's wrappers (2 Oct 14:00: pasted text showed its raw tags): pasted text is a
 * quiet chip "Pasted text · 14 lines ›" that opens to it; "[Image #2]" a small chip; an uploaded image a thumbnail.
 */
// Claude Code writes the id on the closing tag too (</pasted_content id="2972">).
const PIECE = /<pasted_content[^>]*>([\s\S]*?)<\/pasted_content[^>]*>|\[Image #(\d+)\]|(?:~|\/Users\/[^/\s]+)\/\.local\/state\/agent-base\/uploads\/([A-Za-z0-9._-]+\.(?:png|jpe?g|gif|webp))/g;
function UserText({ text }: { text: string }) {
  const out: ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(PIECE)) {
    if (m.index! > last) out.push(text.slice(last, m.index));
    if (m[1] !== undefined) out.push(<Pasted key={m.index} text={m[1].replace(/^\n+|\n+$/g, "")} />);
    else if (m[2]) out.push(<span key={m.index} className="siso-chat__chip">Image {m[2]}</span>);
    else if (m[3]) out.push(<img key={m.index} className="siso-chat__thumb" src={`/api/uploads/${m[3]}`} alt="An image he sent" />);
    last = m.index! + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  // Bare URLs in his words become links too.
  return (
    <>
      {out.map((piece, n) =>
        typeof piece === "string"
          ? piece.split(/(https?:\/\/[^\s<>()"']+[^\s<>()"'.,;:!?])/g).map((t, i) => (i % 2 ? <Link key={`${n}-${i}`} href={t}>{t}</Link> : t))
          : piece,
      )}
    </>
  );
}
function Pasted({ text }: { text: string }) {
  const [opened, setOpen] = useState(false);
  const found = useFindOpen(text), open = opened || found;
  const n = text.split("\n").length;
  const words = formatWordCount(wordCount(text));
  return (
    <span className="siso-chat__pasted">
      <button type="button" className="siso-chat__chip" aria-expanded={open} onClick={() => setOpen(!open)}>
        Pasted text · {n} {n === 1 ? "line" : "lines"} · {words} {wordCount(text) === 1 ? "word" : "words"} <ChevronRightIcon size={11} className="siso-chat__chev" />
      </button>
      {open && <span className="siso-chat__pastedtext">{text}</span>}
    </span>
  );
}

/** Other agents by upper-cased name: their mark and project, for peer messages. */
export type People = Record<string, { name: string; icon: IconName | null; project: string; status?: Agent["status"] }>;
const PeopleCtx = createContext<People>({});
/** A stable colour per project (every agent of a project shares it), as a hue. */
const hueOf = (s: string) => {
  let h = 0;
  for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h % 360;
};
/**
 * Another agent's message as one row (2 Oct 14:10: "maybe with a color, maybe with their icon, maybe with a short
 * one-liner. and you can click drop down to see the whole info"): its mark and name in its project's colour, its first
 * sentence, and › to open the whole message.
 */
function PeerRow({ name, text, out }: { name: string; text: string; out?: boolean }) {
  const [open, setOpen] = useState(false);
  const who = useContext(PeopleCtx)[name.toUpperCase()];
  // A pane id nobody answers to any more (w7:p3) is never shown: it is "another agent".
  const shown = who?.name ?? (/^w\d+:p\d+$/i.test(name) ? "another agent" : name);
  const hue = hueOf(who?.project ?? shown);
  const flat = text.replace(/\s+/g, " ").trim();
  const first = (flat.match(/^.{1,90}?[.!?](\s|$)/)?.[0] ?? flat.slice(0, 90)).trim();
  const more = first.length < flat.length;
  const lead = more ? first.replace(/[.!?,;:]+$/, "") : first;
  return (
    <div className={`siso-chat__peer${out ? " is-out" : ""}`} data-testid="peer-row" style={{ ["--peer" as string]: `hsl(${hue} 70% 68%)` }}>
      <button type="button" className="siso-chat__peerrow" aria-expanded={open} onClick={() => more && setOpen(!open)}>
        {/* R1.20c (H1/H3): ← a message in, → one this agent sent. */}
        <span className="siso-chat__peerdir" title={out ? "Sent by this agent" : "From another agent"}>{out ? "→" : "←"}</span>
        {/* R1.20c (HUB-DESIGN): every peer wears its AgentFace, as in the side nav. */}
        <AgentFace {...faceFor({ name: shown, project: who?.project ?? null, status: who?.status ?? "idle" })} size={16} className="siso-chat__peerface" />
        <b>{shown}</b>
        <span className="siso-chat__peerline">{open ? first : lead}{more && !open ? "…" : ""}</span>
        {more && <ChevronRightIcon size={13} className="siso-chat__chev" />}
      </button>
      {open && (
        <div className="siso-chat__peerfull">
          <UserText text={text} />
        </div>
      )}
    </div>
  );
}

/** One quiet line with ›, opening to its text: checkpoints, summaries, start prompts, command output. */
function Quiet({ label, text, mono, bad }: { label: string; text: string; mono?: boolean; bad?: boolean }) {
  const [opened, setOpen] = useState(false);
  const found = useFindOpen(text), open = opened || found;
  const first = text.replace(/\s+/g, " ").trim().slice(0, 110);
  return (
    <div className={`siso-chat__quiet${bad ? " is-bad" : ""}`} data-testid={label === 'New session' ? 'new-session-boundary' : undefined}>
      <button type="button" aria-expanded={open} onClick={() => setOpen(!open)}>
        <b>{label}</b>
        {!open && first && <span>{first}</span>}
        <ChevronRightIcon size={13} className="siso-chat__chev" />
      </button>
      {open && <div className={`siso-chat__quiettext${mono ? " is-mono" : ""}`}>{text}</div>}
    </div>
  );
}

/** R1.20c (A2): his words fold only past this many lines; pasted text already folds to its own chip. */
const ME_FOLD = 40;
function Me({ me, onOpen }: { me: NonNullable<Turn["me"]>; onOpen: (id: string) => void }) {
  const [expanded, setAll] = useState(false);
  const found = useFindOpen(me.text), all = expanded || found;
  if (me.notice) {
    // A background task's end: one quiet line that opens its sub-agent, never the XML it came in.
    const n = me.notice;
    const bad = /fail|stop|kill/.test(n.status);
    return (
      <button type="button" className="siso-chat__notice" disabled={!n.tool} onClick={() => n.tool && onOpen(n.tool)}>
        <span className={`siso-chat__dot ${bad ? "is-bad" : "is-ok"}`} />
        <span>
          {n.title}
          {n.ms ? ` · ${fmtDuration(n.ms)}` : ""}
        </span>
        {n.tool && <ChevronRightIcon size={13} className="siso-chat__chev" />}
      </button>
    );
  }
  const peer = peerOf(me);
  if (peer) return <PeerRow name={peer.name} text={peer.text} />;
  const kind = promptKind(me.text);
  if (kind) return <Quiet label={kind} text={me.text.replace(/^\/compact\s*/, "")} />;
  // R1.20b/c: his words are never cut (Shaan 20:45, 21:30 "text gets cut out"): a one-line memo of any length shows
  // whole. Only past 40 lines does it fade under "show all N lines", and that opens in place.
  const text = me.text;
  const lines = text.replace(/<pasted_content[^>]*>[\s\S]*?<\/pasted_content[^>]*>/g, "").split("\n").length;
  const fold = lines > ME_FOLD;
  return (
    <div className="siso-chat__me" data-find-source="user">
      {/* His own words carry the SISO mark as his profile icon (2 Oct 18:22), not the CLI's arrow. */}
      <img className="siso-chat__mark" src="/siso-mark.png" alt="" aria-hidden />
      <div>
        <div className={`siso-chat__metext${fold && !all ? " is-fold" : ""}`}>
          <UserText text={text} />
        </div>
        {fold && (
          <button type="button" className="siso-chat__showall" aria-expanded={all} onClick={() => setAll(!all)}>
            {all ? "Show less" : `Show all ${lines} lines`}
          </button>
        )}
        {me.images?.map((n) => <img key={n} className="siso-chat__thumb" src={`/api/uploads/${n}`} alt="An image he sent" />)}
      </div>
    </div>
  );
}

/** A tool's result head under "⎿", and "… +N lines" for the rest. */
function Out({ call }: { call: Call }) {
  const [opened, setOpen] = useState(false);
  const found = useFindOpen(callText(call)), open = opened || found;
  const d = call.done;
  if (!d?.out) return null;
  // The CLI's head: 3 lines, then "… +N lines" (never "+1 line": four lines show whole). Click shows what we have.
  const all = d.out.split("\n");
  const total = Math.max(d.lines ?? all.length, all.length);
  const cut = !open && total > 4;
  const rest = total - (cut ? 3 : all.length);
  return (
    <div className={`siso-chat__out${d.ok ? "" : " is-bad"}`}>
      <span aria-hidden>⎿</span>
      <pre onClick={() => setOpen(!open)}>
        {cut ? all.slice(0, 3).join("\n") : d.out}
        {rest > 0 ? `\n… +${rest} lines` : ""}
      </pre>
    </div>
  );
}

const dotOf = (c: Call) => (c.done === undefined ? "is-run" : c.done.ok ? "is-ok" : "is-bad");

/** One tool call in full: Bash(git status) and its output head. */
function ActivityRecord(props: ChatActivityRailProps) {
  const [expanded, setExpanded] = useState(false);
  const found = useFindOpen([props.summary, props.command, props.output, props.details].filter(Boolean).join('\n'));
  return <ChatActivityRail {...props} expanded={expanded || found} onExpandedChange={setExpanded} />;
}
export function CallRow({ call, now }: { call: Call; now?: number }) {
  const elapsed = call.done === undefined && now && call.at ? now - call.at : 0;
  return <ActivityRecord {...callActivity(call)} duration={elapsed >= 1000 ? fmtDuration(elapsed) : undefined} />;
}
export function Step({ call, now }: { call: Call; now: number }) {
  return <CallRow call={call} now={now} />;
}

/** A run of quiet calls as one dim line ("Read 2 files, ran 1 shell command"), opened on click. While live, the
 * current call shows under it. */
function Run({ calls, live, now }: { calls: Call[]; live: boolean; now: number }) {
  const [opened, setOpen] = useState(false);
  const found = useFindOpen(calls.map(callText).join('\n')), open = opened || found;
  const running = calls.some((c) => c.done === undefined);
  // While the run is the live one its ⎿ line stays put: the call running, else the last one (no jump when one ends).
  const current = live ? ([...calls].reverse().find((c) => c.done === undefined) ?? calls.at(-1)) : undefined;
  return (
    <div className="siso-chat__run">
      <button type="button" className="siso-chat__runhead" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span className={`siso-chat__dot ${running ? "is-run" : calls.some((c) => c.done?.ok === false) ? "is-bad" : "is-ok"}`} />
        <span className="siso-chat__runlabel">
          {runLabel(calls, running)
            .split(/(\d+)/)
            .map((p, i) => (i % 2 ? <b key={i}>{p}</b> : p))}
          {running ? "…" : ""}
        </span>
        <ChevronRightIcon size={13} className="siso-chat__chev" />
      </button>
      {open ? (
        <div className="siso-chat__runbody">
          {calls.map((c) => (
            <CallRow key={c.id} call={c} now={now} />
          ))}
        </div>
      ) : (
        current && <Step call={current} now={now} />
      )}
    </div>
  );
}

/** An edit on its own, as a red/green diff with "+a −r"; a failed call with its error. */
function One({ call, now }: { call: Call; now?: number }) {
  const i = call.input;
  if (i && (i.old !== undefined || i.new !== undefined) && call.name !== "Bash") {
    const diff = lineDiff(i.old ?? "", i.new ?? "");
    const add = diff.filter((d) => d.t === "+").length;
    const del = diff.filter((d) => d.t === "-").length;
    const file = (i.path ?? call.summary).split("/").slice(-2).join("/");
    return (
      <div className="siso-chat__edit">
        <div className="siso-chat__callhead" title={i.path}>
          <span className={`siso-chat__dot ${dotOf(call)}`} />
          <span className="siso-chat__calltext">
            {i.created ? "Wrote" : "Edited"} <b>{file}</b>
          </span>
          <span className="siso-chat__counts">
            <i className="is-add">+{add}</i> <i className="is-del">−{del}</i>
          </span>
        </div>
        <div className="siso-chat__diff" role="table" aria-label={`Changes to ${file}`}>
          {diff.slice(0, 80).map((d, n) => (
            <div key={n} className={d.t === "+" ? "is-add" : d.t === "-" ? "is-del" : undefined}>
              <span aria-hidden>{d.t}</span>
              {d.s || " "}
            </div>
          ))}
          {diff.length > 80 && <div className="siso-chat__more">… +{diff.length - 80} lines</div>}
        </div>
        {call.done?.ok === false && <Out call={call} />}
      </div>
    );
  }
  return <CallRow call={call} now={now} />;
}


/** R1.20c (F4/F5): a usage limit or an API error as its own card, never as the agent's words. */
const WINDOW_WORD: Record<string, string> = { five_hour: "Session limit", seven_day: "Weekly limit", seven_day_opus: "Weekly Opus limit", seven_day_sonnet: "Weekly Sonnet limit" };
/** "2h 14m", "14m", "40s": a countdown without the seconds' noise once it is past a minute. */
const left = (ms: number) => {
  const m = Math.ceil(ms / 60_000);
  return ms < 60_000 ? `${Math.ceil(ms / 1000)}s` : m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${m % 60}m`;
};
function ErrorCard({ kind, text, resetsAt, window: win, onContinue }: { kind: "limit" | "api"; text: string; resetsAt?: number; window?: string; onContinue: () => void }) {
  const now = Date.now();
  const waiting = kind === "limit" && !!resetsAt && resetsAt > now;
  return (
    <div className={`siso-chat__errcard is-${kind}`} role="alert" data-testid="chat-error" data-kind={kind}>
      <span className="siso-chat__dot is-bad" />
      <div className="siso-chat__errmain">
        {/* One reset time (HUB-DESIGN 22:02): the limit's own, in his 24-hour clock, with the countdown; Claude's
            "resets 1:50pm (Asia/Saigon)" is only the fallback when the record has no reset time. */}
        <b>
          {kind === "api"
            ? `API error · ${text.replace(/^API Error:\s*/i, "")}`
            : resetsAt
              ? [WINDOW_WORD[win ?? ""] ?? "Usage limit", `resets ${fmtClock(resetsAt)}`, waiting ? `in ${left(resetsAt - now)}` : "reset now"].join(" · ")
              : text}
        </b>
        {kind === "limit" && <span>{waiting ? "Continue shows here at the reset." : "Continue picks up where it stopped."}</span>}
        {kind === "api" && <span>The turn stopped here; nothing was lost.</span>}
      </div>
      {!waiting && (
        <button type="button" onClick={onContinue}>
          Continue
        </button>
      )}
    </div>
  );
}

/** A turn shows a live clock only while one of its calls or sub-agents still runs. */
function ticking(turn: Turn, taskByTool: Map<string, Task>): boolean {
  return turn.work.some((it) =>
    it.k === "run" ? it.calls.some((c) => c.done === undefined) : (it.k === "one" || it.k === "agent") && (it.call.done === undefined || (!!it.call.bg && !it.call.end) || taskByTool.get(it.call.id)?.endedAt === undefined && taskByTool.has(it.call.id)),
  );
}

type Ctx = { lifecycle?: FlightLedger; children: Map<string, Item[]>; taskByTool: Map<string, Task>; now: number; onOpen: (id: string) => void; send: (m: unknown) => void };

function Items({ items, live, ctx, answer }: { items: Item[]; live: boolean; ctx: Ctx; answer?: boolean }) {
  const lastRun = items.reduce((at, it, n) => (it.k === "run" ? n : at), -1);
  // Track the last Compacting note's timestamp for use in subsequent Compacted/failed notes
  const lastCompactingAt = items.reduce((at, it) => (it.k === "note" && it.label === 'Compacting' && it.at ? it.at : at), null as number | null);

  const P50_MS = 78000;
  const P90_MS = 136000;

  return (
    <>
      {items.map((it, n) => <div key={it.key} data-find-source={it.key}>{(() => {
        if (it.k === "said") return <Said key={it.key} text={it.text} live={it.live} answer={answer} />;
        if (it.k === "thought") return <Thought key={it.key} text={it.text} ms={it.ms} live={it.live} />;
        if (it.k === "steer") return <Steer key={it.key} text={it.text} from={it.from} name={it.name} />;
        // The turn's last run keeps its ⎿ step while the turn is live, even once words follow it (no shrink mid-turn).
        if (it.k === "run") return <Run key={it.key} calls={it.calls} live={live && n === lastRun} now={ctx.now} />;
        if (it.k === "one") {
          const to = peerOut(it.call);
          return to ? <PeerRow key={it.key} name={to.to} text={to.text} out /> : <One key={it.key} call={it.call} now={ctx.now} />;
        }
        if (it.k === "error") return <ErrorCard key={it.key} kind={it.kind} text={it.text} resetsAt={it.resetsAt} window={it.window} onContinue={() => ctx.send({ t: "prompt", text: "continue" })} />;
        if (it.k === "agent") {
          const task = ctx.taskByTool.get(it.call.id);
          // The SDK host stops a task by its id; a terminal agent is asked, in its pane, to TaskStop its background id.
          const stopId = task?.id ?? it.call.bg;
          return (
            <Fragment key={it.key}>
            <ActivityRecord {...callActivity(it.call, task, true)} onInspectWorker={() => ctx.onOpen(it.call.id)} />
            <FanOutRow
              lifecycle={ctx.lifecycle}
              call={it.call}
              task={task}
              steps={ctx.children.get(it.call.id)?.length ?? 0}
              now={ctx.now}
              onOpen={() => ctx.onOpen(it.call.id)}
              onStop={stopId ? () => ctx.send({ t: "stop_task", id: stopId, name: it.call.summary }) : undefined}
              group={agentGroup(items, n)}
              taskOf={(id) => ctx.taskByTool.get(id)}
            />
            </Fragment>
          );
        }
        if (it.k === "divider")
          return (
            <div key={it.key} className="siso-chat__divider">
              {it.text}
            </div>
          );
        // A command's printed output (/compact, /context…): one quiet line, its first line, › for the rest.
        if (it.k === "note" && (it.label === 'Compacted' || it.label === 'Compacting')) {
          const startedAt = it.label === 'Compacting' ? it.at : (lastCompactingAt ?? undefined);
          return <ActivityRecord key={it.key} kind="compacting" status={it.bad ? 'failed' : it.label === 'Compacting' ? 'running' : 'succeeded'} summary={it.label} output={it.text} startedAt={startedAt} typicalMs={P50_MS} longMs={P90_MS} />;
        }
        if (it.k === "note") return <Quiet key={it.key} label={it.label ?? "Output"} bad={it.bad} text={it.text.replace(/\x1b\[[0-9;]*m/g, "")} mono />;
        return (
          <div key={it.key} className="siso-chat__ask">
            <span>
              Allow <b>{it.tool}</b>: {it.summary}
            </span>
            <button type="button" onClick={() => ctx.send({ t: "approve", id: it.id, allow: true })}>
              <CheckIcon size={14} /> Allow
            </button>
            <button type="button" onClick={() => ctx.send({ t: "approve", id: it.id, allow: false })}>
              <XIcon size={14} /> Deny
            </button>
          </div>
        );
      })()}</div>)}
    </>
  );
}

/** One turn: his message, the work (folded to "Worked for …" once done), then the answer. */
const TurnView = memo(function TurnView({ turn, ctx, live, index, ownerName, receipts, boundary }: { turn: Turn; ctx: Ctx; live: boolean; isLast: boolean; index: number; ownerName: string; receipts: ReadonlySet<number>; onInspectOutput: (id: string) => void; boundary?: Boundary | null }) {
  const [opened, setOpen] = useState(false);
  const found = useFindOpen(turn.work.map(itemText).join('\n')), open = opened || found;
  const reply = useRef<HTMLDivElement>(null);
  const responseItems = useMemo(() => {
    if (turn.answer.length || !turn.work.some(it => it.k === 'error')) return turn.answer;
    const partial = [...turn.work].reverse().find(it => it.k === 'said');
    return partial ? [partial] : [];
  }, [turn.answer, turn.work]);
  const displayWork = turn.work.filter(it => !responseItems.includes(it));
  const replyText = useMemo(() => responseItems.flatMap(it => it.k === 'said' ? [it.text] : []).join('\n\n'), [responseItems]);
  const [copied, setCopied] = useState<'idle' | 'copied' | 'failed'>('idle');
  useEffect(() => setCopied('idle'), [replyText]);
  const receipt = boundary ? { status: 'unconfirmed' as const } : responseReceipt(turn, receipts, live);
  const selectReply = () => {
    if (!reply.current) return;
    // Selecting a checkpoint includes its full text, not just the collapsed titles.
    reply.current.querySelectorAll('details').forEach(details => { details.open = true; });
    const range = document.createRange();
    range.selectNodeContents(reply.current);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  };
  const copyReply = async () => {
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
      await navigator.clipboard.writeText(replyText);
      setCopied('copied');
    } catch {
      selectReply();
      setCopied('failed');
    }
  };
  // A turn folds the moment it finishes, as Codex's does (2 Oct 14:15, overriding "stay open"), but the fold animates
  // (~200 ms) instead of vanishing, and the answer below keeps its place on screen.
  const wasLive = useRef(false);
  const [closing, setClosing] = useState(false);
  const closeRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (live) wasLive.current = true;
    else if (wasLive.current) {
      wasLive.current = false;
      setClosing(true);
    }
  }, [live]);
  useLayoutEffect(() => {
    const el = closeRef.current;
    if (!closing || !el) return;
    el.style.height = `${el.scrollHeight}px`;
    void el.offsetHeight; // the start height takes effect before the transition
    el.style.transition = "height 200ms ease, opacity 200ms ease";
    el.style.height = "0px";
    el.style.opacity = "0";
    // At the bottom (watching the live turn) the list's bottom stays pinned, so the answer keeps its place.
    const t = window.setTimeout(() => setClosing(false), 230);
    return () => window.clearTimeout(t);
  }, [closing]);
  const steps = turn.work.reduce((n, it) => n + (it.k === "run" ? it.calls.length : it.k === "said" ? 0 : 1), 0);
  // Only tool calls fold; his mid-turn messages and the agent's prose stay in sight (nothing he reads vanishes).
  // Full hosted children remain addressable while their parent turn finishes; reuse the existing compact rows.
  const childRow = (it: Item) => it.k === "agent" && !!ctx.taskByTool.get(it.call.id)?.hostName;
  const tools = displayWork.filter((it) => !staysOpen(it) && !childRow(it));
  const kept = displayWork.filter(it => staysOpen(it) || childRow(it));
  // ab-119's checkpoint rows are retired from replies (Shaan, 6 Oct 21:30: "I don't know all these drop-down bullshits.
  // It's just illegible"): a reply's lists render as plain markdown, every line whole. CheckpointBlock stays in the bank.
  return (
    <section className="siso-chat__turn" data-turn={index} data-turn-key={turn.key} tabIndex={-1}>
      {index > 0 && turn.me?.at ? <TurnDivider time={fmtClock(turn.me.at)} /> : null}
      {turn.me && <Me me={turn.me} onOpen={ctx.onOpen} />}
      {turn.done && tools.length > 0 ? (
        <div className="siso-chat__fold">
          {/* Codex's finished turn: "Worked for 4m 46s ›", a thin rule, then the answer. The time it ended is on hover. */}
          <button type="button" className="siso-chat__foldhead" aria-expanded={open} title={turn.endedAt ? `Done ${fmtClock(turn.endedAt)}` : undefined} onClick={() => setOpen(!open)}>
            <span>{turn.ms ? `Worked for ${fmtDuration(turn.ms)}` : `Worked · ${steps} ${steps === 1 ? "step" : "steps"}`}</span>
            <ChevronRightIcon size={13} className="siso-chat__chev" />
          </button>
          {open ? (
            <div className="siso-chat__foldbody">
              <Items items={displayWork} live={false} ctx={ctx} />
            </div>
          ) : (
            <>
              {closing ? (
                <div ref={closeRef} className="siso-chat__foldbody is-closing">
                  <Items items={tools} live={false} ctx={ctx} />
                </div>
              ) : null}
              {/* His (and peers') messages taken mid-turn and the agent's prose stay in sight when the tools fold. */}
              <Items items={kept} live={false} ctx={ctx} />
            </>
          )}
          {/* The rule parts the work from the answer; with no answer the turn divider below is the only line (R1.20 review). */}
          {responseItems.length > 0 && <hr className="siso-chat__rule" />}
        </div>
      ) : (
        <Items items={displayWork} live={live} ctx={ctx} />
      )}
      {responseItems.length > 0 && <div className="siso-chat__reply" ref={reply}>
        {/* The Review document card stays (Shaan, 6 Oct 21:25: "i like how it comes in a review document"); inside it the
            reply is standard Claude markdown as before tonight's deploy: headings, bold, lists, links, no folded rows.
            It is the turn's last words; it renders exactly as the prose above it, no document type of its own (7 Oct 01:52:
            "I don't mind that being in the box, but you've like made it look weird by the formatting"). */}
        <ChatResponseScene prompt={turn.me?.text ?? ''} owner={{ name: ownerName }} answer={replyText}
          {...receipt} hidePrompt showActions={false} variant="compact" className="cr-chat" revision={turn.key}
          answerContent={<Items items={responseItems} live={live} ctx={ctx} />} />
      </div>}
      {boundary && <p className="chat-received" data-testid="received-marker">Received up to here · {new Date(boundary.at).toLocaleTimeString()} · reply incomplete</p>}
      {turn.done && !boundary && replyText.trim() && <div className="siso-chat__reply-actions" aria-label="Reply actions">
        <button type="button" aria-label="Copy reply" onClick={() => void copyReply()}>
          {copied === 'copied' ? <CheckIcon size={13} /> : <CopyIcon size={13} />}
          {copied === 'copied' ? 'Copied' : 'Copy'}
        </button>
        <button type="button" onClick={selectReply}>Select text</button>
        {copied === 'failed' && <span role="status">Text selected · press ⌘C or Ctrl+C to copy</span>}
        {/* "Inspect outputs" left the reply (Shaan, 6 Oct 21:10: "I don't like the inspect outputs"); the links row above the input keeps them. */}
      </div>}
    </section>
  );
});

/**
 * Screen 14: a run of background events (Monitor pings, task and sub-agent ends, the work each set off) as one muted
 * line, "5 background events · Monitor ×3, task done ×2 · 17:12–17:18". Folded on every load; it opens to one row per
 * event (time, kind, line), and a row with work opens to that work.
 */
const QuietRun = memo(function QuietRun({ events, ctx, index }: { events: QuietEvent[]; ctx: Ctx; index: number }) {
  const [open, setOpen] = useState(false);
  return (
    <section className="siso-chat__turn is-quiet" data-turn={index} data-testid="quiet-run">
      <button type="button" className="siso-chat__qhead" aria-expanded={open} onClick={() => setOpen(!open)}>
        <Icon name="activity" size={13} />
        <span>{quietLabel(events)}</span>
        <ChevronRightIcon size={13} className="siso-chat__chev" />
      </button>
      {open && (
        <div className="siso-chat__qlist">
          {events.map((ev) => (
            <QuietRow key={ev.key} ev={ev} ctx={ctx} />
          ))}
        </div>
      )}
    </section>
  );
});
function QuietRow({ ev, ctx }: { ev: QuietEvent; ctx: Ctx }) {
  const [open, setOpen] = useState(false);
  const agent = ev.tool && ev.kind.startsWith("sub-agent") ? ev.tool : null;
  return (
    <div className="siso-chat__qrow" data-testid="quiet-event">
      <div className="siso-chat__qline">
        <button type="button" aria-expanded={ev.work.length ? open : undefined} disabled={!ev.work.length} onClick={() => setOpen(!open)}>
          <time>{fmtClock(ev.at)}</time>
          <b className={ev.bad ? "is-bad" : undefined}>{ev.kind}</b>
          <span>{ev.line}</span>
          {ev.ms ? <i>worked {fmtDuration(ev.ms)}</i> : null}
        </button>
        {agent && (
          <button type="button" className="siso-chat__qopen" onClick={() => ctx.onOpen(agent)} aria-label="Open the sub-agent">
            <ChevronRightIcon size={13} />
          </button>
        )}
      </div>
      {open && (
        <div className="siso-chat__runbody">
          <Items items={ev.work} live={false} ctx={ctx} />
        </div>
      )}
    </div>
  );
}

type ChatMinimapHandle = { showTurn: (turn: number | null) => void };

/** Scroll/hover feedback updates this small rail, without reconciling the composer and transcript. */
const ChatMinimap = memo(function ChatMinimap({ turns, marks, jumpTo, ref }: { turns: Turn[]; marks: number[]; jumpTo: (turn: number) => void; ref: Ref<ChatMinimapHandle> }) {
  const [turnOnScreen, setCurrentTurn] = useState<number | null>(null);
  const [hoverBar, setHoverBar] = useState<number | null>(null);
  useImperativeHandle(ref, () => ({ showTurn: setCurrentTurn }), []);
  // Keep the measured position even before the third message makes the rail visible.
  if (marks.length < 3) return null;
  // At most 31 bars: the marks around where he is, his in the middle slot, fading toward both ends.
  const onTurn = turnOnScreen ?? turns.length - 1;
  let cur = 0;
  marks.forEach((t, m) => t <= onTurn && (cur = m));
  const shown = minimapWindow(marks.length, cur);
  const at = hoverBar ?? cur;
  const tip = hoverBar !== null ? turns[marks[hoverBar]]?.me : null;
  return (
    <nav className="siso-chat__minimap" aria-label="Your messages" style={{ height: `${2 * WINDOW * 14}px` }} onMouseLeave={() => setHoverBar(null)}>
      {shown.map(({ mark, slot, fade }) => {
        const t = turns[marks[mark]];
        const label = peerOf(t.me!)?.text ?? t.me!.text;
        return (
          <button
            key={t.key}
            type="button"
            className={mark === cur ? "is-on" : undefined}
            style={{ top: `${slot * 14}px`, width: minimapWidth(Math.abs(mark - at)), opacity: mark === cur ? 1 : fade }}
            aria-label={`Message ${mark + 1} of ${marks.length}: ${label.replace(/\s+/g, " ").slice(0, 80)}`}
            onMouseEnter={() => setHoverBar(mark)}
            onClick={() => jumpTo(marks[mark])}
          />
        );
      })}
      {tip && hoverBar !== null && (
        <div className="siso-chat__miniTip" style={{ top: `${(hoverBar - cur + WINDOW) * 14}px` }}>
          <b>{(peerOf(tip)?.text ?? tip.text).replace(/\s+/g, " ").slice(0, 90)}</b>
          {tip.at ? <span>{fmtClock(tip.at)}</span> : null}
        </div>
      )}
    </nav>
  );
});

// ---------------------------------------------------------------- the chat

/**
 * The chat of an agent run by siso-host, drawn by the app (Shaan, 2 Oct: "swap the cli chat to the ui one so we
 * actually own the nicer ui"; 13:00: "the CLI is really clean … what you're doing is just ugly"). Laid out by
 * lib/chat.ts: finished turns fold to "Worked for …", tool runs to one counted line, edits as diffs, sub-agents as live
 * cards that open their own transcript beside the chat. The input box keeps taking messages while Claude works (they
 * wait under it until Claude takes them at the next tool boundary); Stop sits beside Send.
 */
/** Memoised (t-0237): eight chats stay mounted, and each poll that redrew the app redrew all eight with it. */
export const ChatView = memo(ChatViewInner);
function ChatViewInner({ agentId, agentKey = agentId, agentName, conversationTarget, active, people = {}, onMoved, accent, hud, ended = false, onQuestionConnection }: { agentId: string; agentKey?: string; agentName?: string; conversationTarget?: ConversationPinTarget; active: boolean; people?: People; onMoved?: (id: string) => void; accent?: string; hud?: ReactNode; /** R1.25: an agent that left herdr, its chat read back read-only (no composer). */ ended?: boolean; onQuestionConnection?: (agentId: string, connection: OwnerQuestionConnection | null) => void }) {
  // t-0458: a reload paints the turns he was reading at once; the socket's first snapshot replaces them.
  const keepsSeen = !conversationTarget && !ended;
  const [events, setEvents] = useState<Ev[]>(() => keepsSeen ? readSeen(agentId) : []);
  const seen = useRef(events);
  const sessionHistory = useRef<Ev[]>([]);
  seen.current = events;
  useEffect(() => {
    if (!keepsSeen) return;
    const keep = () => writeSeen(agentId, seen.current);
    window.addEventListener("pagehide", keep);
    return () => window.removeEventListener("pagehide", keep);
  }, [agentId, keepsSeen]);
  const lifecycle = useRef(new FlightLedger());
  const [deliverySession, setDeliverySession] = useState<string | null>(null);
  const [partial, setPartial] = useState<Record<string, string>>({});
  const [thinking, setThinking] = useState<Record<string, string>>({});
  const [outTokens, setOutTokens] = useState(0);
  const onMovedRef = useRef(onMoved);
  onMovedRef.current = onMoved;
  const activeRef = useRef(active);
  activeRef.current = active;
  const thinkStart = useRef<Record<string, number>>({});
  const [state, setState] = useState<State>("idle");
  const [tasks, setTasks] = useState<Record<string, Task>>({});
  const [bg, setBg] = useState<Bg[]>([]);
  const shells = useMemo(() => bg.filter((b) => !/agent/i.test(b.kind)), [bg]);
  const [commands, setCommands] = useState<Command[]>([]);
  const [connected, setConnected] = useState(false);
  const [recovery, setRecovery] = useState(initialRecovery);
  const recoveryRef = useRef(recovery);
  const recoveryEvent = useCallback((event: RecoveryEvent) => {
    recoveryRef.current = recover(recoveryRef.current, event);
    setRecovery(recoveryRef.current);
    return recoveryRef.current;
  }, []);
  const receivedAt = useRef<number | null>(null);
  const replyBoundary = useRef<Boundary | null>(null);
  const currentState = useRef(state); currentState.current = state;
  const [findOpen, setFindOpen] = useState(false), [findInput, setFindInput] = useState(''), [findQuery, setFindQuery] = useState('');
  const [findSelected, setFindSelected] = useState<string | null>(null), [findRevision, setFindRevision] = useState(0);
  const [searchFailed, setSearchFailed] = useState(false);
  const findFocus = useRef<HTMLElement | null>(null);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [currentTurn, setCurrentTurn] = useState<number | null>(null);
  const [sleepView, setSleepView] = useState<SleepView | null>(null);
  const wakingDraft = useRef<string | null>(null);
  const [queue, setQueue] = useState<QueueSnapshot | null>(null);
  const [caps, setCaps] = useState<DeliveryCapabilities | null>(null);
  const [queueBusy, setQueueBusy] = useState(false);
  const queueKey = useRef<string | null>(null);
  const promptFrames = useRef(new Map<string, object>());
  const localReceiptKeys = useRef(new Set<string>());
  const [acceptedReceipt, setAcceptedReceipt] = useState<{ key: string; text?: string } | null>(null);
  useEffect(() => {
    localReceiptKeys.current.clear();
    setAcceptedReceipt(null);
  }, [agentId, agentKey]);
  useEffect(() => { if (!active) setAcceptedReceipt(null); }, [active]);
  const [questionRequests, setQuestionRequests] = useState<QuestionRequest[]>([]);
  const [questionDrafts, setQuestionDrafts] = useState<Record<string, QuestionDraft>>({});
  const questionSending = useRef(new Set<string>());
  const [questionIdentity, setQuestionIdentity] = useState<{hostInstance:string;session:string;snapshotVersion:string} | null>(null);
  const [questionCanAnswer, setQuestionCanAnswer] = useState(false);
  const [questionRecovery, setQuestionRecovery] = useState<QuestionRecoverySnapshot | null>(null);
  const [questionNotice, setQuestionNotice] = useState<string | null>(null);
  const questionSnapshot = useRef(0);
  const questionWaiters = useRef(new Map<string, {hostInstance:string;session:string;submissionId:string;resolve:(e:QuestionEvent)=>void;reject:(e:Error)=>void;timer:ReturnType<typeof setTimeout>}>());
  const failQuestionWaiters = useCallback((reason:string) => {
    for (const waiter of questionWaiters.current.values()) { clearTimeout(waiter.timer); waiter.reject(Error(reason)); }
    questionWaiters.current.clear();
  }, []);

  const draftForQuestion = (r: QuestionRequest) => questionDrafts[r.id] ?? { index:0, answers:{}, status:'editing' as const };

  /** What he sent that the chat does not show yet (lib/chat.ts Pending), and a one-line reason when Send cannot go. */
  const [pending, setPending] = useState<Pending[]>([]);
  const [hint, setHint] = useState("");
  const deliveryHint = useRef<string | null>(null);
  const [sendWhenAdded, setSendWhenAdded] = useState(false);
  // Drafts are durable when storage succeeds; unsaved edits remain in this window only.
  const draftKey = `agent-base:draft:${agentId}${conversationChatQuery(conversationTarget)}`;
  const { images, setImages, uploading, failedImages, setFailedImages, uploadImage, saveText, persistenceError, retrySave, initialText } = useChatAttachments(draftKey);
  const [draft, setDraft] = useState(() => initialText);
  const [pick, setPick] = useState(0);
  /** The slash menu he closed with Esc: shut for that draft, open again once he types (QA #5). */
  const [menuShut, setMenuShut] = useState<string | null>(null);
  const [openAgent, setOpenAgent] = useState<string | null>(null);
  useEffect(() => {
    if (!active) return;
    const onSubagent = (e: Event) => {
      // A row opens that sub-agent in place; the picker's main-chat row (id null) goes back to the chat (R1.19).
      const d = (e as CustomEvent<{ id?: string | null }>).detail;
      if (d && "id" in d) setOpenAgent(d.id || null);
    };
    window.addEventListener("siso-open-subagent", onSubagent);
    return () => window.removeEventListener("siso-open-subagent", onSubagent);
  }, [active]);
  const [now, setNow] = useState(Date.now());
  const ws = useRef<WebSocket | null>(null);
  const sealedSocketVerified = useRef(!conversationTarget);
  // A stale HUD row must not change settings on a replacement session or an unverified socket.
  const settingsConnection = useRef<{ socket: WebSocket; session: string | null; hosted: boolean } | null>(null);
  // Deferred Send belongs to this verified connection, never its replacement.
  const uploadSend = useRef<{ socket: WebSocket; session: string; hosted: boolean } | null>(null);
  const queuedUploadIsCurrent = useCallback(() => {
    const intent = uploadSend.current, binding = settingsConnection.current;
    return !!intent && sealedSocketVerified.current && binding?.socket === intent.socket && binding.socket === ws.current && binding.socket.readyState === WebSocket.OPEN && binding.session === intent.session && binding.hosted === intent.hosted;
  }, []);
  const cancelQueuedUpload = useCallback(() => {
    if (!uploadSend.current) return;
    uploadSend.current = null;
    setSendWhenAdded(false);
    setHint("Chat connection or session changed. Your text and attachments are kept; press Send again after the chat is verified.");
  }, []);
  const takebacks = useRef(new Map<string, string>());
  const list = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLTextAreaElement>(null);
  const stick = useRef(true);
  // R1.21: the header's Answer jumps to the latest turn and puts his cursor in the composer.
  useEffect(() => {
    if (!active) return;
    const jump = (e: Event) => {
      if ((e as CustomEvent<{ agentId?: string }>).detail?.agentId !== agentId) return;
      stick.current = true;
      list.current?.scrollTo({ top: list.current.scrollHeight });
      box.current?.focus();
    };
    window.addEventListener("siso-chat-jump", jump);
    return () => window.removeEventListener("siso-chat-jump", jump);
  }, [active, agentId]);
  const userAt = useRef(0);
  const minimap = useRef<ChatMinimapHandle>(null);
  /** Which turn is on screen, for the minimap (turns carry their index; only the rendered ones are in the page). */
  const measure = useCallback(() => {
    const el = list.current;
    if (!el) return;
    const turns = [...el.querySelectorAll<HTMLElement>(".siso-chat__turn")];
    // The minimap stops at the first visible turn. Yield bounds on demand rather
    // than reading layout for every expanded history row before that early exit.
    function* bounds() {
      for (const t of turns) yield { top: t.offsetTop, height: t.offsetHeight };
    }
    const i = minimapCurrent(el.scrollTop, el.scrollTop + el.clientHeight, bounds());
    const turn = i === null ? null : Number(turns[i].dataset.turn);
    minimap.current?.showTurn(turn);
    setCurrentTurn(was => was === turn ? was : turn);
  }, []);
  // Wheel/touch scroll events can outnumber animation frames. Measure only the latest
  // position once per frame; keep the follow/older-page decisions in onScroll immediate.
  // Read fresh bounds each time so streamed Markdown, open folds and images stay accurate.
  const measureFrame = useRef<number | null>(null);
  const scheduleMeasure = useCallback(() => {
    if (measureFrame.current !== null) return;
    measureFrame.current = requestAnimationFrame(() => {
      measureFrame.current = null;
      if (activeRef.current) measure();
    });
  }, [measure]);
  useEffect(() => {
    // Hidden chats can receive new turns. Refresh on return even without another
    // scroll event, and discard obsolete work on hide, unmount or StrictMode replay.
    if (active) scheduleMeasure();
    return () => {
      if (measureFrame.current !== null) cancelAnimationFrame(measureFrame.current);
      measureFrame.current = null;
    };
  }, [active, scheduleMeasure]);
  // A long chat renders its last ~60 turns; older ones load as he scrolls up, the view held steady (2 Oct 14:13).
  const RENDER = 60;
  const [start, setStart] = useState<number | null>(null);
  const hold = useRef<{ height: number; top: number } | null>(null);
  // Lazy chats (P0 performance): the node sends the last ~60 events; older pages come on request as he scrolls up.
  const olderAt = useRef<{ before: number; more: boolean; asked: boolean }>({ before: 0, more: false, asked: false });
  const [more, setMore] = useState(false);
  const [olderTick, setOlderTick] = useState(0);
  const pendingJump = useRef<number | null>(null);
  const scrollToTurn = (i: number) => {
    const el = list.current;
    const t = el?.querySelector<HTMLElement>(`.siso-chat__turn[data-turn="${i}"]`);
    if (el && t) {
      stick.current = false;
      el.scrollTo({ top: t.offsetTop - 12, behavior: "smooth" });
      t.classList.remove('is-jump'); void t.offsetWidth; t.classList.add('is-jump');
      t.focus({ preventScroll: true });
      window.setTimeout(() => t.classList.remove('is-jump'), 600);
    }
  };
  const jumpTo = (i: number) => {
    if (start !== null && i < start) {
      pendingJump.current = i;
      setStart(i);
    } else scrollToTurn(i);
  };

  useEffect(() => {
    recoveryRef.current = initialRecovery(); setRecovery(recoveryRef.current);
    sessionHistory.current = [];
    let closed = false;
    let identityFailed = false;
    let retry = 0;
    let session: string | null = null;
    let questionBinding: { hostInstance: string; session: string; canAnswer: boolean } | null = null;
    let lifecycleSince = Date.now();
    let pendingDelta = new Map<string, string>();
    let pendingThinkingDelta = new Map<string, string>();
    let deltaFrame: number | null = null;
    const flushDeltas = () => {
      if (!pendingDelta.size && !pendingThinkingDelta.size) return;
      if (deltaFrame !== null) cancelAnimationFrame(deltaFrame);
      deltaFrame = null;
      const deltas = pendingDelta;
      const thinkingDeltas = pendingThinkingDelta;
      pendingDelta = new Map();
      pendingThinkingDelta = new Map();
      if (deltas.size) setPartial((current) => {
        const next = { ...current };
        for (const [id, text] of deltas) next[id] = (next[id] ?? "") + text;
        return next;
      });
      if (thinkingDeltas.size) setThinking((current) => {
        const next = { ...current };
        for (const [id, text] of thinkingDeltas) next[id] = (next[id] ?? "") + text;
        return next;
      });
    };
    const discardDeltas = () => {
      if (deltaFrame !== null) cancelAnimationFrame(deltaFrame);
      deltaFrame = null;
      pendingDelta.clear();
      pendingThinkingDelta.clear();
    };
    const queueDelta = (id: string, text: string, thinkingDelta = false) => {
      const pending = thinkingDelta ? pendingThinkingDelta : pendingDelta;
      pending.set(id, (pending.get(id) ?? "") + text);
      if (deltaFrame === null) deltaFrame = requestAnimationFrame(flushDeltas);
    };
    const connect = () => {
      const epoch = recoveryEvent({ type: 'CONNECT' }).epoch;
      cancelQueuedUpload();
      let identityVerified = !conversationTarget;
      sealedSocketVerified.current = !conversationTarget;
      settingsConnection.current = null;
      setConnected(false);
      setDeliverySession(null);
      setQuestionIdentity(null);
      setQuestionCanAnswer(false);
      questionBinding = null;
      setQuestionRequests([]);
      const sock = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/${ended ? "ended" : "chat"}/${encodeURIComponent(agentId)}/ws${conversationChatQuery(conversationTarget)}`);
      ws.current = sock;
      sock.onopen = () => { if (!closed && ws.current === sock && !conversationTarget) setConnected(true); };
      sock.onclose = (event) => {
        if (closed || ws.current !== sock) return;
        const boundary = currentState.current !== 'idle' ? replyBoundary.current : null;
        const buffered = boundary ? pendingDelta.get(boundary.id) ?? '' : '';
        flushDeltas();
        recoveryEvent({ type: 'DISCONNECT', epoch, at: Date.now(), boundary: boundary ? { ...boundary, text: boundary.text + buffered, at: receivedAt.current ?? boundary.at } : null });
        setPending(v => v.map(p => p.status === 'sending' || p.status === 'sent' ? { ...p, status: 'unknown', note: 'Delivery not known. Nothing will be resent automatically.' } : p));
        if (searchTimer.current) { clearTimeout(searchTimer.current); searchTimer.current = null; setSearchFailed(true); }
        cancelQueuedUpload();
        settingsConnection.current = null;
        setConnected(false);
        sealedSocketVerified.current = !conversationTarget;
        failQuestionWaiters("Disconnected · answer delivery is unconfirmed; draft kept");
        questionSending.current.clear();
        setQuestionDrafts(v => Object.fromEntries(Object.entries(v).map(([id,d]) => [id,{ ...d,status:'failed',error:'Disconnected · answer draft kept' }])));
        queueKey.current = null; setQueueBusy(false);
        if (takebacks.current.size) {
          takebacks.current.clear();
          setHint("Could not confirm removal; the message may still be sent.");
        }
        if (conversationTarget) setHint("Pinned conversation is unavailable. Reopen the pin when its exact session is available.");
        if (event.code === 4003) identityFailed = true;
        if (!closed && !identityFailed) retry = window.setTimeout(connect, 1500);
      };
      sock.onmessage = (m) => {
        if (closed || identityFailed || ws.current !== sock) return;
        let e: any;
        try { e = JSON.parse(m.data); } catch { if (conversationTarget) { identityFailed = true; sealedSocketVerified.current = false; setConnected(false); setHint("Pinned conversation identity could not be verified."); sock.close(); } return; }
        if (!e || typeof e !== 'object') return;
        if (conversationTarget) {
          if (!e || (!identityVerified && e.t !== "hello") || e.t === "moved" || e.t === "hello" && (e.session !== conversationTarget.session || e.replaced) || e.t === "init" && e.session !== conversationTarget.session) {
            identityFailed = true;
            sealedSocketVerified.current = false;
            setConnected(false);
            setHint("Pinned conversation changed or is unavailable. Nothing was sent.");
            sock.close();
            return;
          }
          if (e.t === "hello") { identityVerified = true; sealedSocketVerified.current = true; setConnected(true); }
        }
        // A hosted conversation can adopt a new session without replacing its socket.
        if (e.t === "init" && settingsConnection.current?.socket === sock) {
          settingsConnection.current.session = typeof e.session === "string" && e.session ? e.session : null;
          if (uploadSend.current && !queuedUploadIsCurrent()) cancelQueuedUpload();
        }
        if (e.t === "hello") discardDeltas();
        else if (e.t !== "delta" && e.t !== "tdelta") flushDeltas();
        if (e.t === "hello") {
          const previousRecovery = recoveryRef.current, boundary = previousRecovery.boundary;
          const replay = boundary ? (e.log ?? []).find((x: Ev) => x.t === 'text' && x.id === boundary.id) : null;
          const replayText = replay?.text ?? (boundary ? e.partial?.[boundary.id] : undefined);
          const finished = !!boundary && !!replay && (e.log ?? []).some((x: Ev) => x.t === 'result' && x.at >= boundary.at);
          recoveryEvent({ type: 'HELLO', epoch, session: e.session ?? null, at: Date.now(), text: replayText, complete: finished || !boundary && e.state === 'idle' });
          for (const entry of e.queue?.entries ?? []) recoveryEvent({ type: 'RECEIPT', epoch, key: entry.key, phase: entry.phase });
          setSleepView(e.sleep ?? null);
          settingsConnection.current = !e.source || e.source === "terminal" ? { socket: sock, session: typeof e.session === "string" && e.session ? e.session : null, hosted: !e.source } : null;
          if (uploadSend.current && (e.replaced || !queuedUploadIsCurrent())) cancelQueuedUpload();
          if (!e.session || e.session !== session || e.replaced) lifecycle.current.reset();
          const toolIds = (e.log ?? []).filter((x: Ev) => x.t === 'tool').map((x: {id:string}) => x.id);
          const doneIds = new Set((e.log ?? []).filter((x: Ev) => x.t === 'tool_done').map((x: {id:string}) => x.id));
          const activeTools = (e.tasks ?? []).filter((t: Task) => ['running','pending'].includes(t.status)).map((t: Task) => t.tool);
          lifecycle.current.baseline(toolIds, toolIds.filter((id:string) => !doneIds.has(id) || activeTools.includes(id)));
          setDeliverySession(e.session ?? null);
          lifecycleSince = Date.now();
          // The pane moved to a new session (resume, /clear, relay) and the chat followed it: one quiet line says so, so
          // the history that is no longer above isn't a mystery (R1.20).
          const moved = !!session && !!e.session && e.session !== session;
          if (moved || e.replaced) {
            takebacks.current.clear();
            localReceiptKeys.current.clear();
            setAcceptedReceipt(null);
          }
          if (e.session) session = e.session;
          const now = Date.now();
          if (e.replaced) {
            setStart(null);
            stick.current = true;
            setCommands([]);
            setOutTokens(0);
            outShown.current = 0;
            thinkStart.current = {};
          }
          setQueue(e.queue ?? null); setCaps(e.capabilities ?? null);
          failQuestionWaiters("A fresh question snapshot replaced the previous connection");
          const recovery = matchingQuestionRecovery(e.questionRecovery, e.hostInstance, e.session);
          const recoveryAccepted = e.questionRecovery == null || recovery !== null;
          const canAnswer = e.questionCapability === true && recoveryAccepted && recovery?.status !== 'unavailable';
          questionBinding = typeof e.hostInstance === 'string' && !!e.hostInstance && typeof e.session === 'string' && !!e.session ? { hostInstance: e.hostInstance, session: e.session, canAnswer } : null;
          setQuestionIdentity(questionBinding ? {hostInstance:questionBinding.hostInstance,session:questionBinding.session,snapshotVersion:String(++questionSnapshot.current)} : null);
          setQuestionCanAnswer(!!questionBinding?.canAnswer);
          setQuestionRecovery(recovery);
          setQuestionNotice(recoveryAccepted ? null : 'Question history did not match this chat. Answer delivery is disabled until a fresh valid snapshot arrives.');
          setQuestionRequests(questionBinding?.canAnswer && Array.isArray(e.pendingQuestions) ? e.pendingQuestions.filter((r: QuestionRequest) => r?.hostInstance === questionBinding?.hostInstance && r.session === questionBinding?.session) : []);
          questionSending.current.clear();
          setQuestionDrafts(v => Object.fromEntries(Object.entries(v).map(([id,d]) => [id,{ ...d,status:'editing' }])));
          if (e.queue) setPending(v => v.filter(p => !e.queue.entries.some((x: { key: string; phase: string }) => x.key === p.key && x.phase !== 'unknown')));
          if (moved) sessionHistory.current = [...seen.current, ...(boundary && !seen.current.some(x => x.t === 'text' && x.id === boundary.id) ? [{ t: 'text' as const, id: boundary.id, text: boundary.text, at: boundary.at }] : []), { t: 'note', label: 'New session', text: `New session · ${fmtClock(now)} (resume, clear or relay)`, at: now }];
          setEvents([...sessionHistory.current, ...(e.log ?? [])]);
          olderAt.current = { before: e.before ?? 0, more: !!e.more, asked: false };
          hold.current = null;
          setMore(!!e.more);
          // An incomplete replay must not erase the words this window already received.
          setPartial(boundary && !moved && !replay && !e.partial?.[boundary.id] ? { ...e.partial, [boundary.id]: boundary.text } : e.partial ?? {});
          setThinking(e.thinking ?? {});
          setState(e.state ?? "idle");
          setTasks(Object.fromEntries((e.tasks ?? []).map((t: Task) => [t.id, t])));
          setBg(e.bg ?? []);
          const cmds = (e.log ?? []).filter((x: Ev) => x.t === "commands").at(-1);
          if (cmds) setCommands(cmds.list);
        } else if (e.t === 'sleep') { setSleepView(e); }
        else if (e.t === 'queue.snapshot') { setQueue(e.snapshot); setCaps(e.capabilities); }
        else if (e.t === 'prompt.receipt') {
          recoveryEvent({ type: 'RECEIPT', epoch, key: e.key, phase: e.phase });
          if (e.code === 'wake_failed' && wakingDraft.current !== null) { const restored = wakingDraft.current; setDraft(value => value || restored); wakingDraft.current = null; }
          else if (['accepted', 'started'].includes(e.phase)) { wakingDraft.current = null; }

          // A visual receipt belongs only to a prompt this mounted recipient submitted.
          // Queue snapshots, offer/save phases and acknowledgements from an old socket never qualify.
          if (ws.current === sock && (e.phase === 'accepted' || e.phase === 'started') && localReceiptKeys.current.delete(e.key) && activeRef.current) {
            setAcceptedReceipt({ key: e.key, text: 'Received by agent' });
          } else if (e.phase === 'cancelled' || e.phase === 'failed') localReceiptKeys.current.delete(e.key);
          if (queueKey.current === e.key) { queueKey.current = null; setQueueBusy(false); if (e.phase === 'failed') setHint(e.text); }
          if (e.phase === 'failed' || e.phase === 'unknown') {
            deliveryHint.current = e.text ?? e.phase;
            setHint(e.text ?? e.phase);
            setPending(v => v.map(p => p.key === e.key ? { ...p,status:e.phase === 'unknown' ? 'unknown' : 'failed',note:e.text ?? e.phase } : p));
          } else { if (e.phase === 'accepted' || e.phase === 'started') setHint(value => value === deliveryHint.current ? '' : value); promptFrames.current.delete(e.key); setPending(v => v.filter(p => p.key !== e.key)); }
        } else if (e.t === 'question') {
          if (!questionBinding?.canAnswer || e.request?.hostInstance !== questionBinding.hostInstance || e.request?.session !== questionBinding.session) return;
          setQuestionRequests(v => [...v.filter(q => q.id !== e.request.id),e.request]);
          setEvents(v => [...v,e]);
        } else if (e.t === 'question_done') {
          if (!questionBinding || e.hostInstance !== questionBinding.hostInstance) return;
          const waiter = questionWaiters.current.get(e.id);
          if (waiter && waiter.hostInstance === e.hostInstance) { clearTimeout(waiter.timer); questionWaiters.current.delete(e.id); waiter.resolve(e); }
          questionSending.current.delete(e.id);
          setQuestionRequests(v => v.filter(q => q.id !== e.id));
          setQuestionDrafts(({ [e.id]: _done, ...rest }) => rest);
          if (e.reason === 'delivery-unconfirmed') setQuestionNotice('Answer delivery is unconfirmed. The old question is closed; its answer will not be resent automatically.');
          setEvents(v => [...v,e]);
        } else if (e.t === 'question_failed') {
          if (!questionBinding || e.hostInstance !== questionBinding.hostInstance) return;
          const waiter = questionWaiters.current.get(e.id);
          if (waiter && waiter.hostInstance === e.hostInstance && waiter.submissionId === e.submissionId) { clearTimeout(waiter.timer); questionWaiters.current.delete(e.id); waiter.reject(Error(e.text)); }
          questionSending.current.delete(e.id);
          setQuestionDrafts(v => ({ ...v,[e.id]: { ...(v[e.id] ?? { index:0,answers:{} }),status:'failed',error:e.text } }));
        } else if (e.t === "older") {
          if (searchTimer.current) { clearTimeout(searchTimer.current); searchTimer.current = null; }
          if (e.more && (!e.events?.length || e.before >= olderAt.current.before)) setSearchFailed(true);
          olderAt.current = { before: e.before ?? 0, more: !!e.more, asked: false };
          setMore(!!e.more);
          setEvents((v) => [...sessionHistory.current, ...(e.events ?? []), ...v.slice(sessionHistory.current.length)]);
          setOlderTick((n) => n + 1);
        } else if (e.t === "delta") { receivedAt.current = Number.isFinite(e.at) ? e.at : Date.now(); recoveryEvent({ type: 'PROGRESS', epoch, id: e.id }); queueDelta(e.id, e.text); }
        else if (e.t === "tdelta") queueDelta(e.id, e.text, true);
        else if (e.t === "usage") setOutTokens(e.out);
        // Its row now lives in another terminal (Agent Zero's next session): follow it (ab-151), but only the chat he is
        // looking at: a chat mounted in the background switched him to another agent with no click (QA P0-1, t-0265).
        else if (e.t === "moved") { cancelQueuedUpload(); if (activeRef.current) onMovedRef.current?.(e.id); }
        else if (e.t === "state") {
          currentState.current = e.state;
          setState(e.state);
          if (e.state === "idle") setOutTokens(0);
        }
        else if (e.t === "task") {
          if (e.task.tool && e.task.endedAt && ['done','failed','killed','stopped','blocked'].includes(e.task.status)) lifecycle.current.returned(e.task.tool);
          setTasks((v) => ({ ...v, [e.task.id]: e.task }));
        }
        // The node typed a sent message into the pane (sent), or could not (unsent): the pending row says which.
        else if (e.t === "sent" || e.t === "unsent")
          setPending((v) => v.map((p) => (p.key === e.key ? { ...p, status: e.t === "sent" ? "sent" : "failed", note: e.error } : p)));
        else if (e.t === "bg") setBg(e.list);
        else if (e.t === "unqueued") {
          const text = takebacks.current.get(e.id);
          takebacks.current.delete(e.id);
          if (text !== undefined) {
            setHint("");
            setDraft((current) => (current.trim() ? current : text));
            box.current?.focus();
          }
          setEvents((v) => [...v, e]);
        }
        else if (e.t === "unqueue_failed") {
          takebacks.current.delete(e.id);
          setHint(e.text);
        }
        else {
          if (e.t === 'text') { receivedAt.current = Number.isFinite(e.at) ? e.at : Date.now(); recoveryEvent({ type: 'PROGRESS', epoch, id: e.id }); }
          if (e.t === 'result') recoveryEvent({ type: 'PROGRESS', epoch, complete: true });
          if (session && e.t === 'tool' && (e.name === 'Agent' || e.name === 'Task')) { if (e.at >= lifecycleSince && e.at <= Date.now()) lifecycle.current.spawn(e.id); else lifecycle.current.observe(e.id); }
          if (e.t === 'tool_done') lifecycle.current.returned(e.id);
          if (e.t === 'user' && e.text?.includes('<task-notification>')) {
            const tool = e.text.match(/<tool-use-id>([^<]+)<\/tool-use-id>/)?.[1];
            if (tool) lifecycle.current.returned(tool);
          }
          if (e.t === "text") setPartial(({ [e.id]: _done, ...rest }) => rest);
          if (e.t === "thinking") setThinking(({ [e.id]: _done, ...rest }) => rest);
          if (e.t === "commands") setCommands(e.list);
          setEvents((v) => [...v, e]);
        }
      };
    };
    connect();
    return () => {
      closed = true;
      settingsConnection.current = null;
      window.clearTimeout(retry);
      if (searchTimer.current) clearTimeout(searchTimer.current);
      discardDeltas();
      takebacks.current.clear();
      failQuestionWaiters("Chat connection closed · draft kept");
      ws.current?.close();
    };
  }, [agentId, agentKey, conversationTarget, ended, failQuestionWaiters, cancelQueuedUpload, queuedUploadIsCurrent, recoveryEvent]);

  const preparedChat = useMemo(() => prepareChat(events), [events]);
  const chat = useMemo(() => projectChat(preparedChat, partial, state !== "idle", thinking), [preparedChat, partial, state, thinking]);
  // t-0586: streamed words change `chat` every frame, in every mounted chat. The passes that walk every turn (outline,
  // find, sub-agent calls, links, outputs) read this one, which changes only when an event lands.
  const settled = useMemo(() => projectChat(preparedChat, {}, state !== "idle"), [preparedChat, state]);
  const tail = chat.turns.at(-1), tailText = tail ? [...tail.work, ...tail.answer].filter((item): item is Extract<Item, { k: 'said' }> => item.k === 'said').at(-1) : null;
  replyBoundary.current = tail && tailText ? { id: tailText.key, text: tailText.text, at: receivedAt.current ?? Date.now(), turnKey: tail.key } : null;
  useEffect(() => {
    if (!recovery.backAt || recovery.response !== 'complete') return;
    const timer = setTimeout(() => recoveryEvent({ type: 'CLEAR', epoch: recovery.epoch }), 10_000);
    return () => clearTimeout(timer);
  }, [recovery.backAt, recovery.response, recovery.epoch, recoveryEvent]);
  // A pending row goes as soon as the chat shows the message itself (his turn, or the host's queued row).
  useEffect(() => { if (!caps) setPending((v) => settlePending(v, events)); }, [events, caps]);
  const from = start ?? Math.max(0, chat.turns.length - RENDER);
  useEffect(() => {
    if (start === null && chat.turns.length > RENDER) setStart(chat.turns.length - RENDER);
    // While he reads the newest words, the window trails them: a working chat kept every new turn on screen and grew
    // without end (P0 2 Oct: 33 → 456 turns and +170 MB in under 3 min of a busy agent). Scrolled up, it holds still.
    else if (start !== null && stick.current && chat.turns.length - start > RENDER + 20) setStart(chat.turns.length - RENDER);
  }, [start, chat.turns.length]);
  useLayoutEffect(() => {
    const el = list.current;
    if (el && hold.current) {
      el.scrollTop = hold.current.top + (el.scrollHeight - hold.current.height);
      hold.current = null;
    }
    if (pendingJump.current !== null) {
      const i = pendingJump.current;
      pendingJump.current = null;
      scrollToTurn(i);
    }
  }, [from, olderTick]);
  const loadOlder = () => {
    const el = list.current;
    if (!el || hold.current) return;
    if (from > 0) {
      hold.current = { height: el.scrollHeight, top: el.scrollTop };
      setStart(Math.max(0, from - 40));
      return;
    }
    // Every loaded turn is on screen: ask the node for the page before them.
    const at = olderAt.current;
    if (!at.more || at.asked || ws.current?.readyState !== WebSocket.OPEN) return;
    at.asked = true;
    hold.current = { height: el.scrollHeight, top: el.scrollTop };
    ws.current.send(JSON.stringify({ t: "older", before: at.before }));
  };
  const outlineRows = useMemo(() => outline(settled.turns), [settled.turns]);
  const searchDocuments = useMemo(() => findOpen ? findDocuments(settled.turns) : [], [findOpen, settled.turns]);
  const findResults = useMemo(() => findMatches(searchDocuments, findQuery), [searchDocuments, findQuery]);
  const matchIndex = Math.max(0, findResults.findIndex(m => m.id === findSelected)), match = findResults[matchIndex];
  const lastFindJump = useRef('');
  const closeFind = useCallback(() => { setFindOpen(false); setFindInput(''); setFindQuery(''); findFocus.current?.focus({ preventScroll: true }); }, []);
  useEffect(() => { const timer = setTimeout(() => { setFindQuery(findInput); setFindSelected(null); lastFindJump.current = ''; }, 120); return () => clearTimeout(timer); }, [findInput]);
  useEffect(() => {
    if (!active) return;
    const key = (e: globalThis.KeyboardEvent) => {
      const inThread = list.current?.contains(e.target as Node) && !(e.target as HTMLElement).closest('input, textarea, [contenteditable="true"]');
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'f' || e.key === '/' && inThread) {
        e.preventDefault(); findFocus.current = document.activeElement as HTMLElement; stick.current = false; setFindOpen(true);
      } else if (e.key === 'Escape' && findOpen) { e.preventDefault(); closeFind(); }
    };
    window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key);
  }, [active, findOpen, closeFind]);
  useEffect(() => {
    if (!findOpen || !findQuery || !more || searchFailed || !connected || olderAt.current.asked) return;
    const at = olderAt.current;
    at.asked = true;
    ws.current?.send(JSON.stringify({ t: 'older', before: at.before }));
    searchTimer.current = setTimeout(() => { searchTimer.current = null; at.asked = false; setSearchFailed(true); }, 8_000);
  }, [findOpen, findQuery, more, olderTick, searchFailed, connected]);
  useEffect(() => {
    if (!findOpen || !match) return;
    if (findSelected !== match.id) setFindSelected(match.id);
    if (match.turn < from) { pendingJump.current = match.turn; setStart(match.turn); }
  }, [findOpen, match?.id, match?.turn, from, findSelected]);
  useLayoutEffect(() => {
    if (!active || !findOpen || !findQuery || !list.current) return;
    const root = list.current;
    const highlightApi = CSS as typeof CSS & { highlights?: Map<string, unknown> };
    const HighlightClass = (window as unknown as { Highlight?: new (...ranges: Range[]) => unknown }).Highlight;
    const all = [...root.querySelectorAll<HTMLElement>('[data-find-source]')].flatMap(el => textRanges(el, findQuery));
    if (HighlightClass) highlightApi.highlights?.set('chat-find', new HighlightClass(...all));
    const turn = match ? [...root.querySelectorAll<HTMLElement>('[data-turn-key]')].find(el => el.dataset.turnKey === match.turnKey) : null;
    const source = turn && match ? [...turn.querySelectorAll<HTMLElement>('[data-find-source]')].find(el => el.dataset.findSource === match.source) : null;
    const ranges = source ? textRanges(source, findQuery) : [];
    const selected = ranges[match?.occurrence ?? 0] ?? ranges[0];
    if (HighlightClass && selected) highlightApi.highlights?.set('chat-find-current', new HighlightClass(selected));
    const jump = `${match?.id}:${findRevision}`;
    if (turn && match && lastFindJump.current !== jump) {
      lastFindJump.current = jump; stick.current = false;
      // Scroll a long, internally scrolling code/output block to the precise text range first.
      const pre = selected?.startContainer.parentElement?.closest('pre');
      if (selected && pre) { const rect = selected.getBoundingClientRect(), p = pre.getBoundingClientRect(); pre.scrollTop += rect.top - p.top - 30; pre.scrollLeft += Math.max(0, rect.left - p.left - 30); }
      const rect = selected?.getBoundingClientRect() ?? (source ?? turn).getBoundingClientRect();
      root.scrollTo({ top: root.scrollTop + rect.top - root.getBoundingClientRect().top - 80 });
    }
    return () => { highlightApi.highlights?.delete('chat-find'); highlightApi.highlights?.delete('chat-find-current'); };
  }, [active, findOpen, findQuery, match?.id, findRevision, chat, from]);
  const stepFind = (direction: number) => { if (!findResults.length) return; setFindSelected(findResults[(matchIndex + direction + findResults.length) % findResults.length].id); setFindRevision(n => n + 1); };
  // The minimap's marks: one per message from him or a peer (background-task ends get none).
  const marks = useMemo(() => chat.turns.flatMap((t, i) => (t.me && !t.me.notice ? [i] : [])), [chat.turns]);
  const taskByTool = useMemo(() => new Map(Object.values(tasks).flatMap((t) => (t.tool ? [[t.tool, t] as const] : []))), [tasks]);
  const runningTasks = Object.values(tasks).filter((t) => t.status === "running");

  // What the bottom bar counts for this agent (Hud): sub-agents running / started here, and background jobs.
  useEffect(() => {
    const calls = chat.turns.flatMap((t) => [...t.work, ...t.answer]).filter((it): it is Extract<Item, { k: "agent" }> => it.k === "agent");
    const running = calls.filter((it) => {
      const task = taskByTool.get(it.call.id);
      return task ? task.status === "running" || task.status === "pending" : it.call.done === undefined;
    }).length;
    // R1.21: its latest step, for the header's line 2 when no plan item or title says what it is doing: the running
    // call, else the last thing it said, else its last call.
    const lastTurn = chat.turns.at(-1);
    const items = lastTurn ? [...lastTurn.work, ...lastTurn.answer] : [];
    const runs = items.flatMap((it) => (it.k === "run" ? it.calls : []));
    const live = [...runs].reverse().find((c) => c.done === undefined);
    const said = [...items].reverse().find((it): it is Extract<Item, { k: "said" }> => it.k === "said")?.text.trim().split("\n")[0].replace(/[#*_`>]/g, "").trim();
    const last = live ? doing(live) : said || (runs.length ? doing(runs[runs.length - 1]) : "");
    window.dispatchEvent(new CustomEvent("siso-chat-activity", { detail: { agentId, running, total: calls.length, bg: shells.length, shells, last } }));
  }, [chat, taskByTool, shells, agentId]);
  // The working line's clock (from his last message), for the panel's "Working · 5m" (R1.23b).
  const turnAt = chat.turns.at(-1)?.me?.at ?? null;
  useEffect(() => setTurnStart(agentId, turnAt), [agentId, turnAt]);
  // Words another surface typed for him (lib/prefill.ts); a draft he already started wins.
  useEffect(() => {
    const take = () => {
      const t = readPrefill(agentId);
      if (t === undefined) return;
      setDraft((d) => (d.trim() ? d : t));
      requestAnimationFrame(() => box.current?.focus());
    };
    take();
    return onPrefill(take);
  }, [agentId]);

  // A clock for live elapsed times, only while something runs (a background sub-agent counts), and only in the chat
  // he is looking at: a chat in a hidden tab or window redrew every second (P0 performance, 2 Oct).
  const onScreen = usePageVisible();
  useEffect(() => {
    if ((state === "idle" && !runningTasks.length) || !active || !onScreen) return;
    setNow(Date.now());
    return clock(() => setNow(Date.now()));
  }, [state, runningTasks.length, active, onScreen]);

  // Follow the newest words unless he has scrolled up to read: on every change of height, not only on new events
  // (markdown, images and folds grow after they land).
  const col = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // A hidden chat (kept mounted) skips the forced layout on every streamed word; it catches up when shown (t-0586).
    if (!active) return;
    const el = list.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [events, partial, active]);
  useEffect(() => {
    const el = list.current;
    const c = col.current;
    if (!el || !c) return;
    const ro = new ResizeObserver(() => {
      if (stick.current) el.scrollTop = el.scrollHeight;
    });
    ro.observe(c);
    return () => ro.disconnect();
  }, []);
  // "↓ N new" when he has scrolled up and words landed meanwhile.
  const [away, setAway] = useState(false);
  const seenAt = useRef(0);
  const said = events.filter((e) => e.t === "text" || e.t === "user").length;
  if (!away) seenAt.current = said;
  const fresh = away ? said - seenAt.current : 0;
  const toBottom = () => {
    const el = list.current;
    if (!el) return;
    stick.current = true;
    setAway(false);
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  };
  useEffect(() => {
    if (active) box.current?.focus();
  }, [active]);

  const sendRaw = useCallback((m: unknown) => {
    if (!sealedSocketVerified.current || ws.current?.readyState !== WebSocket.OPEN) return false;
    ws.current.send(JSON.stringify(m));
    return true;
  }, []);
  // Images he pastes, drops or picks (2 Oct 14:00: "I can't paste images in the chat"): saved by the node, sent by path.
  useEffect(() => { saveText(draft); }, [draft, saveText]);
  const [contextOpen, setContextOpen] = useState<string | null>(null);
  const [contextExpanded, setContextExpanded] = useState(false);
  const [inspectRequest, setInspectRequest] = useState<{ scope: string; id: string; revision: number } | null>(null);
  useEffect(() => { setContextOpen(null); setContextExpanded(false); setInspectRequest(null); }, [agentId, deliverySession]);
  const contextSources: ContextSource[] = [
    ...images.map(im => ({ id: `image:${im.name}`, title: im.name, kind: 'image' as const, state: 'ready' as const, detail: 'Uploaded image attached to this draft.' })),
    ...failedImages.map(im => ({ id: `failed:${im.id}`, title: im.file.name, kind: 'image' as const, state: 'failed' as const, detail: 'Upload failed. Retry or remove below; the original file is retained.', removable: uploading === 0 })),
  ];
  const filePick = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!failedImages.length) return;
    uploadSend.current = null;
    setSendWhenAdded(false);
    setHint("Image upload failed. Send canceled; your draft and other images are kept. Retry or remove the failed image, then press Send.");
  }, [failedImages]);
  const addImages = (files: Iterable<File>) => {
    for (const f of files) {
      if (!/^image\/(png|jpeg|gif|webp)$/.test(f.type)) continue;
      uploadImage(f);
    }
  };
  const deliver = (text: string, imagePaths: string[], key = `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`) => {
    setPending((v) => [...v.filter((p) => p.key !== key), { key, text, images: imagePaths, at: Date.now(), status: "sending" }]);
    // Running hosts from before automatic delivery still support native steering; no restart is required.
    const delivery = caps?.auto ? 'auto' : caps?.steer && caps.activeTurnId ? 'steer' : 'next';
    const frame = promptFrames.current.get(key) ?? { t:'prompt',text,images:imagePaths,key,messageId:key,delivery,...(delivery === 'steer' ? { expectedTurnId:caps?.activeTurnId } : {}) };
    promptFrames.current.set(key, frame);
    recoveryEvent({ type: 'SEND', epoch: recoveryRef.current.epoch, key });
    if (sendRaw(frame)) localReceiptKeys.current.add(key);
    else setPending(v => v.map(p => p.key === key ? { ...p, status: 'failed', note: 'Disconnected before sending; kept for retry.' } : p));
  };
  const queueCommand = (m: object) => {
    if (ws.current?.readyState !== WebSocket.OPEN || queueKey.current) return;
    const key = crypto.randomUUID(); queueKey.current = key; setQueueBusy(true); setHint('');
    sendRaw({ ...m,key });
  };
  const answerOwnerQuestion = useCallback((message: NativeQuestionMessage): Promise<QuestionEvent> => {
    if (!connected || !questionCanAnswer || !questionIdentity || message.hostInstance !== questionIdentity.hostInstance || message.session !== questionIdentity.session || !questionRequests.some(r => r.id === message.id && r.session === message.session && r.hostInstance === message.hostInstance)) return Promise.reject(Error("Question or connection changed; refresh the owner chat"));
    if (questionWaiters.current.has(message.id) || questionSending.current.has(message.id)) return Promise.reject(Error("An answer is already awaiting a native receipt"));
    return new Promise((resolve,reject) => {
      const timer = setTimeout(() => { questionWaiters.current.delete(message.id); reject(Error("Answer delivery is unconfirmed; wait for a fresh question snapshot")); }, 15_000);
      questionWaiters.current.set(message.id,{hostInstance:message.hostInstance,session:message.session,submissionId:message.submissionId,resolve,reject,timer});
      if (!sendRaw(message)) { clearTimeout(timer); questionWaiters.current.delete(message.id); reject(Error("Question transport is disconnected; draft kept")); }
    });
  }, [connected, questionCanAnswer, questionIdentity, questionRequests, sendRaw]);
  useEffect(() => {
    if (!onQuestionConnection) return;
    onQuestionConnection(agentId, questionIdentity ? {...questionIdentity,connected,canAnswer:questionCanAnswer,recovery:questionRecovery,notice:questionNotice,requests:questionRequests,answer:answerOwnerQuestion} : null);
    return () => onQuestionConnection(agentId,null);
  }, [agentId, onQuestionConnection, questionIdentity, connected, questionCanAnswer, questionRecovery, questionNotice, questionRequests, answerOwnerQuestion]);
  const submitQuestion = (r: QuestionRequest, dismiss: boolean) => {
    if (!connected || !questionCanAnswer || !questionIdentity || r.hostInstance !== questionIdentity.hostInstance || r.session !== questionIdentity.session || !questionRequests.some(q => q.id === r.id && q.hostInstance === r.hostInstance && q.session === r.session) || r.expiresAt <= Date.now() || ws.current?.readyState !== WebSocket.OPEN || questionSending.current.has(r.id)) return;
    const d = draftForQuestion(r), answers = buildAnswers(r,d);
    if (!dismiss && !answers) return;
    questionSending.current.add(r.id);
    setQuestionDrafts(v => ({ ...v,[r.id]:{ ...d,status:'sending',error:undefined } }));
    sendRaw({ t:'answer_question',id:r.id,hostInstance:r.hostInstance,session:r.session,submissionId:crypto.randomUUID(),action:dismiss ? 'dismiss' : 'answer',answers });
  };
  const retainUnsent = (text: string) => {
    const key = `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    setPending((v) => [...v, { key, text, images: [], at: Date.now(), status: "failed", note: "Not connected to the agent yet" }]);
    setHint("Not connected to the agent yet; your command is kept below to retry when it reconnects.");
  };
  const submit = (said?: string) => {
    const text = said ?? draft.trim();
    if (!text && !images.length && !uploading && !failedImages.length) return;
    if (!sealedSocketVerified.current) { setHint("The pinned conversation is not verified. Your draft is kept."); return; }
    // "@CODEX-2 also check 390": to that worker's own chat, which opens in the split (ui-hub VISION §7B).
    const at = !images.length ? text.match(/^@([A-Za-z0-9][A-Za-z0-9_.-]{0,39})\s+([\s\S]+)$/) : null;
    if (at && !/^(here|all|everyone)$/i.test(at[1])) {
      if (conversationTarget) { setHint("Open the worker directly to send a message; this pin is sealed to its exact conversation."); return; }
      setHint(`Sending to ${at[1]}…`);
      void fetch("/api/agents/say", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ parent: agentId, name: at[1], text: at[2] }) })
        .then(async (r) => { const d = await r.json().catch(() => ({})); if (!r.ok) throw new Error(d.error ?? `HTTP ${r.status}`); return d; })
        .then((d: { name: string }) => { setDraft(""); setHint(`Sent to ${d.name}; its chat is beside this one.`); window.dispatchEvent(new CustomEvent("siso-open-split", { detail: { name: d.name } })); })
        .catch((e: Error) => setHint(`${at[1]}: ${e.message}`));
      return;
    }
    if (failedImages.length) {
      uploadSend.current = null;
      setSendWhenAdded(false);
      setHint("Image upload failed. Retry or remove the failed image before sending; your draft and other images are kept.");
      return;
    }
    // An image still on its way: send once it is added, rather than leaving it behind for the next message.
    if (uploading > 0) {
      if (said !== undefined) setDraft(text);
      const binding = settingsConnection.current;
      if (!binding?.session || binding.socket !== ws.current || binding.socket.readyState !== WebSocket.OPEN) {
        uploadSend.current = null;
        setSendWhenAdded(false);
        setHint("Chat connection is not verified. Your text and attachments are kept; press Send again after the chat is verified.");
        return;
      }
      uploadSend.current = { socket: binding.socket, session: binding.session, hosted: binding.hosted };
      setSendWhenAdded(true);
      setHint("Sends as soon as the image is added…");
      return;
    }
    // Enter can still fire during a reconnect; keep the draft and attachments
    // until there is a socket to send them through, and say so (a silent no-op read as "send does nothing").
    if (ws.current?.readyState !== WebSocket.OPEN) {
      setHint("Not connected to the agent yet, reconnecting. Your message stays in the box; press Send again in a moment.");
      return;
    }
    setHint("");
    if (sleepView) wakingDraft.current = text;
    deliver(text, images.map((i) => i.path));
    setImages([]);
    setDraft("");
    clearPrefill(agentId);
    if (box.current) box.current.style.height = "auto";
    stick.current = true;
  };
  const submitRef = useRef(submit);
  submitRef.current = submit;
  // The HUD's model menu types `/model <id>` into this chat (R1.19); it reaches the agent at its next turn.
  const deliverRef = useRef(deliver);
  deliverRef.current = deliver;
  useEffect(() => {
    // A pin is sealed to its clicked conversation; row-scoped HUD events belong only to ordinary opens.
    if (conversationTarget) return;
    const say = (e: Event) => {
      const d = (e as CustomEvent<{ agentId?: string; session?: string | null; settings?: boolean; text?: string }>).detail;
      if (d?.agentId !== agentId || !d.text) return;
      if (d.settings && !canChangeSettings(d.session, false)) { setHint("Reconnect before changing settings; the selected session has not been verified."); return; }
      if (d.settings) clearSettingsHint();
      if (ws.current?.readyState !== WebSocket.OPEN) retainUnsent(d.text);
      else deliverRef.current(d.text, []);
    };
    const canChangeSettings = (session: unknown, hosted = true) => {
      const binding = settingsConnection.current;
      return typeof session === "string" && !!session && binding?.session === session && binding.hosted === hosted && binding.socket === ws.current && ws.current?.readyState === WebSocket.OPEN;
    };
    const clearSettingsHint = () => setHint(value => value.startsWith("Reconnect before changing") ? "" : value);
    const model = (e: Event) => {
      const d = (e as CustomEvent).detail;
      if (d?.agentId !== agentId || !d.model) return;
      if (!canChangeSettings(d.session)) { setHint("Reconnect before changing the model; the selected session has not been verified."); return; }
      if (!sendRaw({ t: "set_model", model: d.model })) setHint("Reconnect before changing the model.");
      else clearSettingsHint();
    };
    // The model picker's effort for an SDK seat (UI, 4 Oct): applied live by the host.
    const effort = (e: Event) => {
      const d = (e as CustomEvent).detail;
      if (d?.agentId !== agentId || !d.effort) return;
      if (!canChangeSettings(d.session)) { setHint("Reconnect before changing the effort; the selected session has not been verified."); return; }
      if (!sendRaw({ t: "set_effort", effort: d.effort })) setHint("Reconnect before changing the effort.");
      else clearSettingsHint();
    };
    window.addEventListener("siso-chat-model", model);
    window.addEventListener("siso-chat-effort", effort);
    window.addEventListener("siso-chat-say", say);
    return () => { window.removeEventListener("siso-chat-say", say); window.removeEventListener("siso-chat-model", model); window.removeEventListener("siso-chat-effort", effort); };
  }, [agentId, conversationTarget]);
  useEffect(() => {
    if (sendWhenAdded && uploading === 0) {
      const verified = queuedUploadIsCurrent();
      uploadSend.current = null;
      setSendWhenAdded(false);
      if (!verified) {
        setHint("Chat connection or session changed. Your text and attachments are kept; press Send again after the chat is verified.");
        return;
      }
      submitRef.current();
    }
  }, [sendWhenAdded, uploading, queuedUploadIsCurrent]);
  useEffect(() => {
    if (connected && hint.startsWith("Not connected")) setHint("");
  }, [connected, hint]);
  /** What he said into the mic (t-0100): lands in the box after anything typed there, and goes as his message; the
   * box keeps it while the chat reconnects. A take ended because the chat went out of view only lands in the box. */
  const sendVoice = (said: string, how: VoiceHow = "send") => {
    const text = [draft.trim(), said].filter(Boolean).join(" ");
    setDraft(text);
    if (how === "send") submit(text);
  };
  const slash = draft.startsWith("/") && !draft.includes(" ") && !draft.includes("\n") && menuShut !== draft;
  const matches = useMemo(() => (slash ? commands.filter((c) => c.name.startsWith(draft.slice(1))).slice(0, 8) : []), [slash, draft, commands]);
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (matches.length) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        setPick((i) => (i + (e.key === "ArrowDown" ? 1 : matches.length - 1)) % matches.length);
        return;
      }
      if (e.key === "Tab" || (e.key === "Enter" && !e.shiftKey && draft.slice(1) !== matches[pick]?.name)) {
        e.preventDefault();
        setDraft(`/${matches[pick % matches.length].name} `);
        return;
      }
    }
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit();
    }
    // QA #5 (A0, 3 Oct): Esc with a menu or popover open closes that, never stops the agent.
    if (e.key === "Escape" && matches.length) {
      e.preventDefault();
      setMenuShut(draft);
      return;
    }
    if (e.key === "Escape" && state !== "idle" && ![...document.querySelectorAll("[role=menu], [role=listbox], [role=dialog]")].some((m) => m.getClientRects().length)) sendRaw({ t: "interrupt" });
  };

  // Finished turns get a context without the clock, so TurnView's memo holds and they never redraw; only turns with
  // something still running get the ticking one. Before, a fresh ctx carrying `now` every second redrew every turn of
  // a working agent's chat each second (P0 2 Oct: the app's WebKit churned ~1 GB a minute with Agent Zero's chat open).
  const still = useMemo<Ctx>(() => ({ lifecycle: lifecycle.current, children: chat.children, taskByTool, now: 0, onOpen: id => { const task = taskByTool.get(id); if (task?.hostName) window.dispatchEvent(new CustomEvent("siso-open-split", { detail: { name: task.hostName } })); else setOpenAgent(id); }, send: sendRaw }), [chat.children, taskByTool, sendRaw]);
  const ctx = useMemo<Ctx>(() => ({ ...still, now }), [still, now]);
  // R1.20b: a terminal agent's chat (and a resumed host chat) has none of a sub-agent's steps; the node reads its own file.
  const [subFile, setSubFile] = useState<{ id: string; items: Item[] } | null>(null);
  const liveSub = openAgent ? chat.children.get(openAgent) : undefined;
  useEffect(() => {
    if (!openAgent || liveSub?.length) return;
    let alive = true;
    const load = () => fetch(`/api/agents/${encodeURIComponent(agentId)}/subagents/${encodeURIComponent(openAgent)}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { parent: string; events: Ev[] } | null) => { if (alive && d) setSubFile({ id: openAgent, items: buildChat(d.events, {}, false).children.get(d.parent) ?? [] }); })
      .catch(() => {});
    const stop = every(() => void load(), 5000);
    return () => { alive = false; stop(); };
  }, [openAgent, agentId, !!liveSub?.length]);
  const subItems = liveSub?.length ? liveSub : subFile?.id === openAgent ? subFile.items : [];
  const open = openAgent ? { items: subItems, task: taskByTool.get(openAgent), call: findCall(events, openAgent) } : null;
  // R1.19 (SPEC-CHAT-HUD §4): a sub-agent opens in place of the chat; Esc returns at the same scroll, ⌥← ⌥→ step.
  // R1.19 (23:2x: "there's like a cutoff at the bottom ... text doesn't go behind it"): the rim floats over the list's
  // bottom; the list keeps its last message clear of it by the composer's own height, kept in --ab-composer-h.
  // Drag the rim's top edge to make the box taller (4 Oct: "you should be able to drag to make the hud taller the chat
  // taller"): remembered per chat; double-click or a drag back under two lines returns to the two-line default.
  const tallKey = `agent-base:composer-h:${agentId}`;
  const [tall, setTall] = useState<number | null>(() => { try { const v = Number(localStorage.getItem(tallKey)); return Number.isFinite(v) && v > 0 ? v : null; } catch { return null; } });
  const twoLines = () => { const el = box.current; if (!el) return 52; const css = getComputedStyle(el); return 2 * parseFloat(css.lineHeight) + parseFloat(css.paddingTop) + parseFloat(css.paddingBottom); };
  const keepTall = (h: number | null) => { setTall(h); try { if (h) localStorage.setItem(tallKey, String(Math.round(h))); else localStorage.removeItem(tallKey); } catch { /* Size still applies in this view. */ } };
  const sizeTo = (h: number) => { const min = twoLines(); keepTall(h < min + 6 ? null : Math.min(h, window.innerHeight * 0.6)); };
  const stopResize = useRef<(() => void) | null>(null);
  // A drag can lose its pointer-up when the chat is hidden/evicted or the window
  // loses focus. Release its window handlers and the render state they capture.
  useEffect(() => () => { stopResize.current?.(); }, [agentId, agentKey, active, onScreen]);
  const grab = (e: { button: number; clientY: number; preventDefault(): void }) => {
    const el = box.current;
    if (!el || e.button !== 0 || !active || !onScreen) return;
    e.preventDefault();
    stopResize.current?.();
    const y0 = e.clientY, h0 = el.clientHeight;
    const move = (m: PointerEvent) => sizeTo(h0 + (y0 - m.clientY));
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      window.removeEventListener("blur", up);
      if (stopResize.current === up) stopResize.current = null;
    };
    stopResize.current = up;
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    window.addEventListener("blur", up);
  };
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const cap = twoLines();
    if (tall) { el.style.height = `${Math.max(cap, tall)}px`; return; }
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, cap)}px`;
  }, [draft, tall]);
  const writing = !!tall && tall > window.innerHeight * 0.45;
  const spaceHold = useRef(0);
  useEffect(() => {
    const cancelPendingHold = () => {
      if (spaceHold.current > 0) {
        window.clearTimeout(spaceHold.current);
        spaceHold.current = 0;
      }
    };
    window.addEventListener("blur", cancelPendingHold);
    return () => {
      window.removeEventListener("blur", cancelPendingHold);
      cancelPendingHold();
    };
  }, [agentId, agentKey, active, onScreen]);
  // While its mic listens, the rim wears the voice colour (its own state; the typing glow is untouched).
  const [voicePhase, setVoicePhase] = useState("idle");
  useEffect(() => {
    const on = (e: Event) => { const d = (e as CustomEvent<{ to?: string; phase?: string }>).detail; if (d?.to === agentId && d.phase) setVoicePhase(d.phase); };
    window.addEventListener("siso-mic-phase", on);
    return () => window.removeEventListener("siso-mic-phase", on);
  }, [agentId]);
  const mainEl = useRef<HTMLDivElement>(null), composerEl = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const c = composerEl.current, m = mainEl.current;
    if (!c || !m) return;
    const ro = new ResizeObserver(() => m.style.setProperty("--ab-composer-h", `${Math.ceil(c.getBoundingClientRect().height)}px`));
    ro.observe(c);
    return () => ro.disconnect();
  }, []);
  const agentCalls = useMemo(() => settled.turns.flatMap((t) => [...t.work, ...t.answer]).flatMap((it) => (it.k === "agent" ? [it.call] : [])), [settled.turns]);
  // ⌫ in the HUD's picker (R1.19): stop that sub-agent the way its fan-out row's ■ Stop does (R1.20c).
  const stopRef = useRef<(toolUseId: string) => void>(() => {});
  stopRef.current = (toolUseId) => {
    const call = agentCalls.find((c) => c.id === toolUseId);
    const stopId = taskByTool.get(toolUseId)?.id ?? call?.bg ?? shells.find(s => s.id === toolUseId)?.id;
    if (stopId) sendRaw({ t: "stop_task", id: stopId, name: call?.summary });
    else setHint("That sub-agent can't be stopped from here (it isn't a background task); Esc stops the whole turn.");
  };
  useEffect(() => {
    const stop = (e: Event) => {
      const d = (e as CustomEvent<{ agentId?: string; toolUseId?: string }>).detail;
      if (d?.agentId === agentId && d.toolUseId) stopRef.current(d.toolUseId);
    };
    if (!active) return;
    window.addEventListener("siso-chat-stop", stop);
    return () => window.removeEventListener("siso-chat-stop", stop);
  }, [agentId, active]);
  const working = state !== "idle";
  // The artifacts shelf reads what this chat's replies linked to (ui-hub VISION §7A).
  const replyTexts = useMemo(() => settled.turns.flatMap((t) => [...t.work, ...t.answer].flatMap((i) => (i.k === "said" && !i.live ? [i.text] : []))), [settled.turns]);
  const outputLogs = useMemo(() => suppliedToolOutputs(settled.turns), [settled.turns]);
  const completedResults = useMemo(() => resultReceipts(events), [events]);
  const bankScope = `${agentId}:${deliverySession ?? 'history'}`;
  const inspectOutput = useCallback((id: string) => setInspectRequest(previous => ({ scope: bankScope, id, revision: (previous?.revision ?? 0) + 1 })), [bankScope]);
  const lastTurn = chat.turns.at(-1);
  const canvasPreview = useMemo(() => lastReadReply(chat.turns, connected ? deliverySession : null), [chat.turns, connected, deliverySession]);
  // t-0270: with the speaker on, the open chat reads each reply aloud as it finishes.
  useSpeakReplies(active && !ended, lastTurn && { key: lastTurn.key, done: lastTurn.done && !working, text: lastTurn.answer.flatMap((i) => (i.k === "said" && !i.live ? [i.text] : [])).join("\n") });
  // Background events fold into quiet lines between his messages and the agent's replies (Screen 14).
  const blocks = useMemo(() => quietRuns(chat.turns, from), [chat.turns, from]);
  // The live line, the CLI's way: `✻ Mulling… (40s · ↓ 2.2k tokens · thinking more)`, in a slot that never unmounts.
  const current = working && lastTurn ? runningCall(lastTurn.work) : undefined;
  const thinkingIds = Object.keys(thinking);
  for (const id of thinkingIds) thinkStart.current[id] ??= now;
  const thinkingFor = thinkingIds.length ? now - Math.min(...thinkingIds.map((id) => thinkStart.current[id])) : null;
  const elapsed = lastTurn?.me?.at ? now - lastTurn.me.at : 0;
  const task = lastTurn ? activeTask(lastTurn.work) : undefined;
  // An SDK seat's usage comes at each message's end: between, the words and thinking streaming in count at ~4
  // characters a token, and the number never steps back within a turn (R1.19, 23:2x "↓ 0 tokens").
  const streamed = useMemo(() => [...Object.values(partial), ...Object.values(thinking)].reduce((n, t) => n + t.length, 0), [partial, thinking]);
  const outShown = useRef(0), outTurn = useRef<string | undefined>(undefined);
  if (outTurn.current !== lastTurn?.key) (outTurn.current = lastTurn?.key), (outShown.current = 0);
  const liveOut = working ? Math.max(outShown.current, outTokens + Math.round(streamed / 4)) : 0;
  outShown.current = liveOut;
  // The halo rim's live line (R1.19, t-0205): one duration and the tokens written this turn, both ticking; the current
  // step moves to the └ line under it, without a clock; sub-agents are counted only by the HUD's faces pill.
  const parts: ReactNode[] = [
    <b key="t">{fmtDuration(elapsed)}</b>,
    <span key="k">↓ <b>{fmtTokens(liveOut)}</b> tokens</span>,
    state === "blocked" ? "waiting for you" : !current && thinkingFor !== null ? thinkingWord(thinkingFor) : null,
  ].filter(Boolean);
  const status: ReactNode = working ? (
    <div className="siso-chat__working" key="live-line" data-testid="live-line">
      <span className="siso-chat__spark" aria-hidden>
        ✻
      </span>
      <span className="siso-chat__verb">{task ?? liveVerb(lastTurn?.key ?? agentId, elapsed)}…</span>
      <span className="siso-chat__doing">({parts.map((p, i) => <Fragment key={i}>{i > 0 && " · "}{p}</Fragment>)})</span>
      <span className="siso-chat__hint">esc to stop</span>
    </div>
  ) : null;
  const stepArg = current ? (current.input?.command || current.input?.description || current.summary || "").replace(/\s+/g, " ") : "";
  // The bar narrates while it works (ui-hub ideas round 2 #1): the empty input shows the step it is on, so his eyes can
  // stay on the bar; typing replaces it.
  const narration = current ? `${current.name} ${stepArg}`.trim().slice(0, 90) + (stepArg.length > 80 ? "…" : "") + " · type to add" : task ? `${task}… · type to add` : "Message while it works…";
  // The chat header reads this chat's live state from here, so the top bar and the input bar never disagree.
  const liveStep = current ? `${current.name} ${stepArg}`.trim().slice(0, 90) : task ?? "";
  useEffect(() => publishLive(agentId, { sleep: sleepView ? sleepView.waking ? "waking" : "asleep" : null, state, step: working ? liveStep : "", turnAt: lastTurn?.me?.at ?? null, preview: canvasPreview }), [agentId, state, working, liveStep, lastTurn?.me?.at, canvasPreview, sleepView]);
  useEffect(() => () => publishLive(agentId, null), [agentId]);
  const step: ReactNode = !working ? null : current ? (
    <span data-testid="step-line">└ <i>{current.name}</i> {stepArg}</span>
  ) : (
    <span data-testid="step-line">└ Tip: type while it works; your message goes in at its next step</span>
  );

  return (
    <PeopleCtx.Provider value={people}>
    <ChatFindQuery.Provider value={findOpen ? findQuery : ''}>
    <div className="siso-chat" data-testid="chat-view" data-agent-id={agentId} data-connected={connected ? "1" : "0"} style={accent ? ({ "--crm-brand-rgb": accent } as CSSProperties) : undefined}>
      <div className={`siso-chat__main${writing ? " is-writing" : ""}`} ref={mainEl}>
        {findOpen && <ChatFind query={findInput} onQuery={setFindInput} count={findResults.length} index={matchIndex} pending={more && !searchFailed} failed={searchFailed} onRetry={() => { olderAt.current.asked = false; setSearchFailed(false); setOlderTick(n => n + 1); }} onStep={stepFind} onClose={closeFind} match={match} />}
        <ChatOutline rows={outlineRows} current={currentTurn} onJump={jumpTo} />
        <div
          ref={list}
          className="siso-chat__list"
          data-ab-comp="chat"
          tabIndex={0}
          aria-label="Conversation thread"
          // Only his own scrolling (wheel, touch, keys, the scrollbar) lets go of the bottom. Scroll events alone also
          // fire as a busy agent's content grows, and read as "scrolled up": the chat stopped following and kept every
          // new turn on screen (P0 2 Oct soak: 33 → 456 turns, +170 MB in 3 min).
          onWheel={(e) => e.deltaY < 0 && (userAt.current = Date.now())}
          onTouchMove={() => (userAt.current = Date.now())}
          onPointerDown={() => (userAt.current = Date.now())}
          onKeyDown={(e) => ["PageUp", "ArrowUp", "Home"].includes(e.key) && (userAt.current = Date.now())}
          onScroll={(e) => {
            const el = e.currentTarget;
            const near = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
            if (near && !findOpen) stick.current = true;
            else if (Date.now() - userAt.current < 1000) stick.current = false;
            if (away === stick.current) setAway(!stick.current);
            if (el.scrollTop < 400 && !stick.current) loadOlder();
            scheduleMeasure();
          }}
        >
          <div ref={col} className="siso-chat__col">
            {chat.turns.length === 0 && <p className="siso-chat__empty">{connected ? "Say something. / for commands." : "Connecting to the chat…"}</p>}
            {(from > 0 || more) && (
              <button type="button" className="siso-chat__older" onClick={loadOlder}>
                {from > 0 ? `${from} earlier ${from === 1 ? "turn" : "turns"}` : "Earlier turns"}
              </button>
            )}
            {deliverySession && events.length > 0 && <RecordedSessionDisclosure key={deliverySession} sessionId={deliverySession} events={events} owner={{ name: agentName || agentKey, project: people[agentKey.toUpperCase()]?.project }} onOpen={() => { stick.current = false; }} />}
            {blocks.map((b) => {
              if (b.k === "quiet") return <QuietRun key={b.key} events={b.events} ctx={still} index={b.i} />;
              const t = b.turn;
              const last = b.i === chat.turns.length - 1;
              return <TurnView key={`${bankScope}:${t.key}`} ownerName={agentName ?? agentId} receipts={completedResults} boundary={recovery.response !== 'complete' && recovery.boundary?.turnKey === t.key ? recovery.boundary : null} onInspectOutput={inspectOutput} turn={t} ctx={last || ticking(t, taskByTool) ? ctx : still} live={working && last} isLast={last} index={b.i} />;
            })}
            {deliverySession && <CodexWorkerFlights key={`${agentId}:${deliverySession}`} agentId={agentId} session={deliverySession} active={active && connected} />}
            <DeliveryEvidence agentKey={agentKey} session={deliverySession} active={active && connected} />
            {/* The live line is the transcript's last item, as in Claude Code: it scrolls with the messages and sits just
                above the input, never inside it (Shaan 3 Oct 01:10: "it's supposed to be ... the bottom of the chat where
                it's outputting like the way Claude Code does it"). */}
            {working && (
              <div className="siso-chat__live" data-testid="live-slot">
                {status}
                {step && <div className="siso-chat__livestep">{step}</div>}
              </div>
            )}
          </div>
        </div>
        {open && <InPlace open={open} id={openAgent!} ctx={ctx} now={now} calls={agentCalls} onPick={setOpenAgent} send={sendRaw} />}
        <ChatMinimap ref={minimap} turns={chat.turns} marks={marks} jumpTo={jumpTo} />
        <div className="siso-chat__composer" ref={composerEl} data-voice={voicePhase === "listening" || voicePhase === "starting" ? "on" : undefined}>
          <RecoveryStrip recovery={recovery} memoryOnly={!!persistenceError} draft={draft} onDraft={text => { setDraft(text); box.current?.focus(); }} />
          {sleepView && <AsleepLine sleep={sleepView} onKeepAwake={() => sendRaw({ t: "keep_awake", value: true })} />}
          {away && (
            <button type="button" className="siso-chat__jump" onClick={toBottom} aria-label="Jump to the newest">
              <ArrowDownIcon size={14} />
              {fresh > 0 && <span>{fresh} new</span>}
            </button>
          )}
          {ended ? (
            <p className="siso-chat__ended" data-testid="ended-note">Ended · read-only. This agent has left herdr; its chat is kept here.</p>
          ) : agentId.startsWith("codexapp-") ? (
            <p className="siso-chat__ended" data-testid="codexapp-note">Codex app chat · read-only here. It follows the app live; reply in the Codex app.</p>
          ) : (<>
          {questionRequests.map(r => <QuestionCard key={r.hostInstance + r.id} request={r} draft={draftForQuestion(r)} connected={connected && questionCanAnswer} onChange={d => setQuestionDrafts(v => ({ ...v,[r.id]:d }))} onSubmit={dismiss => submitQuestion(r,dismiss)} />)}
          {persistenceError && <p role="status" className="siso-chat__hint" data-testid="draft-storage-warning">
            {persistenceError !== "unavailable" ? "Saved draft could not be read and was left untouched. " : "Draft could not be saved. "}
            Your current text and attachments are kept in this window only. Copy your text and keep the original files before closing or reloading.
            <button type="button" onClick={retrySave}>Retry saving draft</button>
          </p>}
          {questionNotice && <p role="status" className="siso-chat__hint">{questionNotice}</p>}
          <QuestionRecoveryHistory snapshot={questionRecovery} connected={connected} />
          {queue && caps && <QueuedPrompts snapshot={queue} capabilities={caps} connected={connected} busy={queueBusy} onCommand={queueCommand} />}
          {pending.length > 0 && (
            <div className="siso-chat__queued siso-chat__pending" aria-label="Sending" aria-live="polite">
              {pending.map((p) => (
                <div key={p.key} className={`is-${p.status}`} data-testid="pending-row">
                  <span>{p.status === "sending" ? "Sending" : p.status === 'unknown' ? 'Delivery not known' : p.status === "sent" ? (working ? "Sent · next step" : "Sent") : "Not sent"}</span>
                  <em title={p.note}>{p.text || `${p.images.length} image${p.images.length === 1 ? "" : "s"}`}</em>
                  {p.status === "failed" && (!recovery.deliveries[p.key] || recovery.deliveries[p.key].session === recovery.session) && (
                    <button type="button" aria-label="Retry" title={p.note ? `Retry · ${p.note}` : "Retry"} onClick={() => connected && deliver(p.text, p.images, p.key)}>
                      <RotateCwIcon size={12} />
                    </button>
                  )}
                  {p.status === "failed" && (
                    <button
                      type="button"
                      aria-label="Take back"
                      title="Take back into the box"
                      onClick={() => {
                        setPending((v) => v.filter((x) => x.key !== p.key));
                        if (!draft.trim()) setDraft(p.text);
                        box.current?.focus();
                      }}
                    >
                      <XIcon size={12} />
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
          {hint && <p className="siso-chat__hint" role="status">{hint}</p>}
          {!queue && chat.queued.length > 0 && (
            <div className="siso-chat__queued" aria-label="Queued messages">
              {chat.queued.map((q) => (
                <div key={q.id} data-testid="queued-row">
                  <span>Queued</span>
                  <em>{q.text}</em>
                  {/* A terminal agent's queue lives in its pane: it reads the line at its next step, and only the pane can take it back. */}
                  {!q.fixed && (
                    <button
                      type="button"
                      aria-label="Take back"
                      title="Take back into the box (before Claude reads it)"
                      onClick={() => {
                        if (takebacks.current.has(q.id)) return;
                        takebacks.current.set(q.id, q.text);
                        sendRaw({ t: "unqueue", id: q.id });
                      }}
                    >
                      <XIcon size={12} />
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
          {(images.length > 0 || uploading > 0 || failedImages.length > 0) && (
            <div className="siso-chat__context-attach" aria-label="Images to send">
              <ContextStack key={bankScope} variant="strip" thumbOf={source => source.kind === 'image' && source.id.startsWith('image:') ? `/api/uploads/${encodeURIComponent(source.title)}` : null} sources={contextSources} selectedId={contextOpen} openId={contextOpen}
                expanded={contextExpanded} onExpandedChange={setContextExpanded} onInspect={setContextOpen} onClose={() => setContextOpen(null)} paused={!active}
                onRemove={id => { if (id.startsWith('image:')) setImages(v => v.filter(im => `image:${im.name}` !== id)); else if (!uploading) setFailedImages(v => v.filter(im => `failed:${im.id}` !== id)); if (contextOpen === id) setContextOpen(null); }}
                renderDetail={source => source.state === 'ready' ? <img className="cs-upload-preview" src={`/api/uploads/${encodeURIComponent(source.title)}`} alt={source.title} /> : null} />
              {failedImages.map((im) => (
                <div key={im.id} role="alert" data-testid="upload-error" className="flex max-w-full flex-wrap items-center gap-2 rounded-lg border border-red-400/40 px-2 py-1 text-xs text-red-300">
                  <span className="min-w-0 break-all">{im.file.name} · Didn't upload: retry or remove</span>
                  <button type="button" aria-label={`Retry upload ${im.file.name}`} style={{ position: "static", width: "auto", borderRadius: 4, padding: "0 4px" }} disabled={uploading > 0} onClick={() => uploadImage(im.file, im.id)}>Retry</button>
                  <button type="button" aria-label={`Remove failed image ${im.file.name}`} style={{ position: "static", width: "auto", borderRadius: 4, padding: "0 4px" }} disabled={uploading > 0} onClick={() => setFailedImages((v) => v.filter((x) => x.id !== im.id))}>Remove</button>
                </div>
              ))}
              {uploading > 0 && <em>Adding…</em>}
            </div>
          )}
          <ArtifactShelf key={bankScope} agentId={bankScope} texts={replyTexts} outputs={outputLogs} onOpen={openLink} paused={!active} inspectRequest={inspectRequest?.scope === bankScope ? inspectRequest : null} />
          <ChatRim working={working} accent={accent} hud={hud} acceptedReceipt={acceptedReceipt}>
          {matches.length > 0 && (
            <div className="siso-chat__menu" role="listbox" aria-label="Commands">
              {matches.map((c, i) => (
                <button
                  key={c.name}
                  type="button"
                  role="option"
                  aria-selected={i === pick % matches.length}
                  className={i === pick % matches.length ? "is-on" : undefined}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    setDraft(`/${c.name} `);
                    box.current?.focus();
                  }}
                >
                  <b>/{c.name}</b>
                  <span>{c.description}</span>
                </button>
              ))}
            </div>
          )}
            <div className="siso-chat__grab" role="separator" aria-orientation="horizontal" aria-label="Drag to resize the message box" title="Drag to resize · double-click to reset · ⌘⇧↑ ⌘⇧↓" tabIndex={0} data-testid="composer-grab"
              onPointerDown={grab} onDoubleClick={() => keepTall(null)}
              onKeyDown={(e) => { if (!(e.metaKey && e.shiftKey) || (e.key !== "ArrowUp" && e.key !== "ArrowDown")) return; e.preventDefault(); const h = box.current?.clientHeight ?? twoLines(); sizeTo(h + (e.key === "ArrowUp" ? 1 : -1) * 2 * parseFloat(getComputedStyle(box.current!).lineHeight)); }} />
            <div
              className="siso-chat__inputrow"
              onDragOver={(e) => {
                if (e.dataTransfer.types.includes("Files")) e.preventDefault();
              }}
              onDrop={(e) => {
                if (!e.dataTransfer.files.length) return;
                e.preventDefault();
                e.stopPropagation();
                addImages(e.dataTransfer.files);
              }}
            >
              <button type="button" className="siso-chat__clip" aria-label="Add an image" title="Add an image (or paste or drop one)" onClick={() => filePick.current?.click()}>
                <PaperclipIcon size={15} />
              </button>
              <PromptLibrary agentKey={agentKey} agentName={agentName ?? people[agentId]?.name ?? 'this agent'} draft={draft} onInsert={text => {
                setDraft(current => current.trim() ? `${current}\n\n${text}` : text);
                // Insert only. His existing words and attachments stay; Send remains his action.
                requestAnimationFrame(() => box.current?.focus());
              }} />
              <input
                ref={filePick}
                type="file"
                accept="image/png,image/jpeg,image/gif,image/webp"
                multiple
                hidden
                onChange={(e) => {
                  if (e.target.files) addImages(e.target.files);
                  e.target.value = "";
                }}
              />
              <textarea
                onPaste={(e) => {
                  const files = [...e.clipboardData.files].filter((f) => f.type.startsWith("image/"));
                  if (files.length) {
                    e.preventDefault();
                    addImages(files);
                  }
                }}
                ref={box}
                rows={1}
                value={draft}
                placeholder={!connected ? "Connecting…" : working ? narration : "Message, or / for commands"}
                onChange={(e) => {
                  setDraft(e.target.value);
                  setPick(0);
                }}
                onKeyDown={(e) => {
                  // Hold Space in an empty box to talk; let go to send (ideas r2 #6). A tap does nothing (an empty box needs no space).
                  if (e.code === "Space" && !draft && !images.length && !working && !e.metaKey && !e.ctrlKey && !e.altKey) {
                    e.preventDefault();
                    if (!e.repeat && !spaceHold.current) spaceHold.current = window.setTimeout(() => { spaceHold.current = -1; window.dispatchEvent(new CustomEvent("siso-mic-hold", { detail: { to: agentId, press: "down" } })); }, 350);
                    return;
                  }
                  if (!e.repeat) onKey(e);
                }}
                onKeyUp={(e) => {
                  if (e.code !== "Space" || !spaceHold.current) return;
                  if (spaceHold.current > 0) clearTimeout(spaceHold.current);
                  else window.dispatchEvent(new CustomEvent("siso-mic-hold", { detail: { to: agentId, press: "up" } }));
                  spaceHold.current = 0;
                }}
                aria-label="Message"
              />
              {draft.trim() || images.length || uploading || failedImages.length ? (
                <button type="button" className="siso-chat__send" aria-label="Send" title={working ? "Send into the current turn · Enter" : "Send · Enter"} onClick={() => submit()}><ArrowUpIcon size={16} /></button>
              ) : working ? (
                // The mic stays while it works: a voice note goes into the current turn like a typed one.
                <><MicButton onText={sendVoice} to={agentId} active={active} readAloudMenu />
                <button type="button" className="siso-chat__send is-stop" aria-label="Stop" title="Stop · Esc" onClick={() => sendRaw({ t: "interrupt" })}><SquareIcon size={12} /></button></>
              ) : <MicButton onText={sendVoice} to={agentId} active={active} readAloudMenu />}

            </div>
          </ChatRim>
          </>)}
        </div>
      </div>
    </div>
    </ChatFindQuery.Provider>
    </PeopleCtx.Provider>
  );
}

/**
 * A sub-agent's transcript in place of the chat (R1.19, SPEC-CHAT-HUD §4; 20:45: "you can click the agents inside that
 * pain and see what they're running"), under a cyan bar: ← · Main chat ▸ face NAME model · time · tokens · Stop · Esc.
 * The chat stays mounted underneath, so Esc returns at the same scroll; the composer stays addressed to the main agent.
 */
function InPlace({ open, id, ctx, now, calls, onPick, send }: { open: { items: Item[]; task?: Task; call?: { summary: string; done?: boolean } }; id: string; ctx: Ctx; now: number; calls: Call[]; onPick: (id: string | null) => void; send: (m: unknown) => void }) {
  const meta = useSubagentMeta(id);
  const call = calls.find((c) => c.id === id);
  const at = calls.findIndex((c) => c.id === id);
  useEffect(() => {
    const key = (e: globalThis.KeyboardEvent) => {
      const typing = (e.target as HTMLElement | null)?.closest?.("textarea, input");
      if (e.key === "Escape" && !typing) (e.preventDefault(), onPick(null));
      else if (e.altKey && (e.key === "ArrowLeft" || e.key === "ArrowRight") && calls.length > 1 && at >= 0) {
        e.preventDefault();
        onPick(calls[(at + (e.key === "ArrowRight" ? 1 : calls.length - 1)) % calls.length].id);
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [calls, at, onPick]);
  const task = open.task;
  const running = task ? task.status === "running" || task.status === "pending" : call?.bg ? !call.end : open.call?.done === undefined;
  const name = meta?.name ?? (task?.kind && task.kind !== "task" ? task.kind : "Sub-agent");
  const model = meta?.model?.replace(/^claude-/, "").split("-")[0];
  const start = task?.startedAt ?? (meta?.start ? Date.parse(meta.start) : call?.at);
  const end = running ? null : (task?.endedAt ?? call?.end?.at ?? (meta?.end ? Date.parse(meta.end) : null));
  const time = start && (end ?? now) ? fmtDuration(Math.max(0, (end ?? now) - start)) : null;
  const tokens = task?.tokens ?? meta?.tokens ?? null;
  const stopId = task?.id ?? call?.bg;
  return (
    <section className="ab-inplace" aria-label={`Sub-agent ${name}`} data-testid="inplace-view">
      <div className="ab-inplace__bar">
        <button type="button" className="siso-subhead__back" aria-label="Back to the chat" title="Back to the chat · Esc" onClick={() => onPick(null)}>
          <ArrowLeftIcon />
        </button>
        <span className="ab-inplace__crumb">Main chat ▸</span>
        <AgentFace name={name} project={name} status={running ? "working" : "done"} size={18} />
        <b className="ab-inplace__name">{name}</b>
        {model && <span className={`ab-fan__model is-${model}`}>{model}</span>}
        <span className="ab-inplace__meta">{[time, tokens ? fmtTokens(tokens) : null, calls.length > 1 && at >= 0 ? `${at + 1} of ${calls.length} · ⌥← ⌥→` : null].filter(Boolean).join(" · ")}</span>
        {running && stopId && (
          <button type="button" className="ab-inplace__stop" onClick={() => send({ t: "stop_task", id: stopId, name: open.call?.summary })}>
            Stop
          </button>
        )}
        <kbd className="ab-inplace__esc">Esc</kbd>
      </div>
      <div className="siso-chat__sidelist">
        {(meta?.spec || open.call?.summary) && <p className="ab-inplace__brief"><span>Brief</span> {meta?.spec || open.call?.summary}</p>}
        {open.items.length ? <Items items={open.items} live={open.call?.done === undefined} ctx={ctx} /> : <p className="siso-chat__empty is-side">Nothing from this sub-agent yet.</p>}
        {/* The task's summary repeats the sub-agent's last words; show it only when the transcript has none. */}
        {open.task?.summary && !open.items.some((it) => it.k === "said") && <Said text={open.task.summary} answer />}
        <p className="ab-inplace__note">Messages in the box below go to the main agent; it can pass them on.</p>
      </div>
    </section>
  );
}

function findCall(events: Ev[], id: string) {
  const e = events.find((x) => x.t === "tool" && x.id === id);
  return e && e.t === "tool" ? { summary: e.summary, done: events.some((x) => x.t === "tool_done" && x.id === id) ? true : undefined } : undefined;
}
