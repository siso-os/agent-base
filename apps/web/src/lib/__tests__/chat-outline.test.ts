// @ts-nocheck
import { outline } from '../chat-outline';
import type { Turn } from '../chat';
const turn = (text: string): Turn => ({ key: 't', me: null, work: [], answer: [{ k: 'said', key: 'a', text }], done: true, ms: 1, endedAt: 123 });
it('uses first H1/H2, ignores code headings, and provides a muted first line fallback', () => {
  expect(outline([turn('```md\n# Example code\n```\n## Real **answer**\ntext')])[0]).toMatchObject({ title: 'Real answer', heading: true, at: 123 });
  expect(outline([turn('A plain answer\nwith more')])[0]).toMatchObject({ title: 'A plain answer', heading: false });
  expect(outline([turn('')])).toEqual([]);
});
it('retains turn positions and marks new session history', () => {
  const divider = turn(''); divider.work = [{ k: 'note', key: 'new', text: 'New session', label: 'New session' }];
  expect(outline([turn('# Earlier'), divider, turn('# Current')])[1]).toMatchObject({ turn: 2, sessionBreak: true });
});
