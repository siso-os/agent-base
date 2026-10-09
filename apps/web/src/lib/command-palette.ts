/** Spotlight identity/filtering. Recents contain opaque IDs only, never titles or excerpts. */
export type CommandKind = 'chats' | 'projects' | 'pages' | 'commands';
export type SearchableCommand = { id: string; label: string; description: string; kind?: CommandKind; scope?: string; keywords?: string[]; available?: boolean; matchQuery?: boolean };
export const RECENTS_KEY = 'ab.spotlight.recents.v1';
export function parseRecents(raw: string | null): string[] {
  try { const ids: unknown = JSON.parse(raw ?? '[]'); return Array.isArray(ids) ? [...new Set(ids.filter((id): id is string => typeof id === 'string' && id.length < 2048))].slice(0, 20) : []; } catch { return []; }
}
export function rememberCommand(ids: string[], id: string): string[] { return [id, ...ids.filter(x => x !== id)].slice(0, 20); }
export function filterCommands<T extends SearchableCommand>(actions: T[], query: string, kind: CommandKind | 'all', recentIds: string[] = []): T[] {
  const commandMode = query.trimStart().startsWith('>');
  const needle = (commandMode ? query.trimStart().slice(1) : query).trim().toLocaleLowerCase();
  const selectedKind = commandMode ? 'commands' : kind;
  const matches = actions.filter(a => (selectedKind === 'all' || (a.kind ?? 'commands') === selectedKind) && (a.matchQuery || [a.label, a.description, a.scope, ...(a.keywords ?? [])].filter(Boolean).join(' ').toLocaleLowerCase().includes(needle)));
  if (query.trim()) return matches;
  const rank = new Map(recentIds.map((id, i) => [id, i]));
  return matches.slice().sort((a, b) => (rank.get(a.id) ?? Infinity) - (rank.get(b.id) ?? Infinity));
}
