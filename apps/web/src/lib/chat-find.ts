import type { Call, Item, Turn } from './chat';
export const callText = (c: Call) => [c.summary, c.input?.command, c.input?.description, c.input?.path, c.input?.old, c.input?.new, c.done?.out].filter(Boolean).join('\n');
export function itemText(item: Item): string {
  if ('text' in item) return item.text;
  if (item.k === 'run') return item.calls.map(callText).join('\n');
  if ('call' in item) return callText(item.call);
  if (item.k === 'ask') return item.summary;
  return '';
}
export type FindDocument = { turn: number; turnKey: string; source: string; text: string; work: boolean };
export type FindMatch = FindDocument & { start: number; end: number; occurrence: number; id: string };
export function findDocuments(turns: readonly Turn[]): FindDocument[] {
  return turns.flatMap((turn, i) => [
    ...(turn.me ? [{ turn: i, turnKey: turn.key, source: 'user', text: turn.me.text, work: false }] : []),
    ...turn.work.map(item => ({ turn: i, turnKey: turn.key, source: item.key, text: itemText(item), work: true })),
    ...turn.answer.map(item => ({ turn: i, turnKey: turn.key, source: item.key, text: itemText(item), work: false })),
  ]);
}
export function matchRanges(text: string, query: string): { start: number; end: number }[] {
  if (!query.trim()) return [];
  const haystack = text.toLowerCase(), needle = query.toLowerCase(), ranges = [];
  let at = 0;
  while ((at = haystack.indexOf(needle, at)) !== -1) { ranges.push({ start: at, end: at + needle.length }); at += needle.length; }
  return ranges;
}
export function findMatches(documents: readonly FindDocument[], query: string): FindMatch[] {
  return documents.flatMap(d => matchRanges(d.text, query).map((r, occurrence) => ({ ...d, ...r, occurrence, id: `${d.turnKey}:${d.source}:${r.start}` })));
}
/** Highlight without rewriting React's text nodes or the user's clipboard selection. */
export function textRanges(root: HTMLElement, query: string): Range[] {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, { acceptNode(node) {
    const parent = node.parentElement;
    return parent?.closest('button, [aria-hidden="true"], .siso-chat__reply-actions') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;
  } });
  const nodes: { node: Text; start: number; end: number }[] = [];
  let text = '', n: Node | null;
  while ((n = walker.nextNode())) { nodes.push({ node: n as Text, start: text.length, end: text.length + (n.textContent?.length ?? 0) }); text += n.textContent; }
  return matchRanges(text, query).flatMap(m => {
    const first = nodes.find(n => n.end > m.start), last = nodes.find(n => n.end >= m.end);
    if (!first || !last) return [];
    const r = document.createRange(); r.setStart(first.node, m.start - first.start); r.setEnd(last.node, m.end - last.start); return [r];
  });
}
