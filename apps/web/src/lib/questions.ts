import type { QuestionRequest, QuestionAnswers, QuestionSpec, QuestionRecoverySnapshot } from '../../../../services/host/src/questions';
export type DraftAnswer = { selected: string[]; custom: string };
export type QuestionDraft = { index: number; answers: Record<string, DraftAnswer>; status: 'editing'|'sending'|'failed'; error?: string };
// Adapted from T3 Code pendingUserInput.ts (MIT, copyright 2026 T3 Tools Inc.): exact option values; custom text takes precedence.
export function resolveAnswer(q: QuestionSpec, d?: DraftAnswer): string[] | null {
  if (q.allowCustom && d?.custom.trim()) return [d.custom.trim()];
  const selected = [...new Set(d?.selected ?? [])].filter(v => q.options.some(o => o.value === v));
  return selected.length ? q.multiple ? selected : selected.slice(0,1) : null;
}
export function buildAnswers(r: QuestionRequest, d: QuestionDraft): QuestionAnswers | null {
  const entries = r.questions.map(q => [q.id, resolveAnswer(q, d.answers[q.id])] as const);
  return entries.some(([,a]) => !a) ? null : Object.fromEntries(entries) as QuestionAnswers;
}

/** Saved history is adopted only from the same fresh hello; it never creates actionable requests. */
export function matchingQuestionRecovery(value: unknown, hostInstance: unknown, session: unknown): QuestionRecoverySnapshot | null {
  if (!value || typeof value !== 'object' || typeof hostInstance !== 'string' || typeof session !== 'string') return null;
  const v = value as QuestionRecoverySnapshot;
  if (v.version !== 1 || v.hostInstance !== hostInstance || v.session !== session || !['ready','unavailable','memory-only'].includes(v.status) ||
    !Array.isArray(v.records) || v.records.length > 256 || !Array.isArray(v.submissions) || v.submissions.length > 1000 ||
    (v.reason !== undefined && (typeof v.reason !== 'string' || v.reason.length > 1000))) return null;
  const identities = new Set<string>();
  for (const r of v.records) {
    if (!r || r.actionable !== false || !r.request || r.request.session !== session || typeof r.request.id !== 'string' || typeof r.request.hostInstance !== 'string' ||
      !['pending','dispatching','unconfirmed','answered','dismissed','cancelled','expired'].includes(r.phase) || !Number.isFinite(r.updatedAt) ||
      !Array.isArray(r.request.questions) || !r.request.questions.length || r.request.questions.length > 20 ||
      r.request.questions.some(q => !q || typeof q.question !== 'string' || q.question.length > 10000)) return null;
    const identity = JSON.stringify([r.request.hostInstance,r.request.id]);
    if (identities.has(identity)) return null;
    identities.add(identity);
  }
  return v;
}
