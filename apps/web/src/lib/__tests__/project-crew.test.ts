// @ts-nocheck
import { crewTitle, projectCrew, projectOwner, projectPreviewCount } from '../project-crew';
const now = 1800000000000;
const p = { id: 'agent-base', name: 'Agent Base', owners: [{ name: 'AGENT-BASE', main: true }, { name: 'MINER' }] };
const owner = { id: 'owner', name: 'AGENT BASE', row: 'live', status: 'working', since: now - 60000, project: 'Agent Base', kind: 'owner' };
const a = (id, status, lastEvent = now - 30000) => ({ id, name: id, row: 'live', status, since: lastEvent, lastEvent, parentId: 'owner', project: 'Agent Base' });
const task = (id, project, stage, agent = null) => ({ id, title: id, project, stage, agent, owner: null, priority: 'P1' });
describe('pinned project owner and crew', () => {
 it('AGENT-BASE matches the AGENT BASE live seat', () => expect(projectOwner(p, [owner])).toBe(owner));
 it('prefers the main registry owner before recency', () => expect(projectOwner(p, [{ ...owner, id: 'miner', name: 'MINER', lastEvent: now }, owner])).toBe(owner));
 it('picks the most recent live seat when no owner is main', () => expect(projectOwner({ ...p, owners: p.owners.map(o => ({ ...o, main: false })) }, [owner, { ...owner, id: 'miner', name: 'MINER', lastEvent: now }]).name).toBe('MINER'));
 it('shows two working and one idle, with twelve done earlier', () => {
  const rows = [owner, a('idle', 'idle'), a('second', 'working', now - 40000), a('first', 'working'), ...Array.from({ length: 12 }, (_, i) => a(`done-${i}`, 'done'))];
  const crew = projectCrew(p, rows, [], now);
  expect(crew.shown.map(a => a.id)).toEqual(['first', 'second', 'idle']);expect(crew.earlier).toHaveLength(12);
 });
 it('retains older idle crew holding open tasks', () => expect(projectCrew(p, [owner, a('old', 'idle', now - 10800000)], [task('work', 'Agent Base', 'building', 'old')], now).shown).toHaveLength(1));
 it('does not include another project or Zero', () => expect(projectCrew(p, [owner, { ...a('halo', 'working'), parentId: null, project: 'HALO' }, { ...a('zero', 'working'), zero: true }], [], now).shown).toEqual([]));
 it('counts only this project previews, accepting id/name punctuation', () => expect(projectPreviewCount(p, [task('one', 'Agent Base', 'preview'), task('two', 'agent-base', 'preview'), task('other', 'HALO', 'preview'), task('tested', 'Agent Base', 'tested')])).toBe(2));
 it('uses a human ticket title rather than a repo brief', () => expect(crewTitle({ ...a('build', 'working'), title: 'Repo: ~/private/worktree', workerSummary: { tickets: ['t-0402: Build the Agent Base card'], message: 'pnpm build' } })).toBe('Build the Agent Base card'));
});
