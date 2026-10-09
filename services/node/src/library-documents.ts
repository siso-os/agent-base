/** Read-only projection of existing catalogue locators plus this domain's explicit internal reading set. */
import { constants, closeSync, fstatSync, openSync, readSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

export type CatalogWork = {
  id?: string; slug: string; name: string; summary?: string; type?: string; maturity?: string; section?: string; library_url?: string;
  source_links?: { kind: string; label?: string; url: string; visibility?: string }[];
  owner_entry?: { owner?: string | null; reference?: string; source_revision?: string | null; visibility?: string };
};
export type LibraryDocument = {
  id: string; workId?: string; title: string; project: string; domain: string; owner: string | null;
  source: string; reference: string; revision: string | null; privacy: string;
  availability: 'local' | 'unverified' | 'unavailable'; checkedAt: number | null;
  url: string | null; text?: string; note: string;
};
/** Only explicit web locators. No file:, data:, javascript:, credentials, or protocol-relative hops. */
export function documentUrl(value: string | undefined, base?: string): string | null {
  if (!value || value.trim() !== value || /[\x00-\x20\\]/.test(value) || value.startsWith('//')) return null;
  try {
    const u = new URL(value, base);
    return ['http:', 'https:'].includes(u.protocol) && !u.username && !u.password ? u.href : null;
  } catch { return null; }
}
export function catalogDocuments(works: CatalogWork[], site: string): LibraryDocument[] {
  return works.flatMap(w => {
    const owner = w.owner_entry;
    const links = [{ kind: 'reading page', label: w.name, url: w.library_url ?? `/works/${encodeURIComponent(w.slug)}/`, visibility: 'public' },
      ...(w.source_links ?? []).filter(l => ['readme', 'documentation'].includes(l.kind))];
    const seen = new Set<string>();
    return links.flatMap((link, i) => {
      const url = documentUrl(link.url, i === 0 ? `${site}/` : undefined);
      if (url && seen.has(url)) return [];
      if (url) seen.add(url);
      const id = `document:${createHash('sha256').update(JSON.stringify([w.id ?? w.slug, url ?? link.url])).digest('hex').slice(0, 32)}`;
      return [{ id, workId: w.id ?? w.slug, title: i === 0 ? w.name : `${w.name} · ${link.label ?? link.kind}`,
        project: w.slug, domain: w.section || 'Unassigned', owner: owner?.owner ?? null,
        source: 'Great Library catalogue', reference: owner?.reference ?? `catalog.json#${w.slug}`,
        revision: owner?.source_revision ?? null, privacy: link.visibility ?? 'unknown',
        availability: url ? 'unverified' : 'unavailable', checkedAt: null, url,
        note: url ? (i === 0 ? 'Public catalogue reading page; source access may differ. Reachability not checked.' : 'Source locator; access and reachability not checked.') : 'Unsupported or missing document URL.',
      } satisfies LibraryDocument];
    });
  });
}

const INTERNAL = [
  { file: 'README.md', title: 'Domain base · owners and intent', domain: 'agent-base', owner: 'ASTRA-APP', id: 'astra-app:README.md' },
  ...[
    { dir: 'browser', label: 'Browser', owner: 'ASTRA-BROWSER' },
    { dir: 'communications', label: 'WhatsApp + Rolodex', owner: 'ASTRA-COMMS' },
    { dir: 'library', label: 'Library', owner: 'ASTRA-LIBRARY' },
  ].flatMap(d => [
    ['README.md', 'intent and ownership'], ['STATE.md', 'current state'], ['SPEC.md', 'specification'],
  ].map(([file, label]) => ({ file: `${d.dir}/${file}`, title: `${d.label} · ${label}`, domain: d.dir, owner: d.owner, id: `${d.owner.toLowerCase()}:${file}` }))),
];
/** Fixed source-owned allowlist, bounded to 64 KiB per file. Never accept a browser-supplied path. */
export function domainDocuments(root = path.resolve(import.meta.dirname, '../../..')): LibraryDocument[] {
  return INTERNAL.map(({ file, title, domain, owner, id }) => {
    const reference = `domain-base/${file}`;
    const row: LibraryDocument = { id, title, project: 'agent-base', domain, owner,
      source: 'Astra domain base', reference, revision: null, privacy: 'internal', availability: 'unavailable', checkedAt: Date.now(), url: null,
      note: 'Not readable in this checkout; no public copy is implied.' };
    let fd: number | undefined;
    try {
      const target = path.join(root, reference);
      // Reject symlinks anywhere in the allowed path, including parent directories.
      if (realpathSync(target) !== path.join(realpathSync(root), reference)) return row;
      fd = openSync(target, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
      const st = fstatSync(fd);
      if (!st.isFile() || st.size > 65536) return row;
      const buffer = Buffer.alloc(65537);
      const bytes = readSync(fd, buffer, 0, buffer.length, 0);
      if (bytes > 65536) return row;
      return { ...row, text: buffer.subarray(0, bytes).toString('utf8'), availability: 'local', note: 'Internal source text from this checkout. Links and HTML are inert.' };
    } catch { return row; }
    finally { if (fd !== undefined) closeSync(fd); }
  });
}
