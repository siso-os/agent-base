import { ChevronDownIcon, ChevronRightIcon, CopyIcon, ExpandIcon, SquareIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Agent } from "../../lib/agents";
import { accentRgb } from "../../lib/face";
import { duration, fmtTokens } from "../SubagentRow";
import { SubFace, modelChip, subName, subTime, subTone, type SubRowData } from "./SubRow";
import "../Composer.css";
import { clock as onClock } from "../../lib/poll";
import "./panel.css";

type Ev = { t: string; id?: string; name?: string; summary?: string; input?: { path?: string; command?: string }; ok?: boolean; out?: string; text?: string; at?: number | string };
type Detail = { events: Ev[]; brief: string; usage?: { in: number; out: number; cacheRead: number; cacheWrite: number } };
type Item = { k: "text"; text: string } | { k: "think"; text: string } | { k: "tools"; tools: Ev[] } | { k: "fail"; tool: Ev; out: string };

const clock = (at: string | null) => (at ? new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(at)) : "—");
const PLURAL: Record<string, [string, string]> = { Bash: ["shell command", "shell commands"], Read: ["file read", "files read"], Edit: ["edit", "edits"], Write: ["file written", "files written"], Grep: ["search", "searches"], Glob: ["search", "searches"], WebFetch: ["page fetched", "pages fetched"], WebSearch: ["web search", "web searches"] };
/** "Ran 4 shell commands, 2 files read" for a run of tool calls with no words between them. */
function runLabel(tools: Ev[]) {
  const n = new Map<string, number>();
  for (const t of tools) n.set(t.name ?? "tool", (n.get(t.name ?? "tool") ?? 0) + 1);
  return [...n].map(([name, c]) => `${c} ${PLURAL[name]?.[c === 1 ? 0 : 1] ?? `${name} ${c === 1 ? "call" : "calls"}`}`).join(", ");
}
/** The transcript's shape: words stay, thinking is one line, a run of tools folds, a failed tool shows its first line. */
function itemsOf(events: Ev[]): Item[] {
  const done = new Map(events.filter((e) => e.t === "tool_done").map((e) => [e.id, e]));
  const out: Item[] = [];
  for (const e of events) {
    if (e.t === "text" && e.text?.trim()) out.push({ k: "text", text: e.text });
    else if (e.t === "thinking" && e.text?.trim()) out.push({ k: "think", text: e.text.trim().split("\n", 1)[0] });
    else if (e.t === "tool") {
      const res = done.get(e.id);
      if (res && res.ok === false) out.push({ k: "fail", tool: e, out: String(res.out ?? "").split("\n", 1)[0] });
      else {
        const last = out.at(-1);
        if (last?.k === "tools") last.tools.push(e);
        else out.push({ k: "tools", tools: [e] });
      }
    }
  }
  return out;
}
/** What it made: files it wrote or edited, and pages it posted. */
function madeOf(events: Ev[]) {
  const seen = new Map<string, string>();
  for (const e of events) {
    if (e.t !== "tool") continue;
    if ((e.name === "Write" || e.name === "Edit") && e.input?.path) seen.set(e.input.path, e.name === "Write" ? "Wrote" : "Edited");
    if (e.name === "Bash" && /console-post|\bpublish\b/.test(e.summary ?? "")) seen.set(`page:${e.id}`, "Posted a page");
  }
  return [...seen].map(([path, verb]) => ({ path: path.startsWith("page:") ? "" : path, verb }));
}

function Md({ text }: { text: string }) {
  return (
    <div className="siso-md ab-sv__md">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown>
    </div>
  );
}

/**
 * The sub-agent page in the panel (SPEC-PANEL-CARDS §6, option A; Shaan 3 Oct 00:05: "whatever it shows me isn't actually a
 * nice ui of the sub agent"). A header card in the halo rim (turning while it runs, resting green when done): face, NAME,
 * who sent it and when, model, a ticking status pill, Stop or Copy result, Open full, and its tools · ↑ in · ↓ out ·
 * total · failed. Then the brief, then its steps as the chat draws them (words in markdown, runs of tools folded, a failed
 * tool in red) with the live line under them; done, the result moves to the top in a green card. ⌥↑ ⌥↓ step through.
 */
