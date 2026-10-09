import type { OrgProject, Agent } from './agents';
import type { EntityPageData } from './org-types';
import type { TaskSummary } from '../components/widgets/TasksWidget';
import { isDone, isNow, tasksOf, taskRoots } from './a0-tasks';

export function projectTaskRows(tasks: TaskSummary[], person: string | null) {
  if (!person) return taskRoots(tasks);
  const visible = new Set(tasksOf(tasks, person).map(t => t.id));
  // Matching a step retains its complete plan and integrating owner.
  for (const task of tasks) {
    if (!visible.has(task.id)) continue;
    const seen = new Set<string>();
    let parent = task.parent;
    while (parent && !seen.has(parent)) {
      seen.add(parent); visible.add(parent);
      parent = tasks.find(t => t.id === parent)?.parent;
    }
  }
  return taskRoots(tasks).filter(t => visible.has(t.id));
}
export function projectTaskLane(task: TaskSummary) {
  if (task.source === 'unavailable') return 'Unavailable';
  if (task.stage === 'dropped') return 'Dropped';
  if (isDone(task)) return 'Done';
  if (task.needs) return 'Blocked';
  return isNow(task) || ['building','rework','built','tested','preview','feedback'].includes(task.stage) ? 'Now' : 'Next';
}

/** Catalog pages already resolve their owner; carry that same seat into the shared crew reader. */
export function projectWithEntityOwner(project: OrgProject, entity?: EntityPageData | null): OrgProject {
  if (project.owners.length || !entity) return project;
  const name = entity.owner.mode === 'record' ? entity.owner.planned : entity.owner.name;
  if (!name) return project;
  return {...project,owners:[{name,main:true,domain:entity.owner.why.text,icon:'box',
    state:entity.owner.mode === 'running' ? 'live' : 'planned',working:entity.owner.state === 'working' ? 1 : 0,plan:null}]};
}

/** Missing sources stay empty/unknown; runtime never supplies delivery evidence. */
export function projectEntity(project: OrgProject, owner?: Agent): EntityPageData {
  const seat = project.owners.find(o => o.name === owner?.name) ?? project.owners.find(o => o.main) ?? project.owners[0];
  return {
    kind: 'project', id: project.id, name: project.name, kicker: ['Project', project.group],
    line: project.line ? {text: project.line, src:'Project registry'} : null, since:null, tags:[],
    owner: {mode:owner?'running':'record',name:owner?.name ?? seat?.name ?? null,
      state:owner?.status==='working'?'working':owner?'idle':'none',
      sentence:owner ? owner.status==='working'?'Working':'Available' : seat?'Owner offline':'No owner assigned',
      why:{text:seat?.domain ?? 'Agent Zero places an owner when work starts here.',src:'Project registry'}, crew:[],planned:null},
    stats:[],activity:{days:[],src:'No commit source connected'},live:[],thumbs:[],
    work:{open:0,total:0,byState:{},items:[],src:'Task index'},clients:[],built:[],people:[],happened:[],assets:[],notes:[],missing:[],
  };
}
