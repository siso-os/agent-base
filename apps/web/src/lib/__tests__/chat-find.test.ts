// @ts-nocheck
import { findDocuments, findMatches, matchRanges } from '../chat-find';
import { buildChat } from '../chat';
it('finds literal case-insensitive ranges without regex interpretation', () => {
  expect(matchRanges('Ship queue; ship queue', 'SHIP QUEUE')).toEqual([{ start: 0, end: 10 }, { start: 12, end: 22 }]);
  expect(matchRanges('a [b] c', '[b]')).toEqual([{ start: 2, end: 5 }]); expect(matchRanges('x', ' ')).toEqual([]);
});
it('indexes user text, folded tool outputs and answers', () => {
  const chat = buildChat([{ t: 'user', from: 'app', text: 'ship queue', at: 1 }, { t: 'tool', id: 'c', name: 'Bash', summary: 'check', at: 2 }, { t: 'tool_done', id: 'c', ok: true, out: 'ship queue checked', at: 3 }, { t: 'text', id: 'r', text: '## ship queue\nready', at: 4 }, { t: 'result', ms: 3, cost: null, at: 5 }], {}, false);
  const matches = findMatches(findDocuments(chat.turns), 'ship queue');
  expect(matches).toHaveLength(3); expect(matches.some(m => m.work)).toBe(true); expect(new Set(matches.map(m => m.id)).size).toBe(3);
});
it('searches 300 loaded turns in under 100ms and keeps exact long-code offsets', () => {
  const text = Array.from({ length: 400 }, (_, i) => i === 350 ? 'deep needle here' : `line ${i}`).join('\n');
  const docs = Array.from({ length: 300 }, (_, turn) => ({ turn, turnKey: String(turn), source: 'reply', text, work: false }));
  const start = performance.now(), matches = findMatches(docs, 'needle');
  expect(matches).toHaveLength(300); expect(matches[0].start).toBe(text.indexOf('needle')); expect(performance.now() - start).toBeLessThan(100);
});
