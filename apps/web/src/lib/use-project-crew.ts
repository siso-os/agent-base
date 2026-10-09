import { useSharedState } from './poll';
import type { Agent, OrgProject } from './agents';
import { projectCrew } from './project-crew';
import { useA0Tasks } from './a0-tasks';

/** Nav and dashboard share the existing project resolver and its refresh/cache. */
export function useProjectCrew(project: OrgProject, fallback: Agent[]) {
  const { data, error } = useSharedState<{ agents: Agent[] }>(`/api/spaces/${encodeURIComponent(project.id)}`, 5000);
  const { index, failed } = useA0Tasks();
  const agents = [...new Map([...fallback, ...(data?.agents ?? [])].map(a => [a.id, a])).values()];
  return { ...projectCrew(project, agents, index?.tasks ?? []), agents, tasks: index?.tasks ?? [], tasksReady: !!index, error, tasksFailed: failed };
}
