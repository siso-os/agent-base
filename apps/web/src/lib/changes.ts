// Independently implemented from T3 Code's review contract (MIT, T3 Tools Inc., 2026); see node/src/API.md.
export type ReviewScope = { kind: 'workspace' | 'committed'; targetRef?: string } | { kind: 'uncommitted' } | { kind: 'turn'; turnId: string };
export type ReviewIdentity = { reviewKey: string; machineId: string; worktreeId: string; sessionId: string; agentKey: string; readOnly: boolean };
export type ReviewRevision = { id: string; scope: ReviewScope; baseOid: string; headOid: string | null; treeOid: string; targetOid: string | null; capturedAt: string };
export type DiffPoint = { side: 'old' | 'new'; line: number };
export type DiffRow = { kind: 'context' | 'added' | 'deleted' | 'marker'; oldLine: number | null; newLine: number | null; text: string };
export type DiffHunk = { oldStart: number; oldCount: number; newStart: number; newCount: number; rows: DiffRow[] };
export type ChangedFile = { id: string; oldPath: string | null; newPath: string | null; oldBlobOid: string | null; newBlobOid: string | null; oldMode: string | null; newMode: string | null; change: 'added' | 'deleted' | 'modified' | 'renamed' | 'copied' | 'mode'; additions: number | null; deletions: number | null; content: 'available' | 'binary' | 'too-large' | 'omitted'; untracked: boolean };
export type ReviewPreview = { identity: ReviewIdentity; revision: ReviewRevision; files: ChangedFile[]; patch: string; truncated: boolean; sourceComplete: boolean; limits: { previewBytes: number; fileBytes: number; hunkBytes: number; feedbackBytes: number } };
export type ReviewFile = { revisionId: string; file: ChangedFile; patch: string; hunks: DiffHunk[]; oldText: string | null; newText: string | null };
export type ReviewComment = { id: string; reviewKey: string; revisionId: string; fileId: string; oldPath: string | null; newPath: string | null; start: DiffPoint; end: DiffPoint; contentHash: string; oldRange: {start:number;count:number}; newRange: {start:number;count:number}; capturedHunk: string; text: string; createdAt: string; updatedAt: string; state: 'draft' | 'sent' | 'resolved' | 'obsolete'; anchor: { revisionId: string; fileId: string; start: DiffPoint; end: DiffPoint } | null };
export type CreateReviewComment = { sessionId: string; reviewKey: string; revisionId: string; fileId: string; start: DiffPoint; end?: DiffPoint; text: string };
export type ReviewFeedbackBatch = { version: 1; clientKey: string; sessionId: string; reviewKey: string; revisionId: string; commentIds: string[]; text?: string; delivery?: 'next' | 'steer'; expectedTurnId?: string };
export type ReviewDelivery = { batchId: string; clientKey: string; sessionId: string; status: 'queued' | 'submitted' | 'failed' | 'uncertain'; providerMessageId?: string; providerTurnId?: string; errorCode?: string };
export type ChangesErrorCode = 'mapping-unavailable' | 'stale-recipient' | 'remote-unavailable' | 'read-only' | 'not-git' | 'target-unavailable' | 'unstable-source' | 'snapshot-unavailable' | 'output-limit' | 'invalid-input' | 'host-unavailable' | 'store-unavailable';
export type ChangesError = { error: { code: ChangesErrorCode; detail: string; retryable: boolean } };
export type ChangesResult<T> = T | ChangesError;

/** Semantic coordinates, including deleted old-side rows and no-newline markers. */
export function parseDiffHunks(patch: string): DiffHunk[] {
  const hunks: DiffHunk[] = []; let h: DiffHunk | undefined, old = 0, next = 0;
  for (const line of patch.split('\n')) {
    const m = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(line);
    if (m) { old = Number(m[1]); next = Number(m[3]); h = { oldStart: old, oldCount: Number(m[2] ?? 1), newStart: next, newCount: Number(m[4] ?? 1), rows: [] }; hunks.push(h); continue; }
    if (!h) continue;
    if (line.startsWith('diff --git')) { h = undefined; continue; }
    if (line.startsWith('\\')) h.rows.push({ kind: 'marker', oldLine: null, newLine: null, text: line });
    else if (line.startsWith('+')) h.rows.push({ kind: 'added', oldLine: null, newLine: next++, text: line.slice(1) });
    else if (line.startsWith('-')) h.rows.push({ kind: 'deleted', oldLine: old++, newLine: null, text: line.slice(1) });
    else if (line.startsWith(' ')) h.rows.push({ kind: 'context', oldLine: old++, newLine: next++, text: line.slice(1) });
  }
  return hunks;
}

export function changesUrl(agentId: string, sessionId: string, suffix = '') {
  return `/api/agents/${encodeURIComponent(agentId)}/changes${suffix}?sessionId=${encodeURIComponent(sessionId)}`;
}
export async function changesRequest<T>(url: string, body?: unknown): Promise<ChangesResult<T>> {
  const response = await fetch(url, body === undefined ? undefined : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return response.json();
}