export function SubagentView({ parent, id, onGo }: { parent: Agent; id: string; onGo: (key: string, title: string) => void }) {
  const [rows, setRows] = useState<SubRowData[] | null>(null);
  const [d, setD] = useState<Detail | null | "gone">(null);
  const [now, setNow] = useState(Date.now());
  const [stopping, setStopping] = useState(false);
  const [briefAll, setBriefAll] = useState(false);
  const [stepsOpen, setStepsOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const r = rows?.find((x) => x.toolUseId === id || x.id === id) ?? null;
  const running = !!r?.running;
  useEffect(() => {
    let alive = true;
    setD(null);
    setStopping(false);
    const load = () => {
      fetch(`/api/agents/${encodeURIComponent(parent.id)}/subagents`, { cache: "no-store" })
        .then((x) => (x.ok ? x.json() : Promise.reject(new Error(String(x.status)))))
        .then((x) => alive && setRows(x.rows ?? []))
        .catch(() => alive && setRows((v) => v ?? []));
      fetch(`/api/agents/${encodeURIComponent(parent.id)}/subagents/${encodeURIComponent(id)}`, { cache: "no-store" })
        .then((x) => (x.ok ? x.json() : Promise.reject(new Error(String(x.status)))))
        .then((x) => alive && setD(x))
        .catch(() => alive && setD((v) => (v && v !== "gone" ? v : "gone")));
    };
    // One sub-agent page open at a time: read it every 2.5 s while the window is visible, so its timer and tokens move
    // together (the shared 5 s poll floor is for lists).
    const poll = window.setInterval(() => !document.hidden && load(), 2500);
    load();
    const tick = onClock(() => setNow(Date.now()));
    return () => {
      alive = false;
      window.clearInterval(poll);
      tick();
    };
  }, [parent.id, id]);
  // ⌥↑ ⌥↓ step through its siblings, newest first, as the card lists them.
  const order = useMemo(() => (rows ?? []).filter((x) => !x.agentId).sort((a, b) => Number(b.running) - Number(a.running) || Date.parse(b.start ?? "") - Date.parse(a.start ?? "")), [rows]);
  const orderRef = useRef(order);
  orderRef.current = order;
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (!e.altKey || (e.key !== "ArrowUp" && e.key !== "ArrowDown")) return;
      const list = orderRef.current;
      const i = list.findIndex((x) => x.toolUseId === id || x.id === id);
      const next = list[i + (e.key === "ArrowDown" ? 1 : -1)];
      if (next) (e.preventDefault(), onGo(next.toolUseId ?? next.id, subName(next)));
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [id, onGo]);

  if (d === "gone") return <p className="ab-empty p-4">Its file is not readable from this node.</p>;
  const events = d?.events ?? [];
  const items = itemsOf(events);
  const tools = events.filter((e) => e.t === "tool").length;
  const failed = events.filter((e) => e.t === "tool_done" && e.ok === false).length;
  const result = !running ? [...events].reverse().find((e) => e.t === "text" && e.text?.trim())?.text ?? null : null;
  const made = madeOf(events);
  const step = [...events].reverse().find((e) => e.t === "tool");
  const tone = r ? subTone(r) : "done";
  const u = d?.usage;
  const copy = () => {
    if (!result) return;
    void navigator.clipboard?.writeText(result).then(() => (setCopied(true), window.setTimeout(() => setCopied(false), 1500)));
  };
  const steps = (
    <div className="ab-sv__steps" data-testid="subagent-steps">
      {!d && <p className="ab-empty">Reading its steps…</p>}
      {d && !items.length && <p className="ab-empty">No steps yet.</p>}
      {items.map((it, i) => (
        <StepItem key={i} it={it} current={running && i === items.length - 1} />
      ))}
    </div>
  );
  return (
    <div className="ab-sv" data-testid="subagent-view" data-tone={tone}>
      <div className={`siso-rim ab-rim ab-sv__head ${running ? "is-working" : "is-idle"}${tone === "done" ? " is-done" : ""}`} style={{ "--rim-hue": `rgb(${accentRgb(parent.project)})` } as CSSProperties}>
        <div className="ab-sv__who">
          {r && <SubFace r={r} project={parent.project} size={32} />}
          <div>
            <b className={r?.name ? "is-name" : undefined}>{r ? subName(r) : "Sub-agent"}</b>
            <small>
              from {parent.zero ? "Agent Zero" : parent.name} · started {clock(r?.start ?? null)}
              {r?.what && r.what !== subName(r) ? ` · ${r.what}` : ""}
            </small>
          </div>
        </div>
        <div className="ab-sv__acts">
          {r && modelChip(r) && <em className={`ab-chip is-${modelChip(r)}`}>{modelChip(r)}</em>}
          {r && (
            <span className={`ab-sv__pill is-${stopping && running ? "stopping" : tone}`} data-testid="subagent-status">
              {stopping && running ? "stopping…" : subTime(r, now)}
            </span>
          )}
          {running ? (
            <button type="button" className="ab-sv__btn is-stop" data-testid="subagent-stop" disabled={stopping} onClick={() => (window.dispatchEvent(new CustomEvent("siso-chat-stop", { detail: { agentId: parent.id, toolUseId: r?.toolUseId ?? id } })), setStopping(true))}>
              <SquareIcon size={10} /> Stop
            </button>
          ) : (
            result && (
              <button type="button" className="ab-sv__btn" onClick={copy}>
                <CopyIcon size={11} /> {copied ? "Copied" : "Copy result"}
              </button>
            )
          )}
          <button type="button" className="ab-sv__btn" title="Show it in the chat" onClick={() => window.dispatchEvent(new CustomEvent("siso-open-subagent", { detail: { id: r?.toolUseId ?? id } }))}>
            <ExpandIcon size={11} /> Open full
          </button>
        </div>
        <p className="ab-sv__meta" data-testid="subagent-meta">
          <span>
            <b>{tools}</b> tools
          </span>
          {u && (
            <>
              <span>
                ↑ <b>{fmtTokens(u.in + u.cacheRead + u.cacheWrite)}</b>
              </span>
              <span>
                ↓ <b>{fmtTokens(u.out)}</b>
              </span>
            </>
          )}
          {r && (
            <span>
              <b>{fmtTokens(r.tokens)}</b> total
            </span>
          )}
          {failed > 0 && <span className="is-bad">{failed} failed</span>}
        </p>
      </div>
      {r?.title && <section className="ab-sv__block"><h4>Goal</h4><p className="ab-fleet-hover__goal">{r.title}</p>{r.about && <p className="ab-fleet-hover__about">{r.about}</p>}{r.tickets?.map(t => <p key={t.id} className="ab-fleet-hover__about">for: {t.id} · {t.title}</p>)}</section>}
      {r?.why && <section className="ab-sv__block"><h4>Why it exists</h4><p className="ab-fleet-hover__about">{r.why}</p></section>}
      {result && (
        <section className="ab-sv__block">
          <h4>
            Result
            <button type="button" onClick={copy}>
              {copied ? "Copied" : "Copy"}
            </button>
          </h4>
          <div className="ab-sv__result" data-testid="subagent-result">
            <Md text={result} />
          </div>
        </section>
      )}
      {!running && d ? (
        <section className="ab-sv__block">
          <button type="button" className="ab-sv__fold" aria-expanded={stepsOpen} onClick={() => setStepsOpen(!stepsOpen)}>
            <h4>Steps</h4>
            <span>
              Worked {r?.start ? duration(r.start, r.end, now) : "—"} · {tools} tools
            </span>
            {stepsOpen ? <ChevronDownIcon size={12} /> : <ChevronRightIcon size={12} />}
          </button>
          {stepsOpen && steps}
        </section>
      ) : null}
      {d?.brief && (
        <section className="ab-sv__block">
          <h4>
            Brief
            {d.brief.length > 220 && (
              <button type="button" onClick={() => setBriefAll(!briefAll)}>
                {briefAll ? "Show less" : "Show all"}
              </button>
            )}
          </h4>
          <div className={`ab-sv__brief${briefAll ? " is-all" : ""}`} data-testid="subagent-brief">
            {d.brief}
          </div>
        </section>
      )}
      {(running || !d) && (
        <section className="ab-sv__block">
          <h4>
            Steps <span>{tools}</span>
          </h4>
          {steps}
        </section>
      )}
      {made.length > 0 && (
        <section className="ab-sv__block">
          <h4>Made</h4>
          {made.map((m, i) => (
            <p key={i} className="ab-sv__made">
              <i />
              <span>
                <b>{m.verb}</b> {m.path.split("/").pop()}
              </span>
              {m.path && <small>{m.path}</small>}
            </p>
          ))}
        </section>
      )}
      {running && r && (
        <div className="siso-rim ab-rim is-working ab-sv__live" data-testid="subagent-live">
          <div className="siso-chat__working">
            <span className="siso-chat__spark">✻</span> <span className="siso-chat__verb">Working…</span>{" "}
            <span className="siso-chat__doing">
              ({duration(r.start, null, now)} · ↓ {fmtTokens(u?.out ?? 0)} tokens)
            </span>
          </div>
          {step && (
            <div className="ab-rim__step">
              └ <i>{step.name}</i> {step.summary}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function StepItem({ it, current }: { it: Item; current: boolean }) {
  const [open, setOpen] = useState(false);
  if (it.k === "text")
    return (
      <div className={`ab-sv__step is-text${current ? " is-current" : ""}`}>
        <i />
        <Md text={it.text} />
      </div>
    );
  if (it.k === "think")
    return (
      <div className="ab-sv__step is-think">
        <i />
        <p>✻ {it.text}</p>
      </div>
    );
  if (it.k === "fail")
    return (
      <div className="ab-sv__step is-fail" data-testid="step-failed">
        <i />
        <p>
          <b>{it.tool.name}</b> {it.tool.summary}
          {it.out && <small>└ {it.out}</small>}
        </p>
      </div>
    );
  if (it.tools.length === 1)
    return (
      <div className={`ab-sv__step is-tool${current ? " is-current" : ""}`}>
        <i />
        <p>
          <b>{it.tools[0].name}</b> {it.tools[0].summary}
        </p>
      </div>
    );
  return (
    <div className={`ab-sv__step is-tool${current ? " is-current" : ""}`} data-testid="step-run">
      <i />
      <div>
        <button type="button" className="ab-sv__run" aria-expanded={open} onClick={() => setOpen(!open)}>
          Ran {runLabel(it.tools)} {open ? "⌄" : "›"}
        </button>
        {open ? (
          it.tools.map((t, j) => (
            <small key={j}>
              └ <b>{t.name}</b> {t.summary}
            </small>
          ))
        ) : (
          <small>└ {it.tools.map((t) => t.summary?.split(" ").slice(0, 3).join(" ")).join(" · ")}</small>
        )}
      </div>
    </div>
  );
}
