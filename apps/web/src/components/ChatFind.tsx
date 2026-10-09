import { createContext, useContext } from 'react';
import { ArrowUpIcon, ArrowDownIcon, XIcon } from 'lucide-react';
import type { FindMatch } from '../lib/chat-find';
export const ChatFindQuery = createContext('');
export function useFindOpen(text: string) { const query = useContext(ChatFindQuery); return !!query && text.toLowerCase().includes(query.toLowerCase()); }
// uihub: search-modal — scoped to the conversation, with ordinary keyboard controls.
export function ChatFind({ query, onQuery, count, index, pending, failed, onRetry, onStep, onClose, match }: {
  query: string; onQuery: (q: string) => void; count: number; index: number; pending: boolean; failed: boolean;
  onRetry: () => void; onStep: (n: number) => void; onClose: () => void; match?: FindMatch;
}) {
  return <div className="chat-find" role="search" aria-label="Find in this chat">
    <div className="chat-find-controls"><input autoFocus aria-label="Find in chat" placeholder="Find in this chat" value={query} onChange={e => onQuery(e.target.value)} onKeyDown={e => {
      if (e.key === 'Enter') { e.preventDefault(); onStep(e.shiftKey ? -1 : 1); }
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose(); }
    }}/><output aria-live="polite">{query ? count ? `${index + 1} of ${count}` : pending ? 'Searching…' : 'No matches' : 'Type to find'}</output>
    <button type="button" aria-label="Previous match" disabled={!count} onClick={() => onStep(-1)}><ArrowUpIcon size={15}/></button>
    <button type="button" aria-label="Next match" disabled={!count} onClick={() => onStep(1)}><ArrowDownIcon size={15}/></button>
    <button type="button" aria-label="Close find" onClick={onClose}><XIcon size={15}/></button></div>
    {pending && <small>Searching older turns…</small>}{failed && <small>Couldn’t search older turns. <button type="button" onClick={onRetry}>Retry search</button></small>}
    {match && <div className="chat-find-excerpt">{match.text.slice(Math.max(0, match.start - 45), match.start)}<mark>{match.text.slice(match.start, match.end)}</mark>{match.text.slice(match.end, match.end + 65)}</div>}
  </div>;
}
