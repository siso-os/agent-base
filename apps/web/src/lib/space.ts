/** Finished rows keep the live fold; older idle rows join it unless they hold open work. */
export function spaceEarlier(a: { status: string; since?: number; lastEvent?: number | null; zero?: boolean; kind?: string | null }, openTask: boolean, now = Date.now()) {
  if (a.zero || a.kind === 'owner' || a.status === 'working' || openTask) return false;
  return a.status === 'done' || a.status === 'failed' || now - (a.lastEvent ?? a.since ?? 0) > 2 * 60 * 60 * 1000;
}
/** Fleet's meaningful title first, then its about/role; the registry name remains secondary. */
export function spaceTitle(a: { name: string; title?: string; role?: string | null; zero?: boolean; kind?: string | null; workerSummary?: { message: string } }) {
  const title = a.title?.trim();
  if (a.zero && !title) return 'Agent Zero';
  return title && title.toLowerCase().replace(/[^a-z0-9]/g, '') !== a.name.toLowerCase().replace(/[^a-z0-9]/g, '') ? title : a.workerSummary?.message?.trim() || a.role?.trim() || (a.zero ? 'Agent Zero' : a.kind === 'owner' ? 'Project owner' : 'Project worker');
}
