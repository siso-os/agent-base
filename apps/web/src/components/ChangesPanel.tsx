import { useCallback, useEffect, useRef, useState } from 'react';
import { changesRequest, changesUrl, type ChangesResult, type DiffPoint, type ReviewComment, type ReviewDelivery, type ReviewFeedbackBatch, type ReviewFile, type ReviewPreview, type ReviewScope } from '../lib/changes';
import './ChangesPanel.css';
import { ChangeLens } from './ChangeLens';
import { reviewLensLines } from '../lib/review-lens';

type ReviewTurn = { id: string; label: string; available?: boolean };
export type ChangesPanelProps = { agentId: string; sessionId: string | null; turns?: ReviewTurn[] };
type Draft = { reviewKey: string; revisionId: string; fileId: string; start: DiffPoint; text: string };
type Outbox = { batch: ReviewFeedbackBatch; receipt?: ReviewDelivery };
const storageKey = (agent: string, session: string, kind: string) => `ab-changes-v1:${encodeURIComponent(agent)}:${encodeURIComponent(session)}:${kind}`;
function readLocal<T>(key: string): T | null { try { return JSON.parse(localStorage.getItem(key) || 'null') as T | null; } catch { return null; } }
function writeLocal(key: string, value: unknown) { try { if (value === null) localStorage.removeItem(key); else localStorage.setItem(key, JSON.stringify(value)); return true; } catch { return false; } }
function unwrap<T>(value: ChangesResult<T>): T { if (value && typeof value === 'object' && 'error' in value) throw new Error(`${value.error.code}: ${value.error.detail}`); return value as T; }
const message = (e: unknown) => e instanceof Error ? e.message : 'Changes are unavailable. Try again.';
const position = (p: DiffPoint) => `${p.side === 'old' ? 'old' : 'new'} line ${p.line}`;

/** The keyed child cannot carry requests, drafts or feedback into a successor session. */
export function ChangesPanel(props: ChangesPanelProps) {
  return props.sessionId ? <Review key={`${props.agentId}:${props.sessionId}`} {...props} sessionId={props.sessionId} /> : <div className="changes-panel"><p role="status">No session is available for this review.</p></div>;
}

