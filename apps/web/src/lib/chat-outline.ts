import type { Turn } from './chat';
export type OutlineRow = { key: string; turn: number; title: string; preview: string; at: number | null; heading: boolean; sessionBreak: boolean };
export function outline(turns: readonly Turn[]): OutlineRow[] {
  let sessionBreak = false;
  return turns.flatMap((turn, i) => {
    if ([...turn.work, ...turn.answer].some(item => item.k === 'note' && item.label === 'New session')) sessionBreak = true;
    const text = turn.answer.flatMap(item => item.k === 'said' ? [item.text] : []).join('\n').trim();
    if (!text) return [];
    // Headings inside fenced code are code, never navigation labels.
    const prose = text.replace(/^\s*(`{3,}|~{3,})[^\n]*\n[\s\S]*?^\s*\1\s*$/gm, '');
    const heading = prose.match(/^ {0,3}#{1,2}\s+(.+?)(?:\s+#+)?\s*$/m);
    const title = (heading?.[1] ?? text.split('\n').find(line => line.trim()) ?? '').replace(/[*_`]/g, '').slice(0, 180);
    const row = { key: turn.key, turn: i, title, preview: text.split('\n').filter(Boolean).slice(0, 2).join('\n').slice(0, 320), at: turn.me?.at ?? turn.endedAt, heading: !!heading, sessionBreak };
    sessionBreak = false;
    return [row];
  });
}
