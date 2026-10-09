import { useEffect, useRef, useState } from 'react';
import type { QuestionRequest } from '../../../../services/host/src/questions';
import { QuestionRecoveryHistory } from './QuestionRecoveryHistory';
import { buildAnswers } from '../lib/questions';
import { isDone, tasksOf, useA0Tasks } from '../lib/a0-tasks';
import { QuestionCard } from './QuestionCard';
import { loadQuestion, saveQuestion, questionBlock, questionFingerprint, questionReceipt, taskEvidence, type OwnerQuestionConnection, type OwnerTaskDetail, type SavedQuestion, type DraftStore } from './OwnerSpaceModel';
import './OwnerSpaceWork.css';

export function OwnerQuestion({ request, connection, store = localStorage }: { request: QuestionRequest; connection?: OwnerQuestionConnection; store?: DraftStore }) {
  const [saved,setSaved] = useState(() => loadQuestion(store,request));
  const [storageError,setStorageError] = useState('');
  const flight = useRef(false), latest = useRef(connection); latest.current = connection;
  const [now,setNow] = useState(Date.now());
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()),1000); return () => clearInterval(timer); },[]);
  const persist = (next: SavedQuestion) => { try { saveQuestion(store,request,next); setSaved(next); setStorageError(''); return true; } catch { setSaved(next); setStorageError('Answer draft could not be saved on this device. Sending is disabled.'); return false; } };
  const blocked = questionBlock(request,connection,saved,now);
  const submit = async (dismiss: boolean) => {
    const current = latest.current;
    if (flight.current || storageError || questionBlock(request,current,saved) || !current) return;
    const answers = dismiss ? null : buildAnswers(request,saved.draft);
    if (!dismiss && !answers) return;
    if (saved.submission && saved.submission.action !== (dismiss ? 'dismiss' : 'answer')) { persist({ ...saved,draft:{ ...saved.draft,status:'failed',error:'Refresh the live question and edit the answer before changing an unconfirmed submission.' } }); return; }
    const message = saved.submission ?? { t:'answer_question' as const,id:request.id,hostInstance:request.hostInstance,session:request.session,submissionId:crypto.randomUUID(),action:dismiss ? 'dismiss' as const : 'answer' as const,answers };
    const attempt = { ...saved, submission:message, attemptedSnapshot:current.snapshotVersion, draft:{ ...saved.draft,status:'sending' as const,error:undefined } };
    if (!persist(attempt)) return;
    flight.current = true;
    try {
      const receipt = questionReceipt(request,await current.answer(message));
      persist({ ...attempt,receipt,draft:{ ...attempt.draft,status:'editing' } });
    } catch (e) { persist({ ...attempt,draft:{ ...attempt.draft,status:'failed',error:(e as Error).message } }); }
    finally { flight.current = false; }
  };
  return <article className="owner-space-work__question">
    {saved.receipt?.t === 'question_done' ? <p role="status">{saved.receipt.reason === 'delivery-unconfirmed' ? 'Answer delivery is unconfirmed. The old question is closed; its answer will not be resent automatically.' : <>Question {saved.receipt.outcome} · native receipt recorded. {saved.receipt.outcome === 'answered' ? 'The answer reached the waiting question; task delivery is still separate.' : 'This does not establish that work resumed.'}</>}</p> : <QuestionCard request={request} draft={saved.draft} connected={!blocked && !storageError} onChange={draft => {
      if (flight.current) return;
      // After an ambiguous send, keep its immutable submission until a fresh native snapshot.
      if (saved.submission && saved.attemptedSnapshot === connection?.snapshotVersion) return;
      persist({ fingerprint:saved.fingerprint,draft });
    }} onSubmit={dismiss => void submit(dismiss)} />}
    {blocked && !saved.receipt && <p role="status">{blocked}</p>}{storageError && <p role="alert">{storageError}</p>}
  </article>;
}
function TaskRecord({ id, updated }: { id: string; updated: string }) {
  const [detail,setDetail] = useState<OwnerTaskDetail | null>(null), [error,setError] = useState('');
  useEffect(() => { let active = true; setDetail(null); setError('');
    void fetch(`/api/a0/tasks/${encodeURIComponent(id)}`,{cache:'no-store'}).then(async r => { if (!r.ok) throw Error('Task evidence unavailable'); const value = await r.json(); if (value.id !== id || typeof value.title !== 'string' || typeof value.stage !== 'string' || (value.history != null && !Array.isArray(value.history))) throw Error('Task evidence is invalid'); if(active) setDetail(value); }).catch(e => { if(active) setError((e as Error).message); });
    return () => { active = false; };
  },[id,updated]);
  if (!detail) return <p role="status">{error || 'Reading task evidence…'}</p>;
  const proof = taskEvidence(detail);
  return <div className="owner-space-work__record"><dl><dt>Component dossier</dt><dd>{proof.component ? `Recorded component: ${proof.component}` : 'No component link recorded'}</dd><dt>Spec</dt><dd>{proof.spec || 'No spec link recorded'}</dd><dt>Recorded stage</dt><dd>{detail.stage}</dd></dl><p>{proof.landing}</p>{proof.evidence.length ? <ul>{proof.evidence.map((e,i) => <li key={i}>{e}</li>)}</ul> : <p>No evidence recorded.</p>}<details><summary>Task history · {detail.history?.length ?? 0}</summary>{detail.history?.filter(h => h && typeof h === 'object').map((h,i) => <p key={i}>{h.at || 'Time not recorded'} · {h.stage} · {h.note}</p>)}</details></div>;
}
export function OwnerSpaceWork({ name, onChat, chatAvailable, questions }: { name: string; onChat: () => void; chatAvailable: boolean; questions?: OwnerQuestionConnection }) {
  const { index,failed } = useA0Tasks();
  const tasks = tasksOf(index?.tasks ?? [],name).filter(t => !isDone(t));
  const [expanded,setExpanded] = useState<string | null>(null);
  return <section className="owner-space-work" aria-label="Owner work and questions"><header><h2>Work and questions</h2><span>{index ? `${tasks.length} open ${tasks.length === 1 ? 'task' : 'tasks'}` : 'Reading tasks…'}</span></header>
    {failed && <p role="status">Task index unavailable. Open the owner chat for current context.</p>}
    {questions?.requests.map(r => <OwnerQuestion key={questionFingerprint(r)} request={r} connection={questions} />)}
    {questions?.notice && <p role="status">{questions.notice}</p>}
    <QuestionRecoveryHistory snapshot={questions?.recovery} connected={questions?.connected ?? false} />
    {!questions && <p>Open the chat to answer a waiting agent. Task requests below are recorded next steps; runtime pause is not inferred.</p>}
    <button type="button" disabled={!chatAvailable} onClick={onChat}>Open owner chat</button>
    <div className="owner-space-work__tasks">{tasks.map(t => <article key={t.id}><button type="button" aria-expanded={expanded === t.id} onClick={() => setExpanded(expanded === t.id ? null : t.id)}><b>{t.title}</b><span>{t.stage}{t.needs ? ' · Input requested' : ''}</span></button>{t.next && <p>{t.next}</p>}{t.agent && <small>Executor: {t.agent}</small>}{expanded === t.id && (t.source === 'unavailable' ? <p role="status">Task source unavailable; evidence cannot be checked.</p> : <TaskRecord id={t.id} updated={t.updated} />)}</article>)}</div>
    {index && !tasks.length && <p>No open tasks are recorded for this owner.</p>}
  </section>;
}
