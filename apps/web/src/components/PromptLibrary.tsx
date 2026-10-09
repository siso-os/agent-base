import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Archive, BookOpen, Copy, Pencil, Plus, X } from "lucide-react";
import { archivePrompt, PROMPT_LIBRARY_KEY, PROMPT_LIMITS, readPromptLibrary, savePrompt, scopedPrompts, type LibraryResult, type PromptLibraryData, type PromptScope, type SavedPrompt } from "../lib/prompt-library";
import "./PromptLibrary.css";

type Editor = { id?: string; name: string; body: string; scope: PromptScope };
const storage = () => { try { return window.localStorage; } catch { return null; } };

export function PromptLibrary({ agentKey, agentName, draft, onInsert }: { agentKey: string; agentName: string; draft: string; onInsert: (text: string) => void }) {
  const [open, setOpen] = useState(false), [scope, setScope] = useState<PromptScope>("shared");
  const [library, setLibrary] = useState<PromptLibraryData>({ version: 1, prompts: [] });
  const [search, setSearch] = useState(""), [archived, setArchived] = useState(false), [editor, setEditor] = useState<Editor | null>(null);
  const [status, setStatus] = useState(""), [error, setError] = useState("");
  const trigger = useRef<HTMLButtonElement>(null), panel = useRef<HTMLDivElement>(null), searchInput = useRef<HTMLInputElement>(null);
  const nameInput = useRef<HTMLInputElement>(null), copyBody = useRef<HTMLTextAreaElement>(null);
  const [copyFallback, setCopyFallback] = useState<string | null>(null);
  const [at, setAt] = useState<{ left: number; bottom: number; maxHeight: number } | null>(null);
  const id = useId();
  const close = () => { setOpen(false); trigger.current?.focus(); };
  const accept = (result: LibraryResult) => {
    if (!result.ok) { setError(result.error); return false; }
    setLibrary(result.library); setError(""); return true;
  };
  useEffect(() => { setOpen(false); setEditor(null); setSearch(""); setCopyFallback(null); setStatus(""); setError(""); }, [agentKey]);
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const r = (trigger.current?.closest(".siso-rim") ?? trigger.current)?.getBoundingClientRect();
      if (!r) return;
      const width = Math.min(420, window.innerWidth - 24);
      const bottom = Math.max(12, Math.min(window.innerHeight - r.top + 10, window.innerHeight - 140));
      setAt({ left: Math.max(12, Math.min(trigger.current?.getBoundingClientRect().left ?? r.left, window.innerWidth - width - 12)), bottom, maxHeight: window.innerHeight - bottom - 12 });
    };
    place(); window.addEventListener("resize", place); window.addEventListener("scroll", place, true);
    return () => { window.removeEventListener("resize", place); window.removeEventListener("scroll", place, true); };
  }, [open]);
  useEffect(() => {
    if (!open) return;
    accept(readPromptLibrary(storage()));
    const away = (event: MouseEvent) => {
      const path = event.composedPath();
      if (!path.includes(panel.current!) && !path.includes(trigger.current!)) close();
    };
    const refresh = (event: StorageEvent) => { if (event.key === PROMPT_LIBRARY_KEY || event.key === null) accept(readPromptLibrary(storage())); };
    // Archiving can remove the focused button. Escape must still close the library,
    // and must never reach the chat's interrupt shortcut behind it.
    const key = (event: KeyboardEvent) => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(); } };
    window.addEventListener("click", away); window.addEventListener("storage", refresh); window.addEventListener("keydown", key, true);
    return () => { window.removeEventListener("click", away); window.removeEventListener("storage", refresh); window.removeEventListener("keydown", key, true); };
  }, [open]);
  useEffect(() => { if (open && at) (editor ? nameInput : searchInput).current?.focus(); }, [open, !!at, editor?.id, editor === null]);
  useEffect(() => { if (copyFallback !== null) { copyBody.current?.focus(); copyBody.current?.select(); } }, [copyFallback]);
  const create = (body = "") => { setEditor({ name: "", body, scope }); setStatus(""); setCopyFallback(null); };
  const copy = async (prompt: SavedPrompt) => {
    try { await navigator.clipboard.writeText(prompt.body); setStatus(`Copied ${prompt.name}`); setCopyFallback(null); }
    catch { setCopyFallback(prompt.body); setStatus("Clipboard unavailable. Select the text below and copy it manually."); }
  };
  const rows = scopedPrompts(library, scope, agentKey, archived).filter((p) => `${p.name}\n${p.body}`.toLocaleLowerCase().includes(search.toLocaleLowerCase()));
  return <>
    <button ref={trigger} type="button" className="ab-prompts__trigger" aria-label="Prompt library" title="Prompt library" aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? id : undefined}
      onClick={() => { if (open) close(); else { setOpen(true); setStatus(""); setCopyFallback(null); } }}><BookOpen size={15} aria-hidden /></button>
    {open && at && createPortal(<div ref={panel} id={id} className="ab-prompts" role="dialog" aria-label="Prompt library" style={at}
      onKeyDown={(event) => {
        // Keep keyboard navigation inside the popup while it is open.
        if (event.key === "Tab") {
          const controls = [...(panel.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input, textarea') ?? [])];
          const first = controls[0], last = controls[controls.length - 1];
          if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
          else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
        }
      }}>
      <header className="ab-prompts__header"><div><b>Prompt library</b><small>{editor ? "Save words you use again" : "Saved locally on this device"}</small></div><button type="button" aria-label="Close prompt library" onClick={close}><X size={16} aria-hidden /></button></header>
      {editor ? <form className="ab-prompts__editor" onSubmit={(event) => {
        event.preventDefault();
        if (accept(savePrompt(storage(), { ...editor, agentKey: editor.scope === "agent" ? agentKey : undefined }))) { setEditor(null); setArchived(false); setSearch(""); setStatus("Prompt saved"); }
      }}>
        <label>Name<input ref={nameInput} value={editor.name} maxLength={PROMPT_LIMITS.name} required placeholder="e.g. Health check" onChange={(event) => setEditor({ ...editor, name: event.target.value })} /></label>
        <label>Prompt<textarea aria-label="Prompt" value={editor.body} maxLength={PROMPT_LIMITS.body} required rows={7} placeholder="Write the prompt you want to reuse…" onChange={(event) => setEditor({ ...editor, body: event.target.value })} /></label>
        <div className="ab-prompts__footer"><small>{editor.scope === "shared" ? "Shared across agents" : `For ${agentName}`}</small><button type="button" onClick={() => setEditor(null)}>Cancel</button><button type="submit" className="ab-prompts__primary" disabled={!editor.name.trim() || !editor.body.trim()}>Save prompt</button></div>
      </form> : <>
        <div className="ab-prompts__scopes" role="group" aria-label="Prompt scope">{(["shared", "agent"] as const).map((s) => <button type="button" key={s} aria-pressed={scope === s} title={s === "agent" ? agentName : undefined} onClick={() => { setScope(s); setCopyFallback(null); setStatus(""); }}>{s === "shared" ? "Shared" : "This agent"}</button>)}</div>
        <div className="ab-prompts__toolbar"><input ref={searchInput} aria-label="Search prompts" type="search" placeholder="Find a prompt…" value={search} onChange={(event) => setSearch(event.target.value)} /><button type="button" onClick={() => create()} aria-label="Create prompt" title="Create prompt"><Plus size={16} aria-hidden /></button></div>
        <div className="ab-prompts__list">{rows.length ? rows.map((prompt) => <article className="ab-prompts__item" key={prompt.id}>
          <b>{prompt.name}</b><p>{prompt.body}</p><div className="ab-prompts__actions">
            {archived ? <button type="button" onClick={() => { if (accept(archivePrompt(storage(), prompt.id, false))) setStatus("Prompt restored"); }}>Restore</button> : <>
              <button type="button" aria-label={`Copy ${prompt.name}`} onClick={() => void copy(prompt)}><Copy size={12} aria-hidden />Copy</button>
              <button type="button" aria-label={`Edit ${prompt.name}`} onClick={() => { setEditor({ id: prompt.id, name: prompt.name, body: prompt.body, scope: prompt.scope }); setCopyFallback(null); setStatus(""); }}><Pencil size={12} aria-hidden />Edit</button>
              <button type="button" aria-label={`Archive ${prompt.name}`} onClick={() => { if (accept(archivePrompt(storage(), prompt.id))) setStatus("Prompt archived"); }}><Archive size={12} aria-hidden />Archive</button>
              <button type="button" className="ab-prompts__primary" aria-label={`Use ${prompt.name}`} onClick={() => { onInsert(prompt.body); close(); }}>Use prompt</button>
            </>}
          </div></article>) : <div className="ab-prompts__empty"><b>{search ? "No matching prompts" : archived ? "No archived prompts" : "Your reusable prompts go here"}</b><p>{search ? "Try another name or phrase." : archived ? "Archived text stays in your library." : scope === "shared" ? "Keep a prompt handy for any agent." : `Keep a prompt handy for ${agentName}.`}</p>{!search && !archived && <button type="button" onClick={() => create()}>Create prompt</button>}</div>}</div>
        <div className="ab-prompts__footer"><button type="button" disabled={!draft.trim()} onClick={() => create(draft)}>Save current draft</button><button type="button" aria-pressed={archived} onClick={() => { setArchived(!archived); setCopyFallback(null); setStatus(""); }}>{archived ? "Back to library" : "Archived"}</button></div>
      </>}
      {error && <p className="ab-prompts__status" role="alert">{error}</p>}
      {status && <p className="ab-prompts__status" role="status">{status}</p>}
      {copyFallback !== null && <textarea ref={copyBody} className="ab-prompts__copy" aria-label="Prompt text for manual copy" readOnly value={copyFallback} rows={4} />}
    </div>, document.body)}
  </>;
}
