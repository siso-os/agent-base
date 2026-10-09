import { useEffect, useRef, type ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { ArrowLeftIcon, BookOpenIcon, ExternalLinkIcon } from 'lucide-react';
import type { LibraryData, DocumentRow } from './LibrarySpace';
import { libraryHref, type LibraryRoute } from './LibraryNavigation';

type Props = { route: Exclude<LibraryRoute, { kind: 'list' }>; data: LibraryData | null; error: string | null; refresh: ReactNode; progress: ReactNode; onOpenUrl: (url: string, title?: string) => void };
function webUrl(value: string | null | undefined) {
  if (!value || /[\x00-\x20\\]/.test(value)) return null;
  try { const u = new URL(value); return ['https:', 'http:'].includes(u.protocol) && !u.username && !u.password ? u.href : null; } catch { return null; }
}
const date = (at: number | null | undefined) => at ? new Date(at).toLocaleString() : 'Not recorded';
function bodyState(doc: DocumentRow) {
  if (doc.availability === 'unavailable') return 'Document unavailable';
  if (doc.privacy === 'private') return 'Private source — access not checked';
  return 'Source content not loaded';
}

export function LibraryPage({ route, data, error, refresh, progress, onOpenUrl }: Props) {
  const heading = useRef<HTMLHeadingElement>(null);
  const doc = route.kind === 'document' ? data?.documents?.rows.find(d => d.id === route.id) : undefined;
  const work = route.kind === 'work' ? data?.works.rows.find(w => (w.id ?? w.slug) === route.id) : undefined;
  const title = doc?.title ?? work?.name ?? (!data && !error ? 'Reading the Library…' : 'Entry unavailable');
  const list = route.kind === 'work' ? 'works' : 'docs';
  // Route navigation moves focus; a background result must not steal it from a reader.
  useEffect(() => { heading.current?.focus(); }, [route]);
  const source = webUrl(doc?.url ?? work?.url);
  const related = work ? data?.documents?.rows.filter(d => d.workId === (work.id ?? work.slug) || (!d.workId && d.project === work.slug)) ?? [] : [];
  const isMarkdown = !!doc && /\.md$/i.test(doc.reference);
  const isText = !!doc && /\.txt$/i.test(doc.reference);
  const readable = !!doc && doc.privacy === 'internal' && doc.availability === 'local' && doc.text !== undefined;
  const stale = route.kind === 'work' ? data?.works.stale : data?.documents?.stale;
  const sourceError = route.kind === 'work' ? data?.works.error : data?.documents?.error;
  return <section className="ab-lib-page" data-testid="library-page">
    <nav className="ab-lib-page__nav" aria-label="Breadcrumb"><a href={`#library/${list}`}><ArrowLeftIcon size={15} /> Back to {list === 'works' ? 'Works' : 'Docs'}</a><span aria-hidden="true">/</span><span>{work ? 'Work' : 'Document'}</span>{refresh}</nav>
    {progress}
    {error && <p role="status" className="ab-lib-page__notice">Library refresh failed ({error}). {data ? 'Showing the last loaded copy.' : 'This entry could not be loaded.'}</p>}
    {(stale || sourceError) && <p role="status" className="ab-lib-page__notice">{stale ? 'Showing a cached catalogue; freshness is not confirmed.' : 'The catalogue is unavailable.'} {sourceError ?? ''}</p>}
    <header className="ab-lib-page__head"><div className="ab-lib-page__eyebrow"><BookOpenIcon size={16} /> {work ? 'Great Library · Work' : 'Library · Document'}</div><h1 tabIndex={-1} ref={heading}>{title}</h1>{work && <p className="ab-lib-page__summary">{work.summary || 'No summary recorded.'}</p>}{(work || doc) && <div className="ab-lib-page__badges"><span>{doc?.privacy ?? 'Public catalogue metadata'}</span><span>{doc?.domain ?? work?.section ?? 'Unassigned domain'}</span>{work?.kind && work.kind.toLowerCase() !== work.section?.toLowerCase() && <span>{work.kind.replaceAll('_', ' ')}</span>}{work?.maturity && <span>{work.maturity}</span>}</div>}</header>
    {!doc && !work ? <p role="status" className="ab-lib-page__notice">{!data && !error ? 'Loading this entry from the Library.' : 'This ID is not available in the current Library. It may be unknown, removed, or outside the approved sources. No file was opened.'}</p> : <div className="ab-lib-page__layout">
      <div className="ab-lib-page__main">
        {doc && (readable ? <article className="ab-lib-page__body" aria-label="Document content" data-testid="document-body">{isMarkdown ? <ReactMarkdown skipHtml remarkPlugins={[remarkGfm]} components={{ img: ({ alt }) => <span className="ab-lib-page__omitted">[Image omitted{alt ? `: ${alt}` : ''}]</span>, a: ({ children }) => <span>{children}</span> }}>{doc.text!}</ReactMarkdown> : <><p className="ab-lib-page__notice">{isText ? 'Plain text source.' : 'This format is shown as plain text. HTML and scripts do not run.'}</p><pre>{doc.text}</pre></>}</article> : <section className="ab-lib-page__empty" role="status"><BookOpenIcon size={28} /><h2>{bodyState(doc)}</h2><p>{doc.note}</p><p>{doc.availability === 'unavailable' ? 'The entry stays listed so its source and context remain visible.' : 'This entry records a source link. Its document body and your access have not been verified. Open the original source to read it.'}</p></section>)}
        {work && <><section className="ab-lib-page__body"><h2>About this Work</h2><p>This catalogue record has no imported document body. Its original Work dossier contains release history and related Works. The document entries below retain their source and access labels.</p></section><section className="ab-lib-page__related" aria-label="Work documents"><h2>Documents</h2>{related.length ? related.map(d => <a key={d.id} href={libraryHref('document', d.id)}><b>{d.title}</b><small>{d.privacy} · {d.availability === 'local' ? 'Available here' : d.availability === 'unavailable' ? 'Source unavailable' : 'Source access unverified'}</small></a>) : <p>No document entries are recorded for this Work.</p>}</section></>}
      </div>
      <aside className="ab-lib-page__source" aria-label="Source and provenance"><h2>Source and context</h2><dl><dt>Project</dt><dd>{doc?.project ?? work?.slug}</dd><dt>Owner</dt><dd>{doc?.owner ?? work?.owner ?? 'Not recorded'}</dd><dt>Source</dt><dd>{doc?.source ?? 'Great Library catalogue'}</dd><dt>Reference</dt><dd>{doc?.reference ?? work?.reference ?? `catalog.json#${work?.slug}`}</dd><dt>Source revision</dt><dd>{doc?.revision ?? work?.revision ?? 'Not recorded'}</dd><dt>Access</dt><dd>{doc?.privacy ?? 'Public metadata; linked sources may require access'}</dd><dt>{readable ? 'File checked' : 'Catalogue observed'}</dt><dd>{date(readable ? doc?.checkedAt : data?.documents?.fetchedAt ?? data?.works.fetchedAt)}</dd></dl>{source && <button type="button" className="ab-lib-page__source-button" onClick={() => onOpenUrl(source, title)}><ExternalLinkIcon size={14} /> {work ? 'Open original Work dossier' : 'Open original source'}</button>}{!source && <p className="ab-lib-page__muted">{readable ? 'Internal document. No public copy is implied.' : 'No supported source URL is available.'}</p>}{source && <p className="ab-lib-page__muted">Source reachability and access are unverified.</p>}{work?.sourceLinks?.length ? <div className="ab-lib-page__links"><h3>Recorded source links</h3>{work.sourceLinks.map((link, i) => { const url = webUrl(link.url); return <div key={`${link.url}:${i}`}>{url ? <button type="button" onClick={() => onOpenUrl(url, link.label ?? link.kind)}>{link.label ?? link.kind} <ExternalLinkIcon size={12} /></button> : <span>{link.label ?? link.kind} · Unsupported URL</span>}<small>{link.visibility ?? 'Unknown access'}</small></div>; })}</div> : null}</aside>
    </div>}
  </section>;
}
