export type LibraryTab = 'docs' | 'works' | 'built' | 'live';
export type LibraryRoute = { kind: 'list'; tab: LibraryTab } | { kind: 'document' | 'work'; id: string } | { kind: 'invalid' };
export const isLibraryLocation = (hash: string): boolean => /^#library(?:\/|$)/.test(hash);

/** IDs select existing records only. They are never filesystem paths or fetch URLs. */
export function libraryRoute(hash: string): LibraryRoute | null {
  if (!isLibraryLocation(hash)) return null;
  if (hash === '#library') return { kind: 'list', tab: 'docs' };
  const list = /^#library\/(docs|works|built|live)$/.exec(hash);
  if (list) return { kind: 'list', tab: list[1] as LibraryTab };
  const page = /^#library\/(document|work)\/([^/?#]+)$/.exec(hash);
  if (page) {
    try {
      const id = decodeURIComponent(page[2]);
      if (id && id.length <= 512 && !/[\x00-\x20/\\%]/.test(id) && !id.includes('..')) return { kind: page[1] as 'document' | 'work', id };
    } catch { /* Malformed encoding is an unavailable route. */ }
  }
  return { kind: 'invalid' };
}

export const libraryHref = (kind: 'document' | 'work', id: string) => `#library/${kind}/${encodeURIComponent(id)}`;
