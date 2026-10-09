import { useEffect, useMemo, useState } from "react";
import { FileTextIcon, GitPullRequestIcon, GlobeIcon, LayoutTemplateIcon } from "lucide-react";
import { ArtifactShelfView } from "../../../../packages/siso-composer/src/ArtifactShelfView";
import "./ArtifactShelf.css";
import { OutputInspectDock, type InspectOutputItem } from './OutputInspectDock';
import { ChatLinkPreview } from './ChatLinkPreview';
import { safeChatDestination } from '../lib/chat-bank';

/**
 * The artifacts shelf (ui-hub VISION §7A; Shaan 4 Oct, "what's an artifact shelf ... yeah sure that's cool"): what an agent
 * made in this chat (a page, a PR, a hub component, a spec) sits as a chip just above the input, newest first, instead of
 * hiding inside a reply. Read from the replies themselves, so every agent gets it without a new protocol; × puts one away
 * for this chat.
 */
export type Artifact = { url: string; label: string; kind: "hub" | "pr" | "page" | "file" };

const URL_RE = /https?:\/\/[^\s<>()"'`]+[^\s<>()"'`.,;:!?*\]]/g;

export function artifactOf(url: string): Artifact | null {
  const safe = safeChatDestination(url);
  if (!safe) return null;
  url = safe;
  let u: URL;
  try { u = new URL(url); } catch { return null; }
  const parts = u.pathname.split("/").filter(Boolean);
  if (u.port === "8896") return { url, kind: "hub", label: parts.length ? `UI hub · ${parts[0].replace(/-/g, " ")}${parts[1] && !parts[1].endsWith(".html") ? ` · ${parts[1].replace(/\.md$/, "")}` : parts[1] ? ` · ${parts[1].replace(/\.html$/, "")}` : ""}` : "UI hub" };
  if (u.hostname === "github.com" && parts[2] === "pull" && parts[3]) return { url, kind: "pr", label: `PR #${parts[3]} · ${parts[1]}` };
  if (u.hostname === "github.com" && parts[1]) return { url, kind: "file", label: parts.length > 4 ? parts.at(-1)! : parts[1] };
  if (/\.(md|pdf|html)$/i.test(u.pathname)) { let label = parts.at(-1)!; try { label = decodeURIComponent(label); } catch {} return { url, kind: "file", label }; }
  // The console's own front page is a list of everyone's cards, not something this chat made.
  if (u.port === "8891" && parts.length === 0) return null;
  const host = /^(127\.0\.0\.1|localhost)$/.test(u.hostname) ? `:${u.port}` : u.hostname.replace(/^www\./, "").split(".")[0];
  return { url, kind: "page", label: [host, parts.slice(-2).join("/")].filter(Boolean).join(" · ").slice(0, 48) };
}

export function artifactsFrom(texts: string[]): Artifact[] {
  const seen = new Map<string, Artifact>();
  for (const t of texts) for (const m of t.match(URL_RE) ?? []) {
    const a = artifactOf(m);
    if (!a) continue;
    seen.delete(a.url);
    seen.set(a.url, a);
  }
  return [...seen.values()].reverse();
}

const ICON = { hub: LayoutTemplateIcon, pr: GitPullRequestIcon, page: GlobeIcon, file: FileTextIcon } as const;

export function ArtifactShelf({ agentId, texts, onOpen, outputs = [], inspectRequest, paused = false }: { agentId: string; texts: string[]; onOpen: (url: string) => void; outputs?: InspectOutputItem[]; inspectRequest?: { id: string; revision: number } | null; paused?: boolean }) {
  const key = `agent-base:shelf-hidden:${agentId}`;
  const [hidden, setHidden] = useState<string[]>(() => { try { return JSON.parse(localStorage.getItem(key) ?? "[]"); } catch { return []; } });
  const [selectedId, setSelectedId] = useState<string | null>(null), [expanded, setExpanded] = useState(false);
  useEffect(() => { setSelectedId(null); setExpanded(false); try { setHidden(JSON.parse(localStorage.getItem(key) ?? '[]')); } catch { setHidden([]); } }, [key]);
  useEffect(() => {
    if (!inspectRequest) return;
    setSelectedId(inspectRequest.id); setExpanded(true);
    if (inspectRequest.id.startsWith('link:')) setHidden(current => {
      const next = current.filter(url => `link:${url}` !== inspectRequest.id);
      try { localStorage.setItem(key, JSON.stringify(next)); } catch {}
      return next;
    });
  }, [inspectRequest, key]);
  const items = useMemo(() => artifactsFrom(texts).filter((a) => !hidden.includes(a.url)), [texts, hidden]);
  const dockItems: InspectOutputItem[] = [...items.map(item => ({ id: `link:${item.url}`, title: item.label, kind: 'preview' as const, state: 'ready' as const, detail: 'Link supplied in this chat. Page contents and preview metadata have not been fetched.', body: item.url, preview: <ChatLinkPreview item={{ id: item.url, url: item.url, title: item.label, previewState: 'unavailable' }} expanded onExpand={(_item, value) => { if (!value) setSelectedId(null); }} onOpen={(_item, destination) => onOpen(destination)} paused={paused} /> })), ...outputs];
  if (!dockItems.length) return null;
  const hide = (url: string) => { const next = [...hidden, url].slice(-200); setHidden(next); if (selectedId === `link:${url}`) setSelectedId(null); try { localStorage.setItem(key, JSON.stringify(next)); } catch {} };
  return <div className="siso-chat__supplied-outputs">
    {!!items.length && <ArtifactShelfView label="Links supplied in this chat" items={items.map(item => { const Icon = ICON[item.kind]; return { id: item.url, label: item.label, kind: item.kind, title: item.url, icon: <Icon size={12} aria-hidden/> }; })} onOpen={onOpen} onHide={hide}/>}
    {/* No standing "Inspect outputs · N" chip (Shaan, 6 Oct 21:00: "I don't know why that's there"): the links row stays,
        and the dock opens only when something asks for it, with its own close. */}
    {expanded && <button type="button" className="siso-chat__inspect-outputs" aria-expanded onClick={() => setExpanded(false)}>Close outputs</button>}
    {expanded && <OutputInspectDock className="oid-chat" variant="compact" items={dockItems} selectedId={selectedId} onSelect={setSelectedId} paused={paused} />}
  </div>;
}
