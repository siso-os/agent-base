import type { QuestionRequest, QuestionEvent, QuestionAnswers, QuestionRecoverySnapshot } from '../../../../services/host/src/questions';
import type { QuestionDraft } from '../lib/questions';

export type NativeQuestionMessage = { t: 'answer_question'; id: string; hostInstance: string; session: string; submissionId: string; action: 'answer' | 'dismiss'; answers: QuestionAnswers | null };
/** Supplied by the existing chat transport; task needs flags never manufacture these requests. */
export type OwnerQuestionConnection = {
  connected: boolean; hostInstance: string; session: string; snapshotVersion: string;
  requests: QuestionRequest[];
  canAnswer?: boolean;
  recovery?: QuestionRecoverySnapshot | null;
  notice?: string | null;
  answer: (message: NativeQuestionMessage) => Promise<QuestionEvent>;
};
export type SavedQuestion = { fingerprint: string; draft: QuestionDraft; submission?: NativeQuestionMessage; attemptedSnapshot?: string; receipt?: QuestionEvent };
export type DraftStore = Pick<Storage, 'getItem' | 'setItem'>;
export const questionFingerprint = (r: QuestionRequest) => JSON.stringify([r.hostInstance,r.session,r.id,r.toolId,r.turnId,r.expiresAt,r.questions]);
export const questionStorageKey = (r: QuestionRequest) => `ab-owner-question:${JSON.stringify([r.hostInstance,r.session,r.id])}`;
export function loadQuestion(store: DraftStore, r: QuestionRequest): SavedQuestion {
  try {
    const value = JSON.parse(store.getItem(questionStorageKey(r)) ?? 'null') as SavedQuestion | null;
    if (value?.fingerprint === questionFingerprint(r) && value.draft && Number.isInteger(value.draft.index) && value.draft.index >= 0 && value.draft.index < r.questions.length && value.draft.answers && typeof value.draft.answers === 'object' && !Array.isArray(value.draft.answers) && Object.values(value.draft.answers).every(a => a && Array.isArray(a.selected) && a.selected.every(v => typeof v === 'string') && typeof a.custom === 'string')) {
      return { ...value, draft: { ...value.draft, status: value.draft.status === 'sending' ? 'failed' : value.draft.status, ...(value.draft.status === 'sending' ? { error: 'Previous delivery has no receipt. Refresh the live question before retrying.' } : {}) } };
    }
  } catch { /* Invalid storage never creates a resumable request. */ }
  return { fingerprint: questionFingerprint(r), draft: { index: 0, answers: {}, status: 'editing' } };
}
export function saveQuestion(store: DraftStore, r: QuestionRequest, value: SavedQuestion) {
  store.setItem(questionStorageKey(r),JSON.stringify(value));
}
export function questionBlock(r: QuestionRequest, c: OwnerQuestionConnection | undefined, saved: SavedQuestion, now = Date.now()): string | null {
  if (saved.fingerprint !== questionFingerprint(r)) return 'Question changed. Open the current chat.';
  if (saved.receipt?.t === 'question_done') return saved.receipt.reason === 'delivery-unconfirmed' ? 'Answer delivery is unconfirmed; it will not be resent automatically.' : `Question ${saved.receipt.outcome}`;
  if (r.expiresAt <= now) return 'Question expired. Open the chat for current context.';
  if (!c?.connected) return 'Question transport is disconnected. Draft kept.';
  if (c.canAnswer === false) return 'This host cannot currently accept question answers. Draft kept.';
  if (c.hostInstance !== r.hostInstance || c.session !== r.session || !c.requests.some(q => questionFingerprint(q) === questionFingerprint(r))) return 'Session or question changed. Open the current chat.';
  if (saved.attemptedSnapshot === c.snapshotVersion && saved.draft.status === 'failed') return 'Delivery is unconfirmed. Wait for a fresh question snapshot before retrying.';
  return null;
}
/** Accept only the native receipt for this request; an HTTP/socket send is not proof of resume. */
export function questionReceipt(r: QuestionRequest, event: QuestionEvent): QuestionEvent {
  if (event.t === 'question' || event.id !== r.id || event.hostInstance !== r.hostInstance) throw Error('Answer receipt belongs to another question');
  if (event.t === 'question_failed') throw Error(event.text);
  return event;
}
export type OwnerTaskDetail = { id: string; title: string; stage: string; updated?: string; next?: string | null; links?: Record<string,string | null>; evidence?: unknown[]; history?: { at?: string; stage?: string; note?: string }[] };
export function taskEvidence(detail: OwnerTaskDetail) {
  return {
    component: typeof detail.links?.surface === 'string' ? detail.links.surface : null,
    spec: typeof detail.links?.spec === 'string' ? detail.links.spec : null,
    evidence: (Array.isArray(detail.evidence) ? detail.evidence : []).filter((v): v is string => typeof v === 'string'),
    // Existing task stage/evidence contain no revision-bound clean/rebased/check receipt.
    landing: 'Landing readiness is not established by this task record.',
  };
}
