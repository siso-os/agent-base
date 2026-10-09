import { closeSync, openSync, readSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

/**
 * Chats he runs in the Codex desktop app, shown in Agent Base read-only (Shaan, 5 Oct 23:40: "I have a codex chat running
 * on the codex app ... see if we can ... load that up so I can see it or it shows somewhere"). The app holds the thread's
 * only writer (siso-host --resume is refused: "already has an active writer"), so Agent Base follows its rollout file live
 * and he replies in the app. A thread written in the last 2 h is listed; "working" while it was written in the last 20 s.
 */
export type CodexAppThread = { thread: string; file: string; name: string; title: string; cwd: string; model: string | null; started: number; lastEvent: number; working: boolean; agentBase: boolean };

const ROOT = () => process.env.AB_CODEX_HOME ?? path.join(homedir(), ".codex");
const RECENT_MS = 2 * 3600e3, WORKING_MS = 20e3;
const cache = new Map<string, { mtime: number; t: CodexAppThread | null }>();

function slice(file: string, from: number, size: number): string {
  const fd = openSync(file, "r");
  try {
    const buf = Buffer.alloc(size);
    return buf.subarray(0, readSync(fd, buf, 0, size, Math.max(0, from))).toString("utf8");
  } finally { closeSync(fd); }
}
const lines = (text: string) => text.split("\n").flatMap((l) => { try { return [JSON.parse(l)]; } catch { return []; } });
const day = (d: Date) => path.join(String(d.getFullYear()), String(d.getMonth() + 1).padStart(2, "0"), String(d.getDate()).padStart(2, "0"));

/** One rollout, read once per change: its head (who started it, the first ask) and its tail (the model now). */
function readThread(file: string, mtime: number, now: number): CodexAppThread | null {
  const head = lines(slice(file, 0, 256 * 1024));
  const meta = head.find((r) => r.type === "session_meta")?.payload;
  // His own chats only: a thread the app spawned as a sub-agent belongs to its parent.
  if (!meta?.id || meta.originator !== "Codex Desktop" || meta.thread_source === "subagent") return null;
  // The first thing he typed: a user message that is not injected context (<environment_context>, AGENTS.md, ...).
  const said = (r: any): string => r.type === "response_item" && r.payload?.type === "message" && r.payload.role === "user"
    ? (r.payload.content ?? []).map((c: any) => (c?.type === "input_text" ? String(c.text ?? "") : "")).join(" ").trim() : "";
  const ask = head.map(said).find((t) => t && !/^(<|# AGENTS\.md)/.test(t)) ?? "";
  const words = ask.replace(/\s+/g, " ").trim();
  const who = /\bYou are ([A-Z][A-Za-z0-9-]{1,24})\b/.exec(words)?.[1];
  const size = statSync(file).size;
  const tail = lines(slice(file, size - 128 * 1024, 128 * 1024));
  const model = [...tail].reverse().find((r) => r.type === "turn_context")?.payload?.model ?? head.find((r) => r.type === "turn_context")?.payload?.model ?? null;
  return {
    thread: String(meta.id),
    file,
    name: who ? `${who.toUpperCase()}-APP` : `CODEX-APP-${String(meta.id).slice(-4).toUpperCase()}`,
    title: words.slice(0, 120),
    cwd: String(meta.cwd ?? homedir()),
    model: typeof model === "string" ? model : null,
    started: Date.parse(meta.timestamp ?? "") || mtime,
    lastEvent: mtime,
    working: now - mtime < WORKING_MS,
    agentBase: /agent base/i.test(words),
  };
}

/** Codex desktop threads written in the last 2 hours (today's and yesterday's session folders). */
export function codexAppThreads(now = Date.now()): CodexAppThread[] {
  const out: CodexAppThread[] = [];
  for (const d of [new Date(now), new Date(now - 864e5)]) {
    const dir = path.join(ROOT(), "sessions", day(d));
    let names: string[] = [];
    try { names = readdirSync(dir).filter((n) => n.endsWith(".jsonl")); } catch { continue; }
    for (const n of names) {
      const file = path.join(dir, n);
      let mtime = 0;
      try { mtime = statSync(file).mtimeMs; } catch { continue; }
      if (now - mtime > RECENT_MS) continue;
      const hit = cache.get(file);
      let t = hit?.mtime === mtime ? hit.t : null;
      if (hit?.mtime !== mtime) {
        try { t = readThread(file, mtime, now); } catch { t = null; }
        cache.set(file, { mtime, t });
      }
      if (t) out.push({ ...t, working: now - t.lastEvent < WORKING_MS });
    }
  }
  if (cache.size > 200) cache.clear();
  return out.sort((a, b) => b.lastEvent - a.lastEvent);
}

export const codexAppId = (thread: string) => `codexapp-${thread}`;
export const codexAppThread = (id: string) => (id.startsWith("codexapp-") ? id.slice(9) : null);

/** The row Agent Base lists: a live Codex chat under Agent Zero (on Agent Base's card when it is about Agent Base). */
export function codexAppRow(t: CodexAppThread, machine: { machine: string; machineKey: string }) {
  return {
    id: codexAppId(t.thread), key: `codexapp/${t.thread}`, pane: "", name: t.name, title: t.title, row: "live",
    status: t.working ? "working" : "idle", since: t.started, lastEvent: t.lastEvent, tool: "codex", cwd: t.cwd, folder: "",
    ...machine, zero: false, chat: true, session: t.thread, pinned: false, pages: [], lead: "Agent Zero", hostParent: "Agent Zero",
    zeroAgent: true, domain: null, role: "Codex app chat, read-only here: reply in the Codex app",
    project: t.agentBase ? "Agent Base" : null, kind: "owner", main: true, workspace: t.agentBase ? "agent-base" : null,
    a0: false, navOwner: true, parentId: null, navParentId: null, readOnly: true,
    hud: t.model ? { model: t.model, context: null, tokensIn: null, tokensOut: null, tokensPerSecond: null, at: t.lastEvent, cachePct: null, costUsd: null, fiveHour: null, week: null } : null,
  };
}
