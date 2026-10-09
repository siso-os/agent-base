import type { Agent, OrgProject } from './agents';
import type { TaskSummary } from '../components/widgets/TasksWidget';
import { canonName, isDone, nameKey, tasksOf } from './a0-tasks';
import { spaceEarlier, spaceTitle } from './space';

export const projectTasks = (p: Pick<OrgProject, 'id' | 'name'>, tasks: TaskSummary[]) => tasks.filter(t => [nameKey(p.id), nameKey(p.name)].includes(nameKey(t.project)));
export const projectPreviewCount = (p: Pick<OrgProject, 'id' | 'name'>, tasks: TaskSummary[]) => projectTasks(p, tasks).filter(t => t.stage === 'preview').length;
const recent = (a: Agent) => a.lastEvent ?? a.since;
/** Registry punctuation never determines which live conversation the card opens. */
export function projectOwner(p: OrgProject, agents: Agent[]) {
  return agents.filter(a => a.row === 'live' && !a.codexWorker && p.owners.some(o => nameKey(o.name) === nameKey(a.name)))
    .sort((a, b) => isMain(b) - isMain(a) || recent(b) - recent(a))[0];
  function isMain(x: Agent) { return Number(p.owners.some(o => o.main && nameKey(o.name) === nameKey(x.name)) || !!x.main); }
}
export function projectCrew(p: OrgProject, agents: Agent[], tasks: TaskSummary[], now = Date.now()) {
  const owner = projectOwner(p, agents), open = tasks.filter(t => !isDone(t));
  const members = [...new Map(agents.filter(a => !a.zero && a.id !== owner?.id && (a.parentId === owner?.id && !!owner || [nameKey(p.id), nameKey(p.name)].includes(nameKey(a.project ?? '')))).map(a => [a.id, a])).values()]
    .sort((a, b) => Number(b.status === 'working') - Number(a.status === 'working') || recent(b) - recent(a));
  const shown = members.filter(a => !spaceEarlier(a, tasksOf(open, a.name).length > 0, now));
  return { owner, shown, earlier: members.filter(a => !shown.includes(a)), members };
}
/** Brief headers and repo paths are not human task titles. The lifted helper still owns the fallback policy. */
export function crewTitle(a: Agent) {
  const ticket = a.workerSummary?.tickets.find(t => t.includes(': '))?.split(': ').slice(1).join(': ');
  const title = /^\s*(?:repo:|#|worktree:|branch:)/i.test(a.title) ? ticket ?? a.role ?? '' : a.title;
  return spaceTitle({ ...a, title, name: canonName(a.name) });
}
