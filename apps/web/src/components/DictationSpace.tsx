import { useEffect, useState } from "react";
import { cn } from "@siso/shell";
import { every } from "../lib/poll";
import { ArrowUpRightIcon, CheckIcon, CopyIcon, MicIcon, SearchIcon, ShieldCheckIcon } from "lucide-react";

type Status = { owner: "agent-base" | "siso-voice"; switching: boolean; phase: string; error: string; hotkey: string; native: { registered: boolean; permission: boolean; updatedAt: number; error: string } };
type Entry = { id: string; timestamp: string; app: string; bundleId: string; text: string; cleanup: string };
async function request<T>(url: string, body?: unknown): Promise<T> {
  const response = await fetch(url, body === undefined ? undefined : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Dictation is unavailable");
  return data as T;
}
const bridge = () => (window as unknown as { __TAURI_INTERNALS__?: { invoke: (command: string, args: Record<string, unknown>) => Promise<unknown> } }).__TAURI_INTERNALS__;

export function DictationSpace({ settingsOnly = false }: { settingsOnly?: boolean }) {
  const [status, setStatus] = useState<Status | null>(null);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [total, setTotal] = useState(0);
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    let disposed = false;
    const poll = async () => {
      try {
        const [next, history] = await Promise.all([request<Status>("/api/dictation/status"), settingsOnly ? Promise.resolve(null) : request<{ entries: Entry[]; total: number }>(`/api/dictation/history?q=${encodeURIComponent(query)}`)]);
        if (!disposed) { setStatus(next); if (history) { setEntries(history.entries); setTotal(history.total); } setLoaded(true); }
      } catch (e) { if (!disposed) setError((e as Error).message); }
    };
    let stop: (() => void) | undefined;
    const debounce = window.setTimeout(() => { stop = every(() => void poll(), 5000); }, query ? 180 : 0);
    return () => { disposed = true; clearTimeout(debounce); stop?.(); };
  }, [query, settingsOnly]);
  const enabled = status?.owner === "agent-base";
  const ready = enabled && status !== null && status.native.registered && status.native.permission && Date.now() - status.native.updatedAt < 5000;
  const listening = ["recording", "starting"].includes(status?.phase || "");
  const processing = ["transcribing", "pasting"].includes(status?.phase || "");
  const label = listening ? "Listening to you" : processing ? "Putting your words to work" : ready ? "Ready when you are" : enabled ? "Waiting for desktop dictation" : "Your voice, everywhere";
  async function changeOwner(owner: "agent-base" | "siso-voice") {
    setBusy(true); setError(""); setNotice("");
    try {
      await request("/api/dictation/owner", { owner });
      setStatus(await request<Status>("/api/dictation/status"));
      setNotice(owner === "agent-base" ? "Agent Base now owns your dictation hotkey." : "SISO Voice is running again.");
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  async function copy(entry: Entry) {
    try { await navigator.clipboard.writeText(entry.text); setNotice("Copied to clipboard"); setError(""); }
    catch { setError("Clipboard access was blocked. Select the transcript to copy it."); }
  }
  async function paste(entry: Entry) {
    setError("");
    try {
      const ipc = bridge();
      if (!ipc) throw new Error("Re-paste returns to the original app from Agent Base desktop.");
      await ipc.invoke("dictation_paste", { text: entry.text, bundleId: entry.bundleId });
      setNotice(`Pasted into ${entry.app}`);
    } catch (e) { setError(String((e as Error).message || e)); }
  }
  return (
    <section data-testid="dictation-space" className="flex flex-col gap-6">
      <div className="relative overflow-hidden rounded-[20px] border border-white/[.07] bg-gradient-to-br from-white/[.045] via-transparent to-blue-400/[.025] p-5 sm:p-8">
        <div className="flex flex-col items-start gap-5 sm:flex-row sm:flex-wrap sm:items-center sm:gap-6">
          <div aria-hidden="true" className={cn("grid size-12 shrink-0 sm:size-[76px] place-items-center rounded-full border border-white/10 bg-white/[.04] shadow-[0_0_45px_rgba(100,150,255,.12)]", listening && "animate-pulse border-blue-400/50 shadow-[0_0_50px_rgba(100,150,255,.3)]")}>
            <MicIcon className={cn("size-7 text-blue-200", processing && "animate-pulse")} strokeWidth={1.4} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="mb-2 text-[10px] font-semibold uppercase tracking-[.18em] text-muted-foreground">SISO / DICTATION</div>
            <h2 className="m-0 text-[25px] font-medium tracking-[-.035em] text-foreground">{label}</h2>
            <p className="mb-0 mt-2 max-w-[520px] text-[13px] leading-relaxed text-muted-foreground">{enabled ? "Speak from any app. Your words return to the app where you started." : "Your familiar hotkey stays with SISO Voice until you move it here."}</p>
          </div>
          <span data-testid="dictation-phase" className="flex items-center gap-2 rounded-full border border-white/[.07] bg-black/15 px-3 py-1.5 text-[11px] text-muted-foreground"><span className={cn("size-1.5 rounded-full", listening ? "bg-blue-300" : enabled ? "bg-done" : "bg-muted-foreground/60")} />{listening ? "Recording" : processing ? "Transcribing" : enabled ? "Agent Base" : "SISO Voice"}</span>
        </div>
        <div className="mt-7 flex flex-wrap items-center justify-between gap-4 border-t border-white/[.06] pt-5">
          <div><div className="text-[12px] font-medium text-foreground">Dictation runs in</div><div className="mt-1 text-[11px] text-muted-foreground">One hotkey owner. Switch back whenever you need.</div></div>
          <div aria-label="Dictation runs in" className="flex rounded-[10px] border border-white/[.08] bg-black/20 p-1">
            {([['siso-voice', 'SISO Voice'], ['agent-base', 'Agent Base']] as const).map(([id, name]) => <button key={id} type="button" aria-pressed={status?.owner === id} disabled={!status || busy || status.switching} onClick={() => void changeOwner(id)} className={cn("flex items-center gap-1.5 rounded-[7px] px-3 py-2 text-[12px] transition-colors disabled:opacity-50", status?.owner === id ? "bg-white/[.09] text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}>{status?.owner === id && <CheckIcon className="size-3" />}{name}</button>)}
          </div>
        </div>
        <div className="mt-4 flex flex-wrap gap-x-6 gap-y-2 text-[11px] text-muted-foreground"><span>{status?.hotkey || "Loading hotkey…"}</span><span className="flex items-center gap-1.5"><ShieldCheckIcon className="size-3.5" />Clipboard restored after paste</span></div>
        {busy && <p role="status" className="mb-0 mt-3 text-[12px] text-blue-200">Switching the hotkey owner…</p>}
      </div>
      {(error || status?.error || status?.native.error) && <p role="alert" className="m-0 rounded-xl border border-failed/20 bg-failed/[.07] px-4 py-3 text-[12px] text-failed">{error || status?.error || status?.native.error}</p>}
      {notice && <p role="status" className="m-0 text-[12px] text-done">{notice}</p>}
      {!settingsOnly && <>
        <div className="flex flex-wrap items-center justify-between gap-3"><div><h3 className="m-0 text-[15px] font-medium text-foreground">Your dictations</h3><p className="mb-0 mt-1 text-[11px] text-muted-foreground">{total} saved in Agent Base · newest first</p></div><label className="flex w-full items-center gap-2 rounded-[10px] border border-white/[.08] bg-white/[.025] px-3 py-2 sm:w-[280px]"><SearchIcon className="size-3.5 text-muted-foreground" /><input aria-label="Search dictations" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search words or apps" className="w-full bg-transparent text-[12px] text-foreground outline-none placeholder:text-muted-foreground" /></label></div>
        {entries.length === 0 ? <div className="rounded-[16px] border border-dashed border-white/[.09] px-5 py-12 text-center"><MicIcon aria-hidden="true" className="mx-auto mb-3 size-5 text-muted-foreground/50" /><div className="text-[13px] text-foreground">{!loaded ? "Loading dictations…" : query ? "No matching dictations" : "Your next thought starts here"}</div><p className="mb-0 mt-2 text-[12px] text-muted-foreground">{query ? "Try another word or app name." : "Move dictation to Agent Base, then use your global hotkey. Every transcript will be waiting here."}</p></div> : <div className="flex flex-col gap-2">{entries.map((entry) => <article key={entry.id} data-testid="dictation-entry" className="rounded-[14px] border border-white/[.065] bg-white/[.02] px-5 py-4"><div className="mb-3 flex flex-wrap items-center justify-between gap-2"><div className="flex items-center gap-2 text-[11px] text-muted-foreground"><span className="rounded-md bg-white/[.06] px-2 py-1 text-foreground/80">{entry.app}</span><time dateTime={entry.timestamp}>{new Date(entry.timestamp).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</time>{entry.cleanup === "fallback" && <span title="Cleanup was unavailable; original transcription retained">Original text</span>}</div><div className="flex gap-1"><button aria-label={`Copy dictation from ${entry.app}`} type="button" onClick={() => void copy(entry)} className="rounded-lg p-2 text-muted-foreground hover:bg-white/[.06] hover:text-foreground"><CopyIcon className="size-3.5" /></button><button aria-label={`Re-paste into ${entry.app}`} type="button" disabled={!entry.bundleId} onClick={() => void paste(entry)} title="Return to the original app and paste" className="rounded-lg p-2 text-muted-foreground hover:bg-white/[.06] hover:text-foreground disabled:opacity-30"><ArrowUpRightIcon className="size-3.5" /></button></div></div><p className="m-0 whitespace-pre-wrap break-words text-[13px] leading-[1.7] text-foreground/90">{entry.text}</p></article>)}</div>}
      </>}
    </section>
  );
}