function Review({ agentId, sessionId, turns }: ChangesPanelProps & { sessionId: string }) {
  const draftKey = storageKey(agentId, sessionId, 'draft');
  const outboxKey = storageKey(agentId, sessionId, 'outbox');
  const [scope, setScope] = useState<ReviewScope>({ kind: 'workspace' });
  const [turnOptions, setTurnOptions] = useState<ReviewTurn[]>(turns ?? []);
  const [turnLoading, setTurnLoading] = useState(turns === undefined);
  const [turnError, setTurnError] = useState('');
  const [turnVersion, setTurnVersion] = useState(0);
  const [turnReviewKey, setTurnReviewKey] = useState<string | null>(null);
  const [observedReviewKey, setObservedReviewKey] = useState<string | null>(null);
  const [preview, setPreview] = useState<ReviewPreview | null>(null);
  const [fileId, setFileId] = useState('');
  const [file, setFile] = useState<ReviewFile | null>(null);
  const [comments, setComments] = useState<ReviewComment[]>([]);
  const [draft, setDraft] = useState<Draft | null>(() => readLocal<Draft>(draftKey));
  const [outbox, setOutbox] = useState<Outbox | null>(() => readLocal<Outbox>(outboxKey));
  const [loading, setLoading] = useState(true);
  const [fileLoading, setFileLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [fileError, setFileError] = useState('');
  const [storageError, setStorageError] = useState('');
  const alive = useRef(true), generation = useRef(0), mutation = useRef(false);
  const outboxCurrent = useRef(outbox);
  const url = useCallback((suffix = '') => changesUrl(agentId, sessionId, suffix), [agentId, sessionId]);
  useEffect(() => { alive.current = true; return () => { alive.current = false; generation.current++; }; }, []);
  useEffect(() => {
    let current = true;
    if (turns !== undefined) { setTurnOptions(turns); setTurnLoading(false); setTurnError(''); setTurnReviewKey(null); return; }
    setTurnLoading(true); setTurnError('');
    void changesRequest<{ identity: ReviewPreview['identity']; turns: ReviewTurn[] }>(url('/turns')).then(unwrap).then(result => {
      if (!current || !alive.current) return;
      if (result.identity.sessionId !== sessionId) throw new Error('stale-recipient: Turn list belongs to a different session.');
      setTurnOptions(result.turns); setTurnReviewKey(result.identity.reviewKey);
    }).catch(e => { if (current && alive.current) { setTurnOptions([]); setTurnReviewKey(null); setTurnError(message(e)); } }).finally(() => { if (current && alive.current) setTurnLoading(false); });
    return () => { current = false; };
  }, [sessionId, turns, turnVersion, url]);
  const matchingTurns = turnReviewKey && observedReviewKey && turnReviewKey !== observedReviewKey ? [] : turnOptions;
  const turnIdentityError = turnReviewKey && observedReviewKey && turnReviewKey !== observedReviewKey ? 'Turn list no longer matches this worktree. Refresh the review.' : '';
  useEffect(() => {
    if (scope.kind !== 'turn' || turnLoading) return;
    if (!matchingTurns.some(t => t.id === scope.turnId && t.available !== false)) {
      const first = matchingTurns.find(t => t.available !== false)?.id || '';
      if (first !== scope.turnId) setScope({ kind: 'turn', turnId: first });
    }
  }, [scope, matchingTurns, turnLoading]);
  function keepDraft(value: Draft | null) { setDraft(value); if (!writeLocal(draftKey, value)) setStorageError('Browser draft storage is unavailable. Save the comment before leaving.'); }
  function keepOutbox(value: Outbox | null) { outboxCurrent.current = value; setOutbox(value); return writeLocal(outboxKey, value); }
  const load = useCallback(async () => {
    const request = ++generation.current;
    setLoading(true); setError(''); setFile(null);
    if (scope.kind === 'turn' && !scope.turnId) { setPreview(null); setLoading(false); return; }
    const params = new URLSearchParams({ scope: scope.kind });
    if (scope.kind === 'turn') params.set('turnId', scope.turnId);
    try {
      const next = unwrap(await changesRequest<ReviewPreview>(`${url()}&${params}`));
      if (!alive.current || request !== generation.current) return;
      if (next.identity.sessionId !== sessionId) throw new Error('stale-recipient: Snapshot belongs to a different session.');
      // Preview reanchors comments; read drafts only after that operation completes.
      const saved = unwrap(await changesRequest<{ comments: ReviewComment[] }>(url('/comments')));
      if (!alive.current || request !== generation.current) return;
      setPreview(next); setObservedReviewKey(next.identity.reviewKey); setComments(saved.comments.filter(c => c.reviewKey === next.identity.reviewKey));
      setFileId(current => next.files.some(f => f.id === current) ? current : next.files[0]?.id || '');
    } catch (e) { if (alive.current && request === generation.current) { setPreview(null); setError(message(e)); } }
    finally { if (alive.current && request === generation.current) setLoading(false); }
  }, [scope, sessionId, url]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    let current = true;
    setFile(null); setFileError('');
    if (!preview || !fileId || loading) return;
    setFileLoading(true);
    void changesRequest<ReviewFile>(`${url(`/files/${encodeURIComponent(fileId)}`)}&revisionId=${encodeURIComponent(preview.revision.id)}`).then(unwrap).then(next => {
      if (current && next.revisionId === preview.revision.id && next.file.id === fileId) setFile(next);
    }).catch(e => { if (current) setFileError(message(e)); }).finally(() => { if (current) setFileLoading(false); });
    return () => { current = false; };
  }, [preview, fileId, loading, url]);

  const checkDelivery = useCallback(async () => {
    if (!outbox) return;
    try {
      const receipt = unwrap(await changesRequest<ReviewDelivery>(url(`/feedback/${encodeURIComponent(outbox.batch.clientKey)}`)));
      if (!alive.current || receipt.sessionId !== sessionId || receipt.clientKey !== outboxCurrent.current?.batch.clientKey) return;
      const next = { batch: outbox.batch, receipt };
      outboxCurrent.current = next; setOutbox(next); writeLocal(outboxKey, next); setError('');
      if (['queued', 'submitted'].includes(receipt.status)) setComments(items => items.map(c => outbox.batch.commentIds.includes(c.id) && c.state === 'draft' ? { ...c, state: 'sent' } : c));
    } catch (e) { if (alive.current) setError(message(e)); }
  }, [outbox, outboxKey, sessionId, url]);
  useEffect(() => {
    if (!outbox || !['queued', 'uncertain'].includes(outbox.receipt?.status || 'uncertain')) return;
    const timer = window.setTimeout(() => { void checkDelivery(); }, 3000);
    return () => window.clearTimeout(timer);
  }, [outbox, checkDelivery]);

  async function saveComment() {
    if (!preview || !draft || draft.reviewKey !== preview.identity.reviewKey || draft.revisionId !== preview.revision.id || mutation.current) return;
    mutation.current = true; setBusy(true); setError('');
    try {
      const comment = unwrap(await changesRequest<ReviewComment>(url('/comments'), { sessionId, ...draft }));
      if (!alive.current) return;
      setComments(items => [...items, comment]); keepDraft(null);
    } catch (e) { if (alive.current) setError(message(e)); }
    finally { mutation.current = false; if (alive.current) setBusy(false); }
  }
  async function resolve(comment: ReviewComment) {
    if (!preview || mutation.current) return;
    mutation.current = true; setBusy(true); setError('');
    try {
      const next = unwrap(await changesRequest<ReviewComment>(url(`/comments/${encodeURIComponent(comment.id)}/resolve`), { sessionId, reviewKey: preview.identity.reviewKey }));
      if (alive.current) setComments(items => items.map(c => c.id === next.id ? next : c));
    } catch (e) { if (alive.current) setError(message(e)); }
    finally { mutation.current = false; if (alive.current) setBusy(false); }
  }
  const pending = !!outbox && (!outbox.receipt || ['queued', 'uncertain'].includes(outbox.receipt.status));
  const eligible = comments.filter(c => c.state === 'draft' && c.anchor?.revisionId === preview?.revision.id && !outbox?.batch.commentIds.includes(c.id));
  async function send(retry = false) {
    if (!preview || mutation.current || (!retry && (!eligible.length || pending))) return;
    const batch: ReviewFeedbackBatch = retry && outbox ? outbox.batch : { version: 1, clientKey: crypto.randomUUID(), sessionId, reviewKey: preview.identity.reviewKey, revisionId: preview.revision.id, commentIds: eligible.map(c => c.id), delivery: 'next' };
    if (!writeLocal(outboxKey, { batch })) { setError('Feedback was not sent: browser storage is unavailable, so its receipt key cannot be preserved.'); return; }
    outboxCurrent.current = { batch }; setOutbox({ batch });
    mutation.current = true; setBusy(true); setError('');
    try {
      const response = await changesRequest<ReviewDelivery>(url('/feedback'), batch);
      if (!alive.current) return;
      if ('error' in response) { if (!retry) keepOutbox(null); setError(`${response.error.code}: ${response.error.detail}`); return; }
      if (response.sessionId !== sessionId || response.clientKey !== batch.clientKey) throw new Error('Feedback receipt identity did not match. Check delivery before retrying.');
      keepOutbox({ batch, receipt: response });
      if (['queued', 'submitted'].includes(response.status)) setComments(items => items.map(c => batch.commentIds.includes(c.id) ? { ...c, state: 'sent' } : c));
    } catch (e) { if (alive.current) setError(`Delivery is unconfirmed. ${message(e)} The original receipt key is retained.`); }
    finally { mutation.current = false; if (alive.current) setBusy(false); }
  }
  const currentDraft = draft && draft.reviewKey === preview?.identity.reviewKey && draft.revisionId === preview?.revision.id;
  const locked = loading || busy;
  const activeFile = preview?.files.find(f => f.id === fileId);
  return <section className="changes-panel" aria-label="Changes review" aria-busy={locked}>
    <div className="changes-toolbar">
      <label className="changes-scope">Review<select aria-label="Review scope" value={scope.kind} disabled={busy} onChange={e => { const kind = e.target.value as ReviewScope['kind']; setScope(kind === 'turn' ? { kind, turnId: matchingTurns.find(t => t.available !== false)?.id || '' } : { kind }); }}>
        <option value="workspace">Whole worktree</option><option value="uncommitted">Uncommitted</option><option value="committed">Committed</option><option value="turn">One turn</option>
      </select></label>
      <button disabled={locked} onClick={() => { setTurnVersion(v => v + 1); void load(); }}>{loading ? 'Capturing…' : 'Refresh'}</button>
    </div>
    {scope.kind === 'turn' && <div className="changes-turn-picker">
      <select aria-label="Captured turn" value={scope.turnId} disabled={busy || turnLoading || !matchingTurns.some(t => t.available !== false)} onChange={e => setScope({ kind: 'turn', turnId: e.target.value })}>
        {!scope.turnId && <option value="">{turnLoading ? 'Loading captured turns…' : 'No captured turn available'}</option>}
        {matchingTurns.map(t => <option key={t.id} value={t.id} disabled={t.available === false}>{t.label}</option>)}
      </select>
      {turnLoading && <p role="status" className="changes-empty">Loading this session’s captured turns…</p>}
      {(turnError || turnIdentityError) && <p role="alert" className="changes-notice is-error">{turnError || turnIdentityError}</p>}
      {!turnLoading && !turnError && !turnIdentityError && !matchingTurns.some(t => t.available !== false) && <p role="status" className="changes-empty">{matchingTurns.length ? 'No turn has both a start and completion capture yet.' : 'No turn captures are recorded for this session yet.'} Refresh after the agent finishes a turn, or review the whole worktree.</p>}
    </div>}
    {error && <p className="changes-notice is-error" role="alert">{error}</p>}
    {storageError && <p className="changes-notice" role="alert">{storageError}</p>}
    {preview && <>
      <div className="changes-summary"><span>{preview.files.length} changed {preview.files.length === 1 ? 'file' : 'files'}</span><time dateTime={preview.revision.capturedAt}>Captured {new Date(preview.revision.capturedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time></div>
      {preview.identity.readOnly && <p className="changes-notice">Read-only recipient. Review and save comments; feedback cannot be sent.</p>}
      {(!preview.sourceComplete || preview.truncated) && <p className="changes-notice">{!preview.sourceComplete && 'Source is incomplete; nested repository content is excluded. '}{preview.truncated && 'Preview patches are truncated. Open each file to inspect its available diff.'}</p>}
      {!preview.files.length ? <p className="changes-empty">No changed files in this captured scope.</p> : <>
        <nav className="changes-files" aria-label="Changed files">{preview.files.map(f => <button key={f.id} disabled={locked} aria-current={fileId === f.id ? 'true' : undefined} onClick={() => setFileId(f.id)}><span>{f.oldPath && f.newPath && f.oldPath !== f.newPath ? `${f.oldPath} → ${f.newPath}` : f.newPath || f.oldPath}</span><small>{f.untracked ? 'untracked' : f.change} <b>+{f.additions ?? '—'}</b> −{f.deletions ?? '—'}</small></button>)}</nav>
        <div className="changes-file-heading">{activeFile?.newPath || activeFile?.oldPath}<span>Select a changed line to comment</span></div>
        {fileLoading && <p role="status">Loading captured diff…</p>}{fileError && <p role="alert" className="changes-notice is-error">{fileError}</p>}
        {file && file.revisionId === preview.revision.id && file.file.content === 'available' && <ChangeLens
          before={{ title: file.file.oldPath || 'File absent before', node: file.oldText === null ? <p>No before text in this capture.</p> : <pre>{file.oldText}</pre> }}
          after={{ title: file.file.newPath || 'File absent after', node: file.newText === null ? <p>No after text in this capture.</p> : <pre>{file.newText}</pre> }}
          view="code" value={50} onChange={() => {}} changedLines={reviewLensLines(file, preview.revision.id)} revision={`${preview.revision.id}:${file.file.id}`} />}
        {file && (file.file.content !== 'available' ? <p className="changes-notice">{file.file.content} content. Line comments are unavailable.</p> : <div className="changes-diff" role="region" aria-label="Captured diff" tabIndex={0}>
          {!file.hunks.length && <p className="changes-empty">No text hunks are available for this change.</p>}
          {file.hunks.map((h, i) => <div key={i}><div className="changes-hunk">@@ −{h.oldStart},{h.oldCount} +{h.newStart},{h.newCount} @@</div>{h.rows.map((row, j) => {
            const point: DiffPoint | null = row.kind === 'deleted' && row.oldLine !== null ? { side: 'old', line: row.oldLine } : row.kind === 'added' && row.newLine !== null ? { side: 'new', line: row.newLine } : null;
            const selected = currentDraft && draft.fileId === fileId && point?.side === draft.start.side && point.line === draft.start.line;
            return <div key={j} className={`changes-line is-${row.kind}${selected ? ' is-selected' : ''}`}><span className="changes-line-number">{row.oldLine ?? ''}</span><span className="changes-line-number">{row.newLine ?? ''}</span>{point ? <button aria-label={`Comment on ${position(point)}`} disabled={locked || !!draft && !selected} onClick={() => { if (!selected) keepDraft({ reviewKey: preview.identity.reviewKey, revisionId: preview.revision.id, fileId, start: point, text: '' }); }}><span>{row.kind === 'added' ? '+' : '−'}</span><code>{row.text || ' '}</code></button> : <span className="changes-context"><span> </span><code>{row.text || ' '}</code></span>}</div>;
          })}</div>)}
        </div>)}
      </>}
    </>}
    {draft && <form className="changes-draft" onSubmit={e => { e.preventDefault(); void saveComment(); }}><label>Comment · {position(draft.start)}<textarea aria-label="Line comment" value={draft.text} maxLength={4096} disabled={busy} onChange={e => keepDraft({ ...draft, text: e.target.value })} /></label>{!currentDraft && <p className="changes-notice">This text belongs to an earlier snapshot. Copy it or discard it, then select its current line again.</p>}<div><button type="submit" disabled={locked || !currentDraft || !draft.text.trim()}>Save comment</button><button type="button" disabled={busy} onClick={() => keepDraft(null)}>Discard text</button></div></form>}
    <div className="changes-comments"><h3>Review comments <span>{comments.filter(c => c.state !== 'resolved').length}</span></h3>{!comments.length && <p className="changes-empty">Saved comments stay with this session. Send them together when your review is ready.</p>}{comments.map(c => <article key={c.id} className={`changes-comment is-${c.state}`}><header><strong>{c.newPath || c.oldPath}</strong><span>{c.state}</span></header><p>{c.text}</p><small>Captured {position(c.start)} · {c.revisionId.slice(0, 8)}</small>{c.anchor && <small>Current anchor: {position(c.anchor.start)} · {c.anchor.revisionId.slice(0, 8)}</small>}{c.state === 'obsolete' && <p className="changes-notice">Anchor no longer matches. Create a new comment on the current diff.</p>}<details><summary>Captured code</summary><pre>{c.capturedHunk}</pre></details>{c.state !== 'resolved' && <button disabled={locked || pending && !!outbox?.batch.commentIds.includes(c.id)} onClick={() => void resolve(c)}>Resolve comment</button>}</article>)}</div>
    <footer className="changes-send">
      {outbox && <div role="status" className="changes-receipt"><strong>{outbox.receipt?.status === 'submitted' ? 'Submitted to the agent' : outbox.receipt?.status === 'queued' ? 'Queued at the host' : outbox.receipt?.status === 'failed' ? 'Feedback failed' : 'Delivery unconfirmed'}</strong><span>{outbox.receipt?.status === 'submitted' ? 'The host accepted the feedback. Work is not yet verified.' : outbox.receipt?.status === 'queued' ? 'Waiting for the host submission receipt.' : 'Comments are preserved. Check the receipt before sending again.'}</span>{outbox.receipt?.errorCode && <span>{outbox.receipt.errorCode}</span>}{pending && <button disabled={busy} onClick={() => void checkDelivery()}>Check delivery</button>}{!outbox.receipt && <button disabled={busy || !preview} onClick={() => void send(true)}>Retry same batch</button>}{outbox.receipt?.status === 'failed' && <button disabled={busy} onClick={() => keepOutbox(null)}>Prepare a new send</button>}</div>}
      <button className="changes-send-button" disabled={locked || !preview || preview.identity.readOnly || pending || !eligible.length || eligible.length > 50 || !!draft} onClick={() => void send()}>Send {eligible.length || ''} {eligible.length === 1 ? 'comment' : 'comments'}</button>
      <small>{eligible.length > 50 ? 'Resolve comments until at most 50 remain in this batch.' : 'Sends saved comments from this snapshot in one message.'}</small>
    </footer>
  </section>;
}
